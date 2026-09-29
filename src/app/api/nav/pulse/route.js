/**
 * GET /api/nav/pulse — the navigation rail's living chart.
 *
 * ── THE READ-BOUNDARY LAW (§5.4) ────────────────────────────────────────────
 * This door carries INTEGERS, ONE TIMESTAMP, BOOLEANS, and exactly one word
 * drawn from a closed vocabulary (`providers.worst`). No provider name, no key
 * name, no `proxyUrl`, no credential, no `providerSpecificData`, no id: the rail
 * learns that something is unwell, never what it is called.
 *
 * Every field is projected through an explicit allowlist — `pick` over a NAMED
 * set of numeric keys. No sibling payload is spread, and no source returns raw
 * data: the assembler assigns each source's section by its declared name, and
 * every value in that section was built key by key. A column added to a sibling
 * census tomorrow therefore cannot ride out through this door, because this door
 * never copies what it was not told to. (The sentinel case is in the suite: a
 * sibling payload carrying `apiKey` / `proxyUrl` / `providerName` comes back
 * with none of them.)
 *
 * ── WHY THE SIBLING ROUTES ARE CALLED, NOT RE-IMPLEMENTED ───────────────────
 * Each source imports the sibling's own GET and drives it, the same fan-out
 * `GET /api/cli-tools/all-statuses` uses. The rail must not be able to disagree
 * with the room: if this route counted providers itself, the v0.9.86 lesson
 * would return — two surfaces, two arithmetics, one of them always stale.
 * Re-implementing the arithmetic here would also put a second copy of every
 * census query in the repo to drift.
 *
 * ── DEGRADATION IS BY ABSENCE, NOT BY ZERO ──────────────────────────────────
 * All six sources run inside ONE `Promise.allSettled`. A source that rejects,
 * answers non-2xx, or returns a short payload has its section OMITTED and its
 * flag `false`; the other five still speak. A rail that blanked because one
 * census hiccuped is a worse lie than a rail missing one lens — and zeroing a
 * missing section would be indistinguishable from a genuinely empty fleet,
 * which is precisely the impersonation the sibling censuses refuse (see
 * GET /api/proxy-pools/stats, "a zeroed census is worse than an error").
 *
 * ── THE MEMO ────────────────────────────────────────────────────────────────
 * 30 seconds. The nav mounts on EVERY route change, and these reads are not
 * free: `usage/providers/activity` groups a rolling 60s row window, and
 * `getUsageStats` scans and aggregates the whole history for the period. The
 * sibling frame is already memoized ≤30s (PERPROVIDER_MEMO_TTL_MS), so a window
 * that matches it turns a page navigation into one cheap read instead of six
 * scans. A cached body is returned with its ORIGINAL `ts` — the timestamp says
 * when the numbers were true, not when they were last asked for.
 */
import { NextResponse } from "next/server";
import { GET as keysStats } from "../../keys/stats/route";
import { GET as providersStatus } from "../../providers/status/route";
import { GET as combosStats } from "../../combos/stats/route";
import { GET as proxyPoolsStats } from "../../proxy-pools/stats/route";
import { GET as usageStats } from "../../usage/stats/route";
import { GET as providerActivity } from "../../usage/providers/activity/route";

// A census must describe the fleet NOW, never a build-time snapshot.
export const dynamic = "force-dynamic";

// The keys census is windowed (`?period=`), and "needs attention" is not a
// window-free fact: attentionFor() calls out "no traffic in window", so the
// count moves with the window. 30d is the operator's reading window and keeps
// the rail's number stable against a day of browsing.
const KEYS_PERIOD = "30d";

// A window long enough that a normal burst of navigation does not re-run six
// scans, short enough that the rail never shows yesterday's fleet.
const MEMO_MS = 30_000;

// The one string this door will carry, and only from its own closed list. The
// sibling already computes a worst state (down > degraded > cooling > idle >
// healthy); anything outside the vocabulary is not a state we can glint about,
// so it is read as "healthy" rather than echoed.
const PROVIDER_STATES = ["down", "degraded", "cooling", "idle", "healthy"];

// The sibling GETs read their query string off a real Request; the origin is
// never dialled — these are in-process handler calls, exactly as
// all-statuses/route.js fans its siblings.
const INTERNAL_ORIGIN = "http://internal";
function ask(path) {
  return new Request(`${INTERNAL_ORIGIN}${path}`);
}

/** An integer, or 0 for anything that is not one. A count with no value is
 *  zero by definition; a string, NaN or null is not a count of anything. */
function countOf(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** A currency amount is not truncated — cost carries cents. */
function amountOf(value) {
  return Number.isFinite(value) ? value : 0;
}

/** THE ALLOWLIST. Emits exactly the named keys, each as an integer, and nothing
 *  else from the object handed in — never the object itself. */
function pick(source, names) {
  const out = {};
  for (const name of names) out[name] = countOf(source?.[name]);
  return out;
}

// ── THE SIX SOURCES ──────────────────────────────────────────────────────────
// Each declares the body section it fills and returns a value built key by key
// from the sibling's ACTUAL field names. A source that cannot find its own
// required field treats itself as unavailable rather than reporting a zero.
const SOURCES = [
  {
    name: "keys",
    section: "keys",
    async read() {
      const res = await keysStats(ask(`/api/keys/stats?period=${KEYS_PERIOD}`));
      if (!res?.ok) throw new Error(`keys/stats answered ${res?.status}`);
      const data = await res.json();
      // MAPPED: `totals.keys` is the whole table (keys/stats counts the rows it
      // read); `attention` is a LIST of {id, name, posture, reasons} — the rail
      // takes its LENGTH and never the list, so no key name or id crosses here.
      if (!Number.isFinite(data?.totals?.keys)) throw new Error("keys/stats carried no totals.keys");
      return {
        total: countOf(data.totals.keys),
        attention: countOf(Array.isArray(data.attention) ? data.attention.length : NaN),
      };
    },
  },
  {
    name: "providers",
    section: "providers",
    async read() {
      const res = await providersStatus(ask("/api/providers/status"));
      if (!res?.ok) throw new Error(`providers/status answered ${res?.status}`);
      const data = await res.json();
      if (!data?.counts || typeof data.counts !== "object") {
        throw new Error("providers/status carried no counts");
      }
      // MAPPED: `counts` is the five-state census, `providers` is the fleet
      // size. Zero-connections providers are absent from the sibling by design.
      return {
        total: countOf(data.providers),
        ...pick(data.counts, ["healthy", "degraded", "down", "cooling", "idle"]),
        worst: PROVIDER_STATES.includes(data.worst) ? data.worst : "healthy",
      };
    },
  },
  {
    name: "combos",
    section: "combos",
    async read() {
      const res = await combosStats(ask("/api/combos/stats?hours=24"));
      if (!res?.ok) throw new Error(`combos/stats answered ${res?.status}`);
      const data = await res.json();
      if (!data?.totals || typeof data.totals !== "object") {
        throw new Error("combos/stats carried no totals");
      }
      // MAPPED: the sibling analyses only llm combos (`totals.combos`) but also
      // counts the whole table as `totals.combosAllKinds` — the rail reports the
      // whole table, and active/idle are the traffic split WITHIN the analysed
      // llm set (the sibling's own arithmetic, not a re-derivation of it).
      return {
        total: countOf(data.totals.combosAllKinds),
        active: countOf(data.totals.activeCombos),
        idle: countOf(data.totals.idleCombos),
      };
    },
  },
  {
    name: "proxy",
    section: "proxy",
    async read() {
      const res = await proxyPoolsStats(ask("/api/proxy-pools/stats"));
      if (!res?.ok) throw new Error(`proxy-pools/stats answered ${res?.status}`);
      const data = await res.json();
      if (!Number.isFinite(data?.total) || !data?.fitness) {
        throw new Error("proxy-pools/stats carried no census");
      }
      // MAPPED: `total`/`active` are the pool census; `fitness.blocked` is the
      // count of (pool, provider) rows sitting in an OPEN unfit window. The
      // sibling emits no pool row at all, so there is no `proxyUrl` to mask —
      // and none is read here either.
      return {
        total: countOf(data.total),
        active: countOf(data.active),
        blocked: countOf(data.fitness.blocked),
      };
    },
  },
  {
    name: "usage",
    section: "usage",
    async read() {
      const res = await usageStats(ask("/api/usage/stats?period=today"));
      if (!res?.ok) throw new Error(`usage/stats answered ${res?.status}`);
      const data = await res.json();
      if (!Number.isFinite(data?.totalRequests)) {
        throw new Error("usage/stats carried no totalRequests");
      }
      // MAPPED: `totalRequests`/`totalCost` are the sibling's own two headline
      // integers. Its `byProvider`/`byApiKey`/`byAccount` maps carry NAMES —
      // they are read here for nothing.
      return {
        requests: countOf(data.totalRequests),
        cost: amountOf(data.totalCost),
      };
    },
  },
  {
    name: "errors",
    section: "errors",
    async read() {
      const res = await providerActivity(ask("/api/usage/providers/activity"));
      if (!res?.ok) throw new Error(`usage/providers/activity answered ${res?.status}`);
      const data = await res.json();
      if (!data?.perProvider || typeof data.perProvider !== "object") {
        throw new Error("usage/providers/activity carried no perProvider");
      }
      // MAPPED: `perProvider` is an OBJECT KEYED BY PROVIDER ID, each cell
      // {requests, errors} over a rolling 60s window. The ids ARE the sensitive
      // part, so this sums the cells and never touches the keys.
      let count = 0;
      for (const cell of Object.values(data.perProvider)) count += countOf(cell?.errors);
      return { count };
    },
  },
];

// Module-level, so the memo survives between requests on the same worker.
let memo = { at: 0, body: null };

export async function GET() {
  try {
    const now = Date.now();
    if (memo.body && now - memo.at < MEMO_MS) {
      return NextResponse.json(memo.body);
    }

    // ONE allSettled for all six: a slow or failing source can never blank the
    // others, and no source can reject the request as a whole.
    const settled = await Promise.allSettled(SOURCES.map((source) => source.read()));

    const body = { ts: now, sources: {} };
    settled.forEach((result, index) => {
      const source = SOURCES[index];
      if (result.status === "fulfilled") {
        body.sources[source.name] = true;
        // Assigned under the source's DECLARED section name — the value was
        // built key by key inside read(); nothing sibling-shaped is copied.
        body[source.section] = result.value;
      } else {
        body.sources[source.name] = false;
        // A rejection can arrive carrying no reason at all — measured on a cold
        // Turbopack compile, where the six sibling modules (and everything they
        // import) were still being built as the pulse called into them. A log
        // that prints "undefined" is a blind instrument, so the shape of the
        // reason is named here rather than left to guesswork.
        const why =
          result.reason?.message ??
          (result.reason === undefined
            ? "rejected with no reason (cold compile?)"
            : String(result.reason));
        console.log(`[nav/pulse] ${source.name} source unavailable: ${why}`);
      }
    });

    // NEVER MEMO A PARTIAL BODY. A partially-blind census must not be allowed
    // to become the rail's truth for half a minute: the first request on a cold
    // dev compile answers 200 with every source false, and caching THAT would
    // freeze a blank rail for the whole window. So a partial answer is still
    // served — honest, and it degrades per-tile exactly as designed — but it is
    // never cached; the next request re-runs the fan-out, and once every source
    // answers, that complete body is what gets memoized.
    const complete = SOURCES.every((source) => body.sources[source.name] === true);
    memo = complete ? { at: now, body } : { at: 0, body: null };
    return NextResponse.json(body);
  } catch (error) {
    // Reached only if the pulse ITSELF fails (the assembler, not a source) —
    // a loud 500, never a chart that reads "nothing is wrong here".
    console.log("Error building nav pulse:", error);
    return NextResponse.json({ error: "Failed to build nav pulse" }, { status: 500 });
  }
}
