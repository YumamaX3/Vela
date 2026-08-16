# Phase 13 — Security Storm: The Compass Deck

STRIDE across every new surface. The design inherits dashboardGuard (deny-by-default, JWT-or-requireLogin) and adds specific legislation from R8.

## New attack surfaces introduced

| Surface | Type | Trust zone |
|-|-|-|
| /api/usage/metrics/{kpis,timeseries,breakdown,percentiles,ledger} | read REST | PROTECTED_API_PATHS (JWT-or-requireLogin) |
| /api/usage/metrics/export | streaming CSV | **ALWAYS_PROTECTED** (JWT regardless of requireLogin) |
| /api/usage/views (W4 saved views) | write REST | ALWAYS_PROTECTED |
| SSE perProvider frame | server push | same-origin, session-gated stream |
| Needle filter URL params | client state | untrusted (reflected to SQL identifiers) |
| Request tags (W4) | user write | untrusted string → storage + UI + export |

## STRIDE

| Threat | Vector | Mitigation | Status |
|-|-|-|-|
| **S**poofing | Metrics endpoints without session | dashboardGuard /api/usage prefix → JWT-or-requireLogin; export/views ALWAYS_PROTECTED (JWT even when requireLogin=false) | ✅ covered by construction |
| **T**ampering | Sort/dimension/granularity/metric params injected into SQL identifiers | **Identifier covenant** (R8): frozen const maps, allow-list before interpolation, 400 on unknown; both twins inherit; never interpolate, only map-to-literal | ✅ legislated |
| **T**ampering | Request tags (W4) writing arbitrary strings | ≤64 chars, charset allow-list, parameterized named endpoint, HTML-escape-on-render | ✅ spec'd now |
| **R**epudiation | Budget/alert changes unaudited | W3 writes through settingsRepo (existing audit trail); alert deliveries logged | ✅ inherits |
| **I**nformation disclosure | Ledger/breakdown reads under requireLogin=false | Posture-consistent with 10 existing usage routes (settingsDefaults pins requireLogin=true); only export escalates — Gate-11 ANSWERED (R8) | ✅ consciously decided |
| **I**nformation disclosure | Drawer leaks raw request/response payloads | Inherits /api/usage/request-details redaction (one-liner, precedent verified) | ✅ legislated |
| **I**nformation disclosure | XSS via honesty strip / facet params | React text-node escaping (no dangerouslySetInnerHTML in tree); constraint pinned: no innerHTML enters this page | ✅ verified + constrained |
| **D**enial of service | Unbounded CSV export (full-table scan + stream) | Row cap honoring filter window + truncation note; 1 concurrent export/session; request timeout; coarse rate limit on metrics/* | ✅ legislated |
| **D**enial of service | perProvider per-event DB scan | ≤30s server memo; sendPending consumes cache (R5) | ✅ fixed |
| **D**enial of service | 'q' unbounded LIKE on 100k rows | Parameterized LIKE, %/_ escaped, 100-char cap | ✅ legislated |
| **E**levation of privilege | CSV formula injection (=,+,-,@ cells execute in Excel) | Quote all cells + prefix-pad leading tab; Content-Disposition: attachment fixed filename | ✅ legislated |
| **E**levation of privilege | CSRF-forced CSV download via cookie-auth GET | Bounded by throttling; unreadable cross-origin without same-site XSS; acceptable residual (recorded) | ⚠️ accepted residual |

## Residual risks (accepted, recorded)
- CSRF-forced export download: bounded, unreadable cross-origin — accepted.
- requireLogin=false deployments expose ledger reads to LAN: posture-consistent, documented; operator's explicit choice.

## Verification obligations
- Identifier covenant: one test per frozen map rejects an unknown value with 400 (both twins).
- CSV escaping: test asserts =,+,-,@-leading cells are padded.
- Export throttling: test asserts concurrent-export rejection.
- Redaction inheritance: test asserts drawer payload matches request-details redaction.

**No unguarded crossing. Every STRIDE threat has a named mitigation or a recorded acceptance.**
