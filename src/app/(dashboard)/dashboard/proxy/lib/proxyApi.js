// The proxy console's API seams — every fetch the console makes lives here, so a
// route change is one edit and no component ever hand-rolls a URL.
//
// One seam is load-bearing beyond convenience: `runBulkHealth` POSTs
// `/api/proxy-pools/bulk-health` ONCE. The console used to fan out N client calls
// to `/api/proxy-pools/[id]/test`, which put the health verdict in the browser —
// where it could disagree with the server's own scheduler, and where a client-side
// "not ok" was indistinguishable from a deterministic death. One request, one loop,
// the engine's answer (alive / dead / indeterminate) verbatim.

async function asJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** GET the fleet with bound-connection counts. */
export async function loadPools({ includeUsage = true } = {}) {
  const res = await fetch(`/api/proxy-pools${includeUsage ? "?includeUsage=true" : ""}`, { cache: "no-store" });
  const data = await asJson(res);
  return { ok: res.ok, pools: data.proxyPools || [], body: data };
}

/** GET the fitness projection plus the shared egress geo registry. */
export async function loadFitness() {
  const res = await fetch("/api/proxy-pools/fitness", { cache: "no-store" });
  const data = await asJson(res);
  return { ok: res.ok, fitness: data.fitness || { pools: [] }, geo: data.geo || {}, body: data };
}

export async function loadSettings() {
  const res = await fetch("/api/settings", { cache: "no-store" });
  return asJson(res);
}

export async function saveGeoToggle(enabled) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ poolGeoProbeEnabled: enabled }),
  });
  return { ok: res.ok, body: await asJson(res) };
}

export async function createPool(payload) {
  const res = await fetch("/api/proxy-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function updatePool(id, payload) {
  const res = await fetch(`/api/proxy-pools/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function deletePool(id) {
  const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

/** Test ONE pool. The [id]/test route owns the verdict and isActive change. */
export async function testPool(id) {
  const res = await fetch(`/api/proxy-pools/${id}/test`, { method: "POST" });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

/**
 * The bulk health sweep — ONE request, never N.
 *
 * Defect 1 (fixed): the console fanned out one `/test` call per pool with its own
 * concurrency queue and its own alive/dead tally. That is a second health loop in
 * the browser, and it drifted from the server's exactly as bulk-health's route once
 * drifted from `checkAllPools`. Now the console POSTs this endpoint once and reads
 * the engine's counts + per-pool `results` back.
 *
 * `autoDisable` is forwarded, never acted on here: the engine disables only a
 * DETERMINISTIC `dead`, so an indeterminate probe can never be liquidated through
 * this path. The console renders the three counts and offers a disable only for the
 * proven-dead subset — and it does so by explicit operator confirm, not silently.
 */
export async function runBulkHealth({ autoDisable = false, concurrency = null } = {}) {
  const res = await fetch("/api/proxy-pools/bulk-health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoDisable, concurrency }),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function resetFitness(poolId, providerId = null) {
  const res = await fetch("/api/proxy-pools/fitness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ poolId, providerId }),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function clearAllFitness(providerId = null) {
  const res = await fetch("/api/proxy-pools/fitness/clear-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(providerId ? { provider: providerId } : {}),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

/** Probe one pool's egress (IP echo + geo). */
export async function probePoolEgress(id) {
  const res = await fetch(`/api/proxy-pools/${id}/probe`, { method: "POST" });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function deployVercel(form) {
  const res = await fetch("/api/proxy-pools/vercel-deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function deployCloudflare(form) {
  const res = await fetch("/api/proxy-pools/cloudflare-deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function deployDeno(form) {
  const res = await fetch("/api/proxy-pools/deno-deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export const DEPLOYERS = Object.freeze({
  vercel: deployVercel,
  cloudflare: deployCloudflare,
  deno: deployDeno,
});
