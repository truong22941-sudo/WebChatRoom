namespace WebChatRoom.Models;

public record ChatPacket(
    string Type,                        // Loại gói tin: LOGIN, CHAT_GROUP, CHAT_PRIVATE, JOIN_ROOM, USER_LIST, TYPING, ERROR
    string Sender,                      // Tên người gửi
    string Room = "General",            // Tên phòng chat (mặc định là phòng chung General)
    string? Receiver = null,            // Tên người nhận (dùng khi nhắn riêng 1-1)
    string? Content = null,             // Nội dung tin nhắn hoặc URL ảnh/file
    string? FileName = null,            // Tên file gốc (nếu gửi tệp đính kèm)
    string? Timestamp = null,           // Thời gian gửi (VD: "22:45")
    List<string>? OnlineUsers = null,   // Danh sách thành viên đang online
    List<string>? Rooms = null          // Danh sách các phòng chat hiện có
);