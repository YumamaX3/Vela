# Preguntas frecuentes

Las preguntas que la gente hace primero, respondidas con claridad. Si nada de aquí encaja, [Solución de problemas](troubleshooting.md) es la siguiente parada.

---

## ¿Qué es Vela?

**Una puerta de enlace entre tus herramientas de programación y tus proveedores de IA.**

Apuntas todas las herramientas a una sola dirección — `http://localhost:32060/v1` — y Vela enruta cada solicitud a un proveedor que tengas conectado. Lleva la cuenta de las cuotas, mantiene frescos los tokens OAuth, y puede pasar a otro modelo cuando uno se niega a responder.

No es un modelo, y no hace gratuitos a los modelos. Es la centralita entre los modelos a los que ya tienes acceso.

---

## ¿Vela es gratis?

**Vela en sí es gratuita y de código abierto (MIT).**

Lo que cuesta dinero es lo que ocurre aguas arriba: una suscripción de Claude Code, un plan de Codex, o proveedores que cobran por token como GLM y MiniMax. Vela no añade ninguna comisión encima.

Puedes funcionar enteramente con proveedores gratuitos — iFlow, Qwen, Kiro, Antigravity — si aceptas sus límites. Esa combinación no cuesta nada.

---

## ¿Cómo funciona el enrutamiento?

Hay dos mecanismos, y son distintos:

1. **Un combo** es una cadena que defines tú: modelo 1, luego modelo 2, luego modelo 3. Cuando una solicitud a un modelo *falla* — error de cuota, límite de tasa, tiempo de espera agotado, prompt rechazado, modelo desconocido — Vela prueba el siguiente.
2. **Round-robin** (por proveedor, o por combo) reparte las solicitudes entre varias cuentas del mismo proveedor, para que una sola cuenta no reciba toda la carga.

Ninguno de los dos te cambia a un modelo más barato solo porque una asignación diaria esté bajando. Eso gastaría dinero que no acordaste gastar.

Para un techo estricto, usa un presupuesto por clave: cuando se alcanza, Vela se niega con un 429 que lo indica.

Consulta [Enrutamiento inteligente](features/smart-routing.md) y [Combos](features/combos.md).

---

## ¿Cuántos proveedores soporta Vela?

Tres números honestos, medidos el 2026-10-28 en la versión 1.2.5:

- **186** archivos de proveedor en el registro
- **186** importados por el índice (hoy cada archivo está conectado)
- **145** con un transporte que una solicitud puede alcanzar de verdad

Puedes volver a derivarlos en tu propio clon:

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

Los que aquí se documentan nivel por nivel:

- **Suscripción:** Claude Code, Codex, GitHub Copilot, Antigravity, Kimi
- **Barato:** GLM, MiniMax, Kimi
- **Gratis:** iFlow, Qwen, Kiro

---

## ¿Qué modelos puedo usar hoy?

Los ids de modelo son `prefijo/modelo`. Algunos fiables en esta versión:

| Modelo | Nivel |
|-------|------|
| `cc/claude-opus-5`, `cc/claude-sonnet-5` | Suscripción de Claude Code |
| `cx/gpt-5.6-sol`, `cx/gpt-5.5` | Suscripción de Codex |
| `gh/claude-sonnet-4.6`, `gh/gpt-5.4` | GitHub Copilot |
| `ag/gemini-4-argon-high` | Antigravity (gratis) |
| `glm/glm-4.7` | barato — $0.60 / $2.20 por 1M |
| `minimax/MiniMax-M2.1` | barato — $0.30 / $1.20 por 1M |
| `kr/claude-sonnet-4.5` | gratis |
| `if/qwen3-coder-plus` | gratis |
| `qwen/qwen-plus` | gratis |

No confíes en la documentación por encima de la puerta de enlace en ejecución:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

Esa lista es la verdad para tu instalación.

---

## ¿Puedo usar varios proveedores juntos?

**Sí — esa es la idea.** Construye un combo:

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5       ← subscription
          2. glm/glm-4.7            ← cheap
          3. kr/claude-sonnet-4.5   ← free
```

Luego usa `premium-coding` como nombre de modelo en cualquier herramienta. El nombre del combo se resuelve antes que cualquier otra cosa, así que en la conexión parece un modelo normal.

---

## ¿Vela funciona con Cursor?

**Sí.** Cursor acepta una URL base y una clave compatibles con OpenAI. Si Vela se ejecuta en tu máquina:

```
Cursor → Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    your model or combo name (add it as a custom model)
```

Algunas versiones de Cursor restringen los endpoints personalizados a los planes de pago, y algunas configuraciones enrutan a través de los propios servidores de Cursor, en cuyo caso `localhost` no es alcanzable desde su lado. En esa situación, despliega Vela en un servidor con dirección pública (consulta [Despliegue en la nube](deployment/cloud.md)) y usa `https://tu-dominio/v1` en su lugar.

Otras herramientas que aceptan una URL base funcionan igual: Cline, Roo, Continue, Claude Code, Codex CLI y cualquier otra compatible con OpenAI. Consulta [Integración](integration/claude-code.md).

---

## ¿Puedo alojar Vela yo mismo?

**Sí, y es la forma prevista de ejecutarla.** Tres rutas:

**En tu máquina:**
```bash
npm install -g vela
vela
# dashboard: http://localhost:32060/dashboard
# API:       http://localhost:32060/v1
```

**Con Docker, en cualquier servidor:**
```bash
docker run -d --name vela \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.5
```

La imagen es pública — no requiere inicio de sesión ni token para descargarla — y es multiarquitectura (amd64 y arm64). Fija la etiqueta en lugar de usar `:latest`.

**Desde el código fuente:**
```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

La raíz del repositorio es la aplicación; no hay un directorio `app/` anidado. Los scripts disponibles son `dev`, `build`, `start` (y sus variantes para Bun) — no hay script de pruebas ni script de despliegue en Cloudflare.

Detalles completos: [Localhost](deployment/localhost.md) · [Nube](deployment/cloud.md).

---

## ¿Mis datos están seguros?

**Por defecto, se quedan en tu máquina.**

- Todo vive en el directorio de datos — `~/.vela` en macOS/Linux, `%APPDATA%\vela` en Windows, o lo que nombre `DATA_DIR`.
- Los tokens OAuth y las claves de API de los proveedores conectados se almacenan en esa base de datos local.
- Vela envía solicitudes solo a los proveedores que conectaste; nada se reporta de vuelta al proyecto Vela.

**Qué guarda:** las conexiones y los tokens de los proveedores, tus claves de API (almacenadas como hashes — las claves completas se muestran una sola vez al crearlas), estadísticas de uso, combos, ajustes y registros de solicitudes (solo si los habilitas).

**Qué no guarda:** una copia de tus prompts o del código generado más allá de los registros de solicitudes, que están desactivados por defecto.

**Antes de exponerla a una red:** configura una contraseña del dashboard en **Settings → Access**, activa **Require dashboard login**, considera **Require API key**, y colócala detrás de HTTPS. La lista de comprobación está en [Despliegue en la nube](deployment/cloud.md).

---

## ¿Cuál es la contraseña por defecto?

**No hay ninguna.**

Los tutoriales antiguos mencionan `123456`; esa contraseña por defecto se retiró. Vela actual no tiene ninguna contraseña por defecto:

- Desde la máquina que ejecuta Vela, el dashboard se abre sin preguntar.
- Desde cualquier otro lugar, los inicios de sesión se **rechazan** hasta que configures una contraseña en **Settings → Access**.

La misma pantalla muestra un veredicto verde de "gated" una vez que los controles están en su sitio — vale la pena comprobarlo antes de abrir un puerto.

---

## ¿Cómo actualizo Vela?

```bash
# npm install
npm update -g vela
npm list -g vela        # what you are running now

# Docker — pin the newer tag deliberately
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run your docker run command with the new tag

# From a git checkout
cd Vela && git pull && npm install && npm run build && npm run start
```

Haz una copia de seguridad del directorio de datos antes de las versiones mayores. Las migraciones de la base de datos se ejecutan automáticamente al arrancar, con una copia de seguridad tomada antes de hacerlo.

---

## ¿Cómo puedo contribuir?

Muy bienvenido.

1. **Reportar errores** — [GitHub Issues](https://github.com/YumamaX3/Vela/issues), con el error, los pasos y tu versión.
2. **Pedir funciones** — [GitHub Discussions](https://github.com/YumamaX3/Vela/discussions).
3. **Enviar código:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Vela.git
   cd Vela
   git checkout -b feature/your-feature
   npm install
   npm run dev
   ```
   Ejecuta la suite de comprobaciones que incluye el repositorio antes de abrir un pull request, y mantén los commits pequeños y descriptivos.
4. **Mejorar la documentación** — las correcciones y las traducciones son tan útiles como las funciones.
5. **Añadir proveedores** — los ejemplos de adaptadores viven en `open-sse/providers/registry/`.

---

## ¿Qué puertos usa Vela?

- **32060** — todo: el dashboard (`/dashboard`) y la API (`/v1`), servidos por un solo proceso.
- **32060** otra vez en un navegador significa `http://localhost:32060`; el dashboard vive un nivel más abajo, en `/dashboard`.

Si otra cosa necesita ese puerto, cámbialo con `vela --port 8080` o `PORT=8080`.

---

## ¿A dónde acudo cuando algo se rompe?

1. `http://localhost:32060/api/health` debería responder `{"ok":true}`. Si no lo hace, Vela no está en ejecución.
2. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` debería listar modelos. Una lista vacía significa que ningún proveedor está conectado.
3. [Solución de problemas](troubleshooting.md) relaciona los errores habituales — conexión rechazada, clave inválida, modelo no encontrado, respuestas lentas — con sus soluciones.

---

## ¿Necesitas más ayuda?

- **Documentación:** [vela.my.id/docs](https://vela.my.id/docs)
- **GitHub:** [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Solución de problemas:** [troubleshooting.md](troubleshooting.md)
