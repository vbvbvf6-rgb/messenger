// # static/script.js
const API = "";
const ACTIVE_TOKEN_KEY = "messenger_active_token";
const state = {
  token: sessionStorage.getItem(ACTIVE_TOKEN_KEY) || "",
  user: null,
  rooms: [],
  users: [],
  currentRoomId: null,
  socket: null,
  pendingAttachment: null,
  typingTimer: null,
  pageFocused: true,
  participants: new Set(),
  friendRequests: { incoming: [], outgoing: [] },
  selectedGroupMembers: new Set(),
  currentChatTargetUserId: null,
  currentChatSettings: { alias: null, is_muted: false, is_blocked: false },
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  currentCallType: null,
  searchTerm: "",
  currentCallPeerId: null,
  messageStatusById: {},
  incomingCall: null,
};

const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const ACCOUNTS_KEY = "messenger_accounts";
const HIDDEN_MESSAGES_KEY = "messenger_hidden_messages";

const el = {
  authModal: document.getElementById("authModal"),
  app: document.getElementById("app"),
  usernameInput: document.getElementById("usernameInput"),
  pinInput: document.getElementById("pinInput"),
  otpInput: document.getElementById("otpInput"),
  authError: document.getElementById("authError"),
  registerBtn: document.getElementById("registerBtn"),
  loginBtn: document.getElementById("loginBtn"),
  roomsList: document.getElementById("roomsList"),
  usersList: document.getElementById("usersList"),
  friendRequestsList: document.getElementById("friendRequestsList"),
  discoverUsersList: document.getElementById("discoverUsersList"),
  messages: document.getElementById("messages"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  attachBtn: document.getElementById("attachBtn"),
  fileInput: document.getElementById("fileInput"),
  chatTitle: document.getElementById("chatTitle"),
  typingLabel: document.getElementById("typingLabel"),
  searchMessagesInput: document.getElementById("searchMessagesInput"),
  searchMessagesBtn: document.getElementById("searchMessagesBtn"),
  voiceCallBtn: document.getElementById("voiceCallBtn"),
  videoCallBtn: document.getElementById("videoCallBtn"),
  chatSettingsBtn: document.getElementById("chatSettingsBtn"),
  addRoomMemberBtn: document.getElementById("addRoomMemberBtn"),
  currentUserLabel: document.getElementById("currentUserLabel"),
  notifySound: document.getElementById("notifySound"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  themeToggle: document.getElementById("themeToggle"),
  participantsBtn: document.getElementById("participantsBtn"),
  participantsPanel: document.getElementById("participantsPanel"),
  participantsList: document.getElementById("participantsList"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  settingsAvatar: document.getElementById("settingsAvatar"),
  avatarInput: document.getElementById("avatarInput"),
  settingsUsernameInput: document.getElementById("settingsUsernameInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  addAccountBtn: document.getElementById("addAccountBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  accountsList: document.getElementById("accountsList"),
  settingsError: document.getElementById("settingsError"),
  setup2faBtn: document.getElementById("setup2faBtn"),
  enable2faBtn: document.getElementById("enable2faBtn"),
  disable2faBtn: document.getElementById("disable2faBtn"),
  twofaCodeInput: document.getElementById("twofaCodeInput"),
  twofaSecret: document.getElementById("twofaSecret"),
  createGroupModal: document.getElementById("createGroupModal"),
  closeGroupBtn: document.getElementById("closeGroupBtn"),
  groupNameInput: document.getElementById("groupNameInput"),
  groupMembersList: document.getElementById("groupMembersList"),
  createGroupConfirmBtn: document.getElementById("createGroupConfirmBtn"),
  groupError: document.getElementById("groupError"),
  chatSettingsModal: document.getElementById("chatSettingsModal"),
  closeChatSettingsBtn: document.getElementById("closeChatSettingsBtn"),
  chatAliasInput: document.getElementById("chatAliasInput"),
  saveChatSettingsBtn: document.getElementById("saveChatSettingsBtn"),
  muteUserBtn: document.getElementById("muteUserBtn"),
  blockUserBtn: document.getElementById("blockUserBtn"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  chatSettingsError: document.getElementById("chatSettingsError"),
  callModal: document.getElementById("callModal"),
  callTitle: document.getElementById("callTitle"),
  callStatus: document.getElementById("callStatus"),
  endCallBtn: document.getElementById("endCallBtn"),
  acceptCallBtn: document.getElementById("acceptCallBtn"),
  rejectCallBtn: document.getElementById("rejectCallBtn"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  deleteConfirmModal: document.getElementById("deleteConfirmModal"),
  deleteForMeBtn: document.getElementById("deleteForMeBtn"),
  deleteForAllBtn: document.getElementById("deleteForAllBtn"),
  deleteCancelBtn: document.getElementById("deleteCancelBtn"),
};

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
  };
}

function touchActivity() {
  localStorage.setItem("lastUsedAt", String(Date.now()));
}

function setActiveToken(token) {
  if (!token) {
    sessionStorage.removeItem(ACTIVE_TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(ACTIVE_TOKEN_KEY, token);
}

function getStoredAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveStoredAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function upsertCurrentAccount() {
  if (!state.token || !state.user) return;
  const accounts = getStoredAccounts().filter((acc) => acc.user_id !== state.user.id);
  accounts.unshift({
    token: state.token,
    user_id: state.user.id,
    username: state.user.username,
    avatar_url: state.user.avatar_url,
    last_used_at: Date.now(),
  });
  saveStoredAccounts(accounts.slice(0, 8));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMessageText(text) {
  const safe = escapeHtml(text || "");
  if (!state.searchTerm) return safe;
  const pattern = new RegExp(`(${escapeRegExp(state.searchTerm)})`, "gi");
  return safe.replace(pattern, '<mark class="msg-highlight">$1</mark>');
}

function statusIcon(status) {
  if (status === "failed") return '<span class="msg-status failed">🕒</span>';
  if (status === "read") return '<span class="msg-status read">✓✓</span>';
  return '<span class="msg-status sent">✓</span>';
}

function toggleIncomingButtons(show) {
  if (!el.acceptCallBtn || !el.rejectCallBtn) return;
  el.acceptCallBtn.classList.toggle("hidden", !show);
  el.rejectCallBtn.classList.toggle("hidden", !show);
}

function getUserLabel(user) {
  return user?.alias || user?.username || "Unknown";
}

function getHiddenMessageIds() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_MESSAGES_KEY) || "[]");
  } catch {
    return [];
  }
}

function hideMessageForMe(messageId) {
  const ids = new Set(getHiddenMessageIds());
  ids.add(String(messageId));
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify(Array.from(ids)));
}

function isHiddenMessage(messageId) {
  const ids = getHiddenMessageIds();
  return ids.includes(String(messageId));
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.detail || "Request error");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function setTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  el.themeToggle.innerHTML = theme === "dark"
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
}

function initTheme() {
  setTheme(localStorage.getItem("theme") || "dark");
}

async function auth(mode) {
  const username = el.usernameInput.value.trim();
  const pin = el.pinInput.value.trim();
  const otp = el.otpInput?.value.trim() || "";
  if (!username || !/^\d{5}$/.test(pin)) {
    el.authError.textContent = "Введите username и PIN из 5 цифр";
    return;
  }
  try {
    const data = await request(`/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, pin, otp: otp || null }),
    });
    state.token = data.token;
    state.user = data.user;
    setActiveToken(state.token);
    upsertCurrentAccount();
    touchActivity();
    el.authError.textContent = "";
    await bootstrap();
  } catch (e) {
    el.authError.textContent = e.message;
  }
}

async function loadMe() {
  state.user = await request("/me", { headers: authHeaders() });
  el.currentUserLabel.textContent = `@${state.user.username}`;
}

async function loadRooms() {
  state.rooms = await request("/rooms", { headers: authHeaders() });
  renderRooms();
}

async function loadUsers() {
  state.users = await request("/users", { headers: authHeaders() });
  renderUsers();
}

async function loadFriendRequests() {
  state.friendRequests = await request("/friends/requests", { headers: authHeaders() });
  renderFriendRequests();
}

function roomDisplayName(room) {
  if (!room.is_direct) return `# ${room.name}`;
  const ids = room.name.replace("dm:", "").split(":").map(Number);
  const targetId = ids.find((id) => id !== state.user.id);
  const target = state.users.find((u) => u.id === targetId);
  return target ? `@ ${getUserLabel(target)}` : "Direct";
}

function renderRooms() {
  el.roomsList.innerHTML = "";
  // Filter out direct message rooms from the main list
  const filteredRooms = state.rooms.filter((r) => !r.is_direct);
  
  if (!filteredRooms.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.innerHTML = '<span>Нет комнат. Создай новую!</span>';
    el.roomsList.appendChild(empty);
    return;
  }
  
  filteredRooms.forEach((room) => {
    const item = document.createElement("div");
    item.key = `room-${room.id}`; // Add key for stable DOM references
    item.className = `list-item ${state.currentRoomId === room.id ? "active" : ""}`;
    item.innerHTML = `<i class="fa-solid fa-hashtag"></i> <span>${escapeHtml(roomDisplayName(room))}</span>`;
    item.onclick = () => openRoom(room.id);
    el.roomsList.appendChild(item);
  });
}

function renderUsers() {
  el.usersList.innerHTML = "";
  el.discoverUsersList.innerHTML = "";
  const friends = state.users.filter((u) => u.is_friend);
  const discover = state.users.filter((u) => !u.is_friend);

  friends.forEach((user) => {
    const item = document.createElement("div");
    item.key = `friend-${user.id}`; // Add key for stable DOM references
    item.className = "list-item user-item";
    item.innerHTML = `
      <span class="status-dot ${user.is_online ? "online" : ""}"></span>
      <img class="avatar" src="${user.avatar_url}" alt="">
      <div class="user-main">
        <div class="user-name">${escapeHtml(getUserLabel(user))}</div>
        <small>${user.is_online ? "online" : "offline"}</small>
      </div>
    `;
    item.onclick = () => createDirect(user.id);
    el.usersList.appendChild(item);
  });

  // Add search box for discovering friends
  const searchContainer = document.createElement("div");
  searchContainer.className = "discover-search";
  searchContainer.innerHTML = `
    <input type="text" id="discoverSearchInput" placeholder="Поиск по нику..." class="discover-search-input" />
  `;
  el.discoverUsersList.appendChild(searchContainer);
  
  const searchInput = searchContainer.querySelector("#discoverSearchInput");
  let displayedUsers = discover;
  
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    displayedUsers = discover.filter((u) => u.username.toLowerCase().includes(searchTerm));
    renderDiscoverUsers(displayedUsers);
  });

  renderDiscoverUsers(discover);
}

function renderDiscoverUsers(usersList) {
  // Keep the search input and clear the rest
  const searchInput = document.getElementById("discoverSearchInput");
  el.discoverUsersList.innerHTML = ``;
  if (searchInput || usersList.length) {
    const searchContainer = document.createElement("div");
    searchContainer.className = "discover-search";
    searchContainer.innerHTML = `
      <input type="text" id="discoverSearchInput" placeholder="Поиск по нику..." class="discover-search-input" />
    `;
    el.discoverUsersList.appendChild(searchContainer);
    const newSearchInput = searchContainer.querySelector("#discoverSearchInput");
    newSearchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = state.users.filter((u) => !u.is_friend && u.username.toLowerCase().includes(term));
      renderDiscoverUsersContent(filtered);
    });
  }
  renderDiscoverUsersContent(usersList);
}

function renderDiscoverUsersContent(usersList) {
  const container = el.discoverUsersList;
  // Remove previous user items but keep search
  const items = container.querySelectorAll(".list-item");
  items.forEach((item) => item.remove());
  
  usersList.forEach((user) => {
    const item = document.createElement("div");
    item.className = "list-item user-item";
    const action = user.request_outgoing
      ? '<button type="button" class="mini-btn state-btn" disabled><i class="fa-solid fa-clock"></i> Отправлено</button>'
      : user.request_incoming
        ? '<button type="button" class="mini-btn state-btn incoming" disabled><i class="fa-solid fa-envelope"></i> Входящая</button>'
        : '<button type="button" class="mini-btn add-friend-btn"><i class="fa-solid fa-user-plus"></i> Добавить</button>';
    item.innerHTML = `
      <img class="avatar" src="${user.avatar_url}" alt="">
      <div class="user-main">
        <div class="user-name">${escapeHtml(getUserLabel(user))}</div>
        <small>${user.is_online ? "online" : "offline"}</small>
      </div>
      ${action}
    `;
    const button = item.querySelector(".mini-btn");
    if (button && !button.disabled) {
      button.onclick = async (e) => {
        e.stopPropagation();
        try {
          await request("/friends/request", {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ target_user_id: user.id }),
          });
          button.disabled = true;
          button.classList.remove("add-friend-btn");
          button.classList.add("state-btn");
          button.innerHTML = '<i class="fa-solid fa-clock"></i> Отправлено';
          await refreshSocialData();
        } catch (err) {
          alert(`Не удалось отправить заявку: ${err.message}`);
        }
      };
    }
    el.discoverUsersList.appendChild(item);
  });
  
  if (!usersList.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.innerHTML = '<span>Новых пользователей пока нет.</span>';
    el.discoverUsersList.appendChild(empty);
  }
  renderParticipants();
  renderGroupMembersPicker();
}

function renderAccountsList() {
  if (!el.accountsList) return;
  el.accountsList.innerHTML = "";
  const accounts = getStoredAccounts();
  if (!accounts.length) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.textContent = "Сохраненных аккаунтов пока нет";
    el.accountsList.appendChild(item);
    return;
  }
  accounts.forEach((acc) => {
    const item = document.createElement("div");
    item.className = "list-item account-item";
    item.innerHTML = `
      <div class="account-meta">
        <img class="avatar" src="${acc.avatar_url || "/static/assets/default-avatar.svg"}" alt="">
        <div class="user-main">
          <div class="user-name">${escapeHtml(acc.username || "Unknown")}</div>
          <small>${acc.token === state.token ? "Текущий аккаунт" : "Нажми, чтобы войти"}</small>
        </div>
      </div>
      <button type="button" class="mini-btn switch-btn">${acc.token === state.token ? "Активен" : "Войти"}</button>
    `;
    const btn = item.querySelector(".switch-btn");
    if (acc.token !== state.token) {
      btn.onclick = async () => {
        await switchAccount(acc.token);
      };
    } else {
      btn.disabled = true;
      btn.classList.add("state-btn");
    }
    el.accountsList.appendChild(item);
  });
}

function renderFriendRequests() {
  el.friendRequestsList.innerHTML = "";
  if (!state.friendRequests.incoming.length && !state.friendRequests.outgoing.length) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.textContent = "Пока нет заявок";
    el.friendRequestsList.appendChild(item);
    return;
  }

  state.friendRequests.incoming.forEach((req) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div style="flex:1">
        <strong>${escapeHtml(req.sender_name)}</strong>
        <small> хочет в друзья</small>
      </div>
      <button class="mini-btn accept">Принять</button>
      <button class="mini-btn decline">Отклонить</button>
    `;
    item.querySelector(".accept").onclick = async () => {
      await request("/friends/respond", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: req.id, action: "accept" }),
      });
      await refreshSocialData();
    };
    item.querySelector(".decline").onclick = async () => {
      await request("/friends/respond", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: req.id, action: "decline" }),
      });
      await refreshSocialData();
    };
    el.friendRequestsList.appendChild(item);
  });

  state.friendRequests.outgoing.forEach((req) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div style="flex:1"><strong>${escapeHtml(req.receiver_name)}</strong><small> запрос отправлен</small></div>`;
    el.friendRequestsList.appendChild(item);
  });
}

function renderParticipants() {
  el.participantsList.innerHTML = "";
  const users = state.users.filter((u) => state.participants.has(u.id));
  users.forEach((u) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span class="status-dot ${u.is_online ? "online" : ""}"></span>
      <img class="avatar" src="${u.avatar_url}" alt="">
      <span>${escapeHtml(u.username)}</span>
    `;
    el.participantsList.appendChild(item);
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderMessage(msg, append = true) {
  if (isHiddenMessage(msg.id)) return;
  const me = msg.user_id === state.user.id;
  const computedStatus = msg.local_failed
    ? "failed"
    : (msg.status || state.messageStatusById[msg.id] || (me ? "sent" : null));
  const item = document.createElement("article");
  item.className = `message ${me ? "me" : ""} ${msg.local_failed ? "failed" : ""}`;
  item.dataset.messageId = msg.id;
  item.dataset.userId = String(msg.user_id);

  let attachmentHtml = "";
  if (msg.attachment_url) {
    if (msg.attachment_type === "image") {
      attachmentHtml = `
        <a class="attachment" href="${msg.attachment_url}" target="_blank">
          <img src="${msg.attachment_url}" alt="${msg.attachment_name || "image"}" />
        </a>
      `;
    } else {
      const ext = getFileExtension(msg.attachment_name);
      const icon = getFileIcon(msg.attachment_name);
      const displayExt = ext ? ` (${ext.toUpperCase()})` : "";
      attachmentHtml = `
        <a class="attachment" href="${msg.attachment_url}" target="_blank" title="${msg.attachment_name || "файл"}">
          <i class="fa-solid ${icon}"></i>
          <span>${escapeHtml(msg.attachment_name || "файл")}${displayExt}</span>
        </a>
      `;
    }
  }

  item.innerHTML = `
    <img class="avatar" src="${msg.avatar_url}" alt="">
    <div class="bubble">
      <div class="meta">
        <strong class="msg-username">${escapeHtml(msg.username)}</strong>
        <span>${formatTime(msg.created_at)}</span>
        ${msg.local_failed ? '<span class="failed-label">не отправлено</span>' : ""}
        ${me && !msg.local_failed ? statusIcon(computedStatus) : ""}
        ${me ? `<button class="delete-btn" title="Удалить"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
      <div>${highlightMessageText(msg.content || "")}</div>
      ${attachmentHtml}
    </div>
  `;

  if (me) {
    item.querySelector(".delete-btn").onclick = async () => {
      openDeleteModal(msg.id);
    };
  }

  if (append) {
    el.messages.appendChild(item);
  } else {
    el.messages.prepend(item);
  }
}

function scrollMessagesToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

function getFileExtension(filename) {
  if (!filename) return "";
  const ext = filename.split(".").pop().toLowerCase();
  return ext === filename ? "" : ext;
}

function getFileIcon(filename) {
  const ext = getFileExtension(filename);
  const iconMap = {
    "pdf": "fa-file-pdf",
    "doc": "fa-file-word",
    "docx": "fa-file-word",
    "xls": "fa-file-excel",
    "xlsx": "fa-file-excel",
    "ppt": "fa-file-powerpoint",
    "pptx": "fa-file-powerpoint",
    "txt": "fa-file-text",
    "zip": "fa-file-zipper",
    "rar": "fa-file-zipper",
    "mp3": "fa-file-audio",
    "wav": "fa-file-audio",
    "mp4": "fa-file-video",
    "avi": "fa-file-video",
  };
  return iconMap[ext] || "fa-file";
}

async function openRoom(roomId) {
  if (state.currentRoomId) {
    state.socket.emit("leave_room", { room_id: state.currentRoomId });
  }
  state.currentRoomId = roomId;
  renderRooms();
  const room = state.rooms.find((r) => r.id === roomId);
  el.chatTitle.textContent = room ? roomDisplayName(room) : "Chat";
  state.currentChatTargetUserId = null;
  if (room?.is_direct) {
    const ids = room.name.replace("dm:", "").split(":").map(Number);
    state.currentChatTargetUserId = ids.find((id) => id !== state.user.id) || null;
    const target = state.users.find((u) => u.id === state.currentChatTargetUserId);
    state.currentChatSettings.is_blocked = Boolean(target?.is_blocked);
    state.currentChatSettings.is_muted = Boolean(target?.is_muted);
    state.currentChatSettings.alias = target?.alias || null;
  }
  el.messages.innerHTML = "";
  state.socket.emit("join_room", { room_id: roomId });

  const messages = await request(`/messages/${roomId}`, { headers: authHeaders() });
  state.messageStatusById = {};
  messages.forEach((m) => {
    if (m?.id && m?.status && m.user_id === state.user.id) {
      state.messageStatusById[m.id] = m.status;
    }
  });
  if (!state.currentChatTargetUserId && room?.is_direct) {
    const other = messages.find((m) => m.user_id !== state.user.id);
    if (other) state.currentChatTargetUserId = other.user_id;
  }
  messages.forEach((m) => renderMessage(m));
  scrollMessagesToBottom();
  const lastIncoming = [...messages].reverse().find((m) => m.user_id !== state.user.id);
  if (lastIncoming) {
    state.socket.emit("messages_read", { room_id: roomId, message_id: lastIncoming.id });
  }
}

async function searchMessages() {
  if (!state.currentRoomId) return;
  const q = el.searchMessagesInput.value.trim();
  if (!q) {
    state.searchTerm = "";
    await openRoom(state.currentRoomId);
    return;
  }
  try {
    state.searchTerm = q;
    const messages = await request(`/messages/${state.currentRoomId}/search?q=${encodeURIComponent(q)}`, {
      headers: authHeaders(),
    });
    el.messages.innerHTML = "";
    messages.forEach((m) => renderMessage(m));
    scrollMessagesToBottom();
  } catch (e) {
    alert(`Поиск не выполнен: ${e.message}`);
  }
}

async function createRoom() {
  const name = prompt("Название новой комнаты:");
  if (!name) return;
  try {
    const room = await request("/rooms", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    state.rooms.push(room);
    renderRooms();
    await openRoom(room.id);
  } catch (e) {
    alert(e.message);
  }
}

async function createDirect(targetUserId) {
  if (!state.user || targetUserId === state.user.id) return;
  const room = await request("/rooms/direct", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ target_user_id: targetUserId }),
  });

  const exists = state.rooms.some((r) => r.id === room.id);
  if (!exists) state.rooms.push(room);
  state.currentChatTargetUserId = targetUserId;
  renderRooms();
  await openRoom(room.id);
}

async function uploadAttachment(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/upload", {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

async function sendMessage() {
  if (!state.currentRoomId) return;
  const content = el.messageInput.value.trim();
  if (!content && !state.pendingAttachment) return;

  if (state.currentChatTargetUserId && state.currentChatSettings.is_blocked) {
    renderMessage({
      id: `local-failed-${Date.now()}`,
      user_id: state.user.id,
      username: state.user.username,
      avatar_url: state.user.avatar_url,
      content,
      attachment_name: state.pendingAttachment?.attachment_name || null,
      attachment_url: state.pendingAttachment?.attachment_url || null,
      attachment_type: state.pendingAttachment?.attachment_type || null,
      created_at: new Date().toISOString(),
      local_failed: true,
    });
    scrollMessagesToBottom();
    el.messageInput.value = "";
    state.pendingAttachment = null;
    return;
  }

  state.socket.emit("new_message", {
    room_id: state.currentRoomId,
    content,
    attachment_name: state.pendingAttachment?.attachment_name,
    attachment_url: state.pendingAttachment?.attachment_url,
    attachment_type: state.pendingAttachment?.attachment_type,
  });
  state.pendingAttachment = null;
  el.messageInput.value = "";
  state.socket.emit("typing", { room_id: state.currentRoomId, is_typing: false });
  touchActivity();
}

async function deleteMessage(messageId) {
  try {
    await request(`/messages/${messageId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const node = el.messages.querySelector(`[data-message-id="${messageId}"]`);
    if (node) node.remove();
  } catch (e) {
    alert(e.message);
  }
}

function openDeleteModal(messageId) {
  if (!el.deleteConfirmModal) return;
  el.deleteConfirmModal.classList.remove("hidden");
  el.deleteForMeBtn.onclick = () => {
    hideMessageForMe(messageId);
    const node = el.messages.querySelector(`[data-message-id="${messageId}"]`);
    if (node) node.remove();
    closeDeleteModal();
  };
  el.deleteForAllBtn.onclick = async () => {
    await deleteMessage(messageId);
    closeDeleteModal();
  };
  el.deleteCancelBtn.onclick = () => closeDeleteModal();
}

function closeDeleteModal() {
  el.deleteConfirmModal?.classList.add("hidden");
}

function initSocket() {
  state.socket = io("/", {
    auth: { token: state.token },
    transports: ["websocket", "polling"],
  });

  state.socket.on("new_message", (msg) => {
    touchActivity();
    if (msg.room_id !== state.currentRoomId) {
      if (!state.pageFocused) {
        document.title = "DrOidgram • New message";
      }
      el.notifySound.play().catch(() => {});
      return;
    }
    if (msg.user_id === state.user.id) {
      state.messageStatusById[msg.id] = "sent";
    } else {
      state.socket.emit("messages_read", { room_id: msg.room_id, message_id: msg.id });
    }
    renderMessage(msg);
    scrollMessagesToBottom();
  });

  state.socket.on("messages_read_update", ({ room_id, message_ids }) => {
    if (room_id !== state.currentRoomId) return;
    (message_ids || []).forEach((message_id) => {
      state.messageStatusById[message_id] = "read";
      const node = el.messages.querySelector(`[data-message-id="${message_id}"]`);
      if (!node) return;
      const statusNode = node.querySelector(".msg-status");
      if (statusNode) {
        statusNode.className = "msg-status read";
        statusNode.textContent = "✓✓";
      }
    });
  });

  state.socket.on("typing", ({ room_id, username, is_typing }) => {
    if (room_id !== state.currentRoomId) return;
    el.typingLabel.textContent = is_typing ? `${escapeHtml(username)} печатает...` : "";
  });

  state.socket.on("user_online", ({ user_id }) => {
    const u = state.users.find((x) => x.id === user_id);
    if (u) u.is_online = true;
    renderUsers();
  });

  state.socket.on("user_offline", ({ user_id }) => {
    const u = state.users.find((x) => x.id === user_id);
    if (u) u.is_online = false;
    renderUsers();
  });

  state.socket.on("room_participants", ({ room_id, user_ids }) => {
    if (room_id !== state.currentRoomId) return;
    state.participants = new Set(user_ids);
    renderParticipants();
  });

  state.socket.on("profile_updated", ({ user_id, username, avatar_url }) => {
    if (!user_id) return;
    const known = state.users.find((u) => u.id === user_id);
    if (known) {
      known.username = username || known.username;
      known.avatar_url = avatar_url || known.avatar_url;
    }
    if (state.user && state.user.id === user_id) {
      state.user.username = username || state.user.username;
      state.user.avatar_url = avatar_url || state.user.avatar_url;
      el.currentUserLabel.textContent = `@${state.user.username}`;
      upsertCurrentAccount();
    }
    const affected = el.messages.querySelectorAll(`.message[data-user-id="${user_id}"]`);
    affected.forEach((node) => {
      const avatar = node.querySelector(".avatar");
      const uname = node.querySelector(".msg-username");
      if (avatar && avatar_url) avatar.src = avatar_url;
      if (uname && username) uname.textContent = username;
    });
    renderUsers();
    renderAccountsList();
  });

  state.socket.on("account_blocked", ({ reason }) => {
    alert(reason || "Аккаунт заблокирован системой безопасности");
    logout();
  });

  state.socket.on("call_offer", async ({ room_id, offer, from_user_id, call_type }) => {
    const caller = state.users.find((u) => u.id === from_user_id);
    state.incomingCall = { room_id, offer, from_user_id, call_type };
    state.currentCallPeerId = from_user_id;
    if (room_id !== state.currentRoomId) {
      const room = state.rooms.find((r) => r.id === room_id);
      if (room) await openRoom(room_id);
      else {
        await loadRooms();
        await openRoom(room_id);
      }
    }
    state.currentCallType = call_type;
    state.currentChatTargetUserId = from_user_id;
    const callerName = getUserLabel(caller);
    el.callTitle.textContent = call_type === "video" ? "Входящий видеозвонок" : "Входящий аудиозвонок";
    el.callModal.classList.remove("hidden");
    toggleIncomingButtons(true);
    el.callStatus.textContent = `${callerName} звонит...`;
    document.querySelector(".call-grid")?.classList.toggle("audio-only", call_type !== "video");
  });

  state.socket.on("call_answer", async ({ room_id, answer }) => {
    if (room_id !== state.currentRoomId || !state.peerConnection) return;
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    el.callStatus.textContent = "Ответ получен, подключаем...";
  });

  state.socket.on("call_ice_candidate", async ({ room_id, candidate, from_user_id }) => {
    if (room_id !== state.currentRoomId || !state.peerConnection) return;
    if (!state.currentChatTargetUserId) state.currentChatTargetUserId = from_user_id || null;
    if (!state.currentCallPeerId) state.currentCallPeerId = from_user_id || null;
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  });

  state.socket.on("call_end", ({ room_id }) => {
    if (room_id !== state.currentRoomId) return;
    closeCallModal(false);
  });
}

async function openSettings() {
  try {
    const settings = await request("/settings", { headers: authHeaders() });
    const twofa = await request("/2fa/status", { headers: authHeaders() });
    el.settingsUsernameInput.value = settings.username;
    el.settingsAvatar.src = settings.avatar_url;
    el.twofaSecret.textContent = twofa.enabled ? "2FA включена" : "2FA выключена";
    el.settingsError.textContent = "";
    renderAccountsList();
    el.settingsModal.classList.remove("hidden");
  } catch (e) {
    alert(e.message);
  }
}

function closeSettings() {
  el.settingsModal.classList.add("hidden");
}

async function openChatSettings() {
  if (!state.currentChatTargetUserId) {
    el.chatSettingsError.textContent = "Настройки доступны только в личном чате";
    el.chatSettingsModal.classList.remove("hidden");
    return;
  }
  try {
    const settings = await request(`/chats/${state.currentChatTargetUserId}/settings`, { headers: authHeaders() });
    state.currentChatSettings = settings;
    el.chatAliasInput.value = settings.alias || "";
    el.muteUserBtn.textContent = settings.is_muted ? "Включить звук" : "Заглушить";
    el.blockUserBtn.textContent = settings.is_blocked ? "Разблокировать" : "Заблокировать";
    el.chatSettingsError.textContent = "";
    el.chatSettingsModal.classList.remove("hidden");
  } catch (e) {
    alert(e.message);
  }
}

function closeChatSettings() {
  el.chatSettingsModal.classList.add("hidden");
}

async function saveChatSettings() {
  if (!state.currentChatTargetUserId) return;
  try {
    const updated = await request(`/chats/${state.currentChatTargetUserId}/settings`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        alias: el.chatAliasInput.value.trim(),
        is_muted: state.currentChatSettings.is_muted,
        is_blocked: state.currentChatSettings.is_blocked,
      }),
    });
    state.currentChatSettings = updated;
    await loadUsers();
    await loadRooms();
    if (state.currentRoomId) await openRoom(state.currentRoomId);
    el.chatSettingsError.textContent = "Настройки сохранены";
    alert("Настройки чата сохранены");
  } catch (e) {
    el.chatSettingsError.textContent = e.message;
    alert(`Не удалось сохранить: ${e.message}`);
  }
}

async function toggleMuteUser() {
  if (!state.currentChatTargetUserId) {
    alert("Открой личный чат с пользователем");
    return;
  }
  state.currentChatSettings.is_muted = !state.currentChatSettings.is_muted;
  await saveChatSettings();
}

async function toggleBlockUser() {
  if (!state.currentChatTargetUserId) {
    alert("Открой личный чат с пользователем");
    return;
  }
  state.currentChatSettings.is_blocked = !state.currentChatSettings.is_blocked;
  await saveChatSettings();
}

async function clearCurrentChat() {
  if (!state.currentRoomId) return;
  if (!confirm("Очистить сообщения в этом чате?")) return;
  try {
    await request(`/rooms/${state.currentRoomId}/clear`, { method: "POST", headers: authHeaders() });
    el.messages.innerHTML = "";
    el.chatSettingsError.textContent = "Чат очищен";
  } catch (e) {
    el.chatSettingsError.textContent = e.message;
  }
}

function closeCallModal(notifyPeer = true) {
  el.callModal.classList.add("hidden");
  el.callStatus.textContent = "";
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  state.remoteStream = null;
  state.currentCallPeerId = null;
  state.incomingCall = null;
  toggleIncomingButtons(false);
  el.localVideo.srcObject = null;
  el.remoteVideo.srcObject = null;
  document.querySelector(".call-grid")?.classList.remove("audio-only");
  if (notifyPeer && state.currentRoomId && state.socket && state.currentChatTargetUserId) {
    state.socket.emit("call_end", { room_id: state.currentRoomId, target_user_id: state.currentChatTargetUserId });
  }
}

function createPeerConnection() {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:stun.stunprotocol.org:3478" },
      { urls: "stun:stun.voipbuster.com:3478" },
    ],
  });
  pc.onicecandidate = (event) => {
    if (event.candidate && state.currentRoomId && state.currentCallPeerId) {
      state.socket.emit("call_ice_candidate", {
        room_id: state.currentRoomId,
        candidate: event.candidate,
        target_user_id: state.currentCallPeerId,
      });
    }
  };
  pc.ontrack = (event) => {
    if (!state.remoteStream) {
      state.remoteStream = new MediaStream();
      el.remoteVideo.srcObject = state.remoteStream;
    }
    state.remoteStream.addTrack(event.track);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      el.callStatus.textContent = "Соединение установлено";
    } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      el.callStatus.textContent = "Проблема соединения";
    }
  };
  state.peerConnection = pc;
  return pc;
}

async function startCall(callType) {
  if (!state.currentRoomId || !state.currentChatTargetUserId) return;
  state.currentCallPeerId = state.currentChatTargetUserId;
  state.currentCallType = callType;
  el.callTitle.textContent = callType === "video" ? "Видеозвонок" : "Аудиозвонок";
  el.callModal.classList.remove("hidden");
  toggleIncomingButtons(false);
  el.callStatus.textContent = "Инициализация звонка...";
  document.querySelector(".call-grid")?.classList.toggle("audio-only", callType !== "video");
  const constraints = callType === "video" ? { audio: true, video: true } : { audio: true, video: false };
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    el.callStatus.textContent = `Доступ к устройствам отклонен: ${e.message}`;
    return;
  }
  el.localVideo.srcObject = state.localStream;
  const pc = createPeerConnection();
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit("call_offer", {
    room_id: state.currentRoomId,
    offer,
    call_type: callType,
    target_user_id: state.currentChatTargetUserId,
  });
  el.callStatus.textContent = "Ожидание ответа...";
}

async function acceptIncomingCall() {
  const incoming = state.incomingCall;
  if (!incoming) return;
  const { room_id, offer, from_user_id, call_type } = incoming;
  toggleIncomingButtons(false);
  const constraints = call_type === "video" ? { audio: true, video: true } : { audio: true, video: false };
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    el.callStatus.textContent = `Нет доступа к камере/микрофону: ${e.message}`;
    state.socket.emit("call_end", { room_id, target_user_id: from_user_id });
    return;
  }
  el.localVideo.srcObject = state.localStream;
  const pc = createPeerConnection();
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.socket.emit("call_answer", { room_id, answer, target_user_id: from_user_id });
  el.callStatus.textContent = "Соединение...";
}

function rejectIncomingCall() {
  const incoming = state.incomingCall;
  if (incoming) {
    state.socket.emit("call_end", { room_id: incoming.room_id, target_user_id: incoming.from_user_id });
  }
  closeCallModal(false);
}

function openCreateGroup() {
  state.selectedGroupMembers = new Set();
  el.groupNameInput.value = "";
  el.groupError.textContent = "";
  renderGroupMembersPicker();
  el.createGroupModal.classList.remove("hidden");
}

function closeCreateGroup() {
  el.createGroupModal.classList.add("hidden");
}

function renderGroupMembersPicker() {
  if (!el.groupMembersList) return;
  el.groupMembersList.innerHTML = "";
  const friends = state.users.filter((u) => u.is_friend);
  if (!friends.length) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.textContent = "Сначала добавьте друзей";
    el.groupMembersList.appendChild(item);
    return;
  }
  friends.forEach((friend) => {
    const item = document.createElement("div");
    item.className = "list-item";
    const selected = state.selectedGroupMembers.has(friend.id);
    item.innerHTML = `
      <img class="avatar" src="${friend.avatar_url}" alt="">
      <div style="flex:1">${escapeHtml(friend.username)}</div>
      <button class="mini-btn">${selected ? "Убрать" : "+ Добавить"}</button>
    `;
    item.querySelector(".mini-btn").onclick = () => {
      if (state.selectedGroupMembers.has(friend.id)) {
        state.selectedGroupMembers.delete(friend.id);
      } else {
        state.selectedGroupMembers.add(friend.id);
      }
      renderGroupMembersPicker();
    };
    el.groupMembersList.appendChild(item);
  });
}

async function createGroupRoom() {
  const name = el.groupNameInput.value.trim();
  if (!name) {
    el.groupError.textContent = "Введите название группы";
    return;
  }
  try {
    const room = await request("/rooms/group", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, member_ids: Array.from(state.selectedGroupMembers) }),
    });
    closeCreateGroup();
    await loadRooms();
    await openRoom(room.id);
  } catch (e) {
    el.groupError.textContent = e.message;
  }
}

async function refreshSocialData() {
  // Keep app alive even if optional social endpoints temporarily fail.
  try {
    await loadFriendRequests();
  } catch (e) {
    if (e.status === 401) throw e;
  }
  await loadUsers();
}

async function uploadAvatar(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/settings/avatar", {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || "Avatar upload failed");
  }
  return res.json();
}

async function saveSettings() {
  try {
    const updated = await request("/settings", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: el.settingsUsernameInput.value.trim() }),
    });
    state.user.username = updated.username;
    state.user.avatar_url = updated.avatar_url;
    el.currentUserLabel.textContent = `@${updated.username}`;
    upsertCurrentAccount();
    await loadUsers();
    await loadRooms();
    if (state.socket) state.socket.emit("profile_updated", {});
    el.settingsError.textContent = "Сохранено";
    touchActivity();
  } catch (e) {
    el.settingsError.textContent = e.message;
  }
}

async function setup2FA() {
  try {
    const data = await request("/2fa/setup", { method: "POST", headers: authHeaders() });
    el.twofaSecret.textContent = `Секрет: ${data.secret} | Добавь аккаунт вручную в Authenticator`;
  } catch (e) {
    el.twofaSecret.textContent = e.message;
  }
}

async function enable2FA() {
  try {
    const otp = (el.twofaCodeInput.value || "").trim();
    await request("/2fa/enable", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    el.twofaSecret.textContent = "2FA включена";
  } catch (e) {
    el.twofaSecret.textContent = e.message;
  }
}

async function disable2FA() {
  try {
    const otp = (el.twofaCodeInput.value || "").trim();
    await request("/2fa/disable", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    el.twofaSecret.textContent = "2FA выключена";
  } catch (e) {
    el.twofaSecret.textContent = e.message;
  }
}

async function addUserToCurrentRoom() {
  const room = state.rooms.find((r) => r.id === state.currentRoomId);
  if (!room || !room.is_private || room.is_direct) {
    alert("Добавление доступно только в приватной группе");
    return;
  }
  const username = prompt("Введите username друга для добавления:");
  if (!username) return;
  const target = state.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!target) {
    alert("Пользователь не найден среди ваших друзей/контактов");
    return;
  }
  try {
    await request(`/rooms/${state.currentRoomId}/members`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ target_user_id: target.id }),
    });
    alert("Пользователь добавлен в комнату");
    state.socket.emit("join_room", { room_id: state.currentRoomId });
  } catch (e) {
    alert(e.message);
  }
}

function logout() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  setActiveToken("");
  localStorage.removeItem("lastUsedAt");
  state.token = "";
  state.user = null;
  state.rooms = [];
  state.users = [];
  state.currentRoomId = null;
  el.app.classList.add("hidden");
  el.authModal.classList.remove("hidden");
  closeSettings();
}

function logoutToAddAccount() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  state.token = "";
  state.user = null;
  state.rooms = [];
  state.users = [];
  state.currentRoomId = null;
  setActiveToken("");
  closeSettings();
  el.app.classList.add("hidden");
  el.authModal.classList.remove("hidden");
  el.authError.textContent = "Войдите в другой аккаунт или зарегистрируйтесь";
}

async function switchAccount(token) {
  if (!token) return;
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  setActiveToken(token);
  state.token = token;
  state.rooms = [];
  state.users = [];
  state.currentRoomId = null;
  closeSettings();
  try {
    await bootstrap();
    touchActivity();
  } catch (e) {
    if (e.status === 401) {
      const accounts = getStoredAccounts().filter((acc) => acc.token !== token);
      saveStoredAccounts(accounts);
      setActiveToken("");
      state.token = "";
      el.authModal.classList.remove("hidden");
      el.app.classList.add("hidden");
    } else {
      alert(`Не удалось переключить аккаунт: ${e.message}`);
    }
  }
}

function bindEvents() {
  el.registerBtn.onclick = () => auth("register");
  el.loginBtn.onclick = () => auth("login");
  el.sendBtn.onclick = () => sendMessage();
  el.createRoomBtn.onclick = () => createRoom();
  el.createRoomBtn.oncontextmenu = (e) => {
    e.preventDefault();
    openCreateGroup();
  };
  el.createRoomBtn.title = "ЛКМ: канал, ПКМ: приватная группа";
  el.settingsBtn.onclick = () => openSettings();
  el.attachBtn.onclick = () => el.fileInput.click();
  el.searchMessagesBtn.onclick = () => searchMessages();
  el.searchMessagesInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchMessages();
  });
  el.chatSettingsBtn.onclick = () => openChatSettings();
  if (el.addRoomMemberBtn) el.addRoomMemberBtn.onclick = () => addUserToCurrentRoom();
  el.closeChatSettingsBtn.onclick = () => closeChatSettings();
  el.saveChatSettingsBtn.onclick = () => saveChatSettings();
  el.muteUserBtn.onclick = () => toggleMuteUser();
  el.blockUserBtn.onclick = () => toggleBlockUser();
  el.clearChatBtn.onclick = () => clearCurrentChat();
  el.voiceCallBtn.onclick = () => startCall("audio");
  el.videoCallBtn.onclick = () => startCall("video");
  el.endCallBtn.onclick = () => closeCallModal();
  if (el.acceptCallBtn) el.acceptCallBtn.onclick = () => acceptIncomingCall();
  if (el.rejectCallBtn) el.rejectCallBtn.onclick = () => rejectIncomingCall();

  el.participantsBtn.onclick = () => {
    el.participantsPanel.classList.toggle("hidden");
  };

  el.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }
    if (state.currentRoomId) {
      state.socket.emit("typing", { room_id: state.currentRoomId, is_typing: true });
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        state.socket.emit("typing", { room_id: state.currentRoomId, is_typing: false });
      }, 900);
    }
  });

  el.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state.pendingAttachment = await uploadAttachment(file);
      alert(`Файл прикреплен: ${state.pendingAttachment.attachment_name}`);
    } catch (err) {
      alert(err.message);
    }
    el.fileInput.value = "";
  });

  window.addEventListener("focus", () => {
    state.pageFocused = true;
    document.title = "DrOidgram";
  });
  window.addEventListener("blur", () => {
    state.pageFocused = false;
  });

  el.themeToggle.onclick = () => {
    const current = document.body.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  };

  el.closeSettingsBtn.onclick = () => closeSettings();
  el.saveSettingsBtn.onclick = () => saveSettings();
  if (el.setup2faBtn) el.setup2faBtn.onclick = () => setup2FA();
  if (el.enable2faBtn) el.enable2faBtn.onclick = () => enable2FA();
  if (el.disable2faBtn) el.disable2faBtn.onclick = () => disable2FA();
  el.addAccountBtn.onclick = () => logoutToAddAccount();
  el.logoutBtn.onclick = () => logout();
  el.avatarInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await uploadAvatar(file);
      el.settingsAvatar.src = data.avatar_url;
      state.user.avatar_url = data.avatar_url;
      upsertCurrentAccount();
      if (state.socket) state.socket.emit("profile_updated", {});
      el.settingsError.textContent = "Аватар обновлен";
      await loadUsers();
      touchActivity();
    } catch (err) {
      el.settingsError.textContent = err.message;
    }
    el.avatarInput.value = "";
  });
  el.closeGroupBtn.onclick = () => closeCreateGroup();
  el.createGroupConfirmBtn.onclick = () => createGroupRoom();
}

async function bootstrap() {
  el.authModal.classList.add("hidden");
  el.app.classList.remove("hidden");
  await loadMe();
  await refreshSocialData();
  await loadRooms();
  if (!state.socket) {
    initSocket();
  }

  const general = state.rooms.find((r) => r.name === "general");
  if (general) {
    await openRoom(general.id);
  } else if (state.rooms[0]) {
    await openRoom(state.rooms[0].id);
  }
  upsertCurrentAccount();
}

async function init() {
  initTheme();
  bindEvents();
  const legacyToken = localStorage.getItem("token");
  if (!state.token && legacyToken) {
    state.token = legacyToken;
    setActiveToken(legacyToken);
    localStorage.removeItem("token");
  }
  const lastUsed = Number(localStorage.getItem("lastUsedAt") || "0");
  if (lastUsed && Date.now() - lastUsed > MAX_IDLE_MS) {
    setActiveToken("");
    localStorage.removeItem("lastUsedAt");
    state.token = "";
  }
  if (!state.token) return;
  try {
    await bootstrap();
    touchActivity();
  } catch (e) {
    // Logout only when token is truly invalid/expired.
    if (e.status === 401) {
      setActiveToken("");
      localStorage.removeItem("lastUsedAt");
      state.token = "";
      el.authModal.classList.remove("hidden");
      el.app.classList.add("hidden");
    } else {
      // Keep user logged in; show current app state and allow retry actions.
      console.error("Bootstrap warning:", e);
      el.authModal.classList.add("hidden");
      el.app.classList.remove("hidden");
    }
  }
}

setInterval(async () => {
  if (!state.token || document.hidden) return;
  try {
    await refreshSocialData();
  } catch {
    // silent background refresh
  }
}, 8000);

init();
