<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — ใบเรือของเรือ" width="520"/>

  **ปลายทางที่เข้ากันได้กับ OpenAI เพียงจุดเดียว การขนส่ง upstream ที่เชื่อมต่อได้ ๑๔๕ รายการ ซับสคริปชันของคุณ คีย์ของคุณ แพลนฟรีของคุณ — ท่าเรือเดียว ใบเรือเดียว**

  Vela กำหนดเส้นทางให้เครื่องมือเขียนโค้ด AI ของคุณ (Claude Code, Codex, Cursor, Cline, OpenCode…) ผ่านเกตเวย์ในเครื่องเพียงจุดเดียว พร้อมการแปลงฟอร์แมต การสำรองผ่านใช้ชุดโมเดล การสลับหลายบัญชี การติดตามโควตา ACL ต่อคีย์ และ RTK token saver ที่ตัดทอนโทเค็นจากผลลัพธ์ของเครื่องมือได้ ๒๐–๔๐% ก่อนที่มันจะออกจากท่าเรือ

  [![Version](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 เริ่มต้นอย่างรวดเร็ว](#-เริ่มต้นอย่างรวดเร็ว) · [✨ ฟีเจอร์หลัก](#-ฟีเจอร์หลัก) · [📚 เอกสาร](#-เอกสาร) · [🌐 ภาษา](#-ภาษา)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇬🇧 นี่คือการแปลภาษาไทย ต้นฉบับภาษาอังกฤษอยู่ที่ [README.md](../README.md)

---

## ⛵ Vela คืออะไร?

Vela คือ **เกตเวย์กำหนดเส้นทาง AI ภายในเครื่อง + แดชบอร์ด** คุณชี้เครื่องมือ AI ทุกตัวไปที่ปลายทางเดียว — `http://localhost:32060/v1` — แล้ว Vela จะตัดสินใจว่าผู้ให้บริการรายใดเป็นผู้ตอบจริง: ซับสคริปชันแบบเสียเงินของคุณก่อน เส้นทาง API ราคาถูกเป็นลำดับถัดไป และแพลนฟรีเป็นลำดับสุดท้าย เมื่อเส้นทางหนึ่งแห้งแล้ง เส้นทางถัดไปก็รับลมไปแทน ไม่ต้องแก้ไขอะไรฝั่งเครื่องมือ ไม่มี downtime

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

โปรเซส Node เพียงตัวเดียวให้บริการทั้งสองเอนจิน ได้แก่ **แดชบอร์ด + API** (`src/` ซึ่งเป็นแอป Next.js App Router) และ **เอนจินกำหนดเส้นทาง** (`open-sse/`) บนพอร์ต **32060** สถานะเก็บไว้ใน SQLite เป็นค่าเริ่มต้น และสามารถเติบโตเป็น MariaDB คู่แฝดได้เมื่อคุณต้องการ (`sqlite` → `mysql` → `mirror`) เอนจินสำรองข้อมูลที่ผนึกแน่นคอยเฝ้าดูพื้นดินของท่าเรือ และเกตเวย์ประทับตราทุกการออกรุ่น เพื่อให้ตัวเรือได้รับการพิสูจน์ได้เสมอ

> 📌 **หมายเหตุ:** Vela แล่นตามเส้นทางของตัวเอง — เกตเวย์ AI ที่ตีขึ้นจากน่านน้ำเปิด ด้วยระบบทุกส่วนที่เป็นของตัวเอง: การจัดเก็บ การสำรองข้อมูล การตั้งราคา และหมวดหมู่ CLI ติดตั้งในชื่อ `vela` จาก npm สายเชื้อสายของ fork: ตั้งแต่ v0.6.0 เป็นต้นมา เกตเวย์อยู่ภายใต้สัญญาอนุญาต MIT และเป็นของตัวเองเต็มที่ (ดูที่ [ที่มาและลิขสิทธิ์](#-ที่มาและลิขสิทธิ์))

> 🔢 **วินัยของการนับ** (วัดเมื่อ 2026-10-28 ที่ v1.2.4) รีจิสทรีผู้ให้บริการรายงาน **ตัวเลขซื่อสัตย์สามตัว และทั้งสามต่างกัน**: ไฟล์รีจิสทรี **๑๘๙** ไฟล์บนดิสก์ → **๑๘๖** ไฟล์ที่ดัชนีที่สร้างขึ้นนำเข้า → **๑๔๕** ช่องทางการสนทนา (chat transports) ที่เชื่อมต่อได้ (อีก ๔๑ เส้นทางที่นำเข้าจะบรรทุกการขนส่งสื่อ ค้นหา และ embedding ซึ่งไม่พูดภาษาแชทโดยชอบธรรม) มีสามไฟล์วางอยู่บนดิสก์โดยจงใจซ่อนจากดัชนี (`trae`, `devin-cli`, `windsurf`) อย่ารวมทั้งสามตัวเลขเป็นหนึ่ง — จงระบุว่าคุณหมายถึงตัวเลขใด และคำนวณใหม่แทนการเชื่อถือบรรทัดนี้:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> การสำมะโนถูกยึดไว้เป็นพร็อพเพอร์ตี้โดย `tests/unit/provider-registry-census.test.js` — ไฟล์ที่ปรากฏบนดิสก์โดยไม่มีการนำเข้าจะทำให้เกิดความแดงที่นั่น ก่อนที่มันจะมืดลงอย่างเงียบ ๆ ดู [docs/PROVIDERS.md](../docs/PROVIDERS.md)

---

## 🤔 ทำไมต้อง Vela?

| ปัญหา | สิ่งที่ Vela ทำ |
|-|-|
| ❌ โควตาซับสคริปชันหมดอายุโดยไม่ได้ใช้ | ✅ ติดตามโควตา + สำรองอัตโนมัติ — ใช้ทุกโทเค็นก่อนรอบรีเซ็ต |
| ❌ Rate limit หยุดคุณกลางการทำงาน | ✅ สลับหลายบัญชี + สำรองผ่านชุดโมเดล ไม่มี downtime |
| ❌ ผลลัพธ์จากเครื่องมือเผาผลาญโทเค็น (diff, grep, ls…) | ✅ **RTK token saver** บีบอัดเนื้อหา `tool_result` ในที่ — ประหยัด ๒๐–๔๐% |
| ❌ จ่าย $20–50/เดือนต่อผู้ให้บริการหนึ่งราย | ✅ เกตเวย์เดียวครอบคลุมเส้นทางซับสคริปชัน + ราคาถูก + ฟรี |
| ❌ เครื่องมือแต่ละตัวต้องตั้งค่าแยกกัน | ✅ ปลายทางที่เข้ากันได้กับ OpenAI เพียงจุดเดียว ทุกเครื่องมือพูดภาษานี้ได้ |
| ❌ ผู้ให้บริการล่ม และงานของคุณก็ล่มตามไปด้วย | ✅ Circuit breaker + เกณฑ์ความล้มเหลวของผู้ให้บริการ + ช่วงเวลาผ่อนคลาย |

---

## ✨ ฟีเจอร์หลัก

**🧭 การกำหนดเส้นทางและการแปลงฟอร์แมต**
- ปลายทางที่เข้ากันได้กับ OpenAI เพียงจุดเดียว: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (การสร้าง การแก้ไข การต่อขยาย), `/v1/responses` (+`/compact`), `/v1beta/*`, การค้นหาเว็บ การดึงและขูดข้อมูล
- การแปลงฟอร์แมตหมุนผ่าน OpenAI เป็นตัวกลาง — มีการลงทะเบียนเส้นทางตรงสำหรับคู่ที่เปราะบาง (thinking blocks, tool ids)
- **ผู้ให้บริการที่เชื่อมต่อได้ ๑๔๕ ราย** ครอบคลุมเส้นทางซับสคริปชัน จ่ายตามใช้ ฟรี ภายในเครื่อง และสื่อ — [รายชื่อทั้งหมด](../docs/PROVIDERS.md)
- การอ้างถึงโมเดลอยู่ในรูป `provider/model` (`kr/claude-sonnet-4.5`) — คำนำหน้าบอกชื่อเส้นทาง

**🪂 ความทนทาน**
- การสำรองผ่านชุดโมเดล: กำหนดชุดโมเดล แล้ว Vela จะไล่ไปตามรายการจนกว่าจะมีผู้ตอบ
- การสำรองหลายบัญชีต่อผู้ให้บริการ สลับแบบหมุนเวียน (round-robin)
- Circuit breaker ต่อพูล — และตัวตัดวงจร **อยู่รอดข้ามการรีสตาร์ต**: ช่วงที่เปิดอยู่คงอยู่ผ่านที่เก็บที่ผูกไว้ กำหนดเวลาถูกจำกัดไม่เกินเพดาน และตัวตัดวงจรที่ถูกกู้คืนจะตั้งไกใหม่เมื่อเกิดความล้มเหลวหนึ่งครั้ง ตรงตามกฎเดียวกับในโปรเซส
- เกณฑ์ความล้มเหลวของผู้ให้บริการพร้อมช่วงผ่อนคลาย (`VELA_PROVIDER_FAILURE_*`), การจัดการข้อมูลรับรอง OAuth + API key พร้อมรีเฟรชโทเค็นเบื้องหลังอัตโนมัติ

**💰 ภูมิปัญญาเรื่องต้นทุน — พันธสัญญาการตั้งราคา (Pricing Covenant)**
- ตารางราคาแบบคงที่ (input / output / cached / reasoning / cache-creation, $/1M โทเค็น) พร้อมลูกโซ่การหาค่าราคาหกขั้นตอน — การแทนที่ระดับผู้ให้บริการ, จับคู่แม่นยำ, การสืบทอดโมเดลฟรี, การตัดส่วน vendor, fallback แบบ glob
- ตัวแก้ไขราคาในแดชบอร์ด + การซิงค์กับ models.dev — ทุกคำขอได้ต้นทุนประมาณการที่ซื่อสัตย์
- การตรวจจับแพลนฟรี: โมเดลฟรีสืบทอดอัตราของโมเดลเสียเงินที่เป็นพี่น้องกัน เพื่อให้เห็นการประหยัดได้ชัดเจน
- ต้นทุนถูกคำนวณ ณ **เวลาที่เขียน** และถูกแช่แข็ง — ไม่มีการเติมย้อนหลัง ไม่มีการคำนวณซ้ำหลังแก้ไขอัตรา

**🐚 RTK Token Saver**
- ฮุคก่อนการแปลงฟอร์แมตบีบอัดเนื้อหา `tool_result` ก่อนที่คำขอจะออกจากท่าเรือ — ออกแบบเป็น fail-open ไม่แตะต้องร่องรอย `is_error`
- ตัวฉีดพรอมต์ที่ผู้ปฏิบัติงานกำหนด (ต่อท้าย/นำหน้า) ซ้อนอยู่เหนือตัวประหยัดในตัว
- sidecar [Headroom](https://github.com/chopratejas/headroom) แบบไม่บังคับสำหรับการบีบอัดที่ลึกยิ่งขึ้น

**🗝️ พันธสัญญาการจัดเก็บข้อมูล (Storage Covenant)**
- สามรูปแบบ ตัวแปร env เดียว: `VELA_DB_MODE=sqlite|mysql|mirror`
- ท่าเรือ SQLite เป็นค่าเริ่มต้น; MariaDB ในฐานะท่าเรือเต็มรูปแบบ; หรือ **mirror** — SQLite ให้บริการ ขณะที่ทุกการเขียนถูกปั๊มไปยังคู่แฝด MariaDB ผ่าน outbox โดยมีการกวาดตรวจความเบี่ยงเบนคอยเฝ้าระวัง
- ห่วงโซ่ไดรเวอร์: `better-sqlite3` → `node:sqlite` (ติดตั้งไม่ต้องอะไรเลยบน Node ≥ 22.5) → `sql.js` แบบ JS แท้; `VELA_DB_DRIVER` ปักหมุดหนึ่งตัว ความล้มเหลวจะดังให้ได้ยิน
- **๒๓ การย้ายข้อมูล (migrations)** (`SCHEMA_VERSION = 23`) — การซิงค์ `TABLES` แบบประกาศทำให้ทั้งสองท่าเรือและคู่แฝดซื่อสัตย์ — ดู [docs/STORAGE.md](../docs/STORAGE.md)
- เอนจินสำรองข้อมูลที่ผนึกแน่น: อาร์ติแฟกต์ AES-256-GCM, ชั้นการเก็บรักษาตามลำดับ, **การซ้อม** กู้คืน, ขา S3 นอกสถานที่แบบไม่บังคับ

**🛡️ ความปลอดภัย**
- ACL ต่อคีย์ — สี่ชั้น: ชนิด, ผู้ให้บริการ, ชุดโมเดล, โมเดล (รายการอนุญาตสามสถานะ)
- ประตูงบประมาณ: เพดานรายวัน, เพดานการใช้จ่าย, จำกัดอัตราต่อคีย์
- **ไม่มีรหัสผ่านเริ่มต้น** รหัส `123456` เดิมได้ปลดระวางแล้ว (v0.9.41) เมื่อยังไม่ตั้งรหัส คอนโซลโลคัลจะให้คุณเข้าได้โดยไม่ต้องใส่รหัส แต่ **ปฏิเสธการเข้าสู่ระบบจากระยะไกล** จนกว่าคุณจะตั้งรหัส (Settings → Access) API key ออกในรูปแบบ `vela-v1-<32 hex>-<8 hex>`; รูปแบบ `sk-` ถูกปฏิเสธทุกที่
- Single sign-on แบบ OIDC และ SAML สำหรับแดชบอร์ด, ประตูตรวจความแข็งแกร่งของ JWT ตอนบูต, บันทึกเซสชันที่ใช้ `jti` เป็นกุญแจ, ตัวล็อก CSRF และ IP ของไคลเอนต์ที่ได้มาจาก **ซ็อกเก็ต TCP** (ปลอมไม่ได้) — ไว้ใจเฮดเดอร์ส่งต่อเฉพาะจากพร็อกซีโลคัลเท่านั้น

**🖥️ แดชบอร์ด** — `http://localhost:32060/dashboard`
- **๓๑ ห้องในแดชบอร์ด** (รวม ๓๖ หน้า) ใน **๓๕ ภาษาของอินเทอร์เฟซ**: ผู้ให้บริการและโฟลว์ OAuth, ชุดโมเดล, ปลายทาง + API key, การใช้งานรายคีย์, โควตา, token saver, คอนโซลตัวแปลฟอร์แมต, การตั้งค่าเครื่องมือ CLI, ฝูงพร็อกซี, กฎการสำรอง, ตัวฉีดพรอมต์, สกิล, บันทึกคำขอ และคอนโซลการตั้งค่า — เริ่มที่ [แผนที่ท่าเรือ](../docs/README.md)

---

## 🚀 เริ่มต้นอย่างรวดเร็ว

### ตัวเลือก A — Docker (แนะนำ)

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

อิมเมจเป็นแบบ **สาธารณะ** — ไม่ต้องเข้าสู่ระบบรีจิสทรี — และรองรับหลายสถาปัตยกรรม (`linux/amd64` + `linux/arm64`) สำหรับแผนที่ฉบับเต็ม — คู่แฝด MariaDB, รูปแบบ mirror, เอนจินสำรองข้อมูล, sidecar Headroom — ดูที่ [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) และเทมเพลต [`docker-compose.example.yml`](../docker-compose.example.yml)

### ตัวเลือก B — npm CLI

```bash
npm install -g vela
vela
```

ตัวเรียกใช้จะติดตั้ง เริ่มต้น และจัดการเซิร์ฟเวอร์ (แพ็คเกจ npm คงชื่อ `vela` ไว้ ส่วนแอปเองเป็น `vela-app` แบบส่วนตัว) ดูที่ [cli/README.md](../cli/README.md)

### ตัวเลือก C — จากซอร์สโค้ด

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # serves on 32060
```

โหมดโปรดักชัน: `npm run build && npm run start` (Node 22+; Bun ก็ใช้ได้เช่นกัน — `npm run dev:bun` / `build:bun` / `start:bun`)

### จากนั้นเชื่อมต่อเครื่องมือ

1. เปิด `http://localhost:32060/dashboard` — **ไม่มีรหัสผ่านเริ่มต้น** คอนโซลโลคัลเข้าได้โดยไม่ต้องใช้รหัส; ตั้งรหัสที่ **Settings → Access** เพื่อเปิดใช้การเข้าถึงจากระยะไกล
2. **Providers** → เชื่อมต่อสักราย (Kiro AI เป็นจุดเริ่มต้นฟรีที่ดี)
3. **Endpoints** → ออก API key
4. ชี้เครื่องมือของคุณมาที่เกตเวย์:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

การเชื่อมต่อทีละเครื่องมือ (Claude Code, Codex, Cursor, Cline, Roo, Continue) อยู่ใน [แผนภูมิการรวมระบบ](../gitbook/content/en/) — และสกิลตัวแทนแบบวางลงได้ทันทีพร้อมวางอยู่ที่ [skills/](../skills/README.md)

---

## 📚 เอกสาร

แผนภูมิต่าง ๆ อยู่ใน [`docs/`](../docs/README.md) — เริ่มที่แผนที่ท่าเรือ ทุกเอกสารใช้เสียงเดียวกัน และทุกจำนวนพาเอาคำสั่งคำนวณซ้ำมาเสมอ: **หากแผนภูมิกับคำสั่งขัดกัน คำสั่งชนะ**

| แผนภูมิ | ครอบคลุมอะไร |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 แผนที่ท่าเรือ — เอกสารทุกฉบับในหน้าเดียว |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ วัฏจักรของคำขอ, เอนจินตัวแปลฟอร์แมต, รีจิสทรีผู้ให้บริการ, ชั้นฐานข้อมูล, เอนจินสำรองข้อมูล, พันธสัญญาการตั้งราคา |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 เส้นทางการติดตั้ง, แผนภูมิ compose, การเปิดเผยและการตรวจความปลอดภัย, การอัปเกรด |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 สัญญาตัวแปรสภาพแวดล้อมฉบับสมบูรณ์ |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ พันธสัญญาการจัดเก็บข้อมูล — sqlite/mysql/mirror, ปั๊ม mirror, การสำรองข้อมูล, S3, การกู้คืน |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 รายชื่อผู้ให้บริการ, ตัวเลขสามตัว, โมเดล executor |
| [docs/API.md](../docs/API.md) | 🔌 พื้นผิวที่เข้ากันได้กับ OpenAI + พื้นผิว REST ของแดชบอร์ด |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 อาการ → สาเหตุ → วิธีแก้ |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ พันธสัญญาการกำหนดเวอร์ชัน — เลื่อน ติดบันทึก ผนึกไว้ด้วยกัน |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker เจาะลึก |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 บันทึกเรือ |

สำหรับผู้เริ่มต้น: [gitbook](../gitbook/content/en/) คือทัวร์สำหรับมือใหม่ ในห้าภาษา **สำหรับวิศวกรที่ทำงานใน repo นี้:** [CLAUDE.md](../CLAUDE.md) — เอกสารประจำลูกเรือ **สำหรับผู้ร่วมพัฒนาเอนจิน:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — วิธีเพิ่มผู้ให้บริการ / executor / ตัวแปลฟอร์แมต

---

## 🗺️ แผนที่ Repository

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

## 🌍 ภาษา

README นี้แปลเป็นอีก ๑๐ ภาษา — ลิงก์อยู่ในแบนเนอร์ด้านบน แดชบอร์ดเองมาพร้อม **๓๕ ภาษาของอินเทอร์เฟซ**; สลับได้ที่ **Settings → General → Language**

---

## 🏛️ ที่มาและลิขสิทธิ์

Vela แล่นตามเส้นทางของตัวเองตั้งแต่ v0.6.0 เป็นต้นมา — เกตเวย์อยู่ภายใต้สัญญาอนุญาต MIT และเป็นของตัวเองเต็มที่ ดูที่ [LICENSE](../LICENSE)

---

<div align="center">
*กางใบเรือของคุณ ลมเป็นของฟรี* ⛵
</div>
