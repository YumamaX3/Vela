/**
 * Responsive Tide P7 — the global undici dispatcher, tuned once at boot.
 * (plans/2026-11-01-responsive-tide-performance.md §III, mend P7)
 *
 * THE TURBULENCE. Every direct fetch in the gateway — proxyAwareFetch's no-proxy
 * tail (open-sse/utils/proxyFetch.js, `return originalFetch(url, options)` with no
 * dispatcher), OAuth/token-refresh lanes, model catalogs, MITM real-IP bypasses —
 * rode undici's DEFAULT global Agent: 1 connection per origin, 4s keepAliveTimeout,
 * 300s headers/body timeouts. The default is tuned for short idempotent calls. The
 * gateway's whole life is the opposite: long-lived LLM SSE streams, and bursts of
 * short REST calls against a handful of provider origins that a cold socket
 * re-pays for in TLS on every turn.
 *
 * THE MEND — setGlobalDispatcher(new Agent({...})) exactly once, at boot.
 *
 * WHY THE GLOBAL IS SAFE HERE, MEASURED (undici 7.30.1, vendored):
 *   • Fetch precedence — node_modules/undici/lib/web/fetch/request.js:128/:164 store
 *     `init.dispatcher` ONLY when it is passed (undefined otherwise), and
 *     fetch/index.js:254 falls back to `getGlobalDispatcher()`. So an explicit
 *     per-request dispatcher STILL WINS and the global is the default for every
 *     caller that does not pass one.
 *   • ProxyAgent carriers — undici/lib/dispatcher/pool-base.js:157/:163 already
 *     forwards the REQUEST's handler into the inner client, so every proxy path
 *     (proxyFetch's ProxyAgent / Socks5ProxyAgent pools) still terminates through
 *     a real undici Client with our tuning in effect. A ProxyAgent handed to
 *     setGlobalDispatcher would redirect-only and never honour timeouts.
 *   • ProxyAgent OPTIONS (connectTimeout, headersTimeout, bodyTimeout, connect) —
 *     undici/lib/dispatcher/agent.js:25 keeps them on Agent[kOptions], and
 *     :128 hands those options to `new Pool(...)` → `new Client(...)`
 *     (pool.js:28-41, client.js:87+), and builds the SAME `new Agent({...(pooling ??
 *     {})})` shape, so the operator's pooling knobs keep their F9 identity and
 *     gain the timeouts they never received before.
 *   • The ONLY other setGlobalDispatcher in the tree is the captcha solver —
 *     a subprocess with its own global (zcodeCaptcha.js spawns it), so it cannot
 *     disturb the gateway's. Control: src/lib/perf/undiciDispatcher.js is the
 *     gateway's single global-dispatch writer.
 *
 * The tuning itself lives with the boot so every caller proves it by reading the
 * live global (this module's getters), never by taking a snapshot.
 *
 * Every failure is fail-open: an undici that will not load, an option the vendored
 * build rejects, a setGlobalDispatcher that throws — each leaves the previous
 * global standing and reports `ok:false` with the reason. A boot that cannot tune
 * its sockets must never stop the server.
 */

// ─── The tuning — MEASURED against undici 7.30.1's own defaults ─────────────
//
//   key                      undici default   ours       why
//   connections (per origin) 1                16         ≥5 concurrent chat turns per
//                                                        origin without queueing behind a
//                                                        socket; PoolBase[kQueue] is FIFO-
//                                                        fair, so 16 is width, not bypass.
//   keepAliveTimeout         4_000 ms         65_000 ms  mirror Node's server-side
//                                                        keepAliveTimeout (custom-server.js:68);
//                                                        a burst of short calls reuses warm
//                                                        sockets instead of re-handshaking TLS.
//   keepAliveMaxTimeout      600_000 ms       600_000 ms UNCHANGED — an explicit pin, not a
//                                                        tuning: a server hint above this cap
//                                                        is clamped. Upstreams advertise longer
//                                                        than 65s, so 65s is the floor of the
//                                                        clamp and this is its ceiling.
//   keepAliveTimeoutThreshold 2_000 ms        2_000 ms   UNCHANGED — the server-hint slack.
//                                                        (client.d.ts still says "1e3"; the
//                                                        code, client.js:255, says 2e3 — code wins.)
//   headersTimeout           300_000 ms       120_000 ms a provider that has not SENT headers
//                                                        in 2 min is a lost cause; the old 5 min
//                                                        was dead latency held by a client.
//   bodyTimeout              300_000 ms       600_000 ms time BETWEEN body chunks. Raised, never
//                                                        lowered: long reasoning streams must not
//                                                        be severed mid-flight (custom-server.js:60-66
//                                                        leaves requestTimeout default for the same reason).
//   connectTimeout           (connector)      15_000 ms  a dead origin surfaces as a fast,
//                                                        retryable failure instead of a minutes-long
//                                                        hang. This is the knob that actually rides
//                                                        to the connector (client.js:236).
//   pipelining               1                1          explicit: SSE + gzip stall per RFC
//                                                        hazards are real; never change unmeasured.
//   maxCachedSessions        default          256        TLS session-cache size for reconnects.
//
export const UNDICI_DEFAULTS = Object.freeze({
  connections: 1,
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 600_000,
  keepAliveTimeoutThreshold: 2_000,
  headersTimeout: 300_000,
  bodyTimeout: 300_000,
  pipelining: 1,
});

export const UNDICI_TUNING = Object.freeze({
  connections: 16,
  keepAliveTimeout: 65_000,
  keepAliveMaxTimeout: 600_000,
  keepAliveTimeoutThreshold: 2_000,
  headersTimeout: 120_000,
  bodyTimeout: 600_000,
  pipelining: 1,
  maxCachedSessions: 256,
});

// The options `new Agent(...)` actually receives: the tuning plus the connector
// timeout, plus the recording factory that is ALSO the live getter (see below).
export const UNDICI_CONNECT_TIMEOUT_MS = 15_000;

// Fail-closed ceiling — a handshake watchdog, not stale-safe. When a caller passes
// its own `connect`, undici SKIPS the option-level `connectTimeout` entirely
// (client.js:227-232 buildConnector vs :240-245 the custom branch keeps only
// socketPath/allowH2), so nothing in this tuning would bound the TLS handshake.
// Bounding a LIVE provider origin at 15s with the watchdog still pending could
// sever a healthy turn on a slow uplink; the watchdog ceiling is therefore wider
// than the deadline it supervises.
export const UNDICI_WATCHDOG_MS = 60_000;

// The global this module owns. Held so the pin test can hand it back.
const g = (globalThis.__velaUndiciDispatcher ??= { installed: null, state: null });

/**
 * Wrap the user's connector so every socket the tuning opens carries a watchdog
 * that destroys it if the handshake has not completed by UNDICI_WATCHDOG_MS. The
 * timer is cleared on BOTH outcomes (connect / error), and is `unref`ed so it can
 * never hold the process open. User connector errors pass through untouched.
 */
function watchdogConnect(userConnect) {
  return (opts, callback) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(new Error(`[Undici] handshake watchdog fired after ${UNDICI_WATCHDOG_MS}ms connecting to ${opts?.hostname ?? "?"}:${opts?.port ?? "?"}`));
    }, UNDICI_WATCHDOG_MS);
    if (timer.unref) timer.unref();

    const done = (err, socket) => {
      if (settled) {
        // Already reported timed-out — the late socket (or late error) is
        // released rather than leaked so the watchdog can never cost an fd.
        try { socket?.destroy?.(); } catch { /* already gone */ }
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(err, socket);
    };

    try {
      userConnect(opts, done);
    } catch (err) {
      done(err);
    }
  };
}

/**
 * The recording factory — the Agent's connection creator.
 *
 * It is the LIVE getter: Agent's factory is called with `(origin, opts)` the first
 * time each origin is dispatched (agent.js:106, then :109 and :128), and `opts` is
 * exactly `Agent[kOptions]` — the same object handed on to the Client. So this
 * records what undici REALLY constructed (pipelining, maxCachedSessions and the
 * connect timeout included, which Agent[kOptions] strips or carries only as
 * `connect`), while returning a real undici Pool — and since the record is kept
 * behind a getter, it can never grow by origin: a long-lived harbour's per-origin
 * tuning history is "last origin created", not an unbounded map.
 *
 * The Agent's other options (connections, the keep-alive/timeout family) live on
 * Agent[kOptions] and are proven through consumeAgent() below.
 */
function recordingFactory(Pool) {
  let last = null;
  let count = 0;
  let failure = null;
  const factory = (origin, opts) => {
    try {
      const pool = new Pool(origin, opts);
      last = opts;
      count += 1;
      return pool;
    } catch (err) {
      // A Pool that cannot be built is a fact about the tuning, not about the
      // request: record it, and give the request a plain Pool so it still flows
      // under undici's own defaults rather than failing the turn.
      failure = err;
      last = opts;
      count += 1;
      return new Pool(origin, {});
    }
  };
  return {
    factory,
    peek: () => ({ opts: last, count, failure }),
  };
}

async function disposePrior(prior) {
  if (!prior) return;
  try {
    await prior.destroy?.();
  } catch {
    // The prior global is undici's own Agent, shared with anything holding it —
    // a failed dispose must never fail the boot. Its sockets idle out.
  }
}

/**
 * Build the tuned Agent and make it the global dispatcher.
 *
 * @returns {Promise<{ok: boolean, reason?: string, connected: boolean}>}
 *   `connected` is false only when getGlobalDispatcher() did not acknowledge the
 *   new Agent as the global AFTER installation (a two-undici-copies bundle): the
 *   install still happened on the same module records it imported, but `ok` then
 *   reports the truth — "the global I read is mine".
 */
export async function installGlobalDispatcher() {
  if (g.installed) return { ok: true, connected: true, alreadyInstalled: true };

  let undici;
  try {
    undici = await import("undici");
  } catch (err) {
    g.state = { ok: false, reason: `undici unavailable: ${err?.message ?? String(err)}` };
    return g.state;
  }

  const { Agent, Pool, setGlobalDispatcher, getGlobalDispatcher } = undici;
  if (typeof Agent !== "function" || typeof setGlobalDispatcher !== "function") {
    g.state = { ok: false, reason: "undici build exports no Agent/setGlobalDispatcher" };
    return g.state;
  }

  // A caller may have installed its own global before we booted (tests, an
  // operator shim). We take it over — that is the mend — but REMEMBER it so a
  // dispose can hand it back rather than leaving the process without one.
  let prior = null;
  try {
    prior = typeof getGlobalDispatcher === "function" ? getGlobalDispatcher() : null;
  } catch { /* no readable prior global — fine */ }

  const recorder = recordingFactory(Pool);

  let agent;
  try {
    agent = new Agent({
      ...UNDICI_TUNING,
      connectTimeout: UNDICI_CONNECT_TIMEOUT_MS,
      // The option-level connector undici builds itself gets `timeout:
      // connectTimeout` (client.js:236). The watchdog rides on TOP of it so a
      // customer-supplied connector cannot bypass the bound entirely.
      connect: watchdogConnect(
        undici.buildConnector({ timeout: UNDICI_CONNECT_TIMEOUT_MS })
      ),
      factory: recorder.factory,
    });
  } catch (err) {
    g.state = { ok: false, reason: `Agent construction rejected: ${err?.message ?? String(err)}` };
    return g.state;
  }

  try {
    setGlobalDispatcher(agent);
  } catch (err) {
    try { await agent.destroy?.(); } catch { /* nothing to release */ }
    g.state = { ok: false, reason: `setGlobalDispatcher threw: ${err?.message ?? String(err)}` };
    return g.state;
  }

  let connected = false;
  try {
    connected = typeof getGlobalDispatcher === "function" && getGlobalDispatcher() === agent;
  } catch { /* unreadable global — reported as not connected */ }

  g.installed = { agent, prior, recorder, tuning: { ...UNDICI_TUNING, connectTimeout: UNDICI_CONNECT_TIMEOUT_MS } };
  g.state = { ok: connected, connected };
  return g.state;
}

/**
 * The live tuning, as the process carries it.
 *
 * `installed:false` → undici's documented defaults (what an untuned gateway
 * serves), flagged as such. `installed:true` → the values the Agent was BUILT
 * with (its constructor's options), returned fresh so a mutation of the returned
 * object can never rewrite the record.
 */
export function getUndiciTuning() {
  if (!g.installed) {
    return {
      installed: false,
      tuning: { ...UNDICI_DEFAULTS },
      connectTimeoutMs: null,
      watchdogMs: UNDICI_WATCHDOG_MS,
      origins: 0,
    };
  }
  const { tuning, recorder } = g.installed;
  const { count } = recorder.peek();
  return {
    installed: true,
    tuning: { ...tuning },
    connectTimeoutMs: tuning.connectTimeout,
    watchdogMs: UNDICI_WATCHDOG_MS,
    origins: count,
  };
}

/**
 * The pin-test seam — what undici ACTUALLY built, drawn from the live object:
 *   • agentOptions  — Agent[kOptions] (connections, keep-alive + timeout family;
 *                     Agent strips `pipelining`/`maxCachedSessions`, which is why
 *                     those are proven through `poolOptions`),
 *   • poolOptions   — the options the first-origin Pool/Client received (the
 *                     complete set, pipelining + maxCachedSessions + connectTimeout),
 *   • factoryFailure— the error if the Pool refused the tuning (recorded, never thrown).
 *
 * `origins` stays 0 until the first dispatch — undici builds per-origin clients
 * lazily, and the pin test drives one real request through setGlobalDispatcher's
 * return to force it (this module makes no network calls of its own).
 */
export function consumeDispatcher() {
  if (!g.installed) return { installed: false };
  const { agent, recorder } = g.installed;
  const { opts, count, failure } = recorder.peek();
  const sym = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options");
  const agentOptions = sym ? { ...agent[sym] } : null;
  return {
    installed: true,
    agent,
    agentOptions,
    poolOptions: opts ? { ...opts } : null,
    factoryFailure: failure ? (failure?.message ?? String(failure)) : null,
    origins: count,
  };
}

/** Test seam — hand the prior global back and forget the install. */
export async function __resetGlobalDispatcherForTests() {
  const prior = g.installed?.prior ?? null;
  const agent = g.installed?.agent ?? null;
  g.installed = null;
  g.state = null;
  if (agent) {
    try { await agent.destroy?.(); } catch { /* best effort */ }
  }
  if (prior) {
    try {
      const { setGlobalDispatcher } = await import("undici");
      setGlobalDispatcher(prior);
    } catch { /* nothing to restore to */ }
  }
  return { restored: Boolean(prior) };
}
