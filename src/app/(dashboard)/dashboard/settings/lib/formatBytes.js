// One spelling for the Data room's numbers.
//
// The room now carries four cards that all print sizes and counts. Four local
// copies would drift (the v0.9.93 lesson: three spellings of "success" meant an
// operator could not learn the colour) — so the byte and count formatters live
// HERE and every card reads them from this one place.
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fmtCount(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

export function fmtWhen(iso) {
  if (!iso) return "—";
  return String(iso).slice(0, 19).replace("T", " ");
}
