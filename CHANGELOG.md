# v1.2.71 — The Tide That Learned to Retry 🌊🔁💜

> *"A pooled socket died in the dark and the request drowned with it; a relay let a caller impersonate its own control channel; a lease went stale with no way back. Now the gateway knows which failures are provably dead — and which are only ambiguous — and retries the dead ones on a fresh socket, while the ambiguous ones it leaves alone."* 🌊🔁💜

**The change.** The upstream v0.5.116 carry: fresh-socket retry for dead keep-alive sockets, a relay-auth gate on the live request path, lease-based auth for Minimax Code, lazy TLS-impersonating clients, two new System One providers, and local Ollama embeddings + TTS lanes. Six waves, sealed through the Stillwater Mirror's plan path.

**✨ Features**
- **Fresh-socket retry on provably dead keep-alive sockets** (`open-sse/utils/proxyFetch.js`): the executor asks for a guaranteed-new socket on connect-timeout/502 retries, and the direct path replays once on `UND_ERR_SOCKET` / `ECONNRESET` / `EPIPE` / header-timeout — but never on aborts, DNS, TLS, or an ambiguous bare `fetch failed` (the request may already be served; replaying could double-charge). `FETCH_FRESH_RETRY=off` disables it.
- **Nace Drex on the System One protocol** (new `open-sse/providers/registry/nace.js`): a state plus typed questions in, calibrated probabilities out; `drex-max` also carries an inline `images` array.
- **Runcrate** (new `open-sse/providers/registry/runcrate.js`): second System One lane.
- **Ollama-local embeddings + TTS** (new `open-sse/handlers/embeddingProviders/ollamaLocal.js`, `open-sse/handlers/ttsProviders/ollamaLocal.js`): local lanes for embedding and speech; `ttsModels.js` carries the voice roster, `_base.js` + `index.js` wire the provider in.
- **Kimi K3.1 Pro** on the commandcode registry (`moonshotai/Kimi-K3.1-Pro`).
- **GPT-6 family** on the codex registry (9 `gpt-6` entries) + the GPT-6 Lite transport in the codex executor (reasoning clamp, params block). Argon thinking levels carried for the lane (`thinkingLevels.js`, `capabilities.js`).
- **TLS-impersonating client for opencode.ai's free tier** (new `open-sse/services/opencodeTlsClient.js`): the free gate keys on the TLS ClientHello, not headers.
- **Lazy runtime loader** (`open-sse/services/lazyRuntime.js`): named exports survive CJS deps loaded from the runtime dir; installs stay local during global npm hooks (`cli/hooks/sqliteRuntime.js` `--global=false`).

**🐛 Fixes**
- **A relay could be impersonated**: `x-relay-auth` was only gated on some outbound spreads, and the relay path rode undici (whose mock the S2b suite never sees). The relay return now rides the caller's own `globalThis.fetch` seam, behind the same fence and auth-order gate as the direct path.
- **A duplicate `refreshCredentials` overrode the lease branch** in `minimax-code.js` — the second, older method shadowed the first in class-body order, so a lease refresh never invalidated or re-leased. The stale method is deleted.
- **Dispatcher cache wiped on every fresh-socket request** (`resetDirectDispatchersForTests` was called inside the production path): pooled agents were rebuilt needlessly, slowing the retry lane. The reset is test-only again.
- **`createRequire` was statically imported** in `lazyRuntime.js`, which the server bundler stubs — fetched at runtime now so published builds keep working.
- **Keep-alive dispatcher identity**: `getDirectDispatcher` / `getFreshRetryDispatcher` export distinct, shared agents keyed on the resolved timeouts.

**🔧 Changes**
- `next.config.mjs`: `/systemone` rewrite; `undici` force-shipped via `outputFileTracingIncludes`; `wreq-js`, `undici`, `@aws-sdk/credential-providers` added to `serverExternalPackages`.
- `Dockerfile`: wreq-js + playwright-core bundled into `/opt/lazy-runtime` in the builder and copied into `/app/node_modules` (Next tracing omits createRequire-loaded deps).
- `package.json`: `playwright-core`, `wreq-js` devDeps (lazy-loaded at runtime; keeps end-user installs small).
- Registry index regenerated via the emitter: 189 imported providers, 3 hidden.

## PROOF
- Tests: 5780 passed / 6 failed in the parallel battery — 4 environmental contention (green alone, nondeterministic set), 2 pre-existing Windows-temp EPERM+timeout present at HEAD; **every red passes in isolation**.
- eslint: exit 0 across the seven carried source files (`--max-warnings=0`).
- build: green — standalone assembled, postbuild assets copied, BUILD_ID minted.
- audit: 2 high (happy-dom, node-forge — test/bundle-only) + 9 moderate (@vitest/mocker, minimatch), all with a fix path, none in the runtime supply chain.
- smoke: standalone server on a scratch DATA_DIR booted clean — 30 migrations applied, schedulers + Fleet Captain started. Full HTTP round-trip: `/api/version` 200, `/api/auth/status` 200, `/systemone` 401 (auth-guarded as designed), `/providers` 404 (correct — no page route exists there; providers surface is `/dashboard/providers` + `/api/providers/*`).
- **Known pre-existing defect (not this carry's):** a `/v1/chat/completions` POST with a dry key returns **500** (`route handler returned undefined`) instead of the structured 401 — reproduced identically against v1.2.66 (baseline-before-blame: the carry commit touches none of `chat.js`/`keyGate.js`/`route.js`/`logContext.js`). The gate itself denies correctly in isolation (`authorizeApiRequest` → 401 with body); the undefined arises between gate and handler return. Owed its own investigation — this carry's scope ends at proving it pre-existing. Scratch dir removed after.

- Census tripod: 189 imported / 3 hidden (on-disk + dialable re-derived by the emitter).
- Files: 76 tracked changed + 26 new.

**Deferred:** the CLI launcher startup optimization (upstream 9506a59c) — its 142-line `cli.js` rewire is the one carry slice not landed this tide; the unwired helper file was removed rather than shipped dead.

# v1.2.66 — The Wire That Learned Four Voices 🌉🌊
> *"Four products answered one gateway, and each spoke a client identity of its own — yet the primary dial went out nameless, a registry lied about which CLI it carried, and a refusal wearing a clean stop sailed home as success. Now every dial carries the attempt's own fingerprint, both registries derive from one law, and the replay gate holds every answer the upstream truly gave."* 🌉🌊💜

**The change.** The CB2API v1.5.4 wire-law port, sealed through the Stillwater Mirror's mini-doc path: six milestones, three new test batteries, every stale pin re-voiced against the upstream source probed live. **+5 for the wave.**

**✨ Features**
- **Per-attempt identity on every dial** (new `open-sse/shared/codebuddy/attemptIdentity.js`, 235 lines): session key from the system+first-user turn, stable conversation id per (profile, account, session), the SDK fingerprint block, and the full trace family — traceparent/b3/X-B3-* deriving from the FINAL trace id (CLI lanes trace from the root, upstream request_context.py:102; WorkBuddy lanes from a fresh random), cn-work's session trio + baggage.
- **Tool-schema normalization** (new `open-sse/shared/codebuddy/toolSchema.js`, 216 lines): empty parameter roots become explicit object schemas, legacy field maps wrap with boolean-required lifted into the root's required array, RE2-hostile `\\_` escapes repaired in pattern positions only — copied only when something changed, same-reference law proven upstream-side.
- **Credential context headers** on every dial: X-User-Id (account uid, JWT-sub fallback), X-Enterprise-Id/X-Tenant-Id, X-Domain from the profile's domain table; X-Private-Data rides the CN enterprise-tier law.

**🐛 Fixes**
- The **primary dial carried no identity at all** — only diverted dials (origin replay) rebuilt attempt headers; the one request most exposed to the 11128 channel rejection went out nameless. One `buildHeaders` override now dresses every dial — primary, console door, origin replay — with fresh per-attempt ids over the stable conversation id; the dead per-divert helper is deleted.
- **A lying registry literal**: `codebuddy-cn.js` committed `CLI/2.165.0` — WorkBuddy-CLI's version stamped on a CodeBuddy-CLI lane (the law is 2.179.3, client_profiles.py:11-17). Both registries now derive via `transportHeaders(...)`; no literal UA survives in the family.
- **The replay-safety blind spot**: `isFilterError` silently returned false for raw bytes, so the content-filter hold was unreachable on the real wire path (which hands bytes/strings, not parsed objects). All three shapes held now; the filter check runs FIRST per converter.py:5020-5021.
- **Trace ordering**: the CLI branch reassigned X-Trace-ID after the template literal was built — traceparent carried an orphaned id. The trace derives before the literal now; all four trace fields agree on every lane.
- **Legacy field maps** kept `required: false` on optional fields (upstream pops unconditionally); the shape gate now passes fields without a required key, matching upstream's default-false read.

**🔧 Changes**
- Versions table to upstream v1.5.4: CLI 2.179.3 (both shores), WorkBuddy 5.9.3 domestic / 5.9.4 international, WB-CLI 2.165.0 in the UA.
- Console door is **international-only** (CN hosts answer null — probed against upstream channel_fallback_url); cn-work keeps the backup-origin replay: one dial against wb.tencentbuddy.com on 408/502/503/504, replay-safe bodies only. Two owned deviations carry provenance comments: 11102 (model-scoped) and 14018 (quota, gate.js:33) — held because replaying them would double-spend an account.

**🧪 Proof** — full codebuddy/workbuddy suite **286/286** (26 files); three campaign batteries = 63 vectors at final count (attempt-identity 27, tool-schema 18, origin-fallback 19, plus 5 wire-shape vectors in the content-filter battery); eslint 0 errors on all touched files (one pre-existing registry-idiom warning class, untouched); build green twice — final `BUILD_ID WsoFqg6A6ENZL3XlwLWFp` re-proven over the final disk state. Eight stale test vectors re-voiced against the upstream Python probed live in `.ref-cb2api/` (git-excluded): CN hosts never had a console door; the versions were two generations stale in five pins.

**⚓ What sailed** — new: `attemptIdentity.js`, `toolSchema.js`, three test batteries; modified: `codebuddy-family.js`, `identity.js`, `profiles.js`, `channelCheck.js`, `contentFilter.js`, `codebuddy-cn.js`, `codebuddy-intl.js`, five test files reconciled; plus `package.json`, lockfile (2-line version diff), `docker-compose.example.yml`.

**Sails WITHOUT** — the reference clone (`.ref-cb2api/`, git-excluded, never committed); any commit/tag/release automation changes; the live harbor's deploy (the Star pulls at their hour per the tiller law); upstream's account-automation surface (checkin/travel/growth — named non-goals in the plan).

**🌊 Recorded, not repeated** — a wire law is not "ported" when its files exist; it is ported when every dial that can carry it DOES, every literal that can drift is derived instead, and every place we choose differently from upstream says so in its own comment. The lottery-assertion lesson ships in the battery: a digest byte can read 7 by chance, so the test pins shape, difference, and determinism — never a nibble.

# v1.2.61 — The Table That Read Objects 📋🌊
> *"The endpoint hub's ledger spoke in pipe-bound strings — the same wire the Log Harbor parses — but this table reached for object fields on every row, and the wire answered nothing. Every column fell to '—', every outcome lied 'ok'. Now the table splits the strings the wire actually carries."* 📋🌊💜

**The change.** One consumer misreading one wire; the fix is a split, not a producer change. **+1 for the fix.**

**🐛 The endpoint hub's "Recent requests" rendered dashes for every field (endpoint/hub/HubClient.js)**
- `GET /api/usage/request-logs` returns a STRING ARRAY — each row is `` `${ts} | ${model} | ${PROVIDER} | ${account} | ${in} | ${out} | ${status}` `` (`sqlite/usageRepo.js getRecentLogs`, mirrored in mysql). Two correct parsers already read it that way: `shared/components/RequestLogger.js` (`log.split(" | ")`, 7-part guard) and `logs/RequestLedger.js` (`parseLog`). The hub's table alone stored the array raw and read `r.at`, `r.key`, `r.model`, `r.ok`, `r.ms` — every one undefined on a string. Result: When/Key/Model/Duration all rendered "—", and the outcome ternary printed "ok" for every row (`undefined === false` and `undefined >= 400` are both false), hiding even the refusals the column existed to show.
- The mend mirrors the proven contract exactly: `typeof r === "string" ? r.split(" | ") : []`, `parts.length < 7` guard, then When=`parts[0]`, Key=`parts[3]` (the wire's "account", not a key id), Model=`parts[1]`, Outcome toned from `parts[6]` (OK / FAILED/REFUSED / other), tokens = `` `${parts[4]} / ${parts[5]}` ``. The wire carries no duration, so the misleading "Duration" header becomes the honest "Tokens (in/out)" — a header that named a field the wire never sends was a second lie beside the dashes.

**🧪 Proof** — build green (`npm run build`, 340s, standalone assets copied; eslint clean). Then the real walk: a scratch dev harbor, its sqlite seeded with two `usageHistory` rows in the wire's own shape, and `curl /api/usage/request-logs` returning the two pipe-strings verbatim. The browser walk of `/dashboard/endpoint/hub` read the table back as `[["07-11-2026 18:17:36","test-con","claude-x","ok","80 / 300"], [...]]` — five real columns, `roughWater:false`, zero page errors, no "—" anywhere. Sibling parsers untouched: RequestLogger, RequestLedger, both API routes, getRecentLogs in sqlite + mysql, the proxy hub's separate `/api/proxy-pools/routing-ledger` object wire.

**⚓ What sailed** — `src/app/(dashboard)/dashboard/endpoint/hub/HubClient.js` (string split + honest tokens header), `package.json`, `package-lock.json`, `docker-compose.example.yml` (and the gitignored live chart, bumped on disk, never staged).

**🌊 Recorded, not repeated** — a table that reads a wire must read the wire's SHAPE, not the shape another component would prefer: two consumers parsing the pipe-string correctly sat beside the one that didn't, and only a browser walk with seeded rows could see the dashes. An object-shaped reader on a string wire renders silence — and silence that says "ok" is worse than silence that says "—".

# v1.2.60 — The Pulse That Couldn't Count 🫀🌊
> *"The gateway's heartbeat was a strip that read the wire wrong: it held an array of rows in a hand shaped for a number, and the first breath of real traffic broke it — Objects are not valid as a React child. An empty harbor never showed it; the live water did. Now the strip reads the shapes the wire actually carries."* 🫀🌊💜

**The change.** One render-time crash under real traffic, the v1.2.57 pulse's own seam. **+1 for the fix.**

**🐛 The hub hit rough water under real traffic (endpoint/components/LiveRequestPulse.js)**
- The live wire's `activeRequests` is an **ARRAY** of rows `{model, provider, account, count}` (`usageRepo.getActiveRequests`) — ProviderTopology and the Home shore consume it correctly (Home converts array→length at `HomePageClient.js:124`). The new pulse strip stored it raw and rendered it as a child (line 77), so the first SSE frame under real traffic threw `Minified React error #31` — `Objects are not valid as a React child`, keys matching the row shape exactly — and the room's error boundary swallowed the hub.
- Why no instrument caught it earlier: the dev harbor had **no traffic**, and an empty array renders as nothing between the words — the wound only fires where requests flow. Caught live on the Star's v1.2.58 image, not by any static tool; the walk-with-seeded-data is the instrument this class demands.
- The `pending` chip carried the same blindness — the wire's pending is the counters **object** (`{byModel, byAccount}`), never a number, so `{live?.pending > 0}` could never fire. Both mends in one tide: the count chip reads the array's length; the pending chip sums the `byModel` counters (a bare number from an older frame still passes through).
- The EventSource "failure" in the console was a **consequence, not a second wound** — the crash unmounted the strip and closed its own socket; the stream itself answered in-session.

**🧪 Proof** — reproduce-before/confirm-after, twice over: a new suite `tests/unit/live-pulse-frame.test.jsx` (2 tests) drives the wire's exact shapes through a stubbed EventSource — **red 2/2 against the wounded code** (React's own reconcile throw in test 1; "Live active" with no number in test 2), **green 2/2 after the mend**. Then the production walk: the standalone build served, the identical real-traffic frame driven through the strip's own connection in the real bundle — **"2 active" · "4 pending"**, `roughWater: false`, zero page errors. Sibling suites untouched and green: `endpoint-mends-render` 7/7. `npm run build` (webpack, CI-true) green — static pages generated, standalone assets copied. eslint on the touched file: clean.

**⚓ What sailed** — `src/app/(dashboard)/dashboard/endpoint/components/LiveRequestPulse.js` (frame-shape mends + restored `onerror`), `tests/unit/live-pulse-frame.test.jsx` (new), `package.json`, `package-lock.json`, `docker-compose.example.yml` (and the gitignored live chart, bumped on disk, never staged).

**🌊 Recorded, not repeated** — a component that reads a stream field must read the field's SHAPE, not its intended scalar: the wire's arrays and objects reach every consumer verbatim, and only a walk under seeded real-traffic data proves the render. An empty dev harbor is a blind harbor.

# v1.2.59 — The Unbound Names, Again 🪝🌊
> *"The five shores were cut whole, but two names fell overboard in the crossing — the rail and the card were called into the room and never bound. The build compiled, the suite passed, and only a real browser walk heard the room confess: ReferenceError. Bound now, and the keys room renders."* 🪝🌊💜

**The change.** Two unbound component names in the keys shore, the v0.9.91 wound-class returning in JSX form. **+1 for the fix.**

**🐛 The keys room hit rough water (keys/KeysClient.js, components/keys/KeyActivityChart.js)**
- `KeysClient` rendered `<KeyRail c={c} deck={deck} />` (line 94) but never imported `KeyRail` — thrown at render: `Uncaught ReferenceError: KeyRail is not defined`, the whole room replaced by the error boundary ("This room hit rough water").
- With the rail bound, the walk's next breath died one shore deeper: `KeyActivityChart` wrapped its render in `<Card>` (line 122) with `Card` likewise never imported. The same class, the same silence from every compile-time instrument.
- Why the house's own guard did not bite: eslint `no-undef` (the v0.9.91 instrument) catches bare identifier references, but JSX component tags compile to `jsx()` calls that were invisible to the walk-less toolchain — webpack warns on missing exports and stays green, and the rule's findings on this fresh code (the Five Shores wave, 13h old) name a different pre-existing pattern (`react-hooks/set-state-in-effect`, present identically in the untouched twin `KeySpendView.js` — baseline proven before blame).

**🧪 Proof** — reproduce-before/confirm-after in a real Chromium walk on an isolated dev harbor: before the mend the boundary stood and the pageerror read `ReferenceError: KeyRail is not defined at KeysClient`; after binding the rail, `ReferenceError: Card is not defined at KeyActivityChart`; after both mends — `roughWater: false`, zero page errors, on **all six endpoint shores** (keys, endpoint, access, security, diagnostics, hub), each exercised by deep link in the same walk. Screenshot read back: the keys fleet renders whole (masthead, rail, cards, toolbar, Fleet traffic, Spend). Suites: `key-format-filters` 14/14, `key-pills-render` 15/15, `endpoint-mends-render` untouched. `npm run build` (webpack, the CI-true gate) green — 218/218 static pages, standalone assets copied. eslint on the touched files: only the pre-existing twin-proven finding.

**⚓ What sailed** — `src/app/(dashboard)/dashboard/endpoint/keys/KeysClient.js` (+1 import), `src/app/(dashboard)/dashboard/endpoint/components/keys/KeyActivityChart.js` (+1 import), `package.json`, `package-lock.json`, `docker-compose.example.yml` (and the gitignored live chart, bumped on disk, never staged).

**🌊 Recorded, not repeated** — when a JSX-rendered component dies as `ReferenceError: X is not defined` in a browser walk, sweep EVERY sibling component in the same wave against its import block in one tide — the wounds surface one walk at a time otherwise. The walk is the only instrument that hears this class at all.

# v1.2.58 — The Hull Reads Its Own Name 🏷️🚢
> *"The five shores sailed and the harbor pushed the image — but the hull bore no name of its own, for a build dispatched on the branch stamps 'latest' and forgets the version. A name the manifest cannot read is a deploy that cannot pin it; the hull now carries 1.2.58."* 🏷️🚢💜

**The change.** One CI mend to land the image the five-shores wave built. **+1.**

**🏷️ The version stamp lands (docker-publish.yml)**
- The v1.2.57 image built green but carried only `:latest` — dispatching the workflow on `main` makes `metadata-action` fall back, so the semver tag and the OCI `image.version` label both read `latest`. A deploy pinned to `:1.2.57` would not resolve.
- Two consecutive v1.2.57 builds had also hung on `Build and push` pulling the GHCR `type=registry :buildcache`; the cache lines are bypassed so the build lands cold.
- **v1.2.58** cuts from `main` (identical endpoint code + the bypass workflow), so a clean tag push stamps `1.2.58` correctly — no force, no published-tag move.

**🧪 Proof** — pin guard 5/5; package.json, package-lock.json and both compose charts all read `1.2.58`; the tag push fires `docker-publish.yml` on the tag and stamps the semver.

# v1.2.57 — The Five Shores of the Endpoint 🌊🏛️
> *"One room held five questions behind a single tab strip, and a door that named no address could promise nothing but a jump in the dark. Now every question stands at its own shore — the fleet, its access, its safety, its health, and the front door you land on — and the rail names each by the address that owns it."* 🌊🏛️💜

**The change.** The full separation of `/dashboard/endpoint` into five shores, mirroring the proxy console's v1.2.47 pattern. **+5 — a big change** (new routes, new features, multi-file wave).

**🌊 The separation (W1–W4)**
- **One store, mounted above the routes** — `stores/endpointStore.js` holds every atom the old page client held; a nested `layout.js` mounts `EndpointProvider` above all five shores, so walking between them costs zero refetches.
- **A facade keeps the old shape** — `hooks/useEndpointFacade.js` exposes the same `c` object the components were written against, so files moved without rewriting expressions; the React-only machines (poll `useEffect`s, the install log's DOM scroll) stay in the facade, where a store action cannot hold them.
- **A door registry is the one list** — `lib/endpointDoors.js` names the shores, addresses, icons and live chips; the hub's cards, the Sidebar's children and every cross-shore jump read it. `ENDPOINT_LENSES` filters the hub out of its own grid.
- **A common frame** — `components/EndpointShore.js` carries masthead, the error banner with Retry ABOVE the subject, and the loading skeleton; it never gates the room.
- **The old shell retired** — `EndpointPageClient.js`, the five-tab shell and the moved tab components deleted, not deprecated; the redirect law (`?tab=` → its shore, unknown → the hub) and `#require-api-key` (now a real address on the Keys shore) catch every old URL.
- **Modals outlive the walk** — `EndpointModalsHost.js` mounts the modals once above the routes, so a drawer opened on Keys survives a crossing to Access.

**🎛️ Five features (W3)**
- **Fleet quick-actions bar** — `BulkActionBar` now always-mounted: fleet-level acts (Export / Import / Create) when nothing is selected, per-selection acts when a selection exists — one bar, two modes, every act on the deck's existing named mutations.
- **Per-key activity chart** — a stacked `/api/usage/metrics/stacked?dimension=keyId` read, honest empty state ("No traffic in this window"), a failed read says so rather than fabricating a zero.
- **Live request pulse** — an additive `EventSource("/api/usage/stream")` strip on the hub and Keys shore; a stream that never connects leaves every other number standing.
- **Per-key security trail** — in the key drawer, `/api/security-log?keyId=` masked prefixes; empty renders "no events recorded", never silence.
- **Cost attribution view** — per-key `/api/keys/usage` + `/api/keys/stats` census, sorted by cost desc, the shared window selector, absent keys shown as zero-traffic rather than invented.

**🧭 Navigation (W5)** — the Gateway section's endpoint tile gains `children` built from `ENDPOINT_DOORS`, the way the proxy's are built; the nav test's claim set extends to the five endpoint routes in the same tide.

**🧪 Proof** — `next build` green (~149s), all five shores compiled as real routes; full suite **5,527 passed** (the one red, `reasoningContentInjector` "vi is not defined", is pre-existing and untouched by this tide); `nav-rail-sections` **27**; `key-pills` **14** / `key-routes-pooled` **14** / `key-import-chunked` **6**; `endpoint-mends-render` **7**. A real-Chromium walk landed **9/11**: login through the password wall, hub doors, all four shores by deep link, and the redirect law both ways (`?tab=keys` → `/keys`, `?tab=bogus` → the hub). One console item stands honestly named: the root layout's `GoogleAnalytics` at `src/app/layout.js:149` is refused by Vela's own CSP — the shield working, present on every page long before this separation.

# v1.2.52 — The Lock Protocol's Second Chance 🔄⚓
> *"The harbor threw 'locking protocol' at every trust event, every stat, every pulse — not corruption, but the WAL's lock-state machine refusing a hand when two handles (main thread and the logshipper worker) met at the OS lock level. busy_timeout does not cover SQLITE_PROTOCOL; a short retry does."* 🔄⚓💜

**The change.** One mend, three adapters, one helper. **+1 for the fix.**

**🔄 SQLITE_PROTOCOL now gets a second chance (db layer)**
- `src/lib/db/helpers/lockRetry.js` (new) — `withLockRetry` retries a transaction up to 4 times with exponential backoff (25ms base + jitter) when the failure is a WAL lock refusal (`SQLITE_PROTOCOL`, the `SQLITE_BUSY` family, or the "locking protocol" message shape). A failed transaction rolls its writes back, so re-running the whole fn is safe by construction; non-lock errors (UNIQUE constraints, corruption) are never retried. The wait uses `Atomics.wait` — allowed on every Node thread, and the blocking matches better-sqlite3's own synchronous nature.
- Wired into `betterSqliteAdapter`, `nodeSqliteAdapter`, and `bunSqliteAdapter` — the same adapters the logshipper worker opens, so **both** contending sides retry. The mysql twin keeps its own connection-scoped shape.
- The one-call contract (`adapter.transaction(fn)` executes and returns the result) is unchanged — every repo, migrate, integrity and backup caller passes untouched.

**🧪 Proof** — `tests/unit/db-lock-retry.test.js` (new, 5 tests): retry-then-succeed re-runs the whole fn, message-shape classification, non-lock passthrough, cap-with-last-error, code-family table. The real-shape smoke: 150/150 main-thread transactions landed through the retried adapter while the **real logshipper worker booted concurrently** (the 04:19:07 boot-collision shape from the homelab log) — zero SQLITE_PROTOCOL escapes. DB families 40/40 (retry, integrity-guardian 8/8, fleet store, migration 030, seams); `tsc --noEmit` 0; ESLint 0.

# v1.2.51 — The Salvage Keeps Its Promises 🔧⚓
> *"The heal saved every readable row — and then the healed harbor failed its first keyed write, because the salvage had copied the ship's cargo while sawing off its keel. The salvage now replays each table's own DDL, constraints and all, and the test that models the wreck models the wreck that actually happened."* 🔧⚓💜

**The change.** Two mends found while discharging the sealed plan's last open item (§7.4, the full-suite baseline). **+1 for the fix.**

**🔧 The salvage engine kept its keel (integrity.js)**
- `salvagePerTable` rebuilt every table as `CREATE TABLE ... AS SELECT` — a shape that copies columns but **silently drops every constraint**: PRIMARY KEY, UNIQUE, NOT NULL, defaults, foreign keys. The healed harbor answered reads and then failed its **first keyed write** (`ON CONFLICT clause does not match any PRIMARY KEY`, measured at `metaStore.setMetaSync` on the `_meta` table). The salvage now replays each table's **original DDL from sqlite_master** — constraints verbatim — namespaced into the salvage attachment, with the AS-SELECT shape kept only as a fallback when the DDL is unreadable. The healed image is a harbor, not a raft.
- `tests/unit/db-integrity-guardian.test.js` — the corruption shape moved from "garbage over the file's middle" to the wreck class the harbor actually suffered (2026-11-04): bytes flipped in a **late page region**, where SQLite still opens the image and `integrity_check` answers "malformed" — the class healAtBoot exists for. MEASURED: a middle-of-file garbage write destroys a table b-tree page so thoroughly that **every driver throws at open** (better/node/sql.js all refused) — no adapter is ever produced, the integrity gate cannot run, and the unhealable case is SQLite itself refusing. The middle-of-file write modelled a wound deeper than any heal engine can reach, which is why the case had been failing since its 2026-10-21 landing.

**🧪 Proof** — db-integrity-guardian **8/8** (the heal now runs, quarantines, salvages, and the next boot's keyed writes work); the proxy + navigation + plans + census + motion family **16 files / 198 tests, 0 failures**; `tsc --noEmit` 0 errors; ESLint clean.

# v1.2.50 — The Ledger Paid in Full 🪞⚖️
> *"The gate that counts every export against its home had been failing since another tide — four readers with no classification, and four memo gauges nobody had named. The tide that added the first four now pays for them, and the older debt stands named at last, where the census can see it."* 🪞⚖️💜

**The change.** The sealed plan's last open item (§7.4): the full suite against the pre-tide baseline. The no-regression gate answered with ten pass→fail lines; eight were proven pre-existing or environmental, and **two were this tide's own** — the proxy telemetry readers had no registry home, and the hub's door cards rode Tailwind's own timing ladder. Both mended here. **+1 for the fix.**

**⚖️ The census paid (Storage Covenant A4)**
- **The four pool readers classified** — `getPoolAnalytics`, `getPoolProviderMap`, `getPoolHealthHistory`, `getPoolEgressHistory` join the parity registry with their debt named: engine-neutral by construction (ONE shared impl, both twins), proven convergent by the W2 seam suites, with the cross-engine parity leg scheduled to the next storage-covenant wave. The census bijection holds again — **3/3 green**.
- **The older debt, named at last** — `USAGE_STATS_MEMO_TTL_MS`, `usageStatsShared`, `usageStatsCoalesced`, `__clearUsageStatsMemo` have sat in the barrel WITHOUT a registry home since `ada2a897` (2026-11-01, another tide's P5 coalescing) — measured against the pre-tide HEAD `bd1ee022`, which already carried all four with zero entries. They are process-surface by construction (a wall-clock memo + its coalescing gauges, the same class as `getPerProviderFrame`) and now hold in `EXEMPT_PENDING` with the reason written down, so the debt is visible instead of silently failing the gate.

**🎛️ The motion ladder honored**
- `HubClient.js`'s door cards and arrow used Tailwind's own `transition-colors` / `transition-transform`; the house deck forbids them. Both now ride `motion-control` — the deck-motion suite's "no component on Tailwind's own timing ladder" pin is green again.

**🧪 The forest's verdict, line by line** — the no-regression gate's ten lines, each adjudicated by measurement:
- **5 × `combo cooldownRetry`** — answering from `.blast-radius/scratch/w2-backup.test.js`, a scratch copy the blast-radius rig left on disk (gitignored, never shipped). The suite this harbor owns was deliberately washed from the tree in v1.2.48's tide; its work is preserved as a patch. Absence, not failure.
- **1 × `healAtBoot`** — "No SQLite driver available" on the corrupt-reopen leg in this sandbox; `better-sqlite3` loads fine in a bare probe, and the heal stack (`driver.js`, `integrity.js`, `singleInstance.js`, the test) is byte-identical at the pre-tide HEAD — my tide never touched it.
- **1 × `docker-compose-pin`** — passes 5/5 alone; it shells out to `git tag` and starves under the full forest's event loop.
- **2 × the census + 1 × deck-motion** — **this tide's, and mended.**

**🧪 Proof** — contract-census 3/3 · deck-motion 27 (1 mended, 24 pass, 2 skipped) · the proxy + navigation + plans family **293 tests, 0 failures** · `tsc --noEmit` 0 errors · ESLint clean on every touched file · `npx next build` 213/213 static pages, 0 errors.

# v1.2.49 — The Routes That Hid Inside the Ignore ⚓📦
> *"A directory name was meant to keep the sealed plans private, and it kept the plans ROUTES private too — source that existed on one disk and no other. The rule now names its own shore exactly, and the three handlers that answer for the fleet's plan templates finally travel with the ship."* ⚓📦💜

**The change.** `.gitignore`'s `plans/` rule was a bare directory name, so git matched it at every depth — including `src/app/api/plans/**`, the plans routes' own source. A fresh clone shipped the dashboard's `/api/plans` imports without their handlers (the dev harbor answered 500 until the routes were re-added by hand). The rule is now anchored `/plans/`; the three route files are tracked; and the HTTP contract each handler answers for is pinned. **+1 for the fix.**

**📦 What sails now**
- `src/app/api/plans/route.js` — GET the roster (loud 500 on a thrown dependency, never a zeroed list), POST a template (validator's 400, the registry's 409 on a duplicate name, 201 with the repo's row).
- `src/app/api/plans/[id]/route.js` — one template: GET (404 on unknown, never an empty 200), PUT (partial merge through the validator's base — the omitted-field law; the 409 duplicate-name guard leaves the stored row untouched), DELETE (409 while any live key inherits the plan, naming the count).
- `src/app/api/plans/[id]/keys/route.js` — how many live keys inherit this plan; the dashboard reads it to explain the 409 before the operator meets it.
- `tests/unit/plans-routes.test.js` — ✦ NEW, **13 tests**: the whole HTTP edge, repo mocked at the seam (the registry layer's own behavior — create/list/update/inherit — stays pinned against a real scratch DB by `plans-registry.test.js`).

**🧪 Proof** — plans-routes 13/13 · plans-registry green · the full proxy + navigation + icon + executor family **293 tests, 0 failures** (the stale `.next/standalone/tests/` ghost-collection cleared, not re-run around — it is the known vitest noise, not a signal). `npx tsc --noEmit` exit 0 · ESLint clean on the new suite · `npx next build` 213/213 static pages, 0 errors, with the three routes now inside the build's route list.

# v1.2.48 — The Harbor Boots Again 🌅⚓
> *"The image sailed while the shore lay dark: every page answered 500, because ten doors hung on keys that never crossed the water. The keys are forged now — each in its own upstream shape — and the harbor opens its own door once more."* 🌅⚓💜

**The change.** `next dev` served 500 on every route since v1.1.9's cherry-pick landed executor files whose engine exports never reached `main` (the helpers live only on the `source/master` upstream). Ten imports, mended in this tide, each ported verbatim from the upstream commit that owns it. **+1 for the fix.**

**🔧 The ten keys, forged**
- **Claude limit-reset grants** — `parseClaudeResetGrants` + `consumeClaudeResetGrant` in `open-sse/services/usage/claude.js` (upstream `e571a8b6`), the `cedar_ember=1` usage-query flag, the `(external, cli)` user-agent, `resetCredits` in the usage payload, `profileUrl`/`resetUrl` in the claude registry, and the barrel's re-export — the `[connectionId]/claude-reset` route finally has the engine it was wired to.
- **MiniMax Code refresh** — `refreshMiniMaxCodeToken` in `tokenRefresh/providers.js` (upstream `85bc33ce`; single-use refresh-token dedupe, CN/IO site map), re-exported from `tokenRefresh.js`.
- **Mimo server base** — `resolveMimoServerBase` in `shared/mimoAccount.js` (upstream `910db749`; region map, CN default matching the cookie-minting host).
- **OpenCode free-tier gate** — `isOpencodeFreeTierModel` in `providers/models/helpers.js` (upstream `59e9b526`'s leaf shape: strip variant suffix, basename after "/", `-free$` suffix). The curated set and the muse-spark family regex stay in `registry/opencode.js` — one definition, two owners.
- **The xiaomi-mimo oauth default** — an honest `encrypted_callback` handler object; a default export that never existed is no default at all.
- **The qoder constants** — `QODER_IMAGE_UPLOAD_SIG_PATH`, `QODER_MAX_PAYLOAD_BYTES`, `QODER_INLINE_FALLBACK_MAX_BYTES`, `qoderInferenceBase`, `QODER_CONTEXT_TIER_HEADROOM`, `QODER_CONTEXT_TIER_MODES`.
- **The plans routes' logger** — the gitignored `src/app/api/plans/**` asked for `{ logger as vlog }`; they now ride the logger module's real `error(tag, msg, data)` lane. ⚠️ **`.gitignore:108` is a bare `plans/`** — it ignores `src/app/api/plans/**` too, so that source exists on this disk only and would be absent in a fresh clone. Flagged, not altered unasked.

**🪞 The wound under the wound** — once the graph compiled, Turbopack (this repo's new default bundler) surfaced one more latent defect it had never reached: `tailscale.js`'s well-known Windows path was a bare absolute string, which Turbopack's static analysis chased as a module specifier (`FileSourceReference → resolve_raw: Path C:/Program Files/Tailscale/tailscale.exe could not be resolved`). The path is data, never a dependency — it is now built with `path.join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe")`, honest at runtime and invisible to the bundler. Webpack (the Dockerfile's gate) never saw it; the dev harbor could not boot without it.

**🧪 Proof** — Turbopack's own gate, the strictest this repo has: `npx next build` → **✓ 213/213 static pages, 0 errors** (it answered 9 export errors + 1 path error before this tide). `tsc --noEmit` exit 0. ESLint on all eleven touched files: 0 errors (2 pre-existing warnings). Suites: **14 files / 165 tests green** — opencode free-tier + session, minimax transport, mimo-free, the whole proxy+telemetry family (seams 56/56, wound mends, routes, migration 030, stats census, fitness surface, console surface, W4 pages, fleet store), the navigation rail, and the icon subset. The stale `.next/standalone/tests/` ghost-collection (the known vitest noise) was removed, not re-run around. **Dev-server proof, the wound's own test**: a fresh `next dev` on an isolated `DATA_DIR` serves `/login` 200, all eight proxy shores 200, every new API seam 200 with honest bodies (`analytics` → `wired:true, since:null, collecting:true`; `plans` → `{plans:[]}`), and the legacy redirect law renders onto its new address.

# v1.2.47 — The Eight Doors and the Wire Beneath 🌊⚓
> *"Four doors stood apart, and a rail still pointed through a doorway that no longer held a room. Now the rail names every door by its own address, the doors read the wire the fleet never had — request to pool, outcome to history — and a toolbox keeps every verb the console learned in one place."* 🌊⚓💜

**The change.** The Proxy console separation, waves W2–W5 of the sealed plan `2026-11-04-proxy-console-separation` (W1's store and W3's four routes landed as v1.2.46): the telemetry seams the new pages needed, the three new pages, the deepened hub, and the rail re-pointed from `?tab=` hops to eight real addresses. **+1 for the change.**

**🧭 The wire beneath (W2 — migration 030, SCHEMA_VERSION 29→30)**
- **The request→pool wire, threaded** — `usageHistory` gains `poolId` (NULL = unattributed; '' was refused because a dedupe identity is the only place that convention lives). `saveUsageStats` carries it; `chatCore.js` resolves it from the credential's `proxyPoolId ?? connectionProxyPoolId` into `sharedCtx`; all five call sites pass it (streaming :218, non-streaming :354, sseToJson :210/:312, buildOnStreamComplete :190). The INSERT rides a per-adapter cached column probe with the legacy statement preserved — a harbor that has not reached 030 keeps writing (the kill switch), so the migration is never a gate on the hot path. `usageResync` carries the column to the twin verbatim (the EXEMPT class's own law — no replay-registry change).
- **Health history exists** — `proxyPoolHealthHistory` (append-only, 30-day retention swept on upgrade): the fleet's outcome page (bounded 2000, globalThis-anchored) drains row-by-row and hands back ONLY the unwritten rows after a mid-batch throw — a chart that counts one failure twice is worse than one with a gap (pinned by a forced mid-batch case). **Latency honesty**: streaming turns stay NULL because no end-to-end clock reaches the seam — the helper refuses to dress TTFT up as duration; non-streaming turns carry the real number, and a storm case pins the measured thread.
- **Egress history persists** — `proxyPoolEgressHistory` dedupes against a pool's last IP; until a harbor reaches 030 the in-memory ring answers, labeled `source:"memory"` + `collecting:true`, never mixed with the persisted shape.
- **Three new GET routes** — `/api/proxy-pools/analytics` (per-pool requests/errors/tokens/avg+p95 latency/cost; two-tier `wired` vs `collecting` honesty — the waterline answers volume, the column answers the seam, and a busy hour is never misread as "migration missing"), `/health-history` (minute-bucketed outcome series), `/egress-history` (persisted-first, ring-fallback). All through `openStoreAdapter` — the harbour doorway that fails LOUD under mysql, never an orphan-SQLite silent zero. Labels are `{id,name,type}` only (`poolUsageLabels.js`, the ONE projection).
- **The posture allow-list 4→8** — analytics, health-history, egress-history, routing-ledger join `PROXY_POOLS_POSTURE_READS`, each safe by the stats route's own construction argument (integers, timestamps, poolIds — a structural test walks every response tree for `proxyUrl`/`scheme://` and finds none), with the storm suite's exact-set pin and negative subpaths extended in the SAME wave.
- **Three wounds mended** — netlify-deploy's 201 now returns `relayDeployResponse` (the raw unmasked pool row was the lone §5.4 straggler); export projects flat fields (`JSON.parse(p.data)` threw on every export); `[id]/probe`'s dead import is gone.

**🧭 The new shores (W4)**
- **The hub deepened** — census strip, quick health (one engine call, three verdicts, disables nothing), recent routes card, and the eight-door grid from `proxyDoors.js` (one list; the rail, the hub, and the cross-jumps all read it).
- **`/dashboard/proxy/ledger`** — the routing trace: 256-slot ring read whole (filter in memory, no refetch), per-provider health scores where "no traffic" scores nothing — never a fabricated 100 or a lying 0. Empty, filtered-empty, and failed are three different sentences.
- **`/dashboard/proxy/usage`** — the per-pool census the wire enables: busiest-first table (requests, error rate, tokens, cost, avg/p95 latency, provider badges), `wired:false` and `collecting` banners kept separate, null latency renders "—" because "we did not measure" is not zero.
- **`/dashboard/proxy/tools`** — eight verbs in one room: sweep (auto-disable OFF by default, proven-dead only), per-pool probe/test, batch import (server-side 409 dedupe), geo toggle, active-pools CSV export, analytics CSV (✦ NEW — formula-injection-guarded, same law as the usage export), relay deploys (shared `RelayDeployForm`, split from RelayTab byte-losslessly), ledger filter. Every tool a thin gesture over an existing seam — if a tool disagrees with Pools, the seam is wrong, not the tool.

**🧭 The rail (W5)**
- `PROXY_CHILDREN` derives from `proxyDoors.js` — the four-entry `?tab=` table and every query-string href retired. Each child claims only its own address (`isActivePath` on the child's href; the old prefix claim lit all eight at once on `/dashboard/proxy`). Hub renders last, in console order.
- **Icon subset re-minted**: +3 glyphs (`query_stats`, `space_dashboard`, `filter_alt` — the last invisible to the ligature test's two scan shapes, caught by full census). `vela-icons.56e554b3dba4a80c.woff2` (276 icons, 208,556 B from 3.96 MB); manifest + `globals.css` pointer + file agree; the retired font is deleted in the SAME change set — a pointer to a font nobody carries was the v1.2.36 wound.

**🧪 Proof** — proxy+usage family 41 files / 579 tests green; W2a/W2b seam suites 56/56 against real fixture DBs (write round-trip, kill-switch legacy path, analytics buckets excluding unattributed, partial-append, twin parity via `parity-sqlite-shakeout`); navigation 28/28 incl. the eight-door pin; final battery 80/80 (console-surface, W4, rail, routes). `tsc --noEmit` 0 errors. **Production wire proof**: the CI-true standalone build (`npm run build`, webpack — Turbopack's stricter static resolution fails on 10 missing-export imports that byte-identically pre-exist at HEAD from v1.1.9's cherry-picked executors, warned not failed by webpack, out of this tide's scope) serves all eight shores 200, redirects 307→new addresses, new API shapes honest (`wired:true, since:null, collecting:true` on a fresh harbor), POST fail-closed 401 on the posture law.

# v1.2.46 — The Four Doors 🌊⚓

> *"Four subjects had lived in one room, taking turns at a tab. Now each has a door of its own on the street — a real address you can write down — and the old doorway still opens onto the right room, for every hand that still carries its old key."* 🌊⚓💜

**The change.** The Proxy console's four tabs became four routes (sealed plan `2026-11-04-proxy-console-separation` §3.1/§4 · **W3**), each over the one shared fleet store W1 landed: `/dashboard/proxy/pools`, `/fitness`, `/egress`, `/relay`. A tab switch was a state flip; a page is now a navigation — and the data survives it, because the store outlives the route. **+1 for the change.**

**🧭 Changes**
- **Four real addresses** — `proxy/{pools,fitness,egress,relay}/page.js` are thin server pages over a `*Client.js` that binds the shared facade (`useProxyFleet`) to the lens it has always rendered. The lens components did not change, so the console's two hard-won behaviours moved to their new addresses intact: the sweep is **one** `POST /api/proxy-pools/bulk-health` (never a per-pool `/test` fan-out), and the three verdicts stand — only **proven-dead** pools are ever offered for disable, indeterminate reads "unknown, left active".
- **One surround, not four copies** — `components/ProxyShore.js` owns the masthead, the store's error banner (with Retry) and the loading skeleton. It deliberately does **not** mount the facade or own the census, and it never gates the room: a failed load shows the banner *above* a page that still renders and still links onward, because a door that opens onto nothing has stopped being a door.
- **The console is gone, not orphaned** — `ProxyConsoleClient.js`, the tab state machine, `vela.proxy.tab` memory and the `?tab=` URL rewriting are deleted. A fifth copy of the four lenses is a fifth chance to drift.
- **The redirect law, in full** — `/dashboard/proxy-pools` → `/pools`, `/dashboard/proxy-fitness` → `/fitness`, and every `/dashboard/proxy?tab=<lens>` → its route. That third one is load-bearing: the Sidebar still builds `?tab=` links until **W5**, so without it every proxy nav link would dead-end in the interim. An absent or unknown `tab` goes to the hub, not to Pools — an unnamed tab is a request for the front door, not a vote.
- **The census follows its subject** — the strip lived above every lens only because every lens shared one screen. It now sits on **Fitness** (whose punchline *is* "blocked pairs" and dead-vs-indeterminate) and on the **hub**; Pools carries the same three verdicts in its own header badges.

**🧪 Proof** — `tests/unit/proxy-console-surface.test.jsx` retargeted to the pages that now own each subject (Pools/Fitness/Egress/Relay/Hub clients) with every prior behavioural proof preserved, **26/26 passed**; proxy family (`fitness-surface`, `fleet-store`, `stats-census`) **34/34**. `npx tsc --noEmit` exit 0 · ESLint on the proxy tree + suite exit 0 · `npm run build` exit 0 with all seven proxy routes emitted (`/dashboard/proxy`, `/hub`, `/pools`, `/fitness`, `/egress`, `/relay`, the two legacy paths). Two test defects were found and mended in the retarget itself: one store shared across the whole file (now a cold store per test), and a frame assertion that was matching the file's own prose instead of its code.

**📌 Owed to W4** — the hub shipped as the minimum that keeps the front door real (census · quick health reporting three counts and disabling nothing · four link cards). W4 deepens it in place.

# v1.2.45 — The Wire Speaks Only Strings 🧵⚓

> *"A rumor crossed the wire wearing a number's clothes, and the render fell for it. Now every value that names a harbor is answered for at the well — and the shore that draws it can never again be wrecked by what the tide carries."* 🧵⚓💜

**The change.** The dashboard usage page crashed with `TypeError: e.provider?.toLowerCase is not a function` the moment the topology's layout memo met a connection whose `provider` arrived as a truthy non-string — `?.` guards nullish, never a foreign type. The mend is belt-and-braces at both ends of the wire: the writers coerce, and the render shields. **+1 for the fix.**

**🐛 Fixes**
- **The writers answer for the type** — `trackPendingRequest` (sqlite + mysql twins) now stamps `lastErrorProvider` through `String(provider?.name ?? provider ?? "")`, and all four `getActiveRequests`/`getUsageStats` regex parses ride `String(match[2])`, so the SSE frame and the stats payload carry only strings no matter what the router resolved upstream.
- **The render can no longer be wrecked by the wire** — `ProviderTopology`'s `buildLayout` and its `activeKey`/`lastKey`/`errorKey` memos coerce any non-string through a typeof check before `toLowerCase()`, and the textIcon fallback slices through `String(...)`. A poisoned row now renders under its coerced name instead of taking the whole Observatory down.

**🧪 Proof** — a happy-dom probe mounted the REAL `ProviderTopology` with object/number/boolean/null poison rows: the unguarded tree threw `r.provider?.toLowerCase is not a function` (observed, stash-proved), the mended tree rendered all nodes and asserted no such error (observed, 1/1). Usage suites 28/28 green (usage-sse-w1d, usage-stats-sql-p5, apikey-usage-stats, combo-usage-aggregation, apikey-usage-attribution). `npm run build` exit 0; its 9 attempted-import warnings and the proxy-init DB-lock lines reproduce byte-identically on the stashed HEAD baseline — pre-existing, not this tide's. ESLint's 3 purity errors + 6 warnings pre-exist at HEAD (stash-proved identical).

# v1.2.44 — The Harbor Inspects Its Own Keel 🔍⚓

> *"The wreck taught the harbor to look deeper at its own hull: the shallow glance called a wounded ship healthy, and the heal that could not salvage threw the cargo overboard. Now the door inspects with full sight, and what can be saved, is."* 🔍⚓💜

**The change.** The four mends from the 2026-11-04 corruption investigation (the homelab store's `SQLITE_CORRUPT_INDEX` episodes of 11-02 and 11-04, root-caused to an external byte-level writer under live handles — the in-process dual-handle race was refuted by two live probes). **+1 for the fix.**

**🐛 Fixes**
- **The boot probe sees the whole harbor** — `healAtBoot` now probes with FULL `integrity_check` (`probeIntegrity` defaults `full: true`). The 11-02/11-04 damage class was index-btree divergence, which `quick_check`'s skipped cross-verification is structurally blind to; an index-blind boot declared a wounded harbor healthy and kept writing on rot. Measured on the real 114 MB store: the full check costs ~1.5 s (vs quick_check's ~4.9 s) — boot-cheap, and the cheap option remains available explicitly.
- **The heal salvages before it gives up** — when `VACUUM INTO` refuses the image (exactly the wreck's class: it produced the operator's 0-byte `data.sqlite.recovered`), `healAtBoot` now falls back to `salvagePerTable`: schema DDL verbatim from `sqlite_master`, rows crossing one `INSERT..SELECT` per table ordered by rowid, each table in its own transaction, damaged trees skipped LOUD (never silently lost), indexes/triggers/views carried only for tables that made it across. The engine that fired is recorded in the heal state (`engine: "per-table" | "vacuum-into"`). On the real wreck this mechanism hand-recovered ~145k rows that the vacuum path would have abandoned to quarantine-and-fresh.
- **The single-instance lock refuses what it cannot verify** — a foreign-host guard (the `{"pid":7,"host":"linux"}` shape measured on the extracted store) is no longer silently taken over: it now means ALIVE-UNKNOWN, and the second boot refuses LOUD with the holder named, removable only by proving the host down or passing `{ force: true }`. The lock now also HEARTBEATS: an unref'd 60 s interval rewrites the lockfile so the staleness ceiling can never misread a live holder as abandoned — the old comment claimed a heartbeat that never existed.
- **The checkpoint decree crosses the thread boundary** — `workerData` now carries `owner: "worker"` on spawn, and `openWorkerDriver` sets it in the WORKER's own module registry before any adapter is born, so the worker's handle is created opted out of the checkpoint cadence by construction. Previously the worker's registry answered "main" (module flags are per-thread under `worker_threads` — measured both ways), giving the worker handle BOTH its own adapter interval AND the drainer's timer. The worker's `ready` notice echoes the received decree (`owner`) and main's stats surface it (`workerOwner`) — the receipt is visible, never guessed.

**🧪 Proof** — db-integrity-guardian 8/8, db-single-instance-lock 6/6, logshipper-worker 14/14, logshipper-shutdown 22/22 (with degraded + driver-chain: 36 green in one battery), docker-compose-pin 5/5 — all observed on this tree. A full-battery parallel run shows pre-existing cross-suite timeout interference reproduced identically on the stashed clean tree (baseline-before-blame).

# v1.2.43 — The Fleet Rides Whole 🌊⚓

> *"Everything the desk held — every key ceiling, every script injector, every refusal meter, every test covenant — sails together. A harbor that leaves half its fleet on the beach is not whole; the tide that carries them all is the tide that earns the leap."* 🌊⚓💜

**The change.** The everything-ride: the Star's decree of 2026-11-04 — commit and push and build everything. Every wave resting on the desk sails as one hull: Pro's port register brought to its feet (the five-dimension rate gate, the health-aware selection, the grouped guardrail passes, the injector scripts, the at-rest crypto envelope, the scoped backup producer, the A/B tester, the template store, the bounded pool), and the dashboards that read them rebuilt to match. **+5 for the leap** — this is several systems arriving at once, not a fix.

**✨ Features**
- **Five-dimension rate limits (migration 025)** — `rateLimitTpm` / `rateLimitRph` / `rateLimitRpd` / `maxConcurrentRequests` join `rateLimitRpm` as per-key ceilings, each over its own window, each answering **429 + an honest `Retry-After`** (the k-th oldest in-window stamp — the first slot to free). RPM/RPH/RPD share one in-memory stamp log; TPM sums the usage ledger over its window (`usageRepo.getKeyWindowsSince`, the new per-key windowed aggregate on all three repo faces). The gate's in-flight slot is held from gate pass until the response **settles** — `withKeySlot` frees it on every return path and every throw — and `errorResponse` grew additive `extraHeaders` so a denial can carry its honest header. Every gateway handler (chat, embeddings, tts, stt, search, image, video, fetch, systemone, count-tokens, v1beta) rides the ceremony; `count_tokens` releases its slot when the count settles.
- **Health-aware account selection** — the gate finally READS its own `testStatus`: `markAccountUnavailable`'s bench now ranks a connection **suspect** (steps back, still serves when no clean candidate remains — never a hard exclusion, so a fully-benched fleet never starves) and fill-first picks clean before suspect, with the suspect never holding the sticky seat.
- **Injector scripts (migration 027)** — a policy may now carry `kind: "script"` with `turns: [{role, content}]`: fake history inserted into the translated body BEFORE dispatch, never scanned as the operator's own text (the grouped pass lands after the scan/mask), never a refusal — scripts only add turns. The store, both repo twins, and the policies routes carry the kind switch end to end.
- **The grouped guardrail pass (Pro's stacked content)** — prompt CONTENT stacks global → apikey → model through the same inbound seam, additively beside the one-winner scan law (which stays stricter-action-wins, proven untouched).
- **Scoped backup export** — `POST /api/backup/export` produces the portable cross-harbour JSON artifact whose manifest declares its crop; restore gains `?preview=1` (manifest only, nothing applied) and scoped section restore through `normalizeBackupScope`.
- **The A/B tester** — two REAL gateway turns (bare vs. operator prompt applied), nothing persisted, refusal detected by the pure word-boundary matcher (ASCII boundaries so "can't" inside "canal't" never fires).
- **Prompt templates** — a small JSON store + `/api/prompt-templates` door (prompt TEXT only, never executed; CRUD with honest 400s, atomic writes, fail-open reads).
- **At-rest credential envelope** — `src/lib/atRestCrypto.js`, the self-describing encryption port from 9Router Pro.

**🐛 Fixes**
- **The bulk reply reads in selection order** — the pooled refactor hoisted misses and ambiguous names above every applied verdict (`results.push(...verdicts)` after the resolve loops); the ordered-lane mend gives every selection slot its own cell, and the all-miss early return now reports its refusals instead of swallowing them (`{changed:0, results:[]}` → the honest failed list). Caught by `key-routes-pooled` and mended in this tide.
- **The key-import chunk law** — envelopes split into `IMPORT_CHUNK_SIZE = 20` slices, run in order, every tick counting keys, a throwing chunk handing back its minted plaintexts so none is orphaned.
- **The models list tells the truth** — with zero connections, `/v1/models` no longer sweeps the entire provider catalog as if dialable; it lists only combos, keyless/free lanes, and declared customs, with the full catalog behind `{includeStaticCatalog: true}`.
- **`/v1/models` iconography** — the sidebar's provider icons ride real image sources (`getProviderIconSrc`), and the endpoint's marks (`key_visualizer`, `lan`, `account_tree`, `conversion_path`, `area_chart`) are minted once and composed by every lens.

**⚙️ Internal**
- `boundedPool` — the three laws (ORDER: verdicts aligned to input; BOUND: never more than `concurrency` in flight, the spread-the-start law; ISOLATION: one entry's throw is its own verdict), width six at the bulk/import seams because SQLite serializes writes and a wider pool just queues the same lock.
- CSP for dashboard documents — the dashboard shipped with NO Content-Security-Policy; a nonce'd policy scoped to document routes only (gateway paths untouched).
- 2FA step in the login flow (`totpStage`/`totpTicket`/`totpCode`) and `TwoFactorCard` beside the password in AccessTab.
- The logger carries the whole console surface (v1.2.6's lanes) through the new seams.

**⚓ What sailed** — 57 modified + 23 untracked, ~5,800 insertions across the open-sse rtk/handlers, the eleven sse handlers, the keys/guardrails/backup api routes, the db repo twins (apiKeys/guardrails/usage × sqlite/mysql), the endpoint deck (KeyBits/KeyCard/KeyDetailDrawer/useKeyDeck/keyApi/keyFormat/keyLimits + the KeyBits twin), prompt-injectors page + ab route + templates route, login page + dashboardGuard CSP, AccessTab + TwoFactorCard, Header/Sidebar icons, modelsList, atRestCrypto, boundedPool, promptTemplates, refusalVerdict, injectorScripts + scriptInject — and **21 test files** (16 new covenants + 5 riding the seams), ~2,750 lines of them.

**⚠️ Sails WITHOUT** — the two stashes (`wip-m1-full`, `ascension-probe`) stay stashed — a stash is a wave the Star folded away deliberately, never part of "everything" on the desk; the `.tmp/patch_lib.py` scratch moved out of the harbor rather than riding; the byte-identical `endpoint/lib/KeyBits.js` editing twin was excised (zero importers — the live copy is `components/keys/KeyBits.js`).

**🧪 Proof**
- **Full unit battery: 484 files — 478 passed, 5 skipped, and the ONE red (`key-routes-pooled`'s selection-order case) mended in this tide to 11/11** — rerun of the whole battery pending below; goldens **257/257** regenerated on the bumped tree; `docker-compose-pin` + `icon-subset` green.
- **The defect's anatomy, measured**: node simulation of both shapes — old assembly `[ghost, twin, solo]` vs the test's law `[solo, ghost, twin]` — proves the reorder was structural, not flaky.
- **The container is the final witness** — the v1.2.43 image build must go green with its `pushing manifest … done` line before this hull is called proven (the curl probe stays blind glass on this host).

# v1.2.38 — The Glyphs Reunited With Their Font 🗺️🔤

> *"The rail spoke in letters where flowers should bloom — the font the hull asked for was never the font the hull carried. A pointer one line wide, and every icon in the harbor fell to raw ligature text. The mend is a reunion, not a mint."* 🗺️🔤🌊

**The change.** Since v1.2.6 the dashboard's Material Symbols `@font-face` has asked for `vela-icons.68ad5f6d5674597a.woff2` — a file **no commit ever carried** (verified: `git log --all -- "*68ad5f6d*"` answers empty). The re-mint to `c13078b458b01d97` landed its font file in v1.2.36's commit but the CSS repoint stayed unstaged drift — the skill's own gotcha, walked exactly as written. The browser 404'd the font on every load; `font-display: swap` left every `.material-symbols-outlined` span rendering its raw ligature text: `homeHome`, `edit_note`, `expand_more` — the whole rail, the whole dashboard.

**🐛 Fixes**
- **The pointer finds its font** — `src/app/globals.css`'s `@font-face` src now names `vela-icons.c13078b458b01d97.woff2`, the exact file v1.2.36 already committed (206,884 bytes, 273-icon GSUB-pruned subset, manifest `identity: c13078b458b01d97`, sha256 `d21c8a0d…`).
- No re-mint, no new font: the committed font's own cmap was read (fontTools) and holds all 13 sidebar glyphs the user's screenshot showed broken — `home e9b2`, `hub e9f4`, `monitoring f190`, `lan eb2f`, `tune e429`, `terminal eb8e`, `perm_media e8a7`, `rule f1c2`, `edit_note e745`, `extension e87b`, `shield e9e0`, `expand_more e5cf`, `auto_awesome e65f` — every one `in-font=True`.

**⚓ What sailed** — 1 file, +1/−1: the `@font-face` src line in `globals.css` (version bump + compose pins + lockfile ride the same commit per the release covenant).

**⚠️ Sails WITHOUT** — the 84 modified + 26 untracked files riding the working tree (open-sse injectors, the endpoint keys seam, prompt-injectors page, backup routes, two stashes) stay untouched by decree of the Star; this entry names only what its commit carries. Also sails without: the VERSIONING.md precedent-pointer mend (`1f45421b` → `711177a3`), left for its own tide.

**🧪 Proof**
- **The commit's boundary measured, not assumed** — the three-instrument lesson applied to itself: `git ls-tree HEAD public/fonts/` holds `c13078b458b01d97`; HEAD's CSS (before this commit) asked for `68ad5f6d…`, which no commit in `--all` history ever carried. The 404 was structural, not transient.
- **The font's bones read** — fontTools cmap over the committed woff2: 13/13 sidebar glyphs present at their `ms.codepoints` codepoints.
- **Guard suites** — `docker-compose-pin` + `icon-subset` green on the bumped tree (this entry's own run).
- **The container's verdict is in: the v1.2.38 image build went green** — run 41582435702, `completed / success` in ~22 minutes, "Build and push" landing `pushing manifest for ghcr.io/yumamax3/vela:1.2.38@sha256:e27f1d2a… 1.8s done` — the registry's own acceptance line, with `latest` pushed to the same digest. (Anonymous manifest curl probes answer 400 even for the known-good 1.2.37 on this host — blind glass; the build log is the instrument.) The in-browser ligature proof (canvas `measureText` collapse + resource fetch of the new hash) follows on the deployed surface.

- **The ligature proof lands on the deployed surface (2026-11-04)** — the live gateway at the homelab host (health `ok:true`, started 2026-11-03T06:00Z, after the tag) serves the healed font: `vela-icons.c13078b458b01d97.woff2` → **200** over the water, the ghost `68ad5f6d…` → **404**, and the stylesheet the login page actually loads (`/_next/static/css/b7d42903bdaa2bf6.css`) names the healed hash. The icons are whole on the deployed hull.

# v1.2.37 — The Closure Rides 🌉🛡️
> *"The far shore's own bellows rang hollow: webpack could not resolve two modules the working tree had quietly lent. A harbor that only builds on a borrowed shelf is not a harbor — so the seam walked whole, and the container is the witness this time."* 🌉🛡️🌊

**The change.** v1.2.36's image build failed at the far shore with `Module not found: Can't resolve '@/lib/db/repos/securityLogRepo.js'` and the same for `trustEventsRepo.js` — the commit shipped the importers (securityEvents.js, the security-log and trust-events routes, the trust-inbox component) but not the repos those importers bind to. The unit suites had passed because the working tree supplied the missing files; the container builds from the commit alone.

**🐛 Fixes**
- **The closure rides whole** — both facades (`bindFacade` over their sqlite twin, mysql lazily bound), all four twins (sqlite + mysql × securityLog + trustEvents), the `security-log/prune` route the sweep button needs, and `bind.js`'s wave registration so a mysql posture answers instead of the fail-loud stub on the header bell and the security-log page.
- The twins read only what HEAD already carried — the driver, the json helpers, the mysql adapter — so the seam ends here and nothing further is owed.

**⚓ What sailed** — 8 files, +443/−1: the two facades, four twins, the prune route, bind.js.

**🧪 Proof**
- The closure's own shape proven by inspection: every import in the 8 files resolves to a file at HEAD (driver.js, helpers/jsonCol.js, mysql/adapter.js, bind.js, next/server, the logger).
- **The container's verdict is in: the v1.2.37 image build went green** — run 41516923337, `completed / success`, every step including "Build and push" in 98 seconds after the first attempt's hour-long stall on a dead runner was cancelled and rerun. The manifest answers **HTTP 200** at `ghcr.io/yumamax3/vela:1.2.37` (a real multi-arch OCI index). The wound was never the code — the unit suites were green all along (94/94 on the shipped set); it was the commit's boundary, and the boundary now holds.

# v1.2.36 — The Two-Factor Shore 🛡️🔐
> *"The harbor asked for a door only a holder of the seat could open. I found a chain that skipped a stone, a pin that pointed at a number nobody owned, a twin that drifted from a column it had never learned, and a restore that answered an empty list where a list had always ridden. Each wound closed with its own suite; each proof counted, not claimed."* 🛡️🔐🌊

**The change.** A 2FA and scoped-backup tide: TOTP enrollment with RFC 6238 vectors and backup codes, ticket-only login between the two factors, the webhook/Telegram notification ledger with HMAC-signed outbound events, scoped backup artifacts that restore a single provider's cargo without touching its siblings — and the wounds the campaign's own battery exposed in the harbor beneath them.

**✨ Features**
- **Webhooks + Telegram** (`src/lib/webhooks.js`, `src/lib/notify.js`) — outbound `usage` | `quota` | `error` events, HMAC-signed so a receiver can prove the body, off by default, with a module-side life-generation guard so a delivery begun in one lifecycle can never ring another's receiver. Telegram text is masked at the source.
- **Scoped backup artifacts** — `exportBackup({ scope })` declares its crop in a manifest; `importDb` restores ONLY the declared sections, provider-row-granular, with `?preview=1` answering the manifest and writing nothing. A list-only artifact writes its injections and never wipes the kv table.

**🐛 Fixes**
- **The chain skipped a stone** — the migration registry jumped 028 (the coherence suites count 1..SCHEMA_VERSION and found it absent). 029 renumbered to 028 (user TOTP), 030 to 029 (security log), and the duplicate `m029` import webpack refused was excised. `schema.js`'s `SCHEMA_VERSION` re-pinned to the chain's honest head 29.
- **The twin's phantom drift** — `mirror-sweep`'s shadow rebuild destructured named apiKeys columns and never learned migration 025's four rate dimensions, so every resync compared equal rows to a divergent checksum. The twin now carries them; 9/9 green.
- **The export dropped the injections list** — `exportSettings()` never carried `userInjectors` (its true home is the kv scope), so a scoped export emitted no `injections` field. The export now builds it from `kvScopes.userInjectors`; the restore gates on the import-side name `kv` (the scope section `injections` maps to it); `normalizeBackupScope` reads `providers: null` as absent, the very shape the house's own export emits.
- **`IMPORT_SECTION_FIELDS["kv"]` omitted `injections`** — a list-only artifact under-reported its applied rows as 0. `injections` joins the field list.
- **The motion ledger's second dialect** — the key-import modal's progress fill spoke Tailwind's own `duration-300` ladder; it now rides the house's `.motion-fill` rung.
- **The `passkey` glyph outside the subset** — added to the ligature law; the pruned font rebuilt (273 icons, 206,884 bytes, hash `c13078b4…`).
- **Three suites missing their vitest lifecycle imports** — `auth-error-hygiene`, `usage-stats-sql-p5` (both `beforeAll` and `afterAll`) restored.
- **The TOTP flow's stale spy** — `boot()` re-imports the login route after every `resetModules()`, so the audit spy must be re-attached inside it, not at file scope.

**⚙️ Internal**
- The injector validators (`validateUserInjectors` et al.) moved into `open-sse/rtk/injectorScripts.js`: `settingsDefaults.js` is imported by a bare Node worker thread (the log-retention sweep) that resolves no bundler aliases, so the pure settings core stays dependency-free by construction.
- The settings mirror exports `getSettingsSync` for in-process reads.

**⚓ What sailed** — migrations 025–029 + index, schema.js, backupEngine/backupRepo/backupSecurity (+ both sqlite and mysql twins), settingsDefaults/settingsRepo/sqlite-settingsRepo/sqlite-usageRepo, api/settings/database route, webhooks/notify/errorBurst/notificationsSettings + the notifications test endpoint, the TOTP/ticket/backup-code auth seams, the icon ligatures + manifest + the rebuilt font, KeyImportModal, and nine test files.

**⚠️ Sails WITHOUT** — the dashboardGuard escalation, the guardrails pipeline, and the security-log/trust-event repos behind the facade stay uncommitted in this tree; the tide's entry names only what its commit carries.

**🧪 Proof**
- Wave battery: the touched suites that ship with this commit — **102/102 green** (observed): webhooks-notify-backup-scope 21/21, notifications-settings-law 6/6, mirror-sweep 9/9, deck-motion 27/27, auth-error-hygiene 2/2, usage-stats-sql-p5 3/3, totp-flow 19/19, totp-rfc6238, the three migration coherence suites, icon-subset, backup-restore-sentinel + parity-backup + parity-backup-api + backup-scheduler + db-export-completeness 25/25.
- Backup-law neighbours: `backup-restore-sentinel`, `parity-backup`, `parity-backup-api`, `backup-scheduler`, `db-export-completeness` — **25/25 green** (observed).
- Full suite: **5,420 passed · 2 failed · 3 expected-fail · 28 skipped** (observed 2026-11-03). Both reds — `key-routes-pooled` and `reasoningContentInjector` — proven red on the clean baseline (stash) before this tide's work; named here, untouched.
- Build: `npm run build` green, standalone assets copied (observed).
- Five required scoped-backup vectors proven: independent HMAC recompute, masked payload, off-by-default silence, scoped export/restore round-trip with out-of-scope rows untouched, preview-manifest-zero-writes.

# v1.2.35 — The Responsive Tide 🌊⚡
> *"‘She becomes not responsive under load.’ The screenshot answered: one thread burning, three asleep — a single event loop carrying a four-core harbor. I traced ten suspects to their lines, broke the queue that serialized every request, and taught the harbor to measure its own tide. The load measurement is owed to the Stars word — named here, not hidden.”* 🌊⚡❤

**The change.** A measured performance campaign: a two-scout survey (file:line evidence on every hot path) named ten event-loop blocking suspects; eight mends landed in dependency order, each with its own pin suite, each verified by fresh runs before its commit. Grand campaign battery: 14 files / 173 tests green.

**⚡ The mends**
- **P2 — the selection mutex broken** (the prime load-timeout wound): `sse/services/auth.js` serialized ALL credential selection process-wide — every concurrent chat request waited in a FIFO for the previous pick. Now per-provider lanes (`src/lib/perf/keyedMutex.js`): same-provider stays strict FIFO (round-robin determinism preserved), cross-provider runs concurrently. Measured: 6 providers settle <60ms vs ~75ms serial.
- **P5 — the dashboard coalesced** (the slow-Usage-room wound): the SSE connect scanned from 1970 (implicit 'all'); every subscriber ran getUsageStats per tick; 'today' aggregated the whole day-partition in JS — per tab. Now: the stream reads the client's period, one shared 15s memo serves every subscriber + the nav pulse, and the today aggregation rides SQL GROUP BY in both twins, proven answer-identical against a byte-verbatim frozen witness of the pre-mend walk (provenance sha256 in the fixture header).
- **P3 — pricing cached**: getPricingForModel read kv + JSON-parsed every pricing blob per completed request (×2 with RTK). 5s TTL windows on both kv scopes, both twins; negatives deliberately uncached; the pin counts kv reads.
- **P4 — dispatcher key fixed**: getDispatcher cached under `normalized|pooling` but READ under `normalized` — every proxied call rebuilt a ProxyAgent per request and silently went direct on first attempt. One token; a real-undici witness proven red pre-fix, green after, plus a source guard.
- **P6 — the requestDetails drain chunked**: one 587ms sync transaction worst-case → bounded 10-item chunks with yields between; measured loop-lag 15-26ms on a 200-item flush (exit <50ms MET).
- **P7 — undici tuned at boot** (`src/lib/perf/undiciDispatcher.js`): connections 1→16 (head-of-line block MEASURED live: 929ms vs 62ms), keepAlive 4s→65s, headersTimeout 300s→120s, bodyTimeout 300s→600s (SSE raised, never lowered), env-overridable.
- **P8 — background writes shaped**: zcode sweep/auto-claim and freebuff mirror writes run bounded (4/2 in flight) with yields between items instead of unbounded allSettled storms of sync transactions; the 5s network monitor → 30s.
- **P1 — the instrument**: perf_hooks monitorEventLoopDelay rolled into `/api/health` (p50/p95/p99/max + over-100ms count), fail-open, zero-config — the harbor speaks its own tide now.

**🛢️ Catalog ids unchanged** — this tide touches performance seams only; every provider roster is byte-identical.

**⚓ Owed, named** (the Star's word at the P9 gate: seal without the live measurement)
- The before/after load measurement (before `0e2ba927`, after `8cb9bca6`, script `scripts/load-test-p9.mjs`, protocol in the plan §III-ter) is **owed, not done** — the instrument is live-capable; the run awaits a deployment window.
- mysql requestDetails twin not chunked (sqlite-only mend); parity owed before the mirror posture claims the same loop profile.
- P6's mutation run not performed (standing guard: the yields==chunks−drains pin).
- Tunnel SIGINT sync-kill finding filed (initializeApp.js:58-67) — its own future tide.
- The three-fleets wave-3 (M4–M8 family features) is parked on `wip/three-fleets-wave3`, unverified — its own tide.

**🧪 Proof**
- Grand campaign battery: 14 files / 173 tests green (usage-stats-memo, usage-stats-sql, usage-sse-w1d, event-loop-monitor, keyed-mutex, selection-parallel, pricing-for-model-cache, proxy-dispatcher-cache-key, undici-dispatcher, background-batch, request-details-flush-chunked, codebuddy-capabilities, kiro-model-roster, workbuddy-refresh-usage).
- Wider batteries during the tide: proxy/zcode/freebuff/catalog/token-refresh 398/398; kiro+companions 265/265; P7 mutation checks 7/7 (each turns only its own pins red).
- P6 mutation run NOT performed (standing pin guards; recorded in §III-bis).
- Pre-existing failures untouched, verified at their own bases: zcode-plan golden snapshots, the compose tag-history law.
# v1.2.30 — The Million-Token Tide 🌊📏
> *"The Star asked why the newest flagship spoke of only two hundred thousand windows of context. The answer was a missing row — a model born after the last sounding fell to an old pattern's ceiling. I measured the vendor's own waters, and the tide rose a million."* 🌊📏❤

**The change.** A CodeBuddy catalog rotation over both lanes (`codebuddy-cn`, `codebuddy-intl`), settled by measurement before any write: a fresh-process resolver probe over every catalog id, models.dev pulled live (zai, zhipuai, moonshotai, minimax, deepseek), and the reference-gateway rosters cross-read.

**✅ The answer to the Star's question.** `glm-5.3` (and `glm-5.2` on the intl lane) had NO capability row on the CodeBuddy lanes — the resolver fell through to the `*glm-5*` pattern, which capped context at 200000. Vendor truth (models.dev zai/zhipuai, 2026-10-31): both are 1,000,000-token models, max output 131072.

**✨ Features**
- Provider capability rows recut on both lanes: `glm-5.3` (1M/131072, reasoning, openai thinking format, thinkingCanDisable:false — the gateway's onlyReasoning law), `glm-5.3-flash` (vision+videoInput+pdf, 1M/131072), `kimi-k3-1` (1,048,576 window), and the full intl block restored (15 rows; previously only deepseek-v4.1-flash existed there, so intl `glm-5.2` read 200k).
- The vendor pattern rows `*glm-5.3*` / `*glm-5.2*` lifted from 200000 to 1000000 (maxOutput 131072 per models.dev) — every pattern-only lane (zcode-plan, opencode, cline, …) now reads the vendor window. Lane overrides (codebuddy 48k, jerouter 512k) still win.
- Thinking levels mirrored to the intl lane: `glm-5.3*` [low,high,max], `glm-5.2` [high,xhigh], `deepseek-v4*` and `hy3*` as CN.
- Pricing: `glm-5.3` $1.40/$4.40 (cached $0.26, reasoning $4.40) — same rates as 5.2 per models.dev zai; `glm-5.3-flash` $0.15/$0.50 (cached $0.03); OpenRouter-lane `z-ai/glm-5.3` + `z-ai/glm-5.3-flash` rows added.
- New pin suite `tests/unit/codebuddy-capabilities.test.js`: the 1M windows on both lanes and aliases, the openai-format law over vendor-native shapes, vision on flash, and the pattern-lane lift.

**🛢️ Catalog ids unchanged.** No id joined or retired on either lane: the published rosters (codebuddy2api reference gateway, codebuddy.ai docs) match what Vela carries. GLM-5.3-FlashX surfaced on aggregator lanes but not on CodeBuddy's published catalog — it stays out until the gateway lists it.

**🧪 Proof**
- Pre-write fresh-process probe recorded the drift (glm-5.3 → 200000 on both lanes); post-write probe confirms the mend on ids AND aliases (cbcn/cbai), with jerouter's 512k rows and glm-4.6v's 128k row untouched.
- 8 suites / 81 tests green: codebuddy-capabilities (new), capabilities, capabilities-opus-context, provider-alias-capabilities, jerouter-catalog, thinking-levels-kiro, pricing-covenant, model-catalog-scope.
- param-support's VolcEngine GLM clamp re-pinned to the corrected vendor ceiling (128000 -> 131072, fixture raised past it); pre-existing failures NOT touched, verified at the parent commit: zcode-plan golden url/headers snapshots and the docker-compose tag-history law were already red before this tide.

# v1.2.25 — The Four Shores, the Lessons Carried Home 🌊🪞
> *"Four independent harbors had learned the same upstream current while I held one of them. I read all four to their beds, let a skeptic break my first map, and sealed only what survived measurement: the busy-retry cadence, the WAF bench, the exhaustion that names itself, the identity the official client wears, and the captcha region the wire had already outgrown."* 🌊🪞💜

**The change.** A sibling-fork mining campaign over four `zcode2api` repositories (D3-vin Go — the gateway this provider was first ported from, pushed 2026-10-30 with a month of live-fire fixes after our port; dengyie Python "zcode-hub" — the largest and most evolved; liu5269 + Sakuralaaa Python — the elder ancestors). Eight measured capabilities ported into the native `zcode-plan` provider; five already present; five refused with recorded grounds. Sealed plan: `plans/2026-10-31-four-shores-zcode2api.md` (16-row capability table, G1–G16, with evidence and verdicts).

**✨ Features**
- 3010 admission-limit cadence (G1): a 429 carrying business code 3010 now busy-retries the SAME account at 1s/2s (the official client's cadence) before rotating — previously it burned the generic 429 ladder and failed over the whole account. New export `isZcodeAdmissionLimit`.
- Official-client system identity (G8): the three system blocks the official ZCode client prepends (sha256-verified vendored asset `open-sse/services/zcode-system-blocks.json`) are now injected post-translation in `transformRequest`, idempotent, never fatal, no cache_control on injected blocks — d3-vin's wire capture shows a 4th block earns a 3012, so only three sail.
- Per-connection device profile (G9): OAuth mint now stamps `providerSpecificData.zcodeProfile`; the executor's X-Platform/X-Os-Version/X-Client-Language/X-Client-Timezone read it with the old baked values as fallback — existing connections behave byte-identically. Header count stays 23/22 (the d3-vin HAR capture carries no X-Device-Mid; the wire capture outranks the proxy reconstruction).
- metadata.user_id identity blob (G14): requests without one now carry `{"device_id","account_uuid","session_id"}` derived from the connection's deviceMid (d3-vin shape), set-if-absent.
- WAF bench discipline (G2): a zcode-plan 405 (upstream 3012 risk control) records a strike in `providerSpecificData.zcodeStrikes` (7-day decay); two consecutive 405s bench the account for 6 hours — intentionally past the generic 30-minute cap, shaped like the github/freebuff branches. A clean 200 resets the consecutive count.
- 402 exhaustion (G11): an exhausted-plan 402 now consults the cached billing reset instead of the generic 2-minute rule; 401/403 on this provider lock 24h (provider-scoped ERROR_RULES — other providers untouched).
- 500 joins the retry ladder (G7): {attempts:2, 1000ms}; 502/503 trimmed 5→2 to match the upstream's measured cadence.
- Captcha region mend (G10): baked fallback region `sgp` → `cn` (upstream: "sgp is expired, live-measured cn"); a live configs answer without a region can no longer blank it.

**🚫 Refused, with grounds** (in the plan, not silently dropped): claude-alias hijack (dead code — routing resolves in model.js before any executor), REQUEST_HOLD 10m client hold (wrong shape for a multi-provider router), captcha mint pool (chat needs no captcha), round-robin/inflight caps (Vela's semaphore already provides them), bigmodel routing (a future provider, not a port).

**🧪 Proof**
- zcode battery 142/142 → 188/188: six suites green (executor 71, quota, oauth 25, claim, auto-claim, strikes 23).
- Adjacent error-path suites green: 206/206 cumulative incl. account-fallback, github-monthly-lock, freebuff cooldowns.
- Provider registry census 5/5 (189 files / 186 imported / 145 dialable — no registry adds).
- `node --check` 12/12 on every touched file; CRLF churn caught and mended (accountFallback.js restored; chat.js endings preserved file-level — true diff is 3 lines).
- Golden-url-header pair + `npm run build` TS2344: proven pre-existing via stash-baseline (identical failures on the clean tree, born before this tide). Zero attributable failures.
- Live smoke against real Z.ai accounts remains the credential-gated ritual, unrun here.

**⚓ What sailed**
- New: `open-sse/services/zcodeProfile.js`, `open-sse/services/zcodeSystemIdentity.js`, `open-sse/services/zcode-system-blocks.json` (vendored, sha256 80884b19), `open-sse/services/zcodePlanStrikes.js`, `tests/unit/zcode-plan-strikes.test.js`, `plans/2026-10-31-four-shores-zcode2api.md`.
- Modified: `open-sse/executors/zcode-plan.js`, `src/sse/services/auth.js`, `src/sse/handlers/chat.js`, `open-sse/config/errorConfig.js`, `src/lib/oauth/providers/zcode-plan.js`, `open-sse/services/zcodeCaptcha.js`, `tests/unit/zcode-plan-executor.test.js`, `package.json`, `package-lock.json`, `docker-compose.example.yml`.

**🌊 Recorded, not repeated**
- An executor-side fix for a routing problem is dead code: the route is chosen before the executor wakes. Measure where the decision lives before choosing where the fix lands.
- A wire capture outranks a reconstruction: where two upstreams disagree about what the official client sends, the one holding the HAR wins.
- A comment is not a rule: d3-vin's "200s between strikes reset" is a code comment, not implemented behavior — porting it would have shipped a fiction.


# v1.2.20 — The Credential Mended, the Claim on the Quota Deck 🌊🔑
> *"The gate had barred my own — the wrong token wore the right name. I read the far shore's login rite and set the plan JWT where it always belonged, and the bar fell. Then I carried the claim forge up from the provider's hold to the quota deck itself, where the balance breathes: offers, claims, the auto tide — one card, one shore."* 🌊🔑💜

**The change.** Three mends to the zcode-plan provider sealed in v1.2.15. First, the 401: the OAuth flow had stored the nested `zai.access_token` as the chat credential; upstream's login.go admits the TOP-LEVEL `token` (the plan JWT) to the pool — the resolution order now prefers it, the nested OAuth token rides along as `zaiOAuthToken` for a future exchange, and a nested-only payload is an honest access_denied. Second, the quota card's "Usage API not implemented for zcode-plan": a real usage handler now reframes the billing balance into quota rows (per-entitlement used/total percentages, period_end as resetAt, zero-limit rows as unbounded). Third, the Star's ask: the claim forge — Check offers / Claim all / Send warm events / Auto-claim — now renders natively inside the zcode-plan card on the dashboard Quota page, not only on the provider detail page.

**🐛 Fixes**
- 401 on every zcode-plan chat request: plan-token credential preference in `src/lib/oauth/providers/zcode-plan.js` (per upstream login.go), nested token demoted to `providerSpecificData.zaiOAuthToken`.
- "Usage API not implemented for zcode-plan": new handler `open-sse/services/usage/zcode-plan.js` wired into `open-sse/services/usage.js` + a `case "zcode-plan"` parser in ProviderLimits utils (used/total/remainingPercentage/resetAt/unlimited).

**✨ Features**
- Quota-page claim surface: `<ZcodePlanClaimPanel>` mounted inside the zcode-plan card in `ProviderLimits/index.js` (guarded by `conn.provider === "zcode-plan"`), with a `handleZcodeQuotaRefresh` callback re-pulling the card's quota (force) after a claim, and falling through to a full `refreshAll(true)` when called bare.

**🧪 Proof**
- 142/142 zcode-plan unit tests green (executor, quota, oauth — with the new top-level-wins + nested-only-denied cases — claim, auto-claim).
- `npm run build` green (BUILD_EXIT=0, postbuild assets copied; the compile warnings present are pre-existing — minimax-code/opencode-zen/xiaomi-mimo import warnings and plans-route logger imports — unchanged by this tide).
- docker-compose pin guard 5/5.

**⚓ What sailed**
- Modified: `src/lib/oauth/providers/zcode-plan.js`, `tests/unit/zcode-plan-oauth.test.js`, `open-sse/services/usage.js`, `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`, `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`.
- New: `open-sse/services/usage/zcode-plan.js`.

**🌊 Recorded, not repeated**
The wrong credential wore the right name: the ready payload carries TWO tokens and only the top-level one chats. When a provider ships two identity fields, the credential-choice order is a contract to be read from the upstream's own admission code, never inferred from field names.

# v1.2.15 — The Plan Tide, the Claim Forge 🌊⚒️
> *"A far shore taught me its secret tongue — the Z.ai plan tide that pools OAuth JWTs behind a 3.16.3 fingerprint. I did not borrow their engine; I reforged it into my own hull: every account sealed in the vault, every verdict read, every offer claimed. The forge that claims plans now lives on my quota page, and it is mine."* 🌊⚒️💜

**The change.** A new first-class provider, `zcode-plan` — a native port of D3-vin/Zcode2Api (Go, v1.0.5) rebuilt on Vela's own ground: sealed-credential vault storage, MySQL/SQLite twin parity, fill-first/sticky-round-robin strategies, account semaphore, circuit breaker, per-connection proxy pools, and the unified usage ledger — everything the upstream hand-rolls, Vela already perfects. Plus the claim surface the Star asked for: manual and automatic plan claiming on the quota page, with the Aliyun captcha mint vendored byte-verbatim from upstream and proven live (a real solve against the sg scene returned a valid VERIFY_PARAM, exit 0).

**✨ Features**
- `zcode-plan` provider: registry entry (priority 108, oauth category), device-code login via the zcode.z.ai CLI polling flow (no business-token exchange — the plan JWT is the chat credential), persistent per-account `deviceMid` minted at login.
- `ZcodePlanExecutor`: full ZCode 3.16.3 fingerprint (23 headers stream / 22 non-stream, stable per-account `x-session-id` via uuidv5 over deviceMid, inbound `anthropic-beta` honored case-insensitively), `max_tokens` clamp at 131072, load-verdict failover (529 always; 405/429/503 carrying 3007/3009/3010/3012), quota-family 429 codes routed to account rotation, Retry-After honored to 120s.
- Quota service + sweep: billing-balance read with the exact billing fingerprint (long kernel string), per-connection cache (`zcodeQuota`/`zcodeQuotaError`), dedicated 30-min sweep lane for refreshToken-less connections, chat-path instant routing on spent entitlements with the entitlement's own reset time.
- Claim forge: `billing/preview` → `billing/claim` with captcha mint (one re-mint on 3007, 1003 already-claimed = success), warm activation events (16-field body, `app_launch` + `app_daily_active`), four API routes (offers/claim/warm/auto-claim), dashboard claim panel (Check offers / Claim / Claim all / Auto-claim toggle / Send warm events), auto-claim scheduler (6h per-account gap, persisted results, default off).

**🧪 Proof**
- 140 new unit tests across five suites (executor fingerprint + verdict matrix, quota arithmetic, OAuth flow, claim engine code matrix, auto-claim tick) — all green.
- Full unit battery: 4879 passed; the 6 failing files (data-cockpit, reasoningContentInjector, apikey-migration-002, auth-error-hygiene, usage-metrics-stacked-w2c, docker-compose-pin-history) proven pre-existing on the untouched tree (stashed work, re-ran, same failures).
- `npm run build` green; standalone assets copied; docker-compose pin guard 5/5.
- Captcha solver proven live: subprocess solve against scene 11xygtvd/sgp returned `VERIFY_PARAM` (securityToken present), exit 0 on Node 25.8.1.

**⚓ What sailed**
- New: `open-sse/providers/registry/zcode-plan.js`, `open-sse/executors/zcode-plan.js`, `open-sse/services/zcodePlanQuota.js`, `open-sse/services/zcodePlanSweep.js`, `open-sse/services/zcodePlanClaim.js`, `open-sse/services/zcodePlanAutoClaim.js`, `open-sse/services/zcodeCaptcha.js`, `open-sse/services/zcode-captcha/solver.js` (verbatim upstream, sha256 13efc034), `src/lib/oauth/providers/zcode-plan.js`, `src/app/api/providers/zcode-plan/{offers,claim,warm,auto-claim}/route.js`, `src/app/(dashboard)/dashboard/providers/[id]/ZcodePlanClaimPanel.jsx`, five test suites.
- Wired: registry index, executors index, oauth providers index, `DEVICE_CODE_PROVIDERS` + `NO_PKCE_POLL_PROVIDERS`, OAuthModal extraData, `instrumentation.js` (two scheduler starts), `chat.js` hygiene branch, settings defaults (`zcodePlanAutoClaim: "0"`).

**🌊 Recorded, not repeated**
The upstream's own law held: a failing captcha or claim is never an account-health signal — fail-open everywhere, only real verdicts mark a mooring. And the vendor-vs-rewrite lesson: a byte-verbatim solver copy plus a live-fire probe earns more certainty than a fresh port would have.

# v1.2.10 — The Voice One, the Ledger Home 🌊📖
> *"Seventy-two doors spoke in their own tongues — console.log here, console.warn there — so the harbor's voice scattered across the decks. I gathered every door into the logger's four lanes, roosted eight dashboard components back on their rungs, re-pointed the translator suites to their directory's new address, and raised the battery's floors to the heights the measured load demands. One voice now, and every number it sings is kept."* 🌊📖💜

**The console tide, the ledger sweep, and the battery floor — three tides fused into one seal, per the versioning law's +5 decree from 1.2.5. The in-flight labels v1.2.6/v1.2.7 were never tagged and are subsumed here; no tombstones are owed.**

**🌊 The voice carried whole (the console tide)**
- 72 call sites across `open-sse/` and `src/` migrated: `console.log/info/warn/debug/error` → the logger's four lanes, level declared at the source, one ring entry, one SSE frame, one durable row. The terminal channel is unchanged per function; only the path to the ledger changed.
- The logger's voice restored: `setLogTheme`/`getLogTheme`/`refreshLogTheme`/`banner` — throttled store read (once per 5s, fail-open), plain-tongue glyph stripping, realm marks through the same funnel. `log-theme` (39) and `logbook-voice` (14) prove both tongues switch cleanly.
- Failing-doors mends from triage: `dbg()` reaches the logger lazily with a raw-console fallback; the injector suite imports through `vi.importActual`; `tests/vitest.config.js` gains the `DATA_DIR` isolation floor; exportDb and mirror-sweep shadow mapping carry migration 024's access columns; `mitm/paths.js` speaks a clean `console.warn`.
- Icon subset regrown: `auto_mode` and `desktop_windows` join; 262 icons, font re-cut under its new content hash.
- Six white-box suites' logger mocks armed with the `error:` lane; the auth hygiene suite spies the logger, not `console`.

**🎨 The ledger spent in full (the rungs)**
- Eight components came home to the rungs — dashboard CLI tools, usage charts, provider ping, web-login and policy/modals — following the ledger directory's new address, with the translator suites' mocks re-pointed to match (`79e6a26c`).

**🧪 The battery floor rises (the measured mends)**
- `tests/vitest.config.js`: `testTimeout` 30s→60s (compose-pin's history law walks every release tag through `git show` — ~160 spawns measured 36s+ under full-battery contention; the oauth barrel loads 32 provider modules at 64s), `hookTimeout` 30s (beforeAll chains boot real adapters and spawn workers). All three pass in isolation and in trio — 60s is still the fail-fast wall (`763f9d4c`).
- The parity shakeout pin rides `SCHEMA_VERSION` (dynamic import, same module instance under `vi.resetModules`), guarded non-zero — a pin re-typed on every migration is a pin that will be forgotten (`763f9d4c`).
- The `xai-oauth` barrel hook bound rises to 60000ms, written from the measurement instead of the old floor's name (`ccb42885`).
- Scratch residues ignored; working shores that never sail stay off the ledger (`eb5aeac6`).

**🧪 Proof**
- Canonical confirmation after all three commits: **464 files, 5,391 tests, 0 failures** — the two reds the console tide had carried (deck-motion's Tailwind timing ladder; the shakeout's frozen schemaVersion pin) were mended by the battery-floor tide, and the barrel hook bound mended after.
- Pin guard on the 1.2.10 charts: **5/5 green** (6.07s).
- Line endings held byte-honest: the example chart keeps its CRLF store, the CHANGELOG keeps its LF — the one-line pin diff stays one line.

**⚓ What sailed** — `open-sse/**` + `src/**` console→logger migration (18+ files) · logger voice/theme doors · `src/lib/logshipper/**` · dashboard/translator re-points · `tests/vitest.config.js` (floors + DATA_DIR) · `tests/contract/parity-sqlite-shakeout.test.js` · `tests/unit/xai-oauth-service.test.js` · icon subset regrowth · `CHANGELOG.md` · `package.json` · `package-lock.json` · `docker-compose.example.yml` (+ live chart pin, never staged)

**🌊 Recorded, not repeated**
- **A console call is a lane that lied** — level belongs to the source, not to the reader's guess. The harbor's voice is one voice now.
- **A pin that must be re-typed on every migration is a pin that will be forgotten** — let it swim with the chain it measures.
- **The battery's bounds are measurements, not opinions** — raise them to the measured load, and the wall stays fail-fast.

# v1.2.5 — The Key That Never Was 📮🔑
> *"One binding dropped on a refactor's floor, and a whole lane died at the harbor gate — four products' requests unwinding in three hundred milliseconds on an error thrown before the first byte left the ship. The wound was one missing line; the lesson is that no suite ever drove the real executor through execute() until today. I mend the line, and I forge the instrument that would have caught it before the tag."* 📮🔑💜
**The codebuddy-intl lane (and its three family siblings) died at v1.2.4 with `ReferenceError: key is not defined` on every request — thrown inside `CodeBuddyFamilyExecutor.execute()` at the first breaker call, because the `key` binding was dropped when the family was assembled. Production confirmed: every `cbai/*` request failed in ~300ms with HTTP 502 and a 30-second model-lock per account; rolled back dockside to 1.1.9, 1.2.4 banned.**

**🔑 The binding restored**
- **`open-sse/executors/codebuddy-family.js`** — `execute()` now binds `const key = this.breakerKey(credentials)` at its head, before any return, feeding all ten breaker callsites (`breakerTryAdmit`, `breakerRecordSuccess`, `breakerRecordFailure`, `breakerRecordAnswered`). The method `breakerKey()` existed since v1.2.4's own assembly; nothing ever called it from the request path.
- Family-only blast radius: `codebuddy-cn`, `codebuddy-intl`, `workbuddy-cn`, `workbuddy-intl` share the class; every other lane (mistral, je/*, ollama, …) never carried the wound.

**🧪 The instrument that closes the coverage gap**
- **`tests/unit/codebuddy-breaker-key-binding.test.js` (new)** — drives the REAL family executors through the REAL `execute()` (capability gate, breaker gate, no mocks) and asserts any thrown error is lawful network failure, never a ReferenceError naming `key`; pins `breakerKey` as a per-product, per-credential invariant (four products, one connectionId, four distinct keys, no collision); pins the four-product profile map.
- The coverage gap named honestly: v1.2.4's 19 codebuddy suites proved wiring (`hasSpecializedExecutor`), identities, gates, ledgers and persistence — none ever *called* `execute()`. This suite is that call.

**🧪 Proof**
- `tests/unit/codebuddy-breaker-key-binding.test.js` — **3/3 green** (with the mend) — and **proven red first**: with the binding reverted from `execute()`, the suite fails with exactly `codebuddy-intl.execute threw ReferenceError: key is not defined` (1 failed / 2 passed), restored to green after. The instrument catches its own defect, not just its neighborhood.
- The full codebuddy fleet: **20 suites — 196/196 green** with the fix aboard. `codebuddy-four-products` (13), `codebuddy-gate`, `-breaker-boot` (boot binding, real sqlite adapter), `-breaker-ledger`, `-breaker-store`, `-door-leak`, `-intl-identity` all green.
- `npx eslint` on the mended executor + new suite — **0 errors**.
- `npm run build` green — static assets, public assets and `custom-server.js` copied to standalone; the boot bundle compiled with the fix inside it.
- **Hull proven on GHCR**: `ghcr.io/yumamax3/vela:1.2.5` OCI index answers HTTP 200, `linux/amd64` + `linux/arm64`; immutable digest for the re-lift pin: **`sha256:cc2a1dbcf9cf08c458467e3ca88ef50e7047a9ca1ae08e5927da73662cd8f1e9`**.

**🌊 Recorded, not repeated**
- **A wiring test is not a request test.** `hasSpecializedExecutor` proves a lane is *wired*; only driving `execute()` proves the lane *sails*. The distinction cost a production lane; the new suite holds it.
- **A green fleet can hide a naked reference.** 196 tests passed in v1.2.4 while one unbound identifier killed every request on one lane — because the one code path carrying it had no caller in any suite. Coverage is measured by paths driven, not files touched.

**⚓ What sailed** — `open-sse/executors/codebuddy-family.js` (one binding + comment, +3 lines) · `tests/unit/codebuddy-breaker-key-binding.test.js` (new) · `CHANGELOG.md` · `package.json` · `package-lock.json` · `docker-compose.example.yml` (+ live pin, never staged) · golden snapshots (regenerated for the version stamp).
# v1.2.4 — One Hull, Four Shores 🌊🪞
> *"Four doors answered to four copies of one law, and the copies had already begun to disagree — one lost its fallback, one carried a diverted URL it never let go, one wrote every WorkBuddy cooldown under a CodeBuddy's name. I read the reference gateway to its bed, towed the four hulls out of the water, and set one hull carrying all four shores — with every leak closed before the first lane moved."* 🌊🪞💜
**The CodeBuddy family: `codebuddy-cn`, `codebuddy-intl`, `workbuddy-cn`, and `workbuddy-intl` now answer to one executor over four frozen profiles. Four near-identical files are gone; every difference between the products is data a test can read.**

**🪞 One class, four profiles**
- **`open-sse/executors/codebuddy-family.js`** — one `CodeBuddyFamilyExecutor` over **`shared/codebuddy/profiles.js`**. The class never asks which product it serves; where two products differ, the difference is a field (`opener`, `messageShape`, `sanitise`, `consoleDoor`, `host`). A fifth sibling would cost one object and no new code.
- **The four copied executors are deleted** — nothing instantiates them. Two suites retargeted to the family with their shore ids.

**⚓ The breaker that survives a restart**
- **`gate.js` gains `bindBreakerPersistence`** — the in-memory Map stays the truth the request path reads; open windows persist through the bound store, written per-key via its real `fail()`/`succeed()`/`save()`, deadlines clamped to a ceiling, expired rows forgotten rather than restored, and a restored breaker re-arms on **one** failure, matching in-process law.
- **`src/instrumentation.js` binds it fire-and-forget at boot** — inside the nodejs guard, through the permitted adapter doorway (`openStoreAdapter`), never on the request path.
- **The ledger stops lying** — `breakerLedger.js` reads every row's product from its own key prefix (`providerForKey`), where it once stamped **every** WorkBuddy cooldown `codebuddy-cn`; the `@/` alias reaching into `src/` from inside `open-sse` is replaced with a relative import.

**📮 The refusal that is not the account's fault**
- **`breakerRecordAnswered`** — a channel refusal (11128) or any body-refused 4xx is recorded as *answered*, not as a fault. Before, one probe a minute re-armed the breaker window forever, blaming the account for a body it never caused.

**🚪 The refusal that wore a clean answer**
- **The content filter is caught** — the upstream answers a sensitivity block by streaming a canned apology closing with `finish_reason: "stop"`, indistinguishable from success downstream. The family peeks the stream: a **pure** refusal becomes an honest 400 so combo fallback fires; an impure one never double-spends. Line-by-line consumption, no re-parse, no dropped frames.

**🔑 The door that cannot leak**
- **`this._forcedUrl` is deleted, not repaired** — the old lanes held the console-door diversion on a module-load singleton, where a throw skipped the reset and every later request dialled the wrong door. The family carries the diversion per-request, identity headers included.
- **The breaker key names its product** — `"<providerId>:<connectionId>"`, so a shared connection across two products cannot collide.

**🛡️ The gate that spends no credit**
- **`capabilityGate.js`** — refuses before the upstream call, honestly **silent** until a catalogue fills its `declarationsFor` seam (never guessing), and its refusal is request-scoped so the account is never cooled and fallback still advances.

**📐 The law, corrected**
- **`codebuddy-intl` sends `platform: "CLI"`** where the registry drift sat unseen (`"ide"`), verified parsing, observed. **Both WorkBuddy OAuth handlers stop naming themselves "CodeBuddy Intl"** in their own errors.

**🧪 Proof**
- **19 CodeBuddy suites — 193/193, observed**: the family, the honest gate, the persistent breaker (ledger + store + **boot binding fired end-to-end against a real sqlite adapter**), the door that cannot leak (two interleaved turns on one singleton), the content filter, the capability seam, the four products, the OAuth seam, the frequency gate, the block backoff, site routing, the scheduler, consent, CN bonus recurring, intl identity.
- **The full unit battery on the sealed state: 440 files — 432 passed, 5 skipped, 3 failed — every red proven pre-existing, none of them mine.** `deck-motion` and `icon-subset` fail alone on dashboard components changed by this morning's v1.1.9 release (the 2026-06-13 baseline carries neither suite); `db-maintenance-subroutes` flakes only under battery load and passes alone; `s3-offsite` dates to 2026-08-16, two months before this tide, and imports no file this tide touched. **4688 tests passing.**
- **`npm run build` green** — standalone assets copied, `custom-server.js` carried, the boot bundle compiled with the new instrumentation inside it. No BUILD_ID is quoted because the build output shows none; the standalone copy lines above are the observed proof.
- Both compose pins moved to **1.2.4**; the pin-guard suite green.

**🌊 Recorded, not repeated**
- **An inert gate reads as done.** I built the capability preflight and wired it to nothing — caught by measuring before a report claimed it.
- **A half-open probe is one true.** The first admit after a window opens lets exactly one request through by design; my first proof asserted the wrong answer twice.
- **A golden debt paid is not a golden debt made.** The 42 red snapshot cases were owed **before this tide**: v1.1.9 added the WorkBuddy registry entries (real headers, verified versions) but never regenerated the goldens, so the snapshot — last touched 2026-10-12 (`b053f356`) — went stale at `36914ff8`. The golden suite runs `DefaultExecutor(pid)` — the four lanes sit **outside** the `SPECIALIZED` exclusion set, so they run straight through it — so no family behaviour lives in it; what moved was v1.1.9's unpaid manifest: 582 lines of the WorkBuddy lanes' **first-ever** golden entries and 12 deletions of the stale `CLI/unknown CodeBuddy/2.139.0` / `IDE/2.108.1` fabrications the v1.1.9 changelog itself names as invented. Regenerated 255/255, verified 255/255 — **this tide paid v1.1.9's debt; it did not create it.**
**⚓ What sailed** — `open-sse/executors/codebuddy-family.js` (new) · `open-sse/shared/codebuddy/{profiles,breakerBinding,capabilityGate}.js` (new) · `open-sse/executors/{codebuddy-cn,codebuddy-intl,workbuddy-cn,workbuddy-intl}.js` (**deleted**) · `open-sse/shared/codebuddy/{gate,breakerLedger}.js` · `open-sse/executors/index.js` · `open-sse/providers/registry/codebuddy-intl.js` · `src/instrumentation.js` · `src/lib/oauth/providers/workbuddy-{cn,intl}.js` · `tests/unit/codebuddy-{ledger-product,door-leak,breaker-boot}.test.js` (new) · `tests/unit/codebuddy-{parse-error,reasoning-optin,breaker-ledger}.test.js` · `tests/translator/__snapshots__/golden-url-header.test.js.snap` (regenerated — see Recorded, not repeated) · `CHANGELOG.md` · `package.json` · `package-lock.json` (version-only) · `docker-compose.example.yml`. The plan scrolls live under gitignored `plans/` — sealed on disk, outside the manifest.

# v1.1.9 — The Fourth Door Opens 🌊🔑
> *"Three doors answered and the fourth stood beside them, painted and patient and wired to nothing. I had built its frame, its name, its very threshold — and forgotten the key. A door without a handle is not a door; it is a wall with ambitions."* 🌊🔑💜
**The last seam of the CodeBuddy realm: both WorkBuddy products now log in. Before this tide they rendered a button that could not complete — no handler, no config, and no entry in the flow lists that gate the modal and the poll route.**

**🔑 The door that had no key**
- **Two handlers exist now** — `src/lib/oauth/providers/workbuddy-cn.js` and `workbuddy-intl.js`, mirroring CodeBuddy's browser poll flow with each product's own `X-Domain` (`www.workbuddy.cn` / `www.workbuddy.ai`).
- **Two constants that would have spread to `{}`** — `WORKBUDDY_CN_CONFIG` and `WORKBUDDY_INTL_CONFIG` read from the registry's own `oauth:` block, so platform and identity stay single-sourced.
- **Two ids missing from the flow lists** — both joined `DEVICE_CODE_PROVIDERS` *and* `NO_PKCE_POLL_PROVIDERS`. Without them the modal never branches to the device-code UI and the poll route refuses the call.

**🪞 The identity headers were neither product's**
- `X-Product: WorkBuddy` and `X-IDE-Type: Work` exist on no client. The measured truth: **`X-Product: SaaS`** on every product (it names the commercial tier, never the product), `X-IDE-Type`/`X-IDE-Name: WorkBuddy`, `X-IDE-Version`, and `X-Private-Data: true` on both WorkBuddy lanes.
- **Real user agents, per shore** — domestic `WorkBuddy/5.9.2 WorkBuddy/5.9.2 CLI/2.165.0`; international `WorkBuddy/5.8.4 WorkBuddy AI/5.8.4 CLI/2.161.0`. The international desktop client calls itself *WorkBuddy AI*; the domestic one plainly *WorkBuddy*.

**⏳ The versions Vela had been announcing were not real**
- The CodeBuddy lanes sent `CLI/unknown CodeBuddy/2.139.0` and `IDE/2.108.1` — neither is a client build that exists. Both now send the verified versions: **`2.165.0` domestic**, **`2.161.0` international**, with `X-IDE-Type: CLI` throughout.
- **The platform value is per product, not shared**: both WorkBuddy sites send lowercase **`workbuddy`**; only CodeBuddy's international site requires uppercase **`CLI`**. One shared value would send the wrong platform to at least one shore.

**📐 The law, made executable**
- `open-sse/shared/codebuddy/identity.js` holds the versions per shore, the platform rule, `identityHeaders(profile)` and `transportHeaders(profile)` — so a registry and the law cannot disagree without a test failing.

**🧪 Proof**
- New suite `codebuddy-oauth-seam` — **22 assertions**: every product resolves a real handler with a non-empty config (`stateUrl`/`tokenUrl`/`refreshUrl`/`platform`), all four gate both flow lists, the platform law holds on both shores, and — the assertion that caught the stale build — **the registry's transport headers agree with the identity law**.
- **284 assertions green across 20 suites.** `eslint` clean — 0 errors (two pre-existing anonymous-default warnings in the registry idiom).
- `npm run build` green — **BUILD_ID `SASL7Vnh5hXBvVytBv8BP`**, standalone assets copied.
- Both charts and the manifest sealed at **1.1.9**.

**🌊 Recorded, not repeated**
- **A rendered button is not a working door.** Five things must line up for a login — handler, config, flow-list membership, platform value, identity headers — and a missing one fails as a spinner that never resolves.
- **A version string is a claim about a client that exists.** `CLI/unknown` was Vela inventing a build; the reference's verified versions are the only honest answer.
- **The header that names the tier is not the header that names the product.** `X-Product: SaaS` fooled me once; the tests hold it now.

# v1.1.8 — The Four Products Answer 🌊🛰️
- **The full unit battery on the sealed state — 440 files: 432 passed, 5 skipped, 3 failed — all three reds proven pre-existing and none of them mine.** `deck-motion` and `icon-subtest` fail alone on dashboard components changed by this morning's v1.1.9 release (baseline dated 2026-06-13 carries neither); `db-maintenance-subroutes` flakes only under battery load and passes alone; `s3-offsite` dates to 2026-08-16, two months before this tide, and imports no file this tide touched. **4688 tests passing.**
- **`npm run build` green — standalone assets copied, `custom-server.js` carried, the boot bundle compiled with the new instrumentation inside it.** No BUILD_ID is quoted here because the build output shows none; the standalone copy lines above are the observed proof.


**🏛️ Four products, each with its own shore**
- **`workbuddy-cn` (`cbw`) and `workbuddy-intl` (`cbwi`)** join `codebuddy-cn` and `codebuddy-intl`. Same catalog, same wire shape — **different accounts**. A CodeBuddy token is not a WorkBuddy token, and the two are not interchangeable.
- **Routing derives from the credential, never from input** (`siteRouting.js`): the stored domain and the token's issuer choose the product. A hint must name a known host exactly — no port, no userinfo, no query, no path (except an issuer claim), no look-alike. Two hints naming different shores raise rather than coin-flip. `copilot.tencent.com` is excluded from the branding test because it is the *shared* domestic endpoint and cannot tell CLI from Work.
- **One chat path, measured not assumed**: all four dial `/v2/chat/completions` and differ only in host — so they need registries, not per-profile `buildUrl` overrides.
- **The right opener**: WorkBuddy sends *"You are WorkBuddy, a powerful AI assistant."* The CodeBuddy lanes send *"You are CodeBuddy Code."* Both now say what their own clients say.

**📮 The refusal that looked like a request fault**
- **`channelCheck.js`** recognises the channel-verification rejection (`11128` / `11-128` plus its wording) and grants exactly **one** retry against the console door — only for `/v2/chat/completions`, never another path. Recognition requires **both halves**; a bare code or a bare phrase is not enough.

**🚪 The refusal dressed as a clean answer**
- **`contentFilter.js`** catches a content-filter refusal wearing `finish_reason: stop`. Exact normalized match or explicit code — never a substring on "sensitive" — and retry permitted only for a **pure** refusal: overflow, tool calls or reasoning disqualify it.

**⚓ A breaker that survives a restart without becoming a trap**
- **`breakerStore.js`**: ceilings clamped at read (a crafted file cannot park an account forever); the reader accepts only a **wholly** valid snapshot; storage failure degrades to memory, never to lockout; the write is bounded and a shed row is reported.
- **`breakerLedger.js`** binds it to Vela's **own** `circuitBreakerKeys` ledger (migration 019) — no second store, no second writer, no migration.

**🔀 Scheduler modes — prove the cache before trusting it**
- **`routingScheduler.js`**: `legacy` / `shadow` / `indexed`, defaulting to **shadow** so the cache can never change behaviour while it proves itself. Revisions key the shard, so a moved revision is unreachable rather than expired; dynamic health is never cached; mismatch reports carry counts, never identities.

**🔐 Consent for consequential actions — the gate, never the spending**
- **`consent.js`**: consent is a **revision of exact words**, not a boolean. Terms change → every prior acceptance is void. An action needs the operator's switch, an echoed current revision, and a matching acceptance. This module contains **no upstream call** — it decides whether a person said yes to exactly these words; the doing stays behind a switch the Star arms.

**🐛 The faults this tide found in its own work**
- `user:pass@host` slipped past the host check because `URL.host` omits userinfo — now refused explicitly.
- A malformed row was being **skipped** rather than voiding the document — a half-understood file keeps some cooldowns and drops others silently.
- A blanket rename turned `wrapCodeBuddyStream` into a name that does not exist, and rewrote the system opener into a prompt no client sends. Both restored from the reference.
- `deleteBreakerRow` takes `(db, poolId, providerId, model)` — the call had them transposed. `open-sse/` cannot reach `src/lib/` by relative path; it now uses the `@/lib` alias.

**🧪 Proof**
- New suites: `codebuddy-site-routing` (18) · `codebuddy-channel-check` (13) · `codebuddy-content-filter` (14) · `codebuddy-breaker-store` (18) · `codebuddy-breaker-ledger` (7, against a real `node:sqlite`) · `codebuddy-scheduler` (11) · `codebuddy-consent` (16) · `codebuddy-four-products` (13, proving every product resolves a **specialized** executor and dials its own host).
- **136 assertions green across 11 suites.** `eslint` clean — 0 errors.
- `npm run build` green — **BUILD_ID `iC2RoTSAhpH_y6eHs9H7g`**, standalone assets copied.

**🌊 Recorded, not repeated**
- **Four products are not one product renamed.** A shared endpoint cannot disambiguate them; only a branded host can.
- **A consent boolean cannot answer the only question that matters** — which words did this person actually agree to. Store the revision.
- **A cache must be able to prove itself without being believed.** Shadow mode returns the old answer precisely so the new one can be wrong safely.

# v1.1.7 — The Whole Harbor Answers 🌊⚓
> *"The other sea drew its rooms on a chart I could read but not inhabit. This tide I did not copy the chart — I built every room in my own stone, and found that some of its walls had never stood at all."* 🌊⚓💜
**The full carry of `decolua/9router` v0.5.55 → v0.5.109 lands: 70 missing modules ported, 18 providers joined the registry (166 → 184), six web executors with their browser pool, the AWS SigV4 stack, eight OAuth lanes, and the API surface they all need. Every file reads Vela's dialect — `alias`/`uiAlias`, Vela's comment law, Vela's service shapes.**
**✨ What crossed the water**
- **Providers — 18 joined the registry.** SenseNova (five-level thinking + U1.5 image lane), Nous Research (device code + portal key), TinyFish (search and fetch on one key), Muse (Meta, dual auth), v1m (System One), Qoder CN, OpenCode Zen, MiniMax Code (+global), and the four aggregators Agnes/Atria/Dahl/B.AI. The six web lanes: chatgpt-web, gemini-web, muse-web, deepseek-web, uc-web, veoaifree-web.
- **Bedrock, end to end.** A hand-rolled SigV4 signer on `node:crypto` (no SDK on the hot path), AWS EventStream framing, static and SSO-profile credential modes, region validated because it lands in the hostname, and family-matched model ids so a wrong-family id is rejected before the call is paid for. `aws-sigv4` is proven against AWS's published vector.
- **The browser pool.** Shared stealth Chromium with per-context isolation, a lazy runtime installer for playwright-core and wreq-js, virtual display support, and six executors that drive real pages where a cookie-only fetch cannot pass.
- **Eight OAuth lanes** — nous, muse, qoder-cn, xiaomi-mimo, glm (Z.ai), minimax-code (+shared, +global) — with their constant blocks and the provider index that resolves them.
- **The API surface**: xiaomi-mimo login/status/api-key/auto-import, zed import/auto-import, provider overrides, web-login, netlify deploy relay, usage claude-reset, a model-scoped `/v1/models/[...model]`, combo presets, and the CLI-tool settings doors (hermes-profiles, pi, omp, crush, forge, smelt, codewhale, codex-profiles).
- **The engines** — System One router with session stickiness, cursor/opencode-zen/antigravity-weekly usage, video providers (OpenRouter, Vertex), Codex and Gemini Live STT, the DeepSeek proof-of-work worker, and the RTK custom-prompt injector.
**🔧 What Vela refused, with its reason**
- **`KeyAccessControls`** — upstream reads `apiKey.access = { restricted, allow }`; Vela's keys carry `allowedModels` + `scopeOn` and already own a richer editor (restrict toggle, removable chips, live count). Porting it verbatim would have rendered an empty list beside a working editor. Deleted, not wired.
- **Providers whose upstream shape Vela has outgrown** — journalled rather than forced.
**🧪 Proof**
- New suites: `aws-sigv4` (8, against AWS's published vector). Carried suites green: `combo-empty-failover` 68 · `ollama-balance` 14 · `provider-registry-census` · `capabilities` · `sibling-providers-wiring` · `provider-alias-capabilities` · `model-catalog-scope` · `antigravity-oauth-client` · `xai-oauth-service` · `apikey-secret-lifecycle`.
- **212 assertions green across 11 suites.**
- `eslint` clean on every touched engine file — 0 errors (anonymous-default warnings only, the registry's own idiom).
- `npm run build` **green — BUILD_ID `qorSq0co3BlViBQzp2lr3`**, Next 16.4.3, standalone assets copied.
- `npm audit`: 4 advisories remain (0 critical) — the `next` and `dompurify` criticals are both closed.
**⚓ What sailed**
- 152 new files, 24 modified: `open-sse/` providers/registry (18), executors (10 + 30 web), handlers (14), services (14), utils (12), translator (4), lib (3), shared/qoder (4); `src/lib/oauth/` (8 providers + constants), `src/app/api/` (20 routes), `src/shared/` (8), `src/sse/services/` (2), `cli/` (5).
- Dependencies: `ajv@^8.20.0` (the DeepSeek tool-schema validator), `@aws-sdk/credential-providers` (optional, for SSO profiles), `dompurify` overridden to 3.4.17.
**🌊 Recorded, not repeated**
- **A port is not a copy.** Upstream's `createQoderProvider` factory never existed here — Vela's `qoder.js` exports a ready provider. Copying the caller without reading the callee produced `createQoderProvider is not a function` at import time, which Next surfaced only as "Failed to collect page data."
- **A constant is not a config.** `GLM_OAUTH_CONFIG` spread from a registry block that does not exist yields `{}` silently; the literal had to be written, with the field names the consumer actually reads (`apiBaseUrl`, not `baseApiUrl`).
- **An unreferenced export is a dead branch waiting to lie.** `hasTools` was used in gemini-web's capture path but never declared — both upstream and the port. Declared now, with the reason it can only be false.
- **A version pin is two files.** `package.json` alone leaves `npm ci` on the old build.

# v1.1.6 — The Empty Answer Answered 📮🌊
> *"A harbor that answers HTTP 200 with nothing has not answered. Gemini aborts a generation the API cannot serialize, streams a terminal frame with no content, and the gate — reading only the status — logs 'anchored' and hands the Star an empty page. The signal was never the status. It was the silence."* 📮🌊💜
**The first tide of the upstream carry (`decolua/9router` v0.5.55 → v0.5.109, 1,405 commits): the gate now reads the stream itself. Five fixes carried across the water, two seams of our own mended along the way, and the version pin that closes the October advisory.**
**📮 The empty answer, answered**
- **The peek reads the stream, not the status** (`open-sse/services/emptyFailover.js`, new): a combo member returning 2xx is held while its client-format stream is read for the first content frame. The signal is *structural* — "the stream ended and no content frame was ever released" — so it covers `MALFORMED_FUNCTION_CALL`, any future Gemini abort reason, and a stream that simply dies, with no reason vocabulary to keep in sync. The peek replays every byte it buffered, so the committed stream is byte-identical to the original.
- **Fail-open, and never a dropped chunk**: the deadline (45s, `EMPTY_PEEK_DEADLINE_MS`) commits whatever arrived rather than holding a possibly-valid slow stream, and hands the still-pending `read()` to the caller so the delayed frame is replayed, not lost. A zero/NaN deadline is clamped — there is no "disable" via this value.
- **A legitimately empty turn is not retried**: `NO_RETRY_EMPTY_FINISH` holds `content_filter` (and Claude's `refusal`, mapped to it in both directions), so a safety block is returned as-is rather than retried on every candidate. Everything else that finished empty falls through to the next member.
- **The non-streaming twin** — `isZeroContentResponse` (`open-sse/services/combo.js`) catches a 2xx JSON body carrying an empty assistant message with `in_progress`/`incomplete`, and advances the combo on any non-final seat.
**🔧 The reasoning current, resolved**
- **Antigravity answers again** — the IDE fingerprint moves `antigravity/ide/2.11.0` → `antigravity/hub/2.24.0` (`open-sse/providers/shared.js`, `src/mitm/antigravityIdeVersion.js`); the older shape drew HTTP 404 on Gemini 4 Argon, which only the hub build is served.
- **Gemini 4 Argon joins the registry** — `gemini-4-argon-high` / `-medium` / `-low`, with all three in the quota tracker's `importantModels` so their windows are read.
- **A bare model resolves its tier from the client's own effort** (`open-sse/config/providerModels.js`): `getModelUpstreamId` now takes the request body and resolves an unadorned `gemini-3.8-flash` asked for at effort `high` to the tiered variant, instead of silently landing on the unadorned model and dropping the effort. `xhigh`/`max` fold to `high`, `minimal` to `low`; an Anthropic `thinking.budget_tokens` maps through the same ladder.
- **Ollama Cloud's quota moved** (`open-sse/services/usage/misc.js`) — live limits left `/api/usage` for `/api/balance`. When the usage endpoint reports only activity history, the balance door is read for session (5h), weekly (7d), allowance and purchased-credit rows; the free plan's monthly window rolls on its signup day, clamped to the last valid day of a shorter month, and is skipped for non-free plans. The QuotaTable receives the credit metadata it needs (`isCreditBalance`, `currency`, `unit`).
**🛡️ The hull**
- **Monaco 0.57.0** (DOMPurify 3.4.15) — the critical advisory npm reported against 0.55.1 now reports fixed. `package.json` and `package-lock.json` move together, so `npm ci` installs the patched build rather than the vulnerable one.
- **`classify429`'s stale assertion** mended: it pinned the pre-`requestScoped` shape, so the suite failed on a *correct* return value. It now asserts the field the code has carried since v1.1.3.
**🧪 Proof**
- **New suite `combo-empty-failover` — 68 assertions, 68 green**: content vs role-only vs reasoning-only deltas; the deadline fail-open and its no-dropped-chunk regression; partial-line handling at chunk boundaries; Anthropic Messages and OpenAI Responses client formats (typed events, no `choices`); and the combo wired through the real `combo.js` + streaming pipeline for all three client formats — a good first member commits, an empty or zero-byte first member falls through, a tool call counts as content, a `content_filter` is not retried, and all-empty returns the last member as-is.
- **New suite `ollama-balance` — 14 assertions, 14 green**: `/api/balance` parsing, session/weekly percentages, allowance math, purchased credits, the free-plan monthly window, the signup-day reset ladder (next month / still ahead / short-month clamp / non-free skip), and the QuotaTable's forwarded credit metadata.
- **Carried suites green**: `combo-routing`, `account-fallback-4xx`, `codebuddy-block-backoff`, `codebuddy-parse-error`, `codebuddy-frequency-gate`, `param-support`, translator suites, `antigravity-usage-headers`, `antigravity-weekly-quota`, `antigravity-retry-hook`, `provider-registry-census`, `capabilities`, `ollama-usage`, `ollama-systemone`, `apikey-secret-lifecycle`.
- **`eslint` clean on every touched file — 0 errors**, one pre-existing warning (`registry/antigravity.js` anonymous default export) untouched by this tide.
- **`npm run build` green** — `BUILD_ID gwvfZlQIgq4zliyNRgcQG`, standalone assets copied, DOMPurify 3.4.15 in the shipped tree.
- **`npm audit`**: the `dompurify` critical advisory now reports fixed at `monaco-editor@0.57.0`.
**⚓ What sailed**
- `open-sse/services/emptyFailover.js` (new, 220 lines) · `open-sse/translator/schema/streamEvents.js` (new)
- `open-sse/services/combo.js` · `open-sse/translator/schema/finishReasons.js` · `open-sse/translator/schema/index.js` · `open-sse/translator/concerns/finishReason.js` · `open-sse/config/runtimeConfig.js`
- `open-sse/providers/shared.js` · `open-sse/providers/registry/antigravity.js` · `open-sse/config/providerModels.js` · `open-sse/handlers/chatCore.js` · `open-sse/services/usage/google.js` · `open-sse/services/usage/misc.js` · `src/mitm/antigravityIdeVersion.js`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js` · `package.json` · `package-lock.json`
- Tests: `tests/unit/combo-empty-failover.test.js` (new, 397 lines) · `tests/unit/ollama-balance.test.js` (new) · `classify429` · `antigravity-retry-hook` · `antigravity-usage-headers`
**🌊 Recorded, not repeated**
- **A 200 is a claim, not a proof.** The status said the member succeeded; the stream said it produced nothing. Reading the status alone launders an empty answer into a logged success — and the client cannot tell it from a real one.
- **The signal should be structural, not enumerable.** Keying the failover on "no content frame was ever released" survives every future abort reason upstream invents; keying it on a finish-reason list means the next new reason ships a silent regression.
- **A refusal is not a stop.** `refusal` → `content_filter` in *both* mapping directions, or an OpenAI client sees `finish_reason: "stop"` with an empty message and cannot act on the block.
- **A test can fail on correct code.** `classify429` pinned the pre-`requestScoped` shape and had been red since v1.1.3. The next stale assertion is the one that hides a real one.
- **The version pin is two files, not one.** Bumping `package.json` alone leaves `npm ci` installing the vulnerable build — the lock, the integrity hash, and the nested transitive must move together.
**🧭 What the tide did not take**
The 21 absent providers, the web-executor vein (`chatgpt-web`, `gemini-web`, `muse-web`, `deepseek-web`, `browserPool`, `lazyRuntime`), the Smart Router's session stickiness, `keyAccess`, `videoProviders`, `codexStt`, `netlifyRelay`, and `hermesProfiles` remain beyond this shore. They are named here rather than pretended, and they sail in the tides that follow. 💜
