# Claude Codeとの連携

Claude CodeをVelaに向けるのに必要なのは、ふたつの環境変数だけです。あとは、ターミナルから出るすべてのClaudeリクエストがゲートウェイを通ります — つまり、ルーティングされ、追跡され、フォールバックの鎖に受け止められる。

## 前提条件

- Claude Code CLIがインストール済み(`claude --version`がバージョンを表示するはず)
- Velaがローカルで動いているか、届くクラウドのエンドポイントがある
- Velaのダッシュボード(**Endpoint & Key → Create Key**)で作ったAPIキー

## セットアップ

### 1. 環境変数を設定する

シェルのプロファイル(`~/.zshrc`、`~/.bashrc`、`~/.bash_profile`)にこれを足します:

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

- `ANTHROPIC_BASE_URL` — Claude Codeがリクエストを送る先。`/v1`は残してください。
- `ANTHROPIC_AUTH_TOKEN` — あなたのVelaキー。Claude Codeはベアラートークンとして送り、VelaはAPIキーとして受け入れます。

既定で別のモデルに答えさせたいなら、エイリアスの行き先も設定します:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. シェルを読み込み直す

```bash
source ~/.zshrc     # or ~/.bashrc
```

### 3. 確かめる

```bash
echo $ANTHROPIC_BASE_URL
curl -s http://localhost:32060/api/health      # → {"ok":true}
```

そのあと、小さなプロンプトをひとつ走らせます:

```bash
claude --model sonnet "Say hello in five words."
```

Velaを通して返事が来れば、配線できています。ダッシュボードで確かめられます: **Usage**にそのリクエストが出ます。

## モデルのエイリアス

Claude Codeの短い名前は、上の環境変数が指す先へと対応します:

| エイリアス | 意味 | 設定するもの |
|-------|---------|--------|
| `opus` | 最も重いモデル | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | 日常のモデル | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | 速いモデル | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

設定しなければ、Claude Codeはいつもの上流の名前を求めてきて、Velaはそれを接続済みのプロバイダーに照らして解決します。

## 使用例

### エイリアスで

```bash
claude --model opus   "Explain the trade-offs of an append-only log"
claude --model sonnet "Write a Python function that retries with backoff"
claude --model haiku  "Review this diff for typos"
```

### Velaの完全なモデル名で

```bash
claude --model cc/claude-opus-5 "Refactor this module"
```

### コンボで

ここでVelaはその場所を勝ち取ります: 午後の半ばにサブスクリプションの窓が閉じても、鎖は続きます。

```bash
claude --model premium-coding "Plan the migration"
```

`cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`のコンボとともに。

## 設定ファイル

Claude Codeは`~/.claude/settings.json`も読み、同じ値は`env`ブロックの下に置けます:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:32060/v1",
    "ANTHROPIC_AUTH_TOKEN": "[your Vela key]"
  }
}
```

ダッシュボードがこれを書いてくれます: **CLI Tools → Claude Code**がベースURLとキーを埋め、保存する前に結果を見せます。

## トラブルシューティング

### 接続の問題

1. `curl http://localhost:32060/api/health` → `{"ok":true}`のはず。
2. `echo $ANTHROPIC_BASE_URL` → `/v1`で終わるはず。
3. ポート32060を妨げるものがないか、Velaが思った場所に束ねられているか(`vela --host 127.0.0.1`ならローカルだけ)を確かめてください。

### モデルが見つからない

1. ゲートウェイに何を持っているか尋ねてください: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。
2. そのモデルのプロバイダーが**Providers**で接続済みか確かめてください。
3. モデルIDは上流で変わることを思い出してください — 今日は`cc/claude-opus-5`、次の四半期には別のもの。

### Unauthorized / 401

- `ANTHROPIC_AUTH_TOKEN`にVelaのキー(`vela-v1-...`)が入っていることを確かめてください。Claudeのサブスクリプショントークンではありません。
- キーは作成時に一度だけ表示されます。もう手元になければ、**Endpoint & Key**で別のものを作ってください。

## クラウドのエンドポイント

localhostではなく、デプロイ済みのVelaを使うには:

```bash
export ANTHROPIC_BASE_URL="https://your-domain.example/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

プロジェクト自身のホストされているインスタンスは、古いドキュメントには`https://vela.my.id`として現れます — それは所有者のデプロイであって、このドキュメントが約束できるサービスではなく、上流の事実です。実際に資格情報を持っているエンドポイントを使ってください。
