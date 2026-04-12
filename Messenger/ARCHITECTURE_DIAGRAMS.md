# P2P Messenger Architecture Diagrams

## 1. System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                      SIGNALING SERVER                              │
│  (FastAPI + Socket.IO + minimal state)                             │
│                                                                    │
│  Routes:                                                           │
│  └─ /auth/register, /auth/login    [User registration]             │
│                                                                    │
│  WebSocket Events:                                                 │
│  ├─ p2p_connect                    [Join P2P network]              │
│  ├─ p2p_offer/answer               [Forward WebRTC signals]        │
│  ├─ p2p_ice_candidate              [Exchange ICE candidates]       │
│  ├─ p2p_relay_message              [Relay offline messages]        │
│  └─ get_p2p_stats                  [Get network stats]             │
│                                                                    │
└──────────┬──────────────────────────────┬──────────────────────────┘
           │                              │
           │ Socket.IO (signaling only)   │
           │ ~1KB per connection setup    │ ~100KB per relay
           │                              │
    ┌──────▼─────┐               ┌───────▼──────┐
    │  CLIENT A   │               │  CLIENT B    │
    │             │               │              │
    │ ┌─────────┐ │               │ ┌──────────┐ │
    │ │ WebRTC  │◄┼──────────────┼─│ WebRTC   │ │
    │ │P2P Link │ │ 1-1 Messaging │ │ P2P Link │ │
    │ └─────────┘ │ Direct & Fast │ └──────────┘ │
    │             │               │              │
    │ ┌─────────┐ │               │ ┌──────────┐ │
    │ │IndexedDB│ │               │ │ IndexedDB│ │
    │ │Storage  │ │               │ │ Storage  │ │
    │ └─────────┘ │               │ └──────────┘ │
    │             │               │              │
    │ ┌─────────┐ │               │ ┌──────────┐ │
    │ │  Sync   │ │               │ │  Sync    │ │
    │ │ Queue   │ │               │ │  Queue   │ │
    │ └─────────┘ │               │ └──────────┘ │
    │             │               │              │
    └─────────────┘               └──────────────┘
```

## 2. Message Flow - When Both Online (P2P)

```
USER A                BROWSER A              SIGNALING SERVER         BROWSER B           USER B
     │                   │                         │                      │                │
     │ Types message     │                         │                      │                │
     ├──────────────────►│                         │                      │                │
     │                   │ Select peer,            │                      │                │
     │                   │ initiate connection     │                      │                │
     │                   ├────► RTCPeerConnection established             │                │
     │                   │      (offer/answer via signaling server)       │                │
     │                   │◄─ Exchange ICE candidates                      │                │
     │                   │                         │                      │                │
     │                   │ Create message object   │                      │                │
     │                   ├─ Save to IndexedDB      │                      │                │
     │                   │                         │                      │                │
     │                   │ Send via WebRTC DataChannel ═══════════════════► │                │
     │                   │ (Direct, no server!)    │         (~100ms)────┼──►│                │
     │                   │                         │                      │ Save to IndexedDB
     │                   │                         │                      │ Display           │
     │                   │                         │                      ├──────────────────►│
     │                   │                         │                      │                   │
     │◄────── Instant feedback (local UI) ────────┘                      │ Reads immediately │
```

## 3. Message Flow - When Recipient Offline

```
USER A              BROWSER A           SIGNALING SERVER         BROWSER B           USER B
     │                 │                      │                      │                │
     │ Types message   │                      │                      │ OFFLINE         │
     ├────────────────►│                       │                      │                │
     │                 │ Create message       │                       │                │
     │                 ├─ Try P2P             │                       │                │
     │                 │ (No connection)      │                       │                │
     │                 │                      │                       │                │
     │                 ├─ Queue in IndexedDB─┐│                       │                │
     │                 │ (SyncQueue table)    ││                       │                │
     │                 │                      ││                       │                │
     │                 │ Optional: Send via   └┤───────────► Store ───┤────────────────┤
     │                 │ signaling server      │  on server   relay    │                │
     │                 │ (only if relay qty)   │                       │                │
     │                 │                       │                       │                │
     │ "Message queued"◄───────────────────────┘                       │                │
     │ for delivery                                                    │                │
     │                                                                 │                │
     │                          LATER: User B comes online             │                │
     │                                                                 │                │
     │                 ┌─────────────────────────────────────────────►│                │
     │                 │ SyncQueue auto-processes                     │ Receives       │
     │                 │ (or manual trigger)                          │ queued msgs    │
     │                 │                                              │                │
     │                 │                                              ├────────────────►│
     │                 │◄──── Connection established ──────────────────┤                │
     │                 │ P2P messaging resumes                         │ Synced!        │
```

## 4. P2P Connection Lifecycle

```
┌─────────────────┐
│  User Online    │
└────────┬────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Client emits "p2p_connect"       │
│   with auth token                  │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Server validates token           │
│   Stores user in registry          │
│   Broadcasts to online users       │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Browser receives list of         │
│   online peers                     │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   User clicks on peer to chat      │
│   → connectToPeer() called         │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   RTCPeerConnection created        │
│   → generateOffer()                │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Offer sent via signaling server  │
│   to peer                          │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Peer receives offer              │
│   → setRemoteDescription()         │
│   → generateAnswer()               │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Answer sent back via server      │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Both sides exchange ICE          │
│   candidates for NAT traversal     │
└────────┬───────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   P2P Connection Established!           │
│   ✅ connectionState = "connected"      │
│   ✅ DataChannel ready for messaging    │
└─────────────────────────────────────────┘
```

## 5. Data Flow Architecture

```
┌─────────────────────┐
│   USER INPUT        │
└──────────┬──────────┘
           │
           ▼
    ┌──────────────┐
    │ Create msg   │
    │  + metadata  │
    └──────┬───────┘
           │
    ┌──────▼────────────┐
    │ Try P2P Send      │
    └──────┬────────────┘
           │
      ┌────┴────┐
      │          │
   SUCCESS    FAILURE
      │          │
      ▼          ▼
    Save      Queue
   to DB    for Sync
      │          │
      ▼          ▼
   DISPLAY   Wait for
     MSG     Online
      │          │
      │       When Online:
      │          │
      │    ┌─────▼────────┐
      │    │ Retry Send   │
      │    └─────┬────────┘
      │          │
      └──────┬───┘
             │
             ▼
        DELIVERED
```

## 6. IndexedDB Schema

```
MessengerDB (Version 2)
│
├── Object Store: "messages"
│   ├─ keyPath: ["conversationId", "messageId"]
│   ├─ Index: "conversationId"
│   ├─ Index: "timestamp"
│   ├─ Index: "synced"
│   └─ Records:
│       {
│         conversationId: "peer_id",
│         messageId: "msg_123",
│         userId: 456,
│         content: "Hello!",
│         timestamp: 1234567890,
│         synced: false,
│         type: "text",
│         attachments: [],
│         encrypted: false
│       }
│
├── Object Store: "conversations"
│   ├─ keyPath: "conversationId"
│   ├─ Index: "lastMessageTime"
│   └─ Records:
│       {
│         conversationId: "peer_id",
│         messageCount: 42,
│         lastMessageTime: 1234567890,
│         participants: [123, 456]
│       }
│
├── Object Store: "syncQueue"
│   ├─ keyPath: ["conversationId", "queueId"]
│   └─ Records:
│       {
│         conversationId: "peer_id",
│         queueId: "queue_789",
│         message: {...},
│         addedAt: 1234567890,
│         retries: 0
│       }
│
└── Object Store: "settings"
    ├─ keyPath: "key"
    └─ Records:
        {
          key: "theme_preference",
          value: "dark",
          timestamp: 1234567890
        }
```

## 7. Bandwidth Comparison

```
TRADITIONAL APPROACH (Server-Centric)
─────────────────────────────────────

User A ──(1KB message)──► Server ──(1KB message)──► User B
                         ↓ Store in DB (2KB)
                         ↓ Log message (1KB)
                         ↓ Process/Filter (1KB)
                         ↓ Broadcast (N connections)
        
Daily for 1000 users exchanging 50 messages:
1000 x 50 x 1KB (msg) = 50 MB down
1000 x 50 x 1KB (msg) = 50 MB up
+ Server processing
+ Storage

COST: ~$10-50/month for bandwidth


P2P APPROACH
────────────

User A ────────── Signaling ──────────► User B
       1. Offer (500B)
       2. Answer (500B)
       3. ICE candidates (100B each)
       
       └──── P2P Direct Connection ────
             (Message 1KB, direct)
             (NOT through server)

Daily for 1000 users exchanging 50 messages:
- 1000 signaling setups = 10KB
- Signaling: ~100KB
- Messages: 0 on server (P2P)

COST: ~$1-5/month for bandwidth
SAVES: 80-90% bandwidth costs!
```

## 8. Scaling Architecture

### Level 1: Single Server (Current)
```
┌──────────────────────┐
│   Signaling Server   │
│   - Auth             │
│   - User registry    │
│   - Signal relay     │
│                      │
│   Capacity: ~1000    │
│   active users       │
└──────────────────────┘
```

### Level 2: Multiple Regions
```
┌────────────────────┐
│ US Signaling       │
│ (Regional)         │
└────────────────────┘
         │
 ┌───────┼───────┐
 ▼       ▼       ▼
[US] [EU] [ASIA] Peers
[5K] [5K] [5K]
```

### Level 3: Decentralized
```
┌─────────────┐
│   DHT Net   │
│ (Discovery) │
└─────────────┘
     │
 ┌───┼───┬───┬───┐
 ▼   ▼   ▼   ▼   ▼
[N] [N] [N] [N] [N]ode
All independent
peers
```

---

## 9. Security Model

```
┌─────────────────────────────────────┐
│      CLIENT                         │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 1. Login (Token)              │  │
│  │    ├─ Username + PIN          │  │
│  │    ├─ 2FA (optional)          │  │
│  │    └─ Receive JWT token       │  │
│  └───────────────────────────────┘  │
│                  │                  │
│  ┌───────────────▼───────────────┐  │
│  │ 2. Connect via Socket.IO      │  │
│  │    └─ Send token              │  │
│  └───────────────────────────────┘  │
│                  │                  │
└──────────────────┼──────────────────┘
                   │
             ┌─────┴──────┐
             │   SECURED  │
             │ SIGNALING  │
             │ CONNECTION │
             └─────┬──────┘
                   │
┌──────────────────┼──────────────────┐
│  PEER B CLIENT    │                 │
│  ┌───────────────▼───────────────┐  │
│  │ 3. P2P WebRTC Connection      │  │
│  │    ├─ Direct (no server)      │  │
│  │    ├─ Encrypted DTLS          │  │
│  │    ├─ SRTP for media          │  │
│  │    └─ E2E encryption optional │  │
│  └───────────────────────────────┘  │
│                  │                  │
│  ┌───────────────▼───────────────┐  │
│  │ 4. Local Storage              │  │
│  │    └─ Messages in IndexedDB   │  │
│  └───────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

---

## 10. Event Flow

```
CLIENT A              SOCKET.IO              CLIENT B
   │                      │                    │
   │─ p2p_connect ───────►│                    │
   │                      │◄── p2p_connect ──-|
   │                      │                    │
   │◄─ p2p_online_users ─|                    │
   │                      │─ p2p_online_users ─►|
   │                      │                    │
   │─ p2p_offer ─────────►│                    │
   │                      │─ p2p_offer ───────►|
   │                      │                    │
   │◄─ p2p_ice_cand ──────                    │
   │                      │◄─ p2p_ice_cand ─--|
   │                      │                    │
   │                      │◄─ p2p_answer ──-──|
   │◄─ p2p_answer ───────-|                    │
   │                      │                    │
   │◄─ p2p_ice_cand ──────                    │
   │                      │─ p2p_ice_cand ────►|
   │                      │                    │
   │ (P2P Connected)      │   (P2P Connected)  │
   │                      │                    │
   │◄════════════════════════════════════════►|
   │  WebRTC DataChannel (P2P messages)       │
   │  (No server involvement!)                │
   │                      │                    │
   │─ p2p_connection_established ─────────────►|
```

---

These diagrams show:
1. Overall system architecture
2. Message flows (online vs offline)  
3. Connection lifecycle
4. Data architecture
5. Database schema
6. Bandwidth savings
7. Scaling options
8. Security layers
9. Event flow

Print or reference these for understanding the P2P implementation.
