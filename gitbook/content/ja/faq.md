# よくある質問

誰もがまず聞く問いに、平たく答えます。ここに当てはまるものがなければ、次は[トラブルシューティング](troubleshooting.md)です。

---

## Velaとは何ですか?

**あなたのコーディングツールとAIプロバイダーのあいだの、ゲートウェイです。**

すべてのツールをひとつのアドレスに向けます — `http://localhost:32060/v1` — そしてVelaが、リクエストごとに、接続したプロバイダーへと流します。クォータを追い、OAuthトークンを新しく保ち、ひとつが断ったら別のモデルへフォールバックできます。

それはモデルではなく、モデルを無料にもしません。すでにアクセスできるモデルたちのあいだの、交換台です。

---

## Velaは無料ですか?

**Vela自体は無料で、オープンソースです(MIT)。**

お金がかかるのは上流で起きることです: Claude Codeのサブスクリプション、Codexのプラン、あるいはGLMやMiniMaxのようなトークン単位のプロバイダー。Velaはその上に手数料を足しません。

その制限を受け入れるなら、無料のプロバイダーだけでも動かせます — iFlow、Qwen、Kiro、Antigravity。その組み合わせは何もかかりません。

---

## ルーティングはどう動きますか?

仕組みはふたつあり、それらは違うものです:

1. **コンボ**は、あなたが定義する鎖です: モデル1、次にモデル2、次にモデル3。モデルへのリクエストが*失敗*したとき — クォータのエラー、レート制限、タイムアウト、拒否されたプロンプト、未知のモデル — Velaは次を試します。
2. **ラウンドロビン**(プロバイダーごと、あるいはコンボごと)は、同じプロバイダーの複数のアカウントにリクエストを散らし、ひとつのアカウントが叩かれ続けないようにします。

どちらも、日次の割り当てが少なくなってきたというだけの理由で、より安いモデルへ切り替えることはしません。それは、あなたが同意していないお金を使うことになります。

かたい上限には、キーごとの予算を使ってください。上限に達すると、Velaはそう告げる429で断ります。

[スマートルーティング](features/smart-routing.md)と[コンボ](features/combos.md)を見てください。

---

## Velaはいくつのプロバイダーに対応していますか?

正直な3つの数字、2026-10-28、バージョン1.2.4で測ったものです:

- **189** — レジストリにあるプロバイダーファイル
- **186** — インデックスが読み込んでいるもの(3つは意図的にコメントアウトされています: `devin-cli`、`trae`、`windsurf`)
- **145** — リクエストが実際に届けるトランスポートのあるもの

自分のクローンで導き直せます:

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

ここでレーンごとに説明しているもの:

- **サブスクリプション:** Claude Code、Codex、GitHub Copilot、Antigravity、Kimi
- **格安:** GLM、MiniMax、Kimi
- **無料:** iFlow、Qwen、Kiro

---

## 今日使えるのはどのモデルですか?

モデルIDは`prefix/model`の形です。このリリースで確かなもののいくつか:

| モデル | レーン |
|-------|------|
| `cc/claude-opus-5`、`cc/claude-sonnet-5` | Claude Codeサブスクリプション |
| `cx/gpt-5.6-sol`、`cx/gpt-5.5` | Codexサブスクリプション |
| `gh/claude-sonnet-4.6`、`gh/gpt-5.4` | GitHub Copilot |
| `ag/gemini-4-argon-high` | Antigravity(無料) |
| `glm/glm-4.7` | 格安 — 100万あたり$0.60 / $2.20 |
| `minimax/MiniMax-M2.1` | 格安 — 100万あたり$0.30 / $1.20 |
| `kr/claude-sonnet-4.5` | 無料 |
| `if/qwen3-coder-plus` | 無料 |
| `qwen/qwen-plus` | 無料 |

ドキュメントを、動いているゲートウェイより信じてはいけません:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

その一覧が、あなたのインストールのための真実です。

---

## 複数のプロバイダーを一緒に使えますか?

**はい — それが要点です。** コンボを組んでください:

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5       ← subscription
          2. glm/glm-4.7            ← cheap
          3. kr/claude-sonnet-4.5   ← free
```

あとはどのツールでも、モデル名として`premium-coding`を使ってください。コンボの名前は何よりも先に解決されるので、ワイヤの上ではふつうのモデルに見えます。

---

## VelaはCursorで動きますか?

**はい。** CursorはOpenAI互換のベースURLとキーを受け取ります。Velaがあなたのマシンで動いているなら:

```
Cursor → Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    your model or combo name (add it as a custom model)
```

Cursorのバージョンによっては、カスタムのエンドポイントを有料プランに限っていたり、設定によってはCursor自身のサーバー経由でルーティングしたりします。その場合、`localhost`は彼らの側からは届きません。そういうときは、公開アドレスを持つサーバーにVelaをデプロイし([クラウドへのデプロイ](deployment/cloud.md))、かわりに`https://your-domain/v1`を使ってください。

ベースURLを受け取るほかのツールも同じように動きます: Cline、Roo、Continue、Claude Code、Codex CLI、そしてOpenAI互換のそのほかすべて。[連携](integration/claude-code.md)を見てください。

---

## Velaをセルフホストできますか?

**はい、そしてそれが動かすべき意図されたやり方です。** 3つの道:

**あなたのマシンで:**
```bash
npm install -g vela
vela
# dashboard: http://localhost:32060/dashboard
# API:       http://localhost:32060/v1
```

**Dockerで、どのサーバーでも:**
```bash
docker run -d --name vela \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.4
```

イメージは公開です — pullにログインもトークンも要りません — そしてマルチアーキテクチャです(amd64とarm64)。`:latest`ではなく、タグを固定してください。

**ソースから:**
```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

リポジトリのルートがアプリです。入れ子の`app/`ディレクトリはありません。スクリプトは`dev`、`build`、`start`(とそのBunの変種)で — テストのスクリプトも、Cloudflareへのデプロイのスクリプトもありません。

詳細: [ローカル](deployment/localhost.md)・[クラウド](deployment/cloud.md)。

---

## データは安全ですか?

**デフォルトでは、あなたのマシンに留まります。**

- すべてデータディレクトリに住みます — macOS/Linuxなら`~/.vela`、Windowsなら`%APPDATA%\vela`、あるいは`DATA_DIR`が名指すもの。
- 接続したプロバイダーのOAuthトークンとAPIキーは、そのローカルのデータベースに保存されます。
- Velaは、あなたが接続したプロバイダーにだけリクエストを送ります。Velaのプロジェクトへ何かが報告されることはありません。

**保持するもの:** プロバイダーの接続とトークン、あなたのAPIキー(ハッシュとして保存 — 完全なキーは作成時に一度だけ表示)、利用の統計、コンボ、設定、そしてリクエストログ(有効にした場合だけ)。

**保持しないもの:** リクエストログを除いた、あなたのプロンプトや生成されたコードの複製。リクエストログはデフォルトでオフです。

**ネットワークに晒す前に:** **設定 → アクセス**でダッシュボードのパスワードを設定し、**ダッシュボードのログインを必須にする**をオンにし、**APIキーを必須にする**を考え、HTTPSの背後に置いてください。チェックリストは[クラウドへのデプロイ](deployment/cloud.md)にあります。

---

## デフォルトのパスワードは何ですか?

**ありません。**

古いチュートリアルは`123456`に触れていますが、そのデフォルトは引退しました。現在のVelaにはデフォルトのパスワードがまったくありません:

- Velaを動かしているマシンからは、ダッシュボードは何も求めずに開きます。
- ほかのどこからでも、**設定 → アクセス**でパスワードを設定するまで、ログインは**拒否**されます。

同じ画面で、制御が整えば緑の「ゲート済み」の判定が示されます — ポートを開く前に確かめる価値があります。

---

## Velaはどうやって更新しますか?

```bash
# npm install
npm update -g vela
npm list -g vela        # what you are running now

# Docker — pin the newer tag deliberately
docker pull ghcr.io/yumamax3/vela:1.2.4
docker stop vela && docker rm vela
# re-run your docker run command with the new tag

# From a git checkout
cd Vela && git pull && npm install && npm run build && npm run start
```

大きなバージョンの前には、まずデータディレクトリをバックアップしてください。データベースの移行は起動時に自動で走り、その前に安全のための複製が取られます。

---

## どうやって貢献できますか?

とても歓迎します。

1. **バグを報告する** — [GitHub Issues](https://github.com/YumamaX3/Vela/issues)に、エラー、手順、あなたのバージョンとともに。
2. **機能を要望する** — [GitHub Discussions](https://github.com/YumamaX3/Vela/discussions)。
3. **コードを送る:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Vela.git
   cd Vela
   git checkout -b feature/your-feature
   npm install
   npm run dev
   ```
   プルリクエストを開く前に、リポジトリが同梱するチェックの一式を走らせ、コミットは小さく説明的に保ってください。
4. **ドキュメントを良くする** — 修正も翻訳も、機能と同じくらい役に立ちます。
5. **プロバイダーを足す** — アダプターの例は`open-sse/providers/registry/`の下にあります。

---

## Velaはどのポートを使いますか?

- **32060** — すべて。ダッシュボード(`/dashboard`)とAPI(`/v1`)で、ひとつのプロセスが供します。
- ブラウザでまた**32060**というのは、`http://localhost:32060`ということです。ダッシュボードはその一段下の`/dashboard`に住んでいます。

ほかの何かがそのポートを要るなら、`vela --port 8080`か`PORT=8080`で変えてください。

---

## 何かが壊れたら、どこへ行けばいいですか?

1. `http://localhost:32060/api/health`が`{"ok":true}`で答えるはずです。そうでなければ、Velaは動いていません。
2. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`がモデルを一覧するはずです。空の一覧は、プロバイダーが接続されていないという意味です。
3. [トラブルシューティング](troubleshooting.md)が、よくあるエラー — 接続が拒否される、キーが無効、モデルが見つからない、返事が遅い — を直し方に対応づけています。

---

## もっと助けが必要ですか?

- **ドキュメント:** [vela.my.id/docs](https://vela.my.id/docs)
- **GitHub:** [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **トラブルシューティング:** [troubleshooting.md](troubleshooting.md)
