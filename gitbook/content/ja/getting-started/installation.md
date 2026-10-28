# インストール

Velaを動かすために必要なすべて: 要件、4つのインストール方法、ちゃんと動くかを確かめる手順、そしてきれいに片付ける方法。2分で動かしたいだけなら、[クイックスタート](quick-start.md)が近道です。

---

## 要件

### システム要件

- **Node.js**: npmからインストールする場合はバージョン20以降。公式のDockerイメージにはNode 22が入っているので、Dockerを使う人は読み飛ばせます。
- **npm**: バージョン10以降(Node.jsに同梱されています)。
- **オペレーティングシステム**: macOS、Linux、Windows(Windowsはネイティブで動きます。WSLも問題ありません)。
- **ディスク**: アプリ本体に約500MB、利用履歴が増えるにしたがってデータも増えます。
- **メモリ**: 約1GBあれば快適です。Dockerイメージはデフォルトで1GBのヒープ上限を設定します。

いま入っているものを確かめましょう:

```bash
node --version
# v20.x.x or newer

npm --version
# 10.x.x or newer
```

Node.jsがなければ、[nodejs.org](https://nodejs.org/)から、あるいは`nvm`のようなバージョンマネージャーで入れてください。

---

## インストール方法

### 方法1: npmでグローバルインストール(推奨)

```bash
npm install -g vela
vela
```

`vela`コマンドはランチャーです。ゲートウェイを起動し、ポートが応答するのを待って、ダッシュボードを開きます。知っておくとよいフラグ:

```bash
vela                    # start on the default port, open the browser
vela --port 8080        # a different port
vela --host 127.0.0.1   # this machine only (the default binds 0.0.0.0)
vela --no-browser       # do not open a browser
vela --log              # show server logs in the terminal
vela --tray             # run in the system tray
vela --skip-update      # skip the update check on start
vela --help             # everything else
```

**これが最初の選択肢になる理由:**
- ✅ どのディレクトリからでも動かせる
- ✅ コマンドはひとつ: `vela`
- ✅ `npm update -g vela`で最新に保てる
- ✅ ランチャーは落ちたサーバーを再起動し、実行に使うバイナリをインストールディレクトリの外、`~/.vela/runtime`に保ちます

### 方法2: インストールせずに動かす

ちょっと試してみたいだけなら:

```bash
npx vela
```

ランチャーをnpmのキャッシュに落として実行します。グローバルには何もインストールされませんが、データディレクトリ(`~/.vela`)は作られ、設定は実行をまたいで残ります。

### 方法3: Docker

サーバー、NAS、あるいはNode.jsを入れたくない何かに向いています。

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.5
```

そのあと**http://localhost:32060/dashboard**を開きます。

- イメージは**公開**です。pullするのにGitHubのログインも、パーソナルアクセストークンも、資格情報も要りません。
- イメージはマルチアーキテクチャです。ふつうのサーバー(`linux/amd64`)でも、Raspberry PiやApple SiliconのDockerホストのようなARMマシン(`linux/arm64`)でも、ネイティブに動きます。
- **タグを固定してください。** `ghcr.io/yumamax3/vela:1.2.5`が現在のリリースです。`:latest`は新しいバージョンが出るたびに動くので、再起動したら選んだ覚えのないバージョンになっていた、ということが黙って起こりえます。
- **つねに`/app/data`をマウントしてください。** ボリュームがなければ、データベースはコンテナの中に住み、コンテナとともに消えます。

Compose、リバースプロキシ、環境変数の詳細は[クラウドへのデプロイのガイド](../deployment/cloud.md)にあります。

### 方法4: ソースから

開発、改変、あるいは独自のイメージをビルドしたい人に。

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

プロジェクトはクローンのルートにあります — 入れ子の`app/`フォルダはありません。スクリプトは次のとおりです:

```bash
npm run dev        # development server with hot reload, port 32060
npm run build      # production build
npm run start      # run the production build
```

`npm run dev`はVela本体をいじるときのものです。デプロイで走らせるのは`npm run build`のあとの`npm run start`です。

> ⚠️ **バージョンについて:** 自分でビルドしたものがこのドキュメントと違う動きをしたら、`package.json`を確かめてください — その`version`フィールドが真実です。このドキュメントは**1.2.5**を説明しています。

---

## 初回起動

### サーバーを起動する

```bash
vela
```

起きること:

1. ゲートウェイが`http://localhost:32060`で起動します。
2. ダッシュボードがブラウザの`/dashboard`で開きます。
3. データディレクトリが作られます — macOSとLinuxでは`~/.vela`、Windowsでは`%APPDATA%\vela`、`DATA_DIR`を設定していればその場所。
4. それだけです。**デフォルトのパスワードはなく**、事前に生成されたキーもありません。

### ダッシュボードのパスワード

ここは、古いチュートリアルと現代のVelaが食い違うところなので、はっきり書いておく価値があります:

- **デフォルトのパスワードはありません。** `123456`でも、`admin`でも、ほかの何でもありません。
- **ローカルからのアクセスは開いています。** Velaを動かしているマシンからは、ダッシュボードは何も求めずに開きます。これは意図されたことです — 自分のノートPCにログインする必要はないはずです。
- **パスワードを決めるまで、遠隔からのアクセスは拒否されます。** ネットワーク上のほかのマシンからダッシュボードを開いても、Velaは誰も決めていないパスワードで入れることはしません。

パスワードを設定するには: **Velaを動かしているマシンから**ダッシュボードを開き、**設定 → アクセス**で設定します。同じ画面で、ダッシュボードのログインを必須にするか、APIリクエストにキーを義務づけるかも切り替えられ、ゲートウェイが「ゲート済み」かどうかもひと目でわかります — ネットワークに晒す前に見ておきたいチェックマークです。

あるいは、初回起動の前に環境変数で`INITIAL_PASSWORD`を設定することもできます。Velaはそれをログインのパスワードとして受け入れます。

### ツール用のAPIキーを手に入れる

```
Dashboard → Endpoint & Key → Create Key
→ copy the key that appears (it is shown once)
```

キーは`vela-v1-<random>-<checksum>`の形をしています。同じダイアログで、範囲を狭めることもできます: どのプロバイダー、モデル、コンボに届いてよいか、レート制限、日次・週次・月次のトークン予算、そして支出上限。共用や長時間の仕組みには上限をつけてください — 上限に達すると、Velaは黙って使うのではなく、はっきりした429で答えます。

---

## インストールを確かめる

### サーバーが生きているか

```bash
curl http://localhost:32060/api/health
```

期待される応答:

```json
{"ok":true}
```

ヘルスチェックのルートは意図的に認証なしにしてあるので、`REQUIRE_API_KEY`が有効でも答えます。

### 届くモデルを一覧する

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer vela-v1-your-key-here"
```

接続したプロバイダーすべてから、すべてのモデルが返ります。リストが空なら、まだプロバイダーが接続されていません — [クイックスタート](quick-start.md)の手順3を見てください。

### 本物のリクエストをひとつ送る

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer vela-v1-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm/glm-4.7",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

返事が来れば、ゲートウェイも、キーも、プロバイダーも、ルーティングも、すべて動いています。失敗したら、エラーの文言が理由を告げます。[トラブルシューティング](../troubleshooting.md)がよくあるものを直し方と対応づけています。

---

## 設定

### 環境変数

シェルで、アプリのそばの`.env`ファイルで、あるいはコンテナの環境として設定できます。まず大事なものから:

```bash
# Security — set these for any non-local deployment
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="your-password"       # optional first login password

# Storage
export DATA_DIR="$HOME/.vela"                 # where the database lives

# Server
export PORT="32060"                           # the default
export NODE_ENV="production"
```

`JWT_SECRET`には警告が要ります。2026年10月以降、Velaはこれがプレースホルダーのままだったり32文字を下回ったりすると**起動を拒否します**。本物を生成してください。変数の完全な一覧はリポジトリの`.env.example`と`docs/ENVIRONMENT.md`にあります。

### データディレクトリ

デフォルト: `~/.vela`(macOS/Linux)または`%APPDATA%\vela`(Windows)。

```text
~/.vela/
  db/
    data.sqlite        # providers, combos, keys, settings
    backups/           # pre-migration safety copies and scheduled backups
  logs/                # request logs, if enabled
  runtime/             # launcher-managed binaries
```

移動するには:

```bash
export DATA_DIR="/srv/vela-data"
vela
```

Windowsでは、Unix風のパス(`/`で始まるもの)は警告とともに無視され、デフォルトが使われます — そのパスはそこには存在できないからです。

### ポートの設定

デフォルトは`32060`です。フラグか環境変数で変えられます:

```bash
vela --port 8080
# or
PORT=8080 vela
```

別のポートを使うなら、`/v1`に向けているすべてのツールを更新してください — そしてベースURLの末尾の`/v1`は残すこと。

---

## インストールのトラブルシューティング

### ポートがすでに使われている

```
Error: listen EADDRINUSE: address already in use :::32060
```

プロセスを見つけて止めるか、別のポートを選んでください:

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F

# or simply start elsewhere
vela --port 8080
```

### 権限が拒否される

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'
```

直し方は、`sudo`を使うことではなく、npmが所有するディレクトリを渡すことです:

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Node.jsが古すぎる

```
Error: The engine "node" is incompatible with this module
```

Node.jsを更新してください — `nvm`があればそれで、なければ[nodejs.org](https://nodejs.org/)から:

```bash
nvm install 20
nvm use 20
```

### ダッシュボードが開かない

`http://localhost:32060/dashboard`を自分で開いてみてください。それでも開かなければ、プロセスが動いているか(`vela --log`が出力を映します)、ファイアウォールを確かめます: macOSではシステム設定 → ネットワーク → ファイアウォールでNodeプロセスを許可し、Linuxでは`ufw`や`iptables`を確かめ、WindowsではWindows Defenderファイアウォールで通してください。

### プロバイダーが接続しない

- オンラインか確かめてください(`ping 1.1.1.1`)。
- ローカルの不具合と決めつける前に、プロバイダーのステータスページを確かめてください。
- OAuthのプロバイダーでは、**Providers → [provider] → Disconnect → Connect**をもう一度試してください。切れたセッションは、壊れたインストールとそっくりに見えることがよくあります。

### メモリ使用量が多い

ゲートウェイを再起動してください(`Ctrl+C`、そして`vela`)。長時間動かすインストールなら、プロセスマネージャーを使ってください:

```bash
npm install -g pm2
pm2 start vela --name vela
pm2 save
```

---

## デプロイの選択肢

### 自分のマシンで

```bash
npm install -g vela
vela
```

**向いている:** 個人のコーディング、プロバイダーを試すこと、すべてをローカルに保つこと。

### サーバーで

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="choose-a-password" \
  ghcr.io/yumamax3/vela:1.2.5
```

`127.0.0.1`に束ねるというのは、同じマシン上のリバースプロキシだけがダッシュボードに届けるということです — インターネットに面したホストにとって安全なデフォルトです。[クラウドへのデプロイ](../deployment/cloud.md)には、大事なストリーミングの設定も含めた、Nginxの完全な設定があります。

### リバースプロキシの背後で

ストリーミングの応答(サーバー送信イベント)は、バッファリングを切らないと、最後にひとまとめに届いてしまいます:

```nginx
location / {
    proxy_pass http://127.0.0.1:32060;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
```

---

## アンインストール

```bash
npm uninstall -g vela      # remove the launcher
rm -rf ~/.vela             # remove data, keys and settings — this is irreversible
```

Windowsではデータディレクトリは`%APPDATA%\vela`です。そのあと、シェルのプロファイルに足したエクスポートを消してください。

Dockerで動かしていたなら:

```bash
docker stop vela && docker rm vela
docker rmi ghcr.io/yumamax3/vela:1.2.5
# and remove the volume or host directory you mounted
```

---

## 次のステップ

- [クイックスタート](quick-start.md) — プロバイダーを接続し、ツールをVelaに向ける
- [プロバイダー](../providers/subscription.md) — いつ、どのレーンを使うか
- [機能](../features/smart-routing.md) — ルーティング、コンボ、クォータ追跡
- [トラブルシューティング](../troubleshooting.md) — つながらないとき

---

## ヘルプが必要ですか?

- **ウェブサイト**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
