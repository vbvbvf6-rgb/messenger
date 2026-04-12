// # static/p2p.js
// WebRTC P2P Communication Module with Local Storage

class P2PMessenger {
    constructor() {
        this.localPeerId = null; // Our Socket.IO session ID
        this.socket = null;
        this.peers = {}; // Maps peer_id -> {peer_connection, data_channel, user_info}
        this.onlinePeers = new Map(); // peer_id -> user_info
        this.messageDB = null;
        this.config = {
            iceServers: [
                { urls: ["stun:stun.l.google.com:19302"] },
                { urls: ["stun:stun1.l.google.com:19302"] },
                { urls: ["stun:stun2.l.google.com:19302"] },
                // Add relay servers if needed (TURN servers)
                // { urls: ["turn:your-turn-server.com"], username: "user", credential: "pass" }
            ]
        };
        this.messageHandlers = {}; // peer_id -> callback
    }

    async init(socket, token) {
        """
        Initialize P2P system with signaling server
        @param {Socket.IO} socket - Connected Socket.IO socket
        @param {string} token - Auth token
        """
        this.socket = socket;

        // Initialize IndexedDB for message storage
        await this.initMessageDB();

        // Connect to p2p network
        this.socket.emit("p2p_connect", { token }, (response) => {
            console.log("[P2P] Connected to signaling server:", response);
        });

        // Register socket listeners
        this.registerSocketListeners();
    }

    initMessageDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("MessengerDB", 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.messageDB = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Messages store
                if (!db.objectStoreNames.contains("messages")) {
                    const store = db.createObjectStore("messages", { keyPath: ["peerId", "id"] });
                    store.createIndex("timestamp", "timestamp", { unique: false });
                    store.createIndex("peerId", "peerId", { unique: false });
                }

                // Peers store
                if (!db.objectStoreNames.contains("peers")) {
                    db.createObjectStore("peers", { keyPath: "peerId" });
                }

                // Connection metadata
                if (!db.objectStoreNames.contains("connections")) {
                    db.createObjectStore("connections", { keyPath: ["peer1", "peer2"] });
                }
            };
        });
    }

    registerSocketListeners() {
        /**Online users list on startup */
        this.socket.on("p2p_online_users", (data) => {
            console.log("[P2P] Online users:", data.users);
            this.onlinePeers.clear();
            data.users.forEach((user) => {
                this.onlinePeers.set(user.peer_id, user);
            });
            if (this.messageHandlers["onlinePeersUpdate"]) {
                this.messageHandlers["onlinePeersUpdate"](Array.from(this.onlinePeers.values()));
            }
        });

        /** User came online */
        this.socket.on("p2p_user_online", (data) => {
            console.log("[P2P] User online:", data.username);
            this.onlinePeers.set(data.peer_id, data);
            if (this.messageHandlers["userOnline"]) {
                this.messageHandlers["userOnline"](data);
            }
        });

        /** User went offline */
        this.socket.on("p2p_user_offline", (data) => {
            console.log("[P2P] User offline:", data.username);
            this.onlinePeers.delete(data.peer_id);
            this.closePeerConnection(data.peer_id);
            if (this.messageHandlers["userOffline"]) {
                this.messageHandlers["userOffline"](data);
            }
        });

        /** Receive WebRTC offer */
        this.socket.on("p2p_offer", async (data) => {
            console.log("[P2P] Received offer from:", data.from_username);
            await this.handleOffer(data.from, data.offer, {
                username: data.from_username,
                avatar_url: data.from_avatar
            });
        });

        /** Receive WebRTC answer */
        this.socket.on("p2p_answer", async (data) => {
            console.log("[P2P] Received answer from:", data.from);
            await this.handleAnswer(data.from, data.answer);
        });

        /** Receive ICE candidate */
        this.socket.on("p2p_ice_candidate", async (data) => {
            await this.handleICECandidate(data.from, data.candidate);
        });

        /** Relay offline message */
        this.socket.on("p2p_relay_message", (data) => {
            console.log("[P2P] Relayed message from:", data.from_username);
            this.saveMessage(data.from_user_id, data.message);
            if (this.messageHandlers["messageReceived"]) {
                this.messageHandlers["messageReceived"](data.message, data.from_user_id);
            }
        });
    }

    async connectToPeer(peerId, userInfo) {
        """
        Initiate P2P connection to a peer
        @param {string} peerId - Target peer socket ID
        @param {object} userInfo - Target user information
        """
        if (this.peers[peerId]) {
            console.log("[P2P] Already connected to peer:", peerId);
            return this.peers[peerId].peerConnection;
        }

        console.log("[P2P] Initiating connection to:", peerId);

        // Create RTCPeerConnection
        const peerConnection = new RTCPeerConnection({
            iceServers: this.config.iceServers
        });

        // Store peer info
        this.peers[peerId] = {
            peerConnection,
            dataChannels: {},
            userInfo
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit("p2p_ice_candidate", {
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`[P2P] Connection state with ${peerId}:`, peerConnection.connectionState);

            if (peerConnection.connectionState === "connected") {
                this.socket.emit("p2p_connection_established", { to: peerId });
                if (this.messageHandlers["connectionEstablished"]) {
                    this.messageHandlers["connectionEstablished"](peerId, userInfo);
                }
            } else if (
                peerConnection.connectionState === "failed" ||
                peerConnection.connectionState === "disconnected"
            ) {
                this.closePeerConnection(peerId);
                if (this.messageHandlers["connectionClosed"]) {
                    this.messageHandlers["connectionClosed"](peerId);
                }
            }
        };

        // Create data channel for messaging
        const dataChannel = peerConnection.createDataChannel("messages", {
            ordered: true
        });
        this.setupDataChannel(dataChannel, peerId);
        this.peers[peerId].dataChannels["messages"] = dataChannel;

        // Handle incoming data channels
        peerConnection.ondatachannel = (event) => {
            console.log("[P2P] Incoming data channel:", event.channel.label);
            this.setupDataChannel(event.channel, peerId);
            this.peers[peerId].dataChannels[event.channel.label] = event.channel;
        };

        // Create and send offer
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.socket.emit("p2p_offer", {
                to: peerId,
                offer: offer
            });
        } catch (error) {
            console.error("[P2P] Error creating offer:", error);
            this.socket.emit("p2p_connection_failed", {
                to: peerId,
                reason: "Offer creation failed"
            });
            this.closePeerConnection(peerId);
        }

        return peerConnection;
    }

    async handleOffer(peerId, offer, userInfo) {
        """
        Handle incoming WebRTC offer
        """
        if (this.peers[peerId]) {
            console.log("[P2P] Already have connection with:", peerId);
            return;
        }

        console.log("[P2P] Handling offer from:", peerId);

        // Create RTCPeerConnection
        const peerConnection = new RTCPeerConnection({
            iceServers: this.config.iceServers
        });

        this.peers[peerId] = {
            peerConnection,
            dataChannels: {},
            userInfo
        };

        // Set remote description
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit("p2p_ice_candidate", {
                        to: peerId,
                        candidate: event.candidate
                    });
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                console.log(`[P2P] Connection state with ${peerId}:`, peerConnection.connectionState);

                if (peerConnection.connectionState === "connected") {
                    this.socket.emit("p2p_connection_established", { to: peerId });
                    if (this.messageHandlers["connectionEstablished"]) {
                        this.messageHandlers["connectionEstablished"](peerId, userInfo);
                    }
                }
            };

            // Handle incoming data channels
            peerConnection.ondatachannel = (event) => {
                console.log("[P2P] Incoming data channel:", event.channel.label);
                this.setupDataChannel(event.channel, peerId);
                this.peers[peerId].dataChannels[event.channel.label] = event.channel;
            };

            // Create and send answer
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.socket.emit("p2p_answer", {
                to: peerId,
                answer: answer
            });
        } catch (error) {
            console.error("[P2P] Error handling offer:", error);
            this.closePeerConnection(peerId);
        }
    }

    async handleAnswer(peerId, answer) {
        """
        Handle incoming WebRTC answer
        """
        if (!this.peers[peerId]) {
            console.error("[P2P] No peer connection for:", peerId);
            return;
        }

        try {
            await this.peers[peerId].peerConnection.setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        } catch (error) {
            console.error("[P2P] Error handling answer:", error);
        }
    }

    async handleICECandidate(peerId, candidate) {
        """
        Handle incoming ICE candidate
        """
        if (!this.peers[peerId]) return;

        try {
            await this.peers[peerId].peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        } catch (error) {
            console.error("[P2P] Error adding ICE candidate:", error);
        }
    }

    setupDataChannel(dataChannel, peerId) {
        """
        Setup data channel event handlers
        """
        dataChannel.onopen = () => {
            console.log(`[P2P] Data channel opened with ${peerId}`);
            if (this.messageHandlers["channelOpen"]) {
                this.messageHandlers["channelOpen"](peerId);
            }
        };

        dataChannel.onclose = () => {
            console.log(`[P2P] Data channel closed with ${peerId}`);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log("[P2P] Message received:", message);

                // Save to local DB
                this.saveMessage(peerId, message);

                // Notify handlers
                if (this.messageHandlers["messageReceived"]) {
                    this.messageHandlers["messageReceived"](message, peerId);
                }
            } catch (error) {
                console.error("[P2P] Error parsing message:", error);
            }
        };

        dataChannel.onerror = (error) => {
            console.error(`[P2P] Data channel error with ${peerId}:`, error);
        };
    }

    sendMessage(peerId, message) {
        """
        Send message via P2P connection
        @param {string} peerId - Target peer ID
        @param {object} message - Message object
        """
        if (!this.peers[peerId]) {
            console.error("[P2P] No connection to peer:", peerId);
            
            // Try relay through server
            this.socket.emit("p2p_relay_message", {
                target_user_id: this.peers[peerId]?.userInfo?.user_id,
                message: message
            });
            return false;
        }

        const dataChannel = this.peers[peerId].dataChannels["messages"];
        if (!dataChannel || dataChannel.readyState !== "open") {
            console.warn("[P2P] Data channel not ready, relay through server");
            
            // Try relay
            this.socket.emit("p2p_relay_message", {
                target_user_id: this.peers[peerId]?.userInfo?.user_id,
                message: message
            });
            return false;
        }

        try {
            dataChannel.send(JSON.stringify(message));
            
            // Save locally
            this.saveMessage(peerId, message);
            
            return true;
        } catch (error) {
            console.error("[P2P] Error sending message:", error);
            return false;
        }
    }

    saveMessage(peerId, message) {
        """
        Save message to local IndexedDB
        """
        if (!this.messageDB) return;

        const transaction = this.messageDB.transaction(["messages"], "readwrite");
        const store = transaction.objectStore("messages");

        const messageData = {
            peerId,
            id: message.id || Date.now(),
            timestamp: message.timestamp || Date.now(),
            content: message.content,
            sender: message.sender,
            type: message.type || "text"
        };

        store.put(messageData);
    }

    async getMessageHistory(peerId, limit = 50) {
        """
        Retrieve message history from local storage
        """
        if (!this.messageDB) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.messageDB.transaction(["messages"], "readonly");
            const store = transaction.objectStore("messages");
            const index = store.index("peerId");

            const range = IDBKeyRange.bound([peerId, -Infinity], [peerId, Infinity]);
            const request = index.getAll(range);

            request.onsuccess = () => {
                const messages = request.result
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(-limit);
                resolve(messages);
            };
            request.onerror = () => reject(request.error);
        });
    }

    closePeerConnection(peerId) {
        """
        Close peer connection
        """
        if (!this.peers[peerId]) return;

        const peer = this.peers[peerId];

        // Close data channels
        Object.values(peer.dataChannels).forEach((dc) => {
            if (dc) dc.close();
        });

        // Close peer connection
        peer.peerConnection.close();

        delete this.peers[peerId];
    }

    getOnlinePeers() {
        """
        Get list of online peers
        """
        return Array.from(this.onlinePeers.values());
    }

    registerMessageHandler(eventName, callback) {
        """
        Register custom message handler
        """
        this.messageHandlers[eventName] = callback;
    }

    removeMessageHandler(eventName) {
        """
        Remove message handler
        """
        delete this.messageHandlers[eventName];
    }
}

// Export for use in main script
const p2pMessenger = new P2PMessenger();
