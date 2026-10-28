# OpenAI Codex CLIとの連携

Codex CLIは、`~/.codex/config.toml`の小さなブロックでVelaに向けられます。これはダッシュボードの**CLI Tools → Codex**ページがあなたのために書き出すのと同じ形なので、自分で貼り付けても、ダッシュボードにやらせてもかまいません。

## 前提条件

- Codex CLIがインストール済み
- Velaがローカルで動いているか、届くクラウドのエンドポイントがある
- Velaのダッシュボード(**Endpoint & Key → Create Key**)で作ったAPIキー

## セットアップ

### 1. `~/.codex/config.toml`を編集する

```toml
model = "cx/gpt-5.6-sol"
model_provider = "Vela"

[model_providers.Vela]
name = "Vela"
base_url = "http://localhost:32060/v1"
wire_api = "responses"
http_headers = { Authorization = "Bearer [your Vela key]" }
```

Codexのカスタムプロバイダーは、上の`http_headers`の行**だけで**認証します — `auth.json`の`OPENAI_API_KEY`は組み込みの`openai`プロバイダーのもので、この形で定義されたプロバイダーでは読まれません。キーはここに置き、あちらには置かないでください。

### 2. 確かめる

```bash
curl -s http://localhost:32060/api/health      # → {"ok":true}
codex "Write a function that reverses a linked list"
```

そのあとダッシュボードの**Usage**を見てください。リクエストが出ているはずです。

### 3. 環境変数のほうが好きなら

設定によっては、ファイルより環境を好むものもあります。それも動きます。OpenAI APIを話すものなら何でも:

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

ダッシュボードが生成するのは`config.toml`の道で、こちらを好むべきです — 新しいシェルを開いても残ります。

## 利用できるモデル

| モデル | 向いていること |
|-------|----------|
| `cx/gpt-5.6-sol` | コーディングの現在の旗艦 |
| `cx/gpt-5.6-terra` | もうひとつの現代的選択肢 |
| `cx/gpt-5.6-luna` | より軽く、速い仕事 |
| `cx/gpt-5.5`、`cx/gpt-5.4` | 安定したフォールバック |

ほかのモデルやコンボも動きます — CodexはIDの意味を気にしません。Velaがそれを解決できるかだけです。

## 使用例

```bash
# Write code
codex --model cx/gpt-5.6-sol "Create a REST endpoint that paginates results"

# Explain code
codex --model cx/gpt-5.6-terra "Explain what this does: $(cat myfile.js)"

# Use a fallback chain
codex --model quality-first "Plan the refactor"
```

## トラブルシューティング

### 認証のエラー

1. キーは`[model_providers.Vela]`のなかの`http_headers`になければなりません — `auth.json`のキーはカスタムプロバイダーでは使われません。
2. キーが完全で、`vela-v1-`で始まるか確かめてください。
3. 迷ったら**Endpoint & Key**で新しいものを作ってください。キーは作成後に取り戻せません。

### 接続の問題

1. `curl http://localhost:32060/api/health`。
2. `base_url`が`/v1`で終わるか確かめてください。
3. ポート32060を妨げるものがないか確かめてください。

### モデルが利用できない

1. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。
2. CodexのプロバイダーがVelaで接続済みか(**Providers**)確かめてください。
3. モデルIDは上流で変わります。上の一覧から現在のものを選んでください。

## クラウドのエンドポイント

`base_url`をデプロイしたアドレスに置き換えてください(`/v1`は残します):

```toml
base_url = "https://your-domain.example/v1"
```

古いドキュメントには、プロジェクト所有者が`https://vela.my.id`でホストするインスタンスが言及されています。それは所有者のデプロイについての上流の事実であって、このドキュメントが約束できるサービスではありません。資格情報を持っているエンドポイントを使ってください。
