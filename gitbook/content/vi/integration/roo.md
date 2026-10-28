# Tích hợp Roo AI Assistant

Roo là một agent VS Code sống ở thanh bên. Hướng nó về Vela và nó chạm tới mọi model bạn đã kết nối, với một key và một địa chỉ.

## Điều kiện tiên quyết

- Đã cài Roo trong VS Code
- Vela đang chạy cục bộ, hoặc một endpoint cloud chạm tới được
- Một API key từ dashboard Vela (**Endpoint & Key → Create Key**)

## Các bước cấu hình

### 1. Mở cài đặt Roo

Khởi chạy Roo và mở bảng cài đặt của nó từ thanh bên.

### 2. Chọn loại nhà cung cấp

Dưới **API Provider**, chọn **OpenAI Compatible**. Vela nói OpenAI API, nên đó là hình dạng đúng — Roo sẽ hỏi một base URL, một key và một id model.

### 3. Điền ba trường

**Vela cục bộ:**

```
Base URL:  http://localhost:32060/v1
API Key:   vela-v1-<id>-<checksum>
Model:     cc/claude-opus-5
```

**Vela đã triển khai:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-opus-5
```

### 4. Thử nó

Gửi:

```
Hello! Can you confirm you're connected through Vela?
```

Rồi nhìn dưới **Usage** trong dashboard — request nên ở đó, được gán cho key ấy.

## Chọn một model

| Model | Tầng | Dùng cho |
|-------|------|------------|
| `cc/claude-opus-5` | subscription Claude | những tác vụ khó nhất |
| `cc/claude-sonnet-5` | subscription Claude | công việc thường ngày cân bằng |
| `cc/claude-haiku-4-5-20251001` | subscription Claude | chỉnh sửa nhanh |
| `cx/gpt-5.6-sol` | subscription Codex | các bài toán nặng về lập trình |
| `glm/glm-4.7` | giá rẻ | những phiên dài với ngân sách |
| `kr/claude-sonnet-4.5` | miễn phí | khi các tầng trả phí đã cạn |

> **Một lưu ý về tầng `cc/`.** Nhà cung cấp Claude Code (`claude`, bí danh `cc`) mang một dấu **deprecated** kèm thông báo rủi ro trong bản phát hành này: nó dựa trên một giao diện Claude Code không được tài liệu hoá, thứ có thể thay đổi mà không báo trước. Nó hoạt động hôm nay và nó là lựa chọn tự nhiên cho một subscription Anthropic — hãy nhớ đến `cx/` và các model Claude miễn phí `kr/` nếu nó hỏng.

## Ví dụ sử dụng

```
Quick tasks       : cc/claude-haiku-4-5-20251001  or  glm/glm-4.7
Balanced work     : cc/claude-sonnet-5  or  cx/gpt-5.6-sol
Hard reasoning    : cc/claude-opus-5
Cost-sensitive    : glm/glm-4.7  →  kr/claude-sonnet-4.5
```

## Mẹo chọn model

- **Nhanh và rẻ** cho đổi tên, sửa chú thích và chỉnh sửa nhỏ.
- **Hạng Sonnet** cho công việc tính năng thông thường.
- **Hạng Opus** khi một tác vụ trải qua nhiều tệp hoặc logic tinh tế.
- **Một combo** khi phiên có thể sống lâu hơn một cửa sổ quota — đó là khác biệt giữa hoàn thành và không.

## Khắc phục sự cố

### Connection failed

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Kiểm tra base URL kết thúc bằng `/v1`.
3. Kiểm tra key đầy đủ.
4. Tải lại cửa sổ VS Code.

### Model không khả dụng

- Id phải khớp chính xác, kể cả chữ hoa chữ thường.
- Xác nhận nhà cung cấp đã kết nối trong **Providers**.
- Kiểm tra danh sách của chính gateway: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### Phản hồi chậm

- Chuyển sang một model nhẹ hơn (`cc/claude-haiku-4-5-20251001`, `glm/glm-4.7`).
- Cắt bớt ngữ cảnh — ít tệp đính kèm hơn.
- Kiểm tra nhà cung cấp không bị suy giảm.

## Nâng cao

### Bí danh ngắn

Nếu Roo cho bạn lưu các preset model có tên, hãy đặt tên theo công việc thay vì theo model:

```
"fast"  → cc/claude-haiku-4-5-20251001
"smart" → cc/claude-opus-5
"cheap" → glm/glm-4.7
"chain" → never-stuck
```

### Các hồ sơ riêng

Những hồ sơ khác nhau cho những loại công việc khác nhau — lập trình, viết lách, nghiên cứu — mỗi hồ sơ có model riêng và key Vela riêng, để mức dùng rơi vào đúng ngăn.

## Bước tiếp theo

- [Cursor](cursor.md) cho tích hợp IDE
- [Continue](continue.md) cho VS Code
- [Combos](../features/combos.md) cho những chuỗi fallback đáng dùng
