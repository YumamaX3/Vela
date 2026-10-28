<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — 船の帆" width="520"/>

  **OpenAI互換エンドポイントはひとつ。ダイヤル可能な上流トランスポートは145。サブスクリプションも、APIキーも、無料枠も — 港はひとつ、帆もひとつ。**

  VelaはあなたのAIコーディングツール(Claude Code、Codex、Cursor、Cline、OpenCode…)を、単一のローカルゲートウェイへと導きます。フォーマット変換、モデルコンボのフォールバック、マルチアカウントのローテーション、クォータ追跡、キーごとのACL、そしてツール出力のトークンを港から出港する前に20~40%削減するRTKトークンセーバーを備えています。

  [![Version](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 クイックスタート](#-quick-start) · [✨ 主な機能](#-key-features) · [📚 ドキュメント](#-documentation) · [🌐 言語](#-languages)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 📌 英語版が正典です — [README.md](../README.md)。

---

## ⛵ Velaとは?

Velaは**ローカルAIルーティングゲートウェイ + ダッシュボード**です。すべてのAIツールをひとつのエンドポイント — `http://localhost:32060/v1` — に向けるだけで、実際にどのプロバイダーが応答するかはVelaが決めます。まず有料サブスクリプション、次に格安のAPIレーン、最後に無料枠。ひとつのレーンが尽きれば、次のレーンが風を受ける。ツール側の変更は不要、ダウンタイムもありません。

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

ひとつのNodeプロセスが2つのエンジンを載せています。**ダッシュボード + API**(`src/`、Next.js App Router製)と、**ルーティングエンジン**(`open-sse/`)です — ポートは**32060**。状態はデフォルトでSQLiteに置かれ、望めばMariaDBの双子を増やせます(`sqlite` → `mysql` → `mirror`)。封印されたバックアップエンジンが港の地盤を見張り、ゲートウェイはすべてのリリースに刻印を打つので、船体はいつでも証明できます。

> 📌 **注記:** Velaは独自の航路を進みます — 開かれた海から鍛えられたAIゲートウェイであり、ストレージ、バックアップ、価格設定、カテゴリの各システムはすべて自前です。CLIはnpmから `vela` としてインストールします。フォークの来歴: v0.6.0以降、ゲートウェイはMITライセンスのもと完全に自前のものとなっています([来歴](#-provenance--license)を参照)。

> 🔢 **カウントの規律**(2026-10-28、v1.2.4時点の実測)。プロバイダーレジストリは**3つの正直な数字を報告しており、これらは異なります**: ディスク上の**189**レジストリファイル → 生成インデックスが**186**を読み込み → ダイヤル可能なチャットトランスポートは**145**(残る41の読み込み済みレーンは、正当にチャットを話さないメディア・検索・埋め込みトランスポートです)。3つのファイルは意図的にインデックスから隠されてディスク上に置かれています(`trae`、`devin-cli`、`windsurf`)。3つをひとつに潰さないこと — どの数字を指しているのかを明示し、この行を信じるのではなく再導出してください:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # ディスク上 189 ファイル
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 読み込み済み 186
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # ダイヤル可能 145
> ```
> この census は `tests/unit/provider-registry-census.test.js` によってプロパティとして固定されています — インポートされないままファイルがディスクに着地すれば、静かに闇に落ちる前に、そこが赤くなる。詳しくは[docs/PROVIDERS.md](../docs/PROVIDERS.md)を参照してください。

---

## 🤔 なぜVelaなのか?

| 課題 | Velaの解決策 |
|-|-|
| ❌ サブスクリプションのクォータが使われないまま失効する | ✅ クォータ追跡 + 自動フォールバック — リセット前にすべてのトークンを使い切る |
| ❌ レート制限が作業の途中で止める | ✅ マルチアカウントのローテーション + モデルコンボのフォールバック、ダウンタイムゼロ |
| ❌ ツール出力がトークンを燃やす(diff、grep、ls…) | ✅ **RTKトークンセーバー**が`tool_result`の内容をその場で圧縮 — 20~40%の節約 |
| ❌ プロバイダーごとに月額$20~50を払う | ✅ サブスク + 格安 + 無料レーンを横断するひとつのゲートウェイ |
| ❌ あらゆるツールがそれぞれの設定を必要とする | ✅ OpenAI互換エンドポイントはひとつ、あらゆるツールがそれを話せる |
| ❌ ひとつのプロバイダーが落ちると、あなたの流れも落ちる | ✅ サーキットブレーカー + プロバイダー障害しきい値 + クーリングウィンドウ |

---

## ✨ 主な機能

**🧭 ルーティング & 変換**
- OpenAI互換エンドポイントはひとつ: `/v1/chat/completions`、`/v1/messages`(Claudeネイティブ)、`/v1/embeddings`、`/v1/images/generations`、`/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`、`/v1/videos/*`(生成、編集、拡張)、`/v1/responses`(+`/compact`)、`/v1beta/*`、web search、fetch & scrape
- フォーマット変換はOpenAIを中間形式として経由 — 壊れやすいペア(thinking block、tool id)には直通ルートを登録
- サブスクリプション、従量課金、無料、ローカル、メディアの各レーンにわたる**145のダイヤル可能プロバイダー** — [全一覧](../docs/PROVIDERS.md)
- モデルの指定は`provider/model`(例: `kr/claude-sonnet-4.5`)— 接頭辞がレーンの名を指す

**🪂 耐障害性**
- モデルコンボのフォールバック: コンボを定義すれば、どれかが答えるまでVelaがリストを辿る
- プロバイダーごとのマルチアカウントフォールバック、ラウンドロビンのローテーション
- プールごとのサーキットブレーカー — このブレーカーは**再起動を生き延びる**: 開いたウィンドウはバインド先のストアを通じて持続し、期限は上限に締められ、復元されたブレーカーは1回の失敗で再武装し、プロセス内の法と一致する
- クーリングウィンドウ付きのプロバイダー障害しきい値(`VELA_PROVIDER_FAILURE_*`)、OAuth + APIキーの資格情報管理と、バックグラウンドでの自動トークンリフレッシュ

**💰 コストインテリジェンス — 価格の契約(Pricing Covenant)**
- 静的価格テーブル(input / output / cached / reasoning / cache-creation、$/1Mトークン)と6段階の解決チェーン — プロバイダーによる上書き、完全一致、無料モデルの継承、ベンダー名の除去、globフォールバック
- ダッシュボードの価格エディター + models.dev同期 — すべてのリクエストに誠実な推定コストが付く
- 無料枠の検出: 無料モデルは有料の兄弟モデルの料率を継承するため、節約額が可視化される
- コストは**書き込み時に**計算されて凍結される — バックフィルも、料率編集後の再計算もない

**🐚 RTKトークンセーバー**
- 変換前フックが、リクエストが出港する前に`tool_result`の内容を圧縮 — 設計上フェイルオープンで、`is_error`のトレースには決して触れない
- オペレーター定義のプロンプトインジェクター(append/prepend)を、組み込みセーバーの後に重ねられる
- より深い圧縮のためのオプションの[Headroom](https://github.com/chopratejas/headroom)サイドカー

**🗝️ ストレージの契約(Storage Covenant)**
- 3つの姿勢、1つの環境変数: `VELA_DB_MODE=sqlite|mysql|mirror`
- デフォルトはSQLiteの港。MariaDBを完全な港として使うこともできる。あるいは**mirror** — SQLiteが応答を担いつつ、すべての書き込みをアウトボックス経由でMariaDBの双子へ送り込み、ダイバージェンススイープがそれを見張る
- ドライバーチェーン: `better-sqlite3` → `node:sqlite`(Node ≥ 22.5ではゼロインストール)→ 純JSの`sql.js`;`VELA_DB_DRIVER`でひとつに固定でき、失敗は大きな声で知らされる
- **23のマイグレーション**(`SCHEMA_VERSION = 23`)— 宣言的な`TABLES`同期が両方の港と双子を正直に保つ — 詳しくは[docs/STORAGE.md](../docs/STORAGE.md)
- 封印されたバックアップエンジン: AES-256-GCMの成果物、保持階層、リストア**ドリル**、オプションのS3オフサイト区間

**🛡️ セキュリティ**
- キーごとのACL — 4つの層: 種別、プロバイダー、コンボ、モデル(三状態の許可リスト)
- 予算ゲート: 日次上限、支出上限、キーごとのレート制限
- **デフォルトのパスワードはありません。** 旧来の`123456`は廃止されました(v0.9.41)。何も設定していない場合、ローカルコンソールはパスワードなしで入場を許しますが、パスワードを設定するまでは**リモートログインを拒否します**(設定 → アクセス)。APIキーは`vela-v1-<32桁の16進数>-<8桁の16進数>`として発行され、`sk-`形式はどこでも拒否されます
- ダッシュボード向けのOIDCとSAMLのシングルサインオン、起動時のJWT強度ゲート、`jti`を鍵とするセッション台帳、CSRFロック、そしてクライアントIPは**TCPソケット**から導出(なりすまし不可)— 転送ヘッダーはループプロキシからのみ信頼されます

**🖥️ ダッシュボード** — `http://localhost:32060/dashboard`
- **31のダッシュボードルーム**(全36ページ)を**35のインターフェースロケール**で提供: プロバイダー & OAuthフロー、コンボ、エンドポイント + APIキー、キーごとの使用量、クォータ、トークンセーバー、トランスレーターコンソール、CLIツールのセットアップ、プロキシ艦隊、フォールバックルール、プロンプトインジェクター、スキル、リクエストログ、設定コンソール — まずは[港の地図](../docs/README.md)から

---

## 🚀 クイックスタート

### 選択肢A — Docker(推奨)

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

イメージは**公開**されています — レジストリへのログインは不要です — そしてマルチアーキテクチャ対応(`linux/amd64` + `linux/arm64`)。詳細な海図 — MariaDBの双子、mirror姿勢、バックアップエンジン、Headroomサイドカー — は[DOCKER.md](../DOCKER.md)、[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)、そして[`docker-compose.example.yml`](../docker-compose.example.yml)テンプレートを参照してください。

### 選択肢B — npm CLI

```bash
npm install -g vela
vela
```

ランチャーがサーバーのインストール・起動・管理を行います(npmパッケージは`vela`の名前を保ち、アプリ本体はプライベートな`vela-app`です)。[cli/README.md](../cli/README.md)を参照してください。

### 選択肢C — ソースから

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # 32060 で提供
```

本番環境: `npm run build && npm run start`(Node 22+。Bunでも動作します — `npm run dev:bun` / `build:bun` / `start:bun`)。

### そしてツールを接続する

1. `http://localhost:32060/dashboard` を開く — **デフォルトのパスワードはありません。** ローカルコンソールはパスワードなしで入場できます。リモートアクセスを有効にするには、**設定 → アクセス**でパスワードを設定してください。
2. **Providers** → ひとつ接続する(Kiro AIは無料の良い出発点です)
3. **Endpoints** → APIキーを発行する
4. ツールをゲートウェイに向ける:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (ダッシュボードから)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

ツール別の配線(Claude Code、Codex、Cursor、Cline、Roo、Continue)は[統合の海図](../gitbook/content/en/)にあり、すぐに貼り付けられるエージェントスキルは[skills/](../skills/README.md)に置かれています。

---

## 📚 ドキュメント

海図は[`docs/`](../docs/README.md)にあります — まずは港の地図から。すべてのドキュメントは同じ声をまとい、すべての数には再導出のコマンドが添えられています: **海図とコマンドが食い違うなら、コマンドが勝ちます。**

| 海図 | 内容 |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 港の地図 — すべてのドキュメントを1ページに |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ リクエストのライフサイクル、トランスレーターエンジン、プロバイダーレジストリ、DBレイヤー、バックアップエンジン、価格の契約 |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 インストールの道筋、composeの海図、外部公開とセキュリティゲート、アップグレード |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 環境変数の契約の全容 |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ ストレージの契約 — sqlite/mysql/mirror、mirrorポンプ、バックアップ、S3、リカバリ |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 プロバイダーの顔ぶれ、3つの数、エグゼキューターのモデル |
| [docs/API.md](../docs/API.md) | 🔌 OpenAI互換のサーフェス + ダッシュボードのRESTサーフェス |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 症状 → 原因 → 対処 |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ バージョニングの契約 — バンプ、ログ、封印を同時に |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker、深く |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 船の航海日誌 |

初めての方へ: [gitbook](../gitbook/content/en/)は、5つの言語で書かれた入門者のための案内です。**このリポジトリで作業するエンジニアへ:** [CLAUDE.md](../CLAUDE.md) — 乗組員の書類一式。**エンジンへのコントリビューターへ:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — プロバイダー / エグゼキューター / トランスレーターの追加方法。

---

## 🗺️ リポジトリマップ

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

## 🌍 言語

このREADMEはさらに10の言語に翻訳されています — リンクは上部のバナーにあります。ダッシュボード自体は**35のインターフェースロケール**を搭載しており、**設定 → 一般 → 言語**から切り替えられます。

---

## 🏛️ 来歴とライセンス

Velaはv0.6.0以降、独自の航路を進んでいます — ゲートウェイはMITライセンスのもと、完全に自前のものです。[LICENSE](../LICENSE)を参照してください。

---

<div align="center">
*帆を張れ。風はただ。* ⛵
</div>
