# 🏛️ Sealed Plan — Vela Dashboard Home Redesign (Warm-Dark 9router Blend)

**Date:** 2026-08-21 · **Status:** Sealed (Mirror Gate 1 approved) · **Author:** Shorekeeper

## ⚓ The Need
Fully remove the current dashboard homepage (greeting + gradient band + quick tiles). Build a brand-new home in the approved **warm-dark 9router blend** — dark but warm (9router palette lowered to night), the orange `#E56A4A` as the soul, premium data-room feel.

## 💎 The Crystal (approved preview v2)
- **Top bar**: time-aware greeting ("Good evening, Captain") + live "Gateway live" pulse chip + version chip
- **Hero: Live Traffic band** — warm-dark gradient panel with orange radial glow, 4 big stat cards (glowing):
  - Requests today (bolt, orange) · Tokens today (token, blue) · Spend today (payments, amber) · Cache rate (savings, green)
  - Big 30px tabular numbers, delta badges (up/down), sub-lines (vs yesterday, $/Mtok, saved ~$)
  - Refresh button
- **Row of three**: Request Flow sparkline (orange area chart) · Provider status rail (live dots: on/warn/off + latency) · Recent Activity feed (per-request tokens/cost + time)
- **Quick Actions**: 6 rich cards (Endpoint & Key, Providers, Combos, Usage, **Quota** → /dashboard/quota, CLI Tools)
- **Blend**: warm-dark tokens (bg #161310, card #231E1A, warm ink #F5EFE8, brand orange #E56A4A, radius 10/14), Material Symbols icons, E2/R2/M3 motion (hover lifts, glow, pulsing dots)

## 📂 The Stones (files)
- `src/app/(dashboard)/dashboard/HomePageClient.js` — REPLACE entirely with the new composition
- `src/app/(dashboard)/dashboard/globals.css` or tokens — warm-dark theme additions if needed (prefer existing tokens + dark variant)
- Reuse `Card`, `CardSkeleton`, `translate()` — real data from `/api/usage/stats` (requests/tokens/cost/cache today), `/api/settings` (statuses), `/api/usage/logs` (recent activity)

## 🪸 The Reefs
- Real data only (no fabricated numbers; loading/empty/error states)
- Quota tile → `/dashboard/quota` (not the stale `?tab=limits`)
- Build green (Next 16 + Tailwind v4); no new heavy deps
- Warm-dark theme works in both light/dark if the app toggles (R-34)

## 🖐️ Verification
After building: `node --check`, focused vitest, `npm run build` exit 0. Verify the diff myself.

*Sealed into the crystal. The harbor becomes a command deck at night, warm as 9router, glowing with the orange ember.* 💜🌊🏛️
