// The Keeper's Logbook — shared voice kit for every log line the gateway speaks.
// Pure formatting only: no I/O, no clock reads, no globals — safe for any caller.

/**
 * Duration as a tide reads it: ms under a second, seconds (one decimal) under
 * a minute, then m+ss, then h+mm. 58365 → "58.4s" · 393498 → "6m33s".
 */
export function fmtDur(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 1000) return `${Math.round(v)}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m${String(rs).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Token counts with thousands separators: 76162 → "76,162".
 */
export function fmtTok(n) {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(v);
}

// One field value on a log row: arrays read as short lists, objects read as
// compact JSON, long strings are clamped so one field can never flood the ledger.
function fieldStr(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const items = v.slice(0, 3).map((x) => {
      const s = typeof x === "string" ? x : JSON.stringify(x);
      return s.length > 14 ? `${s.slice(0, 11)}…` : s;
    });
    return v.length > 3 ? `${items.join(",")} +${v.length - 3}` : items.join(",");
  }
  let s;
  try { s = typeof v === "string" ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s.length > 96) s = `${s.slice(0, 93)}…`;
  return s;
}

/**
 * Render an options object as an inline ` · key=value` chain (or pass a plain
 * string through untouched). The one shape every structured log row shares.
 */
export function kv(data, sep = " · ") {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data ? `${sep}${data}` : "";
  if (typeof data !== "object") return `${sep}${fieldStr(data)}`;
  const parts = Object.entries(data).map(([k, v]) => `${k}=${fieldStr(v)}`);
  return parts.length ? `${sep}${parts.join(sep)}` : "";
}
