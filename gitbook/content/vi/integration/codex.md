# Tích hợp OpenAI Codex CLI

Codex CLI có thể được hướng về Vela bằng một khối nhỏ trong `~/.codex/config.toml`. Đây chính là hình dạng mà trang **CLI Tools → Codex** của dashboard ghi cho bạn, nên bạn có thể tự dán hoặc để dashboard làm việc đó.

## Điều kiện tiên quyết

- Đã cài Codex CLI
- Vela đang chạy cục bộ, hoặc một endpoint cloud bạn chạm tới được
- Một API key từ dashboard Vela (**Endpoint & Key → Create Key**)

## Thiết lập

### 1. Sửa `~/.codex/config.toml`

```toml
model = "cx/gpt-5.6-sol"
model_provider = "Vela"

[model_providers.Vela]
name = "Vela"
base_url = "http://localhost:32060/v1"
wire_api = "responses"
http_headers = { Authorization = "Bearer [your Vela key]" }
```

Một nhà cung cấp tuỳ chỉnh trong Codex xác thực **chỉ** qua dòng `http_headers` ở trên — `OPENAI_API_KEY` trong `auth.json` thuộc về nhà cung cấp `openai` có sẵn và không được đọc cho một nhà cung cấp được định nghĩa theo cách này. Hãy đặt key ở đây, không phải ở đó.

### 2. Kiểm tra

```bash
curl -s http://localhost:32060/api/health      # → {"ok":true}
codex "Write a function that reverses a linked list"
```

Sau đó nhìn vào **Usage** trong dashboard; request nên ở đó.

### 3. Nếu bạn thích biến môi trường hơn

Một số thiết lập thích môi trường hơn tệp. Cách đó cũng hoạt động, với bất cứ thứ gì nói được OpenAI API:

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

Đường `config.toml` là đường dashboard sinh ra, và là đường nên ưu tiên — nó tồn tại qua một lần mở shell mới.

## Các model hiện có

| Model | Tốt cho |
|-------|----------|
| `cx/gpt-5.6-sol` | chiếc flagship hiện tại cho lập trình |
| `cx/gpt-5.6-terra` | một lựa chọn hiện đại thứ hai |
| `cx/gpt-5.6-luna` | công việc nhẹ hơn, nhanh hơn |
| `cx/gpt-5.5`, `cx/gpt-5.4` | các fallback ổn định |

Bất kỳ model hay combo nào khác cũng dùng được — Codex không quan tâm id ấy nghĩa là gì, chỉ quan tâm Vela phân giải được nó.

## Ví dụ sử dụng

```bash
# Write code
codex --model cx/gpt-5.6-sol "Create a REST endpoint that paginates results"

# Explain code
codex --model cx/gpt-5.6-terra "Explain what this does: $(cat myfile.js)"

# Use a fallback chain
codex --model quality-first "Plan the refactor"
```

## Khắc phục sự cố

### Lỗi xác thực

1. Key phải nằm trong `http_headers` bên trong `[model_providers.Vela]` — một key trong `auth.json` sẽ không được dùng cho một nhà cung cấp tuỳ chỉnh.
2. Kiểm tra key đầy đủ và bắt đầu bằng `vela-v1-`.
3. Tạo một cái mới trong **Endpoint & Key** nếu còn nghi ngờ; key không thể lấy lại sau khi tạo.

### Vấn đề kết nối

1. `curl http://localhost:32060/api/health`.
2. Xác nhận `base_url` kết thúc bằng `/v1`.
3. Kiểm tra không có gì chặn cổng 32060.

### Model không khả dụng

1. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Xác nhận nhà cung cấp Codex đã kết nối trong Vela (**Providers**).
3. Id model thay đổi ở thượng nguồn; hãy chọn một cái hiện hành từ danh sách trên.

## Endpoint cloud

Thay `base_url` bằng địa chỉ đã triển khai của bạn (giữ `/v1`):

```toml
base_url = "https://your-domain.example/v1"
```

Tài liệu cũ có nhắc đến phiên bản được host của chủ dự án tại `https://vela.my.id`; đó là một sự thật thượng nguồn về bản triển khai của họ, không phải một dịch vụ mà tài liệu này có thể hứa hẹn. Hãy dùng bất kỳ endpoint nào bạn có thông tin xác thực.
