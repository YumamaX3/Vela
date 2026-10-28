# Tích hợp Cline

Cline là một tiện ích mở rộng VS Code đọc, sửa và chạy code cho bạn. Hướng nó về Vela và nó có được mọi model bạn đã kết nối — cộng thêm một chuỗi fallback khi một quota đóng lại giữa tác vụ.

## Điều kiện tiên quyết

- Đã cài VS Code
- Tiện ích mở rộng Cline, cài từ VS Code marketplace
- Vela đang chạy cục bộ, hoặc một endpoint cloud chạm tới được
- Một API key từ dashboard Vela (**Endpoint & Key → Create Key**)

## Thiết lập

### 1. Mở cài đặt Cline

Nhấp vào biểu tượng Cline ở thanh bên VS Code, rồi biểu tượng bánh răng trong bảng Cline.

### 2. Chọn nhà cung cấp OpenAI Compatible

Trong menu thả xuống **API Provider**, chọn **OpenAI Compatible**. Đó là lựa chọn đúng cho Vela — nó chấp nhận một base URL theo hình dạng OpenAI và một key.

### 3. Đặt base URL

```
http://localhost:32060/v1
```

Bao gồm `/v1`. Một bản triển khai cloud cùng hình dạng với một host khác:

```
https://your-domain.example/v1
```

### 4. Dán key của bạn

Key Vela của bạn có dạng `vela-v1-<id>-<checksum>`. Nó chỉ được hiển thị một lần khi tạo, nên hãy tạo một cái mới trong **Endpoint & Key** nếu bạn đã làm mất.

### 5. Đặt id model

Cline chấp nhận một id model dạng văn bản tự do. Hãy dùng một cái Vela phân giải được:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding            ← a combo name works too
```

### 6. Lưu

Đóng bảng cài đặt; Cline lưu khi bạn gõ. Gửi một tin nhắn nhỏ để xác nhận, rồi kiểm tra **Usage** trong dashboard Vela.

## Ví dụ cấu hình

```
API Provider:  OpenAI Compatible
Base URL:      http://localhost:32060/v1
API Key:       vela-v1-xxxxxxxx-xxxxxxxx
Model:         cc/claude-opus-5
```

### Những gì dashboard ghi xuống

Cline giữ các cài đặt của nó trong hai tệp trên đĩa. Quick Connect của dashboard in ra đúng hình dạng này, và bạn có thể tự dán nếu thích sửa tệp hơn là nhấp chuột:

```json
// ~/.cline/data/globalState.json
{ "openAiBaseUrl": "http://localhost:32060", "actModeApiProvider": "openai" }
```

```json
// ~/.cline/data/secrets.json
{ "openAiApiKey": "vela-v1-<id>-<checksum>" }
```

Chú ý khác biệt so với trường ở trên: **`openAiBaseUrl` ở đây bỏ qua `/v1`** — Cline tự nối đường dẫn. Một base URL `http://localhost:32060/v1` trong trường ấy tạo ra `/v1/v1/chat/completions` và một lỗi 404. Hãy dùng đoạn mã của dashboard, hoặc nhập URL qua chính bảng cài đặt của Cline, bảng này tự xử lý hậu tố cho bạn.

## Các model hiện có

Bất cứ thứ gì gateway liệt kê: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

| Model | Tầng | Tốt cho |
|-------|------|----------|
| `cc/claude-opus-5` | subscription Claude | công việc đa tệp phức tạp |
| `cc/claude-sonnet-5` | subscription Claude | chỉnh sửa thường ngày |
| `cx/gpt-5.6-sol` | subscription Codex | bài toán lập trình khó |
| `glm/glm-4.7` | giá rẻ | những phiên dài với ngân sách |
| `minimax/MiniMax-M2.1` | rẻ nhất | ngữ cảnh lớn |
| `kr/claude-sonnet-4.5` | miễn phí | khi các tầng trả phí đã khô |

> **Một lưu ý về tầng `cc/`.** Nhà cung cấp Claude Code (`claude`, bí danh `cc`) được đánh dấu **deprecated kèm thông báo rủi ro** trong registry mà bản phát hành này đi kèm. Nó hoạt động, và nó là thứ hầu hết mọi người muốn cho subscription Anthropic của họ — nhưng nó phụ thuộc vào một giao diện Claude Code không được tài liệu hoá, thứ có thể thay đổi mà không báo trước. Nếu nó bắt đầu hỏng, các model Claude miễn phí `kr/` và tầng `cx/` là những lựa chọn ổn định.

## Sử dụng

### Chat

Gõ trong bảng Cline và nhấn Enter. Cline gửi cuộc trò chuyện, cùng những tệp nó chọn đọc, qua Vela.

### Sinh code

Yêu cầu một thay đổi ("thêm phân trang cho endpoint này"). Cline đề xuất chỉnh sửa; hãy xem lại trước khi chấp nhận — sự cẩn thận y như bạn dành cho bất kỳ agent nào.

### Thao tác tệp

Cline có thể tạo, sửa và xoá tệp. Vela không thay đổi hành vi đó; nó chỉ quyết định model nào lập kế hoạch và thực thi. Fallback ở đây thực sự hữu ích: một lần chuyển model giữa các bước giữ một tác vụ dài tiếp tục chạy.

## Khắc phục sự cố

### "Connection failed"

1. `curl http://localhost:32060/api/health` → nên trả lời.
2. Xác nhận base URL kết thúc bằng `/v1`.
3. Kiểm tra tường lửa trên cổng 32060.
4. Tải lại cửa sổ VS Code (`Cmd/Ctrl + Shift + P` → "Reload Window").

### "Invalid API key"

- Key phải bắt đầu bằng `vela-v1-`. Các key theo định dạng `sk-...` cũ hơn bị từ chối.
- Sao chép toàn bộ, không có ký tự xuống dòng thừa ở cuối.
- Tạo một key mới nếu key cũ từng bị dán công khai — key cũ không thể hiển thị lại.

### "Model not found"

- Dùng đúng id từ `/v1/models`.
- Xác nhận nhà cung cấp ấy đã kết nối trong **Providers**.
- Id model thay đổi ở thượng nguồn; một id đã bị khai tử sẽ không phân giải được dù viết thế nào.

### Cline dừng giữa tác vụ

Rất thường là một cửa sổ quota đóng lại hoặc một rate limit. Một combo (`cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`) cho phép bước kế tiếp chạy trên model kế tiếp thay vì dừng lại.

## Nâng cao

### Dùng một combo

```
Model: never-stuck
```

với một chuỗi kết thúc bằng một nhà cung cấp miễn phí. Các phiên chạy agent dài hưởng lợi nhiều nhất — chúng đúng là khối công việc đụng phải một bức tường quota sau nửa giờ.

### Đổi model theo tác vụ

Giữ sẵn hai hoặc ba id và đổi trường khi công việc thay đổi:

- suy luận nặng và refactor → `cc/claude-opus-5`
- chỉnh sửa thường ngày → `glm/glm-4.7`
- thử nghiệm → `kr/claude-sonnet-4.5`

### Timeout

Các lần chỉnh sửa lớn với ngữ cảnh dài có thể vượt quá timeout request của Cline. Hãy tăng nó trong cài đặt VS Code nếu Cline có tuỳ chọn ấy, hoặc chia nhỏ tác vụ — Vela sẽ stream nhanh bằng nhà cung cấp.

## Thực hành tốt nhất

1. **Cho Cline một key riêng**, với một ngưỡng chi tiêu. Một agent lặp đi lặp lại có thể đốt cháy ngân sách nhanh đến bất ngờ; một ngưỡng biến điều đó thành một điểm dừng thay vì một hoá đơn.
2. **Giữ các cuộc trò chuyện tập trung** — ngữ cảnh là chi phí chi phối.
3. **Không bao giờ commit key.** Nó sống trong cài đặt VS Code, không phải trong repository.
4. **Để ý model nào đã trả lời** trong **Routed by Combo** khi dùng một chuỗi: nó cho bạn biết các fallback có đang làm việc không.
