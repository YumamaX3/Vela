// The combos deck's API seams — every fetch the page makes lives here, so a
// route change is one edit and no component ever hand-rolls a URL.

export const COMBOS_EXPORT_URL = "/api/combos/export";

async function asJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// One bootstrap pass: the fleet, the hub (connections + provider nodes), the
// settings that carry strategies and the capacity adapter, 24h usage, and the
// server's own census. Six requests in parallel — one round trip of latency.
export async function loadFleet({ hours = 24 } = {}) {
  const [combosRes, providersRes, settingsRes, usageRes, nodesRes, statsRes] = await Promise.all([
    fetch("/api/combos"),
    fetch("/api/providers"),
    fetch("/api/settings"),
    fetch(`/api/combos/usage?hours=${hours}`),
    fetch("/api/provider-nodes").catch(() => null),
    fetch(`/api/combos/stats?hours=${hours}`).catch(() => null),
  ]);

  const combosData = await asJson(combosRes);
  const providersData = await asJson(providersRes);
  const settingsData = settingsRes.ok ? await asJson(settingsRes) : {};
  const usageData = usageRes.ok ? await asJson(usageRes) : {};
  const nodesData = nodesRes && nodesRes.ok ? await asJson(nodesRes) : { nodes: [] };
  const statsData = statsRes && statsRes.ok ? await asJson(statsRes) : null;

  const usageByName = {};
  for (const row of usageData.combos || []) usageByName[row.combo] = row;

  return {
    ok: combosRes.ok,
    // Only LLM combos ride this deck — webSearch/webFetch combos belong to the
    // media-providers shore, which owns their semantics.
    combos: combosRes.ok
      ? (combosData.combos || []).filter((c) => !c.kind || c.kind === "llm")
      : [],
    connections: providersRes.ok ? providersData.connections || [] : [],
    settings: settingsData || {},
    usageByName,
    usageWindow: { hours: usageData.hours || hours, buckets: usageData.buckets || 24, since: usageData.since || null },
    nodePrefixes: (nodesData?.nodes || []).map((n) => n.prefix).filter(Boolean),
    serverStats: statsData && statsData.totals ? statsData : null,
  };
}

export async function createCombo(payload) {
  const res = await fetch("/api/combos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function updateCombo(id, payload) {
  const res = await fetch(`/api/combos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function deleteCombo(id) {
  const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function bulkCombo(body) {
  const res = await fetch("/api/combos/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

// Dry run first, always — the preview is what the operator approves.
export async function previewImport(payload, { onConflict = "skip" } = {}) {
  return bulkImport({ payload, mode: "dry-run", onConflict });
}

export async function applyImport(payload, { onConflict = "skip", applyStrategies = true } = {}) {
  return bulkImport({ payload, mode: "apply", onConflict, applyStrategies });
}

async function bulkImport(body) {
  const res = await fetch("/api/combos/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await asJson(res) };
}

export async function saveCapacityAdapter(capacityAdapter) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capacityAdapter }),
  });
  return { ok: res.ok, body: await asJson(res) };
}
