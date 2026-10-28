<div dir="rtl">

<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — بادبان کشتی" width="520"/>

  **یک نقطه پایانی سازگار با OpenAI. ۱۴۵ ترابری بالادستِ قابل اتصال. اشتراک‌های شما، کلیدهای شما، لایه‌های رایگان شما — یک بندر، یک بادبان.**

  Vela ابزارهای کدنویسی هوش مصنوعی شما (Claude Code، Codex، Cursor، Cline، OpenCode و…) را از طریق یک دروازهٔ محلی واحد عبور می‌دهد؛ با ترجمهٔ قالب، بازگشت از طریق ترکیب مدل‌ها، چرخش چندحسابی، ردیابی سهمیه، ACL به‌ازای هر کلید، و صرفه‌جوی توکن RTK که ۲۰ تا ۴۰٪ از توکن‌های خروجی ابزارها را پیش از آن‌که بندر را ترک کنند می‌کاهد.

  [![Version](https://img.shields.io/badge/version-1.2.5-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 شروع سریع](#-شروع-سریع) · [✨ ویژگی‌های کلیدی](#-ویژگی‌های-کلیدی) · [📚 مستندات](#-مستندات) · [🌐 زبان‌ها](#-زبان‌ها)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇬🇧 این ترجمهٔ فارسی است. نسخهٔ اصلی انگلیسی اینجاست: [README.md](../README.md)

---

## ⛵ Vela چیست؟

Vela یک **دروازهٔ مسیریابی هوش مصنوعی محلی + داشبورد** است. همهٔ ابزارهای هوش مصنوعی خود را به یک نقطه پایانی متصل می‌کنید — `http://localhost:32060/v1` — و Vela تصمیم می‌گیرد کدام ارائه‌دهنده واقعاً پاسخ دهد: نخست اشتراک‌های پولی شما، سپس مسیرهای ارزان API، و در آخر لایه‌های رایگان. وقتی یک مسیر خشک شود، مسیر بعدی باد را می‌گیرد. بدون هیچ تغییری در سمت ابزارها، بدون توقف.

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

یک فرایند <bdi>Node</bdi> هر دو موتور را سرویس می‌دهد: **داشبورد + API** (`src/`، یک اپلیکیشن <bdi>Next.js App Router</bdi>) و **موتور مسیریابی** (`open-sse/`)، روی پورت **32060**. وضعیت به‌صورت پیش‌فرض در <bdi>SQLite</bdi> زندگی می‌کند و هرگاه بخواهید می‌تواند یک دوقلوی <bdi>MariaDB</bdi> پیدا کند (`sqlite` → `mysql` → `mirror`). یک موتور پشتیبان‌گیری پلمب‌شده بستر بندر را می‌پاید، و دروازه هر انتشار را مهر می‌زند تا بدنهٔ کشتی همیشه قابل اثبات باشد.

> 📌 **توجه:** Vela مسیر خودش را می‌رود — دروازه‌ای هوش مصنوعی که در آب‌های باز ساخته شده، با همهٔ سیستم‌های خودش: ذخیره‌سازی، پشتیبان‌گیری، قیمت‌گذاری و دسته‌بندی. CLI با نام `vela` از npm نصب می‌شود. تبار فورک: از v0.6.0 به بعد دروازه تحت مجوز MIT است و کاملاً مستقل (به [خاستگاه و پروانه](#-خاستگاه-و-پروانه) نگاه کنید).

> 🔢 **انضباط شمارش** (اندازه‌گیری‌شده در 2026-10-28، در v1.2.5). رجیستری ارائه‌دهندگان **سه عدد صادقانه گزارش می‌دهد، و آن‌ها متفاوت‌اند**: **۱۸۹** فایل رجیستری روی دیسک → **۱۸۶** فایل واردشده توسط اندیس تولیدشده → **۱۴۵** ترابری گفت‌وگوی قابل اتصال (۴۱ مسیر واردشدهٔ دیگر، ترابری‌های رسانه، جستجو و جاسازی را حمل می‌کنند که به‌حق به زبان چت سخن نمی‌گویند). سه فایل عامدانه روی دیسک و پنهان از اندیس نشسته‌اند (`trae`، `devin-cli`، `windsurf`). هرگز آن سه عدد را در یکی ادغام نکنید — بنامید که کدام عدد را می‌گویید، و بازمحاسبه کنید تا به این خط اتکا نکنید:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> این سرشماری به‌عنوان یک ویژگی توسط `tests/unit/provider-registry-census.test.js` تثبیت شده است — فایلی که بی‌واردشدن روی دیسک بنشیند، پیش از آن‌که بی‌صدا تاریک شود، آنجا سرخ می‌شود. [docs/PROVIDERS.md](../docs/PROVIDERS.md) را ببینید.

---

## 🤔 چرا Vela؟

| مشکل | کاری که Vela می‌کند |
|-|-|
| ❌ سهمیهٔ اشتراک استفاده‌نشده منقضی می‌شود | ✅ ردیابی سهمیه + بازگشت خودکار — هر توکن را پیش از بازنشانی خرج کنید |
| ❌ محدودیت نرخ در میانهٔ کار شما را متوقف می‌کند | ✅ چرخش چندحسابی + بازگشت ترکیب مدل‌ها، بدون هیچ توقفی |
| ❌ خروجی ابزارها توکن می‌سوزاند (diffها، grep، ls…) | ✅ **صرفه‌جوی توکن RTK** محتوای `tool_result` را درجا فشرده می‌کند — ۲۰ تا ۴۰٪ صرفه‌جویی |
| ❌ پرداخت ۲۰ تا ۵۰ دلار در ماه برای هر ارائه‌دهنده | ✅ یک دروازه روی مسیرهای اشتراکی + ارزان + رایگان |
| ❌ هر ابزار پیکربندی خودش را می‌خواهد | ✅ یک نقطه پایانی سازگار با OpenAI، همهٔ ابزارها آن را می‌فهمند |
| ❌ یک ارائه‌دهنده می‌میرد و جریان شما با آن می‌میرد | ✅ قطع‌کن مدار + آستانه‌های شکست ارائه‌دهنده + پنجره‌های خنک‌سازی |

---

## ✨ ویژگی‌های کلیدی

**🧭 مسیریابی و ترجمه**
- یک نقطه پایانی سازگار با OpenAI: `/v1/chat/completions`، `/v1/messages` (بومی <bdi>Claude</bdi>)، `/v1/embeddings`، `/v1/images/generations`، `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`، `/v1/videos/*` (تولید، ویرایش، گسترش)، `/v1/responses` (+`/compact`)، `/v1beta/*`، جستجوی وب، واکشی و خراش
- ترجمهٔ قالب از <bdi>OpenAI</bdi> به‌عنوان قالب میانی عبور می‌کند — برای جفت‌های شکننده مسیرهای مستقیم ثبت شده‌اند (بلوک‌های <bdi>thinking</bdi>، شناسه‌های ابزار)
- **۱۴۵ ارائه‌دهندهٔ قابل اتصال** در مسیرهای اشتراکی، پرداخت‌به‌ازای‌مصرف، رایگان، محلی و رسانه — [فهرست کامل](../docs/PROVIDERS.md)
- آدرس‌دهی مدل به شکل <bdi>`provider/model`</bdi> است (<bdi>`kr/claude-sonnet-4.5`</bdi>) — پیشوند نام مسیر را می‌گوید

**🪂 تاب‌آوری**
- بازگشت ترکیب مدل‌ها: یک ترکیب تعریف کنید، Vela فهرست را طی می‌کند تا یکی پاسخ دهد
- بازگشت چندحسابی برای هر ارائه‌دهنده، چرخش گردشی (<bdi>round-robin</bdi>)
- قطع‌کن مدار برای هر استخر — و قطع‌کن **از راه‌اندازی دوباره جان سالم به در می‌برد**: پنجره‌های باز از طریق انبار مقید باقی می‌مانند، مهلت‌ها تا سقفی محدود می‌شوند، و قطع‌کنِ بازیابی‌شده با یک شکست دوباره مسلح می‌شود— هم‌سان با قانون درون‌فرایندی
- آستانه‌های شکست ارائه‌دهنده با پنجره‌های خنک‌سازی (`VELA_PROVIDER_FAILURE_*`)، مدیریت اعتبارنامه‌های <bdi>OAuth</bdi> + کلید API با بازتازه‌سازی خودکار پس‌زمینهٔ توکن

**💰 هوشمندی هزینه — میثاق قیمت‌گذاری**
- جدول قیمت ایستا (ورودی / خروجی / کش‌شده / استدلال / ساخت کش، دلار به‌ازای یک میلیون توکن) با زنجیرهٔ حل شش‌مرحله‌ای — بازنویسی‌های ارائه‌دهنده، تطابق دقیق، ارث‌بری مدل رایگان، حذف فروشنده، بازگشت <bdi>glob</bdi>
- ویرایشگر قیمت داشبورد + همگام‌سازی با <bdi>models.dev</bdi> — هر درخواست هزینهٔ تخمینی صادقانه‌ای می‌گیرد
- تشخیص لایهٔ رایگان: مدل‌های رایگان نرخ خواهر پولی خود را به ارث می‌برند تا صرفه‌جویی‌ها دیدنی بمانند
- هزینه در **زمان نوشتن** محاسبه و منجمد می‌شود — نه پرکردن عقب‌رو، نه بازمحاسبه پس از ویرایش نرخ‌ها

**🐚 صرفه‌جوی توکن RTK**
- قلاب‌های پیش از ترجمه محتوای `tool_result` را پیش از ترک درخواست فشرده می‌کنند — به‌صورت <bdi>fail-open</bdi> طراحی شده‌اند و هرگز به ردهای `is_error` دست نمی‌زنند
- تزریق‌کننده‌های پرامپت تعریف‌شده توسط اپراتور (افزودن به انتها/ابتدا) که پس از صرفه‌جوهای درونی لایه‌بندی می‌شوند
- سایدکار اختیاری [Headroom](https://github.com/chopratejas/headroom) برای فشرده‌سازی عمیق‌تر

**🗝️ میثاق ذخیره‌سازی**
- سه حالت، یک متغیر محیطی: `VELA_DB_MODE=sqlite|mysql|mirror`
- بندر <bdi>SQLite</bdi> به‌صورت پیش‌فرض؛ <bdi>MariaDB</bdi> به‌عنوان بندری کامل؛ یا **<bdi>mirror</bdi>** — <bdi>SQLite</bdi> سرویس می‌دهد در حالی که هر نوشتن از طریق یک <bdi>outbox</bdi> به دوقلوی <bdi>MariaDB</bdi> پمپ می‌شود؛ زیر نگاه یک جاروی واگرایی
- زنجیرهٔ درایور: <bdi>`better-sqlite3`</bdi> → <bdi>`node:sqlite`</bdi> (نصب‌صفر روی <bdi>Node ≥ 22.5</bdi>) → <bdi>`sql.js`</bdi> خالص جاوااسکریپت؛ <bdi>`VELA_DB_DRIVER`</bdi> یکی را تثبیت می‌کند، شکست بلند و رسا است
- **۲۳ مهاجرت** (<bdi>`SCHEMA_VERSION = 23`</bdi>) — یک همگام‌سازی اعلانی <bdi>`TABLES`</bdi> هر دو بندر و دوقلو را صادق نگه می‌دارد — [docs/STORAGE.md](../docs/STORAGE.md) را ببینید
- موتور پشتیبان‌گیری پلمب‌شده: مصنوعات <bdi>AES-256-GCM</bdi>، سطوح نگهداری، **تمرین** بازیابی، پای اختیاری <bdi>S3</bdi> در بیرون از سایت

**🛡️ امنیت**
- ACL به‌ازای هر کلید — چهار لایه: انواع، ارائه‌دهندگان، ترکیب‌ها، مدل‌ها (فهرست‌های مجاز سه‌حالته)
- دروازه‌های بودجه: سقف‌های روزانه، سقف‌های هزینه، محدودیت نرخ برای هر کلید
- **هیچ گذرواژهٔ پیش‌فرضی وجود ندارد.** گذرواژهٔ قدیمی `123456` بازنشسته شد (v0.9.41). اگر هیچ گذرواژه‌ای تعیین نشده باشد، کنسول محلی شما را بی‌گذرواژه می‌پذیرد اما **در ورودهای راه‌دور را رد می‌کند** تا وقتی یکی تعیین کنید (Settings → Access). کلیدهای API به شکل <bdi>`vela-v1-<32 hex>-<8 hex>`</bdi> صادر می‌شوند؛ قالب <bdi>`sk-`</bdi> همه‌جا رد می‌شود
- ورود یکتا <bdi>OIDC</bdi> و <bdi>SAML</bdi> برای داشبورد، دروازهٔ قدرت <bdi>JWT</bdi> در هنگام بوت، دفتر جلسات با کلید <bdi>`jti`</bdi>، قفل <bdi>CSRF</bdi>، و IP مشتری که از **سوکت <bdi>TCP</bdi>** استخراج می‌شود (غیرقابل جعل) — هدرهای ارجاع تنها از یک پروکسی محلی معتبر شمرده می‌شوند

**🖥️ داشبورد** — `http://localhost:32060/dashboard`
- **۳۱ اتاق داشبورد** (۳۶ صفحه در کل) در **۳۵ زبان رابط کاربری**: ارائه‌دهندگان و جریان‌های <bdi>OAuth</bdi>، ترکیب‌ها، نقاط پایانی + کلیدهای API، استفاده به‌ازای هر کلید، سهمیه، صرفه‌جوی توکن، کنسول مترجم، راه‌اندازی ابزارهای CLI، ناوگان پروکسی، قواعد بازگشت، تزریق‌کننده‌های پرامپت، مهارت‌ها، گزارش‌های درخواست، و کنسول تنظیمات — از [نقشهٔ بندر](../docs/README.md) آغاز کنید

---

## 🚀 شروع سریع

### گزینهٔ الف — Docker (پیشنهاد می‌شود)

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.5
```

ایمیج **عمومی** است — به ورود به رجیستری نیازی نیست — و چندمعماری (<bdi>`linux/amd64`</bdi> + <bdi>`linux/arm64`</bdi>). برای نمودار کامل — دوقلوی <bdi>MariaDB</bdi>، حالت <bdi>mirror</bdi>، موتور پشتیبان‌گیری، سایدکار <bdi>Headroom</bdi> — به [DOCKER.md](../DOCKER.md)، [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) و قالب <bdi>[`docker-compose.example.yml`](../docker-compose.example.yml)</bdi> نگاه کنید.

### گزینهٔ ب — npm CLI

```bash
npm install -g vela
vela
```

راه‌انداز سرور را نصب، شروع و مدیریت می‌کند (بستهٔ npm نام `vela` را نگه می‌دارد؛ خود اپلیکیشن <bdi>`vela-app`</bdi> خصوصی است). [cli/README.md](../cli/README.md) را ببینید.

### گزینهٔ ج — از سورس

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # serves on 32060
```

محیط تولید: `npm run build && npm run start` (<bdi>Node 22+</bdi>؛ <bdi>Bun</bdi> هم کار می‌کند — `npm run dev:bun` / `build:bun` / `start:bun`).

### سپس یک ابزار متصل کنید

1. آدرس `http://localhost:32060/dashboard` را باز کنید — **هیچ گذرواژهٔ پیش‌فرضی وجود ندارد.** کنسول محلی بدون گذرواژه وارد می‌شود؛ برای فعال‌کردن دسترسی راه‌دور، گذرواژه‌ای زیر **Settings → Access** تعیین کنید.
2. **Providers** → یکی را متصل کنید (Kiro AI شروع رایگان خوبی است)
3. **Endpoints** → یک کلید API صادر کنید
4. ابزار خود را به دروازه اشاره دهید:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

سیم‌کشی ابزار به ابزار (Claude Code، Codex، Cursor، Cline، Roo، Continue) در [نمودارهای یکپارچه‌سازی](../gitbook/content/en/) زندگی می‌کند — و مهارت‌های آمادهٔ عامل برای چسباندن در [skills/](../skills/README.md) است.

---

## 📚 مستندات

نمودارها در [`docs/`](../docs/README.md) زندگی می‌کنند — از نقشهٔ بندر آغاز کنید. هر سند همان صدا را دارد، و هر عدد دستور بازاشتقاق خود را همراه دارد: **اگر نمودار و دستور مخالف هم باشند، دستور برنده است.**

| نمودار | چه چیزی را پوشش می‌دهد |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 نقشهٔ بندر — همهٔ مستندات، یک صفحه |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ چرخهٔ عمر درخواست، موتور مترجم، رجیستری ارائه‌دهنده، لایهٔ <bdi>DB</bdi>، موتور پشتیبان‌گیری، میثاق قیمت‌گذاری |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 مسیرهای نصب، نمودار <bdi>compose</bdi>، نمایش و دروازهٔ امنیت، ارتقا |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 قرارداد کامل متغیرهای محیطی |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ میثاق ذخیره‌سازی — <bdi>sqlite/mysql/mirror</bdi>، پمپ <bdi>mirror</bdi>، پشتیبان‌ها، <bdi>S3</bdi>، بازیابی |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 فهرست ارائه‌دهندگان، سه عدد، مدل اجراکننده |
| [docs/API.md](../docs/API.md) | 🔌 سطح سازگار با OpenAI + سطح <bdi>REST</bdi> داشبورد |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 نشانه → علت → رفع |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ میثاق نسخه‌بندی — افزایش، ثبت، مهر، با هم |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker، به‌عمق |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 دفترچهٔ کشتی |

نوآمدگان: [gitbook](../gitbook/content/en/) تور ویژهٔ تازه‌کارهاست، در پنج زبان. **برای مهندسانی که در این مخزن کار می‌کنند:** <bdi>[CLAUDE.md](../CLAUDE.md)</bdi> — اسناد خدمه. **برای مشارکت‌کنندگان موتور:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — چگونه یک ارائه‌دهنده / اجراکننده / مترجم اضافه کنیم.

---

## 🗺️ نقشهٔ مخزن

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
docs/               the charts — start at docs/README.md
gitbook/            the beginner tour — 100 pages × 5 languages
skills/             drop-in agent skills (paste a link, done)
tests/              the vitest suite — 480 live test files
i18n/               localized READMEs (10 languages)
plans/               sealed design plans (internal, gitignored)
scripts/             changelog sync, registry generator, icon subset
```

---

## 🌍 زبان‌ها

این README به ۱۰ زبان دیگر ترجمه شده است — پیوندها در بنر بالا. خود داشبورد با **۳۵ زبان رابط کاربری** عرضه می‌شود؛ از مسیر **Settings → General → Language** تغییر دهید.

---

## 🏛️ خاستگاه و پروانه

Vela از v0.6.0 به بعد مسیر خودش را می‌رود — دروازه تحت مجوز MIT است و کاملاً مستقل. [LICENSE](../LICENSE) را ببینید.

---

<div align="center">
*بادبانت را بیفراز. باد آزاد است.* ⛵
</div>

</div>
