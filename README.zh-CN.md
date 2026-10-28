<div align="center">
  <img src="./public/vela-wordmark.svg" alt="Vela —— 船之帆" width="520"/>

  **一个 OpenAI 兼容端点。145 条可拨通的上游传输。你的订阅、你的密钥、你的免费额度 —— 同一个港湾,同一张帆。**

  Vela(薇拉)将你的 AI 编程工具(Claude Code、Codex、Cursor、Cline、OpenCode……)统一接入一个本地网关:格式转换、模型组合回退、多账号轮换、配额追踪、按密钥访问控制,外加一个 RTK token 节省器 —— 在请求出港之前先削掉 20–40% 的工具输出 token。

  [![Version](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](./CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](./docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](./LICENSE)

  [🚀 快速开始](#-快速开始) · [✨ 核心特性](#-核心特性) · [📚 文档](#-文档) · [🌐 语言](#-语言)

  🇺🇸 [English](./README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./i18n/README.id-ID.md) · 🇯🇵 [日本語](./i18n/README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./i18n/README.vi.md) · 🇧🇷 [Português](./i18n/README.pt-BR.md) · 🇪🇸 [Español](./i18n/README.es.md) · 🇫🇷 [Français](./i18n/README.fr.md) · 🇷🇺 [Русский](./i18n/README.ru.md) · 🇹🇭 [ไทย](./i18n/README.th.md) · 🇮🇷 [فارسی](./i18n/README.fa_IR.md)
</div>

---

## ⛵ Vela 是什么?

Vela 是一个**本地 AI 路由网关 + 仪表盘**。你把所有 AI 工具指向同一个端点 —— `http://localhost:32060/v1` —— 由 Vela 决定真正应答的是哪家供应商:先花你的付费订阅,再走便宜的 API 通道,最后用免费额度。一条航道干涸,下一条即刻接风。工具端零改动,全程零停机。

```
┌──────────────┐
│  你的工具     │  Claude Code · Codex · Cursor · Cline · OpenCode · …
└──────┬───────┘
       │  http://localhost:32060/v1   (OpenAI 兼容)
       ▼
┌─────────────────────────────────────────────────────┐
│                 Vela —— 网关                        │
│  RTK token 节省器 · 格式转换 · 配额追踪             │
│  组合回退 · 多账号 · OAuth 自动刷新                 │
└──────────┬──────────────────────────────────────────┘
       ├─→ 第一层  订阅      Claude、Codex、Copilot、Cursor…
       ├─→ 第二层  按量付费   GLM、MiniMax、DeepSeek、Qwen…
       └─→ 第三层  免费       Kiro、OpenCode Free、MiMo Free…
       结果:每个订阅 token 都花在刀刃上,每条速率限制都被绕开。
```

一个 Node 进程同时伺服两台引擎:**仪表盘 + API**(`src/`,Next.js App Router 应用)与**路由引擎**(`open-sse/`),同守 **32060** 端口。状态默认落在 SQLite,需要时可以长出 MariaDB 孪生库(sqlite → mysql → mirror)。密封备份引擎守着港湾的地基,网关在每次发布都盖下船身印记,让龙骨随时可验。

> 📌 **注意:** Vela 自成航路 —— 一片开源水域锻造的 AI 网关,存储、备份、定价与分类体系皆为自铸。CLI 以 `vela` 之名从 npm 安装(应用本体是私有包 `vela-app`)。血统:自 v0.6.0 起网关以 MIT 许可完全自铸,见[起源与许可](#-起源与许可)。

> 🔢 **计数纪律**(于 2026-10-28、v1.2.4 实测)。供应商注册表报出**三个诚实的数字,而且它们各不相同**:磁盘上 **189** 个注册表文件 → 生成的索引实际导入 **186** 个 → 运行时可拨通聊天传输 **145** 条(其余 41 条被导入的航道承运的是媒体、搜索与嵌入传输,本就不说聊天)。另有 3 个文件刻意留在索引之外(`trae`、`devin-cli`、`windsurf`)。永远不要把三个数字折成一个 —— 说出你指哪一个,并重新推导而非轻信这一行:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 个磁盘文件
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 个被导入
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 条可拨通
> ```
> 这份普查由 `tests/unit/provider-registry-census.test.js` 以属性形式钉死 —— 哪个文件落上磁盘却没进索引,那里会先变红,供应商绝不会无声熄灭。见[供应商名录](./docs/PROVIDERS.md)。

---

## 🤔 为什么选择 Vela?

| 痛点 | Vela 的对策 |
|-|-|
| ❌ 订阅额度过期也用不完 | ✅ 配额追踪 + 自动回退 —— 在重置之前花光每一个 token |
| ❌ 速率限制让心流戛然而止 | ✅ 多账号轮换 + 模型组合回退,零停机 |
| ❌ 工具输出疯狂烧 token(diff、grep、ls……) | ✅ **RTK token 节省器**原地压缩 `tool_result` 内容 —— 节省 20–40% |
| ❌ 每家供应商每月要花 $20–50 | ✅ 一个网关横跨订阅 + 低价 + 免费三条航道 |
| ❌ 每个工具都要单独配置 | ✅ 一个 OpenAI 兼容端点,所有工具都认它 |
| ❌ 一家供应商沉了,你的心流跟着沉 | ✅ 熔断器 + 供应商故障阈值 + 冷却窗口 |

---

## ✨ 核心特性

**🧭 路由与转换**
- 一个 OpenAI 兼容端点:`/v1/chat/completions`、`/v1/messages`(Claude 原生)、`/v1/embeddings`、`/v1/images/generations`、`/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`、`/v1/videos/*`(generations、edits、extensions)、`/v1/responses`(含 `/compact`)、`/v1beta/*`、web 搜索与抓取
- 格式转换以 OpenAI 作为中间格式枢轴 —— 为脆弱的格式对(thinking block、工具 id)注册了直达路由
- **145 家可拨通供应商**,横跨订阅、按量付费、免费、本地与媒体航道 —— [完整名录](./docs/PROVIDERS.md)
- 模型寻址为 `provider/model`(`kr/claude-sonnet-4.5`)—— 前缀即航道

**🪂 韧性**
- 模型组合回退:定义一个组合,Vela 沿列表逐一尝试,直到有供应商应答
- 每家供应商支持多账号回退,轮换(round-robin)
- 按池熔断 —— 且熔断器**能在重启后幸存**:打开的冷却窗口经绑定的存储持久化,期限设有上限,恢复后的熔断器一次失败即重新武装,与进程内法则一致
- 供应商故障阈值与冷却窗口(`VELA_PROVIDER_FAILURE_*`),OAuth + API 密钥凭据管理,后台自动刷新 token

**💰 成本智能 —— 定价契约**
- 静态价格表(input / output / cached / reasoning / cache-creation,$/1M tokens)配六步解析链 —— 供应商覆盖、精确匹配、免费模型继承、去厂商前缀、glob 兜底
- 仪表盘价格编辑器 + models.dev 同步 —— 每个请求都有诚实的估算成本
- 免费额度识别:免费模型继承其付费兄弟的价格,让节省看得见
- 成本在**写入时**计算并冻结 —— 速率表改了也不回填、不重算

**🐚 RTK Token 节省器**
- 预转换钩子在请求出港前压缩 `tool_result` 内容 —— 设计上失败即放行(fail-open),从不触碰 `is_error` 痕迹
- 操作者可自定义提示词注入器(append/prepend),叠加在内置节省器之后
- 可选 [Headroom](https://github.com/chopratejas/headroom) 边车(sidecar),做更深层压缩

**🗝️ 存储契约**
- 三种姿态,一个环境变量:`VELA_DB_MODE=sqlite|mysql|mirror`
- 默认 SQLite 港湾;MariaDB 可作完整港湾;或者 **mirror** —— SQLite 对外服务,每次写入都经发件箱泵入 MariaDB 孪生库,由分歧巡检护航
- 驱动链:`better-sqlite3` → `node:sqlite`(Node ≥ 22.5 零安装)→ 纯 JS 的 `sql.js`;`VELA_DB_DRIVER` 可钉死其一,失败必响
- **23 个迁移**(`SCHEMA_VERSION = 23`)—— 声明式 `TABLES` 同步让两个港湾与孪生库都不会漂移,见[存储契约](./docs/STORAGE.md)
- 密封备份引擎:AES-256-GCM 备份产物、保留分级、恢复**演练**、可选 S3 异地腿

**🛡️ 安全**
- 按密钥 ACL —— 四层:类型、供应商、组合、模型(三态允许清单)
- 预算闸门:每日上限、消费上限、按密钥速率限制
- **没有默认密码。** 旧的 `123456` 已在 v0.9.41 退役。未设密码时,本地控制台可免密进入,但**拒绝远程登录**,直到你在 Settings → Access 设下一个。API 密钥铸成 `vela-v1-<32 hex>-<8 hex>`;`sk-` 格式处处被拒
- 仪表盘支持 OIDC 与 SAML 单点登录,启动时设有 JWT 强度闸,会话账本以 `jti` 为键,带 CSRF 锁;客户端 IP 从 **TCP 套接字**推导(不可伪造)—— 转发头只在环回代理处受信

**🖥️ 仪表盘** —— `http://localhost:32060/dashboard`
- **31 个仪表盘房间**(共 36 页)界面支持 **35 种语言**:供应商与 OAuth 流程、组合、端点 + API 密钥、按密钥用量、配额、token 节省器、翻译器控制台、CLI 工具配置、代理舰队、回退规则、提示词注入器、技能、请求日志与设置台 —— 从[港湾地图](./docs/README.md)启航

---

## 🚀 快速开始

### 方案 A —— Docker(推荐)

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

镜像**公开** —— 无需登录 registry —— 且多架构(`linux/amd64` + `linux/arm64`)。完整海图 —— MariaDB 孪生库、mirror 姿态、备份引擎、Headroom 边车 —— 见 [DOCKER.md](./DOCKER.md)、[部署海图](./docs/DEPLOYMENT.md)与 [`docker-compose.example.yml`](./docker-compose.example.yml) 模板。

### 方案 B —— npm CLI

```bash
npm install -g vela
vela
```

启动器负责安装、启动并管理服务器(npm 包保留 `vela` 之名;应用本体是私有包 `vela-app`)。见 [cli/README.md](./cli/README.md)。

### 方案 C —— 从源码运行

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # 伺服于 32060
```

生产环境:`npm run build && npm run start`(Node 22+;Bun 亦可 —— `npm run dev:bun` / `build:bun` / `start:bun`)。

### 然后接入你的工具

1. 打开 `http://localhost:32060/dashboard` —— **没有默认密码。** 本地控制台免密进入;在 **Settings → Access** 设下密码后,远程访问才会开启。
2. **Providers** → 连接一家(Kiro AI 是个不错的免费起点)
3. **Endpoints** → 铸造一个 API 密钥
4. 把你的工具指向网关:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (来自仪表盘)
Model:    kr/claude-sonnet-4.5      # 供应商前缀 / 模型名
```

逐工具接线(Claude Code、Codex、Cursor、Cline、Roo、Continue)见[集成海图](./gitbook/content/en/);即贴即用的代理技能见 [skills/](./skills/README.md)。

---

## 📚 文档

海图都存放在 [`docs/`](./docs/README.md) —— 从港湾地图启航。每份海图同一种声音,每个计数都带着它的重推导命令:**海图与命令不一致时,命令为准。**

| 海图 | 内容 |
|-|-|
| [docs/README.md](./docs/README.md) | 🧭 港湾地图 —— 所有海图,一页尽览 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 🏗️ 请求生命周期、翻译器引擎、供应商注册表、数据库层、备份引擎、定价契约 |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 🚀 安装路径、compose 海图、暴露面与安全闸、升级 |
| [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) | 🔧 完整的环境变量契约 |
| [docs/STORAGE.md](./docs/STORAGE.md) | 🗄️ 存储契约 —— sqlite/mysql/mirror、镜像泵、备份、S3、恢复 |
| [docs/PROVIDERS.md](./docs/PROVIDERS.md) | 🌐 供应商名录、三个计数、执行器模型 |
| [docs/API.md](./docs/API.md) | 🔌 OpenAI 兼容面 + 仪表盘 REST 面 |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 🧯 症状 → 病因 → 修法 |
| [docs/VERSIONING.md](./docs/VERSIONING.md) | ⛵ 版本契约 —— 递版本、写日志、一起封印 |
| [DOCKER.md](./DOCKER.md) | 🐳 Docker 深潜 |
| [CHANGELOG.md](./CHANGELOG.md) | 📖 航海日志 |

更新的手:[gitbook](./gitbook/content/en/) 是面向新手的五语种航程。**在本仓库工作的工程师:** [CLAUDE.md](./CLAUDE.md) —— 船员文书。**引擎贡献者:** [open-sse/AGENTS.md](./open-sse/AGENTS.md) —— 如何添加供应商 / 执行器 / 翻译器。

---

## 🗺️ 仓库结构

```
src/                 Next.js 应用 —— 仪表盘 UI + /api 路由(含 /v1)
├── app/             36 个页面(31 个仪表盘房间)+ 255 个 API 路由处理器
├── sse/handlers/    应用侧入口粘合(chat、tts、images、search…)
└── lib/db/          SQLite/MariaDB 层 —— 驱动链、仓储、镜像、备份
open-sse/            与供应商解耦的路由/翻译引擎
├── handlers/        chatCore、embeddings、tts、images、video、search
├── executors/       按供应商的上游调用(43 个文件,含 index)
├── translator/      经 OpenAI 枢轴的格式转换
├── providers/       注册表(190 个文件,含 index)+ 定价契约
└── rtk/             token 节省钩子(fail-open)
cli/                 启动器包(npm: vela)
docs/                海图 —— 从 docs/README.md 启航
gitbook/             新手航程 —— 100 页 × 5 种语言
skills/              即贴即用的代理技能
tests/               vitest 测试舰队 —— 480 个在役测试文件
i18n/                本地化 README(10 种语言)
plans/               密封设计计划(内部,gitignored)
scripts/             日志同步、注册表生成器、图标子集
```

---

## 🌍 语言

本 README 另有 10 种语言的译本 —— 链接见顶部横幅。仪表盘本身内置 **35** 种界面语言;从 **Settings → General → Language** 切换。

---

## 🏛️ 起源与许可

Vela 自 v0.6.0 起扬帆独行 —— 网关以 MIT 许可发布,完全自铸。见 [LICENSE](./LICENSE)。

---

<div align="center">

*扬起你的帆。风是免费的。* ⛵

</div>