# その他のツールとの連携

OpenAI APIと話せるものなら、Velaとも話せます。このページは汎用のレシピです: アドレス、キー、いくつかの動く例、そしてスクリプトが同じ失敗を二度しないようにする型。

## 概要

形はいつも同じです:

```
Base URL:  http://localhost:32060/v1     (or https://your-domain.example/v1)
API key:   vela-v1-<id>-<checksum>       (from Dashboard → Endpoint & Key)
Model:     any id the gateway lists, or a combo name
```

## 汎用のセットアップの型

**ローカルのVela:**

```
Base URL:  http://localhost:32060/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

**デプロイしたVela:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

`/v1`は残してください。以下のすべては、この3つの値を前提にしています。

## 利用できるモデル

一覧を信じるより、ゲートウェイに尋ねてください:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

確かな出発点の一式:

| モデル | レーン |
|-------|------|
| `cc/claude-opus-5` | Claudeサブスクリプション |
| `cc/claude-sonnet-5` | Claudeサブスクリプション |
| `cc/claude-haiku-4-5-20251001` | Claudeサブスクリプション |
| `cx/gpt-5.6-sol` | Codexサブスクリプション |
| `cx/gpt-5.4` | Codexサブスクリプション |
| `glm/glm-4.7` | 格安 |
| `minimax/MiniMax-M2.1` | 最も安い |
| `if/qwen3-coder-plus` | 無料 |

## 連携の例

### Python, OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="vela-v1-<id>-<checksum>",
    base_url="http://localhost:32060/v1",
)

response = client.chat.completions.create(
    model="cc/claude-sonnet-5",
    messages=[{"role": "user", "content": "Hello! Who are you?"}],
)

print(response.choices[0].message.content)
```

### Node.js, OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "vela-v1-<id>-<checksum>",
  baseURL: "http://localhost:32060/v1",
});

const response = await client.chat.completions.create({
  model: "cc/claude-sonnet-5",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

### cURL

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer vela-v1-<id>-<checksum>" \
  -d '{
    "model": "cc/claude-sonnet-5",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'
```

### HTTPクライアント(Postman、Insomnia、Bruno)

```
POST http://localhost:32060/v1/chat/completions
Content-Type: application/json
Authorization: Bearer vela-v1-<id>-<checksum>

{
  "model": "cc/claude-sonnet-5",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="cc/claude-sonnet-5",
    openai_api_key="vela-v1-<id>-<checksum>",
    openai_api_base="http://localhost:32060/v1",
    temperature=0.7,
)

print(llm.invoke("Explain vector databases in two sentences.").content)
```

### LlamaIndex (Python)

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    model="cc/claude-sonnet-5",
    api_key="vela-v1-<id>-<checksum>",
    api_base="http://localhost:32060/v1",
    is_chat_model=True,
)

print(llm.complete("What is a token?"))
```

### ベースURLを受け取るものなら何でも

- **Aider** — `--openai-api-base http://localhost:32060/v1`
- **OpenCode、Crush、Kilo Code、Cline、Roo、Continue** — OpenAI互換のプロバイダー、同じ3つのフィールド
- **Claude Code** — [Claude Code](claude-code.md)を見てください
- **Codex CLI** — [Codex](codex.md)を見てください

ダッシュボードの**Endpoint & Key**ページにはQuick Connectのパネルがあり、そのうちのいくつかについて、あなたの実際のキーを使った、貼るだけのスニペットを出します。

## カスタムスクリプト

### バッチ処理

```python
import json
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["VELA_API_KEY"],
    base_url=os.environ.get("VELA_BASE_URL", "http://localhost:32060/v1"),
)


def process_batch(prompts, model="glm/glm-4.7"):
    return [
        {
            "prompt": prompt,
            "response": client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
            ).choices[0].message.content,
        }
        for prompt in prompts
    ]


print(json.dumps(process_batch(["Explain AI in one sentence", "Define a neural network"]), indent=2))
```

### ストリーミング

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.VELA_API_KEY,
  baseURL: process.env.VELA_BASE_URL || "http://localhost:32060/v1",
});

const stream = await client.chat.completions.create({
  model: "cc/claude-sonnet-5",
  messages: [{ role: "user", content: "Write a short story about lighthouses" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### モデルの比較

```python
for model in ["cc/claude-sonnet-5", "cx/gpt-5.6-sol", "glm/glm-4.7"]:
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Explain a bloom filter in three sentences."}],
    ).choices[0].message.content
    print(f"\n=== {model} ===\n{reply}")
```

## よくある型

### キーを環境に置く

```bash
# .env
VELA_API_KEY=vela-v1-<id>-<checksum>
VELA_BASE_URL=http://localhost:32060/v1
VELA_MODEL=cc/claude-sonnet-5
```

```python
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["VELA_API_KEY"], base_url=os.environ["VELA_BASE_URL"])
```

### エラーを扱う

```python
from openai import OpenAIError

try:
    reply = client.chat.completions.create(model="cc/claude-sonnet-5", messages=[...])
except OpenAIError as e:
    print(f"Request failed: {e}")
```

### バックオフつきで再試行する

```python
import time
from openai import RateLimitError

def chat_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            return client.chat.completions.create(
                model="cc/claude-sonnet-5",
                messages=[{"role": "user", "content": prompt}],
            ).choices[0].message.content
        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

もっと良いのは、モデルに**コンボ**を使うことです。そうすればVelaが、ひとつが失敗したとき次のモデルへ移り、あなたの再試行の論理は、どの段も尽きた場合だけを扱えばよくなります。

## トラブルシューティング

### Connection refused

```bash
curl http://localhost:32060/api/health      # {"ok":true}
```

これが失敗するなら、Velaは動いていないか、そのポートにいません。それでも、ベースURLが`/v1`で終わるか確かめてください。

### 401 Unauthorized

- キーが完全で、`vela-v1-`で始まることを確かめてください。
- ヘッダーは`Authorization: Bearer <key>`でなければなりません — `Bearer`のあとに空白ひとつ。
- キーは一度しか表示されません。もう手元になければ、別のものを作ってください。

### 404 model not found

- 正確なIDを使ってください。大文字小文字が効きます。
- ゲートウェイに尋ねてください: `curl .../v1/models -H "Authorization: Bearer <key>"`。
- モデルIDは上流で変わります — 退役したものは解決されません。

### 429

- 応答の本体にあるコードを読んでください: レート制限か、範囲か、予算か。
- 予算のコードは、あなたが決めた上限に達したという意味です — **Endpoint & Key**で編集してください。
- それ以外はバックオフつきで再試行するか、コンボを先へ進めさせてください。

### タイムアウト

- クライアントのタイムアウトを上げてください。長い生成は時間がかかります。
- 対話の経路には、より速いモデルを試してください。
- リバースプロキシがストリームをバッファリングしてはいけないことを思い出してください(`proxy_buffering off`)。

## ベストプラクティス

### セキュリティ
- キーは環境変数か秘密の保管庫に。ソースには決して置かない。
- マシンの外に出るものにはHTTPSを。
- アプリケーションごとにひとつのキー。漏えいしたとき、回すのはひとつのキーで済む。

### パフォーマンス
- 人が待っているときはストリームする。
- 繰り返す答えは、正当な範囲であなた自身でキャッシュする。
- 最も高いモデルを既定にするのではなく、仕事にモデルを合わせる。

### コスト
- **Usage**を見てください。キーごとのレポートは、スクリプトがいくらかかるかの正直な会計です。
- 自動化が使うキーには、支出上限を設定してください。

## 次のステップ

- [Cursor](cursor.md) · [Cline](cline.md) · [Continue](continue.md) · [Roo](roo.md)
- [コンボ](../features/combos.md) — スクリプトのためのフォールバックの鎖
- [クォータ追跡](../features/quota-tracking.md) — 利用量と予算の読み方
