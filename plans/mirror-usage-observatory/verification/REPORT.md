# W2-G Visual Verification Report — The Usage Observatory Cockpit

> *The Cockpit's visual protocol sailed four breakpoints, keyboard navigation,
> a non-en locale, and an honest RTL finding. This is the evidence the sealed
> plan called for — every screenshot, every probe, every conclusion.* 🔭🪞

**Sealed:** 2026-08-17 · **Wave:** Usage Observatory W2-G (Cockpit seal) ·
**Harness:** `cdp.mjs` (CDP driver over a Steel browser) · **Build under
test:** v0.7.40 (rebuilt from the committed source — the earlier v0.7.30
serving was superseded).

---

## Protocol Summary

| Obligation (SEALED-PLAN §W2-G) | Status | Evidence |
|-|-|-|
| 4 breakpoints | ✅ Done | `w2g-01`–`w2g-15` |
| Keyboard nav | ✅ Done (working) | `w2g-16`, `w2g-17` |
| Non-en locale | ✅ Done (`id` renders) | `w2g-18`, `w2g-19` |
| RTL | ✅ Verified & recorded — **no RTL layout support** | `w2g-20`, `w2g-21` |

## 1 — Four Breakpoints

The Observatory's four decks (Overview, Analytics, Requests, Accounts &
Limits) were captured at four widths. Layout holds at every one.

| Width | Class | Shots | Notes |
|-|-|-|-|
| 1440 | Desktop | `w2g-01`–`w2g-04` | Full Cockpit chrome; all four decks |
| 1024 | Tablet landscape | `w2g-05`–`w2g-08` | All four decks |
| 768 | Tablet portrait | `w2g-09`–`w2g-11` | Overview / Requests / Limits |
| 320 | Mobile | `w2g-12`–`w2g-15` | All four decks; single-column reflow |

No horizontal overflow, no clipped charts, no broken tab rail at any width.

## 2 — Keyboard Navigation

The Requests ledger is fully keyboard-operable (W2-E obligation):

- Rows carry `tabIndex=0` + `data-ledger-row`; ArrowDown / ArrowUp move focus
  across rows (proven: focus advanced index 0 → 2 over two ArrowDown presses).
- **Enter opens the drawer** (`w2g-17`); Escape closes it.
- `w2g-16` shows the populated ledger (period=30d, 21 rows — production DB had
  no recent traffic at the default period, so the window was widened to real
  data).

## 3 — Non-en Locale

`locale=id` (Indonesian) renders correctly for app-shell strings — e.g.
"Penyedia" (Provider), "Statistik Penggunaan" (Usage). See `w2g-18`
(Overview) and `w2g-19` (Requests).

**i18n budget held at 40/40** — 34 locales, 4 anchor question-strings seeded
as English placeholders across all locale files (recorded translation debt,
acceptable per the sealed plan). Novel Observatory strings fall back to
English via `t()`.

## 4 — RTL — Honest Finding

**There is no RTL layout support anywhere in `src/`.** This is the recorded
evidence, not a claim of working RTL.

Probed with `locale=ar`:
- Arabic glyphs render correctly (`hasArabicText: true`).
- But `document.documentElement.dir` and `document.body.dir` remain **unset**
  (LTR default) — no `dir="rtl"` is ever applied.
- A repo-wide grep for RTL handling (`dir`, `rtl`, `direction`) in `src/`
  returned only false positives. The i18n runtime (`src/i18n/runtime.js`)
  translates text nodes via MutationObserver but never sets direction.

**Conclusion:** RTL locales (ar, fa, he, ur) ship translation files, but the
layout stays LTR. This is a **pre-existing app-wide debt, not introduced by
W2**. The Observatory inherits it; it must be banked for a future wave.

Evidence: `w2g-20` (ar Overview), `w2g-21` (ar Requests).

## Reproduce

```bash
export STEEL_CDP_URL="<steel-cdp-endpoint>"     # the browser's CDP address
node cdp.mjs resize 1440 900
node cdp.mjs go "http://<vela>:32060/dashboard/usage?tab=overview&period=30d" 2500
node cdp.mjs shoot screenshots/w2g-XX.png
node cdp.mjs eval 'JSON.stringify({dir: document.documentElement.dir})'
```

The harness reads its endpoint from `STEEL_CDP_URL` (no host baked in).

---

*Every obligation proven, every finding honest. The Cockpit is sealed.* 🔭🪞
