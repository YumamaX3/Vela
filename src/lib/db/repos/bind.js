// The Twin Harbors posture seam (Storage Covenant, plans/storage-covenant.md).
// Resolves VELA_DB_MODE once per process; Wave A ships only the sqlite harbor,
// so repo facades are pure re-exports. From Wave A7 the mysql/mirror harbors
// bind behind the SAME 74-function contract through this module.

const MODES = ["sqlite", "mysql", "mirror"];

export function getDbMode() {
  const raw = (process.env.VELA_DB_MODE || "sqlite").toLowerCase();
  if (!MODES.includes(raw)) {
    throw new Error(`[DB] unknown VELA_DB_MODE "${raw}" — expected sqlite|mysql|mirror`);
  }
  return raw;
}

// ─── Wave A6 — the fail-loud boot gate ───────────────────────────────────
// Plan: plans/storage-covenant.md boot matrix (line 364):
//   mysql | mysql2 pool | unreachable → "fail-loud boot refusal — never
//   silent downgrade". The mysql/mirror repos land in Waves A7–A9, so A6
// refuses the mysql posture at the seam itself (loud, named) and validates
// reachability so the boot-refusal test can prove both halves.

/** Validate + probe the mysql URL before anything binds to it. Throws loud:
 *  missing URL, malformed URL, or unreachable server. */
export async function assertMysqlReachable() {
  const url = process.env.VELA_MYSQL_URL;
  if (!url || !url.trim()) {
    throw new Error(`[DB] VELA_DB_MODE="${getDbMode()}" requires VELA_MYSQL_URL (mysql://user:pass@host:3306/vela) — refusing to boot without it`);
  }
  const { probeMysqlUrl } = await import("../mysql/pool.js");
  await probeMysqlUrl(url.trim()); // throws loud on any connection failure
}

/** The A6 refusal — every non-sqlite posture fails LOUD at the seam, never
 *  silently downgrades. Waves A7–A9 replace this body per posture as the
 *  mysql repos land (A7 config, A8 security, A9 usage). */
export async function assertHarborBound() {
  const mode = getDbMode();
  if (mode === "sqlite") return; // today's harbor — binds verbatim
  if (mode === "mysql") {
    // Reachability is validated even in A6 so the boot matrix can prove the
    // LOUD half (unreachable) and the reachable half separately.
    await assertMysqlReachable();
    throw new Error(
      `[DB] VELA_DB_MODE=mysql is reachable but the mysql harbor repos land in Storage Covenant Waves A7–A9 — boot refusal (fail loud, never silent downgrade)`
    );
  }
  // mirror: Wave C — primary sqlite + pump. Not yet forged.
  throw new Error(
    `[DB] VELA_DB_MODE=mirror binds in Storage Covenant Wave C — boot refusal (fail loud, never silent downgrade)`
  );
}
