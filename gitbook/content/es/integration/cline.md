# Integración con Cline

Cline es una extensión de VS Code que lee, edita y ejecuta código por ti. Apúntala a Vela y obtiene cualquier modelo que tengas conectado — además de una cadena de fallback cuando se cierra una cuota a mitad de tarea.

## Requisitos previos

- VS Code instalado
- La extensión Cline, instalada desde el marketplace de VS Code
- Vela en ejecución local, o un endpoint en la nube accesible
- Una clave de API del dashboard de Vela (**Endpoint & Key → Create Key**)

## Configuración

### 1. Abrir los ajustes de Cline

Haz clic en el icono de Cline en la barra lateral de VS Code, y luego en el icono de engranaje del panel de Cline.

### 2. Elegir el proveedor OpenAI Compatible

En el desplegable **API Provider**, elige **OpenAI Compatible**. Esa es la opción correcta para Vela — acepta una URL base con forma de OpenAI y una clave.

### 3. Configurar la URL base

```
http://localhost:32060/v1
```

Incluye el `/v1`. Un despliegue en la nube tiene la misma forma con otro host:

```
https://your-domain.example/v1
```

### 4. Pegar tu clave

Tu clave de Vela tiene la forma `vela-v1-<id>-<checksum>`. Se muestra una sola vez al crearla, así que crea una nueva en **Endpoint & Key** si la has perdido.

### 5. Configurar el id del modelo

Cline acepta un id de modelo de texto libre. Usa uno que Vela resuelva:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding            ← a combo name works too
```

### 6. Guardar

Cierra el panel de ajustes; Cline guarda mientras escribes. Envía un mensaje pequeño para confirmar, y luego mira **Usage** en el dashboard de Vela.

## Ejemplo de configuración

```
API Provider:  OpenAI Compatible
Base URL:      http://localhost:32060/v1
API Key:       vela-v1-xxxxxxxx-xxxxxxxx
Model:         cc/claude-opus-5
```

### Qué escribe el dashboard

Cline guarda sus ajustes en dos archivos del disco. El Quick Connect del dashboard imprime exactamente esta forma, y puedes pegarla a mano si prefieres editar archivos antes que hacer clic:

```json
// ~/.cline/data/globalState.json
{ "openAiBaseUrl": "http://localhost:32060", "actModeApiProvider": "openai" }
```

```json
// ~/.cline/data/secrets.json
{ "openAiApiKey": "vela-v1-<id>-<checksum>" }
```

Fíjate en la diferencia con el campo de arriba: **`openAiBaseUrl` aquí omite el `/v1`** — Cline añade la ruta por sí mismo. Una URL base `http://localhost:32060/v1` en ese campo produce `/v1/v1/chat/completions` y un 404. Usa el fragmento del dashboard, o introduce la URL desde el propio panel de ajustes de Cline, que gestiona el sufijo por ti.

## Modelos disponibles

Cualquier cosa que liste la puerta de enlace: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

| Modelo | Nivel | Bueno para |
|-------|------|----------|
| `cc/claude-opus-5` | Suscripción de Claude | trabajo complejo en varios archivos |
| `cc/claude-sonnet-5` | Suscripción de Claude | ediciones del día a día |
| `cx/gpt-5.6-sol` | Suscripción de Codex | problemas de programación difíciles |
| `glm/glm-4.7` | barato | sesiones largas con presupuesto |
| `minimax/MiniMax-M2.1` | el más barato | contextos grandes |
| `kr/claude-sonnet-4.5` | gratis | cuando los niveles de pago están secos |

> **Una nota sobre el nivel `cc/`.** El proveedor de Claude Code (`claude`, alias `cc`) está marcado como **obsoleto con un aviso de riesgo** en el registro que incluye esta versión. Funciona, y es lo que la mayoría de la gente quiere para su suscripción de Anthropic — pero depende de una interfaz de Claude Code no documentada que puede cambiar sin aviso. Si empieza a fallar, los modelos Claude gratuitos `kr/` y el nivel `cx/` son las alternativas estables.

## Uso

### Chat

Escribe en el panel de Cline y pulsa Enter. Cline envía la conversación, y los archivos que decida leer, a través de Vela.

### Generación de código

Pide un cambio ("añade paginación a este endpoint"). Cline propone ediciones; revísalas antes de aceptarlas — con el mismo cuidado que tendrías con cualquier agente.

### Operaciones con archivos

Cline puede crear, modificar y borrar archivos. Vela no altera ese comportamiento; solo decide qué modelo lo planifica y lo ejecuta. El fallback aquí es genuinamente útil: un cambio de modelo entre pasos mantiene en marcha una tarea larga.

## Solución de problemas

### "Connection failed"

1. `curl http://localhost:32060/api/health` → debería responder.
2. Confirma que la URL base termina en `/v1`.
3. Comprueba el cortafuegos en el puerto 32060.
4. Recarga la ventana de VS Code (`Cmd/Ctrl + Shift + P` → "Reload Window").

### "Invalid API key"

- La clave debe empezar por `vela-v1-`. Las claves con el formato antiguo `sk-...` se rechazan.
- Cópiala entera, sin un salto de línea final.
- Crea una clave nueva si la antigua se pegó alguna vez en público — las claves antiguas no se pueden volver a mostrar.

### "Model not found"

- Usa el id exacto de `/v1/models`.
- Confirma que ese proveedor está conectado en **Providers**.
- Los ids de modelo cambian aguas arriba; un id retirado no se resolverá, se escriba como se escriba.

### Cline se detiene a mitad de tarea

Muy a menudo, una ventana de cuota que se cierra o un límite de tasa. Un combo (`cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`) permite que el siguiente paso se ejecute en el siguiente modelo en lugar de detenerse.

## Avanzado

### Usar un combo

```
Model: never-stuck
```

con una cadena que termina en un proveedor gratuito. Las ejecuciones largas de agentes son las más beneficiadas — son exactamente la carga de trabajo que choca contra un muro de cuota media hora después de empezar.

### Cambiar de modelo según la tarea

Ten dos o tres ids a mano y cambia el campo según cambie el trabajo:

- razonamiento pesado y refactorizaciones → `cc/claude-opus-5`
- ediciones del día a día → `glm/glm-4.7`
- experimentos → `kr/claude-sonnet-4.5`

### Tiempos de espera

Las ediciones grandes con contextos largos pueden superar el tiempo de espera de Cline. Auméntalo en los ajustes de VS Code si Cline ofrece la opción, o divide la tarea — Vela transmitirá tan rápido como lo haga el proveedor.

## Buenas prácticas

1. **Dale a Cline su propia clave**, con un techo de gasto. Un agente que hace bucles puede quemar un presupuesto sorprendentemente rápido; un tope lo convierte en una parada en lugar de una factura.
2. **Mantén las conversaciones enfocadas** — el contexto es el costo dominante.
3. **Nunca hagas commit de la clave.** Vive en los ajustes de VS Code, no en el repositorio.
4. **Vigila qué modelo respondió** en **Routed by Combo** cuando uses una cadena: te dice si tus respaldos están haciendo el trabajo.
