<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — بادبان کشتی" width="520"/>

  **یک نقطه پایانی سازگار با OpenAI. بیش از ۴۰ ارائه‌دهنده بالادست. اشتراک‌های شما، کلیدهای شما، لایه‌های رایگان شما — یک بندر، یک بادبان.**

  Vela ابزارهای کدنویسی هوش مصنوعی شما (Claude Code، Codex، Cursor، Cline، OpenCode و…) را از طریق یک دروازه محلی واحد هدایت می‌کند؛ با ترجمه فرمت، بازگشت بر اساس ترکیب مدل‌ها، چرخش چندحسابی، ردیابی سهمیه و صرفه‌جوی توکن RTK که ۲۰ تا ۴۰٪ از توکن‌های خروجی ابزارها را پیش از ترک بندر می‌کاهد.

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 شروع سریع](#-شروع-سریع) · [✨ ویژگی‌های کلیدی](#-ویژگی‌های-کلیدی) · [📚 مستندات](#-مستندات) · [🌐 زبان‌ها](#-زبان‌ها)

  🇺🇸 [English](./README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇬🇧 این ترجمه فارسی است. نسخه اصلی انگلیسی در اینجاست: [README.md](../README.md)

---

## ⛵ Vela چیست؟

Vela یک **دروازه مسیریابی هوش مصنوعی محلی + داشبورد** است. همه ابزارهای هوش مصنوعی خود را به یک نقطه پایانی متصل می‌کنید — `http://localhost:32060/v1` — و Vela تصمیم می‌گیرد کدام ارائه‌دهنده واقعاً پاسخ دهد: نخست اشتراک‌های پولی شما، سپس مسیرهای ارزان API، و در آخر لایه‌های رایگان. وقتی مسیری خشک شود، مسیر بعدی بادبان را برمی‌افرازد. بدون هیچ تغییری در ابزارها و بدون توقف.

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

در زیر کاپوت: یک سرور Next.js (داشبورد + API) روی پورت **۳۲۰۶۰**، یک موتور مسیریابی مستقل از ارائه‌دهنده (`open-sse/`)، و یک پایگاه داده SQLite که هر وقت بخواهید می‌تواند یک دوقلوی MariaDB داشته باشد (sqlite → mysql → mirror).

> 📌 **توجه:** Vela مسیر خودش را می‌پیماید — یک درگاه هوش مصنوعی ساخته‌شده از آب‌های آزاد، با تمام سیستم‌های اختصاصی: ذخیره‌سازی، پشتیبان‌گیری، قیمت‌گذاری و دسته‌بندی. CLI با نام `vela` از npm نصب می‌شود.

---

## 🤔 چرا Vela؟

| مشکل | کاری که Vela انجام می‌دهد |
|-|-|
| ❌ سهمیه اشتراک بدون استفاده منقضی می‌شود | ✅ ردیابی سهمیه + بازگشت خودکار — هر توکن را پیش از بازنشانی خرج کنید |
| ❌ محدودیت نرخ در میانه کار شما را متوقف می‌کند | ✅ چرخش چندحسابی + بازگشت ترکیب مدل‌ها، بدون هیچ توقفی |
| ❌ خروجی ابزارها توکن می‌سوزاند (diffها، grep، ls…) | ✅ **صرفه‌جوی توکن RTK** محتوای `tool_result` را درجا فشرده می‌کند — ۲۰ تا ۴۰٪ صرفه‌جویی |
| ❌ پرداخت ۲۰ تا ۵۰ دلار در ماه برای هر ارائه‌دهنده | ✅ یک دروازه روی مسیرهای اشتراکی + ارزان + رایگان |
| ❌ هر ابزار پیکربندی جداگانه خودش را می‌خواهد | ✅ یک نقطه پایانی سازگار با OpenAI، همه ابزارها آن را می‌فهمند |

---

## ✨ ویژگی‌های کلیدی

**🧭 مسیریابی و ترجمه**
- یک نقطه پایانی سازگار با OpenAI: `/v1/chat/completions`، `/v1/messages` (بومی Claude)، `/v1/embeddings`، `/v1/images/generations`، `/v1/audio/*`، `/v1/responses`، `/v1/videos/*`، جستجو و واکشی وب
- ترجمه فرمت از OpenAI به عنوان فرمت میانی استفاده می‌کند — برای جفت‌های حساس مسیر مستقیم ثبت شده است (بلاک‌های thinking، شناسه‌های ابزار)
- **۱۲۹ ارائه‌دهنده** ثبت شده: OpenAI، Anthropic، Google Gemini، xAI، DeepSeek، Qwen، GLM، MiniMax، Kimi، Mistral، Groq، Cerebras، Vertex، Azure، Ollama و ده‌ها مورد دیگر — [فهرست کامل](../docs/PROVIDERS.md)

**🪂 تاب‌آوری**
- بازگشت بر اساس ترکیب مدل‌ها: یک ترکیب تعریف کنید و Vela فهرست را طی می‌کند تا یکی پاسخ دهد
- بازگشت چندحسابی برای هر ارائه‌دهنده، چرخش round-robin
- مدیریت اعتبارنامه‌های OAuth + کلید API با بازسازی خودکار توکن

**💰 هوشمندی هزینه — میثاق قیمت‌گذاری**
- جدول قیمت ایستا (ورودی / خروجی / کش‌شده / استدلال / ساخت کش، دلار بر میلیون توکن) با زنجیره حل شش‌مرحله‌ای — بازنویسی ارائه‌دهنده، تطابق دقیق، ارث‌بری مدل رایگان، حذف vendor، بازگشت glob
- ویرایشگر قیمت داشبورد + همگام‌سازی models.dev — هر درخواست هزینه تخمینی صادقانه خود را می‌گیرد
- تشخیص لایه رایگان: مدل‌های رایگان نرخ مدل پولی هم‌خانواده خود را به ارث می‌برند تا صرفه‌جویی‌ها قابل مشاهده باشند

**🐚 صرفه‌جوی توکن RTK**
- قلاب‌های پیش از ترجمه محتوای `tool_result` را پیش از خروج درخواست فشرده می‌کنند — به‌صورت fail-open طراحی شده‌اند و هرگز به traceهای `is_error` دست نمی‌زنند
- سایدکار اختیاری [Headroom](https://github.com/chopratejas/headroom) برای فشرده‌سازی عمیق‌تر

**🗝️ میثاق ذخیره‌سازی**
- سه حالت، یک متغیر محیطی: `VELA_DB_MODE=sqlite|mysql|mirror`
- بندر SQLite به‌صورت پیش‌فرض؛ MariaDB به عنوان بندر کامل؛ یا **mirror** — SQLite سرویس می‌دهد در حالی که هر نوشتن به دوقلوی MariaDB پمپ می‌شود، زیر نگاه یک جاروی تشخیص انحراف
- موتور پشتیبان‌گیری پلمب‌شده: آرمان‌های AES-256-GCM، سطوح نگهداری، تمرین + بازیابی، و پای اختیاری S3 در خارج از سایت

**🖥️ داشبورد** — `http://localhost:32060/dashboard`
- ارائه‌دهندگان و جریان‌های OAuth، ترکیب‌ها، نقاط پایانی + کلیدهای API، استفاده به تفکیک کلید، سهمیه، صرفه‌جوی توکن، کنسول مترجم، صفحات راه‌اندازی ابزارهای CLI، تنظیمات قیمت‌گذاری — در بیش از ۳۴ زبان رابط کاربری

---

## 🚀 شروع سریع

### گزینه A — Docker (پیشنهاد می‌شود)

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

برای نقشه کامل — دوقلوی MariaDB، حالت mirror، موتور پشتیبان‌گیری، سایدکار Headroom — به [DOCKER.md](../DOCKER.md) و قالب [`docker-compose.example.yml`](../docker-compose.example.yml) مراجعه کنید.

### گزینه B — npm CLI

```bash
npm install -g vela
vela
```

CLI سرور را نصب، اجرا و مدیریت می‌کند (بسته راه‌انداز نام `vela` را در npm حفظ می‌کند).

### گزینه C — از سورس

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

محیط تولید: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### سپس یک ابزار متصل کنید

1. آدرس `http://localhost:32060/dashboard` را باز کنید (رمز عبور پیش‌فرض `123456` — آن را تغییر دهید)
2. **Providers** → یکی را متصل کنید (Kiro AI شروع رایگان خوبی است)
3. **Endpoints** → یک کلید API را کپی کنید
4. ابزار خود را به دروازه متصل کنید:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 مستندات

نقشه‌ها در [`docs/`](../docs/README.md) زندگی می‌کنند — نقشه کامل بندر.

| نقشه | چه چیزی را پوشش می‌دهد |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 نقشه بندر — همه مستندات در یک صفحه |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ چرخه عمر درخواست، موتور مترجم، رجیستری ارائه‌دهندگان، لایه پایگاه داده |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 مسیرهای نصب، نقشه compose، حالت‌های ذخیره‌سازی، ارتقا |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 قرارداد کامل متغیرهای محیطی |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ میثاق ذخیره‌سازی — sqlite/mysql/mirror، پشتیبان‌گیری‌ها، S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 فهرست کامل ۱۲۹ ارائه‌دهنده |
| [docs/API.md](../docs/API.md) | 🔌 سطح سازگار با OpenAI + APIهای داشبورد |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 وقتی باد از حرکت می‌ایستد |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ میثاق نسخه‌بندی |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker، عمیق |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 دفترچه سفر کشتی |

**برای مهندسانی که در این مخزن کار می‌کنند:** [CLAUDE.md](../CLAUDE.md) — اسناد خدمه.
**برای مشارکت‌کنندگان موتور:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — نحوه افزودن ارائه‌دهنده / اجراکننده / مترجم.

---

## 🗺️ نقشه مخزن

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

## 🌍 زبان‌ها

این README به ۱۰ زبان دیگر نیز ترجمه شده است — پیوندها در بنر بالا آمده است. خود داشبورد بیش از ۳۴ زبان رابط کاربری را عرضه می‌کند؛ از صفحه پروفایل داشبورد آن را تغییر دهید.

---

## 🏛️ خاستگاه و پروانه

Vela از نسخه v0.6.0 به بعد مسیر خودش را می‌پیماید — درگاه با مجوز MIT و کاملاً مستقل است. به [LICENSE](../LICENSE) مراجعه کنید.

---

<div align="center">

*بادبان خود را برافراشته کنید. باد رایگان است.* ⛵

</div>
