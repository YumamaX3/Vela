# Tích hợp Continue VSCode Extension

Continue là một trợ lý AI mã nguồn mở cho VS Code và JetBrains. Nó đọc một tệp `config.json`, và tệp ấy là tất cả những gì bạn cần để định tuyến nó qua Vela.

## Điều kiện tiên quyết

- VS Code với tiện ích mở rộng Continue đã cài
- Vela đang chạy cục bộ, hoặc một endpoint cloud chạm tới được
- Một API key từ dashboard Vela (**Endpoint & Key → Create Key**)

## Các bước cấu hình

### 1. Mở cấu hình Continue

- `Cmd+Shift+P` (macOS) hoặc `Ctrl+Shift+P` (Windows/Linux)
- Chạy **Continue: Open Config**
- Thao tác này mở `~/.continue/config.json`

### 2. Thêm các model Vela

Định dạng cấu hình hiện tại của Continue dùng một mảng `models`:

**Một model:**

```json
{
  "models": [
    {
      "title": "Vela — Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**Nhiều model, để bạn có thể chuyển trong menu thả xuống:**

```json
{
  "models": [
    {
      "title": "Vela — Opus (hard tasks)",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — Sonnet (everyday)",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — GLM (cheap)",
      "provider": "openai",
      "model": "glm/glm-4.7",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**Với một Vela đã triển khai**, đổi `apiBase`:

```json
"apiBase": "https://your-domain.example/v1"
```

> Nếu phiên bản Continue của bạn vẫn dùng lược đồ `models`/`apiBase` cũ hơn được hiển thị ở đây, nó hoạt động đúng như đã viết. Các bản build mới hơn có thể yêu cầu bạn chạy một trình hướng dẫn cấu hình nhỏ ở lần khởi chạy đầu tiên; cùng ba giá trị — provider `openai`, id model, base URL — đi vào cùng những chỗ ấy.

### 3. Lưu và tải lại

Lưu tệp, rồi **Developer: Reload Window**. Continue đọc cấu hình khi tải.

### 4. Chọn một model

Mở thanh bên Continue và chọn model từ menu thả xuống ở đầu.

## Các model hiện có

Bất cứ thứ gì gateway liệt kê — kiểm tra bằng:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

| Model | Tầng |
|-------|------|
| `cc/claude-opus-5` | subscription Claude |
| `cc/claude-sonnet-5` | subscription Claude |
| `cc/claude-haiku-4-5-20251001` | subscription Claude |
| `cx/gpt-5.6-sol` | subscription Codex |
| `cx/gpt-5.4` | subscription Codex |
| `glm/glm-4.7` | giá rẻ |
| `minimax/MiniMax-M2.1` | rẻ nhất |
| `kr/claude-sonnet-4.5` | miễn phí |

Combos cũng hoạt động như id model.

## Ví dụ sử dụng

- **Explain:** chọn code, mở thanh bên, hỏi "Explain this".
- **Generate:** yêu cầu "a React card component for a user profile".
- **Refactor:** chọn code, hỏi "Refactor this to async/await".
- **Debug:** dán stack trace và hỏi điều gì đã hỏng.

## Nâng cao

### Một system prompt

```json
{
  "models": [
    {
      "title": "Vela — Code Expert",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1",
      "systemMessage": "You are a senior engineer. Prefer small, reviewable changes and explain trade-offs."
    }
  ]
}
```

### Temperature

```json
"temperature": 0.9,
"topP": 0.95
```

Với code, temperature thấp thường tốt hơn; với viết lách, cao hơn.

### Context providers

Continue quyết định những gì gửi kèm prompt của bạn. Siết chặt điều này là đòn bẩy lớn nhất về chi phí cho người dùng Continue:

```json
{
  "contextProviders": [
    { "name": "code", "params": { "maxLines": 100 } },
    { "name": "diff", "params": {} }
  ]
}
```

## Phím tắt

- `Cmd/Ctrl + L` — mở chat
- `Cmd/Ctrl + I` — chỉnh sửa inline
- `Cmd/Ctrl + Shift + R` — tạo lại

(Phím tắt thay đổi theo phiên bản; bảng phím tắt của VS Code liệt kê những cái của bạn.)

## Khắc phục sự cố

### Model không phản hồi

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Kiểm tra key trong `config.json`.
3. Mở console dành cho nhà phát triển của VS Code (**Help → Toggle Developer Tools**) và đọc lỗi.

### Chọn sai model

- Kiểm tra menu thả xuống ở thanh bên — Continue nhớ lựa chọn cuối cùng.
- Id model phân biệt chữ hoa chữ thường.

### Cấu hình không load

- Kiểm tra tính hợp lệ của JSON (dấu phẩy thừa ở cuối là thủ phạm thường gặp).
- Xác nhận đường dẫn là `~/.continue/config.json`.
- Tải lại cửa sổ sau khi lưu.

### Chậm

- Dùng một model nhẹ hơn.
- Cắt ngữ cảnh: ít `maxLines` hơn, ít tệp đính kèm hơn.
- Kiểm tra độ trễ mạng đến Vela.

## Thực hành tốt nhất

1. **Ba model, ba mức giá** — Opus để suy nghĩ, Sonnet để viết, GLM cho việc lặt vặt. Chuyển đổi chỉ một cú nhấp.
2. **Chọn trước khi hỏi** — gửi cả tệp là thói quen đắt đỏ.
3. **Đặt một ngưỡng cho key** nếu Continue chạy trên một máy dùng chung.

## Bước tiếp theo

- [Cursor](cursor.md) cho IDE
- [Roo](roo.md) cho một agent khác
- [Combos](../features/combos.md) cho các chuỗi fallback
