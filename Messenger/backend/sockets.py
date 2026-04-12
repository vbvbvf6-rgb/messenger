"""# backend/sockets.py
Socket.IO real-time events for messaging and presence.
"""

from collections import defaultdict
from datetime import datetime, timedelta
import re
from typing import Dict, Set

from sqlalchemy.orm import joinedload

from .database import SessionLocal
from .models import Message, MessageRead, Room, RoomMember, User
from .routes import SESSION_INACTIVE_DAYS, get_user_by_token

# sid -> user_id map for presence tracking.
connected_users: Dict[str, int] = {}
# room_key -> set(user_ids), mostly for participant widget/typing status.
room_participants: Dict[str, Set[int]] = defaultdict(set)
# room_id -> set(user_ids) for tracking active group calls
active_group_calls: Dict[int, Set[int]] = defaultdict(set)


def register_socket_handlers(sio):
    terror_keywords = {
        "бомб", "взрыв", "терракт", "теракт", "kill", "terror", "bomb", "explode",
        "detonate", "shoot", "расстрел", "подрыв", "оружие", "explosive",
    }
    action_keywords = {
        "залож", "сделай", "должен", "нужно", "прикаж", "взорви", "убей",
        "make", "build", "plant", "do it", "must", "need to", "attack",
    }

    def _normalize_text(value: str) -> str:
        return re.sub(r"\s+", " ", (value or "").lower()).strip()

    def _moderation_score(history_texts: list[str], new_text: str) -> int:
        corpus = " ".join([_normalize_text(t) for t in history_texts if t] + [_normalize_text(new_text)])
        if not corpus:
            return 0
        score = 0
        score += sum(2 for kw in terror_keywords if kw in corpus)
        score += sum(2 for kw in action_keywords if kw in corpus)
        # Boost for direct intent pattern in one message.
        new_norm = _normalize_text(new_text)
        if any(t in new_norm for t in terror_keywords) and any(a in new_norm for a in action_keywords):
            score += 4
        # Boost for repeated escalation across full conversation.
        danger_lines = 0
        for line in history_texts[-50:] + [new_text]:
            ln = _normalize_text(line)
            if any(t in ln for t in terror_keywords) and any(a in ln for a in action_keywords):
                danger_lines += 1
        if danger_lines >= 2:
            score += 3
        return score

    async def _emit_to_user(user_id: int, event_name: str, data: dict):
        # Emit event to all active sockets of a specific user.
        found_sockets = []
        for sid_key, uid in list(connected_users.items()):
            if uid == user_id:
                found_sockets.append(sid_key)
                await sio.emit(event_name, data, room=sid_key)
        print(f"[DEBUG] _emit_to_user: user_id={user_id}, event={event_name}, found_sockets={found_sockets}")

    @sio.event
    async def connect(sid, environ, auth):
        token = None
        if isinstance(auth, dict):
            token = auth.get("token")
        if not token:
            return False

        db = SessionLocal()
        try:
            user = get_user_by_token(token, db)
            if not user:
                return False
            if user.is_banned:
                return False
            if user.last_active_at and datetime.utcnow() - user.last_active_at > timedelta(days=SESSION_INACTIVE_DAYS):
                return False

            connected_users[sid] = user.id
            user.is_online = True
            user.last_active_at = datetime.utcnow()
            db.commit()

            await sio.enter_room(sid, "global")
            await sio.emit(
                "user_online",
                {"user_id": user.id, "username": user.username},
                room="global",
            )
            return True
        finally:
            db.close()

    @sio.event
    async def disconnect(sid):
        user_id = connected_users.pop(sid, None)
        if not user_id:
            return

        # If user still has another active socket (e.g. second tab), keep online state.
        user_still_connected = any(uid == user_id for uid in connected_users.values())
        if user_still_connected:
            return

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_online = False
                db.commit()
                await sio.emit(
                    "user_offline",
                    {"user_id": user.id, "username": user.username},
                    room="global",
                )
        finally:
            db.close()

        for _, users_set in room_participants.items():
            users_set.discard(user_id)

    @sio.event
    async def join_room(sid, data):
        room_id = int(data.get("room_id", 0))
        if not room_id:
            return
        user_id = connected_users.get(sid)
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room or not user_id:
                return
            if room.is_direct or room.is_private:
                member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
                if not member:
                    return

            room_key = f"room:{room_id}"
            await sio.enter_room(sid, room_key)
            room_participants[room_key].add(user_id)
            await sio.emit(
                "room_participants",
                {"room_id": room_id, "user_ids": list(room_participants[room_key])},
                room=room_key,
            )
        finally:
            db.close()

    @sio.event
    async def leave_room(sid, data):
        room_id = int(data.get("room_id", 0))
        if not room_id:
            return
        room_key = f"room:{room_id}"
        await sio.leave_room(sid, room_key)

        user_id = connected_users.get(sid)
        if user_id:
            room_participants[room_key].discard(user_id)
            await sio.emit(
                "room_participants",
                {"room_id": room_id, "user_ids": list(room_participants[room_key])},
                room=room_key,
            )

    @sio.event
    async def typing(sid, data):
        room_id = int(data.get("room_id", 0))
        is_typing = bool(data.get("is_typing", False))
        if not room_id:
            return

        user_id = connected_users.get(sid)
        if not user_id:
            return

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return
            await sio.emit(
                "typing",
                {
                    "room_id": room_id,
                    "user_id": user.id,
                    "username": user.username,
                    "is_typing": is_typing,
                },
                room=f"room:{room_id}",
                skip_sid=sid,
            )
        finally:
            db.close()

    @sio.event
    async def new_message(sid, data):
        room_id = int(data.get("room_id", 0))
        content = (data.get("content") or "").strip()
        attachment_name = data.get("attachment_name")
        attachment_url = data.get("attachment_url")
        attachment_type = data.get("attachment_type")

        if not room_id or (not content and not attachment_url):
            return

        user_id = connected_users.get(sid)
        if not user_id:
            return

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            room = db.query(Room).filter(Room.id == room_id).first()
            if not user or not room:
                return
            if user.is_banned:
                return
            if room.is_direct or room.is_private:
                member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
                if not member:
                    return

            # Anti-terror safety: read full conversation context before hard block.
            history_rows = (
                db.query(Message.content)
                .filter(Message.room_id == room_id)
                .order_by(Message.created_at.asc())
                .all()
            )
            history_texts = [row[0] or "" for row in history_rows]
            risk_score = _moderation_score(history_texts, content or "")
            if risk_score >= 8:
                user.is_banned = True
                user.banned_at = datetime.utcnow()
                user.banned_reason = "High-risk violent/terror instruction detected by safety system"
                user.is_online = False
                db.commit()
                await sio.emit(
                    "account_blocked",
                    {"reason": "Safety system detected dangerous instructions in chat"},
                    room=sid,
                )
                connected_users.pop(sid, None)
                await sio.disconnect(sid)
                return
            msg = Message(
                room_id=room_id,
                user_id=user_id,
                content=content,
                attachment_name=attachment_name,
                attachment_url=attachment_url,
                attachment_type=attachment_type,
                created_at=datetime.utcnow(),
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)
            msg = db.query(Message).options(joinedload(Message.author)).filter(Message.id == msg.id).first()

            await sio.emit(
                "new_message",
                {
                    "id": msg.id,
                    "room_id": msg.room_id,
                    "user_id": msg.user_id,
                    "username": msg.author.username,
                    "avatar_url": msg.author.avatar_url,
                    "content": msg.content or "",
                    "attachment_name": msg.attachment_name,
                    "attachment_url": msg.attachment_url,
                    "attachment_type": msg.attachment_type,
                    "created_at": msg.created_at.isoformat(),
                    "status": "sent",
                },
                room=f"room:{room_id}",
            )
        finally:
            db.close()

    @sio.event
    async def messages_read(sid, data):
        room_id = int(data.get("room_id", 0))
        message_id = int(data.get("message_id", 0))
        user_id = connected_users.get(sid)
        if not room_id or not message_id or not user_id:
            return
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return
            if room.is_direct or room.is_private:
                member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
                if not member:
                    return

            incoming_ids = [
                row[0]
                for row in db.query(Message.id)
                .filter(
                    Message.room_id == room_id,
                    Message.id <= message_id,
                    Message.user_id != user_id,
                )
                .all()
            ]
            if not incoming_ids:
                return

            existing = {
                row[0]
                for row in db.query(MessageRead.message_id)
                .filter(
                    MessageRead.user_id == user_id,
                    MessageRead.message_id.in_(incoming_ids),
                )
                .all()
            }
            new_ids = [mid for mid in incoming_ids if mid not in existing]
            if not new_ids:
                return

            for mid in new_ids:
                db.add(MessageRead(message_id=mid, user_id=user_id, created_at=datetime.utcnow()))
            db.commit()

            await sio.emit(
                "messages_read_update",
                {"room_id": room_id, "message_ids": new_ids, "reader_user_id": user_id},
                room=f"room:{room_id}",
                skip_sid=sid,
            )
        finally:
            db.close()

    @sio.event
    async def profile_updated(sid, _data=None):
        user_id = connected_users.get(sid)
        if not user_id:
            return
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return
            await sio.emit(
                "profile_updated",
                {
                    "user_id": user.id,
                    "username": user.username,
                    "avatar_url": user.avatar_url,
                },
                room="global",
            )
        finally:
            db.close()

    # Track active group calls: room_id -> set(user_ids)

    @sio.event
    async def group_call_start(sid, data):
        """Initiate a group call with selective participants"""
        room_id = int(data.get("room_id", 0))
        call_type = data.get("call_type", "audio")
        participant_user_ids = data.get("participant_user_ids", [])
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id or not participant_user_ids:
            return
        
        # Initialize the call group
        active_group_calls[room_id].add(user_id)
        
        # Send invites to selected participants
        for target_user_id in participant_user_ids:
            if target_user_id != user_id:
                await _emit_to_user(
                    target_user_id,
                    "group_call_invite",
                    {
                        "room_id": room_id,
                        "call_type": call_type,
                        "from_user_id": user_id,
                        "current_participants": list(active_group_calls[room_id]),
                    },
                )

    @sio.event
    async def group_call_accept(sid, data):
        """Accept an invitation to join a group call"""
        room_id = int(data.get("room_id", 0))
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id:
            return
        
        # Add user to active call
        active_group_calls[room_id].add(user_id)
        
        # Notify other participants that new user joined
        await sio.emit(
            "group_call_user_joined",
            {"room_id": room_id, "user_id": user_id},
            room=f"room:{room_id}",
            skip_sid=sid,
        )

    @sio.event
    async def group_call_offer(sid, data):
        """Send WebRTC offer to group call participant"""
        room_id = int(data.get("room_id", 0))
        offer = data.get("offer")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id or not offer or not target_user_id:
            return
        
        await _emit_to_user(
            target_user_id,
            "group_call_offer",
            {
                "room_id": room_id,
                "offer": offer,
                "from_user_id": user_id,
            },
        )

    @sio.event
    async def group_call_answer(sid, data):
        """Send WebRTC answer to group call participant"""
        room_id = int(data.get("room_id", 0))
        answer = data.get("answer")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id or not answer or not target_user_id:
            return
        
        await _emit_to_user(
            target_user_id,
            "group_call_answer",
            {
                "room_id": room_id,
                "answer": answer,
                "from_user_id": user_id,
            },
        )

    @sio.event
    async def group_call_ice_candidate(sid, data):
        """Forward ICE candidate in group call"""
        room_id = int(data.get("room_id", 0))
        candidate = data.get("candidate")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id or not candidate or not target_user_id:
            return
        
        await _emit_to_user(
            target_user_id,
            "group_call_ice_candidate",
            {
                "room_id": room_id,
                "candidate": candidate,
                "from_user_id": user_id,
            },
        )

    @sio.event
    async def group_call_end(sid, data):
        """End group call or leave it"""
        room_id = int(data.get("room_id", 0))
        user_id = connected_users.get(sid)
        
        if not room_id or not user_id:
            return
        
        # Remove user from active call
        active_group_calls[room_id].discard(user_id)
        
        # If no one left, remove the call
        if not active_group_calls[room_id]:
            del active_group_calls[room_id]
        
        # Notify others
        await sio.emit(
            "group_call_user_left",
            {"room_id": room_id, "user_id": user_id},
            room=f"room:{room_id}",
        )

    # Keep existing call_offer, call_answer, etc. for backward compatibility
    @sio.event
    async def call_offer(sid, data):
        room_id = int(data.get("room_id", 0))
        offer = data.get("offer")
        call_type = data.get("call_type", "audio")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        
        print(f"[DEBUG] call_offer received: room_id={room_id}, user_id={user_id}, target_user_id={target_user_id}, has_offer={bool(offer)}")
        print(f"[DEBUG] connected_users: {connected_users}")
        
        if not room_id or not user_id or not offer or not target_user_id:
            print(f"[DEBUG] call_offer validation failed")
            return
        
        print(f"[DEBUG] Emitting call_offer to user {target_user_id}")
        await _emit_to_user(
            target_user_id,
            "call_offer",
            {
                "room_id": room_id,
                "offer": offer,
                "from_user_id": user_id,
                "call_type": call_type,
                "target_user_id": target_user_id,
            },
        )

    @sio.event
    async def call_answer(sid, data):
        room_id = int(data.get("room_id", 0))
        answer = data.get("answer")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        if not room_id or not user_id or not answer or not target_user_id:
            return
        await _emit_to_user(
            target_user_id,
            "call_answer",
            {"room_id": room_id, "answer": answer, "from_user_id": user_id},
        )

    @sio.event
    async def call_ice_candidate(sid, data):
        room_id = int(data.get("room_id", 0))
        candidate = data.get("candidate")
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        if not room_id or not user_id or not candidate or not target_user_id:
            return
        await _emit_to_user(
            target_user_id,
            "call_ice_candidate",
            {"room_id": room_id, "candidate": candidate, "from_user_id": user_id},
        )

    @sio.event
    async def call_end(sid, data):
        room_id = int(data.get("room_id", 0))
        target_user_id = int(data.get("target_user_id", 0))
        user_id = connected_users.get(sid)
        if not room_id or not user_id:
            return
        if target_user_id:
            await _emit_to_user(
                target_user_id,
                "call_end",
                {"room_id": room_id, "from_user_id": user_id},
            )
