// The Twin Harbors posture seam (Storage Covenant, plans/storage-covenant.md).
// Resolves VELA_DB_MODE once per process; Wave A ships only the sqlite harbor,
// so repo facades are pure re-exports. From Wave A6 the mysql/mirror harbors
// bind behind the SAME 73-function contract through this module.

const MODES = ["sqlite", "mysql", "mirror"];

export function getDbMode() {
  const raw = (process.env.VELA_DB_MODE || "sqlite").toLowerCase();
  if (!MODES.includes(raw)) {
    throw new Error(`[DB] unknown VELA_DB_MODE "${raw}" — expected sqlite|mysql|mirror`);
  }
  return raw;
}
