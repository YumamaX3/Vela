# Integración con Cursor

Cursor puede usar un endpoint personalizado compatible con OpenAI. Apúntalo a Vela y cada chat, edición en línea y llamada de autocompletado pasará por la puerta de enlace — enrutada, rastreada y sujeta a tus claves y presupuestos.

## Requisitos previos

- Cursor instalado
- Vela en ejecución local, o un endpoint en la nube accesible
- Una clave de API del dashboard de Vela (**Endpoint & Key → Create Key**)

## ⚠️ Cosas que conviene saber antes

> **Los endpoints personalizados pueden requerir un plan de Cursor de pago.** Cursor ha movido esta capacidad entre versiones y planes. Si el campo de URL base no se ofrece en tu compilación, es una restricción de Cursor, no de Vela.

> **Puede que localhost no sea suficiente.** Algunas configuraciones de Cursor envían las solicitudes a través de los propios servidores de Cursor, para los que `localhost` significa la máquina de Cursor, no la tuya. Si las solicitudes fallan con un error de conexión mientras tu navegador alcanza el dashboard, esa es la causa — despliega Vela donde Cursor pueda alcanzarlo (consulta [Despliegue en la nube](../deployment/cloud.md)) y usa esa dirección en su lugar.

> **Usa un dominio, no una IP desnuda, sobre HTTPS.** Si pones Vela detrás de un proxy inverso, dale un certificado TLS — las claves de API viajan en la solicitud.

## Configuración

### 1. Abrir los ajustes de modelos de Cursor

**Settings** (`Cmd/Ctrl + ,`) → **Models**.

### 2. Habilitar el endpoint de OpenAI personalizado

Activa **OpenAI API key** y busca el campo **Override OpenAI Base URL**. Si tu compilación lo tiene, estás de suerte.

### 3. Configurar la URL base

```
http://localhost:32060/v1
```

Conserva el `/v1`. Una URL sin él llegará al dashboard en lugar de a la API y fallará con una respuesta HTML confusa.

### 4. Pegar tu clave

La clave tiene la forma `vela-v1-<id>-<checksum>`. Consigue una nueva en **Endpoint & Key → Create Key** si no tienes — las claves se muestran una sola vez.

### 5. Añadir un modelo

En **View All Models → Add custom model**, añade el id del modelo exactamente como lo resuelve Vela:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding          ← a combo name works here too
```

### 6. Seleccionarlo

Elige el modelo en el selector de modelos del chat de Cursor y envía un mensaje. Confirma que llegó en **Usage**, en el dashboard de Vela.

## Ejemplo de configuración

```
OpenAI API:        ✓ enabled
Base URL:          http://localhost:32060/v1
API key:           vela-v1-xxxxxxxx-xxxxxxxx
Custom models:     cc/claude-opus-5, cc/claude-sonnet-5, glm/glm-4.7
```

## Modelos disponibles

Cualquier cosa que liste la puerta de enlace — ejecuta `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` para ver los tuyos. Opciones habituales:

| Modelo | Nivel |
|-------|------|
| `cc/claude-opus-5` | Suscripción de Claude |
| `cc/claude-sonnet-5` | Suscripción de Claude |
| `cx/gpt-5.6-sol` | Suscripción de Codex |
| `glm/glm-4.7` | barato |
| `minimax/MiniMax-M2.1` | el más barato |
| `kr/claude-sonnet-4.5` | gratis |

Los combos también funcionan aquí, y son la razón para usar Cursor con Vela: cuando se cierra la cuota de un modelo, responde el siguiente, a mitad de la conversación.

## Uso

- **Chat** (`Cmd/Ctrl + L`) — selecciona el modelo de Vela y pregunta.
- **Edición en línea** (`Cmd/Ctrl + K`) — selecciona código, escribe el prompt, acepta.
- **Explicar** — selecciona el código, pregunta, y comprueba qué modelo respondió en **Routed by Combo** si usas una cadena.

## Solución de problemas

### "Invalid API key"

1. Verifica en **Endpoint & Key** que la clave existe y está activada.
2. Copia la clave completa — desde `vela-v1-` hasta el checksum final.
3. Las claves con el formato antiguo `sk-...` son anteriores al esquema actual y se rechazan; crea una nueva.

### "Model not found"

1. Usa el id exacto de `/v1/models`.
2. Comprueba que el proveedor está conectado en **Providers**.
3. Recuerda que un modelo que el proveedor retiró no se resolverá, se escriba como se escriba.

### Fallos de conexión

1. Confirma que Vela responde: `curl http://localhost:32060/api/health`.
2. Confirma que la URL base termina en `/v1`.
3. Si los servidores de Cursor están en el camino, `localhost` no puede funcionar — usa un endpoint desplegado.

### Falta el campo

Algunas compilaciones y planes de Cursor no exponen una URL base personalizada. Nada del lado de Vela puede añadirla. Alternativas: Cline, Roo o Continue dentro de VS Code, que aceptan una URL base.

## Endpoint en la nube

En un servidor con certificado:

```
Base URL:  https://your-domain.example/v1
API key:   [your Vela key]
```

Entonces Cursor alcanza Vela desde donde se ejecute. Los límites de tasa y la rotación de proveedores son los mismos; solo cambió la dirección.

## Buenas prácticas

1. **Una clave por máquina o por persona** — el informe de uso te dice quién gastó qué.
2. **Ponle un techo** si Cursor corre sin supervisión; un tope de gasto es lo único que detiene un bucle desbocado.
3. **Rota las claves** cuando se pierde un portátil o una clave se pega donde no debería.
4. **Usa un combo** para que un muro de cuota no acabe con tu tarde.
