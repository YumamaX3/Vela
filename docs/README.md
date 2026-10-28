# 🧭 Vela — The Harbor Map

> *"Every harbor needs a chart, and every chart needs a door. This is that
> door — the one page that names every other page, says what it covers, and
> tells you which one to open first. Start here; the tide will take you where
> you need to be."*

**Covers:** the doc index · reading order by intent · the five-minute
orientation · the chart room · the crew's papers · the repository map · the
covenants · where to find a number.

**Fleet:** [README.md](./README.md) (this map) · [VERSIONING.md](./VERSIONING.md)
(the release rite) · [ARCHITECTURE.md](./ARCHITECTURE.md) (the ship's shape) —
three charts that must agree, so every number below carries the command that
derives it. This chart was re-measured at **v1.2.5**, **2026-10-28**.

---

## Table of Contents

- [🚪 Where to Start](#-where-to-start)
- [⏱️ The Five-Minute Orientation](#-the-five-minute-orientation)
- [🗺️ The Chart Room](#-the-chart-room)
- [📜 The Crew's Papers](#-the-crews-papers)
- [🗂️ The Repository Map](#-the-repository-map)
- [🏛️ The Covenants](#-the-covenants)
- [🔢 Where to Find a Number](#-where-to-find-a-number)
- [🔗 See Also](#-see-also)

---

## 🚪 Where to Start

Read by what you came to do, not by alphabetical order. The right column is
the first door; the chart beside it is the one that will answer your next four
questions.

| You came to… | Open |
|-|-|
| **Run Vela** — install it and point a tool at it | [../README.md](../README.md) → [DEPLOYMENT.md](./DEPLOYMENT.md) |
| **Sail it in Docker** — image, volumes, compose chart | [../DOCKER.md](../DOCKER.md) → [DEPLOYMENT.md](./DEPLOYMENT.md) |
| **Learn it gently** — a beginner's walk, five languages | [gitbook](../gitbook/) (tracked) |
| **Understand the machine** — how a request actually flows, deck by deck | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **Wire it up** — every env var, every default | [ENVIRONMENT.md](./ENVIRONMENT.md) |
| **Choose a database posture** — sqlite, mysql, or mirror | [STORAGE.md](./STORAGE.md) |
| **Call the API** — the gateway surface and the dashboard REST | [API.md](./API.md) |
| **See what upstreams it speaks** — the provider roster and its three counts | [PROVIDERS.md](./PROVIDERS.md) |
| **Fix something** — symptom, cause, fix | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| **Hand Vela to an agent** — drop-in skill links | [../skills/README.md](../skills/README.md) |
| **Change the code** — the crew's papers | [../CLAUDE.md](../CLAUDE.md) |
| **Add a provider / executor / translator** | [../open-sse/AGENTS.md](../open-sse/AGENTS.md) |
| **Touch a test** — the suites, by scope | [../tests/README.md](../tests/README.md) → [../tests/translator/AGENTS.md](../tests/translator/AGENTS.md) |
| **Cut a release** — the seven-step rite | [VERSIONING.md](./VERSIONING.md) |

> 🧭 **One rule for the door.** If two doors seem to answer the same question,
> take the more specific one; if two *charts* disagree on a number, neither is
> right until you re-run the command in
> [Where to Find a Number](#-where-to-find-a-number).

---

## ⏱️ The Five-Minute Orientation

Vela is **one Node process with three concerns** — and a fourth thing it keeps
at arm's length.

| Layer | Where | What it does |
|-|-|-|
| **Dashboard + API** | `src/` (Next.js App Router) | The web UI, the REST surface, auth, settings — and the `/v1/*` gateway entry (a rewrite in `next.config.mjs` maps `/v1/*` → `/api/v1/*`) |
| **Routing engine** | `open-sse/` | Provider-agnostic translation + dispatch. Usable standalone; the app consumes it through thin glue |
| **Persistence** | `src/lib/db/` | SQLite by default; MariaDB twin, or full mirror, on demand; sealed backups |
| **The MITM proxy** | `src/mitm/` | A **child process**, opt-in per tool, never on the request path — see [ARCHITECTURE.md](./ARCHITECTURE.md#-the-systems-around-the-ship) |

You point every AI tool at one endpoint — `http://localhost:32060/v1` — and
Vela decides which provider answers: paid subscriptions first, cheap API lanes
next, free tiers last. When one lane runs dry, the next takes the wind.

```
Client ──> custom-server.js (IP from socket, h2c, hop-by-hop strip)
     ──> Next.js /v1 rewrite ──> /api/v1/:path*
     ──> keyGate (per-key ACL) ──> budgetGate (daily/spend caps)
     ──> provider selection (combo / fallback rules / circuit breaker)
     ──> open-sse/executors (format translation per provider)
     ──> upstream provider ──> response ──> RTK savers ──> client
```

Four facts worth holding from the first minute:

- **There is no default password.** The old `123456` was retired. With
  `INITIAL_PASSWORD` unset, the local console admits a loopback request without
  one but **refuses remote logins** until a password is set (Settings → Access).
  SSO (OIDC / SAML) is available and tested from the same screen.
- **State lives in SQLite, not `db.json`.** That era is over. See
  [STORAGE.md](./STORAGE.md).
- **Counts come in threes here.** The provider registry reports *files on
  disk*, *modules imported*, and *dialable chat transports* — three honest
  numbers that differ. Never collapse them into one; see
  [PROVIDERS.md](./PROVIDERS.md).
- **A tag is not a release, and a green run is not a hull.** The versioning rite
  explains why: [VERSIONING.md](./VERSIONING.md#-the-tag-and-the-release).

---

## 🗺️ The Chart Room

Every chart in `docs/`, what it covers, and who it is for. Each is written to
be read *with* its neighbours, not instead of them.

| Chart | Covers | For |
|-|-|-|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Request lifecycle · translator engine · provider registry · executors · combos & fallback rules · RTK token saver · database layer · storage postures & the mirror · backup engine · pricing covenant · authentication & security · the systems around the ship | Anyone touching the engine |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Install paths (Docker, CLI, source) · volumes · the compose chart · exposure & the security gate · upgrading | Operators |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | The complete environment-variable contract — every variable, default, and effect | Operators · self-hosters |
| [STORAGE.md](./STORAGE.md) | The Storage Covenant — sqlite / mysql / mirror · the outbox pump · the divergence sweep · the backup engine · recovery | Anyone who owns the data |
| [API.md](./API.md) | The OpenAI-compatible surface + the dashboard REST surface · auth posture · the settings write door | Integrators |
| [PROVIDERS.md](./PROVIDERS.md) | The provider roster · the three counts · the entry contract · the executor model · how to add a provider | Integrators · engine contributors |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Symptom → cause → fix for the failures an operator actually meets | Operators, at 2am |
| [VERSIONING.md](./VERSIONING.md) | The versioning covenant — bump, log, seal, tag, release, pins, lockfile, verify | Releasers |
| [../DOCKER.md](../DOCKER.md) | Docker, deep — image, volumes, compose, the Headroom sidecar | Operators |
| [../CHANGELOG.md](../CHANGELOG.md) | The Ship's Log — every tide's covenant entry, newest first | Everyone, eventually |
| [../gitbook/](../gitbook/) | The published docs site — beginner-facing, tracked, five languages (`en`, `es`, `ja`, `vi`, `zh-CN`) | Newcomers |

> 📌 **Note:** `plans/` holds the sealed design plans (ADR-style) for the large
> covenants — Storage, Pricing, and the rest. They are internal and are
> **gitignored**, so a clone will not carry them. The charts above are the
> public record.

---

## 📜 The Crew's Papers

The agent-facing instructions live beside the code they govern, so a
contributor — human or agent — reads the rules at the door of the room they are
about to touch.

| Paper | Governs |
|-|-|
| [../CLAUDE.md](../CLAUDE.md) | The whole repo — voice, architecture, the release covenant, the test covenant, the design system |
| [../open-sse/AGENTS.md](../open-sse/AGENTS.md) | The engine — providers, executors, translators, RTK, the pricing model, the pitfalls |
| [../src/AGENTS.md](../src/AGENTS.md) | The Next.js app — route handlers, the dashboard shell, client/server boundaries |
| [../src/lib/db/AGENTS.md](../src/lib/db/AGENTS.md) | The database layer — the adapter contract, facades, migrations, the mirror |
| [../cli/AGENTS.md](../cli/AGENTS.md) | The `vela` npm launcher — bin, install, update, purge |
| [../tests/translator/AGENTS.md](../tests/translator/AGENTS.md) | The translation-layer test suite — the matrix, `registerAll`, the `it.fails` convention |
| [../tests/README.md](../tests/README.md) | The embeddings suites — setup, how to run them, and the 59-test coverage summary |
| [../skills/README.md](../skills/README.md) | The drop-in agent skills — copy a link, paste it to your AI; start with the `Vela` entry skill |
| [../AGENTS.md](../AGENTS.md) | **Nothing in Vela.** Honestly: a **vendor harness block** — the Hydra orchestration toolkit and the Next.js agent-rules comment block. Root-level and agent-facing, but it governs none of the code below it. Read it only if you *are* that harness; the papers above outrank it everywhere |

---

## 🗂️ The Repository Map

The shape of the tree, with the density measured at **v1.2.5, 2026-10-28**.
Every count carries its command — re-derive rather than trust the line.

```
vela/
├── custom-server.js          # The helm — wraps Next standalone: IP derivation, h2c, drain
├── next.config.mjs           # Standalone output, rewrites, external packages, perf knobs
├── Dockerfile                # Multi-stage, multi-arch (amd64 + arm64), HEALTHCHECK
├── docker-compose.yml        # Live chart (gitignored — holds real secrets)
├── docker-compose.example.yml# Template chart (tracked), pin 1.2.5 — guarded by a test
├── package.json              # v1.2.5 — bump with every release (VERSIONING §1)
├── CHANGELOG.md              # Every tide's covenant entry (VERSIONING §2)
├── CLAUDE.md                 # The crew's papers — the repo-wide rules
├── AGENTS.md                 # Vendor harness block (Hydra + nextjs rules) — governs nothing here
├── docs/                     # These charts
├── gitbook/                  # The published docs site — tracked, beginner-facing, 5 languages
├── cli/                      # The `vela` npm CLI — bin `vela`, full purge
├── open-sse/                 # The gateway engine — providers, RTK, executors, handlers
│   └── AGENTS.md             # ← engine contributor guide
├── src/
│   ├── app/                  # Next App Router — 36 pages, 255 tracked API routes (258 on disk)
│   ├── lib/                  # The deep current — db, network, oauth, auth, updater
│   │   └── db/AGENTS.md      # ← database contributor guide
│   ├── sse/                  # App-side entry glue — keyGate, budget, handlers
│   ├── shared/               # Shared components, hooks, utils, constants
│   ├── mitm/                 # The MITM proxy child process
│   └── instrumentation.js    # Server init — outbound proxy, deferred startup, breaker binding
├── skills/                   # Drop-in agent skills (one folder per capability)
├── tests/                    # 480 test files — 460 .test.js + 19 .test.jsx + 1 .test.cjs
├── scripts/                  # Migration, changelog sync, i18n seed, icon subset, registry index
└── .github/workflows/        # docker-publish, cache-warm, gitbook-pages
```

| Figure | Value | Derive |
|-|-|-|
| Version | **1.2.5** | `node -p "require('./package.json').version"` |
| Dashboard pages | **36** | `find src/app -name 'page.js' \| wc -l` |
| API routes | **255 tracked** (258 on disk — the `src/app/api/plans/` lanes sit behind the bare `plans/` gitignore rule) | `git ls-files \| grep -E '^src/app/.*route\.js$' \| wc -l` |
| Test files | **480** (460 `.test.js` + 19 `.test.jsx` + 1 `.test.cjs`) | `find tests -name '*.test.js' -o -name '*.test.jsx' -o -name '*.test.cjs' \| wc -l` |

> ⚠️ **This map wore three false numbers and an old version pin — and every
> one of them was stale.** It claimed a page count, an API-route count and a
> test count true of a ship three milestones back; nothing re-derived them, so
> they drifted quietly. That is the Count Discipline exactly: a number in a doc
> is a claim, and a claim is worth the command that re-checks it. If this table
> and a command disagree, **the command wins.**
>
> 🔍 **And one of those figures teaches a second lesson.** `find tests -name
> '*.test.js*'` matches the four `.snap` snapshots as well as real suites, and
> the same glob always misses `*.test.cjs` — so a single careless glob can be
> wrong *twice* while looking authoritative. Name the unit, then measure it.

---

## 🏛️ The Covenants

Vela is built on a handful of named, written covenants. They are not marketing
— they are the rules that keep the harbor honest, and each has a chart or a log
entry behind it.

| Covenant | The rule | Where it lives |
|-|-|-|
| **The Covenant of Truth** | Never fabricate. If a number, path, or behavior is uncertain, verify it against the code before asserting it. | [../CLAUDE.md](../CLAUDE.md) |
| **The Covenant of Voice** | One voice: warm, calm, deliberate. Coral `--color-brand-500` is the single accent; warm neutrals are the ground. | [../CLAUDE.md](../CLAUDE.md) |
| **The Versioning Covenant** | The harbor never ships without a version — bump, log, seal together in one commit, then tag *and* publish. | [VERSIONING.md](./VERSIONING.md) |
| **The Storage Covenant** | Three postures, one env var; a down twin degrades, never silently downgrades. | [STORAGE.md](./STORAGE.md) |
| **The Pricing Covenant** | Every request gets an honest estimated cost, resolved through a six-step chain; an unmatched model resolves `null`, never a guess. | [ARCHITECTURE.md](./ARCHITECTURE.md#-the-pricing-covenant) |
| **The Test Covenant** | Name the scope when quoting a count; never claim "full suite green" — the repo has none to claim. | [../CLAUDE.md](../CLAUDE.md) |
| **The Count Discipline** | Numbers are measured at runtime, not grepped, and you name which one you mean. | [PROVIDERS.md](./PROVIDERS.md) |

---

## 🔢 Where to Find a Number

When someone asks "how many?", the answer is a command, not a memory. These are
the canonical derivations — re-run them rather than trusting a line in a doc
that may have drifted. **Measured 2026-10-28 at v1.2.5.**

```bash
# Version — the number every other figure is dated against
node -p "require('./package.json').version"                             # 1.2.5

# Providers — three honest numbers, never collapsed into one
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l          # 189 — files on disk
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 — imported by the generated index
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 — dialable chat transports

# Executors — the sizing lives in open-sse/executors/
ls open-sse/executors/*.js | wc -l                                      # 43 — .js files (dirs such as chatgpt-web/ live beside them)
ls open-sse/executors/*.js | grep -vE '/(base|default|index)\.js$' | wc -l   # 40 — beyond the base/default/index trio

# Schema — the migration chain's end
grep -n 'SCHEMA_VERSION' src/lib/db/schema.js                          # 23
ls src/lib/db/migrations/*.js | grep -v index.js | wc -l               # 23 — one per version

# Surface
find src/app -name 'page.js' | wc -l                                   # 36 — pages
find src/app/api -name 'route.js' | wc -l                              # 258 — API routes

# Tests — by kind, because the scope is the count
find tests -name '*.test.js' | wc -l                                   # 460
find tests -name '*.test.jsx' | wc -l                                  # 19
find tests -name '*.test.cjs' | wc -l                                  # 1 — custom-server-h2c
# The total — OR the three above; `-name '*.test.js*'` matches snapshots too and over-counts
find tests -name '*.test.js' -o -name '*.test.jsx' -o -name '*.test.cjs' | wc -l   # 480
```

> ⚠️ **The Count Discipline exists because a doc once claimed a number that
> matched nothing** — and again, at v1.2.4, when this very map lagged three
> milestones behind. Every figure in these charts carries the date it was
> measured and the command that measures it. If a chart and a command
> disagree, **the command wins** — and the chart is the thing that is wrong.

---

## 🔗 See Also

- [../README.md](../README.md) — the front door
- [../gitbook/](../gitbook/) — the same harbor, described for someone's first day
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the shape of the ship
- [VERSIONING.md](./VERSIONING.md) — how a new hull is sealed
- [DEPLOYMENT.md](./DEPLOYMENT.md) — how to sail it
- [../CLAUDE.md](../CLAUDE.md) — the crew's papers

— *Vela · The Sail of the Ship* ⛵
