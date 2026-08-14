// Key-limit primitives shared by the gate (enforcement) and the repo
// (validation) — kept here so apiKeysRepo never imports keyGate (which
// imports apiKeysRepo). CIDR matching, budget scopes, and write-side
// validation for the W3 governance columns.
// Plan: plans/vela-key-governance.md §3.4 W3.

// ── CIDR parsing & matching ────────────────────────────────────────────────
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is normalized to plain v4 on both sides
// so a v4 allowlist entry matches a socket that reports the mapped form.

function parseIpToBytes(ip) {
  if (typeof ip !== "string" || !ip) return null;
  let s = ip.trim();
  // Strip IPv6 zone suffix (fe80::1%eth0)
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.toLowerCase().startsWith("::ffff:") && s.slice(7).includes(".") && s.indexOf(":", 7) === -1) {
    s = s.slice(7); // ::ffff:1.2.3.4 → 1.2.3.4
  }
  if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length !== 4) return null;
    const bytes = [];
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const n = Number(p);
      if (n > 255) return null;
      bytes.push(n);
    }
    return Uint8Array.from(bytes);
  }
  if (!s.includes(":")) return null;
  const doubleColonCount = (s.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;
  let head = s, tail = "";
  if (s.includes("::")) {
    const idx = s.indexOf("::");
    head = s.slice(0, idx);
    tail = s.slice(idx + 2);
  }
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  if (headGroups.length + tailGroups.length > 8) return null;
  for (const g of [...headGroups, ...tailGroups]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** Parse "a.b.c.d/n" or "ipv6/n" → { bytes: Uint8Array, prefix } or null. */
export function parseCidr(cidr) {
  if (typeof cidr !== "string") return null;
  const slash = cidr.indexOf("/");
  const ipPart = slash === -1 ? cidr : cidr.slice(0, slash);
  const bytes = parseIpToBytes(ipPart);
  if (!bytes) return null;
  const max = bytes.length === 4 ? 32 : 128;
  const prefix = slash === -1 ? max : Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { bytes, prefix };
}

/** Does `cidr` contain `ip`? Accepts parsed or raw forms. */
export function cidrContains(cidr, ip) {
  const net = typeof cidr === "object" && cidr?.bytes ? cidr : parseCidr(cidr);
  if (!net) return false;
  const ipBytes = parseIpToBytes(typeof ip === "string" ? ip : "");
  if (!ipBytes) return false;
  // Align families: compare v4↔v4 only. A v6-only candidate can't match a v4
  // net and vice versa (mapped forms were already normalized to v4).
  if (ipBytes.length !== net.bytes.length) return false;
  const fullBytes = Math.floor(net.prefix / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (ipBytes[i] !== net.bytes[i]) return false;
  }
  const remBits = net.prefix % 8;
  if (remBits) {
    const mask = 0xff << (8 - remBits) & 0xff;
    if ((ipBytes[fullBytes] & mask) !== (net.bytes[fullBytes] & mask)) return false;
  }
  return true;
}

// ── Budget scopes ──────────────────────────────────────────────────────────
// One window governs BOTH the token budget and the spend cap. Column names
// carry "Daily" for migration compatibility; the scope decides the reset.
export const BUDGET_SCOPES = ["daily", "weekly", "monthly", "yearly"];

// ── Write-side validation for W3 governance fields ─────────────────────────

const INT_FIELDS = ["rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents"];
const MAX_ALLOWLIST_ENTRIES = 100;

/** Thrown by the repo when governance fields fail validation. Carries every
 *  problem so the route can answer honestly in one 400. */
export class KeyLimitsValidationError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "KeyLimitsValidationError";
    this.errors = errors;
  }
}

/**
 * Validate + normalize the W3 governance fields present in `data`. Absent
 * fields are ignored (partial updates). null means "unlimited / none".
 * Returns { ok: true, values } or { ok: false, errors }.
 */
export function validateKeyLimits(data) {
  const errors = [];
  const values = {};

  for (const f of INT_FIELDS) {
    if (!(f in data)) continue;
    const v = data[f];
    if (v == null) { values[f] = null; continue; }
    if (!Number.isInteger(v) || v <= 0) {
      errors.push(`${f} must be a positive integer or null (unlimited)`);
      continue;
    }
    values[f] = v;
  }

  if ("budgetScope" in data) {
    const v = data.budgetScope;
    if (v == null) values.budgetScope = null;
    else if (!BUDGET_SCOPES.includes(v)) {
      errors.push(`budgetScope must be one of: ${BUDGET_SCOPES.join(", ")} (or null for the daily default)`);
    } else values.budgetScope = v;
  }

  if ("expiresAt" in data) {
    const v = data.expiresAt;
    if (v == null) values.expiresAt = null;
    else if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
      errors.push("expiresAt must be an ISO 8601 date string or null (never expires)");
    } else if (Date.parse(v) <= Date.now()) {
      errors.push("expiresAt must be in the future (the gate would reject this key immediately)");
    } else values.expiresAt = new Date(v).toISOString();
  }

  if ("ipAllowlist" in data) {
    const v = data.ipAllowlist;
    if (v == null) values.ipAllowlist = null;
    else if (!Array.isArray(v)) {
      errors.push("ipAllowlist must be an array of CIDR strings (or null for unrestricted)");
    } else if (v.length > MAX_ALLOWLIST_ENTRIES) {
      errors.push(`ipAllowlist is limited to ${MAX_ALLOWLIST_ENTRIES} entries`);
    } else if (v.some((e) => typeof e !== "string" || !e.trim() || !parseCidr(e.trim()))) {
      errors.push("every ipAllowlist entry must be a valid IP or CIDR (e.g. 10.0.0.0/8, 2001:db8::/32)");
    } else {
      values.ipAllowlist = [...new Set(v.map((e) => e.trim()))];
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, values };
}
