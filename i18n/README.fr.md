<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — la voile du navire" width="520"/>

  **Un endpoint compatible OpenAI. Plus de 40 fournisseurs upstream. Vos abonnements, vos clés, vos plans gratuits — un port, une voile.**

  Vela route vos outils de code IA (Claude Code, Codex, Cursor, Cline, OpenCode…) à travers une unique gateway locale avec traduction de formats, repli par combo de modèles, rotation entre plusieurs comptes, suivi de quota et un économiseur de tokens RTK qui retranche 20 à 40 % des tokens de sortie d'outils avant qu'ils ne quittent le port.

  [![Version](https://img.shields.io/badge/version-0.6.70-blue?style=flat-square)](../CHANGELOG.md)
  [![Fournisseurs](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/9router?style=flat-square&label=cli%20%229router%22)](https://www.npmjs.com/package/9router)
  [![Licence](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Démarrage rapide](#-démarrage-rapide) · [✨ Fonctionnalités](#-fonctionnalités-clés) · [📚 Docs](#-documentation) · [🌐 Langues](#-langues)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](../README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
</div>

> 🇺🇸 Vous lisez la traduction française — le [README original en anglais](../README.md) fait foi.

---

## ⛵ Qu'est-ce que Vela ?

Vela est une **gateway locale de routage IA + tableau de bord**. Vous pointez tous vos outils d'IA vers un unique endpoint — `http://localhost:32060/v1` — et Vela décide quel fournisseur répond réellement : d'abord vos abonnements payants, ensuite les routes API économiques, enfin les plans gratuits. Quand une route s'assèche, la suivante prend le vent. Aucun changement côté outils, zéro temps d'arrêt.

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

Sous le capot : un serveur Next.js (tableau de bord + API) sur le port **32060**, un moteur de routage indépendant des fournisseurs (`open-sse/`) et une base SQLite qui peut se doter d'un jumeau MariaDB quand vous le souhaitez (sqlite → mysql → mirror).

> 📌 **Note :** Vela est un fork de [9Router](https://github.com/decolua/9router), renommé et reforjé — les systèmes de stockage, de sauvegarde, de tarification et de catégories sont propres à Vela. Le lanceur CLI conserve le nom `9router` sur npm pour la compatibilité d'installation.

---

## 🤔 Pourquoi Vela ?

| Le problème | Ce que fait Vela |
|-|-|
| ❌ Le quota de l'abonnement expire sans être utilisé | ✅ Suivi de quota + repli automatique — dépensez chaque token avant la réinitialisation |
| ❌ Les limites de débit vous arrêtent en plein élan | ✅ Rotation entre plusieurs comptes + repli par combo de modèles, zéro temps d'arrêt |
| ❌ Les sorties d'outils brûlent des tokens (diffs, grep, ls…) | ✅ L'**économiseur de tokens RTK** compresse le contenu de `tool_result` sur place — 20 à 40 % d'économie |
| ❌ Payer 20 à 50 $/mois par fournisseur | ✅ Une gateway unique pour les routes abonnement + économiques + gratuites |
| ❌ Chaque outil a besoin de sa propre configuration | ✅ Un endpoint compatible OpenAI, tous les outils parlent ce langage |

---

## ✨ Fonctionnalités clés

**🧭 Routage et traduction**
- Un endpoint compatible OpenAI : `/v1/chat/completions`, `/v1/messages` (natif Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, recherche et récupération web
- La traduction de formats passe par OpenAI comme format pivot — routes directes enregistrées pour les paires fragiles (blocs de raisonnement, ids d'outils)
- **129 fournisseurs** enregistrés : OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama et des dizaines d'autres — [liste complète](../docs/PROVIDERS.md)

**🪂 Résilience**
- Repli par combo de modèles : définissez un combo, Vela parcourt la liste jusqu'à ce qu'un réponde
- Repli entre plusieurs comptes par fournisseur, rotation round-robin
- Gestion des identifiants OAuth + clé API avec renouvellement automatique des tokens

**💰 Intelligence des coûts — le Pacte de Tarification**
- Table statique des prix (entrée / sortie / cache / raisonnement / création de cache, $/1M tokens) avec une chaîne de résolution en six étapes — overrides par fournisseur, correspondance exacte, héritage du modèle gratuit, retrait du vendor, repli par glob
- Éditeur de prix dans le tableau de bord + synchronisation models.dev — chaque requête reçoit un coût estimé honnête
- Détection du plan gratuit : les modèles gratuits héritent du tarif de leur frère payant pour que les économies soient visibles

**🐚 Économiseur de tokens RTK**
- Des hooks de pré-traduction compriment le contenu de `tool_result` avant que la requête ne parte — fail-open par conception, ils ne touchent jamais aux traces `is_error`
- Sidecar optionnel [Headroom](https://github.com/chopratejas/headroom) pour une compression plus profonde

**🗝️ Pacte de Stockage**
- Trois postures, une variable d'environnement : `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite comme port par défaut ; MariaDB comme port complet ; ou **mirror** — SQLite sert pendant que chaque écriture est pompée vers le jumeau MariaDB, sous la garde d'une vérification de divergence
- Moteur de sauvegarde scellé : artefacts AES-256-GCM, niveaux de rétention, exercice + restauration, branche optionnelle S3 hors site

**🖥️ Tableau de bord** — `http://localhost:32060/dashboard`
- Fournisseurs et flux OAuth, combos, endpoints + clés API, usage par clé, quota, économiseur de tokens, console du traducteur, pages de configuration des outils CLI, réglages de tarification — dans plus de 34 langues d'interface

---

## 🚀 Démarrage rapide

### Option A — Docker (recommandé)

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

Pour la carte complète — jumeau MariaDB, posture mirror, moteur de sauvegarde, sidecar Headroom — consultez [DOCKER.md](../DOCKER.md) et le modèle [`docker-compose.example.yml`](../docker-compose.example.yml).

### Option B — CLI npm

```bash
npm install -g 9router
9router
```

Le CLI installe, démarre et gère le serveur (le paquet lanceur conserve le nom `9router` sur npm).

### Option C — Depuis les sources

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Production : `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Puis connectez un outil

1. Ouvrez `http://localhost:32060/dashboard` (mot de passe par défaut `123456` — changez-le)
2. **Providers** → connectez-en un (Kiro AI est un bon départ gratuit)
3. **Endpoints** → copiez une clé API
4. Pointez votre outil vers la gateway :

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Documentation

Les cartes vivent dans [`docs/`](../docs/README.md) — la carte complète du port.

| Carte | Ce qu'elle couvre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 La carte du port — toute la documentation, une page |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Cycle de vie de la requête, moteur du traducteur, registre des fournisseurs, couche base de données |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Chemins d'installation, carte du compose, postures de stockage, mise à niveau |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Le contrat complet des variables d'environnement |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗝️ Pacte de Stockage — sqlite/mysql/mirror, sauvegardes, S3 |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 La liste complète des 129 fournisseurs |
| [docs/API.md](../docs/API.md) | 🔌 La surface compatible OpenAI + APIs du tableau de bord |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Quand le vent tombe |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Le pacte de versionnage |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, en profondeur |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Le journal de bord |

**Pour les ingénieurs qui travaillent dans ce dépôt :** [CLAUDE.md](../CLAUDE.md) — les papiers de l'équipage.
**Pour les contributeurs du moteur :** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — comment ajouter fournisseur / exécuteur / traducteur.

---

## 🗺️ Carte du dépôt

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

## 🌍 Langues

Ce README est traduit dans 10 autres langues — les liens sont dans la bannière ci-dessus. Le tableau de bord lui-même embarque plus de 34 langues d'interface ; on en change depuis la page de profil du tableau de bord.

---

## 🏛️ Provenance et licence

Vela est issu d'un fork de [decolua/9Router](https://github.com/decolua/9router) (MIT) et trace sa propre route depuis la v0.6.0. Le crédit à l'upstream est conservé là où il est dû ; les systèmes de stockage, de sauvegarde, de tarification et de catégories sont les forges propres à Vela. Voir [LICENSE](../LICENSE).

---

<div align="center">

*Hissez votre voile. Le vent est libre.* ⛵

</div>
