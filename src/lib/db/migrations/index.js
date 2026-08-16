// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-apikey-governance.js";
import m003 from "./003-key-categories.js";
import m004 from "./004-usage-dedupe.js";
import m005 from "./005-backup-ledger.js";
import m006 from "./006-outbox.js";
import m007 from "./007-mirror-seq.js";
import m008 from "./008-usage-telemetry.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
