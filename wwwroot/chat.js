// ================= TRẠNG THÁI ỨNG DỤNG =================
let socket = null;
let currentUser = "";
let currentMode = "room";   // "room" (chat nhóm) hoặc "private" (chat 1-1)
let currentTarget = "General";
let typingTimer = null;
let lastTypingSent = 0;

const unreadTargets = new Set(); // Lưu các phòng hoặc người nhắn riêng có tin chưa đọc
let cachedRooms = ["General", "LapTrinhMang", "GiaiTri"];
let cachedUsers = [];

// ================= LẤY PHẦN TỬ DOM =================
const loginOverlay = document.getElementById("login-overlay");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const appContainer = document.getElementById("app-container");
const currentUserLabel = document.getElementById("current-user-label");

const roomListEl = document.getElementById("room-list");
const userListEl = document.getElementById("user-list");
const onlineCountEl = document.getElementById("online-count");
const createRoomBtn = document.getElementById("create-room-btn");

const chatTitleEl = document.getElementById("chat-title");
const chatSubtitleEl = document.getElementById("chat-subtitle");
const messagesBox = document.getElementById("messages-box");
const typingIndicator = document.getElementById("typing-indicator");

const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");

// ================= 1. ĐĂNG NHẬP & KẾT NỐI WEBSOCKET =================
function connectAndLogin() {
    const name = usernameInput.value.trim();
    if (!name) {
        loginError.textContent = "Vui lòng nhập tên hiển thị!";
        return;
    }

    loginError.textContent = "Đang kết nối tới Server...";
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

    socket.onopen = () => {
        // Gửi gói tin LOGIN ngay khi mở kết nối WebSocket thành công
        sendPacket({ Type: "LOGIN", Sender: name });
    };

    socket.onmessage = (event) => {
        const raw = JSON.parse(event.data);
        const pkt = normalizePacket(raw);
        handleIncomingPacket(pkt);
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

// Chuẩn hóa tên thuộc tính JSON (PascalCase từ WebSocket & camelCase từ HTTP API)
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

// ================= 2. XỬ LÝ GÓI TIN NHẬN ĐƯỢC TỪ SERVER =================
async function handleIncomingPacket(pkt) {
    switch (pkt.type) {
        case "ERROR":
            loginError.textContent = pkt.content;
            if (socket) socket.close();
            break;

        case "USER_LIST":
            // Nếu đang ở màn hình login thì chuyển vào giao diện chat chính
            if (!loginOverlay.classList.contains("hidden")) {
                currentUser = usernameInput.value.trim();
                currentUserLabel.textContent = currentUser;
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
                typingIndicator.textContent = `${pkt.sender} đang soạn tin...`;
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    typingIndicator.textContent = "";
                }, 2500);
            }
            break;
    }
}

// ================= 3. CHUYỂN PHÒNG / CHAT RIÊNG & TẢI LỊCH SỬ (HTTP API) =================
async function switchConversation(mode, target) {
    currentMode = mode;
    currentTarget = target;
    unreadTargets.delete(`${mode}:${target}`);
    typingIndicator.textContent = "";

    if (mode === "room") {
        chatTitleEl.textContent = `# ${target}`;
        chatSubtitleEl.textContent = "Phòng chat nhóm (Broadcast)";
        sendPacket({ Type: "JOIN_ROOM", Sender: currentUser, Room: target });
    } else {
        chatTitleEl.textContent = target;
        chatSubtitleEl.textContent = "Trò chuyện riêng tư 1-1 (Unicast)";
    }

    renderSidebar();
    messagesBox.innerHTML = "";

    // Gọi HTTP GET /api/history để nạp tin nhắn cũ
    const url = `/api/history?mode=${encodeURIComponent(mode)}&target=${encodeURIComponent(target)}&user=${encodeURIComponent(currentUser)}`;
    const res = await fetch(url);
    if (res.ok) {
        const history = await res.json();
        history.forEach(item => appendMessage(normalizePacket(item)));
    }
}

createRoomBtn.addEventListener("click", () => {
    const roomName = prompt("Nhập tên phòng chat mới (không dấu cách càng đẹp):");
    if (roomName && roomName.trim()) {
        switchConversation("room", roomName.trim());
    }
});

// ================= 4. GỬI TIN NHẮN, TYPING & UPLOAD FILE =================
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
});

// Gửi tín hiệu đang gõ phím (giới hạn 1.5 giây gửi tối đa 1 lần để tránh spam mạng)
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

// Xử lý chọn và upload ảnh/tệp qua HTTP POST /api/upload
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

        const packet = {
            Type: currentMode === "room" ? "CHAT_GROUP" : "CHAT_PRIVATE",
            Sender: currentUser,
            Room: currentMode === "room" ? currentTarget : "General",
            Receiver: currentMode === "private" ? currentTarget : null,
            Content: data.url,
            FileName: data.fileName
        };
        sendPacket(packet);
    } finally {
        fileInput.value = "";
    }
});

// ================= 5. HIỂN THỊ GIAO DIỆN (UI RENDERING) =================
function renderSidebar() {
    // Vẽ danh sách phòng nhóm
    roomListEl.innerHTML = "";
    cachedRooms.forEach(room => {
        const li = document.createElement("li");
        const isActive = currentMode === "room" && currentTarget === room;
        li.className = `nav-item ${isActive ? "active" : ""}`;

        const hasUnread = unreadTargets.has(`room:${room}`);
        li.innerHTML = `
            <span class="nav-item-left"># ${escapeHtml(room)}</span>
            ${hasUnread ? '<span class="unread-badge">Mới</span>' : ""}
        `;
        li.onclick = () => switchConversation("room", room);
        roomListEl.appendChild(li);
    });

    // Vẽ danh sách người dùng online (trừ bản thân)
    const others = cachedUsers.filter(u => u !== currentUser);
    onlineCountEl.textContent = cachedUsers.length;
    userListEl.innerHTML = "";

    others.forEach(user => {
        const li = document.createElement("li");
        const isActive = currentMode === "private" && currentTarget === user;
        li.className = `nav-item ${isActive ? "active" : ""}`;

        const hasUnread = unreadTargets.has(`private:${user}`);
        li.innerHTML = `
            <span class="nav-item-left">
                <span class="status-dot online"></span>
                ${escapeHtml(user)}
            </span>
            ${hasUnread ? '<span class="unread-badge">Mới</span>' : ""}
        `;
        li.onclick = () => switchConversation("private", user);
        userListEl.appendChild(li);
    });
}

function appendMessage(pkt) {
    const isMine = pkt.sender === currentUser;
    const row = document.createElement("div");
    row.className = `msg-row ${isMine ? "mine" : "other"}`;

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${isMine ? "Bạn" : pkt.sender} • ${pkt.timestamp || ""}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (pkt.fileName) {
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(pkt.fileName);
        if (isImg) {
            bubble.innerHTML = `<img src="${pkt.content}" alt="${escapeHtml(pkt.fileName)}">`;
        } else {
            bubble.innerHTML = `<a class="file-link" href="${pkt.content}" download="${escapeHtml(pkt.fileName)}">📄 ${escapeHtml(pkt.fileName)}</a>`;
        }
    } else {
        bubble.textContent = pkt.content;
    }

    row.appendChild(meta);
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