# コンボ - カスタムフォールバックの鎖

コンボとは、モデルの鎖につける名前です。一度名前をつければ、どのツールも、特定のモデルではなくその名前で頼めるようになります — そして鎖のひとつのモデルに手が届かないとき、次のものが答えます。

コンボは、Velaと過ごすなかでいちばん役に立つ5分間です。

---

## コンボとは

```
Name: premium-coding
Models:
  1. cc/claude-opus-5          ← try first
  2. glm/glm-4.7               ← if #1 is out
  3. kr/claude-sonnet-4.5      ← if #2 is out too
```

そうしたら、どのツールも`premium-coding`を、まるでモデル名のように求めてきます。Velaは何よりも先にコンボの名前を解決するので、`premium-coding`がプロバイダーの接頭辞と衝突することは決してありません。

### 鎖が動くとき

コンボは、リクエストが**失敗**したときに次のモデルへ落ちます:

- プロバイダーがクォータやレート制限のエラーを報じた
- リクエストがタイムアウトした
- プロバイダーがポリシー上の理由でプロンプトを断った
- モデルIDが未知か利用できない

### 動かないとき

- 日次の割り当てが*単に少なくなってきた*だけでは、切り替えは起こり**ません**。上限に近づいたからといって、Velaが黙って有料のモデルへ移すことはありません — それはあなたのお金をあなたのかわりに使うことです。
- かたい支出上限はAPIキーに属します(**Endpoint & Key → budget**)。上限に達したら、Velaはどこかへ誘導するのではなく、429で断ります。

---

## なぜ使うのか

### 1. サブスクリプションから価値を
```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```
すでに払っているものを先に、格安を2番目に、無料を最後に。

### 2. コストを抑える
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/qwen3-coder-plus
```
入力100万トークンあたり、$0.60 → $0.30 → 無料。

### 3. 立ち往生しない
```
cc/claude-opus-5 → cx/gpt-5.6-sol → glm/glm-4.7 → if/qwen3-coder-plus
```
鎖はつねに無料のもので終えてください。そうしなければ、クォータがひとつ尽きただけで午後が止まります。

### 4. 大事なときは品質を保つ
```
cc/claude-opus-5 → cx/gpt-5.6-sol → ag/gemini-4-argon-high
```
すべてプレミアムなモデル。費用はかさみ、品質は曇りません。

---

## コンボを作る

### ステップ1: ダッシュボードを開く

```
http://localhost:32060/dashboard → Combos
```

### ステップ2: 作る

```
Combos → Create
  Combo Name: premium-coding
  Models:     add them one at a time, in priority order
```

行をドラッグして並べ替えられます。一番上のモデルが最初に試されます。

### ステップ3: 保存する

コンボはすぐに現れ、ゲートウェイは次のリクエストからそれを解決します — 再起動は要りません。

### ステップ4: 使う

```
Model: premium-coding
```

インターフェースはこれで全部です。モデル名を受け取るツールなら、どれでもコンボ名を受け取ります。

### もうひとつの戦略: ラウンドロビン

コンボは、メンバーを落ちていくのではなく、メンバーのあいだを回すこともできます。目的がフォールバックではなく負荷の分散(たとえば複数のアカウントに)なら、**設定 → ルーティング → Combo round robin**で全体に設定してください。

---

## 実例

### 例1: プレミアムだが、つましく

```
premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

1億トークンの典型的なひと月:

```
80M via the Claude subscription : $0
15M via GLM-4.7                 : about $9
 5M via MiniMax M2.1            : about $1
```

高いモデルが本物の仕事をし、格安のモデルがあふれを拾います。

### 例2: 予算のみ

```
budget-combo
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/qwen3-coder-plus
```

ひと月1億トークンを、70 / 20 / 10で分けて:

```
70M via GLM          : about $42
20M via MiniMax      : about $4
10M via iFlow        : $0
```

お金はかかりますが、小売APIの請求書とは比べものになりません。

### 例3: コストゼロ

```
free-combo
  1. kr/claude-sonnet-4.5
  2. if/qwen3-coder-plus
  3. qwen/qwen-plus
```

コスト: $0。制約: 今日の無料枠があなたをどう思うか、そのままです。

### 例4: 品質優先

```
quality-first
  1. cc/claude-opus-5
  2. cx/gpt-5.6-sol
  3. ag/gemini-4-argon-high
```

格安のフォールバックは、意図的にありません: 3つとも尽きたなら、黙って弱い仕事をするのではなく、はっきり失敗します。

### 例5: すべてのレーンを、順番に

```
never-stuck
  1. ag/gemini-4-argon-high     ← free, surprisingly strong
  2. cc/claude-opus-5           ← subscription
  3. cx/gpt-5.6-sol             ← second subscription
  4. gh/claude-sonnet-4.6       ← third
  5. glm/glm-4.7                ← cheap
  6. minimax/MiniMax-M2.1       ← cheaper
  7. kr/claude-sonnet-4.5       ← free, good quality
  8. if/qwen3-coder-plus        ← free, variety
```

8つの段、どれもその上より安く、どれも失うものは何もない。

---

## すべてのツールでコンボを使う

### Cursor

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding   (add as a custom model)
```

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
claude --model premium-coding
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
codex --model premium-coding "your prompt"
```

### Cline / Roo / Continue

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    premium-coding
```

### スクリプトから

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer [your Vela key]" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [{"role": "user", "content": "Write a function that reverses a linked list."}],
    "stream": true
  }'
```

---

## 良い習慣

### 1. 無料のもので終える

```
✅ cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
❌ cc/claude-opus-5 → glm/glm-4.7
```

2番目の鎖には、終わりに崖があります。

### 2. 何を最適化しているかを決める

- **コスト:** 格安が先、無料が最後。
- **品質:** プレミアムが先、格安が最後。
- **サブスクリプションの価値:** サブスクリプションが先、無料が最後。

普遍的な答えはなく、正しい順番は週ごとに変わります。

### 3. 仕事にコンボを合わせる

```
production code     : quality-first
everyday edits      : premium-coding
exploration         : budget-combo
other people's work : never-stuck
```

いくつも持っておき、ツールのひとつのフィールドを変えて切り替えられます。

### 4. 鎖が実際に何をしたかを確かめる

**Routed by Combo**ページが、どのリクエストにどのモデルが答えたかを示します。黙っていつも最後の段に着地するコンボは、謎ではなく、見えるものになります。

### 5. 共有のキーには上限を

エージェントやバックグラウンドのジョブが使うキーには、支出上限を付けてください。コンボは鎖を下へ動かせても、支出を止めることはできません。予算なら止められます。

---

## 高度な設定

### コンボごとの戦略

ひとつのコンボが、厳密なフォールバックよりラウンドロビンを好むこともできます — メンバーが品質で対等で、負荷を散らしたいときに役立ちます。**設定 → ルーティング**で設定してください。

### モデルを一時的に無効にする

すべてのコンボから消すのではなく、プロバイダーのページでモデルを無効にしてください。コンボはそれを飛ばし、戻したときのために形を保ちます。

### インポートとエクスポート

コンボはCombosページからエクスポートとインポートができます。動く設定を2台目のマシンへ移す、いちばんかんたんな方法です。

---

## トラブルシューティング

### コンボ名が認識されない

- 保存したとおりに綴られているか確かめてください(大文字小文字を区別します)。
- 起動時にモデルの一覧をキャッシュするツールなら、再起動してください。
- コンボが保存されていることを確かめてください — Combosの一覧に出ているはずです。

### いつも最後のモデルに着地する

それは、前のものが失敗しているという意味です。**Quota**と**Providers**を見てください: たいていは期限切れのトークンか、尽きた割り当てか、落ちているプロバイダーです。

### 思ったより高くつく

- **Routed by Combo**で、どれくらい落ちたかを確かめてください。
- [格安プロバイダー](../providers/cheap.md)の料率を読んでください — 格安のレーンでは出力トークンは入力の3〜4倍です。
- 並べ替えてください: 品質が許すなら、より安いメンバーを先頭に。

### フォールバックせずにリクエストが失敗する

ほかへは再試行できない失敗もあります — 形の崩れたリクエストは、どのモデルでも同じように失敗します。鎖が壊れていると決めつける前に、エラーの文言を確かめてください。

---

## 関連

- [スマートルーティング](smart-routing.md) — リクエストがプロバイダーを選ぶ仕組み
- [クォータ追跡](quota-tracking.md) — 利用量とコストの読み方
- [格安プロバイダー](../providers/cheap.md) — 鎖の背後の数字
