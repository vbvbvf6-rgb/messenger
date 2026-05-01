// # P2P Integration Example for script.js
// This shows how to integrate P2P messaging into the existing messenger

/**
 * Modified message sending function to use P2P
 * Replace the existing sendMessage function with this:
 */
async function sendMessageWithP2P(content) {
    if (!content.trim()) return;

    const chatTarget = getCurrentChatTarget(); // Your existing function
    if (!chatTarget) {
        alert("Выберите получателя");
        return;
    }

    // Create message object
    const messageObj = {
        id: `msg_${Date.now()}`,
        timestamp: Date.now(),
        content: content.trim(),
        sender: state.user.username,
        userId: state.user.id,
        type: "text"
    };

    // Display message immediately
    displayMessageInChat(messageObj, true);

    // Save to local database
    try {
        await p2pDatabase.saveMessage(
            chatTarget.peerId, // Could be peer_id or conversation_id
            state.user.id,
            content,
            { type: "text" }
        );
    } catch (error) {
        console.error("Error saving to local DB:", error);
    }

    // Try to send via P2P first
    let sent = false;
    try {
        if (chatTarget.type === "direct" && chatTarget.peerId) {
            sent = p2pMessenger.sendMessage(chatTarget.peerId, messageObj);
        }
    } catch (error) {
        console.error("Error sending via P2P:", error);
    }

    // If P2P failed or not available, queue for later sync
    if (!sent) {
        try {
            await p2pDatabase.queueMessageForSync(chatTarget.peerId, messageObj);
            console.log("Message queued for sync when recipient is online");
        } catch (error) {
            console.error("Error queuing message:", error);
        }
    }

    // Clear input
    el.messageInput.value = "";
    el.messageInput.focus();
}

/**
 * Initialize P2P system after login
 * Call this in your login success handler:
 */
async function initializeP2P(token) {
    try {
        console.log("[P2P] Initializing P2P system...");

        // Initialize local database
        await p2pDatabase.init();
        console.log("[P2P] Database initialized");

        // Initialize P2P messenger
        await p2pMessenger.init(state.socket, token);
        console.log("[P2P] P2P messenger initialized");

        // Setup P2P event handlers
        setupP2PEventHandlers();

        console.log("[P2P] System ready");
    } catch (error) {
        console.error("[P2P] Initialization error:", error);
    }
}

/**
 * Setup P2P event handlers
 */
function setupP2PEventHandlers() {
    /**
     * When online users list updates
     */
    p2pMessenger.registerMessageHandler("onlinePeersUpdate", (users) => {
        console.log("[P2P] Online users updated:", users.length);
        // Update your online users list UI
        updateOnlineUsersList(users);
    });

    /**
     * When a user comes online
     */
    p2pMessenger.registerMessageHandler("userOnline", (userData) => {
        console.log("[P2P] User online:", userData.username);
        // Add user to online list UI
        addUserToOnlineList(userData);
        // Notify user
        showNotification(`${userData.username} стал(а) онлайн`);
    });

    /**
     * When a user goes offline
     */
    p2pMessenger.registerMessageHandler("userOffline", (userData) => {
        console.log("[P2P] User offline:", userData.username);
        // Remove user from online list UI
        removeUserFromOnlineList(userData.peer_id);
    });

    /**
     * When P2P connection is established
     */
    p2pMessenger.registerMessageHandler("connectionEstablished", (peerId, userInfo) => {
        console.log("[P2P] Direct connection established with:", userInfo.username);
        // Update UI to show direct connection
        updateConnectionStatus(peerId, "connected");
        showNotification(`Прямое соединение установлено с ${userInfo.username}`);
    });

    /**
     * When P2P connection closes
     */
    p2pMessenger.registerMessageHandler("connectionClosed", (peerId) => {
        console.log("[P2P] Connection closed with:", peerId);
        updateConnectionStatus(peerId, "disconnected");
    });

    /**
     * When a message is received via P2P
     */
    p2pMessenger.registerMessageHandler("messageReceived", (message, peerId) => {
        console.log("[P2P] Message received from", peerId, ":", message);
        
        // Find the user with this peerId
        const sender = p2pMessenger.onlinePeers.get(peerId);
        if (!sender) {
            console.warn("[P2P] Sender not found for peerId:", peerId);
            return;
        }

        // Display message if this conversation is open
        if (isConversationOpen(peerId, sender.user_id)) {
            displayMessageInChat(message, false);
        } else {
            // Show notification
            showNotification(
                `${sender.username}: ${message.content.substring(0, 50)}`
            );
        }

        // Mark as read if in current chat
        if (getCurrentChatTarget()?.peerId === peerId) {
            // You might want to send read receipt
        }
    });

    /**
     * When online connection is available (after being offline)
     */
    window.addEventListener("online", () => {
        console.log("[P2P] Connected to internet");
        // Process queued messages
        p2pDatabase.processSyncQueue().then((count) => {
            if (count > 0) {
                console.log(`[P2P] Processed ${count} queued messages`);
                showNotification(`Синхронизировано ${count} сообщений`);
            }
        });
    });

    window.addEventListener("offline", () => {
        console.log("[P2P] Disconnected from internet");
        showNotification("Вы оффлайн. Сообщения будут отправлены позже.");
    });
}

/**
 * Load message history for a conversation
 */
async function loadChatHistory(peerId) {
    try {
        const messages = await p2pDatabase.getMessages(peerId, limit = 100);
        console.log("[P2P] Loaded", messages.length, "messages from history");
        
        // Display messages
        el.messages.innerHTML = "";
        messages.forEach((msg) => {
            displayMessageInChat(msg, msg.userId === state.user.id);
        });
    } catch (error) {
        console.error("[P2P] Error loading history:", error);
    }
}

/**
 * Search messages locally
 */
async function searchMessagesLocally(query) {
    try {
        const results = await p2pDatabase.searchMessages(query);
        console.log("[P2P] Search results:", results.length);
        
        // Display results
        displaySearchResults(results);
    } catch (error) {
        console.error("[P2P] Search error:", error);
    }
}

/**
 * Get database statistics
 */
async function showP2PStats() {
    try {
        const stats = await p2pDatabase.getStats();
        console.log("[P2P] Stats:", stats);
        
        // Display in console or UI
        console.log(`
            📊 P2P Statistics:
            - Total messages: ${stats.messages}
            - Conversations: ${stats.conversations}
            - Pending sync: ${stats.pendingSync}
            - Online peers: ${p2pMessenger.getOnlinePeers().length}
        `);
    } catch (error) {
        console.error("[P2P] Stats error:", error);
    }
}

/**
 * Clear conversation history
 */
async function clearConversation(peerId) {
    if (!confirm("Вы уверены? Это удалит всю историю этого чата.")) {
        return;
    }

    try {
        await p2pDatabase.deleteConversation(peerId);
        console.log("[P2P] Conversation cleared");
        el.messages.innerHTML = "";
        showNotification("История чата удалена");
    } catch (error) {
        console.error("[P2P] Error clearing conversation:", error);
    }
}

/**
 * Handle logout - clean up P2P data
 */
async function logout() {
    try {
        // Clear P2P connections
        p2pMessenger.getOnlinePeers().forEach((peer) => {
            p2pMessenger.closePeerConnection(peer.peer_id);
        });

        // Clear database
        await p2pDatabase.clearAllData();

        console.log("[P2P] Cleanup complete");
    } catch (error) {
        console.error("[P2P] Logout error:", error);
    }

    // Existing logout logic
    sessionStorage.removeItem(ACTIVE_TOKEN_KEY);
    location.reload();
}

/**
 * Update online users list in UI
 */
function updateOnlineUsersList(users) {
    el.usersList.innerHTML = "";
    
    users.forEach((user) => {
        const userEl = document.createElement("div");
        userEl.className = "user-item";
        userEl.innerHTML = `
            <img src="${user.avatar_url}" class="avatar" />
            <div>
                <div class="username">${user.username}</div>
                <div class="status online">🟢 Онлайн</div>
            </div>
        `;
        
        userEl.addEventListener("click", () => {
            openDirectChat(user.peer_id, user);
        });
        
        el.usersList.appendChild(userEl);
    });
}

/**
 * Open direct chat with user
 */
async function openDirectChat(peerId, userInfo) {
    // Set current chat target
    state.currentChatTarget = {
        peerId,
        type: "direct",
        userInfo
    };

    // Update title
    el.chatTitle.textContent = userInfo.username;

    // Load history
    await loadChatHistory(peerId);

    // Establish P2P connection
    p2pMessenger.connectToPeer(peerId, userInfo);

    // Show chat area
    el.messages.classList.remove("hidden");
}

/**
 * Get current chat target
 */
function getCurrentChatTarget() {
    return state.currentChatTarget;
}

/**
 * Display message in chat
 */
function displayMessageInChat(message, isOwn) {
    const msgElem = document.createElement("div");
    msgElem.className = `message ${isOwn ? "own" : "other"}`;
    msgElem.innerHTML = `
        <div class="message-content">${escapeHtml(message.content)}</div>
        <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
    `;
    
    el.messages.appendChild(msgElem);
    el.messages.scrollTop = el.messages.scrollHeight;
}

/**
 * Helper: escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Helper: show notification
 */
function showNotification(message) {
    console.log("[Notification]", message);
    // You can use your existing notification system
    // or implement a simple toast notification
}

/**
 * Example: Integrate into existing button handlers
 */
// Modify your existing send button click handler:
el.sendBtn.addEventListener("click", sendMessageWithP2P);
el.messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        sendMessageWithP2P(el.messageInput.value);
    }
});

// Call initializeP2P after successful login
// In your login success handler, add:
// await initializeP2P(token);

console.log("[P2P Integration] Example loaded. Use the functions above in script.js");
