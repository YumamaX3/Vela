# Integración con otras herramientas

Cualquier cosa que pueda hablar con la API de OpenAI puede hablar con Vela. Esta página es la receta genérica: la dirección, la clave, un puñado de ejemplos que funcionan, y los patrones que evitan que un script falle de la misma forma dos veces.

## Resumen

La forma es siempre la misma:

```
Base URL:  http://localhost:32060/v1     (or https://your-domain.example/v1)
API key:   vela-v1-<id>-<checksum>       (from Dashboard → Endpoint & Key)
Model:     any id the gateway lists, or a combo name
```

## Patrón de configuración genérico

**Vela local:**

```
Base URL:  http://localhost:32060/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

**Vela desplegado:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

Conserva el `/v1`. Todo lo de abajo asume esos tres valores.

## Modelos disponibles

Pregunta a la puerta de enlace en lugar de fiarte de una lista:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

Un conjunto inicial fiable:

| Modelo | Nivel |
|-------|------|
| `cc/claude-opus-5` | Suscripción de Claude |
| `cc/claude-sonnet-5` | Suscripción de Claude |
| `cc/claude-haiku-4-5-20251001` | Suscripción de Claude |
| `cx/gpt-5.6-sol` | Suscripción de Codex |
| `cx/gpt-5.4` | Suscripción de Codex |
| `glm/glm-4.7` | barato |
| `minimax/MiniMax-M2.1` | el más barato |
| `if/qwen3-coder-plus` | gratis |

## Ejemplos de integración

### Python, SDK de OpenAI

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

### Node.js, SDK de OpenAI

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

### Clientes HTTP (Postman, Insomnia, Bruno)

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

### Cualquier cosa que acepte una URL base

- **Aider** — `--openai-api-base http://localhost:32060/v1`
- **OpenCode, Crush, Kilo Code, Cline, Roo, Continue** — proveedor compatible con OpenAI, los mismos tres campos
- **Claude Code** — consulta [Claude Code](claude-code.md)
- **Codex CLI** — consulta [Codex](codex.md)

La página **Endpoint & Key** del dashboard tiene un panel Quick Connect que imprime fragmentos listos para pegar para varias de estas, usando tu clave real.

## Scripts personalizados

### Procesamiento por lotes

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

### Comparar modelos

```python
for model in ["cc/claude-sonnet-5", "cx/gpt-5.6-sol", "glm/glm-4.7"]:
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Explain a bloom filter in three sentences."}],
    ).choices[0].message.content
    print(f"\n=== {model} ===\n{reply}")
```

## Patrones habituales

### Mantén la clave en el entorno

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

### Manejar errores

```python
from openai import OpenAIError

try:
    reply = client.chat.completions.create(model="cc/claude-sonnet-5", messages=[...])
except OpenAIError as e:
    print(f"Request failed: {e}")
```

### Reintentar con espera progresiva

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

Mejor aún: usa un **combo** como modelo. Entonces Vela pasa al siguiente modelo cuando uno falla, y tu lógica de reintento solo tiene que cubrir el caso en que todos los peldaños están agotados.

## Solución de problemas

### Conexión rechazada

```bash
curl http://localhost:32060/api/health      # {"ok":true}
```

Si eso falla, Vela no está en ejecución o no está en ese puerto. Comprueba además que la URL base termina en `/v1`.

### 401 Unauthorized

- La clave debe estar completa y empezar por `vela-v1-`.
- La cabecera debe ser `Authorization: Bearer <key>` — un espacio después de `Bearer`.
- Las claves se muestran una sola vez. Si ya no la tienes, crea otra.

### 404 model not found

- Usa el id exacto; las mayúsculas importan.
- Pregunta a la puerta de enlace: `curl .../v1/models -H "Authorization: Bearer <key>"`.
- Los ids de modelo cambian aguas arriba — uno retirado no se resolverá.

### 429

- Lee el código del cuerpo de la respuesta: límite de tasa, ámbito o presupuesto.
- Los códigos de presupuesto significan que se alcanzó un techo que fijaste — edítalo en **Endpoint & Key**.
- Si no, reintenta con espera progresiva, o deja que un combo siga adelante.

### Tiempos de espera

- Aumenta el tiempo de espera del cliente; las generaciones largas llevan tiempo.
- Prueba un modelo más rápido para las rutas interactivas.
- Recuerda que un proxy inverso no debe almacenar la transmisión en búfer (`proxy_buffering off`).

## Buenas prácticas

### Seguridad
- Claves en variables de entorno o en un almacén de secretos, nunca en el código.
- HTTPS para cualquier cosa que salga de tu máquina.
- Una clave por aplicación, para que una filtración sea una clave que rotar.

### Rendimiento
- Usa streaming cuando haya una persona esperando.
- Guarda en caché las respuestas repetidas por tu cuenta cuando sea legítimo.
- Ajusta el modelo a la tarea en lugar de usar por defecto el más caro.

### Costo
- Vigila **Usage**; el informe por clave es la cuenta honesta de lo que cuesta un script.
- Fija un tope de gasto en cualquier clave que use la automatización.

## A dónde ir después

- [Cursor](cursor.md) · [Cline](cline.md) · [Continue](continue.md) · [Roo](roo.md)
- [Combos](../features/combos.md) — cadenas de fallback para scripts
- [Seguimiento de cuota](../features/quota-tracking.md) — leer el uso y los presupuestos\n",
  "i": "Write es other-tools integration",
  "path": "C:/Users/navis/Documents/My Project/Ai Gateway/Vela/gitbook/content/es/integration/other-tools.md"
}