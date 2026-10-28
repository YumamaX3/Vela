# Integración con Claude Code

Apuntar Claude Code a Vela requiere dos variables de entorno. A partir de ahí, cada solicitud a Claude que hace tu terminal pasa por la puerta de enlace — lo que significa que puede enrutarse, rastrearse y quedar cubierta por una cadena de fallback.

## Requisitos previos

- CLI de Claude Code instalado (`claude --version` debería imprimir una versión)
- Vela en ejecución local, o un endpoint en la nube al que puedas llegar
- Una clave de API creada en el dashboard de Vela (**Endpoint & Key → Create Key**)

## Configuración

### 1. Configurar las variables de entorno

Añádelas al perfil de tu shell (`~/.zshrc`, `~/.bashrc` o `~/.bash_profile`):

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

- `ANTHROPIC_BASE_URL` — adónde envía las solicitudes Claude Code. Conserva el `/v1`.
- `ANTHROPIC_AUTH_TOKEN` — tu clave de Vela. Claude Code la envía como token de portador; Vela la acepta como clave de API.

Si prefieres que otro modelo responda por defecto, configura también los destinos de los alias:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Recargar tu shell

```bash
source ~/.zshrc     # or ~/.bashrc
```

### 3. Verificar

```bash
echo $ANTHROPIC_BASE_URL
curl -s http://localhost:32060/api/health      # → {"ok":true}
```

Luego lanza un prompt pequeño:

```bash
claude --model sonnet "Say hello in five words."
```

Una respuesta a través de Vela significa que está conectado. Puedes confirmarlo en el dashboard: **Usage** mostrará la solicitud.

## Alias de modelo

Los nombres cortos de Claude Code mapean a lo que apunten las variables de entorno de arriba:

| Alias | Significado | Lo configura |
|-------|---------|--------|
| `opus` | tu modelo más pesado | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | tu modelo de cada día | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | tu modelo rápido | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

Si no las configuras, Claude Code pide sus nombres habituales del upstream y Vela los resuelve contra los proveedores que hayas conectado.

## Ejemplos de uso

### Con alias

```bash
claude --model opus   "Explain the trade-offs of an append-only log"
claude --model sonnet "Write a Python function that retries with backoff"
claude --model haiku  "Review this diff for typos"
```

### Con un nombre de modelo completo de Vela

```bash
claude --model cc/claude-opus-5 "Refactor this module"
```

### Con un combo

Aquí es donde Vela se gana su sitio: si la ventana de suscripción se cierra a media tarde, la cadena continúa.

```bash
claude --model premium-coding "Plan the migration"
```

con un combo `cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`.

## El archivo de ajustes

Claude Code también lee `~/.claude/settings.json`, donde los mismos valores pueden vivir dentro de un bloque `env`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:32060/v1",
    "ANTHROPIC_AUTH_TOKEN": "[your Vela key]"
  }
}
```

El dashboard puede escribirlo por ti: **CLI Tools → Claude Code** rellena la URL base y la clave, y te muestra el resultado antes de guardarlo.

## Solución de problemas

### Problemas de conexión

1. `curl http://localhost:32060/api/health` → debería ser `{"ok":true}`.
2. `echo $ANTHROPIC_BASE_URL` → debería terminar en `/v1`.
3. Comprueba que nada bloquee el puerto 32060, y que Vela escuche donde esperas (`vela --host 127.0.0.1` la mantiene local).

### Modelo no encontrado

1. Pregunta a la puerta de enlace qué tiene: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Comprueba que el proveedor de ese modelo está conectado en **Providers**.
3. Recuerda que los ids de modelo cambian aguas arriba — `cc/claude-opus-5` hoy, otra cosa el próximo trimestre.

### No autorizado / 401

- Confirma que `ANTHROPIC_AUTH_TOKEN` contiene una clave de Vela (`vela-v1-...`), no un token de suscripción de Claude.
- Las claves se muestran una sola vez al crearlas. Si ya no la tienes, crea otra en **Endpoint & Key**.

## Endpoint en la nube

Para usar un Vela desplegado en lugar de localhost:

```bash
export ANTHROPIC_BASE_URL="https://your-domain.example/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

La instancia alojada del propio proyecto aparece en documentación antigua como `https://vela.my.id` — es el despliegue del propietario, un dato upstream y no un servicio que esta documentación pueda prometer. Usa el endpoint para el que tengas credenciales de verdad.
