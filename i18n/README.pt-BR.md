<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — a vela do navio" width="520"/>

  **Um endpoint compatível com OpenAI. Mais de 40 provedores upstream. Suas assinaturas, suas chaves, seus planos gratuitos — um porto, uma vela.**

  O Vela roteia suas ferramentas de código com IA (Claude Code, Codex, Cursor, Cline, OpenCode…) por um único gateway local com tradução de formatos, fallback por combo de modelos, rotação entre múltiplas contas, rastreamento de cota e um economizador de tokens RTK que corta 20–40% dos tokens de saída das ferramentas antes que eles deixem o porto.

  [![Versão](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Provedores](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Imagem](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![Licença](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Início rápido](#-inicio-rápido) · [✨ Recursos](#-principais-recursos) · [📚 Docs](#-documentação) · [🌐 Idiomas](#-idiomas)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
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
│                  Vela — the gateway                  │
│  RTK token saver · format translation · quota track  │
│  combo fallback · multi-account · OAuth refresh      │
└──────┬──────────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…

       Result: every subscription token spent, every rate limit routed around.
```

Sob o capô: um servidor Next.js (painel + API) na porta **32060**, um motor de roteamento independente de provedores (`open-sse/`) e um banco SQLite que pode ganhar um gêmeo MariaDB quando você quiser (sqlite → mysql → mirror).

> 📌 **Nota:** O Vela navega seu próprio rumo — um gateway de IA forjado em águas abertas, com todos os sistemas próprios: armazenamento, backup, preços e categorias. O CLI instala como `vela` pelo npm.

---

## 🤔 Por que o Vela?

| O problema | O que o Vela faz |
|-|-|
| ❌ A cota da assinatura expira sem ser usada | ✅ Rastreamento de cota + fallback automático — use cada token antes da renovação |
| ❌ Limites de taxa param você no meio do fluxo | ✅ Rotação entre múltiplas contas + fallback por combo de modelos, zero tempo de inatividade |
| ❌ A saída das ferramentas queima tokens (diffs, grep, ls…) | ✅ O **economizador de tokens RTK** comprime o conteúdo de `tool_result` no lugar — 20–40% de economia |
| ❌ Pagar $20–50/mês por provedor | ✅ Um gateway único para rotas de assinatura + econômicas + gratuitas |
| ❌ Cada ferramenta precisa de sua própria configuração | ✅ Um endpoint compatível com OpenAI, todas as ferramentas falam essa língua |

---

## ✨ Principais recursos

**🧭 Roteamento e tradução**
- Um endpoint compatível com OpenAI: `/v1/chat/completions`, `/v1/messages` (nativo do Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, busca e fetch na web
- A tradução de formatos passa pelo OpenAI como formato intermediário — rotas diretas registradas para pares frágeis (blocos de raciocínio, ids de ferramentas)
- **129 provedores** registrados: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama e dezenas de outros — [lista completa](../docs/PROVIDERS.md)

**🪂 Resiliência**
- Fallback por combo de modelos: defina um combo e o Vela percorre a lista até um responder
- Fallback entre múltiplas contas por provedor, rotação round-robin
- Gerenciamento de credenciais OAuth + chave de API com renovação automática de token

**💰 Inteligência de custos — o Pacto de Preços**
- Tabela estática de preços (entrada / saída / cache / raciocínio / criação de cache, $/1M tokens) com uma cadeia de resolução em seis etapas — overrides por provedor, correspondência exata, herança de modelo gratuito, remoção de vendor, fallback por glob
- Editor de preços no painel + sincronização com models.dev — cada requisição recebe um custo estimado honesto
- Detecção de plano gratuito: modelos gratuitos herdam a tarifa do irmão pago para que a economia fique visível

**🐚 Economizador de tokens RTK**
- Hooks de pré-tradução comprimem o conteúdo de `tool_result` antes que a requisição saia — fail-open por definição, nunca tocam em rastros `is_error`
- Sidecar opcional [Headroom](https://github.com/chopratejas/headroom) para compressão mais profunda

**🗝️ Pacto de Armazenamento**
- Três posturas, uma variável de ambiente: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite como porto padrão; MariaDB como porto completo; ou **mirror** — o SQLite atende enquanto cada escrita é bombeada para o gêmeo MariaDB, guardada por uma varredura de divergência
- Motor de backup selado: artefatos AES-256-GCM, níveis de retenção, simulação + restauração, perna opcional de S3 fora do local

**🖥️ Painel** — `http://localhost:32060/dashboard`
- Provedores e fluxos OAuth, combos, endpoints + chaves de API, uso por chave, cota, economizador de tokens, console do tradutor, páginas de configuração de ferramentas CLI, configurações de preços — em mais de 34 idiomas de interface

---

## 🚀 Início rápido

### Opção A — Docker (recomendada)

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

Para a carta completa — gêmeo MariaDB, postura mirror, motor de backup, sidecar Headroom — veja [DOCKER.md](../DOCKER.md) e o modelo [`docker-compose.example.yml`](../docker-compose.example.yml).

### Opção B — CLI npm

```bash
npm install -g vela
vela
```

O CLI instala, inicia e gerencia o servidor (o pacote do launcher mantém o nome `vela` no npm).

### Opção C — Do código-fonte

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Produção: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Depois conecte uma ferramenta

1. Abra `http://localhost:32060/dashboard` (senha padrão `123456` — mude-a)
2. **Providers** → conecte um (Kiro AI é um bom começo gratuito)
3. **Endpoints** → copie uma chave de API
4. Aponte sua ferramenta para o gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Documentação

As cartas vivem em [`docs/`](../docs/README.md) — o mapa completo do porto.

| Carta | O que cobre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 O mapa do porto — toda a documentação, uma página |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Ciclo de vida da requisição, motor do tradutor, registro de provedores, camada de banco de dados |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Caminhos de instalação, carta do compose, posturas de armazenamento, atualização |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 O contrato completo de variáveis de ambiente |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Pacto de Armazenamento — sqlite/mysql/mirror, backups, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 A lista completa dos 129 provedores |
| [docs/API.md](../docs/API.md) | 🔌 A superfície compatível com OpenAI + APIs do painel |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Quando o vento para |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ O pacto de versionamento |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, a fundo |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 O diário de bordo |

**Para engenheiros trabalhando neste repositório:** [CLAUDE.md](../CLAUDE.md) — os documentos da tripulação.
**Para contribuidores do motor:** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — como adicionar provedor / executor / tradutor.

---

## 🗺️ Mapa do repositório

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

cli/                 the launcher package (npm: vela)
docs/                the charts — start at docs/README.md
plans/               sealed design plans (Storage Covenant, Pricing Covenant…)
tests/               vitest suite (independent ESM package)
i18n/                localized READMEs (10 languages)
```

---

## 🌍 Idiomas

Este README está traduzido para mais 10 idiomas — os links estão no banner acima. O próprio painel vem com mais de 34 idiomas de interface; a troca é feita na página de perfil do painel.

---

## 🏛️ Origem e licença

O Vela navega seu próprio rumo a partir da v0.6.0 — o gateway é licenciado sob MIT e plenamente próprio. Veja [LICENSE](../LICENSE).

---

<div align="center">

*Içe sua vela. O vento é livre.* ⛵

</div>
