<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — cánh buồm của con tàu" width="520"/>

  **Một endpoint tương thích OpenAI. Hơn 40 nhà cung cấp upstream. Gói thuê bao của bạn, API key của bạn, gói miễn phí của bạn — một bến cảng, một cánh buồm.**

  Vela định tuyến các công cụ lập trình AI của bạn (Claude Code, Codex, Cursor, Cline, OpenCode…) qua một gateway cục bộ duy nhất, với chuyển đổi định dạng, fallback theo tổ hợp model, luân phiên đa tài khoản, theo dõi hạn mức, và trình tiết kiệm token RTK cắt giảm 20–40% token đầu ra của công cụ trước khi chúng rời bến.

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Bắt đầu nhanh](#-quick-start) · [✨ Tính năng](#-key-features) · [📚 Tài liệu](#-documentation) · [🌐 Ngôn ngữ](#-languages)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 📌 Bản tiếng Anh là bản gốc — [README.md](../README.md).

---

## ⛵ Vela là gì?

Vela là **gateway định tuyến AI cục bộ + bảng điều khiển**. Bạn trỏ mọi công cụ AI về một endpoint duy nhất — `http://localhost:32060/v1` — và Vela quyết định nhà cung cấp nào thực sự trả lời: gói thuê bao trả phí trước, luồng API giá rẻ tiếp theo, gói miễn phí cuối cùng. Khi một luồng cạn kiệt, luồng kế tiếp sẽ đón gió. Không cần thay đổi phía công cụ, không downtime.

```
┌──────────────┐
│  Your tools  │  Claude Code · Codex · Cursor · Cline · OpenCode · …
└──────┬───────┘
       │  http://localhost:32060/v1   (OpenAI-compatible)
       ▼
┌─────────────────────────────────────────────────────┐
│                  Vela — the gateway                  │
│  RTK token saver · format translation · quota track  │
│  combo fallback · multi-account · OAuth refresh      │
└──────┬──────────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…

       Result: every subscription token spent, every rate limit routed around.
```

Bên trong: một máy chủ Next.js (bảng điều khiển + API) chạy trên cổng **32060**, một engine định tuyến độc lập với nhà cung cấp (`open-sse/`), và một cơ sở dữ liệu SQLite có thể mọc thêm bản song sinh MariaDB khi bạn cần (sqlite → mysql → mirror).

> 📌 **Ghi chú:** Vela dong buồm theo hải trình riêng — một cổng AI được rèn từ vùng nước mở, với mọi hệ thống là của riêng mình: lưu trữ, sao lưu, định giá và phân loại. CLI cài đặt dưới tên `vela` từ npm.

---

## 🤔 Vì sao chọn Vela?

| Vấn đề | Vela giải quyết thế nào |
|-|-|
| ❌ Hạn mức thuê bao hết hạn mà chưa dùng hết | ✅ Theo dõi hạn mức + fallback tự động — tiêu hết từng token trước khi reset |
| ❌ Rate limit chặn đứng bạn giữa chừng | ✅ Luân phiên đa tài khoản + fallback theo tổ hợp model, downtime bằng không |
| ❌ Đầu ra của công cụ đốt token (diff, grep, ls…) | ✅ **Trình tiết kiệm token RTK** nén nội dung `tool_result` tại chỗ — tiết kiệm 20–40% |
| ❌ Trả $20–50/tháng cho mỗi nhà cung cấp | ✅ Một gateway xuyên suốt luồng thuê bao + giá rẻ + miễn phí |
| ❌ Mỗi công cụ cần cấu hình riêng | ✅ Một endpoint tương thích OpenAI, mọi công cụ đều nói chung ngôn ngữ |

---

## ✨ Tính năng chính

**🧭 Định tuyến & Chuyển đổi định dạng**
- Một endpoint tương thích OpenAI: `/v1/chat/completions`, `/v1/messages` (Claude bản địa), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, web search & fetch
- Chuyển đổi định dạng lấy OpenAI làm dạng trung gian — các tuyến trực tiếp được đăng ký cho những cặp dễ vỡ (thinking block, tool id)
- **129 nhà cung cấp** đã đăng ký: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama, và hàng chục cái tên khác — [danh sách đầy đủ](../docs/PROVIDERS.md)

**🪂 Khả năng chống chịu**
- Fallback theo tổ hợp model: định nghĩa một tổ hợp, Vela sẽ đi dọc danh sách cho đến khi có nơi trả lời
- Fallback đa tài khoản cho từng nhà cung cấp, luân phiên round-robin
- Quản lý thông tin xác thực OAuth + API-key với tự động làm mới token

**💰 Trí tuệ chi phí — Pricing Covenant**
- Bảng giá tĩnh (input / output / cached / reasoning / cache-creation, $/1M token) với chuỗi phân giải sáu bước — ghi đè theo nhà cung cấp, khớp chính xác, kế thừa model miễn phí, bóc tên vendor, fallback glob
- Trình chỉnh sửa giá trên bảng điều khiển + đồng bộ models.dev — mọi request đều nhận được chi phí ước tính trung thực
- Phát hiện gói miễn phí: model miễn phí kế thừa đơn giá của người anh em trả phí, để mức tiết kiệm luôn hiển thị

**🐚 Trình tiết kiệm token RTK**
- Các hook tiền chuyển đổi nén nội dung `tool_result` trước khi request rời bến — thiết kế fail-open, không bao giờ chạm vào trace `is_error`
- Sidecar [Headroom](https://github.com/chopratejas/headroom) tùy chọn để nén sâu hơn

**🗝️ Storage Covenant**
- Ba tư thế, một biến môi trường: `VELA_DB_MODE=sqlite|mysql|mirror`
- Bến SQLite mặc định; MariaDB làm bến đầy đủ; hoặc **mirror** — SQLite phục vụ trong khi mọi thao tác ghi được bơm sang bản song sinh MariaDB, được canh giữ bởi divergence sweep
- Engine sao lưu niêm phong: artifact AES-256-GCM, các tầng lưu giữ, drill + restore, chặng S3 off-site tùy chọn

**🖥️ Bảng điều khiển** — `http://localhost:32060/dashboard`
- Luồng Providers & OAuth, combos, endpoints + API keys, mức dùng theo từng key, hạn mức, trình tiết kiệm token, translator console, trang thiết lập công cụ CLI, cài đặt định giá — với hơn 34 ngôn ngữ giao diện

---

## 🚀 Bắt đầu nhanh

### Lựa chọn A — Docker (khuyến nghị)

```bash
docker login ghcr.io          # PAT with read:packages — the image is private
docker pull ghcr.io/yumamax3/vela:0.6.70

docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:0.6.70
```

Để xem hải đồ đầy đủ — bản song sinh MariaDB, tư thế mirror, engine sao lưu, sidecar Headroom — hãy xem [DOCKER.md](../DOCKER.md) và mẫu [`docker-compose.example.yml`](../docker-compose.example.yml).

### Lựa chọn B — npm CLI

```bash
npm install -g vela
vela
```

CLI cài đặt, khởi chạy và quản lý máy chủ (gói khởi chạy giữ tên `vela` trên npm).

### Lựa chọn C — Từ mã nguồn

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Production: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Sau đó kết nối một công cụ

1. Mở `http://localhost:32060/dashboard` (mật khẩu mặc định `123456` — hãy đổi ngay)
2. **Providers** → kết nối một nhà cung cấp (Kiro AI là điểm khởi đầu miễn phí tốt)
3. **Endpoints** → sao chép một API key
4. Trỏ công cụ của bạn về gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Tài liệu

Hải đồ nằm ở [`docs/`](../docs/README.md) — bản đồ đầy đủ của bến cảng.

| Hải đồ | Nội dung |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 Bản đồ bến cảng — mọi tài liệu, một trang |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Vòng đời request, engine translator, registry nhà cung cấp, tầng DB |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Các đường cài đặt, hải đồ compose, tư thế lưu trữ, nâng cấp |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Toàn bộ giao ước biến môi trường |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Storage Covenant — sqlite/mysql/mirror, sao lưu, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 Danh sách đầy đủ 129 nhà cung cấp |
| [docs/API.md](../docs/API.md) | 🔌 Bề mặt tương thích OpenAI + API bảng điều khiển |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Khi gió lặng |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Giao ước đánh phiên bản |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, chuyên sâu |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Nhật ký hải trình |

**Dành cho kỹ sư làm việc trong repo này:** [CLAUDE.md](../CLAUDE.md) — giấy tờ của thủy thủ đoàn.
**Dành cho người đóng góp vào engine:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cách thêm provider / executor / translator.

---

## 🗺️ Bản đồ kho mã

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             pages + API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups

open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (29 specialized + default)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (129 files) + pricing covenant
└── rtk/             token saver hooks (fail-open)

cli/                 the launcher package (npm: vela)
docs/                the charts — start at docs/README.md
plans/               sealed design plans (Storage Covenant, Pricing Covenant…)
tests/               vitest suite (independent ESM package)
i18n/                localized READMEs (10 languages)
```

---

## 🌐 Ngôn ngữ

README này được dịch sang 10 ngôn ngữ khác — liên kết nằm ở banner phía trên. Bản thân bảng điều khiển có hơn 34 ngôn ngữ giao diện; chuyển đổi từ trang hồ sơ trên bảng điều khiển.

---

## 🏛️ Nguồn gốc & Giấy phép

Vela dong buồm theo hải trình riêng từ v0.6.0 — gateway được cấp phép MIT và hoàn toàn là của riêng mình. Xem [LICENSE](../LICENSE).

---

<div align="center">

*Hãy căng buồm. Gió miễn phí.* ⛵

</div>
