# Roo AIアシスタントとの連携

Rooは、サイドバーに住むVS Codeのエージェントです。Velaに向ければ、接続したモデルすべてに、ひとつのキーとひとつのアドレスで届きます。

## 前提条件

- RooがVS Codeにインストール済み
- Velaがローカルで動いているか、届くクラウドのエンドポイントがある
- Velaのダッシュボード(**Endpoint & Key → Create Key**)で作ったAPIキー

## 設定手順

### 1. Rooの設定を開く

Rooを起動し、サイドバーから設定パネルを開きます。

### 2. プロバイダーの種類を選ぶ

**API Provider**で、**OpenAI Compatible**を選びます。VelaはOpenAI APIを話すので、それが正しい形です — RooはベースURLと、キーと、モデルIDを尋ねてきます。

### 3. 3つのフィールドを埋める

**ローカルのVela:**

```
Base URL:  http://localhost:32060/v1
API Key:   vela-v1-<id>-<checksum>
Model:     cc/claude-opus-5
```

**デプロイしたVela:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-opus-5
```

### 4. 試す

これを送ります:

```
Hello! Can you confirm you're connected through Vela?
```

そのあとダッシュボードの**Usage**を見てください — リクエストが出ていて、そのキーに帰されているはずです。

## モデルを選ぶ

| モデル | レーン | 向いていること |
|-------|------|------------|
| `cc/claude-opus-5` | Claudeサブスクリプション | 最も難しい作業 |
| `cc/claude-sonnet-5` | Claudeサブスクリプション | バランスのとれた日常の仕事 |
| `cc/claude-haiku-4-5-20251001` | Claudeサブスクリプション | 手早い編集 |
| `cx/gpt-5.6-sol` | Codexサブスクリプション | コーディングの重い問題 |
| `glm/glm-4.7` | 格安 | 予算を抑えた長いセッション |
| `kr/claude-sonnet-4.5` | 無料 | 有料のレーンを使い切ったとき |

> **`cc/`のレーンについて。** Claude Codeのプロバイダー(`claude`、別名`cc`)には、このリリースで**非推奨**の印とリスクの注意書きがついています: 予告なく変わりうる文書化されていないClaude Codeのインターフェースに乗っているのです。今日は動き、Anthropicのサブスクリプションには自然な選択ですが、壊れたときのために`cx/`と無料の`kr/`のClaudeモデルを覚えておいてください。

## 使用例

```
Quick tasks       : cc/claude-haiku-4-5-20251001  or  glm/glm-4.7
Balanced work     : cc/claude-sonnet-5  or  cx/gpt-5.6-sol
Hard reasoning    : cc/claude-opus-5
Cost-sensitive    : glm/glm-4.7  →  kr/claude-sonnet-4.5
```

## モデル選択のヒント

- **速くて安い**ものを、名前の変更、コメントの修正、小さな編集に。
- **Sonnet級**を、ふつうの機能の仕事に。
- **Opus級**を、作業が多くのファイルにまたがるとき、論理が繊細なときに。
- **コンボ**を、セッションがクォータの窓を越えて続くかもしれないときに — 終えられるか終えられないかの違いです。

## トラブルシューティング

### 接続に失敗する

1. `curl http://localhost:32060/api/health` → `{"ok":true}`。
2. ベースURLが`/v1`で終わるか確かめてください。
3. キーが完全か確かめてください。
4. VS Codeのウィンドウを再読み込みしてください。

### モデルが利用できない

- IDは、大文字小文字も含めて、正確に一致しなければなりません。
- **Providers**でプロバイダーが接続済みか確かめてください。
- ゲートウェイ自身の一覧を確かめてください: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`。

### 応答が遅い

- より軽いモデルへ移ってください(`cc/claude-haiku-4-5-20251001`、`glm/glm-4.7`)。
- コンテキストを削ってください — 添えるファイルを減らす。
- プロバイダーが劣化していないか確かめてください。

## 高度な設定

### 短いエイリアス

Rooが名前つきのモデルプリセットを保存できるなら、モデルではなく仕事の名で名づけてください:

```
"fast"  → cc/claude-haiku-4-5-20251001
"smart" → cc/claude-opus-5
"cheap" → glm/glm-4.7
"chain" → never-stuck
```

### 別々のプロファイル

仕事の種類ごとに別のプロファイルを — コーディング、文章、調査 — それぞれに自分のモデルと自分のVelaキーを持たせ、利用が然るべき枠に落ちるように。

## 次のステップ

- [Cursor](cursor.md) — IDEとの連携のための
- [Continue](continue.md) — VS Codeのための
- [コンボ](../features/combos.md) — 使う価値のあるフォールバックの鎖のための
