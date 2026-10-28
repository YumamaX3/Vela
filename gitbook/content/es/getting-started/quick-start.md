# Comenzar

Cinco minutos, un endpoint, todas tus herramientas apuntándole. Esta página es la vía rápida; [Instalación](../getting-started/installation.md) tiene los detalles y la solución de problemas.

---

## Inicio rápido

### 1. Instalar

```bash
npm install -g vela
```

Necesitas Node.js 20 o superior. El comando `vela` es un pequeño lanzador: inicia la puerta de enlace y abre tu navegador.

### 2. Arrancar

```bash
vela
```

El dashboard se abre en **http://localhost:32060/dashboard**.

Algunas cosas que conviene saber en el primer arranque:

- **No hay contraseña por defecto**. Desde la máquina que ejecuta Vela, el dashboard se abre directamente. Los inicios de sesión desde otras máquinas se rechazan hasta que configures una contraseña en **Settings → Access**.
- Tus datos viven en `~/.vela` en macOS y Linux, y en `%APPDATA%\vela` en Windows.
- Por defecto la puerta de enlace escucha en todas las interfaces de red (`0.0.0.0`). Si solo la necesitas en esta máquina, arráncala con `vela --host 127.0.0.1`.

### 3. Conectar un proveedor

Hay tres tipos de proveedor, y puedes mezclarlos libremente.

#### Opción A — Suscripciones OAuth

**Ideal para:** Claude Code, Codex, GitHub Copilot, Antigravity — cualquier cosa que ya pagues o a la que inicies sesión.

```
Dashboard → Providers → pick a provider → Connect
→ Log in in the browser window → done
```

Los tokens se renuevan solos a partir de ahí, y el seguimiento de cuota empieza de inmediato.

**Ejemplo: Claude Code**
1. Abre **Providers** y elige **Claude**.
2. Haz clic en **Connect**, inicia sesión en tu cuenta de Claude y aprueba.
3. Usa el modelo por su nombre completo, por ejemplo `cc/claude-opus-5`.

#### Opción B — Claves de API

**Ideal para:** GLM, MiniMax, Kimi, OpenRouter y cualquier otro proveedor de pago por uso.

```
Dashboard → Providers → pick a provider → Add API key
→ paste the key → Save
```

**Ejemplo: GLM-4.7**
1. Crea una cuenta y una clave en tu proveedor de GLM.
2. En Vela: **Providers → GLM → Add API key**, pega, guarda.
3. Usa `glm/glm-4.7`.

#### Opción C — Proveedores gratuitos

**Ideal para:** la última línea cuando se agota la cuota de pago.

```
Dashboard → Providers → Connect a free provider
→ Device code or OAuth → done
```

**Ejemplo: Kiro**
1. Abre **Providers** y elige **Kiro**.
2. Inicia sesión con un AWS Builder ID o una cuenta social.
3. Usa modelos `kr/` — la familia Claude, sin costo.

### 4. Crear una clave de API para tus herramientas

```
Dashboard → Endpoint & Key → Create Key → copy it
```

Las claves tienen la forma `vela-v1-<id>-<checksum>`. Se muestran una sola vez — cópiala en un lugar seguro, o crea otra más adelante si la pierdes. A cada clave se le pueden dar su propio ámbito de proveedores, límite de tasa, presupuesto de tokens y techo de gasto.

### 5. Apuntar tus herramientas a Vela

Toda herramienta necesita lo mismo: el endpoint y la clave.

**Cursor**

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    cc/claude-opus-5     (add it as a custom model)
```

**Cline / Continue / Roo**

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    cc/claude-opus-5
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

**Codex CLI**

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

Cada herramienta tiene su propia página en [Integración](../integration/claude-code.md), con los campos exactos y los tropiezos habituales.

---

## 6. Construir una cadena de fallback (opcional, pero recomendable)

Un solo modelo es un único punto de fallo. Un **combo** te permite nombrar una cadena de modelos, y Vela la recorre hasta que uno responde.

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      (subscription first)
          2. glm/glm-4.7           (cheap backup)
          3. kr/claude-sonnet-4.5  (free last line)
```

Luego usa `premium-coding` donde vaya un nombre de modelo. El combo se busca por nombre antes que cualquier otra cosa, así que funciona en cualquier herramienta.

Un combo pasa al siguiente modelo cuando una solicitud falla — un error de cuota, un límite de tasa, un tiempo de espera agotado, un prompt rechazado, un modelo que no existe. **No** cambia solo porque una cuota diaria esté bajando; eso gastaría dinero en silencio. Si quieres un techo de gasto, fíjalo en la clave de API (**Endpoint & Key → Create/Edit Key → budget**), y Vela rechazará las solicitudes al alcanzarlo con un 429 claro, en lugar de degradarte sin avisar.

---

## Modelos disponibles

Los nombres de modelo son `prefijo/modelo`. Aquí tienes un conjunto inicial; abre **Providers** en el dashboard para ver la lista completa — cambia a medida que los proveedores publican nuevos modelos.

### Nivel de suscripción

**Claude Code (`cc/`)**
- `cc/claude-opus-5` — el que arrastra el trabajo pesado
- `cc/claude-sonnet-5` — el equilibrio de cada día
- `cc/claude-haiku-4-5-20251001` — rápido y ligero

**Codex (`cx/`)**
- `cx/gpt-5.6-sol`, `cx/gpt-5.6-terra`, `cx/gpt-5.6-luna` — la familia actual
- `cx/gpt-5.5`, `cx/gpt-5.4` — siguen ahí y siguen siendo buenos

**GitHub Copilot (`gh/`)**
- `gh/claude-sonnet-4.5`, `gh/claude-opus-4.5`, `gh/gpt-5.4`

**Antigravity (`ag/`)**
- `ag/gemini-4-argon-high` y el resto de la familia Gemini, además de modelos Claude

### Nivel barato

**GLM (`glm/`)** — `glm/glm-4.7` a $0.60 / $2.20 por 1M, además de `glm/glm-5` y los modelos más recientes `glm-5.x`

**MiniMax (`minimax/`)** — `minimax/MiniMax-M2.1` a $0.30 / $1.20 por 1M, además de M2.5, M2.7 y M3

**Kimi (`kimi/`)** — `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`

### Nivel gratuito

**iFlow (`if/`)** — `if/qwen3-coder-plus`, `if/kimi-k2`, `if/glm-4.7`, `if/deepseek-r1`, y más

**Qwen (`qwen/`)** — `qwen/qwen-plus`, `qwen/qwen-max`, `qwen/qwen-turbo`

**Kiro (`kr/`)** — `kr/claude-sonnet-4.5`, `kr/claude-opus-4.8`, y modelos Claude más recientes

> **Sobre las asignaciones gratuitas:** cifras como las 180K completaciones al mes que reporta Gemini CLI y los límites diarios de Meta o Google son **cifras upstream publicadas por esos proveedores** — no algo que Vela controle. Han cambiado antes y volverán a cambiar. Toma como verdad la lectura de cuota en vivo del dashboard.

---

## Mantener los costos bajos

Una rutina práctica, sin necesidad de hoja de cálculo:

```
1. Put your subscription models first in the combo.
2. Put GLM or MiniMax second — a fraction of the cost of any retail API.
3. Always end with a free provider, so the chain never dead-ends.
4. Set a budget ceiling on the API key you hand to tools you leave running.
```

Las páginas de [Proveedores baratos](../providers/cheap.md) y [Proveedores gratuitos](../providers/free.md) tienen ejemplos resueltos, con la aritmética a la vista.

---

## A dónde ir después

- [Instalación](../getting-started/installation.md) — requisitos, Docker, compilación desde el código fuente, desinstalación
- [Enrutamiento inteligente](../features/smart-routing.md) — cómo las solicitudes eligen un proveedor
- [Combos](../features/combos.md) — construir y ajustar cadenas de fallback
- [Seguimiento de cuota](../features/quota-tracking.md) — leer el dashboard
- [Preguntas frecuentes](../faq.md) — las dudas que todo el mundo hace primero
- [Solución de problemas](../troubleshooting.md) — cuando algo no se conecta

---

## ¿Necesitas ayuda?

- **Sitio web**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)

Vela es la versión 1.2.5. Comprueba qué estás ejecutando con:

```bash
npm list -g vela
```
