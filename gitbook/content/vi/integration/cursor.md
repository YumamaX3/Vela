# Tích hợp Cursor

Cursor có thể dùng một endpoint tuỳ chỉnh tương thích OpenAI. Hướng nó về Vela và mọi lời gọi chat, chỉnh sửa inline và autocomplete đều đi qua gateway — được định tuyến, được theo dõi, và chịu sự chi phối của các key cùng ngân sách của bạn.

## Điều kiện tiên quyết

- Đã cài Cursor
- Vela đang chạy cục bộ, hoặc một endpoint cloud chạm tới được
- Một API key từ dashboard Vela (**Endpoint & Key → Create Key**)

## ⚠️ Những điều nên biết trước

> **Endpoint tuỳ chỉnh có thể cần gói Cursor trả phí.** Cursor đã di chuyển khả năng này qua lại giữa các phiên bản và các gói. Nếu bản build của bạn không đưa ra trường base-URL, đó là một hạn chế của Cursor, không phải của Vela.

> **Localhost có thể chưa đủ.** Một số cấu hình Cursor gửi request qua chính server của Cursor, từ đó `localhost` nghĩa là máy của Cursor, không phải máy của bạn. Nếu request thất bại với lỗi kết nối trong khi trình duyệt của bạn chạm tới được dashboard, đó là nguyên nhân — hãy triển khai Vela ở nơi Cursor chạm tới được (xem [Triển khai cloud](../deployment/cloud.md)) và dùng địa chỉ ấy thay vào đó.

> **Dùng tên miền, không phải IP trần, qua HTTPS.** Nếu bạn đặt Vela sau một reverse proxy, hãy cấp cho nó chứng chỉ TLS — API key truyền đi trong request.

## Thiết lập

### 1. Mở phần cài đặt model của Cursor

**Settings** (`Cmd/Ctrl + ,`) → **Models**.

### 2. Bật endpoint OpenAI tuỳ chỉnh

Bật **OpenAI API key** và tìm trường **Override OpenAI Base URL**. Nếu bản build của bạn có nó, bạn đã sẵn sàng.

### 3. Đặt base URL

```
http://localhost:32060/v1
```

Giữ `/v1`. Một URL không có nó sẽ chạm vào dashboard thay vì API và thất bại với một phản hồi HTML khó hiểu.

### 4. Dán key của bạn

Key có dạng `vela-v1-<id>-<checksum>`. Lấy một cái mới từ **Endpoint & Key → Create Key** nếu bạn chưa có — key chỉ được hiển thị một lần.

### 5. Thêm một model

Dưới **View All Models → Add custom model**, thêm id model đúng như Vela phân giải nó:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding          ← a combo name works here too
```

### 6. Chọn nó

Chọn model trong bộ chọn model chat của Cursor và gửi một tin nhắn. Xác nhận nó đã đến dưới **Usage** trong dashboard Vela.

## Ví dụ cấu hình

```
OpenAI API:        ✓ enabled
Base URL:          http://localhost:32060/v1
API key:           vela-v1-xxxxxxxx-xxxxxxxx
Custom models:     cc/claude-opus-5, cc/claude-sonnet-5, glm/glm-4.7
```

## Các model hiện có

Bất cứ thứ gì gateway liệt kê — chạy `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` để xem những cái của bạn. Những lựa chọn phổ biến:

| Model | Tầng |
|-------|------|
| `cc/claude-opus-5` | subscription Claude |
| `cc/claude-sonnet-5` | subscription Claude |
| `cx/gpt-5.6-sol` | subscription Codex |
| `glm/glm-4.7` | giá rẻ |
| `minimax/MiniMax-M2.1` | rẻ nhất |
| `kr/claude-sonnet-4.5` | miễn phí |

Combos cũng hoạt động ở đây, và đó là lý do để dùng Cursor với Vela xuyên suốt: khi quota của một model đóng lại, model kế tiếp trả lời, ngay giữa cuộc trò chuyện.

## Sử dụng

- **Chat** (`Cmd/Ctrl + L`) — chọn model Vela và hỏi.
- **Inline edit** (`Cmd/Ctrl + K`) — chọn code, gõ prompt, chấp nhận.
- **Explain** — chọn code, hỏi, và kiểm tra model nào đã trả lời dưới **Routed by Combo** nếu bạn đang dùng một chuỗi.

## Khắc phục sự cố

### "Invalid API key"

1. Xác minh trong **Endpoint & Key** rằng key tồn tại và đang được bật.
2. Sao chép toàn bộ key — từ `vela-v1-` đến checksum ở cuối.
3. Các key theo định dạng `sk-...` cũ có trước cơ chế hiện tại và bị từ chối; hãy tạo một cái mới.

### "Model not found"

1. Dùng đúng id từ `/v1/models`.
2. Kiểm tra nhà cung cấp đã kết nối trong **Providers**.
3. Nhớ rằng một model mà nhà cung cấp đã khai tử sẽ không phân giải được, dù viết thế nào.

### Lỗi kết nối

1. Xác nhận Vela trả lời: `curl http://localhost:32060/api/health`.
2. Xác nhận base URL kết thúc bằng `/v1`.
3. Nếu server của Cursor nằm trên đường đi, `localhost` không thể hoạt động — hãy dùng một endpoint đã triển khai.

### Thiếu trường đó

Một số bản build và gói Cursor không phơi ra base URL tuỳ chỉnh. Không có gì ở phía Vela có thể thêm nó. Các lựa chọn thay thế: Cline, Roo hoặc Continue trong VS Code, đều chấp nhận một base URL.

## Endpoint cloud

Trên một server có chứng chỉ:

```
Base URL:  https://your-domain.example/v1
API key:   [your Vela key]
```

Sau đó Cursor chạm tới Vela từ bất cứ đâu nó chạy. Các rate limit và việc luân chuyển nhà cung cấp vẫn y như cũ; chỉ địa chỉ thay đổi.

## Thực hành tốt nhất

1. **Mỗi máy hoặc mỗi người một key** — báo cáo mức dùng cho bạn biết ai đã tiêu gì.
2. **Đặt một ngưỡng cho nó** nếu Cursor chạy không người trông; một ngưỡng chi tiêu là thứ duy nhất chặn được một vòng lặp chạy loạn.
3. **Luân chuyển key** khi mất một laptop hoặc khi một key bị dán ở nơi không nên dán.
4. **Dùng một combo** để một bức tường quota không kết thúc buổi chiều của bạn.
