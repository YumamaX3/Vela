/**
 * Background pool egress geo probe — fills the poolGeo cache so the
 * Proxy Pools dashboard can show each pool's egress IP + country, and future
 * provider region policies can pre-mark pools unfit. Pattern: MIBP's
 * poolEgressProbe, seam-native (rides Vela's proxyAwareFetch + proxyFleet).
 *
 * Fail-open everywhere; never blocks startup or requests.
 *
 * Rate safety: a chain of free geo endpoints is tried in order through the
 * pool (rate-friendly first, quota-bound ipinfo last); failing pools get a
 * per-family negative backoff instead of being re-probed every pass, and
 * per-pass output is a single aggregated summary line.
 */

import { getProxyPools } from "@/models";
import { getSettings } from "@/lib/localDb";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getPoolGeo, setPoolGeo, POOL_GEO_TTL_MS } from "./poolGeo.js";

const PROBE_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;
const CONCURRENCY = 3;
// Re-probe a pool when its last sample is older than this — multiple samples
// per pool are what let us flag flapping (changing egress) relays.
const GEO_REPROBE_MS = 30 * 60 * 1000;

// Backoff windows per failure family: server/rate problems are likely to
// persist (broken relay, exhausted quota), network blips recover sooner.
const BACKOFF = {
  "rate-limit": 2 * 60 * 60 * 1000,
  server: 2 * 60 * 60 * 1000,
  network: 30 * 60 * 1000,
  timeout: 30 * 60 * 1000,
  "no-ip": 30 * 60 * 1000,
};

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let probing = false;
const probeBackoff = new Map(); // poolId -> retryAfter (ms epoch)

// Normalize a single provider's geo payload to { ip, country, region, city, org }.
const GEO_PARSE = {
  "ipwho.is": (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org || d?.connection?.org }),
  "ip-api": (d) => ({ ip: d?.query, country: d?.country, region: d?.regionName, city: d?.city, org: d?.org }),
  "ipapi.co": (d) => ({ ip: d?.ip, country: d?.country_name, region: d?.region, city: d?.city, org: d?.org }),
  ipinfo: (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org }),
};

// Tried in order — rate-friendly first, quota-bound ipinfo last.
const GEO_PROBES = [
  { name: "ipwho.is", url: "https://ipwho.is/" },
  { name: "ip-api", url: "https://ip-api.com/json/?fields=status,message,query,country,regionName,city,org" },
  { name: "ipapi.co", url: "https://ipapi.co/json/" },
  { name: "ipinfo", url: "https://ipinfo.io/json" },
];

function classifyFailure(err) {
  const name = String(err?.name || "").toLowerCase();
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("429") || msg.includes("rate")) return "rate-limit";
  if (msg.includes("timeout") || msg.includes("abort") || name === "aborterror") return "timeout";
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("eai_again") || msg.includes("network")) return "network";
  return "server";
}

// Probe one pool through the pool's own egress (proxy fetch with the pool URL).
async function probePool(pool) {
  const proxyOptions = { enabled: true, url: pool.proxyUrl, strictProxy: true };
  for (const probe of GEO_PROBES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("geo probe timeout")), 15_000);
    try {
      const res = await proxyAwareFetch(probe.url, { signal: ctrl.signal, headers: { "User-Agent": "Vela" } }, proxyOptions);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (res.status === 429) return { error: "rate-limit", detail: txt.slice(0, 120) };
        if (res.status >= 500) return { error: "server", detail: txt.slice(0, 120) };
        continue; // 4xx on this source — try the next
      }
      const data = await res.json().catch(() => null);
      const parsed = data && GEO_PARSE[probe.name] ? GEO_PARSE[probe.name](data) : null;
      if (parsed?.ip) return parsed;
      // Source answered without an IP — fall through to the next.
    } catch (err) {
      return { error: classifyFailure(err) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "no-ip" };
}

async function probeAll() {
  if (probing) return;
  probing = true;
  try {
    // UI toggle (settings.poolGeoProbeEnabled) gates the whole feature.
    try {
      const settings = await getSettings();
      if (settings?.poolGeoProbeEnabled === false) return;
    } catch { /* DB hiccup — keep probing (fail-open) */ }

    const pools = await getProxyPools({ isActive: true });
    const now = Date.now();
    const active = (pools || []).filter((p) => !!p?.proxyUrl);
    const targets = active.filter((p) => {
      const until = probeBackoff.get(p.id);
      if (until && until > now) return false; // waiting out a failure
      const geo = getPoolGeo(p.id);
      return !geo || now - geo.ts >= GEO_REPROBE_MS;
    });
    if (targets.length === 0) return;

    const failTally = {};
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(targets.length, 1)) }, async () => {
      while (next < targets.length) {
        const pool = targets[next++];
        try {
          const result = await probePool(pool);
          if (result.error) {
            failTally[result.error] = (failTally[result.error] || 0) + 1;
            probeBackoff.set(pool.id, Date.now() + (BACKOFF[result.error] || BACKOFF.server));
            continue;
          }
          setPoolGeo(pool.id, result);
          probeBackoff.delete(pool.id);
        } catch {
          // Per-pool failure must never break the sweep.
          failTally.network = (failTally.network || 0) + 1;
        }
      }
    });
    await Promise.all(workers);

    const okCount = targets.length - Object.values(failTally).reduce((a, b) => a + b, 0);
    const failSummary = Object.entries(failTally).map(([k, v]) => `${k}:${v}`).join(" ") || "none";
    console.log(`[poolEgressProbe] probed ${targets.length} pools (${okCount} ok) | failures ${failSummary}`);
  } catch (err) {
    console.warn("[poolEgressProbe] sweep failed:", err.message);
  } finally {
    probing = false;
  }
}

export function startPoolEgressProbe({ intervalMs = PROBE_INTERVAL_MS, initialDelayMs = INITIAL_DELAY_MS } = {}) {
  if (started) return false;
  if (typeof window !== "undefined") return false; // server-only
  started = true;
  initialTimeoutHandle = setTimeout(() => {
    probeAll().catch(() => {});
    intervalHandle = setInterval(() => probeAll().catch(() => {}), intervalMs);
    if (intervalHandle.unref) intervalHandle.unref();
  }, initialDelayMs);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();
  return true;
}

export function stopPoolEgressProbe() {
  if (initialTimeoutHandle) clearTimeout(initialTimeoutHandle);
  if (intervalHandle) clearInterval(intervalHandle);
  initialTimeoutHandle = null;
  intervalHandle = null;
  started = false;
}

export const __test__ = { probePool, classifyFailure, BACKOFF };
