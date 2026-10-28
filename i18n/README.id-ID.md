<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — layar sang kapal" width="520"/>

  **Satu endpoint kompatibel OpenAI. 145 transport upstream yang dapat didial. Langganan Anda, API key Anda, tier gratis Anda — satu pelabuhan, satu layar.**

  Vela merutekan perkakas coding AI Anda (Claude Code, Codex, Cursor, Cline, OpenCode…) melalui satu gateway lokal dengan terjemahan format, fallback model-combo, rotasi multi-akun, pelacakan kuota, ACL per-key, dan penghemat token RTK yang memangkas 20–40% token hasil perkakas sebelum meninggalkan pelabuhan.

  [![Version](https://img.shields.io/badge/version-1.2.5-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Mulai Cepat](#-quick-start) · [✨ Fitur](#-key-features) · [📚 Dokumentasi](#-documentation) · [🌐 Bahasa](#-languages)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 📌 Versi bahasa Inggris adalah sumber utama — [README.md](../README.md).

---

## ⛵ Apa itu Vela?

Vela adalah **gateway routing AI lokal + dashboard**. Anda mengarahkan setiap perkakas AI ke satu endpoint — `http://localhost:32060/v1` — dan Vela memutuskan penyedia mana yang benar-benar menjawab: langganan berbayar Anda lebih dulu, jalur API murah berikutnya, tier gratis terakhir. Saat satu jalur habis, jalur berikutnya menangkap angin. Tanpa perubahan di sisi perkakas, tanpa downtime.

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

Satu proses Node melayani kedua engine: **dashboard + API** (`src/`, aplikasi Next.js App Router) dan **engine routing** (`open-sse/`), pada port **32060**. State tersimpan di SQLite secara default dan dapat menumbuhkan kembaran MariaDB saat Anda menginginkannya (`sqlite` → `mysql` → `mirror`). Engine backup tersegel mengawasi dasar pelabuhan, dan gateway menstempel setiap rilis sehingga lambung kapal selalu dapat dibuktikan.

> 📌 **Catatan:** Vela berlayar dengan haluannya sendiri — gerbang AI yang ditempa dari perairan terbuka, dengan seluruh sistem miliknya sendiri: storage, backup, pricing, dan kategori. CLI terpasang sebagai `vela` dari npm. Garis keturunan fork: sejak v0.6.0, gateway ini berlisensi MIT dan sepenuhnya miliknya sendiri (lihat [Asal-Usul](#-provenance--license)).

> 🔢 **Disiplin angka** (diukur 2026-10-28, pada v1.2.5). Registry penyedia melaporkan **tiga angka jujur, dan ketiganya berbeda**: **189** file registry di disk → **186** diimpor oleh index yang dihasilkan → **145** transport chat yang dapat didial (41 jalur terimpor lainnya membawa transport media, search, dan embedding yang secara sah tidak berbicara chat). Tiga file sengaja diletakkan di disk namun disembunyikan dari index (`trae`, `devin-cli`, `windsurf`). Jangan pernah melebur ketiganya menjadi satu — sebutkan angka mana yang Anda maksud, dan turunkan ulang alih-alih memercayai baris ini:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 file di disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 diimpor
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dapat didial
> ```
> Sensus ini dipatok sebagai properti oleh `tests/unit/provider-registry-census.test.js` — sebuah file yang mendarat di disk tanpa diimpor akan membuatnya merah sebelum ia diam-diam padam. Lihat [docs/PROVIDERS.md](../docs/PROVIDERS.md).

---

## 🤔 Mengapa Vela?

| Masalahnya | Yang dilakukan Vela |
|-|-|
| ❌ Kuota langganan hangus tanpa terpakai | ✅ Pelacakan kuota + fallback otomatis — habiskan setiap token sebelum reset |
| ❌ Rate limit menghentikan Anda di tengah alur | ✅ Rotasi multi-akun + fallback model-combo, nol downtime |
| ❌ Output perkakas membakar token (diff, grep, ls…) | ✅ **Penghemat token RTK** mengompres konten `tool_result` di tempat — hemat 20–40% |
| ❌ Membayar $20–50/bulan per penyedia | ✅ Satu gateway melintasi jalur langganan + murah + gratis |
| ❌ Setiap perkakas butuh konfigurasinya sendiri | ✅ Satu endpoint kompatibel OpenAI, semua perkakas berbicara dengannya |
| ❌ Satu penyedia mati dan alur Anda ikut mati | ✅ Circuit breaker + ambang batas kegagalan penyedia + cooling window |

---

## ✨ Fitur Utama

**🧭 Routing & Terjemahan**
- Satu endpoint kompatibel OpenAI: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (generations, edits, extensions), `/v1/responses` (+`/compact`), `/v1beta/*`, web search, fetch & scrape
- Terjemahan format berporos pada OpenAI sebagai perantara — rute langsung terdaftar untuk pasangan yang rapuh (thinking block, tool id)
- **145 penyedia yang dapat didial** di jalur langganan, bayar-per-pakai, gratis, lokal, dan media — [daftar lengkapnya](../docs/PROVIDERS.md)
- Pengalamatan model adalah `provider/model` (`kr/claude-sonnet-4.5`) — prefiks menyebut jalurnya

**🪂 Ketahanan**
- Fallback model-combo: definisikan sebuah combo, Vela menyusuri daftarnya sampai ada yang menjawab
- Fallback multi-akun per penyedia, rotasi round-robin
- Circuit breaker per pool — dan breaker **bertahan melewati restart**: jendela terbuka tetap ada melalui store yang terikat, tenggat dikunci ke sebuah batas atas, dan breaker yang dipulihkan kembali bersiap pada satu kegagalan, sesuai dengan hukum in-process
- Ambang batas kegagalan penyedia dengan cooling window (`VELA_PROVIDER_FAILURE_*`), manajemen kredensial OAuth + API-key dengan refresh token otomatis di latar belakang

**💰 Kecerdasan Biaya — the Pricing Covenant**
- Tabel harga statis (input / output / cached / reasoning / cache-creation, $/1M token) dengan rantai resolusi enam langkah — override penyedia, exact match, pewarisan model gratis, vendor-strip, glob fallback
- Editor harga di dashboard + sinkronisasi models.dev — setiap request mendapat estimasi biaya yang jujur
- Deteksi tier gratis: model gratis mewarisi tarif saudara berbayarnya sehingga penghematan tetap terlihat
- Biaya dihitung pada **waktu tulis** dan dibekukan — tanpa backfill, tanpa perhitungan ulang setelah pengeditan tarif

**🐚 Penghemat Token RTK**
- Hook pre-translate mengompres konten `tool_result` sebelum request meninggalkan pelabuhan — fail-open secara desain, tidak pernah menyentuh trace `is_error`
- Prompt injector yang didefinisikan operator (append/prepend), berlapis setelah penghemat bawaan
- Sidecar [Headroom](https://github.com/chopratejas/headroom) opsional untuk kompresi yang lebih dalam

**🗝️ Storage Covenant**
- Tiga postur, satu env var: `VELA_DB_MODE=sqlite|mysql|mirror`
- Pelabuhan SQLite sebagai default; MariaDB sebagai pelabuhan penuh; atau **mirror** — SQLite melayani sementara setiap write dipompa ke kembaran MariaDB melalui outbox, dijaga oleh divergence sweep
- Rantai driver: `better-sqlite3` → `node:sqlite` (tanpa instalasi di Node ≥ 22.5) → `sql.js` murni JS; `VELA_DB_DRIVER` mematok satu, kegagalan akan berteriak keras
- **23 migrasi** (`SCHEMA_VERSION = 23`) — sinkronisasi `TABLES` yang deklaratif menjaga kedua pelabuhan dan kembarannya tetap jujur — lihat [docs/STORAGE.md](../docs/STORAGE.md)
- Engine backup tersegel: artefak AES-256-GCM, tier retensi, **drill** restore, leg S3 off-site opsional

**🛡️ Keamanan**
- ACL per-key — empat lapis: jenis, penyedia, combo, model (allowlist tri-state)
- Gate anggaran: batas harian, batas pengeluaran, rate limit per key
- **Tanpa password default.** Password `123456` yang lama telah dipensiunkan (v0.9.41). Bila tidak ada yang diatur, konsol lokal mengizinkan Anda masuk tanpa password tetapi **menolak login jarak jauh** sampai Anda mengaturnya (Pengaturan → Akses). API key diterbitkan sebagai `vela-v1-<32 hex>-<8 hex>`; format `sk-` ditolak di mana pun
- Single sign-on OIDC dan SAML untuk dashboard, gate kekuatan JWT saat boot, buku sesi berkunci `jti`, kunci CSRF, dan IP klien diturunkan dari **socket TCP** (tidak dapat dipalsukan) — header forwarding hanya dipercaya dari proxy loop

**🖥️ Dashboard** — `http://localhost:32060/dashboard`
- **31 ruang dashboard** (total 36 halaman) dalam **35 locale antarmuka**: penyedia & alur OAuth, combo, endpoint + API key, penggunaan per-key, kuota, penghemat token, translator console, penyiapan perkakas CLI, armada proxy, aturan fallback, prompt injector, skill, log request, dan konsol pengaturan — mulai dari [peta pelabuhan](../docs/README.md)

---

## 🚀 Mulai Cepat

### Opsi A — Docker (disarankan)

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

Image-nya **publik** — tanpa perlu login registry — dan multi-arch (`linux/amd64` + `linux/arm64`). Untuk peta lengkapnya — kembaran MariaDB, postur mirror, engine backup, sidecar Headroom — lihat [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md), dan templat [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opsi B — npm CLI

```bash
npm install -g vela
vela
```

Peluncur menginstal, menjalankan, dan mengelola server (paket npm mempertahankan nama `vela`; aplikasinya adalah `vela-app` yang privat). Lihat [cli/README.md](../cli/README.md).

### Opsi C — Dari source

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # melayani di 32060
```

Produksi: `npm run build && npm run start` (Node 22+; Bun juga bisa — `npm run dev:bun` / `build:bun` / `start:bun`).

### Lalu hubungkan sebuah perkakas

1. Buka `http://localhost:32060/dashboard` — **tidak ada password default.** Konsol lokal masuk tanpanya; atur password di **Pengaturan → Akses** untuk mengaktifkan akses jarak jauh.
2. **Providers** → hubungkan satu (Kiro AI adalah awal gratis yang baik)
3. **Endpoints** → terbitkan sebuah API key
4. Arahkan perkakas Anda ke gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (dari dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

Perkabelan per perkakas (Claude Code, Codex, Cursor, Cline, Roo, Continue) ada di [peta integrasi](../gitbook/content/en/) — dan agent skill siap tempel ada di [skills/](../skills/README.md).

---

## 📚 Dokumentasi

Peta-peta itu tinggal di [`docs/`](../docs/README.md) — mulai dari peta pelabuhan. Setiap dokumen membawa suara yang sama, dan setiap angka membawa perintah penurunan ulangnya sendiri: **jika peta dan perintah berselisih, perintah yang menang.**

| Peta | Isinya |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 Peta pelabuhan — setiap dokumen, satu halaman |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Siklus hidup request, engine translator, registry penyedia, lapisan DB, engine backup, pricing covenant |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Jalur instalasi, peta compose, eksposur & gate keamanan, upgrade |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Kontrak env-var lengkap |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ Storage Covenant — sqlite/mysql/mirror, pomp mirror, backup, S3, pemulihan |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 Daftar penyedia, tiga angka, model executor |
| [docs/API.md](../docs/API.md) | 🔌 Permukaan kompatibel OpenAI + permukaan REST dashboard |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Gejala → penyebab → perbaikan |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Kovenan versioning — bump, log, segel bersama-sama |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, mendalam |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Log pelayaran sang kapal |

Untuk tangan yang lebih baru: [gitbook](../gitbook/content/en/) adalah tur bagi pemula, dalam lima bahasa. **Untuk engineer yang bekerja di repo ini:** [CLAUDE.md](../CLAUDE.md) — dokumen para awak. **Untuk kontributor engine:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cara menambahkan provider / executor / translator.

---

## 🗺️ Peta Repositori

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

## 🌍 Bahasa

README ini diterjemahkan ke 10 bahasa lainnya — tautannya ada di banner di atas. Dashboard-nya sendiri hadir dengan **35 locale antarmuka**; ganti dari **Pengaturan → Umum → Bahasa**.

---

## 🏛️ Asal-Usul & Lisensi

Vela berlayar dengan haluannya sendiri sejak v0.6.0 — gateway ini berlisensi MIT dan sepenuhnya miliknya sendiri. Lihat [LICENSE](../LICENSE).

---

<div align="center">
*Bentangkan layarmu. Anginnya gratis.* ⛵
</div>
