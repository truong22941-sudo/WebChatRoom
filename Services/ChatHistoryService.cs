using System.Text.Json;
using WebChatRoom.Models;

namespace WebChatRoom.Services;

public class ChatHistoryService
{
    private readonly string _filePath;
    // Khóa bất đồng bộ đảm bảo không bị xung đột khi nhiều người nhắn tin ghi file cùng lúc (Ch 5)
    private readonly SemaphoreSlim _fileLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public ChatHistoryService(IWebHostEnvironment env)
    {
        string dataDir = Path.Combine(env.ContentRootPath, "Data");
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "history.json");
    }

    // Lưu một gói tin chat xuống file JSON (Ch 6)
    public async Task SaveMessageAsync(ChatPacket packet)
    {
        await _fileLock.WaitAsync();
        try
        {
            var messages = await ReadAllInternalAsync();
            messages.Add(packet);

            // Giữ tối đa 500 tin nhắn gần nhất để file nhẹ và tải nhanh
            if (messages.Count > 500)
            {
                messages = messages.Skip(messages.Count - 500).ToList();
            }

            string json = JsonSerializer.Serialize(messages, JsonOptions);
            await File.WriteAllTextAsync(_filePath, json);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    // Lấy lịch sử tin nhắn theo phòng nhóm hoặc theo cặp chat riêng 1-1
    public async Task<List<ChatPacket>> GetHistoryAsync(string mode, string target, string? currentUser)
    {
        await _fileLock.WaitAsync();
        try
        {
            var all = await ReadAllInternalAsync();

            if (mode == "private" && !string.IsNullOrWhiteSpace(currentUser))
            {
                return all.Where(m =>
                    m.Type == "CHAT_PRIVATE" &&
                    ((m.Sender == currentUser && m.Receiver == target) ||
                     (m.Sender == target && m.Receiver == currentUser))
                ).ToList();
            }

            return all.Where(m => m.Type == "CHAT_GROUP" && m.Room == target).ToList();
        }
        finally
        {
            _fileLock.Release();
        }
    }

    private async Task<List<ChatPacket>> ReadAllInternalAsync()
    {
        if (!File.Exists(_filePath)) return [];
        string json = await File.ReadAllTextAsync(_filePath);
        if (string.IsNullOrWhiteSpace(json)) return [];
        return JsonSerializer.Deserialize<List<ChatPacket>>(json, JsonOptions) ?? [];
    }
}