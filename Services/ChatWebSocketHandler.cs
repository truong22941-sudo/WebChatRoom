using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using WebChatRoom.Models;

namespace WebChatRoom.Services;

public class ChatWebSocketHandler(ChatHistoryService historyService)
{
    // Danh sách kết nối đang online: Key = Username, Value = WebSocket (Thread-safe - Ch 5)
    private readonly ConcurrentDictionary<string, WebSocket> _clients = new();

    // Lưu phòng hiện tại của từng user: Key = Username, Value = RoomName
    private readonly ConcurrentDictionary<string, string> _userRooms = new();

    // Danh sách các phòng chat hiện có (dùng ConcurrentDictionary như một HashSet an toàn đa luồng)
    private readonly ConcurrentDictionary<string, byte> _rooms = new(
        new[]
        {
            new KeyValuePair<string, byte>("General", 0),
            new KeyValuePair<string, byte>("LapTrinhMang", 0),
            new KeyValuePair<string, byte>("GiaiTri", 0)
        });

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task HandleClientAsync(WebSocket webSocket, CancellationToken token)
    {
        string? currentUsername = null;
        byte[] buffer = new byte[4096];

        try
        {
            while (webSocket.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                WebSocketReceiveResult result = await webSocket.ReceiveAsync(
                    new ArraySegment<byte>(buffer), token);

                if (result.MessageType == WebSocketMessageType.Close)
                    break;

                string rawJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
                ChatPacket? packet = JsonSerializer.Deserialize<ChatPacket>(rawJson, JsonOptions);

                if (packet is null) continue;

                switch (packet.Type)
                {
                    case "LOGIN":
                        string requestedName = packet.Sender.Trim();
                        if (string.IsNullOrEmpty(requestedName) || !_clients.TryAdd(requestedName, webSocket))
                        {
                            await SendPacketAsync(webSocket, new ChatPacket(
                                Type: "ERROR",
                                Sender: "System",
                                Content: "Tên này đã có người dùng hoặc không hợp lệ!"
                            ), token);
                            break;
                        }

                        currentUsername = requestedName;
                        _userRooms[currentUsername] = "General";
                        Console.WriteLine($"[+] {currentUsername} da tham gia.");

                        await BroadcastStateAsync(token);
                        break;

                    case "JOIN_ROOM":
                        if (currentUsername is null || string.IsNullOrWhiteSpace(packet.Room)) break;

                        string targetRoom = packet.Room.Trim();
                        _rooms.TryAdd(targetRoom, 0);
                        _userRooms[currentUsername] = targetRoom;

                        // Cập nhật danh sách phòng cho tất cả mọi người (phòng trường hợp vừa tạo phòng mới)
                        await BroadcastStateAsync(token);
                        break;

                    case "CHAT_GROUP":
                        if (currentUsername is null || string.IsNullOrWhiteSpace(packet.Content)) break;

                        string room = string.IsNullOrWhiteSpace(packet.Room) ? "General" : packet.Room;
                        var groupMsg = packet with
                        {
                            Sender = currentUsername,
                            Room = room,
                            Timestamp = DateTime.Now.ToString("HH:mm")
                        };

                        await historyService.SaveMessageAsync(groupMsg);

                        // Application-Level Broadcast: chỉ gửi cho những user đang ở cùng phòng
                        foreach (var (username, socket) in _clients)
                        {
                            if (_userRooms.TryGetValue(username, out var userRoom) && userRoom == room)
                            {
                                await SendPacketAsync(socket, groupMsg, token);
                            }
                        }
                        break;

                    case "CHAT_PRIVATE":
                        if (currentUsername is null || string.IsNullOrWhiteSpace(packet.Receiver) || string.IsNullOrWhiteSpace(packet.Content)) break;

                        var privateMsg = packet with
                        {
                            Sender = currentUsername,
                            Timestamp = DateTime.Now.ToString("HH:mm")
                        };

                        await historyService.SaveMessageAsync(privateMsg);

                        // Unicast: gửi tới người nhận nếu đang online
                        if (_clients.TryGetValue(packet.Receiver, out var receiverSocket))
                        {
                            await SendPacketAsync(receiverSocket, privateMsg, token);
                        }

                        // Gửi phản hồi lại cho chính người gửi để hiển thị đồng bộ trên khung chat
                        if (packet.Receiver != currentUsername)
                        {
                            await SendPacketAsync(webSocket, privateMsg, token);
                        }
                        break;

                    case "TYPING":
                        if (currentUsername is null) break;
                        var typingPacket = packet with { Sender = currentUsername };

                        if (!string.IsNullOrWhiteSpace(packet.Receiver))
                        {
                            // Đang nhập trong chat riêng 1-1
                            if (_clients.TryGetValue(packet.Receiver, out var targetSocket))
                            {
                                await SendPacketAsync(targetSocket, typingPacket, token);
                            }
                        }
                        else
                        {
                            // Đang nhập trong phòng nhóm (gửi cho người khác trong cùng phòng)
                            foreach (var (username, socket) in _clients)
                            {
                                if (username != currentUsername &&
                                    _userRooms.TryGetValue(username, out var userRoom) &&
                                    userRoom == packet.Room)
                                {
                                    await SendPacketAsync(socket, typingPacket, token);
                                }
                            }
                        }
                        break;
                }
            }
        }
        catch (WebSocketException)
        {
            Console.WriteLine($"[!] Mat ket noi dot ngot voi {currentUsername ?? "Unknown"}");
        }
        finally
        {
            if (currentUsername is not null)
            {
                _clients.TryRemove(currentUsername, out _);
                _userRooms.TryRemove(currentUsername, out _);
                Console.WriteLine($"[-] {currentUsername} da thoat.");

                await BroadcastStateAsync(CancellationToken.None);
            }

            if (webSocket.State == WebSocketState.Open || webSocket.State == WebSocketState.CloseReceived)
            {
                await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closed", CancellationToken.None);
            }
        }
    }

    public async Task SendPacketAsync(WebSocket socket, ChatPacket packet, CancellationToken token = default)
    {
        if (socket.State != WebSocketState.Open) return;

        string json = JsonSerializer.Serialize(packet);
        byte[] bytes = Encoding.UTF8.GetBytes(json);

        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
    }

    private async Task BroadcastStateAsync(CancellationToken token)
    {
        var packet = new ChatPacket(
            Type: "USER_LIST",
            Sender: "System",
            OnlineUsers: _clients.Keys.OrderBy(x => x).ToList(),
            Rooms: _rooms.Keys.ToList()
        );

        foreach (var socket in _clients.Values)
        {
            await SendPacketAsync(socket, packet, token);
        }
    }
}