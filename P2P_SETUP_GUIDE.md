# P2P Messenger - Setup & Integration Guide

## 📋 Overview

Your messenger now has a **P2P (Peer-to-Peer) architecture** using WebRTC. This means:

- ✅ **Direct communication** between users without server intermediary
- ✅ **Free bandwidth** - no server costs after peer connection established
- ✅ **Private messages** - messages don't pass through central server
- ✅ **Offline support** - local message storage with sync when online
- ✅ **Minimal backend** - server only handles authentication and discovery

## 🏗️ Architecture Components

### Backend (Signaling Server)
- **Purpose**: User registration, discovery, and WebRTC signaling
- **Technology**: FastAPI + Socket.IO
- **Endpoints**:
  - `POST /auth/register` - Register new user
  - `POST /auth/login` - User login
  - `Socket: p2p_connect` - Connect to P2P network
  - `Socket: p2p_offer` - Forward WebRTC offer
  - `Socket: p2p_answer` - Forward WebRTC answer
  - `Socket: p2p_ice_candidate` - Forward ICE candidates

### Frontend (Client)
- **p2p.js** - WebRTC connection management
- **p2p-db.js** - Local IndexedDB storage
- **script.js** - UI integration (existing)

### Local Storage
- **IndexedDB** - Persistent message storage
- **LocalStorage** - Settings and user preferences
- **Service Workers** (optional) - Offline sync

## 🚀 Quick Start

### 1. Install Dependencies

The P2P system uses only browser APIs:
- WebRTC (native browser feature)
- IndexedDB (native browser feature)
- Socket.IO (already installed)

No additional npm packages needed!

### 2. Start the Server

```bash
# Install Python dependencies (if not done)
pip install -r requirements.txt

# Run the server
python main.py

# Or with uvicorn directly
uvicorn backend.main:app --reload --host 0.0.0.0
```

### 3. Access the Messenger

Open in browser:
```
http://localhost:8000
```

## 💻 Usage Examples

### Initialize P2P System

```javascript
// This is automatically done in script.js, but here's how:

// 1. Initialize database
await p2pDatabase.init();

// 2. Initialize P2P messenger
await p2pMessenger.init(socket, authToken);
```

### Send P2P Message

```javascript
// Connect to a peer
const peerId = "peer_socket_id";
const userInfo = {
    user_id: 123,
    username: "alice",
    avatar_url: "/static/assets/avatar.png"
};

await p2pMessenger.connectToPeer(peerId, userInfo);

// Send message
const success = p2pMessenger.sendMessage(peerId, {
    id: "msg_123",
    timestamp: Date.now(),
    content: "Hello!",
    sender: "alice",
    type: "text"
});

// Message is automatically saved locally via IndexedDB
```

### Receive Messages

```javascript
// Setup message handler
p2pMessenger.registerMessageHandler("messageReceived", (message, peerId) => {
    console.log("Received from", peerId, ":", message);
    displayMessage(message);
});
```

### Access Local Message History

```javascript
// Get messages from a peer
const messages = await p2pDatabase.getMessages("peer_id", limit = 50);

// Search messages
const results = await p2pDatabase.searchMessages("hello");

// Get all conversations
const conversations = await p2pDatabase.getConversations();
```

### Handle Offline Messages

```javascript
// When user is offline, messages queue locally
p2pMessenger.registerMessageHandler("messageQueuedForSync", (message) => {
    console.log("Message queued, will send when online");
});

// Queue is automatically processed when connection is restored
window.addEventListener("online", () => {
    p2pDatabase.processSyncQueue();
});
```

## 🔧 Integration with Existing Code

### Modify script.js

The integration is already partially set up. Here's what happens in the login flow:

```javascript
async function handleLogin(username, pin) {
    // 1. Authenticate with server
    const token = await auth(username, pin);
    
    // 2. Initialize P2P database
    await p2pDatabase.init();
    
    // 3. Initialize P2P messenger
    await p2pMessenger.init(socket, token);
    
    // 4. Connect to online users
    p2pMessenger.registerMessageHandler("onlinePeersUpdate", (users) => {
        updateOnlineUsersList(users);
    });
    
    // 5. Show app
    showApp();
}
```

### Update Message Sending

When user sends message:

```javascript
// Instead of just saving to server, also try P2P
async function sendMessage(content) {
    const target = getCurrentChatTarget();
    
    const messageObj = {
        id: generateMessageId(),
        timestamp: Date.now(),
        content,
        sender: state.user.username,
        type: "text"
    };
    
    // Try P2P first
    const sent = p2pMessenger.sendMessage(target.peerId, messageObj);
    
    // If P2P fails, queue for later
    if (!sent) {
        await p2pDatabase.queueMessageForSync(target.peerId, messageObj);
    }
    
    // Save locally in any case
    await p2pDatabase.saveMessage(target.peerId, state.user.id, content);
}
```

### Listen for Online Users

```javascript
// When user comes online
p2pMessenger.registerMessageHandler("userOnline", (userInfo) => {
    console.log(userInfo.username, "is now online");
    addToOnlineList(userInfo);
});

// When user goes offline
p2pMessenger.registerMessageHandler("userOffline", (userInfo) => {
    console.log(userInfo.username, "is now offline");
    removeFromOnlineList(userInfo);
});
```

## 📊 Database Schema

### Messages Table
```
{
    conversationId: "peer_id",
    messageId: "unique_id",
    userId: 123,
    content: "message text",
    timestamp: 1234567890,
    synced: false,
    type: "text",
    attachments: [],
    encrypted: false
}
```

### Conversations Table
```
{
    conversationId: "peer_id",
    messageCount: 42,
    lastMessageTime: 1234567890,
    participants: [123, 456]
}
```

### Sync Queue Table
```
{
    conversationId: "peer_id",
    queueId: "unique_id",
    message: {...},
    addedAt: 1234567890,
    retries: 0
}
```

## 🎯 Advanced Features

### Video/Audio Calls

The WebRTC infrastructure supports media streams:

```javascript
// Add media stream to peer connection
const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
});

peer.peerConnection.addTrack(mediaStream.getAudioTracks()[0], mediaStream);
peer.peerConnection.addTrack(mediaStream.getVideoTracks()[0], mediaStream);
```

### File Transfer via DataChannels

```javascript
// Create file transfer channel
const fileChannel = peer.peerConnection.createDataChannel("files");

// Send file chunks
const chunkSize = 16 * 1024; // 16KB chunks
for (let i = 0; i < file.size; i += chunkSize) {
    const chunk = file.slice(i, i + chunkSize);
    fileChannel.send(chunk);
}
```

### End-to-End Encryption (Optional)

```javascript
// Add encryption library (e.g., TweetNaCl or libsodium.js)
import nacl from 'tweetnacl';

// Encrypt message before sending
const encrypted = nacl.secretbox(msg, nonce, key);
p2pMessenger.sendMessage(peerId, { 
    type: 'encrypted',
    data: encrypted 
});
```

### IPFS Integration (Optional)

For permanent file storage:

```javascript
// Upload to IPFS
const ipfsHash = await ipfs.add(file);

// Share hash instead of files
p2pMessenger.sendMessage(peerId, {
    type: 'file',
    ipfsHash,
    filename: file.name
});
```

## 🔒 Security Considerations

### Currently Implemented
- ✅ JWT token authentication
- ✅ PIN-based access control
- ✅ 2FA support
- ✅ Local message storage (encrypted browser storage)

### Recommended Additions
- 🔲 End-to-end encryption for messages
- 🔲 Message signatures (verify sender)
- 🔲 Perfect forward secrecy
- 🔲 Rate limiting on P2P connections
- 🔲 Proof of work for spam prevention

## 📈 Performance & Scaling

### Current Limitations
- Both users must be online for direct message
- NAT traversal requires STUN/TURN servers
- Group chats require mesh network or relay

### Optimization Tips
- Use TURN servers for better connectivity
- Implement message compression
- Batch ICE candidates before sending
- Use adaptive bitrate for media

## 🐛 Troubleshooting

### Messages not sending
1. Check if peer is online: `p2pMessenger.getOnlinePeers()`
2. Check connection state: `peer.peerConnection.connectionState`
3. Check if data channel is open: `channel.readyState === 'open'`

### Offline messages not syncing
1. Check network status: `navigator.onLine`
2. Check sync queue: `await p2pDatabase.getStats()`
3. Manually trigger sync: `await p2pDatabase.processSyncQueue()`

### WebRTC connection fails
1. Enable debug: `peer.peerConnection.onconnectionstatechange`
2. Check ICE candidates: `peer.peerConnection.iceGatheringState`
3. Add TURN server url`iceServers in p2p.js config

## 📚 Files Reference

- **Backend**
  - `backend/main.py` - App initialization with P2P handlers
  - `backend/p2p_sockets.py` - WebRTC signaling handlers
  - `backend/routes.py` - REST API for auth

- **Frontend**
  - `static/p2p.js` - WebRTC peer connection manager
  - `static/p2p-db.js` - Local IndexedDB storage
  - `static/script.js` - UI integration (to be updated)
  - `static/index.html` - HTML with P2P scripts

## 🎓 Next Steps

1. **Test locally** - Run server and open multiple browser tabs
2. **Integrate with script.js** - Update message handling logic
3. **Add encryption** - Implement E2E for privacy
4. **Deploy** - Use the existing Docker/Fly.io setup
5. **Monitor** - Track P2P connection stats

## 📞 Support

For issues or questions:
1. Check browser console for errors
2. Review IndexedDB data in DevTools
3. Check WebRTC connection state
4. Enable debug logging in p2p.js

## 📄 License

Same as main project license.
