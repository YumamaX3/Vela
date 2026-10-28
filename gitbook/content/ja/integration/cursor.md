# Cursorとの連携

CursorはOpenAI互換のカスタムエンドポイントを使えます。Velaに向ければ、チャットも、インラインの編集も、オートコンプリートの呼び出しも、すべてゲートウェイを通ります — ルーティングされ、追跡され、あなたのキーと予算に従う。

## 前提条件

- Cursorがインストール済み
- Velaがローカルで動いているか、届くクラウドのエンドポイントがある
- Velaのダッシュボード(**Endpoint & Key → Create Key**)で作ったAPIキー

## ⚠️ まず知っておくべきこと

> **カスタムエンドポイントには有料のCursorプランが要るかもしれません。** Cursorはこの機能を、バージョンとプランのあいだで動かしてきました。あなたのビルドでベースURLの欄が出ないなら、それはCursorの制限であって、Velaのものではありません。

> **localhostでは足りないことがあります。** Cursorの設定によっては、リクエストをCursor自身のサーバー経由で送るので、そこから見た`localhost`は、あなたのマシンではなくCursorのマシンを意味します。ブラウザがダッシュボードに届くのに、リクエストが接続エラーで失敗するなら、それが原因です — Cursorが届ける場所にVelaをデプロイし([クラウドへのデプロイ](../deployment/cloud.md))、そのアドレスを使ってください。

> **HTTPSでは裸のIPではなくドメインを使ってください。** Velaをリバースプロキシの背後に置くなら、TLSの証明書を与えてください — APIキーがリクエストの中を旅します。

## セットアップ

### 1. Cursorのモデル設定を開く

**Settings**(`Cmd/Ctrl + ,`)→ **Models**。

### 2. カスタムのOpenAIエンドポイントを有効にする

**OpenAI API key**をオンにして、**Override OpenAI Base URL**の欄を探します。あなたのビルドにあれば、しめたものです。

### 3. ベースURLを設定する

```
http://localhost:32060/v1
```

`/v1`は残してください。それがなければ、URLはAPIではなくダッシュボードに届き、不可解なHTMLの応答で失敗します。

### 4. キーを貼り付ける

キーは`vela-v1-<id>-<checksum>`の形をしています。持っていなければ**Endpoint & Key → Create Key**で新しく手に入れてください — キーは一度しか表示されません。

### 5. モデルを足す

**View All Models → Add custom model**で、Velaが解決するとおりのモデルIDを足します:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding          ← a combo name works here too
```

### 6. 選ぶ

Cursorのチャットのモデル選択でそのモデルを選び、メッセージを送ります。それがVelaダッシュボードの**Usage**に届いたことを確かめてください。

## 設定例

```
OpenAI API:        ✓ enabled
Base URL:          http://localhost:32060/v1
API key:           vela-v1-xxxxxxxx-xxxxxxxx
Custom models:     cc/claude-opus-5, cc/claude-sonnet-5, glm/glm-4.7
```

## 利用できるモデル

ゲートウェイが一覧するものなら何でも — `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`を走らせて、あなたのものを確かめてください。よく選ばれるもの:

| モデル | レーン |
|-------|------|
| `cc/claude-opus-5` | Claudeサブスクリプション |
| `cc/claude-sonnet-5` | Claudeサブスクリプション |
| `cx/gpt-5.6-sol` | Codexサブスクリプション |
| `glm/glm-4.7` | 格安 |
| `minimax/MiniMax-M2.1` | 最も安い |
| `kr/claude-sonnet-4.5` | 無料 |

コンボもここで動き、それがCursorをVelaとともに使う理由そのものです: ひとつのモデルのクォータが閉じたら、会話の途中で次のものが答えます。

## 使い方

- **Chat**(`Cmd/Ctrl + L`) — Velaのモデルを選んで、尋ねる。
- **Inline edit**(`Cmd/Ctrl + K`) — コードを選び、プロンプトを書き、受け入れる。
- **Explain** — コードを選んで尋ね、鎖を使っているなら**Routed by Combo**でどのモデルが答えたか確かめる。

## トラブルシューティング

### 「Invalid API key」

1. **Endpoint & Key**で、キーが存在し有効か確かめてください。
2. キーを丸ごとコピーしてください — `vela-v1-`から末尾のチェックサムまで。
3. 古い`sk-...`形式のキーは現在の方式より前のもので、拒否されます。新しく作ってください。

### 「Model not found」

1. `/v1/models`の正確なIDを使ってください。
2. プロバイダーが**Providers**で接続済みか確かめてください。
3. プロバイダーが退役させたモデルは、どう綴っても解決されないことを思い出してください。

### 接続の失敗

1. Velaが答えるか確かめてください: `curl http://localhost:32060/api/health`。
2. ベースURLが`/v1`で終わるか確かめてください。
3. Cursorのサーバーが経路に入っているなら、`localhost`は働けません — デプロイしたエンドポイントを使ってください。

### 欄がない

Cursorのビルドとプランのなかには、カスタムのベースURLを出さないものがあります。Velaの側でそれを足すことはできません。代わりに: VS CodeのなかのCline、Roo、Continue。どれもベースURLを受け取ります。

## クラウドのエンドポイント

証明書のあるサーバーで:

```
Base URL:  https://your-domain.example/v1
API key:   [your Vela key]
```

そうすればCursorは、どこで動いていようとVelaに届きます。レート制限もプロバイダーのローテーションも同じで、変わったのはアドレスだけです。

## ベストプラクティス

1. **マシンごと、あるいは人ごとにひとつのキー** — 利用レポートが、誰がいくら使ったかを教えてくれます。
2. **Cursorが人の見ていないところで走るなら、上限を付ける** — 暴走するループを止めるのは、支出上限だけです。
3. **キーを回す** — ノートPCを失ったとき、あるいはキーをあるべきでない場所に貼ったとき。
4. **コンボを使う** — クォータの壁があなたの午後を終わらせないように。
