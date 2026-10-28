# Integración con la extensión Continue para VSCode

Continue es un asistente de IA de código abierto para VS Code y JetBrains. Lee un `config.json`, y ese archivo es todo lo que necesitas para enrutarlo a través de Vela.

## Requisitos previos

- VS Code con la extensión Continue instalada
- Vela en ejecución local, o un endpoint en la nube accesible
- Una clave de API del dashboard de Vela (**Endpoint & Key → Create Key**)

## Pasos de configuración

### 1. Abrir la configuración de Continue

- `Cmd+Shift+P` (macOS) o `Ctrl+Shift+P` (Windows/Linux)
- Ejecuta **Continue: Open Config**
- Esto abre `~/.continue/config.json`

### 2. Añadir modelos de Vela

El formato de configuración actual de Continue usa un array `models`:

**Un modelo:**

```json
{
  "models": [
    {
      "title": "Vela — Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**Varios, para poder cambiar en el desplegable:**

```json
{
  "models": [
    {
      "title": "Vela — Opus (hard tasks)",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — Sonnet (everyday)",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — GLM (cheap)",
      "provider": "openai",
      "model": "glm/glm-4.7",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**Para un Vela desplegado**, cambia `apiBase`:

```json
"apiBase": "https://your-domain.example/v1"
```

> Si tu versión de Continue todavía usa el esquema `models`/`apiBase` más antiguo que se muestra aquí, funciona tal como está escrito. Las compilaciones más nuevas pueden pedirte un pequeño asistente de configuración en el primer arranque; los mismos tres valores — proveedor `openai`, id de modelo, URL base — van en los mismos lugares.

### 3. Guardar y recargar

Guarda el archivo, y luego **Developer: Reload Window**. Continue lee la configuración al cargar.

### 4. Seleccionar un modelo

Abre la barra lateral de Continue y elige el modelo en el desplegable de la parte superior.

## Modelos disponibles

Cualquier cosa que liste la puerta de enlace — compruébalo con:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

| Modelo | Nivel |
|-------|------|
| `cc/claude-opus-5` | Suscripción de Claude |
| `cc/claude-sonnet-5` | Suscripción de Claude |
| `cc/claude-haiku-4-5-20251001` | Suscripción de Claude |
| `cx/gpt-5.6-sol` | Suscripción de Codex |
| `cx/gpt-5.4` | Suscripción de Codex |
| `glm/glm-4.7` | barato |
| `minimax/MiniMax-M2.1` | el más barato |
| `kr/claude-sonnet-4.5` | gratis |

Los combos también funcionan como ids de modelo.

## Ejemplos de uso

- **Explicar:** selecciona código, abre la barra lateral, pregunta "Explain this".
- **Generar:** pide "a React card component for a user profile".
- **Refactorizar:** selecciona código, pide "Refactor this to async/await".
- **Depurar:** pega el stack trace y pregunta qué se rompió.

## Avanzado

### Un system prompt

```json
{
  "models": [
    {
      "title": "Vela — Code Expert",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1",
      "systemMessage": "You are a senior engineer. Prefer small, reviewable changes and explain trade-offs."
    }
  ]
}
```

### Temperatura

```json
"temperature": 0.9,
"topP": 0.95
```

Para código, una temperatura más baja suele ser mejor; para escritura, más alta.

### Proveedores de contexto

Continue decide qué enviar junto a tu prompt. Ajustar esto es la palanca más grande sobre el costo para los usuarios de Continue:

```json
{
  "contextProviders": [
    { "name": "code", "params": { "maxLines": 100 } },
    { "name": "diff", "params": {} }
  ]
}
```

## Atajos de teclado

- `Cmd/Ctrl + L` — abrir el chat
- `Cmd/Ctrl + I` — edición en línea
- `Cmd/Ctrl + Shift + R` — regenerar

(Los atajos varían según la versión; el panel de atajos de VS Code lista los tuyos.)

## Solución de problemas

### El modelo no responde

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Comprueba la clave en `config.json`.
3. Abre la consola de desarrollador de VS Code (**Help → Toggle Developer Tools**) y lee el error.

### Responde el modelo equivocado

- Comprueba el desplegable de la barra lateral — Continue recuerda la última selección.
- Los ids de modelo distinguen mayúsculas y minúsculas.

### La configuración no carga

- Valida el JSON (una coma final es el culpable habitual).
- Confirma que la ruta es `~/.continue/config.json`.
- Recarga la ventana después de guardar.

### Lento

- Usa un modelo más ligero.
- Recorta el contexto: menos `maxLines`, menos archivos adjuntos.
- Comprueba la latencia de red hasta Vela.

## Buenas prácticas

1. **Tres modelos, tres precios** — Opus para pensar, Sonnet para escribir, GLM para las tareas domésticas. Cambiar es un clic.
2. **Selecciona antes de preguntar** — enviar archivos completos es el hábito caro.
3. **Pon un techo a la clave** si Continue corre en una máquina compartida.

## A dónde ir después

- [Cursor](cursor.md) para el IDE
- [Roo](roo.md) para otro agente
- [Combos](../features/combos.md) para las cadenas de fallback
