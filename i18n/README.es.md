<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — la vela del barco" width="520"/>

  **Un endpoint compatible con OpenAI. Más de 40 proveedores upstream. Tus suscripciones, tus claves, tus planes gratuitos — un puerto, una vela.**

  Vela enruta tus herramientas de código con IA (Claude Code, Codex, Cursor, Cline, OpenCode…) a través de un único gateway local con traducción de formatos, respaldo por combo de modelos, rotación entre múltiples cuentas, seguimiento de cuota y un ahorrador de tokens RTK que recorta un 20–40% de los tokens de salida de las herramientas antes de que salgan del puerto.

  [![Versión](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Proveedores](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Imagen](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/9router?style=flat-square&label=cli%20%229router%22)](https://www.npmjs.com/package/9router)
  [![Licencia](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Inicio rápido](#-inicio-rápido) · [✨ Recursos](#-recursos-principales) · [📚 Docs](#-documentación) · [🌐 Idiomas](#-idiomas)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇺🇸 Estás leyendo la traducción al español — el [README original en inglés](../README.md) es la fuente de verdad.

---

## ⛵ ¿Qué es Vela?

Vela es un **gateway local de enrutamiento de IA + panel de control**. Apuntas todas tus herramientas de IA a un único endpoint — `http://localhost:32060/v1` — y Vela decide qué proveedor responde realmente: primero tus suscripciones de pago, luego las rutas de API económicas, al final los planes gratuitos. Cuando una ruta se seca, la siguiente recibe el viento. Sin cambios en las herramientas, sin tiempo de inactividad.

```
┌──────────────┐
│  Your tools  │  Claude Code · Codex · Cursor · Cline · OpenCode · …
└──────┬───────┘
       │  http://localhost:32060/v1   (OpenAI-compatible)
       ▼
┌─────────────────────────────────────────────────────┐
│                  Vela — the gateway                  │
│  RTK token saver · format translation · quota track  │
│  combo fallback · multi-account · OAuth refresh      │
└──────┬──────────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…

       Result: every subscription token spent, every rate limit routed around.
```

Bajo cubierta: un servidor Next.js (panel + API) en el puerto **32060**, un motor de enrutamiento independiente de proveedores (`open-sse/`) y una base de datos SQLite que puede crecer con un gemelo MariaDB cuando lo quieras (sqlite → mysql → mirror).

> 📌 **Nota:** Vela es un fork de [9Router](https://github.com/decolua/9router), renombrado y reforjado — los sistemas de almacenamiento, respaldo, precios y categorías son obra del propio Vela. El lanzador CLI conserva el nombre `9router` en npm para compatibilidad de instalación.

---

## 🤔 ¿Por qué Vela?

| El problema | Lo que hace Vela |
|-|-|
| ❌ La cuota de la suscripción caduca sin usarse | ✅ Seguimiento de cuota + respaldo automático — gasta cada token antes del reinicio |
| ❌ Los límites de velocidad te detienen en pleno flujo | ✅ Rotación entre múltiples cuentas + respaldo por combo de modelos, cero tiempo de inactividad |
| ❌ La salida de las herramientas quema tokens (diffs, grep, ls…) | ✅ El **ahorrador de tokens RTK** comprime el contenido de `tool_result` en su lugar — 20–40% de ahorro |
| ❌ Pagar $20–50/mes por proveedor | ✅ Un gateway único para rutas de suscripción + económicas + gratuitas |
| ❌ Cada herramienta necesita su propia configuración | ✅ Un endpoint compatible con OpenAI, todas las herramientas hablan ese idioma |

---

## ✨ Recursos principales

**🧭 Enrutamiento y traducción**
- Un endpoint compatible con OpenAI: `/v1/chat/completions`, `/v1/messages` (nativo de Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, búsqueda y obtención web
- La traducción de formatos pasa por OpenAI como formato intermedio — rutas directas registradas para pares frágiles (bloques de razonamiento, ids de herramientas)
- **129 proveedores** registrados: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama y decenas más — [lista completa](../docs/PROVIDERS.md)

**🪂 Resiliencia**
- Respaldo por combo de modelos: define un combo y Vela recorre la lista hasta que uno responda
- Respaldo entre múltiples cuentas por proveedor, rotación round-robin
- Gestión de credenciales OAuth + clave de API con renovación automática de tokens

**💰 Inteligencia de costes — el Pacto de Precios**
- Tabla estática de precios (entrada / salida / caché / razonamiento / creación de caché, $/1M tokens) con una cadena de resolución de seis pasos — overrides por proveedor, coincidencia exacta, herencia de modelo gratuito, eliminación de vendor, respaldo por glob
- Editor de precios en el panel + sincronización con models.dev — cada solicitud recibe un coste estimado honesto
- Detección de plan gratuito: los modelos gratuitos heredan la tarifa de su hermano de pago para que el ahorro sea visible

**🐚 Ahorrador de tokens RTK**
- Hooks de pre-traducción comprimen el contenido de `tool_result` antes de que la solicitud salga — fail-open por diseño, nunca tocan los rastros `is_error`
- Sidecar opcional [Headroom](https://github.com/chopratejas/headroom) para una compresión más profunda

**🗝️ Pacto de Almacenamiento**
- Tres posturas, una variable de entorno: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite como puerto por defecto; MariaDB como puerto completo; o **mirror** — SQLite atiende mientras cada escritura se bombea al gemelo MariaDB, vigilada por una barrida de divergencia
- Motor de respaldo sellado: artefactos AES-256-GCM, niveles de retención, simulacro + restauración, pata opcional de S3 fuera del sitio

**🖥️ Panel** — `http://localhost:32060/dashboard`
- Proveedores y flujos OAuth, combos, endpoints + claves de API, uso por clave, cuota, ahorrador de tokens, consola del traductor, páginas de configuración de herramientas CLI, ajustes de precios — en más de 34 idiomas de interfaz

---

## 🚀 Inicio rápido

### Opción A — Docker (recomendada)

```bash
docker login ghcr.io          # PAT with read:packages — the image is private
docker pull ghcr.io/yumamax3/vela:0.6.70

docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:0.6.70
```

Para la carta completa — gemelo MariaDB, postura mirror, motor de respaldo, sidecar Headroom — consulta [DOCKER.md](../DOCKER.md) y la plantilla [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opción B — CLI npm

```bash
npm install -g 9router
9router
```

El CLI instala, inicia y gestiona el servidor (el paquete del lanzador conserva el nombre `9router` en npm).

### Opción C — Desde el código fuente

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Producción: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Luego conecta una herramienta

1. Abre `http://localhost:32060/dashboard` (contraseña por defecto `123456` — cámbiala)
2. **Providers** → conecta uno (Kiro AI es un buen comienzo gratuito)
3. **Endpoints** → copia una clave de API
4. Apunta tu herramienta al gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Documentación

Las cartas viven en [`docs/`](../docs/README.md) — el mapa completo del puerto.

| Carta | Qué cubre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 El mapa del puerto — toda la documentación, una página |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Ciclo de vida de la solicitud, motor del traductor, registro de proveedores, capa de base de datos |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Rutas de instalación, carta del compose, posturas de almacenamiento, actualización |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 El contrato completo de variables de entorno |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Pacto de Almacenamiento — sqlite/mysql/mirror, respaldos, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 La lista completa de los 129 proveedores |
| [docs/API.md](../docs/API.md) | 🔌 La superficie compatible con OpenAI + APIs del panel |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Cuando el viento se calma |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ El pacto de versionado |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, en profundidad |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 El diario de a bordo |

**Para ingenieros que trabajan en este repositorio:** [CLAUDE.md](../CLAUDE.md) — los papeles de la tripulación.
**Para contribuidores del motor:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cómo añadir proveedor / ejecutor / traductor.

---

## 🗺️ Mapa del repositorio

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             pages + API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups

open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (29 specialized + default)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (129 files) + pricing covenant
└── rtk/             token saver hooks (fail-open)

cli/                 the launcher package (npm: 9router)
docs/                the charts — start at docs/README.md
plans/               sealed design plans (Storage Covenant, Pricing Covenant…)
tests/               vitest suite (independent ESM package)
i18n/                localized READMEs (10 languages)
```

---

## 🌍 Idiomas

Este README está traducido a otros 10 idiomas — los enlaces están en el banner de arriba. El propio panel incluye más de 34 idiomas de interfaz; se cambia desde la página de perfil del panel.

---

## 🏛️ Procedencia y licencia

Vela nació como fork de [decolua/9Router](https://github.com/decolua/9router) (MIT) y navega su propio rumbo desde la v0.6.0. El crédito al upstream se conserva donde corresponde; los sistemas de almacenamiento, respaldo, precios y categorías son forjas del propio Vela. Consulta [LICENSE](../LICENSE).

---

<div align="center">

*Iza tu vela. El viento es gratis.* ⛵

</div>
