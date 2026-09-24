# src

The Next.js App Router layer — 35 pages and 198 API route handlers wrapped around the gateway engine in `open-sse/`. Read this before touching a page or a route.

## The app shape

| Piece | Path |
|---|---|
| Root layout — theme pre-paint script, providers, the ONE `globals.css` import | `src/app/layout.js` |
| Dashboard shell — mounts once, serves every dashboard page | `src/app/(dashboard)/layout.js` → `src/shared/components/layouts/DashboardLayout.js` |
| Middleware — runs before every matched request | `src/proxy.js` |
| Root redirect | `src/app/page.js` → `/dashboard` |
| Outside the group | `src/app/login/`, `src/app/landing/`, `src/app/callback/`, `src/app/dashboard/settings/pricing/` |

Measured 2026-09-24: **35 `page.js`** (30 under `src/app/(dashboard)/dashboard/`), **198 `route.js`** under `src/app/api/`.

Next **16.1.6**, React **19.2.4**. ⚠️ Next 16 renamed the middleware convention: `middleware.js` → `proxy.js`, and the exported function `middleware()` → `proxy()`. `src/proxy.js` is that file — it is the only middleware entry, and it just re-exports the guard (`export default async function proxy(request) { return dashboardProxy(request); }`).

`(dashboard)` is a **route group**: parentheses add no URL segment, so `src/app/(dashboard)/dashboard/page.js` serves `/dashboard`. The group exists to give every dashboard page one shared shell without changing any URL.

### The shell already owns the frame

`DashboardLayout` wraps every page in the group:

```jsx
<div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
  <div key={pathname} className="deck-enter max-w-7xl mx-auto">
    {children}
  </div>
</div>
```

**A page inside the group MUST NOT re-add `p-*`, `max-w-*`, or `mx-auto`.** Return a plain stack — `src/app/(dashboard)/dashboard/settings/page.js` opens with `<div className="flex flex-col gap-5">` and stops there. A second frame inside the shell's frame is the defect this rule exists to prevent.

Two shell behaviours you must not duplicate, both keyed on `pathname`:

- `/dashboard/basic-chat` drops the padding *and* the `max-w-7xl` — it gets `flex-1 w-full h-full flex flex-col`, because a chat room needs the whole column.
- `key={pathname}` on the `deck-enter` wrapper is **load-bearing, not decoration**. A CSS animation runs on mount, and React otherwise reuses the element across a route change (only children differ) — so without the key the page entrance plays once per browser session instead of once per navigation. And do not add a second `deck-enter` inside a page: the wrapper's `> :only-child > *` selector already reaches a single-root page's children, so the inner class would stack the same keyframe on the same elements.

The shell root uses `h-dvh`, **never** `h-screen`. Tailwind emits `.h-screen` after `.h-dvh`, and `cn("h-screen h-dvh")` collapses to one group member, so a class list carrying both resolves to `100vh` — which scrolls under the iOS/Android URL bar. The fallback is a `@supports not (height: 100dvh)` block in `globals.css`, not a second class.

## Route handlers

Every endpoint is `src/app/api/**/route.js` exporting HTTP-named functions (`GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`). Only `route.js` is a route; anything else in the folder is an ordinary module. The house names for those are `_lib/` (shared route logic — `src/app/api/keys/_lib/keysApi.js`), `redact.js`, `testUtils.js`. Put shared-write logic in `_lib/`, never in a second `route.js`.

Add `export const dynamic = "force-dynamic"` when the handler must not be cached (**56** route files do, measured 2026-09-24; `src/app/api/settings/route.js` also sets `revalidate = 0` and sends `Cache-Control: no-store`). Handlers return `NextResponse.json(...)`.

### The guard — `src/dashboardGuard.js`

One chokepoint, reached through `src/proxy.js`, matching `/((?!_next/static|_next/image|favicon\.ico).*)`. Read it before adding any route; the branch a path falls into decides its auth, and there is no per-route opt-out.

Order of checks inside `proxy()`, top to bottom:

1. **CSRF second lock.** `isCrossSiteMutation()` — a request the *browser itself* labels `sec-fetch-site: cross-site` carrying POST/PUT/PATCH/DELETE → **403**, above every auth branch, because `ALWAYS_PROTECTED`'s routes are the ones most worth forcing. Exempt (by design, cross-site callers holding no CSRF-able cookie): `/api/auth/saml`, `/api/auth/oidc`, and the LLM prefixes `/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses`. A caller sending **no** `Sec-Fetch-Site` at all (curl, the CLI, another agent) is never caught.
2. **Local-only wall** — `isLocalOnlyRoute()`: `LOCAL_ONLY_PATHS` (the spawn-capable and host-modifying routes: the headroom and pxpipe lifecycles, the tunnel install/enable/disable set, `/api/mcp/`, `/api/cli-tools/cowork-settings`, `/api/cli-tools/antigravity-mitm`, `/api/auth/reset-password`) plus `CLI_TOOL_WRITER_RE = /^\/api\/cli-tools\/[a-z0-9-]+-settings$/` — matched **by shape, not by name**, because every one of those writers edits a file in the operator's own home (`~/.claude/settings.json`, `~/.codex/config.toml`, …). Refusal is **403**.
3. **`ALWAYS_PROTECTED`** — JWT (or a *local* CLI token) required **regardless of `requireLogin`**: `/api/shutdown`, `/api/settings/database`, `/api/version/{shutdown,update}`, `/api/oauth/{cursor,kiro}/auto-import`, `/api/pricing/sync`, `/api/backup`, `/api/usage/metrics/export`, `/api/usage/views`, `/api/auth/sessions`. Prefix-matched with `startsWith`.
4. **Public LLM API** — `PUBLIC_PREFIXES` + `PUBLIC_API_PATHS`; `?key=` in the query is refused here with **400** (`query_param_key_rejected`). Bearer key only.
5. **`/api/proxy-pools` fail-closed gate** — method-aware: only the exact `PROXY_POOLS_POSTURE_READS` on GET pass; every mutation and unlisted read needs a JWT, a local CLI token, or local origin + session.
6. **Deny-by-default for `/api/*`** — anything not named above passes when `hasLocalCliToken(request) || isAuthenticated(request)`, and **`isAuthenticated` returns true whenever `requireLogin === false`**. This is the branch most dashboard reads ride.

Two rules that bite:

- **Locality before credential.** The CLI token is `x-vela-cli-token`, a machine-derived value (`getConsistentMachineId("vela-cli-auth")`, constant-time compared). It proves *proximity to the box*, nothing more — `hasLocalCliToken()` refuses it from a non-local origin. A remote caller presenting it is **403 forbidden**, not 401 unauthenticated (`presentsRemoteCliToken`). Keep that distinction if you add a branch.
- **`isLocalRequest` is unspoofable** because it needs the socket-derived `x-9r-real-ip` proven by the per-process `x-9r-peer-token` (see `@/lib/auth/trustedPeer`) plus a loopback Origin. `Host` alone is spoofable and is only trusted under `NODE_ENV === "development"`.

### The settings write door

`PATCH /api/settings` is the dashboard's single settings mutation, and it is a **trusted store**: a planted `outboundProxyUrl` re-routes every upstream call. It applies, in order: strip `PROTECTED_SETTING_KEYS` (`password`, `mitmSudoEncrypted`) → hash `newPassword` (bcrypt, verifying `currentPassword` first when one is set) → normalize `oidcClientSecret` → deep-merge `budgetAlerts` (shallow merge on a nested object would clobber stored webhook URLs) → then **drop every key not in the allowlist**:

```js
const ALLOWED_SETTING_KEYS = new Set(WRITABLE_SETTING_KEYS); // @/lib/db/repos/settingsDefaults.js
const droppedKeys = Object.keys(body).filter((k) => !ALLOWED_SETTING_KEYS.has(k));
```

The allowlist runs **after** the shaping branches so their work is not undone and **before** the write so nothing unnamed is persisted. To add a setting: declare it in `settingsDefaults.js`; never widen the check.

## The room pattern — one room, many lenses

A room is a `page.js` that answers several questions, each on its own tab. The reference implementation is the keys console: `src/app/(dashboard)/dashboard/endpoint/page.js` → `EndpointPageClient.js` → `components/keys/` (`KeysMasthead`, `KeyRail`, `KeyToolbar`, `KeysCard`, `KeyTable`, `KeyDetailDrawer`, `BulkActionBar`).

The contract, in four parts:

1. **`TabBar` owns navigation.** `@/shared/components/TabBar` (`src/shared/components/TabBar.js`) renders `role="tablist"` with roving tabindex and Arrow/Home/End keys. Each tab emits `aria-controls="panel-<id>"` — so **the panel must carry `id={`panel-${id}`}` and `aria-labelledby={`tab-${id}`}`**, or the tab promises a destination and delivers a jump to nothing.
2. **Lazy-mount, then never unmount.** `src/app/(dashboard)/dashboard/settings/page.js` keeps a `mounted` Set seeded with the first tab; switching tabs adds to it. `SettingsPanel` renders with **`hidden={!active}`**, never a conditional:

   ```jsx
   {TAB_IDS.filter((id) => mounted.has(id)).map((id) => (
     <SettingsPanel key={id} id={id} active={active === id}>{panels[id]}</SettingsPanel>
   ))}
   ```

   A visitor who never opens Single Sign-On pays no request for it; a visitor who does and then wanders to Routing does not lose a half-typed issuer URL. The alternative — hoisting the state above a conditional switch — is what the endpoint room does for its deck, and it works, but it means every piece of surviving state must be lifted deliberately.
3. **The lens lives in the URL.** Write it with `replaceState`, not `pushState` — tab switching is not a navigation, and a back button that walks five tabs is a worse lie than a stale URL. Read it once on mount from `window.location.search`.

   ⚠️ **Do not use `useSearchParams()` here.** It forces the page behind a Suspense boundary, and these rooms need the value once, on mount. The house helper is a plain `tabFromUrl()` guarded by `typeof window === "undefined"` and validated against the tab-id list.
4. **A moved route keeps its file.** `redirect()` from `next/navigation`, not a deletion — bookmarks and muscle memory are real users:

   ```js
   // src/app/(dashboard)/dashboard/proxy-pools/page.js
   export default function ProxyPoolsPage() { redirect("/dashboard/proxy?tab=fleet"); }
   ```

   Same shape in `profile/page.js` (`/dashboard/settings`) and `proxy-fitness/page.js` (`/dashboard/proxy?tab=fitness`). When one room swallows another, redirect into its lens.

Reaching into a tab from elsewhere (a banner's "Enable" link) must map the old anchor to the room that actually owns it — `EndpointPageClient.js`'s `HASH_TO_TAB` exists because `#require-api-key` pointed at a card that moved to Keys, and a `preventDefault`-ing hash link that scrolls to a missing id goes nowhere at all.

## Client/server boundary

`src/app/layout.js` is a server component. Everything under `(dashboard)` is effectively client: the group's layout and most pages carry `"use client"`, and page wrappers are thin (`endpoint/page.js` is three lines importing `EndpointPageClient`).

- `"use client"` at the top of the file; hooks, event handlers, `window`, `localStorage`, and the notification store all require it.
- Server components may import plain data with no `window`/`document` access — `@/shared/constants/config` is imported into `layout.js` for exactly this reason, and `@/shared/services/bootstrap` self-guards with `typeof window === "undefined"`.
- `localStorage` throws in private mode. Wrap it (`try/catch`) or use the deck; a dashboard should not care.

**Fetch through a deck, not from a panel.** A room has exactly one data current:

| Deck | Room | Owns |
|---|---|---|
| `useSettingsDeck` (`settings/hooks/`) | `/dashboard/settings` | the settings read, the single `patch()` write, and `pending` keyed **by setting name** (so saving the proxy does not dim the theme switcher two tabs away) |
| `useKeyDeck` (`endpoint/hooks/`) | `/dashboard/endpoint` Keys lens | filters, selection, open drawer, import ceremony, and every named mutation |

Every lens reads the same object, so no lens can hold a private opinion about what a key's posture is. Until v0.9.88 the row and the delete button each carried their own copy of the confirm; that is the defect the pattern exists to prevent. New lenses call the deck's functions; they never `fetch`.

Shared HTTP helpers live in `@/shared/utils/api` (`get`/`post`/`put`/`del`), which throws on `!response.ok` and attaches `error.status`. In-flight state belongs on the deck, not the panel.

### Where the shared shore lives

`jsconfig.json` (and `tsconfig.json`) map `@/*` → `./src/*` and `open-sse*` → `./open-sse/*`. Use the alias, never a deep relative climb that reaches out of `src/`.

| Path | What lives there |
|---|---|
| `src/shared/components/` | The primitives — `Button`, `Card`, `Input`, `Select`, `Modal`/`ConfirmModal`, `Drawer`, `TabBar`, `Toggle`, `Badge`, `Loading`/`CardSkeleton`, `Sidebar`, `Header`, `ThemeProvider`/`ThemeToggle`. Exported through `index.js`; import from `@/shared/components`. `Sidebar` and `Header` mount from `DashboardLayout`, so anything added to them appears on all 30 pages. |
| `src/shared/components/layouts/` | `DashboardLayout` (the shell), `AuthLayout` — re-exported by the barrel via `export *`. |
| `src/shared/hooks/` | `useFocusTrap`, `useScrollLock`, `useCopyToClipboard`, `usePageVisible`, `useModelCaps`, `useTheme` — cross-room behavior, not room state. |
| `src/shared/utils/` | `api`, `cn` (class merge), `timingSafeEqual`, `ssrfGuard`, `keyVault`, `machineId`, `providerIcon`/`providerModelsFetcher`, `sanitizeHtml`. |
| `src/shared/constants/` | `config` (app config + `THEME_CONFIG`), `providers`, `models`, `colors`, `cliTools`, `locales` — plain data, safe to import from a server component. |
| `src/shared/services/` | Boot-time services: `bootstrap` (self-guards on `typeof window`), `initializeApp`, `backupScheduler`, `mirrorStartup`, `quotaAutoPing`. |
| `src/i18n/runtime` | `translate(key)` — every user-visible string in a room goes through it. `src/app/layout.js` wraps the tree in `RuntimeI18nProvider`. |

State stores are Zustand, under `src/store/` (`notificationStore` drives the shell's toasts; `headerSearchStore` feeds the header search).

## The design system

**Tokens live in `src/app/globals.css`** — `:root` + `.dark` blocks plus an `@theme inline` mirror that exposes them to Tailwind. Imported once, in `src/app/layout.js`. A new surface goes through tokens; **never a raw hex in a component**.

- **One accent.** Coral `--color-brand-500: #E56A4A`, aliased as `--color-primary`. It survives unchanged into `.dark` (the two declarations are identical), so one declaration serves both themes. Surfaces are warm neutrals (`--color-bg` `#FDFAF6` light / `#1a1a1a` dark), text is `--color-text-main` / `--color-text-muted`.
- **Material Symbols** — class `material-symbols-outlined`, glyph named by its ligature (`<span className="material-symbols-outlined">vpn_key</span>`). Always `aria-hidden="true"` on decoration: the DOM text *is* the icon name, so a screen reader otherwise announces "check_circle Rule deleted".
- **The icon subset is closed.** The font is a GSUB-pruned subset (`public/fonts/vela-icons.<sha16>.woff2`) covering exactly the names in **`scripts/icon-ligatures.txt`** (246 at 2026-09-24). A glyph outside that inventory has no ligature in the subset, so **it renders as raw text** — the string `add_link`, not a symbol. To add one: append the name, re-mint with `py -3.12 scripts/subset-icons.py` (writes the font, rewrites the `@font-face` src in `globals.css` to the new content-hashed name, and updates `scripts/icon-subset-manifest.json`), then commit all three. `py -3.12 scripts/subset-icons.py --check` exits non-zero on drift; `tests/unit/icon-subset.test.js` guards that no `src/` icon literal falls outside the list.

### Motion — three rungs, all from `--motion-*`

A `duration-*` class cannot reach a custom property (Tailwind v4 declares no `--duration-*` namespace), so the ladder is a set of declared classes in `globals.css`:

| Class | Rung | For |
|---|---|---|
| `.motion-control` | `--motion-dur-instant` (120ms) | a control answering a pointer — hover, press, focus, open/closed |
| `.motion-enter` | `--motion-dur-quick` (180ms) | a popover, menu or drawer arriving |
| `.motion-fill` | `--motion-dur-base` (320ms) | **the one place geometry animates on purpose** — a meter, a progress bar, a tab indicator. Only elements whose *purpose* is to move geometry. |

Properties are enumerated, never `all` — `transition: all` drags layout properties into a one-frame hover and reflows the row. `prefers-reduced-motion` is clamped globally for `*`, so no consumer adds its own guard.

The page entrance (`.deck-enter` + `deckEnter`) is welded into the shell, keys on `pathname`, and is **`backwards`-filled — never `forwards` or `both`**. A filled animation leaves `transform` live forever, which makes the wrapper a *containing block* for `position: fixed` descendants; the dashboard mounts 29 inline `fixed inset-0` modals with no portal to escape through. `tests/unit/deck-motion.test.js` defends exactly this.

### Contrast floors

WCAG is a floor, not a preference, and this repo measures rather than asserts:

- **Text: 4.5:1** (SC 1.4.3). **Non-text signal — icons, borders, focus rings, status dots: 3:1** (SC 1.4.11).
- The login gate is the worked example: every colour became a `--login-*` token (documented in `docs/design/login-tokens.dtcg.json`), and each one carries its measured ratio in the comment — `--login-cta: #c04e30` is `4.80:1` for white text, because brand-500 was `3.23:1` and failed.
- Global focus is `:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px }` in `@layer base`; components add `focus-visible:shadow-[var(--shadow-focus)]`.
- ⚠️ `--color-success` is declared **twice** (`#10B981` light, `#22c55e` dark). Never assume the light value — read the theme block you are in.

## Traps

**1. React reserves `key`.** A prop literally named `key` is stripped before your component runs — it arrives `undefined`, and the signature looks correct. v0.9.89 shipped a key room that died on first render this way (`ScopePill`/`LimitPills` each took `{ key }`); the same reservation was also painting *"Encountered two children with the same key"* on every render. **Name it `k`** — the house convention (`KeyBits.js`, `KeyCard.js`).

**2. A name declared and never resolvable.** A named import whose target module does not export it is **tolerated by webpack and refused by Turbopack**. `next build` (webpack) compiles it; the browser walking a Turbopack dev server gets a 500. Three rooms died this way in v0.9.88–.91. `npm run dev` = Turbopack; `npm run dev:webpack` is the escape hatch. Rows to watch for: a re-export block missing one of a pair, a wrong relative root (`../lib/` where the law is `../../lib/`), an identifier that appears exactly once repo-wide.

**3. `no-undef` is a hand-run instrument.** `eslint.config.mjs` spreads `core-web-vitals`, whose ruleset has no `no-undef`; the repo added the rule explicitly (verified to bite on a planted bare name) but **there is no CI lint gate** — it fires only when someone runs `npx eslint`. Never treat a green build or a green suite as coverage for a bare identifier. The executed guards are the render suites under `tests/unit/*.test.jsx`, and a room no test renders is covered by nothing.

**4. The ghost route.** A dev server started *before* you deleted or renamed a `page.js`/`route.js` keeps its module graph in memory and serves the dead route from it — usually a **500**, often with the old markup *and* the not-found marker in the same response, and sometimes with unrelated pages rendering empty because the stale handle is also holding a DB connection. The strongest tell is a failure in a surface you did not edit. Confirm, then restart:

```bash
netstat -ano | findstr ":32060" | findstr "LISTENING"      # holder PID
curl -s -o /dev/null -w "%{http_code}" http://localhost:32060/<deleted-route>
# 500 on a route you deleted = ghost. 404 = the tree is honest.
```

Kill the holder, start fresh, re-probe. `next build` is the independent authority — it reads from disk — so cite the built route table, not the dev server, as proof a route is gone. **Dev port is 32060** (`npm run dev`, `start`); the Playwright `reuseExistingServer` habit makes it easy to test whatever already holds the port.

**5. `useSearchParams()` costs a Suspense boundary.** In these rooms the value is needed once, on mount, and never re-renders on an external query change — read `window.location.search` in a lazy initializer instead (see the room pattern above).

**6. Don't re-frame a page.** The shell already provides the padding (`p-6 lg:p-10`) and the `max-w-7xl mx-auto` column; adding either inside `(dashboard)` gives the page a second frame inside the first. The only element the shell excludes is `/dashboard/basic-chat`, which it detects by `pathname` — so a page cannot opt itself out.
