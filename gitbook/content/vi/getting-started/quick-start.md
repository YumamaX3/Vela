# Bắt đầu

Năm phút, một endpoint, mọi công cụ đều hướng về đó. Trang này là con đường nhanh; [Cài đặt](../getting-started/installation.md) có chi tiết cặn kẽ và phần khắc phục sự cố.

---

## Bắt đầu nhanh

### 1. Cài đặt

```bash
npm install -g vela
```

Bạn cần Node.js 20 trở lên. Lệnh `vela` là một trình khởi chạy nhỏ: nó khởi động gateway và mở trình duyệt của bạn.

### 2. Khởi động

```bash
vela
```

Dashboard mở tại **http://localhost:32060/dashboard**.

Vài điều nên biết ở lần chạy đầu tiên:

- **Không có mật khẩu mặc định**. Từ chính máy đang chạy Vela, dashboard mở thẳng vào. Các phiên đăng nhập từ máy khác bị từ chối cho đến khi bạn đặt mật khẩu trong **Settings → Access**.
- Dữ liệu của bạn nằm trong `~/.vela` trên macOS và Linux, và trong `%APPDATA%\vela` trên Windows.
- Mặc định gateway lắng nghe trên mọi giao diện mạng (`0.0.0.0`). Nếu bạn chỉ cần nó trên máy này, hãy khởi động với `vela --host 127.0.0.1`.

### 3. Kết nối một nhà cung cấp

Có ba loại nhà cung cấp, và bạn có thể trộn chúng tuỳ ý.

#### Lựa chọn A — Subscription qua OAuth

**Phù hợp nhất với:** Claude Code, Codex, GitHub Copilot, Antigravity — bất cứ thứ gì bạn đã trả tiền hoặc đã đăng nhập sẵn.

```
Dashboard → Providers → pick a provider → Connect
→ Log in in the browser window → done
```

Từ đó trở đi token tự làm mới, và việc theo dõi quota bắt đầu ngay lập tức.

**Ví dụ: Claude Code**
1. Mở **Providers** và chọn **Claude**.
2. Nhấp **Connect**, đăng nhập tài khoản Claude của bạn, và phê duyệt.
3. Dùng model theo tên đầy đủ, ví dụ `cc/claude-opus-5`.

#### Lựa chọn B — API key

**Phù hợp nhất với:** GLM, MiniMax, Kimi, OpenRouter, và bất kỳ nhà cung cấp trả theo mức dùng nào khác.

```
Dashboard → Providers → pick a provider → Add API key
→ paste the key → Save
```

**Ví dụ: GLM-4.7**
1. Tạo một tài khoản và một key tại nhà cung cấp GLM của bạn.
2. Trong Vela: **Providers → GLM → Add API key**, dán vào, lưu.
3. Dùng `glm/glm-4.7`.

#### Lựa chọn C — Nhà cung cấp miễn phí

**Phù hợp nhất với:** lớp cuối cùng khi quota trả phí đã cạn.

```
Dashboard → Providers → Connect a free provider
→ Device code or OAuth → done
```

**Ví dụ: Kiro**
1. Mở **Providers** và chọn **Kiro**.
2. Đăng nhập bằng AWS Builder ID hoặc một tài khoản mạng xã hội.
3. Dùng các model `kr/` — dòng Claude, không mất phí.

### 4. Tạo một API key cho các công cụ của bạn

```
Dashboard → Endpoint & Key → Create Key → copy it
```

Key có dạng `vela-v1-<id>-<checksum>`. Chúng chỉ được hiển thị một lần — hãy sao chép nơi an toàn, hoặc tạo một key mới sau này nếu bạn làm mất. Mỗi key có thể được gán phạm vi nhà cung cấp, rate limit, ngân sách token và ngưỡng chi tiêu riêng.

### 5. Hướng các công cụ của bạn về Vela

Mọi công cụ đều cần cùng hai thứ: endpoint và key.

**Cursor**

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    cc/claude-opus-5     (add it as a custom model)
```

**Cline / Continue / Roo**

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    cc/claude-opus-5
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

**Codex CLI**

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

Mỗi công cụ có trang riêng trong [Tích hợp](../integration/claude-code.md), với đúng các trường cần điền và những vướng mắc thường gặp.

---

## 6. Dựng một chuỗi fallback (tuỳ chọn, nhưng nên làm)

Một model duy nhất là một điểm chết duy nhất. Một **combo** cho phép bạn đặt tên cho một chuỗi model, và Vela đi qua chuỗi ấy cho đến khi một model trả lời.

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      (subscription first)
          2. glm/glm-4.7           (cheap backup)
          3. kr/claude-sonnet-4.5  (free last line)
```

Sau đó dùng `premium-coding` ở bất cứ đâu cần một tên model. Combo được tra theo tên trước mọi thứ khác, nên nó hoạt động trong mọi công cụ.

Một combo fallback khi một request thất bại — lỗi quota, rate limit, timeout, prompt bị từ chối, một model không tồn tại. Nó **không** chuyển chỉ vì quota ngày đang gần cạn; làm vậy sẽ âm thầm tiêu tiền của bạn. Nếu bạn muốn một ngưỡng chi tiêu, hãy đặt trên API key (**Endpoint & Key → Create/Edit Key → budget**), và Vela sẽ từ chối các request khi chạm ngưỡng, với một mã 429 rõ ràng thay vì lặng lẽ hạ cấp bạn.

---

## Các model hiện có

Tên model có dạng `prefix/model`. Đây là một bộ khởi đầu; hãy mở **Providers** trong dashboard để xem danh sách đầy đủ — nó thay đổi khi các nhà cung cấp phát hành model mới.

### Tầng subscription

**Claude Code (`cc/`)**
- `cc/claude-opus-5` — kẻ gánh nặng
- `cc/claude-sonnet-5` — sự cân bằng thường ngày
- `cc/claude-haiku-4-5-20251001` — nhanh và nhẹ

**Codex (`cx/`)**
- `cx/gpt-5.6-sol`, `cx/gpt-5.6-terra`, `cx/gpt-5.6-luna` — dòng hiện tại
- `cx/gpt-5.5`, `cx/gpt-5.4` — vẫn còn đó và vẫn tốt

**GitHub Copilot (`gh/`)**
- `gh/claude-sonnet-4.5`, `gh/claude-opus-4.5`, `gh/gpt-5.4`

**Antigravity (`ag/`)**
- `ag/gemini-4-argon-high` và phần còn lại của dòng Gemini, cùng các model Claude

### Tầng giá rẻ

**GLM (`glm/`)** — `glm/glm-4.7` với $0.60 / $2.20 mỗi 1M, cùng các model `glm-5.x` mới hơn

**MiniMax (`minimax/`)** — `minimax/MiniMax-M2.1` với $0.30 / $1.20 mỗi 1M, cùng M2.5, M2.7 và M3

**Kimi (`kimi/`)** — `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`

### Tầng miễn phí

**iFlow (`if/`)** — `if/qwen3-coder-plus`, `if/kimi-k2`, `if/glm-4.7`, `if/deepseek-r1`, và hơn thế nữa

**Qwen (`qwen/`)** — `qwen/qwen-plus`, `qwen/qwen-max`, `qwen/qwen-turbo`

**Kiro (`kr/`)** — `kr/claude-sonnet-4.5`, `kr/claude-opus-4.8`, và các model Claude mới hơn

> **Về các hạn mức miễn phí:** những con số như 180K completions mỗi tháng mà Gemini CLI công bố, hay giới hạn hàng ngày của Meta hoặc Google, là **những con số phía thượng nguồn do chính các nhà cung cấp ấy công bố** — không phải thứ Vela kiểm soát. Chúng đã từng thay đổi và sẽ còn thay đổi. Hãy xem chỉ số quota trực tiếp trong dashboard là sự thật.

---

## Giữ chi phí ở mức thấp

Một nếp thực hành thiết thực, không cần bảng tính:

```
1. Put your subscription models first in the combo.
2. Put GLM or MiniMax second — a fraction of the cost of any retail API.
3. Always end with a free provider, so the chain never dead-ends.
4. Set a budget ceiling on the API key you hand to tools you leave running.
```

[Trang Nhà cung cấp giá rẻ](../providers/cheap.md) và [Nhà cung cấp miễn phí](../providers/free.md) có các ví dụ đã tính sẵn, kèm phép toán hiển thị rõ.

---

## Bước tiếp theo

- [Cài đặt](../getting-started/installation.md) — yêu cầu hệ thống, Docker, build từ mã nguồn, gỡ cài đặt
- [Định tuyến thông minh](../features/smart-routing.md) — cách một request chọn nhà cung cấp
- [Combos](../features/combos.md) — dựng và tinh chỉnh các chuỗi fallback
- [Theo dõi quota](../features/quota-tracking.md) — đọc dashboard
- [FAQ](../faq.md) — những câu hỏi ai cũng hỏi trước tiên
- [Khắc phục sự cố](../troubleshooting.md) — khi có thứ gì đó không kết nối được

---

## Cần giúp đỡ?

- **Website**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)

Vela là phiên bản 1.2.5. Kiểm tra bạn đang chạy bản nào với:

```bash
npm list -g vela
```
