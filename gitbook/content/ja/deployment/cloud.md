# ☁️ クラウドへのデプロイ

Velaをサーバーで動かすと、変わることはただひとつだけです: ほかのマシンから届くようになる、つまりパスワードと玄関が要る、ということです。ほかはすべて — プロバイダー、コンボ、キー — ローカルのときとまったく同じに動きます。

このガイドは、公開されたDockerイメージ(推奨の道)、VPSへのインストール、リバースプロキシ、そしてポートを開く前に大事なセキュリティのチェックリストを扱います。

---

## 🖥️ VPSで

### 前提条件

- Ubuntu 22.04以降、あるいはそれに相当するLinux
- Node.js 20以降(Dockerを使うなら読み飛ばせます)
- `git`
- `sudo`のあるユーザー

### ステップ1: Node.js、そしてVelaをインストールする

```bash
# Node.js 20+ — the official NodeSource script is one option
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vela
npm install -g vela
```

ソースからビルドしたければ:

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

リポジトリのルートが**アプリそのもの**です。入れ子の`app/`ディレクトリはありません。

### ステップ2: 環境を設定する

シェルのプロファイルに、systemdのユニットに、あるいはアプリのそばの`.env`ファイルに、これを置きます:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="set-me-by-you"       # placeholder, not a secret
export DATA_DIR="/var/lib/vela"
export NODE_ENV="production"
export PORT="32060"
```

`JWT_SECRET`は新しく生成したもので、少なくとも32文字でなければなりません。プレースホルダーのままだと、Velaは起動を拒否します。

| 変数 | 何をするか |
|----------|--------------|
| `JWT_SECRET` | ダッシュボードのセッションに署名します。生成してください。チュートリアルのものを使い回さないこと。 |
| `INITIAL_PASSWORD` | 最初のダッシュボードのログインパスワード。任意ですが、サーバーでは期待されます。これは資格情報です: 実行時に与え、決してコミットしないこと。 |
| `DATA_DIR` | データベースの住む場所。デフォルトは`~/.vela`。 |
| `NODE_ENV` | 本物の環境では`production`に。 |
| `ENABLE_REQUEST_LOGS` | デフォルトは`false`。デバッグ中だけオンに。 |
| `REQUIRE_API_KEY` | オンのとき、有効なキーのないリクエストは拒否されます。 |
| `VELA_BACKUP_*` | 任意の暗号化バックアップの仕組み。すべてデフォルトはオフ。 |

完全な一覧はリポジトリの`.env.example`と`docs/ENVIRONMENT.md`にあります。

### ステップ3: データディレクトリ

```bash
sudo mkdir -p /var/lib/vela
sudo chown $USER:$USER /var/lib/vela
```

### ステップ4: プロセスマネージャーの下で動かす

```bash
sudo npm install -g pm2

pm2 start vela --name vela
pm2 save
pm2 startup      # follow the line it prints, so it survives a reboot
```

役に立つPM2のコマンド:

```bash
pm2 logs vela          # follow the output
pm2 restart vela
pm2 stop vela
pm2 status
pm2 monit
```

### ステップ5: ダッシュボードのパスワードを設定する

**サーバーから**ダッシュボードを開き(たとえば下のSSHトンネルを通して)、**設定 → アクセス**へ行き、パスワードを設定します。そうするまで、遠隔のブラウザは設計として拒否されます。

---

## 🐳 Dockerでのデプロイ

公開されたイメージが最短の道で、こちらを好むべきです。

### 公開されたイメージ

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="set-me-by-you" \
  ghcr.io/yumamax3/vela:1.2.5
```

- `ghcr.io/yumamax3/vela`は**公開**イメージです。誰でもログインせずにpullできます。トークンは要りません。秘密は何も含まれていません — 秘密はすべて実行時に環境として与えられる、だからこそ公開されていても安全なのです。
- **タグを固定してください**(`:1.2.5`)。`:latest`はリリースについていき、再起動の下で変わることがあります。
- リバースプロキシが玄関なら、**`127.0.0.1`へ公開してください**。そうすれば、素のポートはインターネットにはまったく出ません。
- **`/app/data`をマウントしてください。** ボリュームがなければ、コンテナが入れ替わったときすべてが消えます。

### Docker Composeでのデプロイ

リポジトリには、文書化されたテンプレート`docker-compose.example.yml`が同梱されています。コピーし、プレースホルダーを埋め、起動します:

```bash
cp docker-compose.example.yml docker-compose.yml
# edit docker-compose.yml: every `set-me` and every secret
docker compose up -d
```

あなた自身の最小のチャートは、このようなものです:

```yaml
services:
  vela:
    image: ghcr.io/yumamax3/vela:1.2.5
    container_name: vela
    restart: unless-stopped
    ports:
      - "127.0.0.1:32060:32060"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/app/data
      - JWT_SECRET=set-me-from-openssl-rand-hex-32   # placeholder, not a secret
      - INITIAL_PASSWORD=set-me-by-you               # placeholder, not a secret
    volumes:
      - vela-data:/app/data
    stop_grace_period: 30s

volumes:
  vela-data:
```

```bash
docker compose up -d          # start
docker compose logs -f        # follow
docker compose down           # stop
docker compose pull && docker compose up -d   # update
```

> 例のチャートには、`mysql` / `mirror`のストレージモードのための任意のMariaDBの「双子」と、任意の圧縮のサイドカーもあります。どちらもコメントアウトされているか内部専用で、どちらもVelaを動かすのに要りません。

### 自分でイメージをビルドする

コードを変える必要があるときにだけ:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 32060
CMD ["npm", "run", "start"]
```

```bash
docker build -t vela-local:1.2.5 .
docker run -d --name vela -p 127.0.0.1:32060:32060 \
  -v vela-data:/app/data \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  vela-local:1.2.5
```

ソースからのビルドは、公開されたイメージより遅く、大きく、あなたのマシンにあるものをそのまま引き継ぎます。公開されたイメージはタグのついたコミットからビルドされ、あなたのイメージはあなたのものからビルドされます。

---

## 🌐 リバースプロキシ(Nginx)

なぜわざわざ: TLS、本物のドメイン名、そしてリクエストの大きさを制限しヘッダーを足せる、よく設定されたひとつの玄関。

### インストール

```bash
sudo apt update
sudo apt install -y nginx
```

### 設定

`/etc/nginx/sites-available/vela`を作ります:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Vela caps request bodies at 32 MB by default
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:32060;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Streaming (SSE) — without these, replies arrive in one lump at the end
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

ダッシュボードと`/v1`はどちらも同じポートに住むので、ひとつの`location`が両方を覆います。

### 有効にして証明書を取る

```bash
sudo ln -s /etc/nginx/sites-available/vela /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

そのあと、ツールを`https://your-domain.com/v1`に向けてください。

---

## 🔒 セキュリティのチェックリスト

このリストのどれも一分で済み、最悪の日を防ぎます。

### 1. 本物の`JWT_SECRET`と、本物のパスワード

```bash
openssl rand -hex 32        # paste into JWT_SECRET
```

そのあと**設定 → アクセス**でダッシュボードのパスワードを設定し、**ダッシュボードのログインを必須にする**をオンにします。**APIキーを必須にする**ことも考えてください。そうすれば`/v1`に届くものはキーを提示しなければなりません。

### 2. ファイアウォール

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# only if you are NOT behind a proxy:
# sudo ufw allow 32060/tcp
sudo ufw enable
```

### 3. 素のポートを私的に保つ

Nginxが玄関なら、Velaはループバックだけで聞くべきです — 上の例のように`127.0.0.1:32060:32060`で公開してください。公開のプロキシのない箱でダッシュボードに届くには:

```bash
ssh -L 32060:localhost:32060 you@your-server
# then open http://localhost:32060/dashboard on your own machine
```

### 4. キーごとの支出上限

人ごと、あるいはツールごとにひとつのAPIキーを配り(**Endpoint & Key → Create Key**)、それぞれにトークン予算か支出上限を設定します。上限に達すると、Velaは黙ってより多く使うのではなく、はっきりした`429`で答えます。

### 5. 意識して更新する

```bash
# Packages you depend on
sudo apt update && sudo apt upgrade -y

# From a git checkout
cd Vela && git pull && npm install && npm run build && pm2 restart vela

# Docker
docker compose pull && docker compose up -d
```

### 6. データディレクトリをバックアップする

```bash
tar -czf vela-backup-$(date +%Y%m%d).tar.gz -C /var/lib vela
```

cronに足して、毎晩の複製に。組み込みの暗号化バックアップを有効にするなら、`VELA_BACKUP_ENCRYPTION_KEY`を失えばバックアップも失うことを忘れないでください。

---

## 📊 監視

```bash
pm2 status
pm2 logs vela --lines 100
pm2 monit

docker compose logs -f --tail 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

curl -s http://127.0.0.1:32060/api/health      # {"ok":true}
```

コンテナには`/api/health`を叩くヘルスチェックが同梱されているので、起き上がれば`docker ps`が`healthy`を示します。

---

## 🚨 トラブルシューティング

### 起動しない

```bash
pm2 logs vela          # or: docker compose logs
ss -tlnp | grep 32060  # is something else on the port?
```

`JWT_SECRET`に触れる起動の拒否は、まさにその意味です: 長いランダムな秘密を生成してください。

### Nginxが502を返す

NginxがVelaに届いていません。Velaが動いているか(上の`curl`)、`proxy_pass`のポートが合っているか、エラーログを確かめてください:

```bash
sudo tail -f /var/log/nginx/error.log
```

### ストリーミングが流れない

`proxy_buffering off`がないか、手前のCDNかWAFがバッファリングしています。どちらもイベントを通さなければなりません。

### 遠隔のログインが拒否される

それがパスワードの門です。Velaのマシンからパスワードを設定し(**設定 → アクセス**)、あるいは`INITIAL_PASSWORD`を与えて再起動してください。

### データディレクトリの権限が拒否される

```bash
sudo chown -R $USER:$USER /var/lib/vela
chmod 755 /var/lib/vela
```

Dockerでは、マウントしたホストのディレクトリが、コンテナの`node`ユーザー(uid 1000)から書き込めることを確かめてください。

---

## 📱 ホストされているエンドポイントについて

このドキュメントの古いページに、ホストされているVelaのインスタンスとして`https://vela.my.id`や`https://vela.ai`が挙げられているのを見るかもしれません。それらは**プロジェクト所有者自身のデプロイ**で、ここでは上流の事実として記されているだけで、このドキュメントが約束できるサービスではありません。それらについて読むものには、いつも日付を心に置いてください。

大事なものは、自分でホストしてください(このページ) — あるいは、プロバイダーが渡した、発行されたAPIキーとともに、そのホストのインスタンスに届いてください。ツールの設定はどちらの道でも同じで、変わるのはベースURLだけです。

---

## 🔗 次のステップ

- [プロバイダーを接続する](../providers/subscription.md)
- [コンボを組む](../features/combos.md)
- [Cursorをあなたのサーバーに向ける](../integration/cursor.md)
- [トラブルシューティング](../troubleshooting.md)
