<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — a vela do navio" width="520"/>

  **Um endpoint compatível com OpenAI. 145 transportes upstream conectáveis. Suas assinaturas, suas chaves, seus planos gratuitos — um porto, uma vela.**

  O Vela roteia suas ferramentas de código com IA (Claude Code, Codex, Cursor, Cline, OpenCode…) por um único gateway local com tradução de formatos, fallback por combo de modelos, rotação entre múltiplas contas, rastreamento de cota, ACL por chave e um economizador de tokens RTK que corta 20–40% dos tokens de saída das ferramentas antes que eles deixem o porto.

  [![Version](https://img.shields.io/badge/version-1.2.5-blue?style=flat-square)](../CHANGELOG.md)
  [![Provedores](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Imagem](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Início rápido](#-início-rápido) · [✨ Recursos](#-principais-recursos) · [📚 Documentação](#-documentação) · [🌐 Idiomas](#-idiomas)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇺🇸 Você está lendo a tradução em português — o [README original em inglês](../README.md) é a fonte da verdade.

---

## ⛵ O que é o Vela?

O Vela é um **gateway local de roteamento de IA + painel de controle**. Você aponta todas as suas ferramentas de IA para um único endpoint — `http://localhost:32060/v1` — e o Vela decide qual provedor realmente responde: primeiro suas assinaturas pagas, depois as rotas de API econômicas, por último os planos gratuitos. Quando uma rota seca, a seguinte recebe o vento. Nenhuma mudança nas ferramentas, sem tempo de inatividade.

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

Um único processo Node serve os dois motores: o **painel + API** (`src/`, um app Next.js App Router) e o **motor de roteamento** (`open-sse/`), na porta **32060**. O estado vive em SQLite por padrão e pode ganhar um gêmeo MariaDB quando você quiser (`sqlite` → `mysql` → `mirror`). Um motor de backup selado vigia o fundo do porto, e o gateway marca cada release para que o casco sempre possa ser comprovado.

> 📌 **Nota:** O Vela navega seu próprio rumo — um gateway de IA forjado em águas abertas, com todos os sistemas próprios: armazenamento, backup, preços e categoria. O CLI instala como `vela` pelo npm. Linhagem do fork: a partir da v0.6.0 o gateway é licenciado sob MIT e plenamente próprio (veja [Origem e licença](#-origem-e-licença)).

> 🔢 **Disciplina de números** (medido em 2026-10-28, na v1.2.5). O registro de provedores reporta **três números honestos, e eles diferem**: **189** arquivos de registro no disco → **186** importados pelo índice gerado → **145** transportes de chat conectáveis (as outras 41 rotas importadas carregam transportes de mídia, busca e embeddings que, com razão, não falam chat). Três arquivos ficam no disco deliberadamente ocultos do índice (`trae`, `devin-cli`, `windsurf`). Nunca junte os três em um — nomeie qual número você quer dizer, e re-derive em vez de confiar nesta linha:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> O censo é fixado como propriedade por `tests/unit/provider-registry-census.test.js` — um arquivo que chega ao disco sem um import fica vermelho ali antes de se apagar em silêncio. Veja [docs/PROVIDERS.md](../docs/PROVIDERS.md).

---

## 🤔 Por que o Vela?

| O problema | O que o Vela faz |
|-|-|
| ❌ A cota da assinatura expira sem ser usada | ✅ Rastreamento de cota + fallback automático — use cada token antes da renovação |
| ❌ Limites de taxa param você no meio do fluxo | ✅ Rotação entre múltiplas contas + fallback por combo de modelos, zero tempo de inatividade |
| ❌ A saída das ferramentas queima tokens (diffs, grep, ls…) | ✅ O **economizador de tokens RTK** comprime o conteúdo de `tool_result` no lugar — 20–40% de economia |
| ❌ Pagar $20–50/mês por provedor | ✅ Um gateway único para rotas de assinatura + econômicas + gratuitas |
| ❌ Cada ferramenta precisa de sua própria configuração | ✅ Um endpoint compatível com OpenAI, todas as ferramentas falam essa língua |
| ❌ Um provedor cai e seu fluxo cai junto | ✅ Disjuntor + limites de falha por provedor + janelas de resfriamento |

---

## ✨ Principais recursos

**🧭 Roteamento e tradução**
- Um endpoint compatível com OpenAI: `/v1/chat/completions`, `/v1/messages` (nativo do Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (gerações, edições, extensões), `/v1/responses` (+`/compact`), `/v1beta/*`, busca web, fetch e scrape
- A tradução de formatos pivota pelo OpenAI como formato intermediário — rotas diretas registradas para pares frágeis (blocos de raciocínio, ids de ferramentas)
- **145 provedores conectáveis** entre rotas de assinatura, pagamento por uso, gratuitas, locais e de mídia — [a lista completa](../docs/PROVIDERS.md)
- O endereçamento de modelos é `provider/model` (`kr/claude-sonnet-4.5`) — o prefixo nomeia a rota

**🪂 Resiliência**
- Fallback por combo de modelos: defina um combo e o Vela percorre a lista até um responder
- Fallback entre múltiplas contas por provedor, rotação round-robin
- Disjuntor por pool — e o disjuntor **sobrevive a um reinício**: janelas abertas persistem pelo armazenamento vinculado, prazos são limitados a um teto, e um disjuntor restaurado se rearma com uma única falha, igual à lei em processo
- Limites de falha por provedor com janelas de resfriamento (`VELA_PROVIDER_FAILURE_*`), gerenciamento de credenciais OAuth + chave de API com renovação automática de tokens em segundo plano

**💰 Inteligência de custos — o Pacto de Preços**
- Tabela estática de preços (entrada / saída / cache / raciocínio / criação de cache, $/1M tokens) com uma cadeia de resolução em seis etapas — overrides por provedor, correspondência exata, herança de modelo gratuito, remoção de vendor, fallback por glob
- Editor de preços no painel + sincronização com models.dev — cada requisição recebe um custo estimado honesto
- Detecção de plano gratuito: modelos gratuitos herdam a tarifa do irmão pago para que a economia fique visível
- O custo é calculado no **momento da escrita** e congelado — sem preenchimento retroativo, sem recálculo após editar tarifas

**🐚 Economizador de tokens RTK**
- Hooks de pré-tradução comprimem o conteúdo de `tool_result` antes que a requisição saia — fail-open por definição, nunca tocam em rastros `is_error`
- Injetores de prompt definidos pelo operador (prefixar/acrescentar), em camadas depois dos economizadores embutidos
- Sidecar opcional [Headroom](https://github.com/chopratejas/headroom) para compressão mais profunda

**🗝️ Pacto de Armazenamento**
- Três posturas, uma variável de ambiente: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite como porto padrão; MariaDB como porto completo; ou **mirror** — o SQLite atende enquanto cada escrita é bombeada para o gêmeo MariaDB por um outbox, guardada por uma varredura de divergência
- Cadeia de drivers: `better-sqlite3` → `node:sqlite` (instalação zero em Node ≥ 22.5) → `sql.js` em JS puro; `VELA_DB_DRIVER` fixa um, e a falha é barulhenta
- **23 migrações** (`SCHEMA_VERSION = 23`) — uma sincronização declarativa de `TABLES` mantém honestos os dois portos e o gêmeo — veja [docs/STORAGE.md](../docs/STORAGE.md)
- Motor de backup selado: artefatos AES-256-GCM, níveis de retenção, simulação de restauração, perna opcional de S3 fora do local

**🛡️ Segurança**
- ACL por chave — quatro camadas: tipos, provedores, combos, modelos (listas de permitidos de três estados)
- Portões de orçamento: tetos diários, tetos de gasto, limites de taxa por chave
- **Sem senha padrão.** A antiga `123456` foi aposentada (v0.9.41). Sem nenhuma definida, o console local admite você sem senha mas **recusa logins remotos** até que você defina uma (Configurações → Acesso). As chaves de API são cunhadas como `vela-v1-<32 hex>-<8 hex>`; o formato `sk-` é rejeitado em todo lugar
- Login único OIDC e SAML para o painel, um portão de força JWT na inicialização, um livro de sessões indexado por `jti`, um ferrolho CSRF, e IP do cliente derivado do **socket TCP** (infalsificável) — cabeçalhos de encaminhamento aceitos apenas de um proxy de loop local

**🖥️ Painel** — `http://localhost:32060/dashboard`
- **31 salas do painel** (36 páginas no total) em **35 idiomas de interface**: provedores e fluxos OAuth, combos, endpoints + chaves de API, uso por chave, cota, economizador de tokens, console do tradutor, configuração de ferramentas CLI, frota de proxies, regras de fallback, injetores de prompt, skills, logs de requisições e o console de configurações — comece em [o mapa do porto](../docs/README.md)

---

## 🚀 Início rápido

### Opção A — Docker (recomendada)

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.5
```

A imagem é **pública** — não é preciso login em nenhum registro — e é multi-arquitetura (`linux/amd64` + `linux/arm64`). Para a carta completa — gêmeo MariaDB, postura mirror, motor de backup, sidecar Headroom — veja [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) e o modelo [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opção B — CLI npm

```bash
npm install -g vela
vela
```

O launcher instala, inicia e gerencia o servidor (o pacote npm mantém o nome `vela`; o app em si é o privado `vela-app`). Veja [cli/README.md](../cli/README.md).

### Opção C — Do código-fonte

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # serves on 32060
```

Produção: `npm run build && npm run start` (Node 22+; Bun também funciona — `npm run dev:bun` / `build:bun` / `start:bun`).

### Depois conecte uma ferramenta

1. Abra `http://localhost:32060/dashboard` — **não há senha padrão.** O console local entra sem uma; defina uma senha em **Configurações → Acesso** para habilitar o acesso remoto.
2. **Providers** → conecte um (Kiro AI é um bom começo gratuito)
3. **Endpoints** → cunhe uma chave de API
4. Aponte sua ferramenta para o gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

A ligação ferramenta por ferramenta (Claude Code, Codex, Cursor, Cline, Roo, Continue) vive nas [cartas de integração](../gitbook/content/en/) — e as skills de agentes prontas para colar estão em [skills/](../skills/README.md).

---

## 📚 Documentação

As cartas vivem em [`docs/`](../docs/README.md) — comece pelo mapa do porto. Cada documento carrega a mesma voz, e cada número carrega seu comando de re-derivação: **se uma carta e um comando discordarem, o comando vence.**

| Carta | O que cobre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 O mapa do porto — toda a documentação, uma página |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Ciclo de vida da requisição, motor do tradutor, registro de provedores, camada de banco de dados, motor de backup, pacto de preços |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Caminhos de instalação, carta do compose, exposição e o portão de segurança, atualização |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 O contrato completo de variáveis de ambiente |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ Pacto de Armazenamento — sqlite/mysql/mirror, a bomba mirror, backups, S3, recuperação |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 A lista de provedores, os três números, o modelo de executores |
| [docs/API.md](../docs/API.md) | 🔌 A superfície compatível com OpenAI + a superfície REST do painel |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Sintoma → causa → solução |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ O pacto de versionamento — subir, registrar e selar juntos |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, a fundo |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 O diário de bordo |

Mãos novas: o [gitbook](../gitbook/content/en/) é o tour para iniciantes, em cinco idiomas. **Para engenheiros trabalhando neste repositório:** [CLAUDE.md](../CLAUDE.md) — os documentos da tripulação. **Para contribuidores do motor:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — como adicionar provedor / executor / tradutor.

---

## 🗺️ Mapa do repositório

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
docs/               the charts — start at docs/README.md
gitbook/            the beginner tour — 100 pages × 5 languages
skills/             drop-in agent skills (paste a link, done)
tests/              the vitest suite — 480 live test files
i18n/               localized READMEs (10 languages)
plans/               sealed design plans (internal, gitignored)
scripts/             changelog sync, registry generator, icon subset
```

---

## 🌍 Idiomas

Este README está traduzido para mais 10 idiomas — os links estão no banner acima. O próprio painel vem com **35 idiomas de interface**; a troca é feita em **Configurações → Geral → Idioma**.

---

## 🏛️ Origem e licença

O Vela navega seu próprio rumo a partir da v0.6.0 — o gateway é licenciado sob MIT e plenamente próprio. Veja [LICENSE](../LICENSE).

---

<div align="center">
*Içe sua vela. O vento é livre.* ⛵
</div>
