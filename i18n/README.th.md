<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — ใบเรือของเรือ" width="520"/>

  **ปลายทางที่เข้ากันได้กับ OpenAI เพียงหนึ่งเดียว ผู้ให้บริการ upstream มากกว่า 40 ราย ซับสคริปชันของคุณ คีย์ของคุณ แพลนฟรีของคุณ — ท่าเรือเดียว ใบเรือเดียว**

  Vela กำหนดเส้นทางให้เครื่องมือเขียนโค้ด AI ของคุณ (Claude Code, Codex, Cursor, Cline, OpenCode…) ผ่านเกตเวย์ในเครื่องเพียงจุดเดียว พร้อมการแปลงฟอร์แมต, การสำรองผ่านชุดโมเดล (model-combo fallback), การสลับหลายบัญชี, การติดตามโควตา และ RTK token saver ที่ช่วยตัดโทเค็นจากผลลัพธ์ของเครื่องมือ 20–40% ก่อนที่มันจะออกจากท่าเรือ

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 เริ่มต้นอย่างรวดเร็ว](#-เริ่มต้นอย่างรวดเร็ว) · [✨ ฟีเจอร์หลัก](#-ฟีเจอร์หลัก) · [📚 เอกสาร](#-เอกสาร) · [🌐 ภาษา](#-ภาษา)

  🇺🇸 [English](./README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇬🇧 นี่คือการแปลเป็นภาษาไทย ต้นฉบับภาษาอังกฤษอยู่ที่ [README.md](../README.md)

---

## ⛵ Vela คืออะไร?

Vela คือ **เกตเวย์กำหนดเส้นทาง AI ภายในเครื่อง + แดชบอร์ด** คุณชี้เครื่องมือ AI ทุกตัวไปที่ปลายทางเดียว — `http://localhost:32060/v1` — แล้ว Vela จะตัดสินใจว่าผู้ให้บริการรายไหนจะเป็นผู้ตอบจริง: ซับสคริปชันแบบเสียเงินของคุณก่อน ตามด้วยเส้นทาง API ราคาถูก และแพลนฟรีเป็นลำดับสุดท้าย เมื่อเส้นทางหนึ่งแห้งแล้ง เส้นทางถัดไปก็จะรับช่วงต่อ ไม่ต้องแก้ไขอะไรฝั่งเครื่องมือ ไม่มี downtime

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

ภายในประกอบด้วย: เซิร์ฟเวอร์ Next.js (แดชบอร์ด + API) บนพอร์ต **32060**, เอนจินกำหนดเส้นทางที่ไม่ขึ้นกับผู้ให้บริการ (`open-sse/`) และฐานข้อมูล SQLite ที่สามารถเติบโตไปเป็น MariaDB คู่แฝดได้เมื่อคุณต้องการ (sqlite → mysql → mirror)

> 📌 **หมายเหตุ:** Vela แล่นในเส้นทางของตัวเอง — เกตเวย์ AI ที่ตีขึ้นจากน่านน้ำเปิด ระบบทั้งหมดเป็นของตัวเอง: จัดเก็บข้อมูล สำรองข้อมูล ตั้งราคา และหมวดหมู่ ติดตั้ง CLI ในชื่อ `vela` จาก npm

---

## 🤔 ทำไมต้อง Vela?

| ปัญหา | สิ่งที่ Vela ทำ |
|-|-|
| ❌ โควตาซับสคริปชันหมดอายุโดยไม่ได้ใช้งาน | ✅ ติดตามโควตา + สำรองอัตโนมัติ — ใช้ทุกโทเค็นก่อนรอบรีเซ็ต |
| ❌ Rate limit ขัดจังหวะคุณกลางคัน | ✅ สลับหลายบัญชี + สำรองผ่านชุดโมเดล ไม่มี downtime |
| ❌ ผลลัพธ์จากเครื่องมือเผาผลาญโทเค็น (diff, grep, ls…) | ✅ **RTK token saver** บีบอัดเนื้อหา `tool_result` กับที่ — ประหยัด 20–40% |
| ❌ ต้องจ่าย $20–50/เดือนต่อผู้ให้บริการหนึ่งราย | ✅ เกตเวย์เดียวครอบคลุมเส้นทางซับสคริปชัน + ราคาถูก + ฟรี |
| ❌ เครื่องมือแต่ละตัวต้องตั้งค่าแยกกัน | ✅ ปลายทางที่เข้ากันได้กับ OpenAI เพียงจุดเดียว ทุกเครื่องมือพูดภาษานี้ |

---

## ✨ ฟีเจอร์หลัก

**🧭 การกำหนดเส้นทางและการแปลงฟอร์แมต**
- ปลายทางที่เข้ากันได้กับ OpenAI เพียงจุดเดียว: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, ค้นหาและดึงข้อมูลเว็บ
- การแปลงฟอร์แมตใช้ OpenAI เป็นรูปแบบกลาง — มีการลงทะเบียนเส้นทางตรงสำหรับคู่ที่เปราะบาง (thinking blocks, tool id)
- ลงทะเบียนแล้ว **129 ผู้ให้บริการ**: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama และอื่น ๆ อีกหลายสิบ — [รายชื่อทั้งหมด](../docs/PROVIDERS.md)

**🪂 ความทนทาน**
- การสำรองผ่านชุดโมเดล: กำหนดชุดโมเดล แล้ว Vela จะไล่ตามรายการจนกว่าจะมีผู้ตอบ
- การสำรองแบบหลายบัญชีต่อผู้ให้บริการ สลับแบบ round-robin
- การจัดการข้อมูลรับรอง OAuth + API key พร้อมรีเฟรชโทเค็นอัตโนมัติ

**💰 ความอัจฉริยะด้านต้นทุน — พันธสัญญาการตั้งราคา (Pricing Covenant)**
- ตารางราคาแบบคงที่ (input / output / cached / reasoning / cache-creation, $/1M โทเค็น) พร้อมลูกโซ่การวินิจฉัยหกขั้นตอน — การแทนที่ระดับผู้ให้บริการ, จับคู่แม่นยำ, การสืบทอดโมเดลฟรี, การตัด vendor, fallback แบบ glob
- ตัวแก้ไขราคาในแดชบอร์ด + ซิงค์กับ models.dev — ทุกคำขอได้รับต้นทุนโดยประมาณที่ตรงไปตรงมา
- การตรวจจับแพลนฟรี: โมเดลฟรีสืบทอดอัตราของโมเดลเสียเงินที่เป็นพี่น้อง เพื่อให้มองเห็นการประหยัดได้ชัดเจน

**🐚 RTK Token Saver**
- ฮุคก่อนการแปลงฟอร์แมตจะบีบอัดเนื้อหา `tool_result` ก่อนที่คำขอจะออกไป — ออกแบบให้ fail-open ไม่แตะต้อง trace ของ `is_error`
- ตัวเลือก sidecar [Headroom](https://github.com/chopratejas/headroom) สำหรับการบีบอัดที่ลึกขึ้น

**🗝️ พันธสัญญาการจัดเก็บข้อมูล (Storage Covenant)**
- สามรูปแบบ ตัวแปร env เดียว: `VELA_DB_MODE=sqlite|mysql|mirror`
- ท่าเรือ SQLite เป็นค่าเริ่มต้น; MariaDB ในฐานะท่าเรือเต็มรูปแบบ; หรือ **mirror** — SQLite ให้บริการขณะที่ทุกการเขียนถูกสูบไปยังแฝด MariaDB โดยมีระบบกวาดตรวจความคลาดเคลื่อนคอยเฝ้าระวัง
- เอนจินสำรองข้อมูลที่ผนึกแน่น: artifact แบบ AES-256-GCM, ระดับการเก็บรักษา, การซ้อมกู้คืน + กู้คืนจริง และขาสำรองภายนอกผ่าน S3 (ตัวเลือก)

**🖥️ แดชบอร์ด** — `http://localhost:32060/dashboard`
- ผู้ให้บริการและโฟลว์ OAuth, ชุดโมเดล, ปลายทาง + API key, การใช้งานรายคีย์, โควตา, token saver, คอนโซลตัวแปลงฟอร์แมต, หน้าตั้งค่าเครื่องมือ CLI, การตั้งค่าราคา — รองรับมากกว่า 34 ภาษาของอินเทอร์เฟซ

---

## 🚀 เริ่มต้นอย่างรวดเร็ว

### ตัวเลือก A — Docker (แนะนำ)

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

สำหรับแผนที่ฉบับเต็ม — แฝด MariaDB, รูปแบบ mirror, เอนจินสำรองข้อมูล, sidecar Headroom — ดูที่ [DOCKER.md](../DOCKER.md) และเทมเพลต [`docker-compose.example.yml`](../docker-compose.example.yml)

### ตัวเลือก B — npm CLI

```bash
npm install -g vela
vela
```

CLI จะติดตั้ง เริ่มต้น และจัดการเซิร์ฟเวอร์ (แพ็คเกจตัวติดตั้งคงชื่อ `vela` ไว้บน npm)

### ตัวเลือก C — จากซอร์สโค้ด

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

โปรดักชัน: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### จากนั้นเชื่อมต่อเครื่องมือ

1. เปิด `http://localhost:32060/dashboard` (รหัสผ่านเริ่มต้น `123456` — เปลี่ยนเสีย)
2. **Providers** → เชื่อมต่อสักราย (Kiro AI เป็นจุดเริ่มต้นฟรีที่ดี)
3. **Endpoints** → คัดลอก API key
4. ชี้เครื่องมือของคุณไปที่เกตเวย์:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 เอกสาร

แผนที่ต่าง ๆ อยู่ใน [`docs/`](../docs/README.md) — แผนที่ท่าเรือฉบับสมบูรณ์

| แผนที่ | ครอบคลุมอะไร |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 แผนที่ท่าเรือ — เอกสารทั้งหมดในหน้าเดียว |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ วัฏจักรคำขอ, เอนจินตัวแปลงฟอร์แมต, รีจิสทรีผู้ให้บริการ, เลเยอร์ฐานข้อมูล |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 เส้นทางการติดตั้ง, แผนภูมิ compose, รูปแบบการจัดเก็บ, การอัปเกรด |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 สัญญาตัวแปร env ฉบับสมบูรณ์ |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ พันธสัญญาการจัดเก็บข้อมูล — sqlite/mysql/mirror, สำรองข้อมูล, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 รายชื่อผู้ให้บริการทั้ง 129 ราย |
| [docs/API.md](../docs/API.md) | 🔌 พื้นผิวที่เข้ากันได้กับ OpenAI + API ของแดชบอร์ด |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 เมื่อลมสงบ |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ พันธสัญญาการกำหนดเวอร์ชัน |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker เจาะลึก |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 บันทึกการเดินทางของเรือ |

**สำหรับวิศวกรที่ทำงานใน repo นี้:** [CLAUDE.md](../CLAUDE.md) — เอกสารประจำลูกเรือ
**สำหรับผู้มีส่วนร่วมพัฒนาเอนจิน:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — วิธีเพิ่มผู้ให้บริการ / executor / ตัวแปลงฟอร์แมต

---

## 🗺️ แผนที่โครงสร้าง Repository

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

## 🌍 ภาษา

README นี้ถูกแปลเป็นอีก 10 ภาษา — ลิงก์อยู่ในแบนเนอร์ด้านบน ตัวแดชบอร์ดเองรองรับมากกว่า 34 ภาษาของอินเทอร์เฟซ สลับได้จากหน้าโปรไฟล์ในแดชบอร์ด

---

## 🏛️ ที่มาและลิขสิทธิ์

Vela แล่นในเส้นทางของตัวเองตั้งแต่ v0.6.0 เป็นต้นมา — เกตเวย์อยู่ภายใต้สัญญาอนุญาต MIT และเป็นของตัวเองเต็มที่ ดูที่ [LICENSE](../LICENSE)

---

<div align="center">

*กางใบเรือของคุณ ลมเป็นของฟรี* ⛵

</div>
