# 🧪 Vela Tests — the Fleet's Proof

> *"No harbor claims a green fleet it cannot show. The suite is the honest instrument: four holds of tests, one archived file kept as history, and a rig that compares failing test names — never bare counts — so a tide can prove it broke nothing."*

**Covers:** setup · running · the four holds · the archived hold · the blast-radius rig · the baselines · the Test Covenant.

---

## ⚙️ Setup

The suite is its own ESM package — `vela-tests` — with its own lockfile and its own `vitest.config.js`. From this directory:

```bash
cd tests/ && npm install
```

## 🏃 Running

```bash
npm test                                    # vitest run — the whole fleet
npx vitest run --reporter=verbose            # or drive vitest directly
npx vitest run unit/some-suite.test.js      # one suite alone
```

## 🗄️ The Holds

| Hold | Live test files | What it proves |
|-|-:|-|
| `unit/` | 442 | The engines — db, routing, breaker, pricing, auth, every room of the dashboard |
| `translator/` | 27 | Format translation against golden snapshots (`translator/__snapshots__/`) |
| `contract/` | 10 | Route contracts — the surface the gateway promises |
| `auth/` | 1 | The auth gates |

**480 live test files** (measured 2026-10-28, at v1.2.4). Re-derive, never quote:

```bash
git ls-files tests | grep -E '\.test\.(js|jsx|cjs)$' | grep -v archived | wc -l   # 480
find tests -name '*.test.*' -not -path '*__snapshots__*' -not -path '*archived*' | wc -l
```

Retired suites rest in `unit/archived/` as `.test.js.archived` — history, not cargo (`embeddings.cloud.test.js.archived` is the one; the old cloud-worker tree it tested is gone).

## 🧯 The Blast-Radius Rig

`blast-radius.sh` is the instrument this fleet sails by: it runs the suite at pristine HEAD, runs it again with a tide's changes aboard, and diffs **failing test names — never counts** (durations differ and are not drift; a count match can hide a swap). A tide that reddens no name that was green before it proves exactly that — and nothing more.

## 📐 The Baselines

`__baseline__/` holds the machine-measured ground truths — `contract-surface.json`, `alias-baseline.json`, `apikey-enforcement-sites.json`, `baseline-results.json`, `current.json`. Suites load them instead of hand-copying shapes, so a route that moves reddens the suite rather than lying in a fixture.

## ⚖️ The Test Covenant

Name the scope when quoting a count; never claim "the full suite is green" — this repo has no green suite to claim. The honest sentence is a blast-radius: *this tide reddened no failing name that was green before it*. See `../CLAUDE.md` for the covenant in full.

## 🔗 See Also

- [../CLAUDE.md](../CLAUDE.md) — the crew's papers, the Test Covenant
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — the systems under test

— *Vela · The Sail of the Ship* ⛵