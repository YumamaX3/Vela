// The PROXY console's CSV vocabulary — used by the Tools page's two exports
// (§3.3: "Pool analytics CSV" ✦ NEW, and "Export" of the active fleet).
//
// WHY A CLIENT-SIDE CSV AT ALL: the two CSVs the Tools page offers are
// BRAIN-LOCAL projections of seams the page has ALREADY read (the analytics
// census, the export route's active-pool list). A second server route that
// re-ran the same projection would be a second arithmetic, and a second
// arithmetic is how two exports come to disagree about one fleet. So the page
// reads the seam once and writes the file here.
//
// THE FORMULA GUARD IS THE USAGE EXPORT'S, VERBATIM IN SPIRIT. Every cell is
// quoted, internal quotes doubled, and a cell whose text begins with = + - @ is
// padded with a tab INSIDE the quotes — so a spreadsheet treats it as text and
// never evaluates it. That matters more here than in usage: a pool's name is
// operator-supplied free text, and the console's own import path lets it be
// anything. `src/app/api/usage/metrics/export/route.js` carries the same guard;
// the two files share one law, and the law is written down in both places on
// purpose so neither can quietly drift from a copy nobody reads.

/**
 * One CSV cell: always quoted, internal quotes doubled, and a leading tab
 * padded inside the quotes when the value starts with = + - @ (formula
 * injection guard, identical to the usage export's `csvCell`).
 */
export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `\t${s}`; // pad INSIDE the quotes
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows → a CSV document. `columns` is `[header, pick(row)]` pairs, in order. */
export function toCsv(columns, rows = []) {
  const head = columns.map(([header]) => csvCell(header)).join(",");
  const body = rows.map((row) => columns.map(([, pick]) => csvCell(pick(row))).join(","));
  return [head, ...body].join("\n") + "\n";
}

/** The analytics census as a CSV: one line per pool bucket, integers only —
 *  the SAME fields the Usage page renders, so the file and the screen agree. */
export function analyticsCsv(pools = [], period = "24h") {
  return toCsv(
    [
      ["period", () => period],
      ["poolId", (p) => p.poolId],
      ["name", (p) => p.label?.name ?? ""],
      ["type", (p) => p.label?.type ?? ""],
      ["requests", (p) => p.requests ?? 0],
      ["errors", (p) => p.errors ?? 0],
      ["promptTokens", (p) => p.promptTokens ?? 0],
      ["completionTokens", (p) => p.completionTokens ?? 0],
      ["costUsd", (p) => p.costUsd ?? 0],
      ["avgLatencyMs", (p) => (p.avgLatencyMs === null || p.avgLatencyMs === undefined ? "" : p.avgLatencyMs)],
      ["p95LatencyMs", (p) => (p.p95LatencyMs === null || p.p95LatencyMs === undefined ? "" : p.p95LatencyMs)],
      ["latencySamples", (p) => p.latencyCount ?? 0],
    ],
    pools
  );
}

/** The export route's active-pool list as a CSV — id, name, type, active. The
 *  route emits no credential (the §5.4 allow-list), so neither can the file. */
export function activePoolsCsv(pools = []) {
  return toCsv(
    [
      ["id", (p) => p.id],
      ["name", (p) => p.name ?? ""],
      ["type", (p) => p.type ?? ""],
      ["isActive", (p) => (p.isActive ? "true" : "false")],
    ],
    pools
  );
}

/**
 * Hand a string to the browser as a download. The browser owns the save path;
 * the Keeper owns the bytes. A date stamp keeps two exports from overwriting.
 */
export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return false;
  }
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously has raced the click in
  // some engines and produced a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(href), 0);
  return true;
}

/** `proxy-analytics-24h-2026-11-05.csv` — the name says what and when. */
export function stamp(date = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`;
}
