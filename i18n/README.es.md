<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — la vela del barco" width="520"/>

  **Un endpoint compatible con OpenAI. 145 transportes upstream conectables. Tus suscripciones, tus claves, tus planes gratuitos — un puerto, una vela.**

  Vela enruta tus herramientas de código con IA (Claude Code, Codex, Cursor, Cline, OpenCode…) a través de un único gateway local con traducción de formatos, respaldo por combo de modelos, rotación entre múltiples cuentas, seguimiento de cuota, ACL por clave y un ahorrador de tokens RTK que recorta un 20–40% de los tokens de salida de las herramientas antes de que salgan del puerto.

  [![Versión](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](../CHANGELOG.md)
  [![Proveedores](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Imagen](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![Licencia](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Inicio rápido](#-inicio-rápido) · [✨ Recursos](#-recursos-principales) · [📚 Documentación](#-documentación) · [🌐 Idiomas](#-idiomas)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
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
│                  Vela — the gateway                 │
│  RTK token saver · format translation · quota track │
│  combo fallback · multi-account · OAuth refresh     │
└──────────┬──────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…
       Result: every subscription token spent, every rate limit routed around.
```

Un único proceso Node sirve ambos motores: el **panel + API** (`src/`, una app Next.js con App Router) y el **motor de enrutamiento** (`open-sse/`), en el puerto **32060**. El estado vive en SQLite por defecto y puede crecer con un gemelo MariaDB cuando lo quieras (`sqlite` → `mysql` → `mirror`). Un motor de respaldo sellado vigila el suelo del puerto, y el gateway marca cada release para que el casco siempre pueda probarse.

> 📌 **Nota:** Vela navega su propio rumbo — un gateway de IA forjado en aguas abiertas, con todos sus sistemas propios: almacenamiento, respaldo, precios y categoría. El CLI se instala como `vela` desde npm. Linaje del fork: desde la v0.6.0 el gateway está licenciado bajo MIT y es plenamente propio (ver [Procedencia y licencia](#-procedencia-y-licencia)).

> 🔢 **Disciplina de cifras** (medido el 2026-10-28, en la v1.2.4). El registro de proveedores reporta **tres cifras honestas, y difieren**: **189** archivos de registro en disco → **186** importados por el índice generado → **145** transportes de chat conectables (los otros 41 carriles importados llevan transportes de medios, búsqueda y embeddings que, con razón, no hablan chat). Tres archivos están en disco deliberadamente ocultos del índice (`trae`, `devin-cli`, `windsurf`). Nunca colapses las tres en una — nombra la cifra que quieres decir, y vuelve a derivarla en vez de fiarte de esta línea:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> El censo está fijado como propiedad por `tests/unit/provider-registry-census.test.js` — un archivo que llega al disco sin un import se enrojece ahí antes de apagarse en silencio. Ver [docs/PROVIDERS.md](../docs/PROVIDERS.md).

---

## 🤔 ¿Por qué Vela?

| El problema | Lo que hace Vela |
|-|-|
| ❌ La cuota de la suscripción caduca sin usarse | ✅ Seguimiento de cuota + respaldo automático — gasta cada token antes del reinicio |
| ❌ Los límites de velocidad te detienen en pleno flujo | ✅ Rotación entre múltiples cuentas + respaldo por combo de modelos, cero tiempo de inactividad |
| ❌ La salida de las herramientas quema tokens (diffs, grep, ls…) | ✅ El **ahorrador de tokens RTK** comprime el contenido de `tool_result` en su lugar — 20–40% de ahorro |
| ❌ Pagar $20–50/mes por proveedor | ✅ Un gateway único para rutas de suscripción + económicas + gratuitas |
| ❌ Cada herramienta necesita su propia configuración | ✅ Un endpoint compatible con OpenAI, todas las herramientas hablan ese idioma |
| ❌ Un proveedor cae y tu flujo cae con él | ✅ Cortacircuitos + umbrales de fallo por proveedor + ventanas de enfriamiento |

---

## ✨ Recursos principales

**🧭 Enrutamiento y traducción**
- Un endpoint compatible con OpenAI: `/v1/chat/completions`, `/v1/messages` (nativo de Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (generaciones, ediciones, extensiones), `/v1/responses` (+`/compact`), `/v1beta/*`, búsqueda web, fetch y scrape
- La traducción de formatos pivota a través de OpenAI como formato intermedio — rutas directas registradas para pares frágiles (bloques de razonamiento, ids de herramientas)
- **145 proveedores conectables** entre carriles de suscripción, pago por uso, gratuitos, locales y de medios — [el listado completo](../docs/PROVIDERS.md)
- El direccionamiento de modelos es `provider/model` (`kr/claude-sonnet-4.5`) — el prefijo nombra el carril

**🪂 Resiliencia**
- Respaldo por combo de modelos: define un combo y Vela recorre la lista hasta que uno responda
- Respaldo entre múltiples cuentas por proveedor, rotación round-robin
- Cortacircuitos por pool — y el cortacircuitos **sobrevive a un reinicio**: las ventanas abiertas persisten a través del almacén vinculado, los plazos se acotan a un techo, y un cortacircuitos restaurado se rearma a un solo fallo, igual que la ley en proceso
- Umbrales de fallo por proveedor con ventanas de enfriamiento (`VELA_PROVIDER_FAILURE_*`), gestión de credenciales OAuth + clave de API con renovación automática de tokens en segundo plano

**💰 Inteligencia de costes — el Pacto de Precios**
- Tabla estática de precios (entrada / salida / caché / razonamiento / creación de caché, $/1M tokens) con una cadena de resolución de seis pasos — overrides por proveedor, coincidencia exacta, herencia de modelo gratuito, eliminación de vendor, respaldo por glob
- Editor de precios en el panel + sincronización con models.dev — cada solicitud recibe un coste estimado honesto
- Detección de plan gratuito: los modelos gratuitos heredan la tarifa de su hermano de pago para que el ahorro sea visible
- El coste se calcula en el **momento de escritura** y se congela — sin relleno retroactivo, sin recálculo tras editar tarifas

**🐚 Ahorrador de tokens RTK**
- Hooks de pre-traducción comprimen el contenido de `tool_result` antes de que la solicitud salga — fail-open por diseño, nunca tocan los rastros `is_error`
- Inyectores de prompt definidos por el operador (añadir anteponer), en capas sobre los ahorradores integrados
- Sidecar opcional [Headroom](https://github.com/chopratejas/headroom) para una compresión más profunda

**🗝️ Pacto de Almacenamiento**
- Tres posturas, una variable de entorno: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite como puerto por defecto; MariaDB como puerto completo; o **mirror** — SQLite atiende mientras cada escritura se bombea al gemelo MariaDB a través de un outbox, vigilada por una barrida de divergencia
- Cadena de drivers: `better-sqlite3` → `node:sqlite` (instalación cero en Node ≥ 22.5) → `sql.js` en JS puro; `VELA_DB_DRIVER` fija uno, y el fallo es ruidoso
- **23 migraciones** (`SCHEMA_VERSION = 23`) — una sincronización declarativa de `TABLES` mantiene honestos ambos puertos y el gemelo — ver [docs/STORAGE.md](../docs/STORAGE.md)
- Motor de respaldo sellado: artefactos AES-256-GCM, niveles de retención, simulacro de restauración, pata opcional de S3 fuera del sitio

**🛡️ Seguridad**
- ACL por clave — cuatro capas: clases, proveedores, combos, modelos (listas de permitidos de tres estados)
- Puertas de presupuesto: topes diarios, topes de gasto, límites de tasa por clave
- **Sin contraseña por defecto.** La antigua `123456` fue retirada (v0.9.41). Sin ninguna definida, la consola local te admite sin contraseña pero **rechaza los inicios de sesión remotos** hasta que definas una (Ajustes → Acceso). Las claves de API se acuñan como `vela-v1-<32 hex>-<8 hex>`; el formato `sk-` se rechaza en todas partes
- Inicio de sesión único OIDC y SAML para el panel, una puerta de fortaleza JWT al arrancar, un libro de sesiones indexado por `jti`, un cerrojo CSRF, e IP del cliente derivada del **socket TCP** (infalsificable) — las cabeceras de forwarding se aceptan solo desde un proxy de bucle local

**🖥️ Panel** — `http://localhost:32060/dashboard`
- **31 salas del panel** (36 páginas en total) en **35 idiomas de interfaz**: proveedores y flujos OAuth, combos, endpoints + claves de API, uso por clave, cuota, ahorrador de tokens, consola del traductor, configuración de herramientas CLI, flota de proxies, reglas de respaldo, inyectores de prompt, skills, registros de solicitudes y la consola de ajustes — empieza en [el mapa del puerto](../docs/README.md)

---

## 🚀 Inicio rápido

### Opción A — Docker (recomendada)

```bash
docker pull ghcr.io/yumamax3/vela:1.2.4
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.4
```

La imagen es **pública** — no hace falta iniciar sesión en ningún registro — y es multiarquitectura (`linux/amd64` + `linux/arm64`). Para la carta completa — gemelo MariaDB, postura mirror, motor de respaldo, sidecar Headroom — consulta [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) y la plantilla [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opción B — CLI npm

```bash
npm install -g vela
vela
```

El lanzador instala, inicia y gestiona el servidor (el paquete npm conserva el nombre `vela`; la app en sí es la privada `vela-app`). Ver [cli/README.md](../cli/README.md).

### Opción C — Desde el código fuente

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # sirve en 32060
```

Producción: `npm run build && npm run start` (Node 22+; Bun también sirve — `npm run dev:bun` / `build:bun` / `start:bun`).

### Luego conecta una herramienta

1. Abre `http://localhost:32060/dashboard` — **no hay contraseña por defecto.** La consola local entra sin una; define una contraseña en **Ajustes → Acceso** para habilitar el acceso remoto.
2. **Providers** → conecta uno (Kiro AI es un buen comienzo gratuito)
3. **Endpoints** → acuña una clave de API
4. Apunta tu herramienta al gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

El cableado herramienta por herramienta (Claude Code, Codex, Cursor, Cline, Roo, Continue) vive en las [cartas de integración](../gitbook/content/en/) — y las skills de agentes listas para pegar están en [skills/](../skills/README.md).

---

## 📚 Documentación

Las cartas viven en [`docs/`](../docs/README.md) — empieza en el mapa del puerto. Cada documento lleva la misma voz, y cada cifra lleva su comando de re-derivación: **si una carta y un comando discrepan, gana el comando.**

| Carta | Qué cubre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 El mapa del puerto — toda la documentación, una página |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Ciclo de vida de la solicitud, motor del traductor, registro de proveedores, capa de base de datos, motor de respaldo, pacto de precios |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Rutas de instalación, carta del compose, exposición y la puerta de seguridad, actualización |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 El contrato completo de variables de entorno |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ Pacto de Almacenamiento — sqlite/mysql/mirror, la bomba mirror, respaldos, S3, recuperación |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 El listado de proveedores, las tres cifras, el modelo de ejecutores |
| [docs/API.md](../docs/API.md) | 🔌 La superficie compatible con OpenAI + la superficie REST del panel |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Síntoma → causa → solución |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ El pacto de versionado — subir, registrar y sellar juntos |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, en profundidad |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 El diario de a bordo |

Manos nuevas: el [gitbook](../gitbook/content/en/) es el recorrido para principiantes, en cinco idiomas. **Para ingenieros que trabajan en este repositorio:** [CLAUDE.md](../CLAUDE.md) — los papeles de la tripulación. **Para contribuidores del motor:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — cómo añadir un proveedor / ejecutor / traductor.

---

## 🗺️ Mapa del repositorio

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             36 pages (31 dashboard rooms) + 255 API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups
open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (43 files incl. index)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (190 files incl. index) + pricing covenant
└── rtk/             token saver hooks (fail-open)
cli/                 the launcher package (npm: vela)
docs/                the charts — start at docs/README.md
gitbook/             the beginner tour — 100 pages × 5 languages
skills/              drop-in agent skills (paste a link, done)
tests/               the vitest suite — 480 live test files
i18n/                localized READMEs (10 languages)
plans/               sealed design plans (internal, gitignored)
scripts/             changelog sync, registry generator, icon subset
```

---

## 🌍 Idiomas

Este README está traducido a otros 10 idiomas — los enlaces están en el banner de arriba. El propio panel incluye **35 idiomas de interfaz**; se cambia desde **Ajustes → General → Idioma**.

---

## 🏛️ Procedencia y licencia

Vela navega su propio rumbo desde la v0.6.0 — el gateway está licenciado bajo MIT y es plenamente propio. Consulta [LICENSE](../LICENSE).

---

<div align="center">
*Iza tu vela. El viento es gratis.* ⛵
</div>
