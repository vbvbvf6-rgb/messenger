// # static/p2p-db.js
// Local message storage and sync layer

class P2PDatabase {
    constructor() {
        this.db = null;
        this.syncQueue = []; // Messages to sync when connection is restored
        this.isOnline = navigator.onLine;
    }

    async init() {
        """Initialize or open IndexedDB database"""
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("P2PMessengerDB", 2);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                this.setupEventListeners();
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Messages store: tracks all messages
                if (!db.objectStoreNames.contains("messages")) {
                    const msgStore = db.createObjectStore("messages", {
                        keyPath: ["conversationId", "messageId"]
                    });
                    msgStore.createIndex("conversationId", "conversationId");
                    msgStore.createIndex("timestamp", "timestamp");
                    msgStore.createIndex("synced", "synced");
                }

                // Conversations store: tracks active conversations
                if (!db.objectStoreNames.contains("conversations")) {
                    const convStore = db.createObjectStore("conversations", {
                        keyPath: "conversationId"
                    });
                    convStore.createIndex("lastMessageTime", "lastMessageTime");
                }

                // Sync queue: messages waiting to be sent
                if (!db.objectStoreNames.contains("syncQueue")) {
                    db.createObjectStore("syncQueue", {
                        keyPath: ["conversationId", "queueId"]
                    });
                }

                // Settings store: user preferences
                if (!db.objectStoreNames.contains("settings")) {
                    db.createObjectStore("settings", { keyPath: "key" });
                }
            };
        });
    }

    setupEventListeners() {
        """Setup online/offline event listeners"""
        window.addEventListener("online", () => {
            this.isOnline = true;
            this.processSyncQueue();
        });

        window.addEventListener("offline", () => {
            this.isOnline = false;
        });
    }

    async saveMessage(conversationId, userId, content, metadata = {}) {
        """
        Save a message to local storage
        @param {string} conversationId - Peer ID or group ID
        @param {number} userId - User ID (original sender)
        @param {string} content - Message content
        @param {object} metadata - Additional data
        @returns {object} Saved message
        """
        if (!this.db) throw new Error("Database not initialized");

        const message = {
            conversationId,
            messageId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            userId,
            content,
            timestamp: Date.now(),
            synced: false,
            encrypted: metadata.encrypted || false,
            type: metadata.type || "text",
            attachments: metadata.attachments || [],
            ...metadata
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["messages", "conversations"], "readwrite");
            
            // Save message
            const msgStore = transaction.objectStore("messages");
            msgStore.put(message);

            // Update conversation
            const convStore = transaction.objectStore("conversations");
            const convRequest = convStore.get(conversationId);

            convRequest.onsuccess = () => {
                const conv = convRequest.result || {
                    conversationId,
                    messageCount: 0,
                    lastMessageTime: 0,
                    participants: []
                };

                conv.messageCount++;
                conv.lastMessageTime = Date.now();

                convStore.put(conv);
            };

            transaction.oncomplete = () => resolve(message);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getMessages(conversationId, limit = 50, offset = 0) {
        """
        Get messages from a conversation
        """
        if (!this.db) throw new Error("Database not initialized");

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["messages"], "readonly");
            const store = transaction.objectStore("messages");
            const index = store.index("conversationId");

            const range = IDBKeyRange.bound(
                [conversationId, -Infinity],
                [conversationId, Infinity]
            );

            const request = index.getAll(range);

            request.onsuccess = () => {
                const messages = request.result
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(-limit - offset, -offset || undefined);
                resolve(messages);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getConversations(limit = 20) {
        """
        Get all conversations sorted by last message time
        """
        if (!this.db) throw new Error("Database not initialized");

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["conversations"], "readonly");
            const store = transaction.objectStore("conversations");
            const index = store.index("lastMessageTime");

            const request = index.getAll();

            request.onsuccess = () => {
                const conversations = request.result
                    .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
                    .slice(0, limit);
                resolve(conversations);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async queueMessageForSync(conversationId, message) {
        """
        Queue message for sync when connection is restored
        """
        if (!this.db) throw new Error("Database not initialized");

        const queueItem = {
            conversationId,
            queueId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            message,
            addedAt: Date.now(),
            retries: 0
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["syncQueue"], "readwrite");
            const store = transaction.objectStore("syncQueue");
            const request = store.put(queueItem);

            request.onsuccess = () => resolve(queueItem);
            request.onerror = () => reject(request.error);
        });
    }

    async processSyncQueue() {
        """
        Process all queued messages when online
        """
        if (!this.isOnline || !this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["syncQueue"], "readonly");
            const store = transaction.objectStore("syncQueue");
            const request = store.getAll();

            request.onsuccess = async () => {
                const queueItems = request.result;

                for (const item of queueItems) {
                    // Attempt to send message
                    console.log("[P2P DB] Syncing queued message:", item);
                    
                    // Emit custom event for sync handler
                    window.dispatchEvent(
                        new CustomEvent("p2p_sync_message", { detail: item })
                    );

                    // Remove from queue after sending
                    await this.dequeueMessage(item.conversationId, item.queueId);
                }

                resolve(queueItems.length);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async dequeueMessage(conversationId, queueId) {
        """
        Remove message from sync queue
        """
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["syncQueue"], "readwrite");
            const store = transaction.objectStore("syncQueue");
            const request = store.delete([conversationId, queueId]);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async searchMessages(query, conversationId = null) {
        """
        Search messages by content
        """
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["messages"], "readonly");
            const store = transaction.objectStore("messages");
            const request = store.getAll();

            request.onsuccess = () => {
                let results = request.result.filter((msg) =>
                    msg.content.toLowerCase().includes(query.toLowerCase())
                );

                if (conversationId) {
                    results = results.filter((msg) => msg.conversationId === conversationId);
                }

                resolve(results.sort((a, b) => b.timestamp - a.timestamp));
            };

            request.onerror = () => reject(request.error);
        });
    }

    async deleteConversation(conversationId) {
        """
        Delete all messages in a conversation
        """
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                ["messages", "conversations", "syncQueue"],
                "readwrite"
            );

            // Delete messages
            const msgStore = transaction.objectStore("messages");
            const msgIndex = msgStore.index("conversationId");
            const msgRange = IDBKeyRange.bound(
                [conversationId, -Infinity],
                [conversationId, Infinity]
            );
            msgIndex.deleteRange(msgRange);

            // Delete conversation
            const convStore = transaction.objectStore("conversations");
            convStore.delete(conversationId);

            // Delete sync queue
            const queueStore = transaction.objectStore("syncQueue");
            const queueIndex = queueStore.index("conversationId");
            queueIndex.deleteRange(IDBKeyRange.only(conversationId));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async clearAllData() {
        """
        Clear entire database (for logout)
        """
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                ["messages", "conversations", "syncQueue", "settings"],
                "readwrite"
            );

            Object.keys(transaction.objectStore)
                .forEach((storeName) => {
                    if (storeName !== "settings") {
                        transaction.objectStore(storeName).clear();
                    }
                });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async saveSetting(key, value) {
        """Save a user setting"""
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["settings"], "readwrite");
            const store = transaction.objectStore("settings");
            const request = store.put({ key, value, timestamp: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getSetting(key, defaultValue = null) {
        """Get a user setting"""
        if (!this.db) return defaultValue;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["settings"], "readonly");
            const store = transaction.objectStore("settings");
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : defaultValue);
            };

            request.onerror = () => reject(request.error);
        });
    }

    getStats() {
        """Get database statistics"""
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                ["messages", "conversations", "syncQueue"],
                "readonly"
            );

            const stats = {
                messages: 0,
                conversations: 0,
                pendingSync: 0
            };

            const msgRequest = transaction.objectStore("messages").count();
            msgRequest.onsuccess = () => {
                stats.messages = msgRequest.result;
            };

            const convRequest = transaction.objectStore("conversations").count();
            convRequest.onsuccess = () => {
                stats.conversations = convRequest.result;
            };

            const queueRequest = transaction.objectStore("syncQueue").count();
            queueRequest.onsuccess = () => {
                stats.pendingSync = queueRequest.result;
            };

            transaction.oncomplete = () => resolve(stats);
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

// Create global instance
const p2pDatabase = new P2PDatabase();
