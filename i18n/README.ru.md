<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — парус корабля" width="520"/>

  **Одна OpenAI-совместимая конечная точка. 40+ вышестоящих провайдеров. Ваши подписки, ваши ключи, ваши бесплатные тарифы — одна гавань, один парус.**

  Vela направляет ваши AI-инструменты для разработки (Claude Code, Codex, Cursor, Cline, OpenCode…) через единый локальный шлюз с трансляцией форматов, резервированием по комбинациям моделей, ротацией между несколькими аккаунтами, отслеживанием квот и RTK-экономителем токенов, который срезает 20–40% токенов в выводах инструментов ещё до того, как они покинут гавань.

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/9router?style=flat-square&label=cli%20%229router%22)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Быстрый старт](#-быстрый-старт) · [✨ Возможности](#-ключевые-возможности) · [📚 Документация](#-документация) · [🌐 Языки](#-языки)

  🇺🇸 [English](./README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇬🇧 Это перевод на русский язык. Английский оригинал находится здесь: [README.md](../README.md)

---

## ⛵ Что такое Vela?

Vela — это **локальный шлюз маршрутизации AI + панель управления**. Вы направляете все свои AI-инструменты на одну конечную точку — `http://localhost:32060/v1` — а Vela решает, какой провайдер фактически ответит: сначала ваши платные подписки, затем дешёвые API-направления, в конце бесплатные тарифы. Когда одно направление иссякает, следующее ловит ветер. Никаких изменений на стороне инструментов, никакого простоя.

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

Под капотом: сервер Next.js (панель управления + API) на порту **32060**, независимый от провайдеров движок маршрутизации (`open-sse/`) и база данных SQLite, которая при желании может обзавестись близнецом MariaDB (sqlite → mysql → mirror).

> 📌 **Примечание:** Vela — это форк [9Router](https://github.com/decolua/9router), переименованный и перекованный — системы хранения, резервного копирования, ценообразования и категорий являются собственной разработкой Vela. CLI-лаунчер сохраняет имя `9router` в npm ради совместимости установки.

---

## 🤔 Зачем Vela?

| Проблема | Что делает Vela |
|-|-|
| ❌ Квота подписки истекает неиспользованной | ✅ Отслеживание квоты + автоматическое резервирование — потратьте каждый токен до сброса |
| ❌ Ограничения скорости останавливают вас посреди работы | ✅ Ротация между несколькими аккаунтами + резервирование по комбинациям моделей, нулевой простой |
| ❌ Выводы инструментов сжигают токены (diff'ы, grep, ls…) | ✅ **RTK-экономитель токенов** сжимает содержимое `tool_result` на месте — экономия 20–40% |
| ❌ Оплата $20–50/мес за каждого провайдера | ✅ Один шлюз поверх подписок + дешёвых + бесплатных направлений |
| ❌ Каждому инструменту нужна своя конфигурация | ✅ Одна OpenAI-совместимая конечная точка — каждый инструмент говорит на ней |

---

## ✨ Ключевые возможности

**🧭 Маршрутизация и трансляция**
- Одна OpenAI-совместимая конечная точка: `/v1/chat/completions`, `/v1/messages` (нативный Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, веб-поиск и получение страниц
- Трансляция форматов использует OpenAI как промежуточный формат — для хрупких пар зарегистрированы прямые маршруты (блоки thinking, идентификаторы инструментов)
- Зарегистрировано **129 провайдеров**: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama и десятки других — [полный список](../docs/PROVIDERS.md)

**🪂 Устойчивость**
- Резервирование по комбинациям моделей: задайте комбинацию, и Vela пройдёт по списку, пока кто-нибудь не ответит
- Резервирование между несколькими аккаунтами на каждого провайдера, ротация по кругу
- Управление учётными данными OAuth + API-ключей с автоматическим обновлением токенов

**💰 Интеллектуальное ценообразование — Завет ценообразования**
- Статическая таблица цен (ввод / вывод / кэшированные / рассуждение / создание кэша, $/1M токенов) с шестишаговой цепочкой разрешения — переопределения провайдера, точное совпадение, наследование бесплатных моделей, отсечение вендора, глоб-резервирование
- Редактор цен в панели управления + синхронизация с models.dev — каждый запрос получает честную оценочную стоимость
- Обнаружение бесплатных тарифов: бесплатные модели наследуют тариф своих платных собратьев, чтобы экономия была видна

**🐚 RTK-экономитель токенов**
- Хуки пред-трансляции сжимают содержимое `tool_result` до того, как запрос покинет гавань — по задумке отказоустойчивы (fail-open), никогда не трогают трассировки `is_error`
- Необязательный сайдкар [Headroom](https://github.com/chopratejas/headroom) для более глубокого сжатия

**🗝️ Завет хранения**
- Три режима, одна переменная окружения: `VELA_DB_MODE=sqlite|mysql|mirror`
- По умолчанию гавань SQLite; MariaDB как полноценная гавань; или **mirror** — SQLite обслуживает запросы, пока каждая запись перекачивается в близнеца MariaDB под защитой проверки расхождений
- Запечатанный движок резервного копирования: артефакты AES-256-GCM, уровни хранения, тренировочные восстановления + восстановление, необязательное внешнее плечо S3

**🖥️ Панель управления** — `http://localhost:32060/dashboard`
- Провайдеры и OAuth-потоки, комбинации, конечные точки + API-ключи, использование по каждому ключу, квота, экономитель токенов, консоль транслятора, страницы настройки CLI-инструментов, настройки ценообразования — на 34+ языках интерфейса

---

## 🚀 Быстрый старт

### Вариант A — Docker (рекомендуется)

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

Полная карта — близнец MariaDB, режим mirror, движок резервного копирования, сайдкар Headroom — смотрите в [DOCKER.md](../DOCKER.md) и шаблоне [`docker-compose.example.yml`](../docker-compose.example.yml).

### Вариант B — npm CLI

```bash
npm install -g 9router
9router
```

CLI устанавливает, запускает и управляет сервером (пакет-лаунчер сохраняет имя `9router` в npm).

### Вариант C — Из исходников

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Продакшн: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Затем подключите инструмент

1. Откройте `http://localhost:32060/dashboard` (пароль по умолчанию `123456` — смените его)
2. **Providers** → подключите одного (Kiro AI — хорошее бесплатное начало)
3. **Endpoints** → скопируйте API-ключ
4. Направьте ваш инструмент на шлюз:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Документация

Карты живут в [`docs/`](../docs/README.md) — полная карта гавани.

| Карта | Что покрывает |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 Карта гавани — вся документация на одной странице |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Жизненный цикл запроса, движок транслятора, реестр провайдеров, слой БД |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Пути установки, compose-схема, режимы хранения, обновление |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Полный контракт переменных окружения |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Завет хранения — sqlite/mysql/mirror, резервные копии, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 Полный список из 129 провайдеров |
| [docs/API.md](../docs/API.md) | 🔌 OpenAI-совместимая поверхность + API панели управления |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Когда ветер стихает |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Завет версионирования |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, подробно |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Судовой журнал |

**Для инженеров, работающих в этом репозитории:** [CLAUDE.md](../CLAUDE.md) — документы команды.
**Для контрибьюторов движка:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — как добавить провайдера / исполнитель / транслятор.

---

## 🗺️ Карта репозитория

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

## 🌍 Языки

Этот README переведён ещё на 10 языков — ссылки в баннере выше. Сама панель управления поставляется с 34+ языками интерфейса; переключение — на странице профиля панели.

---

## 🏛️ Происхождение и лицензия

Vela ответвилась от [decolua/9Router](https://github.com/decolua/9router) (MIT) и идёт собственным курсом начиная с v0.6.0. Благодарность апстриму сохранена там, где она заслужена; системы хранения, резервного копирования, ценообразования и категорий — собственные кузницы Vela. См. [LICENSE](../LICENSE).

---

<div align="center">

*Поднимайте парус. Ветер свободен.* ⛵

</div>
