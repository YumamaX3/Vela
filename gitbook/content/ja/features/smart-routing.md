# スマートルーティングと自動フォールバック

Velaは当て推量をしません。すべてのリクエストは、理由があってどこかへ行きます: あなたが求めたモデル、それを供すべきアカウント、そして — そこが失敗したなら — 列の次のもの。

このページは、その部品を説明します。リクエストが思いがけない場所に着地したとき、どのつまみを回せばよいかが、はっきりわかるように。

---

## リクエストの形

```
Your tool
   ↓  POST /v1/chat/completions, model: "premium-coding"
Vela
   ↓  is "premium-coding" a combo?      → yes: walk its chain
   ↓  otherwise: is it prefix/model?    → resolve provider + model
   ↓  which account for that provider?  → connection order, or round-robin
   ↓  does the API key allow it?        → key scope
   ↓  is the key within budget?         → 429 if not
   ↓  call the upstream
   ↓  failed?                           → next model in the chain (combos)
Reply
```

この経路のどこにも、あなたの優先順位を黙って組み替えるものはありません。サブスクリプションのモデルを求めたなら、それが手に入るか、エラーが手に入るかです — コンボを使っている場合を除いて。その場合は、あなたが並べた次のモデルが手に入ります。

---

## コンボによるフォールバック

リクエストを*別のモデル*へ動かす唯一の仕組みが、コンボです:

```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```

リクエストが失敗したときに移ります — クォータのエラー、レート制限、タイムアウト、ポリシーによる拒否、未知のモデル — そして、単に*あとで*失敗するかもしれないというだけでは、そこに留まります。完全な規則と、組み立て方は[コンボ](combos.md)にあります。

## アカウントのローテーション

ひとつのプロバイダーのなかで、複数の接続が仕事を分け合えます。**設定 → ルーティング**は、ラウンドロビン(接続に散らす)か、フィルファースト(ひとつを文句を言うまで使う)を提供し、スティッキー上限が会話をしばらく同じアカウントに留めます。ふたつのClaudeアカウントを、あるいは3つを、気にせず使う方法がこれです。

## キーの範囲と予算

どのAPIキーも、特定のプロバイダー、モデル、コンボに狭められ、トークン予算と支出上限を持てます。上限に達すると、リクエストは`budget_exceeded`のコードを伴う`429`で断られます — 静かな品質低下ではなく、はっきりした停止です。

---

## 各レーンの役割

**サブスクリプション — 品質が大事なら最初に使う**
- Claude Code、Codex、Copilot、Antigravity、Kimi
- すでに払っています。目指すのは、割り当てが期限切れになる前に使い切ること。

**格安 — 真ん中**
- GLM-4.7(100万あたり$0.60 / $2.20)、MiniMax M2.1($0.30 / $1.20)、Kimiのプラン
- 小売APIの価格の何分の一かで、たいていの仕事には十分な品質

**無料 — 最後の一手**
- iFlow、Qwen、Kiro
- レート制限があり、変わりやすく、しかしコストはゼロ

---

## 起きていることを見る

```
Dashboard → Usage        a live view of requests, tokens and cost
Dashboard → Quota        per provider: used, remaining, reset countdown
Dashboard → Routed by Combo   which model actually answered
Dashboard → Log Harbor   the request ledger, when you need the detail
```

コンボが毎回、最後の段に着地しているなら、**Quota**が数秒でその理由を示します。

---

## 大事な設定

### ルーティングの戦略

```
Dashboard → Settings → Routing
  Round robin            spread requests across connections
  Sticky limit           how long one conversation stays on one connection
  Combo round robin      rotate through a combo's members instead of falling through
```

### フォールバックの規則

コンボのほかに、Velaには**Fallback Rules**があります — 何が起きたかで引かれる、運用者定義の規則です:

- 特定のHTTPステータス
- 拒否されたプロンプト(コンテンツポリシー)
- 小さすぎるコンテキストウィンドウ
- タイムアウト
- あらゆるエラー

規則は鎖にでき、稼働前にドライランのパネルで試せます。「*あれが*起きたときに、この別のモデルを試す」が好みではなく方針である場合、正しい道具はこれです。サイドバーの**Fallback Rules**にあります。

### キーごとの上限

```
Dashboard → Endpoint & Key → Create Key / Edit
  rate limit, token budget, spend cap, provider/model scope
```

支出を止める唯一の仕組みです。見守りのいらないキーには、すべて使ってください。

---

## 例

### 例1: サブスクリプションを先に

```
Model: premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. if/qwen3-coder-plus
```

朝: Claudeが答えます。午後、ローリングウィンドウが閉じたら: GLMが答えます。夕方、カードが断ったら: iFlowが答えます。あなたはタイピングを続けます。

### 例2: 支出の上限つきで

キーに月$20の上限を付けます。上限に達するまでGLMとMiniMaxで働き、そこからは有料のリクエストはすべて`429`で断られ、無料のレーンはなお答えます。予測できる請求、思いがけない請求書なし。

### 例3: サブスクリプションのみ

ひとつのモデル、コンボなし。窓が閉じていれば、プロバイダーのエラーが返ります。これは意図されたことです: 使うより待つほうがいい、という人もいるのです。

---

## 良い習慣

### 1. 難しい仕事はサブスクリプションへ

OpusやGPT-5.6級のモデルは、設計やデバッグでその値段を稼ぎます。格安のモデルは、残りの80パーセントで稼ぎます。

### 2. 無料のレーンで終える

有料のモデルで終わる鎖は、閉ざされた扉で終わります。

### 3. パーセントではなく、リセットの時刻を見る

ローリングウィンドウと固定のウィンドウは、振る舞いが違います。月次のリセット前日に重い仕事をするのは、投げ捨てる割り当てです。

### 4. ツールごと、あるいは人ごとにひとつのキー

範囲と予算はキーごとです。共有のキーは、共有の上限と、誰がいくら使ったかわからないことを意味します。

---

## トラブルシューティング

### 「No available provider」/「quota exhausted」

**Quota**でカウントダウンを確かめ、次にコンボが無料のモデルで終わっているかを確かめてください。そうなっていて、無料のプロバイダーも尽きているなら、それは上流の本当に悪い日であって、ローカルの不具合ではありません。

### ずっとフォールバックし続ける

- 最初の段を見てください: 期限切れのOAuthトークンが最もよくある原因です。
- プロバイダーのステータスページを確かめてください。
- モデルIDがまだ存在するか確かめてください(`/v1/models`)。

### コストがコンボの示すより高い

- **Routed by Combo**を読んでください: 思っていたより深く鎖を落ちています。
- どのレーンでも、出力トークンは入力の数倍かかることを思い出してください。
- 鎖に`-highspeed`や大きめの`glm-5.x`のモデルがないか確かめてください。

### リクエストが429で断られる

応答のコードを読んでください: レート制限か、キーの範囲か、予算か。それぞれが、何を、なぜ断ったかを告げます。

---

## 関連

- [コンボ](combos.md) — 鎖を組むこと
- [クォータ追跡](quota-tracking.md) — 数字の読み方
- [格安プロバイダー](../providers/cheap.md) — 料率
