# はじめに

5分、ひとつのエンドポイント、すべてのツールをそこへ向けて。このページは速い道です。細部とトラブルシューティングは[インストール](../getting-started/installation.md)にあります。

---

## クイックスタート

### 1. インストール

```bash
npm install -g vela
```

Node.js 20以降が必要です。`vela`コマンドは小さなランチャーで、ゲートウェイを起動し、ブラウザを開きます。

### 2. 起動

```bash
vela
```

ダッシュボードは**http://localhost:32060/dashboard**で開きます。

初回起動で知っておくとよいことがいくつか:

- **デフォルトのパスワードはありません。** Velaを動かしているマシンからは、ダッシュボードはそのまま開きます。ほかのマシンからのログインは、**設定 → アクセス**でパスワードを設定するまで拒否されます。
- データはmacOSとLinuxでは`~/.vela`、Windowsでは`%APPDATA%\vela`に置かれます。
- ゲートウェイはデフォルトですべてのネットワークインターフェース(`0.0.0.0`)で待ち受けます。このマシンだけで足りるなら、`vela --host 127.0.0.1`で起動してください。

### 3. プロバイダーを接続

プロバイダーには3種類あり、自由に混ぜられます。

#### オプションA — OAuthによるサブスクリプション

**最適:** Claude Code、Codex、GitHub Copilot、Antigravity — すでに払っているもの、あるいはログインしているものはなんでも。

```
Dashboard → Providers → pick a provider → Connect
→ Log in in the browser window → done
```

それ以降、トークンは自分で更新され、クォータ追跡はすぐに始まります。

**例: Claude Code**
1. **Providers**を開き、**Claude**を選びます。
2. **Connect**をクリックし、Claudeアカウントにログインして承認します。
3. モデルはフルネームで使います。たとえば`cc/claude-opus-5`。

#### オプションB — APIキー

**最適:** GLM、MiniMax、Kimi、OpenRouter、そのほか従量課金のプロバイダー。

```
Dashboard → Providers → pick a provider → Add API key
→ paste the key → Save
```

**例: GLM-4.7**
1. お使いのGLMプロバイダーでアカウントとキーを作ります。
2. Velaで: **Providers → GLM → Add API key**、貼り付けて保存。
3. `glm/glm-4.7`を使います。

#### オプションC — 無料プロバイダー

**最適:** 有料のクォータが尽きたときの、最後の一手。

```
Dashboard → Providers → Connect a free provider
→ Device code or OAuth → done
```

**例: Kiro**
1. **Providers**を開き、**Kiro**を選びます。
2. AWS Builder IDまたはソーシャルアカウントでサインインします。
3. `kr/`のモデルを使います — Claudeファミリーを、コストなしで。

### 4. ツール用のAPIキーを作る

```
Dashboard → Endpoint & Key → Create Key → copy it
```

キーは`vela-v1-<id>-<checksum>`の形をしています。一度しか表示されません — 安全な場所に控えるか、なくしたらあとで新しく作ってください。キーごとに、プロバイダーの範囲、レート制限、トークン予算、支出上限を持たせられます。

### 5. ツールをVelaに向ける

どのツールも必要とするものは同じ2つです: エンドポイントとキー。

**Cursor**

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    cc/claude-opus-5     (add it as a custom model)
```

**Cline / Continue / Roo**

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    cc/claude-opus-5
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

**Codex CLI**

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

各ツールには、正確なフィールドとよくあるつまずきを記した専用のページが[連携](../integration/claude-code.md)の下にあります。

---

## 6. フォールバックの鎖を組む(任意だが、おすすめ)

ひとつのモデルは、ひとつの単一障害点です。**コンボ**はモデルの鎖に名前をつける仕組みで、Velaはどれかが答えるまでそれを辿ります。

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      (subscription first)
          2. glm/glm-4.7           (cheap backup)
          3. kr/claude-sonnet-4.5  (free last line)
```

あとはモデル名を書くところに`premium-coding`と書くだけです。コンボは何よりも先に名前で引かれるので、どのツールでも動きます。

コンボが次へ移るのは、リクエストが失敗したときです — クォータのエラー、レート制限、タイムアウト、拒否されたプロンプト、存在しないモデル。日次のクォータが少なくなってきたというだけでは切り替わりません。それは黙ってお金を使うことになるからです。支出上限が欲しいときは、APIキーに設定してください(**Endpoint & Key → Create/Edit Key → budget**)。上限に達すると、Velaは黙って品質を落とすのではなく、はっきりした429でリクエストを断ります。

---

## 利用できるモデル

モデル名は`prefix/model`の形です。ここに最初の一式を挙げます。完全な一覧はダッシュボードの**Providers**を開いてください — プロバイダーが新しいモデルを出すたびに変わります。

### サブスクリプションのレーン

**Claude Code (`cc/`)**
- `cc/claude-opus-5` — 力仕事を担うもの
- `cc/claude-sonnet-5` — 日常のバランス
- `cc/claude-haiku-4-5-20251001` — 速く、軽い

**Codex (`cx/`)**
- `cx/gpt-5.6-sol`、`cx/gpt-5.6-terra`、`cx/gpt-5.6-luna` — 現在のファミリー
- `cx/gpt-5.5`、`cx/gpt-5.4` — いまもあるし、いまも良い

**GitHub Copilot (`gh/`)**
- `gh/claude-sonnet-4.5`、`gh/claude-opus-4.5`、`gh/gpt-5.4`

**Antigravity (`ag/`)**
- `ag/gemini-4-argon-high`とGeminiファミリーの残り、さらにClaudeのモデル

### 格安のレーン

**GLM (`glm/`)** — `glm/glm-4.7`が100万あたり$0.60 / $2.20、さらに新しい`glm-5.x`のモデル

**MiniMax (`minimax/`)** — `minimax/MiniMax-M2.1`が100万あたり$0.30 / $1.20、さらにM2.5、M2.7、M3

**Kimi (`kimi/`)** — `kimi/kimi-latest`、`kimi/kimi-k2.5`、`kimi/k3`

### 無料のレーン

**iFlow (`if/`)** — `if/qwen3-coder-plus`、`if/kimi-k2`、`if/glm-4.7`、`if/deepseek-r1`など

**Qwen (`qwen/`)** — `qwen/qwen-plus`、`qwen/qwen-max`、`qwen/qwen-turbo`

**Kiro (`kr/`)** — `kr/claude-sonnet-4.5`、`kr/claude-opus-4.8`、さらに新しいClaudeのモデル

> **無料枠について:** Gemini CLIが報じられている月18万回の補完や、MetaやGoogleの日次上限といった数字は、**それらのプロバイダーが公表している上流の数字**です — Velaが制御できるものではありません。これまでも変わりましたし、これからも変わります。真実として扱うべきは、ダッシュボードのライブのクォータ表示です。

---

## コストを低く保つ

実践的なルーティンです。表計算は要りません:

```
1. Put your subscription models first in the combo.
2. Put GLM or MiniMax second — a fraction of the cost of any retail API.
3. Always end with a free provider, so the chain never dead-ends.
4. Set a budget ceiling on the API key you hand to tools you leave running.
```

[格安プロバイダー](../providers/cheap.md)と[無料プロバイダー](../providers/free.md)のページには、計算の過程も示した実例があります。

---

## 次のステップ

- [インストール](../getting-started/installation.md) — 要件、Docker、ソースからのビルド、アンインストール
- [スマートルーティング](../features/smart-routing.md) — リクエストがプロバイダーを選ぶ仕組み
- [コンボ](../features/combos.md) — フォールバックの鎖を組む、そして調整する
- [クォータ追跡](../features/quota-tracking.md) — ダッシュボードの読み方
- [よくある質問](../faq.md) — 誰もがまず聞くこと
- [トラブルシューティング](../troubleshooting.md) — つながらないとき

---

## ヘルプが必要ですか?

- **ウェブサイト**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)

Velaはバージョン1.2.4です。いま動いているものを確かめるには:

```bash
npm list -g vela
```
