# ⛵ Versioning Covenant

> *The harbor never ships without a version.* Every change — feature, fix, or
> refit — follows this rite: bump, log, seal together.

## 1. Bump the version

Bump `version` in the root `package.json` per semantic versioning:

| Tide | Bump | When |
|-|-|-|
| **Patch** | `0.6.x` | fixes and small refinements |
| **Minor** | `0.x.0` | features |
| **Major** | `x.0.0` | breaking changes |

## 2. Update the changelog

Add the change to `CHANGELOG.md` (The Ship's Log):

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

Version bump + changelog entry + code ride the **same commit**, through the
workflow covenant:

```
feat/fix branch from main → CHANGELOG → bump version → commit
→ push branch → ff-merge main → push main → delete branch both places
```

Commit style: Conventional Commits (`feat(dashboard): …`), footer
`Co-authored-by: Shiori Shorekeeper <shiorishorekeeper@gmail.com>`, never any
AI attribution.

## Package identities

| Package | Name | Why |
|-|-|-|
| Root app (dashboard + gateway) | `vela-app` | private; rebranded Vela |
| CLI launcher (`cli/`) | `9router` | npm install command + updater compatibility — kept deliberately |
