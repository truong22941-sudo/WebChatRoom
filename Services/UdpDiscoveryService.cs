using System.Net;
using System.Net.Sockets;
using System.Text;

namespace WebChatRoom.Services;

// Dịch vụ chạy ngầm lắng nghe gói tin tìm kiếm Server qua giao thức UDP (Chương 3)
public class UdpDiscoveryService : BackgroundService
{
    private const int UdpPort = 5001;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    try
    {
        using var udpServer = new UdpClient(UdpPort);
        Console.WriteLine($"[UDP] Dang lang nghe tin hieu tim Server tai cong {UdpPort}...");

        while (!stoppingToken.IsCancellationRequested)
        {
            UdpReceiveResult result = await udpServer.ReceiveAsync(stoppingToken);
            string message = Encoding.UTF8.GetString(result.Buffer);

            if (message == "DISCOVER_CHAT_SERVER")
            {
                string localIp = GetLocalIPv4();
                string replyText = $"CHAT_SERVER_FOUND|http://{localIp}:5000";
                byte[] replyBytes = Encoding.UTF8.GetBytes(replyText);

                await udpServer.SendAsync(replyBytes, result.RemoteEndPoint, stoppingToken);
            }
        }
    }
    catch (OperationCanceledException)
    {
        // Server tắt bình thường
    }
    catch (Exception ex)
    {
        // Bắt mọi lỗi mở cổng UDP để Web Server chính vẫn chạy bình thường
        Console.WriteLine($"[UDP Bo qua] Khong the chay UDP Discovery: {ex.Message}");
    }
}
    // Lấy địa chỉ IPv4 thực tế của máy trong mạng LAN/Wi-Fi
    private static string GetLocalIPv4()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0);
            socket.Connect("8.8.8.8", 65530);
            if (socket.LocalEndPoint is IPEndPoint endPoint)
                return endPoint.Address.ToString();
        }
        catch { }

        var host = Dns.GetHostEntry(Dns.GetHostName());
        var ip = host.AddressList.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
        return ip?.ToString() ?? "127.0.0.1";
    }
}