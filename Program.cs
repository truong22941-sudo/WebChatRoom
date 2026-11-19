using WebChatRoom.Services;

var builder = WebApplication.CreateBuilder(args);

// Lấy cổng động từ biến môi trường khi deploy lên Cloud (Render/Railway), mặc định là 5000 khi chạy ở máy cá nhân
var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// Đăng ký các Service dùng chung toàn hệ thống
builder.Services.AddSingleton<ChatHistoryService>();
builder.Services.AddSingleton<ChatWebSocketHandler>();
builder.Services.AddHostedService<UdpDiscoveryService>();

var app = builder.Build();

// Cho phép phục vụ file tĩnh (index.html, style.css, chat.js) trong thư mục wwwroot
app.UseDefaultFiles();
app.UseStaticFiles();

// Kích hoạt tính năng WebSocket
app.UseWebSockets();

// 1. Kênh WebSocket thời gian thực (/ws)
app.Map("/ws", async (HttpContext context, ChatWebSocketHandler handler) =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
        await handler.HandleClientAsync(webSocket, context.RequestAborted);
    }
    else
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
    }
});

// 2. HTTP Web API: Lấy lịch sử tin nhắn (GET /api/history?mode=room&target=General&user=Nam)
app.MapGet("/api/history", async (
    string mode,
    string target,
    string? user,
    ChatHistoryService historyService) =>
{
    var history = await historyService.GetHistoryAsync(mode, target, user);
    return Results.Ok(history);
});

// 3. HTTP Web API: Upload ảnh hoặc tệp đính kèm (POST /api/upload)
app.MapPost("/api/upload", async (HttpRequest request, IWebHostEnvironment env) =>
{
    if (!request.HasFormContentType || request.Form.Files.Count == 0)
        return Results.BadRequest(new { error = "Không tìm thấy file tải lên." });

    var file = request.Form.Files[0];
    if (file.Length == 0)
        return Results.BadRequest(new { error = "File rỗng." });

    string webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
    string uploadDir = Path.Combine(webRoot, "uploads");
    Directory.CreateDirectory(uploadDir);

    // Đổi tên file bằng GUID để tránh trùng tên khi nhiều người gửi cùng lúc
    string ext = Path.GetExtension(file.FileName);
    string savedName = $"{Guid.NewGuid():N}{ext}";
    string fullPath = Path.Combine(uploadDir, savedName);

    await using var stream = new FileStream(fullPath, FileMode.Create);
    await file.CopyToAsync(stream);

    return Results.Ok(new
    {
        url = $"/uploads/{savedName}",
        fileName = file.FileName,
        isImage = file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
    });
}).DisableAntiforgery();

app.Run();