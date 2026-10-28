# 其他工具集成

任何能与 OpenAI API 对话的工具，都能与 Vela 对话。本页是通用配方：地址、密钥、若干可用示例，以及能让脚本不会在同一个地方失败两次的模式。

## 概览

形状始终相同：

```
Base URL:  http://localhost:32060/v1     (or https://your-domain.example/v1)
API key:   vela-v1-<id>-<checksum>       (from Dashboard → Endpoint & Key)
Model:     any id the gateway lists, or a combo name
```

## 通用配置模式

**本地 Vela：**

```
Base URL:  http://localhost:32060/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

**已部署的 Vela：**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

保留 `/v1`。以下一切内容都假定这三个值。

## 可用模型

与其相信一张列表，不如直接向网关询问：

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

一组可靠的起步选择：

| 模型 | 通道 |
|-------|------|
| `cc/claude-opus-5` | Claude 订阅 |
| `cc/claude-sonnet-5` | Claude 订阅 |
| `cc/claude-haiku-4-5-20251001` | Claude 订阅 |
| `cx/gpt-5.6-sol` | Codex 订阅 |
| `cx/gpt-5.4` | Codex 订阅 |
| `glm/glm-4.7` | 低价 |
| `minimax/MiniMax-M2.1` | 最便宜 |
| `if/qwen3-coder-plus` | 免费 |

## 集成示例

### Python，OpenAI SDK

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

### Node.js，OpenAI SDK

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

### HTTP 客户端（Postman、Insomnia、Bruno）

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

### LangChain（Python）

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

### LlamaIndex（Python）

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

### 任何接受基础 URL 的工具

- **Aider** —— `--openai-api-base http://localhost:32060/v1`
- **OpenCode、Crush、Kilo Code、Cline、Roo、Continue** —— OpenAI 兼容提供商，同样的三个字段
- **Claude Code** —— 参见 [Claude Code](claude-code.md)
- **Codex CLI** —— 参见 [Codex](codex.md)

仪表盘的 **端点与密钥** 页面有一个 Quick Connect 面板，会用你真实的密钥打印出其中几项的即贴片段。

## 自定义脚本

### 批量处理

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

### 流式传输

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

### 比较模型

```python
for model in ["cc/claude-sonnet-5", "cx/gpt-5.6-sol", "glm/glm-4.7"]:
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Explain a bloom filter in three sentences."}],
    ).choices[0].message.content
    print(f"\n=== {model} ===\n{reply}")
```

## 常见模式

### 把密钥留在环境变量中

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

### 处理错误

```python
from openai import OpenAIError

try:
    reply = client.chat.completions.create(model="cc/claude-sonnet-5", messages=[...])
except OpenAIError as e:
    print(f"Request failed: {e}")
```

### 带退避的重试

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

更好的做法：把**组合**用作模型。这样当一个模型失败时，Vela 会转向下一个，而你的重试逻辑只需处理所有阶梯都用尽的情况。

## 故障排查

### 连接被拒绝

```bash
curl http://localhost:32060/api/health      # {"ok":true}
```

如果这也失败，说明 Vela 没有运行，或不在该端口上。即使它能应答，也请检查基础 URL 是否以 `/v1` 结尾。

### 401 Unauthorized

- 密钥必须完整，并以 `vela-v1-` 开头。
- 请求头必须是 `Authorization: Bearer <key>` —— `Bearer` 后一个空格。
- 密钥只显示一次。如果你已经没有了，请重新创建一个。

### 404 model not found

- 使用精确的 id；大小写很重要。
- 询问网关：`curl .../v1/models -H "Authorization: Bearer <key>"`。
- 模型 id 会随上游变化 —— 已下线的不会解析。

### 429

- 读取响应体中的代码：速率限制、范围或预算。
- 预算类代码意味着你设置的上限被触达了 —— 在 **端点与密钥** 下修改它。
- 否则请带退避重试，或让组合继续前行。

### 超时

- 调高客户端超时；长生成需要时间。
- 交互路径上试试更快的模型。
- 记住反向代理绝不能缓冲流（`proxy_buffering off`）。

## 最佳实践

### 安全
- 密钥放在环境变量或密钥库中，绝不放源码里。
- 任何离开你机器的流量都用 HTTPS。
- 每个应用一把密钥，这样泄露时只需轮换一把。

### 性能
- 有人在等时就流式输出。
- 在合理的地方自行缓存重复的答案。
- 让模型匹配任务，而不是默认用最贵的那个。

### 成本
- 关注 **用量**；按密钥的报告是脚本成本的诚实账本。
- 对任何被自动化使用的密钥设置支出上限。

## 下一步

- [Cursor](cursor.md) · [Cline](cline.md) · [Continue](continue.md) · [Roo](roo.md)
- [组合](../features/combos.md) —— 为脚本准备的回退链
- [配额跟踪](../features/quota-tracking.md) —— 读懂用量与预算
