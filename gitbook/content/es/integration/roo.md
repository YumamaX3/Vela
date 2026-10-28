# Integración con Roo AI Assistant

Roo es un agente de VS Code que vive en la barra lateral. Apúntalo a Vela y alcanza todos los modelos que tengas conectados, con una clave y una dirección.

## Requisitos previos

- Roo instalado en VS Code
- Vela en ejecución local, o un endpoint en la nube accesible
- Una clave de API del dashboard de Vela (**Endpoint & Key → Create Key**)

## Pasos de configuración

### 1. Abrir los ajustes de Roo

Inicia Roo y abre su panel de ajustes desde la barra lateral.

### 2. Elegir el tipo de proveedor

En **API Provider**, elige **OpenAI Compatible**. Vela habla la API de OpenAI, así que esa es la forma correcta — Roo pedirá una URL base, una clave y un id de modelo.

### 3. Rellenar los tres campos

**Vela local:**

```
Base URL:  http://localhost:32060/v1
API Key:   vela-v1-<id>-<checksum>
Model:     cc/claude-opus-5
```

**Vela desplegado:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-opus-5
```

### 4. Probarlo

Envía:

```
Hello! Can you confirm you're connected through Vela?
```

Luego mira en **Usage** del dashboard — la solicitud debería estar ahí, atribuida a esa clave.

## Elegir un modelo

| Modelo | Nivel | Úsalo para |
|-------|------|------------|
| `cc/claude-opus-5` | Suscripción de Claude | las tareas más difíciles |
| `cc/claude-sonnet-5` | Suscripción de Claude | trabajo equilibrado del día a día |
| `cc/claude-haiku-4-5-20251001` | Suscripción de Claude | ediciones rápidas |
| `cx/gpt-5.6-sol` | Suscripción de Codex | problemas con mucha programación |
| `glm/glm-4.7` | barato | sesiones largas con presupuesto |
| `kr/claude-sonnet-4.5` | gratis | cuando los niveles de pago están gastados |

> **Una nota sobre el nivel `cc/`.** El proveedor de Claude Code (`claude`, alias `cc`) lleva una marca de **obsoleto** con un aviso de riesgo en esta versión: se apoya en una interfaz de Claude Code no documentada que puede cambiar sin aviso. Hoy funciona y es la elección natural para una suscripción de Anthropic — ten en cuenta `cx/` y los modelos Claude gratuitos `kr/` si se rompe.

## Ejemplos de uso

```
Quick tasks       : cc/claude-haiku-4-5-20251001  or  glm/glm-4.7
Balanced work     : cc/claude-sonnet-5  or  cx/gpt-5.6-sol
Hard reasoning    : cc/claude-opus-5
Cost-sensitive    : glm/glm-4.7  →  kr/claude-sonnet-4.5
```

## Consejos para elegir modelo

- **Rápido y barato** para renombrados, arreglo de comentarios y ediciones pequeñas.
- **Clase Sonnet** para trabajo de funcionalidad corriente.
- **Clase Opus** cuando una tarea abarca muchos archivos o la lógica es sutil.
- **Un combo** cuando la sesión puede sobrevivir a una ventana de cuota — es la diferencia entre terminar y no terminar.

## Solución de problemas

### Falló la conexión

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Comprueba que la URL base termina en `/v1`.
3. Comprueba que la clave está completa.
4. Recarga la ventana de VS Code.

### Modelo no disponible

- El id debe coincidir exactamente, mayúsculas incluidas.
- Confirma que el proveedor está conectado en **Providers**.
- Consulta la lista propia de la puerta de enlace: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### Respuestas lentas

- Pasa a un modelo más ligero (`cc/claude-haiku-4-5-20251001`, `glm/glm-4.7`).
- Recorta el contexto — menos archivos adjuntos.
- Comprueba que el proveedor no esté degradado.

## Avanzado

### Alias cortos

Si Roo te permite guardar presets de modelo con nombre, nómbralos por el trabajo en lugar de por el modelo:

```
"fast"  → cc/claude-haiku-4-5-20251001
"smart" → cc/claude-opus-5
"cheap" → glm/glm-4.7
"chain" → never-stuck
```

### Perfiles separados

Perfiles distintos para tipos de trabajo distintos — programación, escritura, investigación — cada uno con su propio modelo y su propia clave de Vela, para que el uso caiga en el cajón correcto.

## A dónde ir después

- [Cursor](cursor.md) para la integración con el IDE
- [Continue](continue.md) para VS Code
- [Combos](../features/combos.md) para las cadenas de fallback que vale la pena usar
