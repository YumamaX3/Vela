# 🏠 ローカルホストへのデプロイ

Velaを自分のマシンで動かすのが、デフォルトであり、いちばんかんたんで、いちばん失敗のしようが少ないやり方です。このページは日々のことを扱います: 起動すること、止めること、データを移すこと、更新すること、そして最もよく起きる2、3の問題。

まだインストールしていないなら、[インストール](../getting-started/installation.md)から始めてください。

---

## 📦 インストール

```bash
npm install -g vela
```

**要件:**
- Node.js 20以降
- npm 10以降(Node.jsに同梱)

---

## 🚀 サーバーを起動する

```bash
vela
```

ダッシュボードが**http://localhost:32060/dashboard**にひとりでに開きます。

**デフォルトの構成:**

| 項目 | 場所 |
|-|-|
| **ダッシュボード** | `http://localhost:32060/dashboard` |
| **APIエンドポイント** | `http://localhost:32060/v1` |
| **デフォルトのポート** | `32060` |
| **データディレクトリ** | `~/.vela`(macOS/Linux)・`%APPDATA%\vela`(Windows) |
| **ダッシュボードのパスワード** | デフォルトではなし — 下を見てください |

ひとつのプロセスが、ダッシュボードとAPIの両方を供します。覚えておくべきふたつ目のポートはありません。

### パスワードについて

現在のVelaに**デフォルトのパスワードはありません**。マシン自体からは、ダッシュボードはパスワードなしで開きます。遠隔のブラウザは、**設定 → アクセス**でパスワードを設定するまで拒否されます — `123456`をデフォルトとして出荷し、後悔したことのあるすべての人への、直接の答えです。

ローカルでもログインが欲しければ、**設定 → アクセス**で設定してください(あるいは初回起動の前に`INITIAL_PASSWORD`を設定する)。そして**ダッシュボードのログインを必須にする**をオンにしてください。

### ネットワークについて

デフォルトでランチャーは`0.0.0.0`に束ねるので、ネットワーク上のほかのマシンもそのポートに届けます。純粋にローカルな構成にするには:

```bash
vela --host 127.0.0.1
```

---

## 🔧 設定

### カスタムのデータディレクトリ

```bash
DATA_DIR=/path/to/data vela
```

Windowsでは`D:\vela-data`のようなネイティブのパスを使ってください。そこではUnix風のパスは警告とともに無視されます。

### カスタムのポート

```bash
vela --port 8080
# or
PORT=8080 vela
```

Velaと話すものすべて — エディタ、スクリプト — は、そのあと`http://localhost:8080/v1`を使わなければなりません。

### カスタムのホスト

```bash
vela --host 127.0.0.1    # this machine only
vela --host 0.0.0.0      # all interfaces (the default)
```

---

## 🛑 サーバーを止める

動かしているターミナルで`Ctrl+C`を押します。ゲートウェイは終了する前に処理中のリクエストを流し切るので、ストリーミングの返事は途中で切られるのではなく、最後まで終わります。

バックグラウンドやプロセスマネージャーから起動したなら:

```bash
pm2 stop vela         # if you used PM2
pkill -f vela         # last resort
```

---

## 🔄 再起動する

```bash
vela
```

プロバイダー、キー、コンボ、予算、利用の履歴は、すべてそのまま残ります — それらはメモリではなく、データディレクトリに住んでいるからです。

---

## 📊 更新する

```bash
npm update -g vela
```

いま動いているものを確かめるには:

```bash
npm list -g vela
```

Dockerの道なら、新しいタグを明示的にpullします:

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run the same docker run command with the new tag
```

データベースの移行は起動時に自動で走り、その前に`~/.vela/db/backups/`へ安全のための複製が取られます。それでも大きな更新の前にはバックアップを。

---

## 🔍 トラブルシューティング

### ポートがすでに使われている

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F
```

あるいは、別のポートで走らせるだけでも: `vela --port 8080`。

### インストール時の権限のエラー

```bash
# Give npm a directory it owns (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### データディレクトリに書き込めない

```bash
ls -la ~/.vela
chmod 755 ~/.vela
```

それでも失敗するなら、`DATA_DIR`を自分が所有するディレクトリに向けてください。

### ほかのマシンからダッシュボードが開かない

それはパスワードの門が仕事をしているという意味です。Velaのマシンで開いて**設定 → アクセス**でパスワードを設定するか、`vela --host 127.0.0.1`でローカルに保ち、SSHトンネルを通して届けます:

```bash
ssh -L 32060:localhost:32060 you@the-vela-machine
# then open http://localhost:32060/dashboard
```

---

## 📁 データディレクトリ

```text
~/.vela/
├── db/
│   ├── data.sqlite     # providers, keys, combos, settings, usage
│   └── backups/        # pre-migration copies and any scheduled backups
├── logs/               # request logs, when enabled
└── runtime/            # binaries the launcher manages
```

**バックアップとは、ディレクトリを複製することにすぎません** — できればVelaを止めているあいだに、SQLiteの書き込み前ログが落ち着くように:

```bash
# While Vela is stopped:
cp -r ~/.vela ~/.vela.backup

# Restore (with Vela stopped):
rm -rf ~/.vela && cp -r ~/.vela.backup ~/.vela
```

定期的で暗号化されたバックアップには、Velaには組み込みの仕組みがあります — `.env.example`のバックアップの変数(`VELA_BACKUP_*`)を見てください。`VELA_BACKUP_ENCRYPTION_KEY`は、一年後にもまだ手元にある場所に保管してください。失えば、バックアップは永久に読めなくなります。

---

## 🔗 次のステップ

- [プロバイダーを接続する](../providers/subscription.md)
- [フォールバックの鎖を組む](../features/combos.md)
- [エディタをVelaに向ける](../integration/cursor.md)
- [遠隔へ: クラウドへのデプロイ](cloud.md)
