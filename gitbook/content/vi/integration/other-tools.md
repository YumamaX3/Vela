# Tích hợp các Công cụ khác

Bất cứ thứ gì nói được với OpenAI API đều nói được với Vela. Trang này là công thức chung: địa chỉ, key, một vài ví dụ chạy được, và những mẫu giữ cho một script không thất bại theo cùng một cách hai lần.

## Tổng quan

Hình dạng luôn như nhau:

```
Base URL:  http://localhost:32060/v1     (or https://your-domain.example/v1)
API key:   vela-v1-<id>-<checksum>       (from Dashboard → Endpoint & Key)
Model:     any id the gateway lists, or a combo name
```

## Mẫu thiết lập tổng quát

**Vela cục bộ:**

```
Base URL:  http://localhost:32060/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

**Vela đã triển khai:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

Giữ `/v1`. Mọi thứ dưới đây giả định ba giá trị ấy.

## Các model hiện có

Hãy hỏi gateway thay vì tin một danh sách:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

Một bộ khởi đầu đáng tin:

| Model | Tầng |
|-------|------|
| `cc/claude-opus-5` | subscription Claude |
| `cc/claude-sonnet-5` | subscription Claude |
| `cc/claude-haiku-4-5-20251001` | subscription Claude |
| `cx/gpt-5.6-sol` | subscription Codex |
| `cx/gpt-5.4` | subscription Codex |
| `glm/glm-4.7` | giá rẻ |
| `minimax/MiniMax-M2.1` | rẻ nhất |
| `if/qwen3-coder-plus` | miễn phí |

## Ví dụ tích hợp

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

### HTTP client (Postman, Insomnia, Bruno)

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

### Bất cứ thứ gì nhận một base URL

- **Aider** — `--openai-api-base http://localhost:32060/v1`
- **OpenCode, Crush, Kilo Code, Cline, Roo, Continue** — nhà cung cấp tương thích OpenAI, cùng ba trường
- **Claude Code** — xem [Claude Code](claude-code.md)
- **Codex CLI** — xem [Codex](codex.md)

Trang **Endpoint & Key** của dashboard có một bảng Quick Connect in ra các đoạn mã sẵn sàng dán cho một số công cụ này, dùng key thật của bạn.

## Các script tùy chỉnh

### Xử lý hàng loạt

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

### Streaming

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

### So sánh các model

```python
for model in ["cc/claude-sonnet-5", "cx/gpt-5.6-sol", "glm/glm-4.7"]:
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Explain a bloom filter in three sentences."}],
    ).choices[0].message.content
    print(f"\n=== {model} ===\n{reply}")
```

## Các mẫu phổ biến

### Giữ key trong biến môi trường

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

### Xử lý lỗi

```python
from openai import OpenAIError

try:
    reply = client.chat.completions.create(model="cc/claude-sonnet-5", messages=[...])
except OpenAIError as e:
    print(f"Request failed: {e}")
```

### Thử lại với backoff

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

Còn tốt hơn: dùng một **combo** làm model. Khi ấy Vela chuyển sang model kế tiếp khi một cái thất bại, và logic thử lại của bạn chỉ phải xử lý trường hợp mọi bậc đều đã cạn.

## Khắc phục sự cố

### Connection refused

```bash
curl http://localhost:32060/api/health      # {"ok":true}
```

Nếu thế thất bại, Vela không chạy hoặc không ở cổng đó. Kiểm tra base URL kết thúc bằng `/v1` ngay cả khi nó đã trả lời.

### 401 Unauthorized

- Key phải đầy đủ và bắt đầu bằng `vela-v1-`.
- Header phải là `Authorization: Bearer <key>` — đúng một dấu cách sau `Bearer`.
- Key chỉ được hiển thị một lần. Nếu bạn không còn giữ nó, hãy tạo cái khác.

### 404 model not found

- Dùng đúng id; chữ hoa chữ thường quan trọng.
- Hỏi gateway: `curl .../v1/models -H "Authorization: Bearer <key>"`.
- Id model thay đổi ở thượng nguồn — một id đã bị khai tử sẽ không phân giải được.

### 429

- Đọc mã trong phần thân phản hồi: rate limit, phạm vi hay ngân sách.
- Mã ngân sách nghĩa là một ngưỡng bạn đã đặt đã bị chạm — sửa nó trong **Endpoint & Key**.
- Ngược lại, hãy thử lại với backoff, hoặc để một combo đi tiếp.

### Timeout

- Tăng timeout phía client; những lần sinh dài cần thời gian.
- Thử một model nhanh hơn cho các đường tương tác.
- Nhớ rằng một reverse proxy không được buffer stream (`proxy_buffering off`).

## Thực hành tốt nhất

### Bảo mật
- Key trong biến môi trường hoặc một kho bí mật, không bao giờ trong mã nguồn.
- Mỗi ứng dụng một key, để một lần rò rỉ chỉ là một key cần xoay vòng.

### Hiệu năng
- Stream khi có một con người đang chờ.
- Tự cache những câu trả lời lặp lại ở nơi điều đó hợp lý.
- Ghép model với công việc thay vì mặc định dùng cái đắt nhất.

### Chi phí
- Theo dõi **Usage**; báo cáo theo key là bản ghi trung thực về chi phí của một script.
- Đặt một ngưỡng chi tiêu cho mọi key mà tự động hoá dùng đến.

## Bước tiếp theo

- [Cursor](cursor.md) · [Cline](cline.md) · [Continue](continue.md) · [Roo](roo.md)
- [Combos](../features/combos.md) — các chuỗi fallback cho script
- [Theo dõi quota](../features/quota-tracking.md) — đọc mức dùng và ngân sách
