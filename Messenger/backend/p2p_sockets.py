"""# backend/p2p_sockets.py
WebRTC P2P Signaling Server - handles WebRTC offer/answer exchange and ICE candidates
"""

from typing import Dict, Set
from datetime import datetime
from .database import SessionLocal
from .models import User
from .routes import get_user_by_token


# Store peer connections info
# peer_id -> {user_id, connected_to: Set[peer_id], socket_id}
peers_registry: Dict[str, dict] = {}

# Room for all connected peers
SIGNALING_ROOM = "p2p_signaling"


def register_p2p_handlers(sio):
    """Register WebRTC P2P signaling handlers"""

    @sio.event
    async def p2p_connect(sid, data):
        """User connects to P2P network"""
        token = data.get("token")
        if not token:
            return False

        db = SessionLocal()
        try:
            user = get_user_by_token(token, db)
            if not user or user.is_banned:
                return False

            # Register peer
            peers_registry[sid] = {
                "user_id": user.id,
                "username": user.username,
                "connected_to": set(),
                "socket_id": sid,
                "connected_at": datetime.utcnow(),
                "avatar_url": user.avatar_url
            }

            # Join signaling room
            await sio.enter_room(sid, SIGNALING_ROOM)

            # Broadcast online users
            online_users = [
                {
                    "peer_id": p_sid,
                    "user_id": info["user_id"],
                    "username": info["username"],
                    "avatar_url": info["avatar_url"]
                }
                for p_sid, info in peers_registry.items()
                if p_sid != sid
            ]

            await sio.emit("p2p_online_users", {"users": online_users}, room=sid)

            # Notify others about new user
            await sio.emit(
                "p2p_user_online",
                {
                    "peer_id": sid,
                    "user_id": user.id,
                    "username": user.username,
                    "avatar_url": user.avatar_url
                },
                room=SIGNALING_ROOM,
                skip_sid=sid
            )

            return True
        finally:
            db.close()

    @sio.event
    async def p2p_disconnect(sid):
        """User disconnects from P2P network"""
        if sid not in peers_registry:
            return

        peer_info = peers_registry.pop(sid)
        
        # Notify others
        await sio.emit(
            "p2p_user_offline",
            {
                "peer_id": sid,
                "user_id": peer_info["user_id"],
                "username": peer_info["username"]
            },
            room=SIGNALING_ROOM
        )

    @sio.event
    async def p2p_offer(sid, data):
        """Forward WebRTC offer from initiator to target"""
        target_peer_id = data.get("to")
        offer = data.get("offer")

        if not target_peer_id or target_peer_id not in peers_registry:
            await sio.emit("p2p_error", {"message": "Target peer not found"}, room=sid)
            return

        initiator_info = peers_registry.get(sid)
        if not initiator_info:
            return

        # Send offer to target peer
        await sio.emit(
            "p2p_offer",
            {
                "from": sid,
                "from_username": initiator_info["username"],
                "from_avatar": initiator_info["avatar_url"],
                "offer": offer
            },
            room=target_peer_id
        )

        # Track connection attempt
        peers_registry[sid]["connected_to"].add(target_peer_id)

    @sio.event
    async def p2p_answer(sid, data):
        """Forward WebRTC answer from target to initiator"""
        target_peer_id = data.get("to")
        answer = data.get("answer")

        if not target_peer_id or target_peer_id not in peers_registry:
            return

        responder_info = peers_registry.get(sid)
        if not responder_info:
            return

        # Send answer to initiator
        await sio.emit(
            "p2p_answer",
            {
                "from": sid,
                "answer": answer
            },
            room=target_peer_id
        )

        # Track connection
        peers_registry[sid]["connected_to"].add(target_peer_id)

    @sio.event
    async def p2p_ice_candidate(sid, data):
        """Forward ICE candidate"""
        target_peer_id = data.get("to")
        candidate = data.get("candidate")

        if not target_peer_id or target_peer_id not in peers_registry:
            return

        await sio.emit(
            "p2p_ice_candidate",
            {
                "from": sid,
                "candidate": candidate
            },
            room=target_peer_id
        )

    @sio.event
    async def p2p_connection_established(sid, data):
        """Connection established - log for monitoring"""
        target_peer_id = data.get("to")
        
        if target_peer_id in peers_registry:
            # Bidirectional tracking
            if sid in peers_registry:
                peers_registry[sid]["connected_to"].add(target_peer_id)
            peers_registry[target_peer_id]["connected_to"].add(sid)

    @sio.event
    async def p2p_connection_failed(sid, data):
        """Connection failed"""
        target_peer_id = data.get("to")
        reason = data.get("reason")
        
        print(f"[P2P] Connection failed: {sid} -> {target_peer_id}, reason: {reason}")

    @sio.event
    async def p2p_relay_message(sid, data):
        """Relay offline message (if P2P connection fails)"""
        target_user_id = data.get("target_user_id")
        message_data = data.get("message")

        # Find peer by user_id
        target_sid = None
        for p_sid, info in peers_registry.items():
            if info["user_id"] == target_user_id:
                target_sid = p_sid
                break

        if target_sid:
            # Deliver message
            await sio.emit(
                "p2p_relay_message",
                {
                    "from_user_id": peers_registry[sid]["user_id"],
                    "from_username": peers_registry[sid]["username"],
                    "message": message_data
                },
                room=target_sid
            )
        else:
            # Store for later delivery (optional)
            await sio.emit(
                "p2p_relay_stored",
                {"message": "User offline, message will be stored"},
                room=sid
            )

    @sio.event
    async def get_p2p_stats(sid):
        """Get current P2P network stats"""
        total_peers = len(peers_registry)
        total_connections = sum(
            len(info["connected_to"]) 
            for info in peers_registry.values()
        ) // 2  # Divide by 2 because connections are bidirectional

        await sio.emit(
            "p2p_stats",
            {
                "total_peers": total_peers,
                "active_connections": total_connections
            },
            room=sid
        )
