"""# backend/routes.py
REST API routes for auth, rooms, messages, uploads and users.
"""

import os
import shutil
import hashlib
import pyotp
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from .database import SessionLocal, get_db
from .models import FriendRequest, Message, MessageRead, Room, RoomMember, User, UserChatSetting

SECRET_KEY = "dev-super-secret-key-change-me"
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30
SESSION_INACTIVE_DAYS = 7

router = APIRouter()
auth_scheme = HTTPBearer(auto_error=False)

UPLOAD_DIR = "static/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    pin: str = Field(min_length=5, max_length=5)
    otp: Optional[str] = Field(default=None, min_length=6, max_length=6)


class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=2, max_length=64)


class CreateDirectRequest(BaseModel):
    target_user_id: int


class UpdateProfileRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)


class CreateGroupRoomRequest(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    member_ids: list[int] = Field(default_factory=list)


class FriendRequestCreate(BaseModel):
    target_user_id: int


class FriendRespondRequest(BaseModel):
    request_id: int
    action: str  # accept / decline


class UpdateChatSettingsRequest(BaseModel):
    alias: Optional[str] = Field(default=None, max_length=64)
    is_muted: Optional[bool] = None
    is_blocked: Optional[bool] = None


class TwoFAEnableRequest(BaseModel):
    otp: str = Field(min_length=6, max_length=6)


class AddRoomMemberRequest(BaseModel):
    target_user_id: int


def create_access_token(user: User) -> str:
    expire = datetime.utcnow() + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user.id), "username": user.username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_token(token: str, db: Session) -> Optional[User]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", 0))
        if not user_id:
            return None
        return db.query(User).filter(User.id == user_id).first()
    except (JWTError, ValueError):
        return None


def hash_pin(pin: str) -> str:
    # Simple deterministic hash for demo app. For production use passlib/argon2.
    return hashlib.sha256(f"messenger-pin-salt:{pin}".encode("utf-8")).hexdigest()


def validate_pin(pin: str) -> bool:
    return pin.isdigit() and len(pin) == 5


def validate_otp(otp: str) -> bool:
    return otp.isdigit() and len(otp) == 6


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing auth token")
    user = get_user_by_token(credentials.credentials, db)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Account blocked by safety system")

    if user.last_active_at and datetime.utcnow() - user.last_active_at > timedelta(days=SESSION_INACTIVE_DAYS):
        raise HTTPException(status_code=401, detail="Session expired due to inactivity")

    user.last_active_at = datetime.utcnow()
    db.commit()
    return user


def _room_to_dict(room: Room):
    return {
        "id": room.id,
        "name": room.name,
        "is_direct": room.is_direct,
        "is_private": room.is_private,
        "created_at": room.created_at.isoformat(),
    }


def _message_to_dict(message: Message, status: Optional[str] = None):
    return {
        "id": message.id,
        "room_id": message.room_id,
        "user_id": message.user_id,
        "username": message.author.username if message.author else "Unknown",
        "avatar_url": message.author.avatar_url if message.author else "/static/assets/default-avatar.svg",
        "content": message.content or "",
        "attachment_name": message.attachment_name,
        "attachment_url": message.attachment_url,
        "attachment_type": message.attachment_type,
        "created_at": message.created_at.isoformat(),
        "status": status,
    }


def are_friends(db: Session, user_a_id: int, user_b_id: int) -> bool:
    rel = (
        db.query(FriendRequest)
        .filter(
            FriendRequest.status == "accepted",
            or_(
                and_(FriendRequest.sender_id == user_a_id, FriendRequest.receiver_id == user_b_id),
                and_(FriendRequest.sender_id == user_b_id, FriendRequest.receiver_id == user_a_id),
            ),
        )
        .first()
    )
    return rel is not None


def user_can_access_room(db: Session, user_id: int, room: Room) -> bool:
    if not room:
        return False
    if room.is_direct or room.is_private:
        member = db.query(RoomMember).filter(RoomMember.room_id == room.id, RoomMember.user_id == user_id).first()
        return member is not None
    return True


def get_or_create_chat_setting(db: Session, owner_id: int, target_user_id: int) -> UserChatSetting:
    row = (
        db.query(UserChatSetting)
        .filter(UserChatSetting.owner_id == owner_id, UserChatSetting.target_user_id == target_user_id)
        .first()
    )
    if not row:
        row = UserChatSetting(owner_id=owner_id, target_user_id=target_user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def is_blocked_between(db: Session, a_user_id: int, b_user_id: int) -> bool:
    blocked = (
        db.query(UserChatSetting)
        .filter(
            or_(
                and_(
                    UserChatSetting.owner_id == a_user_id,
                    UserChatSetting.target_user_id == b_user_id,
                    UserChatSetting.is_blocked.is_(True),
                ),
                and_(
                    UserChatSetting.owner_id == b_user_id,
                    UserChatSetting.target_user_id == a_user_id,
                    UserChatSetting.is_blocked.is_(True),
                ),
            )
        )
        .first()
    )
    return blocked is not None


def ensure_default_room():
    db = SessionLocal()
    try:
        room = db.query(Room).filter(Room.name == "general").first()
        if not room:
            db.add(Room(name="general"))
            db.commit()
    finally:
        db.close()


@router.post("/register")
def register(payload: AuthRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    exists = db.query(User).filter(User.username == username).first()
    if exists:
        raise HTTPException(status_code=400, detail="Username already exists")
    if not validate_pin(payload.pin):
        raise HTTPException(status_code=400, detail="PIN must contain exactly 5 digits")

    user = User(
        username=username,
        pin_hash=hash_pin(payload.pin),
        avatar_url="/static/assets/default-avatar.svg",
        last_active_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user)
    return {"token": token, "user": {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}}


@router.post("/login")
def login(payload: AuthRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    if not validate_pin(payload.pin):
        raise HTTPException(status_code=400, detail="PIN must contain exactly 5 digits")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Account blocked by safety system")
    if user.pin_hash != hash_pin(payload.pin):
        raise HTTPException(status_code=401, detail="Wrong PIN")
    if user.twofa_enabled:
        otp = (payload.otp or "").strip()
        if not validate_otp(otp):
            raise HTTPException(status_code=401, detail="2FA code is required")
        if not user.twofa_secret or not pyotp.TOTP(user.twofa_secret).verify(otp, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    user.last_active_at = datetime.utcnow()
    db.commit()
    token = create_access_token(user)
    return {"token": token, "user": {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}


@router.get("/settings")
def get_settings(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}


@router.put("/settings")
def update_settings(payload: UpdateProfileRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    duplicate = db.query(User).filter(User.username == username, User.id != user.id).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Username already exists")
    user.username = username
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}


@router.post("/settings/avatar")
async def update_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    original_name = file.filename or "avatar.png"
    _, ext = os.path.splitext(original_name)
    ext = ext.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}:
        raise HTTPException(status_code=400, detail="Avatar must be an image")
    unique_name = f"avatar_{user.id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}{ext}"
    target_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    if user.avatar_url and user.avatar_url.startswith("/static/uploads/avatar_"):
        old_path = user.avatar_url.replace("/static/", "static/")
        if os.path.exists(old_path):
            os.remove(old_path)

    user.avatar_url = f"/static/uploads/{unique_name}"
    db.commit()
    db.refresh(user)
    return {"avatar_url": user.avatar_url}


@router.get("/2fa/status")
def twofa_status(user: User = Depends(get_current_user)):
    return {"enabled": bool(user.twofa_enabled)}


@router.post("/2fa/setup")
def twofa_setup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = pyotp.random_base32()
    user.twofa_secret = secret
    user.twofa_enabled = False
    db.commit()
    db.refresh(user)
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.username, issuer_name="DrOidgram")
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/2fa/enable")
def twofa_enable(payload: TwoFAEnableRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    otp = payload.otp.strip()
    if not user.twofa_secret:
        raise HTTPException(status_code=400, detail="2FA is not initialized")
    if not validate_otp(otp):
        raise HTTPException(status_code=400, detail="2FA code must be 6 digits")
    if not pyotp.TOTP(user.twofa_secret).verify(otp, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid 2FA code")
    user.twofa_enabled = True
    db.commit()
    return {"ok": True, "enabled": True}


@router.post("/2fa/disable")
def twofa_disable(payload: TwoFAEnableRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    otp = payload.otp.strip()
    if not user.twofa_enabled or not user.twofa_secret:
        return {"ok": True, "enabled": False}
    if not validate_otp(otp):
        raise HTTPException(status_code=400, detail="2FA code must be 6 digits")
    if not pyotp.TOTP(user.twofa_secret).verify(otp, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid 2FA code")
    user.twofa_enabled = False
    user.twofa_secret = None
    db.commit()
    return {"ok": True, "enabled": False}


@router.get("/users")
def list_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.username.asc()).all()
    accepted = db.query(FriendRequest).filter(FriendRequest.status == "accepted").all()
    outgoing_pending = (
        db.query(FriendRequest)
        .filter(FriendRequest.sender_id == user.id, FriendRequest.status == "pending")
        .all()
    )
    incoming_pending = (
        db.query(FriendRequest)
        .filter(FriendRequest.receiver_id == user.id, FriendRequest.status == "pending")
        .all()
    )

    friends_ids = set()
    for req in accepted:
        if req.sender_id == user.id:
            friends_ids.add(req.receiver_id)
        elif req.receiver_id == user.id:
            friends_ids.add(req.sender_id)
    outgoing_ids = {req.receiver_id for req in outgoing_pending}
    incoming_ids = {req.sender_id for req in incoming_pending}
    my_settings = db.query(UserChatSetting).filter(UserChatSetting.owner_id == user.id).all()
    alias_map = {s.target_user_id: s.alias for s in my_settings if s.alias}
    muted_map = {s.target_user_id: s.is_muted for s in my_settings}
    blocked_map = {s.target_user_id: s.is_blocked for s in my_settings}

    return [
        {
            "id": u.id,
            "username": u.username,
            "avatar_url": u.avatar_url,
            "is_online": u.is_online,
            "is_friend": u.id in friends_ids,
            "request_outgoing": u.id in outgoing_ids,
            "request_incoming": u.id in incoming_ids,
            "alias": alias_map.get(u.id),
            "is_muted": bool(muted_map.get(u.id, False)),
            "is_blocked": bool(blocked_map.get(u.id, False)),
        }
        for u in users
        if u.id != user.id
    ]


@router.get("/friends/requests")
def friend_requests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    incoming = (
        db.query(FriendRequest)
        .filter(FriendRequest.receiver_id == user.id, FriendRequest.status == "pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )
    outgoing = (
        db.query(FriendRequest)
        .filter(FriendRequest.sender_id == user.id, FriendRequest.status == "pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )

    def _pack(req: FriendRequest):
        sender = db.query(User).filter(User.id == req.sender_id).first()
        receiver = db.query(User).filter(User.id == req.receiver_id).first()
        return {
            "id": req.id,
            "sender_id": req.sender_id,
            "sender_name": sender.username if sender else "Unknown",
            "receiver_id": req.receiver_id,
            "receiver_name": receiver.username if receiver else "Unknown",
            "created_at": req.created_at.isoformat(),
        }

    return {"incoming": [_pack(req) for req in incoming], "outgoing": [_pack(req) for req in outgoing]}


@router.post("/friends/request")
def send_friend_request(payload: FriendRequestCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target_id = payload.target_user_id
    if target_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    target = db.query(User).filter(User.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if are_friends(db, user.id, target_id):
        raise HTTPException(status_code=400, detail="Already friends")

    existing_pending = (
        db.query(FriendRequest)
        .filter(
            FriendRequest.status == "pending",
            or_(
                and_(FriendRequest.sender_id == user.id, FriendRequest.receiver_id == target_id),
                and_(FriendRequest.sender_id == target_id, FriendRequest.receiver_id == user.id),
            ),
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail="Request already exists")

    req = FriendRequest(sender_id=user.id, receiver_id=target_id, status="pending")
    db.add(req)
    db.commit()
    return {"ok": True}


@router.post("/friends/respond")
def respond_friend_request(payload: FriendRespondRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    req = (
        db.query(FriendRequest)
        .filter(FriendRequest.id == payload.request_id, FriendRequest.receiver_id == user.id, FriendRequest.status == "pending")
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if payload.action not in {"accept", "decline"}:
        raise HTTPException(status_code=400, detail="Invalid action")
    req.status = "accepted" if payload.action == "accept" else "declined"
    db.commit()
    return {"ok": True, "status": req.status}


@router.get("/chats/{target_user_id}/settings")
def get_chat_settings(target_user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    row = (
        db.query(UserChatSetting)
        .filter(UserChatSetting.owner_id == user.id, UserChatSetting.target_user_id == target_user_id)
        .first()
    )
    return {
        "target_user_id": target_user_id,
        "alias": row.alias if row else None,
        "is_muted": bool(row.is_muted) if row else False,
        "is_blocked": bool(row.is_blocked) if row else False,
    }


@router.put("/chats/{target_user_id}/settings")
def update_chat_settings(
    target_user_id: int,
    payload: UpdateChatSettingsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    row = get_or_create_chat_setting(db, user.id, target_user_id)
    if payload.alias is not None:
        row.alias = payload.alias.strip() or None
    if payload.is_muted is not None:
        row.is_muted = payload.is_muted
    if payload.is_blocked is not None:
        row.is_blocked = payload.is_blocked
    db.commit()
    db.refresh(row)
    return {
        "target_user_id": target_user_id,
        "alias": row.alias,
        "is_muted": bool(row.is_muted),
        "is_blocked": bool(row.is_blocked),
    }


@router.get("/rooms")
def list_rooms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rooms = db.query(Room).order_by(Room.is_direct.asc(), Room.name.asc()).all()
    accessible = [room for room in rooms if user_can_access_room(db, user.id, room)]
    return [_room_to_dict(room) for room in accessible]


@router.post("/rooms")
def create_room(payload: CreateRoomRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ = user
    room_name = payload.name.strip().lower()
    if not room_name:
        raise HTTPException(status_code=400, detail="Room name required")
    exists = db.query(Room).filter(Room.name == room_name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Room already exists")
    room = Room(name=room_name, is_direct=False, is_private=False)
    db.add(room)
    db.commit()
    db.refresh(room)
    return _room_to_dict(room)


@router.post("/rooms/group")
def create_group_room(payload: CreateGroupRoomRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room_name = payload.name.strip().lower()
    if not room_name:
        raise HTTPException(status_code=400, detail="Room name required")
    exists = db.query(Room).filter(Room.name == room_name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Room already exists")

    clean_member_ids = sorted(set(uid for uid in payload.member_ids if uid != user.id))
    for member_id in clean_member_ids:
        if not db.query(User).filter(User.id == member_id).first():
            raise HTTPException(status_code=404, detail=f"User {member_id} not found")
        if not are_friends(db, user.id, member_id):
            raise HTTPException(status_code=403, detail="You can add only friends to private group")

    room = Room(name=room_name, is_direct=False, is_private=True)
    db.add(room)
    db.commit()
    db.refresh(room)

    db.add(RoomMember(room_id=room.id, user_id=user.id))
    for member_id in clean_member_ids:
        db.add(RoomMember(room_id=room.id, user_id=member_id))
    db.commit()

    return _room_to_dict(room)


@router.post("/rooms/{room_id}/members")
def add_room_member(
    room_id: int,
    payload: AddRoomMemberRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.is_direct:
        raise HTTPException(status_code=400, detail="Cannot add members to direct messages")

    # For private rooms, user must be a member
    if room.is_private:
        my_member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user.id).first()
        if not my_member:
            raise HTTPException(status_code=403, detail="No access to this private group")
        
        target = db.query(User).filter(User.id == payload.target_user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if not are_friends(db, user.id, target.id):
            raise HTTPException(status_code=403, detail="You can add only friends to private groups")
    else:
        # For public channels, anyone can add friends
        target = db.query(User).filter(User.id == payload.target_user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

    already = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == target.id).first()
    if already:
        return {"ok": True, "already_member": True}

    db.add(RoomMember(room_id=room.id, user_id=target.id))
    db.commit()
    return {"ok": True, "already_member": False}


@router.post("/rooms/direct")
def create_or_get_direct(
    payload: CreateDirectRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if payload.target_user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot start direct chat with yourself")
    target = db.query(User).filter(User.id == payload.target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if not are_friends(db, user.id, target.id):
        raise HTTPException(status_code=403, detail="You can start direct chat only with friends")

    direct_name_a = f"dm:{min(user.id, target.id)}:{max(user.id, target.id)}"
    existing = db.query(Room).filter(and_(Room.name == direct_name_a, Room.is_direct.is_(True))).first()
    if existing:
        return _room_to_dict(existing)

    room = Room(name=direct_name_a, is_direct=True, is_private=True)
    db.add(room)
    db.commit()
    db.refresh(room)
    db.add(RoomMember(room_id=room.id, user_id=user.id))
    db.add(RoomMember(room_id=room.id, user_id=target.id))
    db.commit()
    return _room_to_dict(room)


@router.get("/messages/{room_id}")
def get_messages(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not user_can_access_room(db, user.id, room):
        raise HTTPException(status_code=403, detail="No access to this room")

    messages = (
        db.query(Message)
        .options(joinedload(Message.author))
        .filter(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(50)
        .all()
    )
    messages.reverse()
    own_message_ids = [msg.id for msg in messages if msg.user_id == user.id]
    read_ids = set()
    if own_message_ids:
        rows = (
            db.query(MessageRead.message_id)
            .filter(
                MessageRead.message_id.in_(own_message_ids),
                MessageRead.user_id != user.id,
            )
            .all()
        )
        read_ids = {row[0] for row in rows}

    packed = []
    for msg in messages:
        status = None
        if msg.user_id == user.id:
            status = "read" if msg.id in read_ids else "sent"
        packed.append(_message_to_dict(msg, status=status))
    return packed


@router.get("/messages/{room_id}/search")
def search_messages(
    room_id: int,
    q: str = Query(default="", min_length=1, max_length=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not user_can_access_room(db, user.id, room):
        raise HTTPException(status_code=403, detail="No access to this room")
    query = (
        db.query(Message)
        .options(joinedload(Message.author))
        .filter(Message.room_id == room_id, Message.content.ilike(f"%{q}%"))
        .order_by(Message.created_at.desc())
        .all()
    )
    query.reverse()
    own_message_ids = [msg.id for msg in query if msg.user_id == user.id]
    read_ids = set()
    if own_message_ids:
        rows = (
            db.query(MessageRead.message_id)
            .filter(
                MessageRead.message_id.in_(own_message_ids),
                MessageRead.user_id != user.id,
            )
            .all()
        )
        read_ids = {row[0] for row in rows}

    packed = []
    for msg in query:
        status = None
        if msg.user_id == user.id:
            status = "read" if msg.id in read_ids else "sent"
        packed.append(_message_to_dict(msg, status=status))
    return packed


@router.post("/rooms/{room_id}/clear")
def clear_room_messages(room_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not user_can_access_room(db, user.id, room):
        raise HTTPException(status_code=403, detail="No access to this room")
    db.query(Message).filter(Message.room_id == room_id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can delete only your own messages")

    if message.attachment_url and message.attachment_url.startswith("/static/uploads/"):
        file_path = message.attachment_url.replace("/static/", "static/")
        if os.path.exists(file_path):
            os.remove(file_path)

    db.delete(message)
    db.commit()
    return {"ok": True, "message_id": message_id}


@router.post("/upload")
async def upload_file(
    user: User = Depends(get_current_user),
    file: UploadFile = File(...),
):
    _ = user
    original_name = file.filename or "file.bin"
    _, ext = os.path.splitext(original_name)
    unique_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}{ext}"
    target_path = os.path.join(UPLOAD_DIR, unique_name)

    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    lower_ext = ext.lower()
    is_image = lower_ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
    return {
        "attachment_name": original_name,
        "attachment_url": f"/static/uploads/{unique_name}",
        "attachment_type": "image" if is_image else "file",
    }
