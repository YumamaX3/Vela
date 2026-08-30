<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — 船の帆" width="520"/>

  **OpenAI互換エンドポイントはひとつだけ。上流プロバイダーは40以上。サブスクリプションも、APIキーも、無料枠も — 港はひとつ、帆もひとつ。**

  VelaはあなたのAIコーディングツール(Claude Code、Codex、Cursor、Cline、OpenCode…)を単一のローカルゲートウェイへ接続します。フォーマット変換、モデルコンボフォールバック、マルチアカウントローテーション、クォータ管理、そして出港前にツール出力トークンを20~40%削減するRTKトークンセーバーを備えています。

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 クイックスタート](#-quick-start) · [✨ 主な機能](#-key-features) · [📚 ドキュメント](#-documentation) · [🌐 言語](#-languages)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 📌 英語版が正典です — [README.md](../README.md)。

---

## ⛵ Velaとは?

Velaは**ローカルAIルーティングゲートウェイ + ダッシュボード**です。すべてのAIツールを単一のエンドポイント — `http://localhost:32060/v1` — に向けるだけで、実際に応答するプロバイダーはVelaが判断します。まず有料サブスクリプション、次に格安APIレーン、最後に無料枠。ひとつのレーンが尽きれば、次のレーンが風を受けます。ツール側の変更は不要、ダウンタイムもありません。

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

その中身:ポート**32060**で動くNext.jsサーバー(ダッシュボード + API)、プロバイダー非依存のルーティングエンジン(`open-sse/`)、そして必要になればMariaDBの双子を増やせるSQLiteデータベース(sqlite → mysql → mirror)。

> 📌 **注記:** Velaは独自の航路を進みます — 開かれた海から鍛えられたAIゲートウェイであり、ストレージ、バックアップ、価格設定、カテゴリの各システムはすべて自前です。CLIはnpmから `vela` としてインストールします。

---

## 🤔 なぜVelaなのか?

| 課題 | Velaの解決策 |
|-|-|
| ❌ サブスクリプションのクォータが使わずに期限切れ | ✅ クォータ管理 + 自動フォールバック — リセット前にすべてのトークンを使い切る |
| ❌ レート制限で作業が中断される | ✅ マルチアカウントローテーション + モデルコンボフォールバック、ダウンタイムゼロ |
| ❌ ツール出力がトークンを消費(diff、grep、ls…) | ✅ **RTKトークンセーバー**が`tool_result`の内容をその場で圧縮 — 20~40%削減 |
| ❌ プロバイダーごとに月額$20~50の支払い | ✅ サブスク + 格安 + 無料レーンを横断する単一ゲートウェイ |
| ❌ ツールごとに個別の設定が必要 | ✅ OpenAI互換エンドポイントはひとつ、あらゆるツールが話せる |

---

## ✨ 主な機能

**🧭 ルーティング & フォーマット変換**
- 単一のOpenAI互換エンドポイント: `/v1/chat/completions`、`/v1/messages`(Claudeネイティブ)、`/v1/embeddings`、`/v1/images/generations`、`/v1/audio/*`、`/v1/responses`、`/v1/videos/*`、web search & fetch
- フォーマット変換はOpenAIを中間形式として中継 — 壊れやすいペア(thinking blocks、tool ids)には直通ルートを登録
- **129のプロバイダー**を登録済み: OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、Qwen、GLM、MiniMax、Kimi、Mistral、Groq、Cerebras、Vertex、Azure、Ollama、他多数 — [全一覧](../docs/PROVIDERS.md)

**🪂 耐障害性**
- モデルコンボフォールバック: コンボを定義すれば、どれかが応答するまでVelaがリストを順にたどる
- プロバイダーごとのマルチアカウントフォールバック、ラウンドロビン方式のローテーション
- OAuth + APIキーの認証情報管理、トークンの自動リフレッシュ付き

**💰 コストインテリジェンス — Pricing Covenant**
- 静的な価格テーブル(input / output / cached / reasoning / cache-creation、$/1Mトークン)と6段階の解決チェーン — プロバイダーオーバーライド、完全一致、無料モデル継承、ベンダー名除去、グロブフォールバック
- ダッシュボードの価格エディター + models.dev同期 — すべてのリクエストに誠実な推定コストを付与
- 無料枠の検出: 無料モデルは有料の兄弟モデルの料率を継承するため、節約額が可視化される

**🐚 RTKトークンセーバー**
- プリトランスレートフックがリクエストの出港前に`tool_result`の内容を圧縮 — 設計上フェイルオープン、`is_error`のトレースには決して触れない
- より深い圧縮のためのオプションの[Headroom](https://github.com/chopratejas/headroom)サイドカー

**🗝️ Storage Covenant**
- 3つの姿勢、1つの環境変数: `VELA_DB_MODE=sqlite|mysql|mirror`
- デフォルトはSQLiteの港; MariaDBを完全な港として使うことも可能; あるいは**mirror** — SQLiteが応答しつつ、すべての書き込みをMariaDBの双子へ送り込み、ダイバージェンススウィープで監視
- 封印バックアップエンジン: AES-256-GCM成果物、保持階層、ドリル + リストア、オプションのS3オフサイト区間

**🖥️ ダッシュボード** — `http://localhost:32060/dashboard`
- プロバイダー & OAuthフロー、コンボ、エンドポイント + APIキー、キーごとの使用量、クォータ、トークンセーバー、トランスレーターコンソール、CLIツールセットアップページ、価格設定 — 34以上のインターフェースロケール対応

---

## 🚀 クイックスタート

### 選択肢A — Docker(推奨)

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

完全な海図 — MariaDBの双子、mirror姿勢、バックアップエンジン、Headroomサイドカー — は[DOCKER.md](../DOCKER.md)と[`docker-compose.example.yml`](../docker-compose.example.yml)テンプレートを参照してください。

### 選択肢B — npm CLI

```bash
npm install -g vela
vela
```

CLIがサーバーのインストール・起動・管理を行います(ランチャーパッケージはnpm上で`vela`の名前を維持しています)。

### 選択肢C — ソースから

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

本番環境: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### そしてツールを接続

1. `http://localhost:32060/dashboard`を開く(デフォルトのパスワードは`123456` — 必ず変更してください)
2. **Providers** → ひとつ接続(Kiro AIは無料の良い出発点です)
3. **Endpoints** → APIキーをコピー
4. ツールをゲートウェイに向ける:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 ドキュメント

海図は[`docs/`](../docs/README.md)にあります — 港の完全な地図です。

| 海図 | 内容 |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 港の地図 — すべてのドキュメントを1ページに |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ リクエストのライフサイクル、トランスレーターエンジン、プロバイダーレジストリ、DBレイヤー |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 インストール手順、composeチャート、ストレージ姿勢、アップグレード |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 環境変数契約の全容 |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Storage Covenant — sqlite/mysql/mirror、バックアップ、S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 129プロバイダーの全一覧 |
| [docs/API.md](../docs/API.md) | 🔌 OpenAI互換サーフェス + ダッシュボードAPI |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 風が止んだとき |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ バージョニングの契約 |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker徹底ガイド |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 航海日誌 |

**このリポジトリで作業するエンジニアへ:** [CLAUDE.md](../CLAUDE.md) — 乗組員の書類一式。
**エンジンへのコントリビューターへ:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — プロバイダー / エグゼキューター / トランスレーターの追加方法。

---

## 🗺️ リポジトリマップ

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

## 🌍 言語

このREADMEはさらに10の言語に翻訳されています — リンクは上部のバナーにあります。ダッシュボード自体も34以上のインターフェースロケールを搭載。ダッシュボードのプロフィールページから切り替えられます。

---

## 🏛️ 来歴とライセンス

Velaはv0.6.0以降、独自の航路を進んでいます — ゲートウェイはMITライセンスで、完全に自前のものです。[LICENSE](../LICENSE)を参照してください。

---

<div align="center">

*帆を上げよ。風はただ。* ⛵

</div>
