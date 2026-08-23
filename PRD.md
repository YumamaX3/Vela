# ⛵ PRD — Vela: The AI Gateway

> *"A harbor is not a pile of docks — it is a promise that every ship finds a berth. This is Vela's promise, written down: who it serves, what it must do, and how we know it is working."* 🪞

**Product Requirements Document** · Version 0.9.23 · Status: Living (updated with every release tide)

---

## 1 · Vision

**One OpenAI-compatible endpoint. Every provider behind it. Every token spent.**

Vela is a **local AI routing gateway + dashboard** that lets a person point every AI tool (Claude Code, Codex, Cursor, Cline, OpenCode…) at a single endpoint — `http://localhost:32060/v1` — and have Vela decide which of 126 upstream providers actually answers. The vision: your paid subscriptions are spent first, cheap API lanes next, free tiers last; when one lane runs dry, the next takes the wind. Zero tool-side changes, zero downtime, one honest cost number per request.

---

## 2 · The Problem

| Pain | Cost to the user |
|-|-|
| Subscription quotas expire unused | Every unused Claude/Codex/Copilot token is money thrown away |
| Rate limits break flow mid-task | One 429 stops the whole tool until the user notices |
| Tool output burns tokens | Diffs, greps, and `ls` dumps are huge and expensive upstream |
| Many providers = many configs | Each tool needs its own endpoint/key/model config |
| Opaque costs | Users have no idea what any request actually costs |

---

## 3 · The Solution — Core Value Proposition

> **"Fail before the failure. Speak the live request. Spend every token."**

Vela delivers five covenant-grade capabilities, each with a written reason:

| Capability | What it does | Why it matters |
|-|-|-|
| **Routing & translation** | One endpoint; formats translate through an OpenAI pivot (with direct routes for fragile pairs) | Tools speak one language; providers stay interchangeable |
| **Resilience** | Combo fallback + multi-account rotation + operator fallback rules + circuit breaker | A dead lane never stops a live request |
| **Cost intelligence** | Static price table, six-step resolution, honest est. cost per request | Money is visible before it is spent |
| **Token saving (RTK)** | Pre-translate hooks compress `tool_result` in-place, fail-open | 20–40% fewer upstream tokens, zero risk |
| **Storage covenant** | sqlite / mysql / mirror postures + sealed AES-256-GCM backups | The data is safe or it does not run |

---

## 4 · Audience & Personas

1. **The Solo Developer** — wants one endpoint for all their coding tools, spends subscription quota first, hates reconfiguring.
2. **The Power User / Home-laber** — runs many agents, needs multi-account rotation, quota dashboards, per-key ACL, self-hosted privacy.
3. **The Team Operator** — needs OAuth/SAML login, per-key budgets and ACLs, usage telemetry, sealed backups, a mirror posture for durability.
4. **The Contributor** — reads `AGENTS.md`/`CLAUDE.md`, adds providers and executors, follows the release covenant.

---

## 5 · Functional Requirements

### 5.1 Gateway surface (`/v1`)
- **FR-1**: OpenAI-compatible chat completions, Anthropic `/v1/messages`, embeddings, image generation, audio (TTS/STT), video generation (async job flow), web search & fetch, responses API.
- **FR-2**: Model identity `provider/model` with provider-prefix resolution; combos (`owned_by: "combo"`) auto-fallback.
- **FR-3**: Streaming (SSE) and non-streaming; format translation via the OpenAI pivot with direct routes for fragile pairs.

### 5.2 Resilience
- **FR-4**: Model-combo fallback — walk the list until one answers (fallback or round-robin strategy).
- **FR-5**: Operator **fallback rules v2** (Dashboard) — typed triggers: HTTP status, content-policy, context-window (pre-call), timeout, any-error; multi-hop chains; per-request opt-out (`vela_disable_fallback_rules`).
- **FR-6**: Multi-account fallback per provider with round-robin rotation.
- **FR-7**: Circuit breaker — cooldown → exhausted escalation with exponential backoff.
- **FR-8**: OAuth + API-key credential management with automatic token refresh (background scheduler).

### 5.3 Cost intelligence
- **FR-9**: Static price table ($/1M tokens: input/output/cached/reasoning/cache-creation) with six-step resolution chain.
- **FR-10**: Dashboard price editor + models.dev sync; free-tier detection; honest est. cost per request.

### 5.4 Token saving (RTK)
- **FR-11**: Pre-translate hooks compress `tool_result` content in-place; fail-open; never touches `is_error` traces.
- **FR-12**: Optional Headroom sidecar for deeper compression.
- **FR-13**: Prompt injectors v2 — operator-defined system prompts with built-in variables (`{{model}}`, `{{date}}`…), custom vars with `x-vela-inject-var-<name>` header overrides, presets, reorder.

### 5.5 Storage covenant
- **FR-14**: `VELA_DB_MODE=sqlite|mysql|mirror` — sqlite default; MariaDB full harbor; mirror = sqlite serves + outbox pump to the twin.
- **FR-15**: Sealed backup engine — AES-256-GCM artifacts, retention tiers, drill + restore, optional S3 off-site.
- **FR-16**: Versioned migrations (14), additive schema sync, portable adapter surface.

### 5.6 Governance
- **FR-17**: Per-key ACL — tri-state allowlists for kinds / providers / combos / models (keyGate).
- **FR-18**: Budget gates — daily caps, spend caps, rate limits per key.
- **FR-19**: Dashboard auth — cookie sessions + OIDC/SAML enterprise login.

### 5.7 Dashboard
- **FR-20**: Providers & OAuth flows, combos, endpoints + API keys, per-key usage, quota, token-saver controls, translator console, CLI-tool setup pages, pricing settings, fallback rules, prompt injectors — in 34+ interface locales.

---

## 6 · Non-Functional Requirements

| NFR | Requirement |
|-|-|
| **Performance** | Streaming first; the combo loop never serializes on slow lanes when a fast one answers; the RTK saver runs in the request path with bounded overhead |
| **Reliability** | Fail-open everywhere optional; circuit breaker prevents cascading provider failure; graceful drain on SIGTERM |
| **Security** | Per-key ACL tri-state; IP trust only for loopback proxies; secrets in the DB never in git; hop-by-hop hygiene; no `X-Powered-By` |
| **Privacy** | Self-hosted by default; OAuth tokens encrypted at rest in the DB |
| **Portability** | Node ≥ 22.5 + `node:sqlite`; Bun compatible; multi-arch Docker (amd64+arm64); portable DB adapter surface |
| **Observability** | Per-key usage telemetry, quota dashboards, egress geo probe, usage digest |

---

## 7 · Success Metrics

1. **Token utilization** — subscription quotas spent before reset (dashboard shows per-key quota vs usage).
2. **Request success rate** — fallback rules + circuit breaker keep it at ceiling across provider outages.
3. **Token savings** — RTK compresses 20–40% of tool-output tokens (measurable per request).
4. **Cost transparency** — every request carries an honest est. cost; pricing editor keeps the table current.
5. **Zero-downtime upgrades** — the release covenant ships every minor as a tagged image; the mirror posture survives twin loss.

---

## 8 · Out of Scope (this tide)

- ❌ Multi-node / federated gateway clustering (single-host by design)
- ❌ A managed cloud offering (self-hosted only)
- ❌ Model fine-tuning / training
- ❌ GPU inference hosting

---

## 9 · Roadmap Tides

| Tide | Sealed |
|-|-|
| v0.9.15–16 | Circuit breaker + operator fallback rules (v1) |
| v0.9.17–19 | Per-key ACL, pool egress geo, prompt injectors (v1), resilience ascension |
| v0.9.20–22 | Adapter contract fix (boot-storm), 9router purge, Stillwater Hull |
| **v0.9.23** | **Fallback Rules v2 (typed triggers, pre-call checks, chains) + Prompt Injectors v2 (variables, presets)** |
| Next tides | Cooldown-aware rule chains (breaker-keyed skip), per-request injector overrides surfaced in UI, deeper RTK filters, more providers |

---

## 10 · How We Know It Works

- **Tests**: 245 vitest unit files; the touched suites run green (fallback seam 5, matcher v2 12, injectors v2 8, migration crash-driver, dockerfile closure).
- **Build**: `npm run build` — 152 pages compile clean.
- **The Mirror's law**: nothing ships without a written reason and a verified claim. Every covenant entry in [CHANGELOG.md](./CHANGELOG.md) is that record.

---

*Set your sail. The wind is free.* ⛵
