<div align="center">
  <img src="../public/vela-wordmark.svg" alt="Vela — la voile du navire" width="520"/>

  **Un endpoint compatible OpenAI. 145 transports upstream joignables. Vos abonnements, vos clés, vos plans gratuits — un port, une voile.**

  Vela route vos outils de code IA (Claude Code, Codex, Cursor, Cline, OpenCode…) à travers une unique gateway locale avec traduction de formats, repli par combo de modèles, rotation entre plusieurs comptes, suivi de quota, ACL par clé et un économiseur de tokens RTK qui retranche 20 à 40 % des tokens de sortie d'outils avant qu'ils ne quittent le port.

  [![Version](https://img.shields.io/badge/version-1.2.5-blue?style=flat-square)](../CHANGELOG.md)
  [![Fournisseurs](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](../docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![Licence](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](../LICENSE)

  [🚀 Démarrage rapide](#-démarrage-rapide) · [✨ Fonctionnalités](#-fonctionnalités-clés) · [📚 Documentation](#-documentation) · [🌐 Langues](#-langues)

  🇺🇸 [English](../README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./README.id-ID.md) · 🇯🇵 [日本語](./README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./README.vi.md) · 🇧🇷 [Português](./README.pt-BR.md) · 🇪🇸 [Español](./README.es.md) · 🇫🇷 [Français](./README.fr.md) · 🇷🇺 [Русский](./README.ru.md) · 🇹🇭 [ไทย](./README.th.md) · 🇮🇷 [فارسی](./README.fa_IR.md)
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
│                  Vela — the gateway                 │
│  RTK token saver · format translation · quota track │
│  combo fallback · multi-account · OAuth refresh     │
└──────────┬──────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…
       Result: every subscription token spent, every rate limit routed around.
```

Un seul processus Node sert les deux moteurs : le **tableau de bord + API** (`src/`, une application Next.js App Router) et le **moteur de routage** (`open-sse/`), sur le port **32060**. L'état vit dans SQLite par défaut et peut se doter d'un jumeau MariaDB quand vous le souhaitez (`sqlite` → `mysql` → `mirror`). Un moteur de sauvegarde scellé veille sur le fond du port, et la passerelle marque chaque version pour que la coque puisse toujours être prouvée.

> 📌 **Note :** Vela trace sa propre route — une passerelle d'IA forgée en eaux libres, dont chaque système lui est propre : stockage, sauvegarde, tarification et catégories. Le CLI s'installe sous le nom `vela` depuis npm. Lignée du fork : à partir de la v0.6.0, la passerelle est sous licence MIT et pleinement la sienne (voir [Provenance et licence](#-provenance-et-licence)).

> 🔢 **Discipline des chiffres** (mesuré le 2026-10-28, en v1.2.5). Le registre des fournisseurs rapporte **trois chiffres honnêtes, et ils diffèrent** : **189** fichiers de registre sur le disque → **186** importés par l'index généré → **145** transports de chat joignables (les 41 autres routes importées portent des transports média, recherche et embeddings qui, à juste titre, ne parlent pas chat). Trois fichiers restent sur le disque délibérément cachés de l'index (`trae`, `devin-cli`, `windsurf`). Ne fusionnez jamais les trois en un — nommez le chiffre que vous voulez dire, et re-dérivez-le plutôt que de vous fier à cette ligne :
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> Le recensement est épinglé comme propriété par `tests/unit/provider-registry-census.test.js` — un fichier qui arrive sur le disque sans import rougit là avant de s'éteindre en silence. Voir [docs/PROVIDERS.md](../docs/PROVIDERS.md).

---

## 🤔 Pourquoi Vela ?

| Le problème | Ce que fait Vela |
|-|-|
| ❌ Le quota de l'abonnement expire sans être utilisé | ✅ Suivi de quota + repli automatique — dépensez chaque token avant la réinitialisation |
| ❌ Les limites de débit vous arrêtent en plein élan | ✅ Rotation entre plusieurs comptes + repli par combo de modèles, zéro temps d'arrêt |
| ❌ Les sorties d'outils brûlent des tokens (diffs, grep, ls…) | ✅ L'**économiseur de tokens RTK** compresse le contenu de `tool_result` sur place — 20 à 40 % d'économie |
| ❌ Payer 20 à 50 $/mois par fournisseur | ✅ Une gateway unique pour les routes abonnement + économiques + gratuites |
| ❌ Chaque outil a besoin de sa propre configuration | ✅ Un endpoint compatible OpenAI, tous les outils parlent ce langage |
| ❌ Un fournisseur tombe et votre flux tombe avec lui | ✅ Coupe-circuit + seuils d'échec par fournisseur + fenêtres de refroidissement |

---

## ✨ Fonctionnalités clés

**🧭 Routage et traduction**
- Un endpoint compatible OpenAI : `/v1/chat/completions`, `/v1/messages` (natif Claude), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (générations, éditions, extensions), `/v1/responses` (+`/compact`), `/v1beta/*`, recherche web, fetch et scrape
- La traduction de formats passe par OpenAI comme format pivot — routes directes enregistrées pour les paires fragiles (blocs de raisonnement, ids d'outils)
- **145 fournisseurs joignables** sur les routes abonnement, paiement à l'usage, gratuites, locales et média — [la liste complète](../docs/PROVIDERS.md)
- L'adressage des modèles est `provider/model` (`kr/claude-sonnet-4.5`) — le préfixe nomme la route

**🪂 Résilience**
- Repli par combo de modèles : définissez un combo, Vela parcourt la liste jusqu'à ce qu'un réponde
- Repli entre plusieurs comptes par fournisseur, rotation round-robin
- Coupe-circuit par pool — et le coupe-circuit **survit à un redémarrage** : les fenêtres ouvertes persistent à travers le store lié, les délais sont plafonnés, et un coupe-circuit restauré se réarme sur un seul échec, à l'image de la loi en processus
- Seuils d'échec par fournisseur avec fenêtres de refroidissement (`VELA_PROVIDER_FAILURE_*`), gestion des identifiants OAuth + clé API avec renouvellement automatique des tokens en arrière-plan

**💰 Intelligence des coûts — le Pacte de Tarification**
- Table statique des prix (entrée / sortie / cache / raisonnement / création de cache, $/1M tokens) avec une chaîne de résolution en six étapes — overrides par fournisseur, correspondance exacte, héritage du modèle gratuit, retrait du vendor, repli par glob
- Éditeur de prix dans le tableau de bord + synchronisation models.dev — chaque requête reçoit un coût estimé honnête
- Détection du plan gratuit : les modèles gratuits héritent du tarif de leur frère payant pour que les économies soient visibles
- Le coût est calculé **à l'écriture** et figé — pas de remontée rétroactive, pas de recalcul après édition des tarifs

**🐚 Économiseur de tokens RTK**
- Des hooks de pré-traduction compriment le contenu de `tool_result` avant que la requête ne parte — fail-open par conception, ils ne touchent jamais aux traces `is_error`
- Des injecteurs de prompt définis par l'opérateur (ajout en tête ou en queue), en couches après les économiseurs intégrés
- Sidecar optionnel [Headroom](https://github.com/chopratejas/headroom) pour une compression plus profonde

**🗝️ Pacte de Stockage**
- Trois postures, une variable d'environnement : `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite comme port par défaut ; MariaDB comme port complet ; ou **mirror** — SQLite sert pendant que chaque écriture est pompée vers le jumeau MariaDB via une outbox, sous la garde d'une vérification de divergence
- Chaîne de drivers : `better-sqlite3` → `node:sqlite` (zéro installation sur Node ≥ 22.5) → `sql.js` en JS pur ; `VELA_DB_DRIVER` en épingle un, et l'échec est bruyant
- **23 migrations** (`SCHEMA_VERSION = 23`) — une synchronisation déclarative de `TABLES` garde les deux ports et le jumeau honnêtes — voir [docs/STORAGE.md](../docs/STORAGE.md)
- Moteur de sauvegarde scellé : artefacts AES-256-GCM, niveaux de rétention, exercice de restauration, branche optionnelle S3 hors site

**🛡️ Sécurité**
- ACL par clé — quatre couches : types, fournisseurs, combos, modèles (listes d'autorisation à trois états)
- Portes de budget : plafonds journaliers, plafonds de dépense, limites de débit par clé
- **Aucun mot de passe par défaut.** L'ancien `123456` a été retiré (v0.9.41). Sans mot de passe défini, la console locale vous admet sans mot de passe mais **refuse les connexions distantes** jusqu'à ce que vous en définissiez un (Paramètres → Accès). Les clés API sont frappées en `vela-v1-<32 hex>-<8 hex>` ; le format `sk-` est rejeté partout
- Authentification unique OIDC et SAML pour le tableau de bord, une porte de robustesse JWT au démarrage, un registre de sessions indexé par `jti`, un verrou CSRF, et l'IP client dérivée du **socket TCP** (non falsifiable) — les en-têtes de forwarding ne sont acceptés que d'un proxy de boucle locale

**🖥️ Tableau de bord** — `http://localhost:32060/dashboard`
- **31 salles du tableau de bord** (36 pages au total) dans **35 langues d'interface** : fournisseurs et flux OAuth, combos, endpoints + clés API, usage par clé, quota, économiseur de tokens, console du traducteur, configuration des outils CLI, flotte de proxies, règles de repli, injecteurs de prompt, skills, journaux de requêtes et la console des réglages — commencez par [la carte du port](../docs/README.md)

---

## 🚀 Démarrage rapide

### Option A — Docker (recommandé)

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

L'image est **publique** — aucune connexion au registre n'est nécessaire — et multi-architecture (`linux/amd64` + `linux/arm64`). Pour la carte complète — jumeau MariaDB, posture mirror, moteur de sauvegarde, sidecar Headroom — consultez [DOCKER.md](../DOCKER.md), [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) et le modèle [`docker-compose.example.yml`](../docker-compose.example.yml).

### Option B — CLI npm

```bash
npm install -g vela
vela
```

Le lanceur installe, démarre et gère le serveur (le paquet npm conserve le nom `vela` ; l'application elle-même est le privé `vela-app`). Voir [cli/README.md](../cli/README.md).

### Option C — Depuis les sources

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # sert sur 32060
```

Production : `npm run build && npm run start` (Node 22+ ; Bun fonctionne aussi — `npm run dev:bun` / `build:bun` / `start:bun`).

### Puis connectez un outil

1. Ouvrez `http://localhost:32060/dashboard` — **il n'y a aucun mot de passe par défaut.** La console locale entre sans ; définissez un mot de passe dans **Paramètres → Accès** pour activer l'accès distant.
2. **Providers** → connectez-en un (Kiro AI est un bon départ gratuit)
3. **Endpoints** → frappez une clé API
4. Pointez votre outil vers la gateway :

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

Le câblage outil par outil (Claude Code, Codex, Cursor, Cline, Roo, Continue) vit dans les [cartes d'intégration](../gitbook/content/en/) — et les skills d'agents prêtes à coller se trouvent dans [skills/](../skills/README.md).

---

## 📚 Documentation

Les cartes vivent dans [`docs/`](../docs/README.md) — commencez par la carte du port. Chaque document porte la même voix, et chaque chiffre porte sa commande de re-dérivation : **si une carte et une commande divergent, la commande gagne.**

| Carte | Ce qu'elle couvre |
|-|-|
| [docs/README.md](../docs/README.md) | 🧭 La carte du port — toute la documentation, une page |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 🏗️ Cycle de vie de la requête, moteur du traducteur, registre des fournisseurs, couche base de données, moteur de sauvegarde, pacte de tarification |
| [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) | 🚀 Chemins d'installation, carte du compose, exposition et la porte de sécurité, mise à niveau |
| [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md) | 🔧 Le contrat complet des variables d'environnement |
| [docs/STORAGE.md](../docs/STORAGE.md) | 🗄️ Pacte de Stockage — sqlite/mysql/mirror, la pompe mirror, sauvegardes, S3, récupération |
| [docs/PROVIDERS.md](../docs/PROVIDERS.md) | 🌐 La liste des fournisseurs, les trois chiffres, le modèle des exécuteurs |
| [docs/API.md](../docs/API.md) | 🔌 La surface compatible OpenAI + la surface REST du tableau de bord |
| [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) | 🧯 Symptôme → cause → solution |
| [docs/VERSIONING.md](../docs/VERSIONING.md) | ⛵ Le pacte de versionnage — monter, consigner et sceller ensemble |
| [DOCKER.md](../DOCKER.md) | 🐳 Docker, en profondeur |
| [CHANGELOG.md](../CHANGELOG.md) | 📖 Le journal de bord |

Nouvelles mains : le [gitbook](../gitbook/content/en/) est la visite destinée aux débutants, en cinq langues. **Pour les ingénieurs qui travaillent dans ce dépôt :** [CLAUDE.md](../CLAUDE.md) — les papiers de l'équipage. **Pour les contributeurs du moteur :** [open-sse/AGENTS.md](../open-sse/AGENTS.md) — comment ajouter un fournisseur / exécuteur / traducteur.

---

## 🗺️ Carte du dépôt

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

## 🌍 Langues

Ce README est traduit dans 10 autres langues — les liens sont dans la bannière ci-dessus. Le tableau de bord lui-même embarque **35 langues d'interface** ; on en change depuis **Paramètres → Général → Langue**.

---

## 🏛️ Provenance et licence

Vela trace sa propre route depuis la v0.6.0 — la passerelle est sous licence MIT et pleinement sienne. Voir [LICENSE](../LICENSE).

---

<div align="center">
*Hissez votre voile. Le vent est libre.* ⛵
</div>
