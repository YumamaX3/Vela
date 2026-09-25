"use client";

// The settings room's single current to the server.
//
// `PATCH /api/settings` is the one write door this room has ever had, and it
// stays that way. A second door would mean a second place to keep the writable
// allow-list, the nested `budgetAlerts` deep-merge and the four side effects
// (proxy env, digest scheduler, combo rotation, quota auto-ping) honest — and
// the two would drift. Every tab reaches the server through this file.

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function fetchSettings() {
  const res = await fetch("/api/settings", { cache: "no-store" });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || "Failed to load settings");
  return data;
}

export async function patchSettings(body) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || "Failed to save settings");
  return data;
}

export async function testProxy(proxyUrl) {
  const res = await fetch("/api/settings/proxy-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxyUrl }),
  });
  const data = await readJson(res);
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Proxy test failed");
  return data;
}
/** The Network lens's one read — rate windows, upstream health, egress, timeouts. */
export async function fetchNetworkStatus() {
  const res = await fetch("/api/network/status", { cache: "no-store" });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || "Failed to load network status");
  return data;
}
/** The Network Doctor — the phase sweep (DNS → TCP → TLS → HTTP) + egress identity. */
export async function runNetworkDiagnose({ urls = [], proxyUrl } = {}) {
  const res = await fetch("/api/network/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, ...(proxyUrl === undefined ? {} : { proxyUrl }) }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || "Diagnostics failed");
  return data;
}

export async function testOidc(body) {
  const res = await fetch("/api/auth/oidc/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok || !data?.ok) throw new Error(data.error || "OIDC connection test failed");
  return data;
}

export async function testSaml(body) {
  const res = await fetch("/api/auth/saml/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error || "SAML configuration test failed");
  return data;
}

// The backup surface takes its own password header — never the session cookie
// alone — so the export leg carries the operator's confirmation explicitly.
export async function exportDatabase(password) {
  const res = await fetch("/api/settings/database", {
    headers: { "x-9r-password": password },
  });
  if (!res.ok) throw new Error((await readJson(res)).error || "Failed to export database");
  return res.json();
}
// The export studio's selective leg: the same door, narrowed to the sections
// the operator picked. `sections: null` is the whole database (byte-identical
// to the surface above). The section vocabulary is the import's own — a file
// exported with a selection re-imports with the same selection.
export async function exportDatabaseSections(password, sections = null) {
  const qs = Array.isArray(sections) && sections.length > 0 ? `?sections=${encodeURIComponent(sections.join(","))}` : "";
  const res = await fetch(`/api/settings/database${qs}`, {
    headers: { "x-9r-password": password },
  });
  if (!res.ok) throw new Error((await readJson(res)).error || "Failed to export database");
  return res.json();
}

export async function importDatabase(payload, password) {
  const res = await fetch("/api/settings/database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, password }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || "Failed to import database");
  return data;
}
// The selective-import ceremony: the same door, with the operator's chosen
// sections and a dry-run flag riding the body. `sections: null` is the
// historical whole-restore; a dry run writes nothing and answers the plan.
export async function importDatabaseWithOptions(payload, password, { sections = null, dryRun = false } = {}) {
  const res = await fetch("/api/settings/database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, password, sections, dryRun }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || (dryRun ? "Could not analyze backup file" : "Failed to import database"));
  return data;
}

// Expected to fail as the server closes the socket under us; both outcomes mean
// the shutdown began, so the throw is swallowed here rather than at every call.
export async function shutdownServer() {
  try {
    await fetch("/api/version/shutdown", { method: "POST" });
  } catch {
    /* the harbor closes behind us */
  }
}

export async function logout() {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error("Failed to log out");
  window.location.assign("/login");
}

// The export payload never touched the wire as a download before this moved
// here — it was built inline in the page. Named, so the stamp and the filename
// live in exactly one place.
export function downloadBackup(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Vela-backup-${new Date().toISOString().replace(/[.:]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
