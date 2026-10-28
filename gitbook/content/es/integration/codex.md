# Integración con la CLI de OpenAI Codex

La CLI de Codex puede apuntarse a Vela con un pequeño bloque en `~/.codex/config.toml`. Esta es la misma forma que escribe por ti la página **CLI Tools → Codex** del dashboard, así que puedes pegarla tú mismo o dejar que el dashboard lo haga.

## Requisitos previos

- CLI de Codex instalada
- Vela en ejecución local, o un endpoint en la nube al que puedas llegar
- Una clave de API del dashboard de Vela (**Endpoint & Key → Create Key**)

## Configuración

### 1. Editar `~/.codex/config.toml`

```toml
model = "cx/gpt-5.6-sol"
model_provider = "Vela"

[model_providers.Vela]
name = "Vela"
base_url = "http://localhost:32060/v1"
wire_api = "responses"
http_headers = { Authorization = "Bearer [your Vela key]" }
```

Un proveedor personalizado en Codex se autentica **solo** mediante la línea `http_headers` de arriba — el `OPENAI_API_KEY` de `auth.json` pertenece al proveedor `openai` integrado y no se lee para un proveedor definido así. Pon la clave aquí, no allí.

### 2. Comprobarlo

```bash
curl -s http://localhost:32060/api/health      # → {"ok":true}
codex "Write a function that reverses a linked list"
```

Luego mira **Usage** en el dashboard; la solicitud debería estar ahí.

### 3. Si prefieres variables de entorno

Algunas configuraciones prefieren el entorno al archivo. Eso también funciona, para cualquier cosa que hable la API de OpenAI:

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

La ruta de `config.toml` es la que genera el dashboard, y la que conviene preferir — sobrevive a un shell nuevo.

## Modelos disponibles

| Modelo | Bueno para |
|-------|----------|
| `cx/gpt-5.6-sol` | el buque insignia actual para programación |
| `cx/gpt-5.6-terra` | una segunda opción moderna |
| `cx/gpt-5.6-luna` | trabajo más ligero y rápido |
| `cx/gpt-5.5`, `cx/gpt-5.4` | respaldos estables |

Cualquier otro modelo o combo también sirve — a Codex no le importa qué significa el id, solo que Vela pueda resolverlo.

## Ejemplos de uso

```bash
# Write code
codex --model cx/gpt-5.6-sol "Create a REST endpoint that paginates results"

# Explain code
codex --model cx/gpt-5.6-terra "Explain what this does: $(cat myfile.js)"

# Use a fallback chain
codex --model quality-first "Plan the refactor"
```

## Solución de problemas

### Errores de autenticación

1. La clave debe estar en `http_headers` dentro de `[model_providers.Vela]` — una clave en `auth.json` no se usará para un proveedor personalizado.
2. Comprueba que la clave está completa y empieza por `vela-v1-`.
3. Crea una nueva en **Endpoint & Key** si tienes dudas; las claves no se pueden recuperar después de crearlas.

### Problemas de conexión

1. `curl http://localhost:32060/api/health`.
2. Confirma que `base_url` termina en `/v1`.
3. Comprueba que nada bloquea el puerto 32060.

### Modelo no disponible

1. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Confirma que el proveedor de Codex está conectado en Vela (**Providers**).
3. Los ids de modelo cambian aguas arriba; elige uno actual de la lista de arriba.

## Endpoint en la nube

Sustituye `base_url` por tu dirección desplegada (conservando `/v1`):

```toml
base_url = "https://your-domain.example/v1"
```

La documentación antigua menciona la instancia alojada por el propietario del proyecto en `https://vela.my.id`; es un dato upstream sobre su despliegue, no un servicio que esta documentación pueda prometer. Usa el endpoint para el que tengas credenciales.
