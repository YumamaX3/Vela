# Continue VSCode拡張機能との連携

Continueは、VS CodeとJetBrainsのためのオープンソースのAIアシスタントです。`config.json`を読み、そのファイルひとつでVelaを通すことができます。

## 前提条件

- Continue拡張機能をインストールしたVS Code
- Velaがローカルで動いているか、届くクラウドのエンドポイントがある
- Velaのダッシュボード(**Endpoint & Key → Create Key**)で作ったAPIキー

## 設定手順

### 1. Continueの設定を開く

- `Cmd+Shift+P`(macOS)または`Ctrl+Shift+P`(Windows/Linux)
- **Continue: Open Config**を実行
- `~/.continue/config.json`が開きます

### 2. Velaのモデルを足す

Continueの現在の設定形式は`models`の配列を使います:

**ひとつのモデル:**

```json
{
  "models": [
    {
      "title": "Vela — Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**いくつか、ドロップダウンで切り替えられるように:**

```json
{
  "models": [
    {
      "title": "Vela — Opus (hard tasks)",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — Sonnet (everyday)",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — GLM (cheap)",
      "provider": "openai",
      "model": "glm/glm-4.7",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**デプロイしたVelaなら**、`apiBase`を変えます:

```json
"apiBase": "https://your-domain.example/v1"
```

> あなたのContinueのバージョンが、ここに示す古い`models`/`apiBase`のスキーマをまだ使っているなら、書かれたとおりに動きます。新しいビルドでは、初回起動時に小さな設定ウィザードを求められるかもしれません。同じ3つの値 — プロバイダーの`openai`、モデルID、ベースURL — を、同じ場所に入れます。

### 3. 保存して再読み込みする

ファイルを保存し、**Developer: Reload Window**。Continueは読み込み時に設定を読みます。

### 4. モデルを選ぶ

Continueのサイドバーを開き、上のドロップダウンからモデルを選びます。

## 利用できるモデル

ゲートウェイが一覧するものなら何でも — 次のコマンドで確かめられます:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

| モデル | レーン |
|-------|------|
| `cc/claude-opus-5` | Claudeサブスクリプション |
| `cc/claude-sonnet-5` | Claudeサブスクリプション |
| `cc/claude-haiku-4-5-20251001` | Claudeサブスクリプション |
| `cx/gpt-5.6-sol` | Codexサブスクリプション |
| `cx/gpt-5.4` | Codexサブスクリプション |
| `glm/glm-4.7` | 格安 |
| `minimax/MiniMax-M2.1` | 最も安い |
| `kr/claude-sonnet-4.5` | 無料 |

コンボもモデルIDとして動きます。

## 使用例

- **説明:** コードを選び、サイドバーを開いて「Explain this」と尋ねる。
- **生成:** 「ユーザープロフィール用のReactカードコンポーネント」を頼む。
- **リファクタリング:** コードを選び、「Refactor this to async/await」と尋ねる。
- **デバッグ:** スタックトレースを貼り、何が壊れたかを尋ねる。

## 高度な設定

### システムプロンプト

```json
{
  "models": [
    {
      "title": "Vela — Code Expert",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1",
      "systemMessage": "You are a senior engineer. Prefer small, reviewable changes and explain trade-offs."
    }
  ]
}
```

### Temperature

```json
"temperature": 0.9,
"topP": 0.95
```

コードには低いtemperatureがたいてい良く、文章には高いほうが。

### コンテキストプロバイダー

Continueは、あなたのプロンプトに添えて何を送るかを決めます。これを締めるのが、Continueのユーザーにとってコストへの最大のレバーです:

```json
{
  "contextProviders": [
    { "name": "code", "params": { "maxLines": 100 } },
    { "name": "diff", "params": {} }
  ]
}
```

## キーボードショートカット

- `Cmd/Ctrl + L` — チャットを開く
- `Cmd/Ctrl + I` — インラインの編集
- `Cmd/Ctrl + Shift + R` — 再生成

(ショートカットはバージョンによって違います。VS Codeのキーボードショートカットのパネルに、あなたのものが並んでいます。)

## トラブルシューティング

### モデルが応答しない

1. `curl http://localhost:32060/api/health` → `{"ok":true}`。
2. `config.json`のキーを確かめてください。
3. VS Codeの開発者コンソール(**Help → Toggle Developer Tools**)を開き、エラーを読んでください。

### 違うモデルが答える

- サイドバーのドロップダウンを確かめてください — Continueは最後の選択を覚えています。
- モデルIDは大文字小文字を区別します。

### 設定が読み込まれない

- JSONを検証してください(末尾のカンマがいつもの犯人です)。
- パスが`~/.continue/config.json`であることを確かめてください。
- 保存したあとにウィンドウを再読み込みしてください。

### 遅い

- より軽いモデルを使ってください。
- コンテキストを削ってください: `maxLines`を減らし、添えるファイルを減らす。
- Velaまでのネットワークの遅延を確かめてください。

## ベストプラクティス

1. **3つのモデル、3つの値段** — 考えるにはOpus、書くにはSonnet、雑用にはGLM。切り替えはクリックひとつ。
2. **尋ねる前に選ぶ** — ファイルを丸ごと送るのが、高くつく習慣です。
3. **Continueが共有のマシンで走るなら、キーに上限を。**

## 次のステップ

- [Cursor](cursor.md) — IDEのための
- [Roo](roo.md) — もうひとつのエージェントのための
- [コンボ](../features/combos.md) — フォールバックの鎖のための
