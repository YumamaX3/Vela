# Tích hợp Claude Code

Hướng Claude Code về Vela chỉ tốn hai biến môi trường. Sau đó, mọi request Claude từ terminal của bạn đều đi qua gateway — nghĩa là nó có thể được định tuyến, được theo dõi, và được một chuỗi fallback che chắn.

## Điều kiện tiên quyết

- Đã cài Claude Code CLI (`claude --version` nên in ra một số phiên bản)
- Vela đang chạy cục bộ, hoặc một endpoint cloud bạn chạm tới được
- Một API key đã tạo trong dashboard Vela (**Endpoint & Key → Create Key**)

## Thiết lập

### 1. Cấu hình biến môi trường

Thêm những dòng này vào hồ sơ shell của bạn (`~/.zshrc`, `~/.bashrc`, hoặc `~/.bash_profile`):

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

- `ANTHROPIC_BASE_URL` — nơi Claude Code gửi request. Hãy giữ `/v1`.
- `ANTHROPIC_AUTH_TOKEN` — key Vela của bạn. Claude Code gửi nó như một bearer token; Vela chấp nhận nó như một API key.

Nếu bạn muốn một model khác trả lời mặc định, hãy đặt luôn các đích cho bí danh:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Nạp lại shell

```bash
source ~/.zshrc     # or ~/.bashrc
```

### 3. Xác minh

```bash
echo $ANTHROPIC_BASE_URL
curl -s http://localhost:32060/api/health      # → {"ok":true}
```

Rồi chạy một prompt nhỏ:

```bash
claude --model sonnet "Say hello in five words."
```

Một phản hồi qua Vela nghĩa là đã nối được. Bạn có thể xác nhận trong dashboard: **Usage** sẽ hiển thị request.

## Bí danh model

Các tên ngắn của Claude Code ánh xạ tới bất cứ đâu mà các biến môi trường trên trỏ tới:

| Bí danh | Ý nghĩa | Được đặt bởi |
|-------|---------|--------|
| `opus` | model nặng nhất của bạn | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | model thường ngày của bạn | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | model nhanh của bạn | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

Nếu bạn không đặt chúng, Claude Code yêu cầu các tên thượng nguồn thường lệ của nó và Vela phân giải chúng dựa trên những nhà cung cấp bạn đã kết nối.

## Ví dụ sử dụng

### Với bí danh

```bash
claude --model opus   "Explain the trade-offs of an append-only log"
claude --model sonnet "Write a Python function that retries with backoff"
claude --model haiku  "Review this diff for typos"
```

### Với tên model Vela đầy đủ

```bash
claude --model cc/claude-opus-5 "Refactor this module"
```

### Với một combo

Đây là chỗ Vela đáng có mặt: nếu cửa sổ subscription đóng giữa buổi chiều, chuỗi vẫn đi tiếp.

```bash
claude --model premium-coding "Plan the migration"
```

với một combo `cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`.

## Tệp settings

Claude Code còn đọc `~/.claude/settings.json`, nơi cùng các giá trị ấy có thể nằm dưới một khối `env`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:32060/v1",
    "ANTHROPIC_AUTH_TOKEN": "[your Vela key]"
  }
}
```

Dashboard có thể ghi cái này cho bạn: **CLI Tools → Claude Code** điền sẵn base URL và key, và hiển thị kết quả cho bạn xem trước khi lưu.

## Khắc phục sự cố

### Vấn đề kết nối

1. `curl http://localhost:32060/api/health` → nên là `{"ok":true}`.
2. `echo $ANTHROPIC_BASE_URL` → nên kết thúc bằng `/v1`.
3. Kiểm tra không có gì chặn cổng 32060, và Vela được gắn đúng nơi bạn mong (`vela --host 127.0.0.1` giữ nó cục bộ).

### Model not found

1. Hỏi gateway xem nó có gì: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Kiểm tra nhà cung cấp của model ấy đã kết nối trong **Providers**.
3. Nhớ rằng id model thay đổi ở thượng nguồn — `cc/claude-opus-5` hôm nay, một thứ khác vào quý sau.

### Unauthorized / 401

- Xác nhận `ANTHROPIC_AUTH_TOKEN` đang giữ một key Vela (`vela-v1-...`), không phải token subscription của Claude.
- Key chỉ được hiển thị một lần khi tạo. Nếu bạn không còn giữ nó, hãy tạo cái khác trong **Endpoint & Key**.

## Endpoint cloud

Để dùng một Vela đã triển khai thay vì localhost:

```bash
export ANTHROPIC_BASE_URL="https://your-domain.example/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

Phiên bản được host của chính dự án xuất hiện trong tài liệu cũ dưới dạng `https://vela.my.id` — đó là bản triển khai của chủ dự án, một sự thật thượng nguồn chứ không phải một dịch vụ mà tài liệu này có thể hứa hẹn. Hãy dùng bất kỳ endpoint nào bạn thực sự có thông tin xác thực.
