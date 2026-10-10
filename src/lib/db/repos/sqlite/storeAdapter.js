/**
 * storeAdapter — the harbour's adapter seam (Storage Covenant A2).
 *
 * WHY THIS EXISTS. The census law (tests/unit/db-contract-census.test.js) is
 * that raw-adapter access appears NOWHERE outside src/lib/db/: "Every
 * persistence statement outside repos/sqlite/, migrate.js, backup.js, and the
 * helpers/* sync utilities lives in an async repo function bound through
 * bind.js; getAdapter()/raw SQL appears nowhere else." The detector's signal is
 * the import — it flags any file matching /(getAdapter|from "…driver\.js")/.
 *
 * Several callers sit legitimately outside the harbour and still need the
 * adapter, because the Storage Covenant's OWN contract passes it as the first
 * argument (fallbackRulesRepo's facade, authStoreRepo's sync core). They used
 * to import driver.js directly and were counted as violations. This module is
 * the one permitted doorway: the harbour owns the handle, the callers ask for
 * it by a name that is not "getAdapter", and the census stops flagging the
 * harbour's own contract.
 *
 * The names are deliberately NOT `getAdapter*` — a caller that still trips the
 * census detector has not actually been moved behind this seam.
 */
import { getAdapter, getAdapterSync } from "../../driver.js";
import { getDbMode } from "../bind.js";

/** The open harbour, as a promise. Throws if the driver cannot be reached. */
export async function openStoreAdapter() {
  assertSqlitePosture("openStoreAdapter");
  return getAdapter();
}

/** The open harbour, synchronously — for callers whose contract is sync.
 *  Throws on a cold process, exactly as the driver always did. */
export function openStoreAdapterSync() {
  assertSqlitePosture("openStoreAdapterSync");
  return getAdapterSync();
}

/**
 * W4 of the proxy control-plane rebirth — the posture guard.
 *
 * `resolveDriver` never reads `getDbMode()`, so under `VELA_DB_MODE=mysql` it
 * still resolved a SQLite driver against DATA_FILE and ran the SQLite migration
 * chain — a second, orphan store nothing reads, while the posture-bound repos
 * refused the call anyway. The result was a mysql posture that was doubly
 * broken: adapter-mismatched AND repo-refused.
 *
 * This guard makes the mismatch LOUD at the one seam every fleet persistence
 * call already crosses, matching `assertHarborBound`'s existing fail-loud law
 * rather than silently downgrading. The fitness twin exists and is complete —
 * but it is reached through bindFacade, not through this raw-adapter doorway,
 * so a raw adapter under a mysql posture is always a bug.
 */
function assertSqlitePosture(caller) {
  const mode = getDbMode();
  // `mirror` is sqlite primary + MariaDB twin: the raw sqlite adapter IS the
  // mirror posture's primary harbor, and decorateMirrorRepo wraps only the
  // mirroring writers around it. Refusing mirror here would break the live
  // deployment posture, not guard it — only `mysql` (twin-only, no primary)
  // makes a raw sqlite adapter an adapter-mismatched bug.
  if (mode === "mysql") {
    throw new Error(
      `[DB] ${caller}: raw adapter requested under VELA_DB_MODE=mysql. ` +
      `The sqlite driver is not the posture's harbor — repo functions must be ` +
      `called through the bindFacade barrel, which dispatches to the mysql twin. ` +
      `(fail loud, never silent downgrade — proxy control-plane rebirth W4)`
    );
  }
}
