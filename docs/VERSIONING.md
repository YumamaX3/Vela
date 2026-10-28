# ⛵ Versioning Covenant

> *"The harbor never ships without a version. Every change — feature, fix, or
> refit — follows the same rite: bump the number, write the story, seal them
> together in one commit. A version with no entry is a tide nobody can read;
> an entry with no version is a promise nobody kept."*

**Covers:** the milestone tide · the ship's log · sealing together · the tag
and the Release · the compose pins · the lockfile · verifying the hull · the
docs-only exception · package identities · golden snapshots.

**Fleet:** [README.md](./README.md) (the harbor map) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) (what the hull carries). Current hull:
**1.2.5** (`node -p "require('./package.json').version"`, 2026-10-28).

---

## Table of Contents

- [🧭 The Rite, End to End](#-the-rite-end-to-end)
- [1 · Bump the Version — The Milestone Tide](#1--bump-the-version--the-milestone-tide)
- [2 · Write the Ship's Log](#2--write-the-ships-log)
- [3 · Seal Together](#3--seal-together)
- [4 · The Tag and the Release](#4--the-tag-and-the-release)
- [5 · Sail Both Compose Pins](#5--sail-both-compose-pins)
- [6 · The Lockfile](#6--the-lockfile)
- [7 · Verify the Hull](#7--verify-the-hull)
- [📄 The Docs-Only Exception](#-the-docs-only-exception)
- [📦 Package Identities](#-package-identities)
- [🧪 Golden Snapshots Follow Every Bump](#-golden-snapshots-follow-every-bump)
- [🔗 See Also](#-see-also)

---

## 🧭 The Rite, End to End

Seven steps, in order, every time. The quick card first; each step has its own
deeper section below, with the traps that have actually bitten.

```bash
# 1. bump + log
#    edit CHANGELOG.md · edit package.json version
#    edit BOTH compose pins (see §5)
npm install --package-lock-only        # lockfile follows; diff must be version-only
cd tests && npx vitest run -c vitest.config.js translator/golden-url-header.test.js -u
cd ..                                   # goldens follow the bump (see the Golden Snapshots section)

# 2. stage BY NAME — never `git add -A`
git add <this tide's files, explicitly>
git commit -F msg.txt                  # deep themed body
git push origin main

# 3. tag with the same depth
git tag -a v1.2.5 -F tag.txt
git push origin v1.2.5

# 4. PUBLISH THE RELEASE — a tag alone is NOT a release
git tag -l --format='%(contents)' v1.2.5 > .release-notes.md
gh release create v1.2.5 --repo YumamaX3/Vela \
  --title "v1.2.5 — The Themed Name <emoji>" \
  --notes-file .release-notes.md
rm -f .release-notes.md

# 5. watch the build — NEVER cancel a healthy one (Patience of the Harbor)
gh run list --repo YumamaX3/Vela --workflow "Build and Push Docker Image"

# 6. prove the hull
TOKEN=$(curl -sS "https://ghcr.io/token?scope=repository:yumamax3/vela:pull&service=ghcr.io" | jq -r '.token')
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/yumamax3/vela/manifests/1.2.5"     # expect 200
```

> 🧭 **Why the numbers are in this order.** Steps 1–2 make the ship true; steps
> 3–4 make it *visible*; steps 5–7 make it *provable*. A rite that stops after
> step 2 has a commit nobody can pull an image from; one that stops after step 3
> has a tag nobody can download. The order is the covenant.

---

## 1 · Bump the Version — The Milestone Tide

Bump `version` in the root `package.json`. The minor and patch places each
carry **two digits** (`1.10.0`, `1.99.0`) — but a place that would begin with a
**leading zero drops it**, because npm's semver refuses one: `1.00.00` is
invalid, and `1.0.0` is the compliant form of the same number. The two-digit
form is how a value is *written*; the value itself is `1.0.0`.

| Tide | Rule | Example |
|-|-|-|
| **Small change** 🐚 | the last number ticks up by one | `1.2.4 → 1.2.5` |
| **Big change** 🌊 | the last number leaps five | `1.2.3 → 1.2.8` |

The carry rules, when rounding crosses a boundary:

| Where the ship sails | Rule | Example |
|-|-|-|
| Last number rounds past `.99` | carry into the middle digit, last number drops to `0` | `1.9.99 → 2.0.0` |
| The middle digit never passes `.9` | it takes the carry into the first digit | `0.9.99 → 1.0.0` |

> *"A big change leaps five; the number keeps its value and leaps — 0.6.03
> becomes 0.6.08, 0.6.93 carries to 0.7.0."*
>
> ⚠️ **This table once read *rounds up to the next milestone of ten*.** The Star's decree of 2026-09-27
> retired that rule; the leap is five now, and `CHANGELOG.md` carries the same decree. The doc lagged
> the log until v1.0.41, which is exactly how a keeper picks the wrong number: by reading the slower
> authority. When the rule changes, both are inked in the same tide.

**Which is which?** A small change is a fix, a refit, a single room re-cut. A
big change is a covenant — a new system, a posture, a wave of the scale that
alters how the ship sails. When in doubt it is small; the milestones are for
the tides that would make a reader re-learn the ship.

> 🧭 **Lead the ride, never follow it.** A tide's leap is chosen when the tide
> is planned, not discovered afterwards from `package.json`. If a keeper needs
> the changelog to work out which number *should* have been written, the burial
> already happened.

---

## 2 · Write the Ship's Log

Add the change to `CHANGELOG.md` (The Ship's Log). It is the **single source of
truth** — the dashboard serves a derived copy (`public/CHANGELOG.md`,
gitignored, mirrored by `scripts/sync-changelog.mjs` on every dev startup and
before every build, so the dashboard serves it without depending on GitHub's
raw endpoint). After any manual changelog edit outside the dev/build scripts,
re-run that script to refresh the served copy.

- Create a **new release heading at the top** of the file —
  `# vX.Y.Z — <epithet> <emoji>` — newest first.
- Open with a **blockquote epigraph** in the maritime voice: 2–4 lines, the
  tide's own story, closing with the emoji pair (`🌊💜` for a feature tide,
  `🐛` for a fix tide).
- Then a bolded one-line summary of the wound or the change, before any list.
- Sort entries under the themed section headers:

| Header | For |
|-|-|
| **✨ Features** | New capability, new room, new door |
| **🐛 Fixes** | A wound closed — name the symptom and the file |
| **🔧 Changes & Improvements** | Refits, renames, behavior changes |
| **📖 Documentation** | Charts, the log, the papers |
| **⚠️ Breaking Changes** | Anything a reader must re-learn |
| **⚙️ Internal** | Build, CI, tooling, dependency floors |

- Close with a **`⚓ What sailed`** line (every file the tide touched) and a
  **`🧪 Proof`** line (the build, the suites by name and count, the browser
  walk, the contrast measurement). A future keeper reads this and understands
  everything without reading the diff.
- **Keep entries honest and specific.** What changed, where, why it matters. A
  count in the log is a count somebody measured — never an estimate dressed as
  a measurement.

> 🧭 **The Proof line is the load-bearing one.** "Suites green" is not proof;
> `19 CodeBuddy suites — 193/193, observed` is. Name the scope, the count, and
> the word *observed* — and when a red exists, name it, prove it pre-existing,
> and say so. A log that hides one red train is a log the next keeper stops
> trusting on the whole.

---

## 3 · Seal Together

Version bump + changelog entry + code ride the **same commit**, straight on
`main` (the Star's decree, 2026-08-14 — no feature branches):

```
work on main → CHANGELOG → bump version → commit → push main
```

- **Commit style**: Conventional Commits (`feat(dashboard): …`), footer
  `Co-authored-by: Shiori Shorekeeper <shiorishorekeeper@gmail.com>`, never any
  AI attribution.
- **Stage by name.** ⚠️ **Never `git add -A`** — the working tree routinely
  carries the Star's unrelated edits and untracked strays. A commit that
  sweeps them in is a commit that ships somebody else's half-finished work.
- ⚠️ **`docker-compose.yml` is gitignored and must NEVER be staged.** It holds
  real secrets inline. It is still *edited* on every release (see §5) — it is
  just never committed.

> 🧭 **Three rivers, one mouth.** The bump, the entry, and the code reach the
> remote together or not at all. A bump pushed without its entry is a version
> nobody can read; an entry pushed without its bump tells the world a number
> that does not exist.

---

## 4 · The Tag and the Release

**A tag is not a release.** Pushing an annotated tag creates the git object;
the **GitHub Release** is what the world sees at
`https://github.com/YumamaX3/Vela/releases`. Pushing a tag does **not** create
one.

```bash
# Reuse the tag's own deep description verbatim — never write a thinner note.
# ⚠️ Project-local scratch only: /tmp/ resolves to C:\tmp\ on Windows and ENOENTs.
git tag -l --format='%(contents)' v1.2.5 > .release-notes.md
gh release create v1.2.5 --repo YumamaX3/Vela \
  --title "v1.2.5 — The Themed Name <emoji>" \
  --notes-file .release-notes.md
rm -f .release-notes.md
# Verify it landed:
gh api "repos/YumamaX3/Vela/releases/tags/v1.2.5" --jq '.html_url'
```

| Rule | The Law |
|-|-|
| **Name convention** 🏷️ | `v1.2.5 — The Themed Name <emoji>`. Strip a leading `⛵` from the tag subject so it matches the existing list (`v0.9.40 — The Combo Harbor ✨`) |
| **Body** 📜 | The tag's deep description, **verbatim** via `--notes-file`. A Release that paraphrases the tag loses the proof |
| **Never draft** | Publish it — a draft Release is invisible |
| **Both places** 📝 | The deep description goes in **both** the commit body and the annotated tag, because a thin tag body is a thin Release |
| **Audit the gap** 🔍 | Compare **unique annotated tags** against Releases; print the whole gap, never filter it with an unproven pattern |

> 🔧 **Git Bash gotcha:** `gh api "/repos/..."` fails with
> `invalid API endpoint: "C:/Program Files/Git/repos/..."` — the shell rewrites
> a leading slash as a filesystem path. **Drop the leading slash.**

> ⚠️ **A tag nobody publishes is a sealed letter never posted.** This decree
> exists because of a six-version gap (v0.9.41–.46 each carried a deep tag and
> no Release), a second gap (v0.9.66–.69), and a third (v0.9.86) — that last
> one hidden by an audit filter whose pattern demanded a trailing dot no real
> tag has, so it answered "none" while the gap sat in the list it had just
> built. **A filter that cannot match is a broken instrument, and it is
> indistinguishable from good news.**

---

## 5 · Sail Both Compose Pins

Every update sails **both** charts:

| File | Tracked? | Action |
|-|-|-|
| `docker-compose.example.yml` | ✅ tracked | Bump the image pin — **guarded by a test** |
| `docker-compose.yml` | ❌ gitignored | Bump the image pin — **never stage it** |

The tracked chart's pin is guarded: `tests/unit/docker-compose-pin.test.js`
fails if it drifts from `package.json`, and asserts that `docker-compose.yml`
stays gitignored. Run that suite before you tag. (It was skipped once, at
v0.9.75, before the guard existed — the five tides before it all matched, so
the rite was sound and only the instrument was missing. Now the instrument
exists; use it.)

```yaml
image: ghcr.io/yumamax3/vela:1.2.5   # bump to the release you want
```

The two lines that must move together — at v1.2.5 both read `1.2.5`:

```bash
grep -n 'image: ghcr.io/yumamax3/vela:' docker-compose.example.yml docker-compose.yml
```

> 🧭 **Two charts, one number.** The untracked chart is the one that actually
> sails on the Star's machine; the tracked one is the chart in the manual. A
> release that moves only the tracked pin hands the world a correct template
> and leaves the live harbor on the last tide.

---

## 6 · The Lockfile

`npm install --package-lock-only` follows the bump. The diff **must be
version-only** — two lines, both `"version"`. If anything else moved, a
dependency drifted and that is a separate change, not a version bump.

```bash
npm install --package-lock-only
git diff --stat package-lock.json     # expect: 1 file, 2 insertions, 2 deletions
grep -n '"version"' package-lock.json | head -3
```

> 🧭 **A drifting lockfile is a second tide hiding on the same deck.** If it
> moves, do not fold it into the version commit — unbundle it, log it, and give
> it its own rite. A dependency change wearing a version bump's coat is how a
> "two-line" release ships a range shift nobody approved.

---

## 7 · Verify the Hull

The tag triggers `.github/workflows/docker-publish.yml` → GHCR
`ghcr.io/yumamax3/vela:<tag>` + `:latest`, multi-arch `linux/amd64` +
`linux/arm64`.

```bash
# The build run
gh run list --repo YumamaX3/Vela --workflow "Build and Push Docker Image" -L 4

# Alignment: HEAD = origin/main = the tag's commit = the remote tag object
git rev-parse HEAD; git rev-parse origin/main; git rev-list -n1 v1.2.5
git ls-remote --tags origin v1.2.5

# The hull itself — an anonymous token, expecting 200 and a real OCI index
TOKEN=$(curl -sS "https://ghcr.io/token?scope=repository:yumamax3/vela:pull&service=ghcr.io" | jq -r '.token')
curl -sS -o .man.json -w "http=%{http_code} type=%{content_type}\n" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/yumamax3/vela/manifests/1.2.5"
jq -r '.mediaType, (.manifests[]? | "\(.platform.os)/\(.platform.architecture)")' .man.json
rm -f .man.json
```

**Reading a stall early.** The arm64 `npm ci` under QEMU sometimes hangs until
GitHub's 6-hour ceiling, discarding the amd64 half with it. The stall is legible
in about half an hour by three signals together — the `Build and push` step
shows **no transition since it began**, `gh api .../jobs/<id>/logs` answers
**`BlobNotFound`**, and the manifest for the new tag is **404** while `latest`
answers **200**. With all three, `gh run cancel <id>` then `gh run rerun <id>`
is the sanctioned move — attempt 2 typically goes green in minutes off the warm
cache. This does **not** breach Patience of the Harbor: that decree forbids a
*new* build's concurrency group cancelling a **healthy sibling**; a stalled run
has no sibling to protect and ships nothing.

> ⚠️ **A green run on the wrong workflow is not a hull.** `cache-warm` runs go
> green while the actual `Build and Push Docker Image` run sits cancelled — only
> the manifest answers whether the image exists.

> 🧭 **Read the whole manifest, not its status.** A `200` with one platform
> listed is a hull with a missing arm; the two-line `jq` above exists so a
> half-built index cannot pass as a whole one.

---

## 📄 The Docs-Only Exception

The rule above says *every change bumps `package.json`*. It carries **one**
exception, written here so it is never re-derived by precedent archaeology:

> **A standalone correction that changes no shipped artifact does NOT bump and
> does NOT tag.**

Two facts make it safe, both measured:
1. The runner image copies an **explicit list with no wildcard** — `public`,
   `.next/static`, `.next/standalone`, `custom-server.js`, `open-sse`,
   `src/mitm`, and named `node_modules` closures. `CLAUDE.md`, `CHANGELOG.md`
   and the docs never reach the runtime, even though the *builder*'s
   `COPY . ./` does pull them in. A bump would trigger a Docker build for a file
   that is not in the image.
2. Precedent in-repo: `1f45421b` — `docs(changelog): correct a false test count`
   — one file, no bump.

**The boundary that matters:** this covers a *standalone correction made after
the fact* — fixing a false number in an already-shipped entry. A `CHANGELOG.md`
entry written **as part of** a release ships with that release's bump. The
moment a commit touches anything the runner copies, or `package.json`'s
dependencies, it is a release and follows all seven steps above.

---

## 📦 Package Identities

| Package | Name | Why |
|-|-|-|
| Root app (dashboard + gateway) | `vela-app` | private; rebranded Vela |
| CLI launcher (`cli/`) | `vela` | npm install command + updater compatibility |

---

## 🧪 Golden Snapshots Follow Every Bump

The gateway stamps `pkg.version` into outbound headers
(`X-CLIENT-VERSION` / `X-CORE-VERSION`). After any version bump, regenerate the
golden snapshots:

```bash
cd tests && npx vitest run -c vitest.config.js translator/golden-url-header.test.js -u
```

> ⚠️ **A golden debt paid is not a golden debt made.** The suite runs
> `DefaultExecutor(pid)`, so it sees every lane not listed in the `SPECIALIZED`
> exclusion set — a registry entry added on one tide leaves a debt the next
> tide inherits. At v1.2.4 the whole snapshot was regenerated (255/255) and the
> 12 stale identity lines v1.1.9 had left behind were deleted. Regenerate in
> the *same* rite as the bump, and attach the snapshot diff to the commit — so
> the numbers in it are provably this tide's and not last tide's.

---

## 🔗 See Also

- [../CHANGELOG.md](../CHANGELOG.md) — the log itself
- [../CLAUDE.md](../CLAUDE.md) — the crew's papers (the release covenant in full)
- [DEPLOYMENT.md](./DEPLOYMENT.md) — how an operator takes the new hull
- [../DOCKER.md](../DOCKER.md) — the image, deep
- [README.md](./README.md) — the harbor map
- [ARCHITECTURE.md](./ARCHITECTURE.md) — what the hull carries

— *Vela · The Sail of the Ship* ⛵
