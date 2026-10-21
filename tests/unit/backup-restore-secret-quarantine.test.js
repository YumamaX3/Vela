// REGRESSION (DLV-1, CRITICAL) — a restore must never write the redaction
// sentinel over a live secret.
//
// SECRET_SETTING_KEYS redacts mitmSudoEncrypted to "[REDACTED]" on EVERY export,
// so no artifact can ever carry the real value. RESTORE_QUARANTINED_SETTING_KEYS
// is the list importDb captures from the LIVE row before DELETING settings and
// stitching them back. mitmSudoEncrypted was missing from that list, so a default
// restore (adoptSecrets=false — the documented safe path) captured nothing,
// deleted the row, and wrote the literal sentinel back over the operator's MITM
// sudo credential. Irreversible: adoptSecrets=true cannot recover a value that
// never left the database, and decryptPassword("[REDACTED]") fails into a
// swallow-all catch. mirrorSweep.js already documented and patched this hole;
// the restore path never received the fix.
//
// The invariant, stated once: EVERY key that SECRET_SETTING_KEYS redacts must be
// quarantined for restore. That relationship is the contract — asserting the two
// lists agree catches the next key added to either side without the other.

import { describe, it, expect } from "vitest";
import {
  SECRET_SETTING_KEYS,
  RESTORE_QUARANTINED_SETTING_KEYS,
} from "@/lib/db/repos/backupSecurity";

describe("DLV-1 · redacted secrets are quarantined for restore", () => {
  it("every SECRET_SETTING_KEY is captured before a restore wipes settings", () => {
    // This is the load-bearing invariant: a redacted secret that is not
    // quarantined gets its sentinel written over the live value.
    for (const key of SECRET_SETTING_KEYS) {
      expect(RESTORE_QUARANTINED_SETTING_KEYS).toContain(key);
    }
  });

  it("mitmSudoEncrypted is explicitly quarantined (named, not incidental)", () => {
    expect(RESTORE_QUARANTINED_SETTING_KEYS).toContain("mitmSudoEncrypted");
  });

  it("the quarantine list has no duplicate entries", () => {
    const seen = new Set();
    for (const key of RESTORE_QUARANTINED_SETTING_KEYS) {
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});