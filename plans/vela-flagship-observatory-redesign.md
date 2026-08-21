# 🏛️ Sealed ADR — Vela Flagship Observatory (v0.9.9)

**Date:** 2026-08-21 · **Status:** Sealed (Mirror Gate 6) · **Author:** Shorekeeper

## ⚓ The Need
Vela's dashboard + Usage get a flagship redesign: new layout, new tabs, more features. The quota tracker (9router heritage) becomes a separate page again, as it was before.

## 💎 The Crystal
- **Landing** (`HomePageClient.js`): pulse hero + 4 Spotlight stat cards (Count Up, sparklines) + activity grid (last-10-min sparkline, top models) + harbor status panel + quick-nav tiles (incl. new Quota tile).
- **Usage** → 6-tab Observatory: Overview · Analytics · Requests · Quota & Limits · Providers · Logs, via `?tab=` URL state, real `/api/usage/*` data, all states (loading/empty/error).
- **`/dashboard/quota`** (new page): plan status band + per-account quota gauges + budget tracker + provider limits. Shares ONE `QuotaPanel` component with Usage's Quota tab (no duplication).

## 📐 Direction
Elevate the Current — warm-light editorial. Tokens: paper `#FDFAF6`, ink `#0a0a0a`, brand orange `#E56A4A` scale, radius 10/14. Dials ENERGY 1-2, RHYTHM 2, MOTION 2.

## 📂 The Stones (files)
- `src/app/(dashboard)/dashboard/HomePageClient.js` — landing redesign
- `src/app/(dashboard)/dashboard/usage/page.js` + `components/deck/*` — 6 decks
- `src/app/(dashboard)/dashboard/usage/components/deck/CompassDeck.js` — tab rail
- `src/app/(dashboard)/dashboard/quota/page.js` + `components/QuotaPanel.js` — NEW
- `src/shared/components/` — shared primitives
- `src/app/globals.css` — tokens (additions only)
- i18n locale files — `translate()` for all new strings

## 🪸 The Reefs (with mitigations)
| Risk | Mitigation |
|-|-|
| Quota duplication | Shared `QuotaPanel` component, one data source |
| Component theme conflict | All reactbits/motion components themed to Vela tokens at install |
| i18n gaps | Every string via `translate()`; en source, others fall back |
| Build regression | `npm run build` exit 0 enforced pre-dispatch and pre-release |
| Logs polling load | 30s auto-refresh + visibility pause + manual refresh |
| Per-account limits data | Verify `/api/keys/usage` shape at build; honest fallback |

## 🖐️ The Dispatch Brief (to the Hands)
**Scope:** Implement the Vela Flagship Observatory redesign.
**Acceptance:** Landing redesigned; Usage = 6 tabs; new `/quota` page; shared `QuotaPanel`; all components themed; i18n; states everywhere; build exit 0; tests pass.
**Touch:** `src/app/(dashboard)/dashboard/**`, `src/shared/components/**`, `globals.css`, i18n locales.
**Never touch:** `open-sse/**`, `src/lib/db/migrations/**`, `docker-compose.yml`, API route logic.
**Bounds:** Read, Edit, Write, Bash, Grep, Glob. Max turns 60.

*Sealed into the crystal for the Hands to forge. The Harbor, the Observatory, and the Quota shore — one design, one truth.* 💜🌊🏛️
