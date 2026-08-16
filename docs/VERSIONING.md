# ⛵ Versioning Covenant

> *The harbor never ships without a version.* Every change — feature, fix, or
> refit — follows this rite: bump, log, seal together.

## 1. Bump the version — The Milestone Tide

Bump `version` in the root `package.json`. Versions carry two digits in the
last place (`0.6.01`, `0.6.02`) — npm accepts this for a private package.

| Tide | Rule | Example |
|-|-|-|
| **Small change** 🐚 | the last number ticks up by one | `0.6.03 → 0.6.04` |
| **Big change** 🌊 | the last number rounds up to the next milestone of ten | `0.6.03 → 0.6.10` |

The carry rules, when rounding crosses a boundary:

| Where the ship sails | Rule | Example |
|-|-|-|
| Last number rounds past `.99` | carry into the middle digit, last number drops to `0` | `0.6.93 → 0.7.0` |
| Middle digit carries past `.9` | carry into the first digit | `0.9.x → 1.0` |

> *"A big change rounds the voyage up to the next milestone of ten; the
> number keeps its value and rounds — 0.6.03 becomes 0.6.10, 0.6.93 carries
> to 0.7.0."*

## 2. Update the changelog

Add the change to `CHANGELOG.md` (The Ship's Log). It is the single source of
truth — the dashboard serves a derived copy (`public/CHANGELOG.md`,
gitignored, mirrored by `scripts/sync-changelog.mjs` on every dev startup and
build, because the repo is private). After any manual changelog edit outside
the dev/build scripts, re-run that script to refresh the served copy.

- Create a **new release heading at the top** of the file —
  `# vX.Y.Z — <epithet>` — newest first. The epithet is a short theme for the
  release (e.g. "The Harbor Release"); the sealing date rides on the same
  heading or the line beneath it.
- Sort entries under the themed section headers:
  - ✨ Features
  - 🐛 Fixes
  - 🔧 Changes & Improvements
  - 📖 Documentation
  - ⚠️ Breaking Changes
  - ⚙️ Internal
- Keep entries honest and specific: what changed, where, why it matters.

## 3. Seal together

Version bump + changelog entry + code ride the **same commit**, straight on
`main` (the Star's decree, 2026-08-14 — no feature branches):

```
work on main → CHANGELOG → bump version → commit → push main
```

Commit style: Conventional Commits (`feat(dashboard): …`), footer
`Co-authored-by: Shiori Shorekeeper <shiorishorekeeper@gmail.com>`, never any
AI attribution.

## Golden snapshots follow every bump

The gateway stamps `pkg.version` into outbound headers
(`X-CLIENT-VERSION` / `X-CORE-VERSION`). After any version bump, regenerate:

```bash
cd tests && npx vitest run translator/golden-url-header.test.js -u
```

## Package identities

| Package | Name | Why |
|-|-|-|
| Root app (dashboard + gateway) | `vela-app` | private; rebranded Vela |
| CLI launcher (`cli/`) | `9router` | npm install command + updater compatibility — kept deliberately |
