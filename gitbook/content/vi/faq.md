# Câu hỏi thường gặp

Những câu hỏi người ta hỏi trước tiên, trả lời thẳng thắn. Nếu không có gì ở đây khớp, [Khắc phục sự cố](troubleshooting.md) là trạm dừng kế tiếp.

---

## Vela là gì?

**Một gateway giữa các công cụ lập trình của bạn và các nhà cung cấp AI của bạn.**

Bạn hướng mọi công cụ về một địa chỉ — `http://localhost:32060/v1` — và Vela định tuyến mỗi request đến một nhà cung cấp bạn đã kết nối. Nó theo dõi quota, giữ cho token OAuth luôn mới, và có thể fallback sang một model khác khi một cái từ chối.

Nó không phải một model, và nó không làm model trở nên miễn phí. Nó là bảng chuyển mạch giữa những model bạn đã có quyền truy cập.

---

## Vela có miễn phí không?

**Bản thân Vela miễn phí và là mã nguồn mở (MIT).**

Thứ tốn tiền là những gì xảy ra ở thượng nguồn: một subscription Claude Code, một gói Codex, hoặc các nhà cung cấp tính theo token như GLM và MiniMax. Vela không cộng thêm phí nào.

Bạn có thể chạy hoàn toàn trên các nhà cung cấp miễn phí — iFlow, Qwen, Kiro, Antigravity — nếu bạn chấp nhận giới hạn của họ. Kết hợp ấy không tốn gì.

---

## Định tuyến hoạt động thế nào?

Có hai cơ chế, và chúng khác nhau:

1. **Một combo** là một chuỗi bạn định nghĩa: model 1, rồi model 2, rồi model 3. Khi một request đến một model *thất bại* — lỗi quota, rate limit, timeout, prompt bị từ chối, model không xác định — Vela thử cái kế tiếp.
2. **Round-robin** (theo nhà cung cấp, hoặc theo combo) trải các request qua nhiều tài khoản của cùng nhà cung cấp, để một tài khoản không bị dồn dập.

Không cái nào chuyển bạn sang một model rẻ hơn chỉ vì một hạn mức ngày đang cạn dần. Làm vậy là tiêu tiền bạn không đồng ý tiêu.

Để có một ngưỡng cứng, hãy dùng ngân sách theo từng key: khi chạm ngưỡng, Vela từ chối bằng một 429 nói rõ điều đó.

Xem [Định tuyến thông minh](features/smart-routing.md) và [Combos](features/combos.md).

---

## Vela hỗ trợ bao nhiêu nhà cung cấp?

Ba con số trung thực, được đo vào ngày 2026-10-28 tại phiên bản 1.2.4:

- **189** tệp nhà cung cấp trong registry
- **186** được index import (hôm nay mọi tệp đều đã được nối vào)
- **145** có một transport mà một request thực sự chạm tới được

Bạn có thể tự suy ra chúng trong bản clone của mình:

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

Những cái được tài liệu hoá từng tầng ở đây:

- **Subscription:** Claude Code, Codex, GitHub Copilot, Antigravity, Kimi
- **Giá rẻ:** GLM, MiniMax, Kimi
- **Miễn phí:** iFlow, Qwen, Kiro

---

## Hôm nay tôi có thể dùng những model nào?

Id model có dạng `prefix/model`. Một vài cái đáng tin trong bản phát hành này:

| Model | Tầng |
|-------|------|
| `cc/claude-opus-5`, `cc/claude-sonnet-5` | subscription Claude Code |
| `cx/gpt-5.6-sol`, `cx/gpt-5.5` | subscription Codex |
| `gh/claude-sonnet-4.6`, `gh/gpt-5.4` | GitHub Copilot |
| `ag/gemini-4-argon-high` | Antigravity (miễn phí) |
| `glm/glm-4.7` | giá rẻ — $0.60 / $2.20 mỗi 1M |
| `minimax/MiniMax-M2.1` | giá rẻ — $0.30 / $1.20 mỗi 1M |
| `kr/claude-sonnet-4.5` | miễn phí |
| `if/qwen3-coder-plus` | miễn phí |
| `qwen/qwen-plus` | miễn phí |

Đừng tin tài liệu hơn gateway đang chạy:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

Danh sách ấy là sự thật cho bản cài của bạn.

---

## Tôi có thể dùng nhiều nhà cung cấp cùng lúc không?

**Có — đó chính là mục đích.** Dựng một combo:

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5       ← subscription
          2. glm/glm-4.7            ← cheap
          3. kr/claude-sonnet-4.5   ← free
```

Sau đó dùng `premium-coding` làm tên model trong bất kỳ công cụ nào. Tên combo được phân giải trước mọi thứ khác, nên trên đường truyền nó trông như một model bình thường.

---

## Vela có hoạt động với Cursor không?

**Có.** Cursor nhận một base URL và key tương thích OpenAI. Nếu Vela chạy trên máy của bạn:

```
Cursor → Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    your model or combo name (add it as a custom model)
```

Một số phiên bản Cursor giới hạn endpoint tuỳ chỉnh trong các gói trả phí, và một số cấu hình đi qua chính server của Cursor, khi ấy `localhost` không chạm tới được từ phía họ. Trong tình huống đó, hãy triển khai Vela trên một server có địa chỉ công khai (xem [Triển khai cloud](deployment/cloud.md)) và dùng `https://your-domain/v1` thay vào đó.

Các công cụ khác nhận một base URL hoạt động y như vậy: Cline, Roo, Continue, Claude Code, Codex CLI, và bất cứ thứ gì khác tương thích OpenAI. Xem [Tích hợp](integration/claude-code.md).

---

## Tôi có thể tự host Vela không?

**Có, và đó là cách dự định để chạy nó.** Ba con đường:

**Trên máy của bạn:**
```bash
npm install -g vela
vela
# dashboard: http://localhost:32060/dashboard
# API:       http://localhost:32060/v1
```

**Với Docker, trên bất kỳ server nào:**
```bash
docker run -d --name vela \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.4
```

Ảnh này công khai — không cần đăng nhập hay token để kéo nó — và hỗ trợ nhiều kiến trúc (amd64 và arm64). Hãy ghim thẻ phiên bản thay vì dùng `:latest`.

**Từ mã nguồn:**
```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

Gốc repository là ứng dụng; không có thư mục `app/` lồng bên trong. Các script có sẵn là `dev`, `build`, `start` (cùng các biến thể Bun của chúng) — không có script test và không có script triển khai Cloudflare.

Chi tiết đầy đủ: [Localhost](deployment/localhost.md) · [Cloud](deployment/cloud.md).

---

## Dữ liệu của tôi có an toàn không?

**Nó nằm trên máy của bạn, theo mặc định.**

- Mọi thứ sống trong thư mục dữ liệu — `~/.vela` trên macOS/Linux, `%APPDATA%\vela` trên Windows, hoặc bất cứ đâu `DATA_DIR` chỉ định.
- Token OAuth và API key của các nhà cung cấp đã kết nối được lưu trong cơ sở dữ liệu cục bộ ấy.
- Vela chỉ gửi request đến những nhà cung cấp bạn đã kết nối; không có gì được báo về cho dự án Vela.

**Nó giữ gì:** các kết nối và token của nhà cung cấp, API key của bạn (lưu dưới dạng hash — key đầy đủ chỉ được hiển thị một lần khi tạo), thống kê mức dùng, combos, cài đặt và nhật ký request (chỉ khi bạn bật).

**Nó không giữ gì:** một bản sao các prompt hay code được tạo của bạn ngoài nhật ký request, vốn mặc định tắt.

**Trước khi phơi nó ra một mạng lưới:** đặt một mật khẩu dashboard trong **Settings → Access**, bật **Require dashboard login**, cân nhắc **Require API key**, và đặt nó sau HTTPS. Danh sách kiểm tra nằm trong [Triển khai cloud](deployment/cloud.md).

---

## Mật khẩu mặc định là gì?

**Không có.**

Các hướng dẫn cũ có nhắc `123456`; mặc định ấy đã bị khai tử. Vela hiện tại hoàn toàn không có mật khẩu mặc định:

- Từ máy đang chạy Vela, dashboard mở mà không hỏi gì.
- Từ bất cứ đâu khác, các lần đăng nhập bị **từ chối** cho đến khi bạn đặt một mật khẩu trong **Settings → Access**.

Cùng màn hình ấy hiển thị một phán quyết "gated" màu xanh một khi các điều khiển đã vào chỗ — đáng kiểm tra trước khi bạn mở một cổng.

---

## Làm sao để cập nhật Vela?

```bash
# npm install
npm update -g vela
npm list -g vela        # what you are running now

# Docker — pin the newer tag deliberately
docker pull ghcr.io/yumamax3/vela:1.2.4
docker stop vela && docker rm vela
# re-run your docker run command with the new tag

# From a git checkout
cd Vela && git pull && npm install && npm run build && npm run start
```

Hãy sao lưu thư mục dữ liệu trước với các phiên bản lớn. Các migration cơ sở dữ liệu chạy tự động khi khởi động, với một bản sao an toàn được chụp trước khi chúng chạy.

---

## Làm sao để đóng góp?

Rất được hoan nghênh.

1. **Báo lỗi** — [GitHub Issues](https://github.com/YumamaX3/Vela/issues), kèm lỗi, các bước, và phiên bản của bạn.
2. **Yêu cầu tính năng** — [GitHub Discussions](https://github.com/YumamaX3/Vela/discussions).
3. **Gửi code:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Vela.git
   cd Vela
   git checkout -b feature/your-feature
   npm install
   npm run dev
   ```
   Hãy chạy bộ kiểm tra đi kèm repository trước khi mở pull request, và giữ các commit nhỏ và mô tả rõ.
4. **Cải thiện tài liệu** — các chỉnh sửa và bản dịch hữu ích không kém gì tính năng.
5. **Thêm nhà cung cấp** — các ví dụ adapter nằm trong `open-sse/providers/registry/`.

---

## Vela dùng những cổng nào?

- **32060** — mọi thứ: dashboard (`/dashboard`) và API (`/v1`), phục vụ bởi một tiến trình.
- **32060** một lần nữa trên trình duyệt nghĩa là `http://localhost:32060`; dashboard nằm sâu một cấp ở `/dashboard`.

Nếu thứ khác cần cổng ấy, hãy đổi nó bằng `vela --port 8080` hoặc `PORT=8080`.

---

## Tôi đi đâu khi có thứ gì đó hỏng?

1. `http://localhost:32060/api/health` nên trả lời `{"ok":true}`. Nếu không, Vela không chạy.
2. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` nên liệt kê model. Một danh sách trống nghĩa là chưa có nhà cung cấp nào được kết nối.
3. [Khắc phục sự cố](troubleshooting.md) ánh xạ những lỗi phổ biến — connection refused, key không hợp lệ, model not found, phản hồi chậm — sang cách sửa của chúng.

---

## Cần thêm trợ giúp?

- **Documentation:** [vela.my.id/docs](https://vela.my.id/docs)
- **GitHub:** [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Troubleshooting:** [troubleshooting.md](troubleshooting.md)
