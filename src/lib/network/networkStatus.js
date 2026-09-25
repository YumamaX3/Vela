/**
 * Network status readers — the Network lens's read-only truth surfaces.
 *
 * Each reader opens an engine the harbor already runs and returns its state in
 * the shape a card can render. Nothing here mutates: the readers observe.
 *
 *   • getRateLimitSnapshot — the per-key sliding-60s windows (`keyGate`'s
 *     `global._velaRateWindows`) joined to each key's `rateLimitRpm` cap and
 *     CIDR allowlist. The window Map lives on globalThis (the same convention
 *     the breaker and geo registry use) so the reader and the enforcement stage
 *     share ONE Map.
 *   • getUpstreamHealth — the circuit breaker's snapshot (`healthy` / `cooldown`
 *     / `exhausted`) plus each pool's persisted EWMA (latency + success), which
 *     the fleet computes but the console never showed.
 *   • getEgressReport — the poolGeo registry's observed egress IPs, with the
 *     flapping classification (≥2 distinct IPs).
 *   • getTimeoutPolicy — the live runtimeConfig timeout bindings beside the
 *     env/default floor and the operator's stored overrides.
 *
 * Fail-open everywhere: a reader that cannot reach its engine returns an empty
 * shape, never a throw — the lens must render even when a subsystem is asleep.
 */
import { getApiKeys } from "@/lib/localDb";
import { getProxyPools } from "@/lib/localDb";
import { getSnapshot as getBreakerSnapshot } from "./circuitBreaker.js";
import { poolGeoSnapshot } from "./poolGeo.js";

const RATE_WINDOW_MS = 60_000;

/** Per-key rate-limit windows: cap, used, remaining, and reset time. */
export async function getRateLimitSnapshot({ now = Date.now() } = {}) {
  try {
    const keys = await getApiKeys();
    const windows = global._velaRateWindows || new Map();
    const rows = (keys || []).map((k) => {
      const cap = Number(k.rateLimitRpm) > 0 ? Number(k.rateLimitRpm) : null;
      const stamps = (windows.get(k.keyId) || []).filter((t) => t > now - RATE_WINDOW_MS);
      const used = stamps.length;
      const oldest = used ? Math.min(...stamps) : null;
      return {
        id: k.id,
        name: k.name || "(unnamed)",
        cap,
        used,
        remaining: cap ? Math.max(0, cap - used) : null,
        resetsAt: cap && oldest ? new Date(oldest + RATE_WINDOW_MS).toISOString() : null,
        ipAllowlist: Array.isArray(k.ipAllowlist) ? k.ipAllowlist : [],
        ipRestricted: Array.isArray(k.ipAllowlist) && k.ipAllowlist.length > 0,
      };
    });
    return { ok: true, windowMs: RATE_WINDOW_MS, keys: rows, limited: rows.filter((r) => r.cap).length };
  } catch (err) {
    return { ok: false, error: err?.message || "rate snapshot failed", windowMs: RATE_WINDOW_MS, keys: [], limited: 0 };
  }
}

/** Circuit-breaker states + pool EWMA — the engine's health, finally visible. */
export async function getUpstreamHealth() {
  let breaker = [];
  try {
    breaker = getBreakerSnapshot() || [];
  } catch {
    breaker = [];
  }
  let pools = [];
  try {
    const list = await getProxyPools({});
    pools = (list || []).map((p) => ({
      id: p.id,
      name: p.name || "(unnamed)",
      isActive: p.isActive === true,
      testStatus: p.testStatus ?? null,
      latencyEwmaMs: typeof p.latencyEwmaMs === "number" ? p.latencyEwmaMs : null,
      successEwma: typeof p.successEwma === "number" ? p.successEwma : null,
      lastError: p.lastError ?? null,
    }));
  } catch {
    pools = [];
  }
  const open = breaker.filter((b) => b.state === "cooldown" || b.state === "exhausted");
  return {
    ok: true,
    breaker,
    openCount: open.length,
    healthyCount: breaker.filter((b) => b.state === "healthy").length,
    pools,
    checkedAt: new Date().toISOString(),
  };
}

/** The observed egress identities — IP, geo, and flapping classification. */
export async function getEgressReport({ now = Date.now() } = {}) {
  try {
    // poolGeoSnapshot returns an OBJECT keyed by poolId (not an array) — the
    // registry's own shape, preserved rather than re-shaped here.
    const byId = poolGeoSnapshot(now) || {};
    const entries = Object.entries(byId).map(([poolId, e]) => ({ poolId, ...e }));
    const observed = entries.filter((e) => e?.ip);
    const flapping = observed.filter((e) => e?.isUnstable);
    return { ok: true, entries, observedCount: observed.length, flappingCount: flapping.length, checkedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err?.message || "egress report failed", entries: [], observedCount: 0, flappingCount: 0 };
  }
}

/** The live timeout policy beside its floor and the operator's stored overrides. */
export async function getTimeoutPolicy() {
  try {
    const rt = await import("open-sse/config/runtimeConfig.js");
    const settings = await import("@/lib/localDb").then((m) => m.getSettings());
    return {
      ok: true,
      live: {
        streamStallTimeoutMs: rt.STREAM_STALL_TIMEOUT_MS,
        streamFirstChunkTimeoutMs: rt.STREAM_FIRST_CHUNK_TIMEOUT_MS,
        fetchConnectTimeoutMs: rt.FETCH_CONNECT_TIMEOUT_MS,
      },
      floor: rt.NETWORK_TIMEOUT_DEFAULTS,
      stored: {
        streamStallTimeoutMs: settings?.streamStallTimeoutMs ?? null,
        streamFirstChunkTimeoutMs: settings?.streamFirstChunkTimeoutMs ?? null,
        fetchConnectTimeoutMs: settings?.fetchConnectTimeoutMs ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: err?.message || "timeout policy read failed" };
  }
}
