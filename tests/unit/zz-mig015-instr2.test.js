import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("015 instrumented inside real runner", () => {
  const scratch = path.join(tmpdir(), `vela-mig015in2-${Date.now()}`);
  const out = path.join(tmpdir(), "mig015-in2-out.txt");
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });
  afterAll(() => { delete process.env.VELA_DATA_DIR; delete process.env.API_KEY_SECRET; });

  it("logs inside the migration", async () => {
    // Import the migration file fresh, wrap its up() with logging
    const mod = await import("@/lib/db/migrations/015-legacy-key-cleanup.js");
    const orig = mod.default.up;
    const lines = [];
    mod.default.up = (db) => {
      const before = db.all(`SELECT COUNT(*) AS c FROM apiKeys WHERE keyHash IS NULL AND keyVersion='legacy' AND key LIKE 'revoked-%' AND isInternal=0`);
      lines.push(`[inside up] tombstones: ${before[0].c}`);
      lines.push(`[inside up] typeof db.run: ${typeof db.run}`);
      try {
        orig(db);
        lines.push(`[inside up] completed`);
      } catch (e) {
        lines.push(`[inside up] THREW: ${e.message}`);
      }
      const after = db.all(`SELECT COUNT(*) AS c FROM apiKeys`);
      lines.push(`[inside up] rows after: ${after[0].c}`);
      writeFileSync(out, lines.join("\n"));
    };
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const db = await getAdapter();
    await runMigrationOnce(db);
    // ensure file flushed even if runMigrationOnce swallowed
    writeFileSync(out, lines.join("\n"));
  });
});
