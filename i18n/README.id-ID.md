<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — layar sang kapal" width="520"/>

  **Satu endpoint kompatibel OpenAI. 40+ penyedia upstream. Langganan Anda, API key Anda, tier gratis Anda — satu pelabuhan, satu layar.**

  Vela merutekan perkakas coding AI Anda (Claude Code, Codex, Cursor, Cline, OpenCode…) melalui satu gateway lokal dengan terjemahan format, fallback model-combo, rotasi multi-akun, pelacakan kuota, dan penghemat token RTK yang memangkas 20–40% token tool-output sebelum meninggalkan pelabuhan.

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Mulai Cepat](#-quick-start) · [✨ Fitur](#-key-features) · [📚 Dokumentasi](#-documentation) · [🌐 Bahasa](#-languages)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 📌 Versi bahasa Inggris adalah sumber utama — [README.md](../README.md).

---

## ⛵ Apa itu Vela?

Vela adalah **gateway routing AI lokal + dashboard**. Anda mengarahkan semua perkakas AI ke satu endpoint — `http://localhost:32060/v1` — dan Vela memutuskan penyedia mana yang benar-benar menjawab: langganan berbayar Anda lebih dulu, jalur API murah berikutnya, tier gratis terakhir. Saat satu jalur habis, jalur berikutnya menangkap angin. Tanpa perubahan di sisi perkakas, tanpa downtime.

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

Di balik layar: server Next.js (dashboard + API) di port **32060**, engine routing yang agnostik terhadap penyedia (`open-sse/`), dan database SQLite yang dapat menumbuhkan kembaran MariaDB saat Anda menginginkannya (sqlite → mysql → mirror).

> 📌 **Catatan:** Vela berlayar dengan haluanya sendiri — gerbang AI yang ditempa dari perairan terbuka, dengan seluruh sistem miliknya sendiri: storage, backup, pricing, dan kategori. CLI terpasang sebagai `vela` dari npm.

---

## 🤔 Mengapa Vela?

| Masalahnya | Yang Vela lakukan |
|-|-|
| ❌ Kuota langganan hangus tak terpakai | ✅ Pelacakan kuota + fallback otomatis — habiskan setiap token sebelum reset |
| ❌ Rate limit menghentikan Anda di tengah alur kerja | ✅ Rotasi multi-akun + fallback model-combo, nol downtime |
| ❌ Output perkakas membakar token (diff, grep, ls…) | ✅ **Penghemat token RTK** mengompresi konten `tool_result` di tempat — hemat 20–40% |
| ❌ Membayar $20–50/bulan per penyedia | ✅ Satu gateway melintasi jalur langganan + murah + gratis |
| ❌ Setiap perkakas butuh konfigurasinya sendiri | ✅ Satu endpoint kompatibel OpenAI, semua perkakas berbicara dengannya |

---

## ✨ Fitur Utama

**🧭 Routing & Terjemahan Format**
- Satu endpoint kompatibel OpenAI: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, web search & fetch
- Terjemahan format berporos pada OpenAI sebagai format antara — rute langsung terdaftar untuk pasangan yang rapuh (thinking blocks, tool ids)
- **129 penyedia** terdaftar: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama, dan puluhan lainnya — [daftar lengkap](../docs/PROVIDERS.md)

**🪂 Ketahanan**
- Fallback model-combo: definisikan sebuah combo, Vela menyusuri daftarnya sampai ada yang menjawab
- Fallback multi-akun per penyedia, rotasi round-robin
- Manajemen kredensial OAuth + API-key dengan refresh token otomatis

**💰 Kecerdasan Biaya — the Pricing Covenant**
- Tabel harga statis (input / output / cached / reasoning / cache-creation, $/1M token) dengan rantai resolusi enam langkah — provider overrides, exact match, free-model inheritance, vendor-strip, glob fallback
- Editor harga di dashboard + sinkronisasi models.dev — setiap permintaan mendapat estimasi biaya yang jujur
- Deteksi tier gratis: model gratis mewarisi tarif saudara berbayarnya sehingga penghematan terlihat

**🐚 Penghemat Token RTK**
- Hook pre-translate mengompresi konten `tool_result` sebelum request berangkat — fail-open dari desainnya, tidak pernah menyentuh trace `is_error`
- Sidecar [Headroom](https://github.com/chopratejas/headroom) opsional untuk kompresi yang lebih dalam

**🗝️ Storage Covenant**
- Tiga postur, satu env var: `VELA_DB_MODE=sqlite|mysql|mirror`
- Pelabuhan SQLite sebagai default; MariaDB sebagai pelabuhan penuh; atau **mirror** — SQLite melayani sementara setiap write dipompa ke kembaran MariaDB, dijaga oleh divergence sweep
- Engine backup tersegel: artefak AES-256-GCM, tier retensi, drill + restore, leg S3 off-site opsional

**🖥️ Dashboard** — `http://localhost:32060/dashboard`
- Alur Providers & OAuth, combos, endpoints + API keys, penggunaan per-key, kuota, penghemat token, translator console, halaman setup perkakas CLI, pengaturan harga — dalam 34+ locale antarmuka

---

## 🚀 Mulai Cepat

### Opsi A — Docker (disarankan)

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

Untuk peta lengkapnya — kembaran MariaDB, postur mirror, engine backup, sidecar Headroom — lihat [DOCKER.md](../DOCKER.md) dan templat [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opsi B — npm CLI

```bash
npm install -g vela
vela
```

CLI menginstal, menjalankan, dan mengelola server (paket peluncur mempertahankan nama `vela` di npm).

### Opsi C — Dari source

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Produksi: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Lalu hubungkan perkakas Anda

1. Buka `http://localhost:32060/dashboard` (password default `123456` — ganti segera)
2. **Providers** → hubungkan satu (Kiro AI adalah awal gratis yang baik)
3. **Endpoints** → salin sebuah API key
4. Arahkan perkakas Anda ke gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Dokumentasi

Peta-peta itu tersimpan di [`docs/`](../docs/README.md) — peta pelabuhan yang lengkap.

| Peta | Isinya |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 Peta pelabuhan — semua dokumen, satu halaman |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Siklus hidup request, engine translator, registry penyedia, lapisan DB |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Jalur instalasi, peta compose, postur storage, upgrade |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Kontrak env-var lengkap |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Storage Covenant — sqlite/mysql/mirror, backup, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 Daftar lengkap 129 penyedia |
| [docs/API.md](../docs/API.md) | 🔌 Permukaan kompatibel OpenAI + API dashboard |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Saat angin berhenti |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Kovenant versioning |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, mendalam |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Log pelayaran sang kapal |

**Untuk engineer yang bekerja di repo ini:** [CLAUDE.md](../CLAUDE.md) — dokumen para awak.
**Untuk kontributor engine:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cara menambahkan provider / executor / translator.

---

## 🗺️ Peta Repositori

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

## 🌍 Bahasa

README ini diterjemahkan ke 10 bahasa lainnya — tautannya ada di banner di atas. Dashboard-nya sendiri hadir dengan 34+ locale antarmuka; ganti dari halaman profil dashboard.

---

## 🏛️ Asal-Usul & Lisensi

Vela berlayar dengan haluanya sendiri sejak v0.6.0 — gateway ini berlisensi MIT dan sepenuhnya miliknya. Lihat [LICENSE](../LICENSE).

---

<div align="center">

*Kembangkan layar Anda. Anginnya gratis.* ⛵

</div>
