// ================= TRẠNG THÁI ỨNG DỤNG =================
let socket = null;
let currentUser = "";
let currentMode = "room";   // "room" hoặc "private"
let currentTarget = "General";
let typingTimer = null;
let lastTypingSent = 0;

const unreadTargets = new Set();
let cachedRooms = ["General", "LapTrinhMang", "GiaiTri"];
let cachedUsers = [];
let searchFilter = "";

const AVATAR_COLORS = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae"];

// ================= LẤY PHẦN TỬ DOM =================
const loginOverlay = document.getElementById("login-overlay");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const appContainer = document.getElementById("app-container");

const myAvatarEl = document.getElementById("my-avatar");
const currentUserLabel = document.getElementById("current-user-label");
const searchInput = document.getElementById("search-input");

const roomListEl = document.getElementById("room-list");
const userListEl = document.getElementById("user-list");
const onlineCountEl = document.getElementById("online-count");
const createRoomBtn = document.getElementById("create-room-btn");

const headerAvatarEl = document.getElementById("header-avatar");
const chatTitleEl = document.getElementById("chat-title");
const chatSubtitleEl = document.getElementById("chat-subtitle");
const messagesBox = document.getElementById("messages-box");
const typingIndicator = document.getElementById("typing-indicator");

const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
const emojiBar = document.getElementById("emoji-bar");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");

// ================= TIỆN ÍCH AVATAR =================
function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

function applyAvatarStyle(el, label, isRoom = false) {
    el.textContent = isRoom ? "#" : getInitials(label);
    el.style.backgroundColor = isRoom ? "#3390ec" : getAvatarColor(label);
}

// ================= 1. ĐĂNG NHẬP & KẾT NỐI WEBSOCKET =================
function connectAndLogin() {
    const name = usernameInput.value.trim();
    if (!name) {
        loginError.textContent = "Vui lòng nhập tên hiển thị!";
        return;
    }

    loginError.textContent = "Đang kết nối...";
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

    socket.onopen = () => {
        sendPacket({ Type: "LOGIN", Sender: name });
    };

    socket.onmessage = (event) => {
        const raw = JSON.parse(event.data);
        handleIncomingPacket(normalizePacket(raw));
    };

    socket.onclose = () => {
        if (!appContainer.classList.contains("hidden")) {
            alert("Mất kết nối với Server! Vui lòng tải lại trang.");
        }
    };
}

loginBtn.addEventListener("click", connectAndLogin);
usernameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") connectAndLogin();
});

function normalizePacket(p) {
    return {
        type: p.Type ?? p.type,
        sender: p.Sender ?? p.sender,
        room: p.Room ?? p.room,
        receiver: p.Receiver ?? p.receiver,
        content: p.Content ?? p.content,
        fileName: p.FileName ?? p.fileName,
        timestamp: p.Timestamp ?? p.timestamp,
        onlineUsers: p.OnlineUsers ?? p.onlineUsers,
        rooms: p.Rooms ?? p.rooms
    };
}

function sendPacket(packet) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(packet));
    }
}

// ================= 2. XỬ LÝ GÓI TIN NHẬN TỪ SERVER =================
async function handleIncomingPacket(pkt) {
    switch (pkt.type) {
        case "ERROR":
            loginError.textContent = pkt.content;
            if (socket) socket.close();
            break;

        case "USER_LIST":
            if (!loginOverlay.classList.contains("hidden")) {
                currentUser = usernameInput.value.trim();
                currentUserLabel.textContent = currentUser;
                applyAvatarStyle(myAvatarEl, currentUser, false);
                loginOverlay.classList.add("hidden");
                appContainer.classList.remove("hidden");
                await switchConversation("room", "General");
            }
            if (pkt.rooms) cachedRooms = pkt.rooms;
            if (pkt.onlineUsers) cachedUsers = pkt.onlineUsers;
            renderSidebar();
            break;

        case "CHAT_GROUP":
            if (currentMode === "room" && currentTarget === pkt.room) {
                appendMessage(pkt);
                typingIndicator.textContent = "";
            } else {
                unreadTargets.add(`room:${pkt.room}`);
                renderSidebar();
            }
            break;

        case "CHAT_PRIVATE":
            const partner = pkt.sender === currentUser ? pkt.receiver : pkt.sender;
            if (currentMode === "private" && currentTarget === partner) {
                appendMessage(pkt);
                typingIndicator.textContent = "";
            } else {
                unreadTargets.add(`private:${partner}`);
                renderSidebar();
            }
            break;

        case "TYPING":
            const isMatchRoom = !pkt.receiver && currentMode === "room" && currentTarget === pkt.room;
            const isMatchPrivate = pkt.receiver === currentUser && currentMode === "private" && currentTarget === pkt.sender;
            if (isMatchRoom || isMatchPrivate) {
                typingIndicator.textContent = `${pkt.sender} đang nhập...`;
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    typingIndicator.textContent = "";
                }, 2500);
            }
            break;
    }
}

// ================= 3. CHUYỂN CUỘC TRÒ CHUYỆN & TẢI LỊCH SỬ =================
async function switchConversation(mode, target) {
    currentMode = mode;
    currentTarget = target;
    unreadTargets.delete(`${mode}:${target}`);
    typingIndicator.textContent = "";

    chatTitleEl.textContent = target;
    if (mode === "room") {
        chatSubtitleEl.textContent = "Phòng chat nhóm";
        applyAvatarStyle(headerAvatarEl, target, true);
        sendPacket({ Type: "JOIN_ROOM", Sender: currentUser, Room: target });
    } else {
        chatSubtitleEl.textContent = "Trò chuyện trực tiếp";
        applyAvatarStyle(headerAvatarEl, target, false);
    }

    renderSidebar();
    messagesBox.innerHTML = "";

    const url = `/api/history?mode=${encodeURIComponent(mode)}&target=${encodeURIComponent(target)}&user=${encodeURIComponent(currentUser)}`;
    const res = await fetch(url);
    if (res.ok) {
        const history = await res.json();
        history.forEach(item => appendMessage(normalizePacket(item)));
    }
}

createRoomBtn.addEventListener("click", () => {
    const roomName = prompt("Nhập tên phòng chat mới:");
    if (roomName && roomName.trim()) {
        switchConversation("room", roomName.trim());
    }
});

searchInput.addEventListener("input", () => {
    searchFilter = searchInput.value.trim().toLowerCase();
    renderSidebar();
});

// ================= 4. EMOJI, GỬI TIN NHẮN & UPLOAD FILE =================
emojiToggleBtn.addEventListener("click", () => {
    emojiBar.classList.toggle("hidden");
});

document.querySelectorAll(".emoji-item").forEach(item => {
    item.addEventListener("click", () => {
        messageInput.value += item.textContent;
        messageInput.focus();
    });
});

chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    if (currentMode === "room") {
        sendPacket({
            Type: "CHAT_GROUP",
            Sender: currentUser,
            Room: currentTarget,
            Content: text
        });
    } else {
        sendPacket({
            Type: "CHAT_PRIVATE",
            Sender: currentUser,
            Receiver: currentTarget,
            Content: text
        });
    }

    messageInput.value = "";
    emojiBar.classList.add("hidden");
});

messageInput.addEventListener("input", () => {
    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;

    sendPacket({
        Type: "TYPING",
        Sender: currentUser,
        Room: currentMode === "room" ? currentTarget : "",
        Receiver: currentMode === "private" ? currentTarget : null
    });
});

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
            alert("Lỗi tải tệp lên Server!");
            return;
        }
        const data = await res.json();

        sendPacket({
            Type: currentMode === "room" ? "CHAT_GROUP" : "CHAT_PRIVATE",
            Sender: currentUser,
            Room: currentMode === "room" ? currentTarget : "General",
            Receiver: currentMode === "private" ? currentTarget : null,
            Content: data.url,
            FileName: data.fileName
        });
    } finally {
        fileInput.value = "";
    }
});

// ================= 5. VẼ SIDEBAR & BONG BÓNG TIN NHẮN =================
function renderSidebar() {
    roomListEl.innerHTML = "";
    const filteredRooms = cachedRooms.filter(r => r.toLowerCase().includes(searchFilter));

    filteredRooms.forEach(room => {
        const li = document.createElement("li");
        const isActive = currentMode === "room" && currentTarget === room;
        li.className = `chat-item ${isActive ? "active" : ""}`;

        const hasUnread = unreadTargets.has(`room:${room}`);
        const badgeHtml = hasUnread ? '<span class="unread-badge">Mới</span>' : "";

        li.innerHTML = `
            <div class="chat-item-left">
                <div class="avatar avatar-sm" style="background:#3390ec">#</div>
                <span class="chat-item-title">${escapeHtml(room)}</span>
            </div>
            ${badgeHtml}
        `;
        li.onclick = () => switchConversation("room", room);
        roomListEl.appendChild(li);
    });

    const others = cachedUsers.filter(u => u !== currentUser && u.toLowerCase().includes(searchFilter));
    onlineCountEl.textContent = cachedUsers.length;
    userListEl.innerHTML = "";

    others.forEach(user => {
        const li = document.createElement("li");
        const isActive = currentMode === "private" && currentTarget === user;
        li.className = `chat-item ${isActive ? "active" : ""}`;

        const hasUnread = unreadTargets.has(`private:${user}`);
        const badgeHtml = hasUnread ? '<span class="unread-badge">Mới</span>' : "";

        li.innerHTML = `
            <div class="chat-item-left">
                <div class="avatar avatar-sm" style="background:${getAvatarColor(user)}">${escapeHtml(getInitials(user))}</div>
                <span class="chat-item-title">${escapeHtml(user)}</span>
            </div>
            ${badgeHtml}
        `;
        li.onclick = () => switchConversation("private", user);
        userListEl.appendChild(li);
    });
}

function appendMessage(pkt) {
    const isMine = pkt.sender === currentUser;
    const row = document.createElement("div");
    row.className = `msg-row ${isMine ? "mine" : "other"}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const senderEl = document.createElement("span");
    senderEl.className = "msg-sender";
    senderEl.style.color = getAvatarColor(pkt.sender || "User");
    senderEl.textContent = pkt.sender;
    bubble.appendChild(senderEl);

    if (pkt.fileName) {
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(pkt.fileName);
        if (isImg) {
            const img = document.createElement("img");
            img.src = pkt.content;
            img.alt = pkt.fileName;
            bubble.appendChild(img);
        } else {
            const link = document.createElement("a");
            link.className = "file-link";
            link.href = pkt.content;
            link.download = pkt.fileName;
            link.textContent = `📎 ${pkt.fileName}`;
            bubble.appendChild(link);
        }
    } else {
        const textNode = document.createElement("span");
        textNode.textContent = pkt.content;
        bubble.appendChild(textNode);
    }

    const timeEl = document.createElement("span");
    timeEl.className = "msg-time";
    timeEl.textContent = pkt.timestamp || "";
    bubble.appendChild(timeEl);

    row.appendChild(bubble);
    messagesBox.appendChild(row);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}