"""# backend/models.py
SQLAlchemy models for users, rooms, and messages.
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    pin_hash = Column(String(128), nullable=False, default="")
    avatar_url = Column(String(255), nullable=False, default="/static/assets/default-avatar.svg")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_online = Column(Boolean, default=False)
    twofa_enabled = Column(Boolean, default=False, nullable=False)
    twofa_secret = Column(String(64), nullable=True)
    is_banned = Column(Boolean, default=False, nullable=False)
    banned_at = Column(DateTime, nullable=True)
    banned_reason = Column(String(255), nullable=True)

    messages = relationship("Message", back_populates="author", cascade="all, delete")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    is_direct = Column(Boolean, default=False)
    is_private = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="room", cascade="all, delete")
    members = relationship("RoomMember", back_populates="room", cascade="all, delete")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    content = Column(Text, nullable=True)
    attachment_name = Column(String(255), nullable=True)
    attachment_url = Column(String(255), nullable=True)
    attachment_type = Column(String(50), nullable=True)  # image / file

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    room = relationship("Room", back_populates="messages")
    author = relationship("User", back_populates="messages")
    reads = relationship("MessageRead", back_populates="message", cascade="all, delete")


class MessageRead(Base):
    __tablename__ = "message_reads"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_message_reads_message_user"),)

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    message = relationship("Message", back_populates="reads")


class RoomMember(Base):
    __tablename__ = "room_members"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    room = relationship("Room", back_populates="members")


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending")  # pending / accepted / declined
    created_at = Column(DateTime, default=datetime.utcnow)


class UserChatSetting(Base):
    __tablename__ = "user_chat_settings"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    alias = Column(String(64), nullable=True)
    is_muted = Column(Boolean, default=False)
    is_blocked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
