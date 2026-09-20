// The proxy console's pure formatting + verdict vocabulary.
//
// Three verdicts, not two. The fleet's own wound (v0.9.42) was a health path that
// collapsed `indeterminate` into `dead`, so a timeout — or a throw in the probe's
// own path — read as death and disabled a working pool. The vocabulary lives here
// so the whole console speaks it once: `ok`, `dead`, `indeterminate`, and the last
// one is never silently downgraded to death.
//
// A pool row carries `testStatus` from the DB, which has three values already
// ("active" | "error" | "unknown") because the [id]/test route writes the verdict
// through. `unknown` is the persisted shape of "the probe could not decide" — it is
// rendered as indeterminate, and the copy says so.

export const VERDICT = Object.freeze({
  OK: "ok",
  DEAD: "dead",
  INDETERMINATE: "indeterminate",
});

/** Map a stored pool.testStatus to a verdict. */
export function verdictFromTestStatus(testStatus) {
  if (testStatus === "active") return VERDICT.OK;
  if (testStatus === "error") return VERDICT.DEAD;
  // "unknown", absent, or anything else the probe could not decide.
  return VERDICT.INDETERMINATE;
}

/** Map a probe result (single or bulk) to a verdict. Only a DETERMINISTIC
 *  `dead` is death; a missing/other verdict is indeterminate by construction. */
export function verdictFromResult(result) {
  if (result?.verdict === "alive") return VERDICT.OK;
  if (result?.verdict === "dead") return VERDICT.DEAD;
  return VERDICT.INDETERMINATE;
}

// `variant` maps onto the shared Badge's tones. `label` is what the operator reads;
// the indeterminate label says "indeterminate" rather than borrowing "dead" or
// "error", because the whole point of the fix is that the state is nameable.
export const VERDICT_META = Object.freeze({
  [VERDICT.OK]: {
    label: "ok",
    variant: "success",
    title: "Probe succeeded",
  },
  [VERDICT.DEAD]: {
    label: "dead",
    variant: "error",
    title: "Probe failed deterministically",
  },
  [VERDICT.INDETERMINATE]: {
    label: "indeterminate",
    variant: "warning",
    title: "Probe could not decide: unknown, left active",
  },
});

/** A pool's verdict from its row (uses the last test's persisted status). */
export function verdictOfPool(pool) {
  return verdictFromTestStatus(pool?.testStatus);
}

export function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function fmtTime(value) {
  if (!value) return "n/a";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "n/a" : d.toLocaleString();
}

/** Strip credentials before rendering a proxy URL. The GET route already masks,
 *  but the console masks defensively: a masked value rendered is a value that
 *  cannot leak if a future read path forgets. */
export function maskProxyUrl(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return String(url || "");
  }
}

// A fitness summary row becomes one "block" record when its unfit window is still
// open. Expired windows are relaxed server-side by picking's self-recovery; we drop
// them client-side too so the ledger never shows stale anger.
export function isBlocked(rec, now = Date.now()) {
  if (!rec?.unfit) return false;
  const until = rec.unfitUntil ? Date.parse(rec.unfitUntil) : null;
  if (until === null || Number.isNaN(until)) return true; // open-ended block
  return now < until;
}

/** The relay platforms the console deploys, in row order. */
export const RELAY_PLATFORMS = Object.freeze([
  { id: "vercel", label: "Vercel Relay", type: "vercel", icon: "cloud_upload", tone: "text-blue-500" },
  { id: "cloudflare", label: "Cloudflare Relay", type: "cloudflare", icon: "cloud", tone: "text-orange-500" },
  { id: "deno", label: "Deno Relay", type: "deno", icon: "terminal", tone: "text-green-500" },
]);

export function isRelayPool(pool) {
  return pool?.type === "vercel" || pool?.type === "cloudflare" || pool?.type === "deno";
}

// §5.4 — when EDITING, proxyUrl is deliberately left blank rather than loaded from
// the pool. The GET response is masked (credentials stripped), and the repo's
// updateProxyPool MERGES (`{ ...rowToPool(row), ...data }`), so whatever the form
// sends for proxyUrl is what gets stored. Sending the masked value — or a sentinel —
// would silently overwrite the operator's real credential with "http://host:port/"
// and break the pool. Blank means "untouched", and handleSave omits the key entirely
// in that case, so normalizeProxyPoolUpdate's hasOwnProperty guard keeps the value.
export function normalizePoolForm(data = {}, { isEdit = false } = {}) {
  return {
    name: data.name || "",
    proxyUrl: isEdit ? "" : (data.proxyUrl || ""),
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

/** Parse one pasted proxy line. Throws with a human message on an unsupported shape. */
export function parseProxyLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed);
    const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    return { proxyUrl: parsed.toString(), name: `Imported ${hostLabel}` };
  }
  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    if (!host || !port || !username || !password) {
      throw new Error("Invalid host:port:user:pass format");
    }
    const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    const parsed = new URL(proxyUrl);
    return { proxyUrl: parsed.toString(), name: `Imported ${host}:${port}` };
  }
  throw new Error("Unsupported format");
}
