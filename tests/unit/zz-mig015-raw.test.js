import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("015 raw adapter probe", () => {
  const scratch = path.join(tmpdir(), `vela-mig015raw-${Date.now()}`);
  const out = path.join(tmpdir(), "mig015-raw-out.txt");
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });
  afterAll(() => { delete process.env.VELA_DATA_DIR; delete process.env.API_KEY_SECRET; });

  it("probes db.all inside the runner transaction", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const lines = [];
    // Simulate the runner: BEGIN transaction, run migration steps, check all()
    db.exec("BEGIN");
    try {
      const before = db.all(`SELECT COUNT(*) AS c FROM apiKeys WHERE keyHash IS NULL AND keyVersion='legacy' AND key LIKE 'revoked-%' AND isInternal=0`);
      lines.push(`tombstones BEFORE (in txn): ${before[0].c}`);
      const rows = db.all(`SELECT id, name, category FROM apiKeys WHERE keyHash IS NULL AND keyVersion='legacy' AND key LIKE 'revoked-%' AND isInternal=0`);
      lines.push(`tombstone rows (in txn): ${rows.length}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      lines.push(`THREW: ${e.message}`);
    }
    writeFileSync(out, lines.join("\n"));
  });
});
