# 🏛️ Sealed Plan — Vela Usage Redesign (Single Page + Separate Quota)

**Date:** 2026-08-21 · **Status:** Sealed (Mirror Gate 1 approved) · **Author:** Shorekeeper

## ⚓ The Need
Fully remove Vela's current usage design (the CompassDeck 4-tab observatory). Build a brand-new single-page `/dashboard/usage` (NO tabs) with big, readable KPI cards (Requests, Input Tokens, Output Tokens, Est. Cost). Quota tracker becomes its own `/dashboard/quota` page like original 9router. Everything blends into the 9router warm-light look.

## 💎 The Crystal (approved preview)
- **`/dashboard/usage`** — single page, no tabs:
  1. Header: title "Usage" + sub, period selector (Last 7 days / Today / 24h / 30d), refresh button
  2. **KPI hero band** (warm orange-tinted gradient band) with 4 big white cards: **Requests, Input Tokens, Output Tokens, Est. Cost** — each: colored icon (requests=orange, input=indigo, output=green, cost=amber), large bold tabular number (26px), delta badge (up/down vs previous), sub-line ($/Mtok for cost)
  3. **Traffic chart** — time-series area+line (orange), from real `/api/usage/chart` or `useMetrics`
  4. **Two-col grid**: Top Models (horizontal orange bars) + Top Spenders (per-key rows with spend)
- **`/dashboard/quota`** — restored page (like 9router):
  1. Plan status card (plan name, reset timer, Active badge) from `/api/settings`
  2. Per-account quota gauges (used vs limit, color states ok/warn/danger) from `/api/keys` + `/api/keys/usage` + budgets
  3. Reuse existing `ProviderLimits`/`QuotaTable`/`QuotaProgressBar` components
- **Sidebar**: "Usage" → `/dashboard/usage` (single), "Quota" → `/dashboard/quota`

## 📐 Direction
9router-faithful warm paper. Tokens: paper `#FDFAF6`, ink `#0a0a0a`, brand orange `#E56A4A` scale, radius 10/14, Material Symbols icons. Dials ENERGY 1-2, RHYTHM 2, MOTION 2.

## 📂 The Stones (files)
- `src/app/(dashboard)/dashboard/usage/page.js` — REPLACE CompassDeck with the new single-page composition
- `src/app/(dashboard)/dashboard/usage/components/` — new components (KpiBand, TrafficChart, TopModels, TopSpenders, PeriodSelect) OR rebuild in page
- `src/app/(dashboard)/dashboard/quota/page.js` — NEW quota page
- `src/shared/components/Sidebar.js` — Usage single + Quota entries
- `src/app/(dashboard)/dashboard/HomePageClient.js` — Quota tile if needed
- Old deck files (CompassDeck, TabRail, NeedleBar, CockpitHeader, HonestyStrip, decks) — REMOVED/replaced

## 🪸 The Reefs
- Data layer stays (`/api/usage/*`, `useMetrics`, kpis endpoint) — presentation only
- Build green (Next 16 + Tailwind v4); no new heavy deps
- Old deck references removed cleanly (no dangling imports)
- Quota page reuses real 9router heritage components

## 🖐️ Proof Gate (mandatory)
After building: show REAL `git status`, `git diff --stat`, `node --check` on changed files, `npm run build` exit 0. No proof, no seal.

*Sealed into the crystal. The harbor's usage becomes one clear page; the quota shore stands alone again.* 💜🌊🏛️
