<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — cánh buồm của con tàu" width="520"/>

  **Một endpoint tương thích OpenAI. 145 kênh upstream có thể quay số. Gói thuê bao của bạn, API key của bạn, gói miễn phí của bạn — một bến cảng, một cánh buồm.**

  Vela định tuyến các công cụ lập trình AI của bạn (Claude Code, Codex, Cursor, Cline, OpenCode…) qua một gateway cục bộ duy nhất, với chuyển đổi định dạng, fallback theo tổ hợp model, luân phiên đa tài khoản, theo dõi hạn mức, ACL theo từng key, và trình tiết kiệm token RTK cắt giảm 20–40% token đầu ra của công cụ trước khi chúng rời bến.

  [![Version](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
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
│                  Vela — the gateway                 │
│  RTK token saver · format translation · quota track │
│  combo fallback · multi-account · OAuth refresh     │
└──────────┬──────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…
       Result: every subscription token spent, every rate limit routed around.
```

Một tiến trình Node phục vụ cả hai engine: **bảng điều khiển + API** (`src/`, ứng dụng Next.js App Router) và **engine định tuyến** (`open-sse/`), trên cổng **32060**. Trạng thái mặc định sống trong SQLite và có thể mọc thêm một bản song sinh MariaDB khi bạn muốn (`sqlite` → `mysql` → `mirror`). Một engine sao lưu niêm phong canh giữ nền đất của bến cảng, và gateway đóng dấu mọi bản phát hành để thân tàu luôn có thể được chứng minh.

> 📌 **Ghi chú:** Vela dong buồm theo hải trình riêng — một cổng AI được rèn từ vùng nước mở, với mọi hệ thống là của riêng mình: lưu trữ, sao lưu, định giá và phân loại. CLI cài đặt dưới tên `vela` từ npm. Dòng dõi fork: từ v0.6.0 trở đi, gateway được cấp phép MIT và hoàn toàn là của riêng mình (xem [Nguồn gốc](#-provenance--license)).

> 🔢 **Kỷ luật con số** (đo ngày 2026-10-28, tại v1.2.4). Registry nhà cung cấp báo **ba con số trung thực, và chúng khác nhau**: **189** tệp registry trên đĩa → **186** được chỉ mục sinh tự động nhập → **145** kênh chat có thể quay số (41 kênh đã nhập còn lại mang các transport media, search và embedding vốn dĩ không nói chat). Ba tệp nằm trên đĩa nhưng cố ý bị ẩn khỏi chỉ mục (`trae`, `devin-cli`, `windsurf`). Đừng bao giờ gộp ba con số thành một — hãy nêu rõ bạn muốn nói con số nào, và tự tính lại thay vì tin dòng này:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 tệp trên đĩa
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 đã nhập
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 có thể quay số
> ```
> Bản điều tra này được ghim như một thuộc tính bởi `tests/unit/provider-registry-census.test.js` — một tệp đáp xuống đĩa mà không được nhập sẽ làm nó đỏ lên trước khi nó lặng lẽ tắt đèn. Xem [docs/PROVIDERS.md](../docs/PROVIDERS.md).

---

## 🤔 Vì sao chọn Vela?

| Vấn đề | Vela làm gì |
|-|-|
| ❌ Hạn mức thuê bao hết hạn mà chưa dùng | ✅ Theo dõi hạn mức + fallback tự động — tiêu hết từng token trước khi reset |
| ❌ Rate limit chặn đứng bạn giữa dòng chảy | ✅ Luân phiên đa tài khoản + fallback theo tổ hợp model, downtime bằng không |
| ❌ Đầu ra của công cụ đốt token (diff, grep, ls…) | ✅ **Trình tiết kiệm token RTK** nén nội dung `tool_result` tại chỗ — tiết kiệm 20–40% |
| ❌ Trả $20–50/tháng cho mỗi nhà cung cấp | ✅ Một gateway xuyên suốt các luồng thuê bao + giá rẻ + miễn phí |
| ❌ Mỗi công cụ cần cấu hình riêng | ✅ Một endpoint tương thích OpenAI, mọi công cụ đều nói chung ngôn ngữ |
| ❌ Một nhà cung cấp gục xuống và dòng chảy của bạn chết theo | ✅ Circuit breaker + ngưỡng lỗi nhà cung cấp + cửa sổ làm nguội |

---

## ✨ Tính năng chính

**🧭 Định tuyến & Chuyển đổi định dạng**
- Một endpoint tương thích OpenAI: `/v1/chat/completions`, `/v1/messages` (Claude bản địa), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (tạo, sửa, mở rộng), `/v1/responses` (+`/compact`), `/v1beta/*`, web search, fetch & scrape
- Chuyển đổi định dạng xoay quanh OpenAI làm dạng trung gian — các tuyến trực tiếp được đăng ký cho những cặp dễ vỡ (thinking block, tool id)
- **145 nhà cung cấp có thể quay số** trên các luồng thuê bao, trả theo lượt dùng, miễn phí, cục bộ và media — [danh sách đầy đủ](../docs/PROVIDERS.md)
- Địa chỉ model là `provider/model` (`kr/claude-sonnet-4.5`) — tiền tố gọi tên luồng

**🪂 Khả năng chống chịu**
- Fallback theo tổ hợp model: định nghĩa một tổ hợp, Vela sẽ đi dọc danh sách cho đến khi có nơi trả lời
- Fallback đa tài khoản cho từng nhà cung cấp, luân phiên round-robin
- Circuit breaker theo từng pool — và breaker **sống sót qua khởi động lại**: các cửa sổ mở được giữ qua store liên kết, hạn chót bị kẹp về một trần, và một breaker được phục hồi sẽ giương lại chỉ sau một lần thất bại, khớp với luật trong tiến trình
- Ngưỡng lỗi nhà cung cấp với cửa sổ làm nguội (`VELA_PROVIDER_FAILURE_*`), quản lý thông tin xác thực OAuth + API-key với tự động làm mới token trong nền

**💰 Trí tuệ chi phí — Giao ước Định giá (Pricing Covenant)**
- Bảng giá tĩnh (input / output / cached / reasoning / cache-creation, $/1M token) với chuỗi phân giải sáu bước — ghi đè theo nhà cung cấp, khớp chính xác, kế thừa model miễn phí, bóc tên vendor, fallback glob
- Trình chỉnh sửa giá trên bảng điều khiển + đồng bộ models.dev — mọi request đều nhận được chi phí ước tính trung thực
- Phát hiện gói miễn phí: model miễn phí kế thừa đơn giá của người anh em trả phí, để mức tiết kiệm luôn hiển thị
- Chi phí được tính **tại thời điểm ghi** và đóng băng — không backfill, không tính lại sau khi sửa đơn giá

**🐚 Trình tiết kiệm token RTK**
- Các hook trước khi chuyển đổi nén nội dung `tool_result` trước khi request rời bến — thiết kế fail-open, không bao giờ chạm vào trace `is_error`
- Trình tiêm prompt do người vận hành định nghĩa (append/prepend), xếp lớp sau các trình tiết kiệm có sẵn
- Sidecar [Headroom](https://github.com/chopratejas/headroom) tùy chọn để nén sâu hơn

**🗝️ Giao ước Lưu trữ (Storage Covenant)**
- Ba tư thế, một biến môi trường: `VELA_DB_MODE=sqlite|mysql|mirror`
- Bến SQLite mặc định; MariaDB như một bến đầy đủ; hoặc **mirror** — SQLite phục vụ trong khi mọi thao tác ghi được bơm sang bản song sinh MariaDB qua outbox, được canh giữ bởi divergence sweep
- Chuỗi driver: `better-sqlite3` → `node:sqlite` (không cần cài trên Node ≥ 22.5) → `sql.js` thuần JS; `VELA_DB_DRIVER` ghim một driver, lỗi sẽ vang to
- **23 migration** (`SCHEMA_VERSION = 23`) — một bản đồng bộ `TABLES` khai báo giữ cả hai bến và bản song sinh trung thực — xem [docs/STORAGE.md](../docs/STORAGE.md)
- Engine sao lưu niêm phong: artifact AES-256-GCM, các tầng lưu giữ, **diễn tập** khôi phục, chặng S3 off-site tùy chọn

**🛡️ Bảo mật**
- ACL theo từng key — bốn lớp: loại, nhà cung cấp, tổ hợp, model (danh sách cho phép ba trạng thái)
- Cổng ngân sách: hạn mức ngày, hạn mức chi tiêu, rate limit theo từng key
- **Không có mật khẩu mặc định.** Mật khẩu `123456` cũ đã bị khai tử (v0.9.41). Khi chưa đặt mật khẩu, bảng điều khiển cục bộ cho bạn vào mà không cần mật khẩu nhưng **từ chối đăng nhập từ xa** cho đến khi bạn đặt một mật khẩu (Cài đặt → Truy cập). API key được phát hành dưới dạng `vela-v1-<32 hex>-<8 hex>`; định dạng `sk-` bị từ chối ở mọi nơi
- Đăng nhập một lần OIDC và SAML cho bảng điều khiển, cổng kiểm tra độ mạnh JWT khi khởi động, một sổ phiên khóa theo `jti`, một khóa CSRF, và IP client được suy ra từ **socket TCP** (không thể giả mạo) — header chuyển tiếp chỉ được tin từ một proxy vòng lặp

**🖥️ Bảng điều khiển** — `http://localhost:32060/dashboard`
- **31 phòng bảng điều khiển** (tổng cộng 36 trang) trong **35 ngôn ngữ giao diện**: providers & luồng OAuth, combos, endpoints + API keys, mức dùng theo từng key, hạn mức, trình tiết kiệm token, translator console, thiết lập công cụ CLI, đội proxy, quy tắc fallback, trình tiêm prompt, skills, nhật ký request, và console cài đặt — hãy bắt đầu từ [bản đồ bến cảng](../docs/README.md)

---

## 🚀 Bắt đầu nhanh

### Lựa chọn A — Docker (khuyến nghị)

```bash
docker pull ghcr.io/yumamax3/vela:1.2.4
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.4
```

Image là **công khai** — không cần đăng nhập registry — và đa kiến trúc (`linux/amd64` + `linux/arm64`). Để xem hải đồ đầy đủ — bản song sinh MariaDB, tư thế mirror, engine sao lưu, sidecar Headroom — hãy xem [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md), và mẫu [`docker-compose.example.yml`](../docker-compose.example.yml).

### Lựa chọn B — npm CLI

```bash
npm install -g vela
vela
```

Trình khởi chạy cài đặt, khởi động và quản lý máy chủ (gói npm giữ tên `vela`; ứng dụng là `vela-app` riêng tư). Xem [cli/README.md](../cli/README.md).

### Lựa chọn C — Từ mã nguồn

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # phục vụ trên 32060
```

Production: `npm run build && npm run start` (Node 22+; Bun cũng chạy được — `npm run dev:bun` / `build:bun` / `start:bun`).

### Sau đó kết nối một công cụ

1. Mở `http://localhost:32060/dashboard` — **không có mật khẩu mặc định.** Console cục bộ vào được mà không cần mật khẩu; hãy đặt mật khẩu trong **Cài đặt → Truy cập** để bật truy cập từ xa.
2. **Providers** → kết nối một nhà cung cấp (Kiro AI là điểm khởi đầu miễn phí tốt)
3. **Endpoints** → phát hành một API key
4. Trỏ công cụ của bạn về gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (từ bảng điều khiển)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

Cách nối dây từng công cụ (Claude Code, Codex, Cursor, Cline, Roo, Continue) nằm trong [hải đồ tích hợp](../gitbook/content/en/) — và các agent skill dán là chạy nằm ở [skills/](../skills/README.md).

---

## 📚 Tài liệu

Các hải đồ nằm trong [`docs/`](../docs/README.md) — hãy bắt đầu từ bản đồ bến cảng. Mọi tài liệu mang cùng một giọng, và mọi con số mang theo lệnh tự tính lại: **nếu hải đồ và lệnh mâu thuẫn, lệnh thắng.**

| Hải đồ | Nội dung |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 Bản đồ bến cảng — mọi tài liệu, một trang |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Vòng đời request, engine translator, registry nhà cung cấp, tầng DB, engine sao lưu, giao ước định giá |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Các đường cài đặt, hải đồ compose, phơi bày & cổng bảo mật, nâng cấp |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Toàn bộ giao ước biến môi trường |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ Giao ước Lưu trữ — sqlite/mysql/mirror, máy bơm mirror, sao lưu, S3, phục hồi |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 Danh sách nhà cung cấp, ba con số, mô hình executor |
| [docs/API.md](../docs/API.md) | 🔌 Bề mặt tương thích OpenAI + bề mặt REST của bảng điều khiển |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Triệu chứng → nguyên nhân → cách sửa |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Giao ước đánh phiên bản — bump, ghi log, niêm phong cùng nhau |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, chuyên sâu |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Nhật ký hải trình |

Người mới: [gitbook](../gitbook/content/en/) là chuyến tham quan dành cho người bắt đầu, bằng năm ngôn ngữ. **Dành cho kỹ sư làm việc trong repo này:** [CLAUDE.md](../CLAUDE.md) — giấy tờ của thủy thủ đoàn. **Dành cho người đóng góp vào engine:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cách thêm provider / executor / translator.

---

## 🗺️ Bản đồ kho mã

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             36 pages (31 dashboard rooms) + 255 API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups
open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (43 files incl. index)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (190 files incl. index) + pricing covenant
└── rtk/             token saver hooks (fail-open)
cli/                 the launcher package (npm: vela)
docs/                the charts — start at docs/README.md
gitbook/            the beginner tour — 100 pages × 5 languages
skills/             drop-in agent skills (paste a link, done)
tests/              the vitest suite — 480 live test files
i18n/               localized READMEs (10 languages)
plans/               sealed design plans (internal, gitignored)
scripts/             changelog sync, registry generator, icon subset
```

---

## 🌍 Ngôn ngữ

README này được dịch sang 10 ngôn ngữ khác — liên kết nằm ở banner phía trên. Bản thân bảng điều khiển có **35 ngôn ngữ giao diện**; chuyển đổi từ **Cài đặt → Chung → Ngôn ngữ**.

---

## 🏛️ Nguồn gốc & Giấy phép

Vela dong buồm theo hải trình riêng từ v0.6.0 trở đi — gateway được cấp phép MIT và hoàn toàn là của riêng mình. Xem [LICENSE](../LICENSE).

---

<div align="center">
*Căng buồm lên. Gió là miễn phí.* ⛵
</div>
