import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("instrumented 015 through real driver", () => {
  const scratch = path.join(tmpdir(), `vela-mig015inst-${Date.now()}`);
  const out = path.join(tmpdir(), "mig015-inst-out.txt");
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });
  afterAll(() => { delete process.env.VELA_DATA_DIR; delete process.env.API_KEY_SECRET; });

  it("runs migration through the real driver", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const db = await getAdapter();
    const lines = [];
    lines.push(`adapter driver: ${db.driver}`);
    lines.push(`adapter has run: ${typeof db.run}, all: ${typeof db.all}, exec: ${typeof db.exec}`);
    await runMigrationOnce(db);
    const ver = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    lines.push(`schemaVersion: ${ver?.value}`);
    const rows = db.all(`SELECT name, keyVersion, keyHash IS NULL AS hn, isInternal FROM apiKeys`);
    lines.push(`rows: ${rows.length}`);
    for (const r of rows) lines.push(`| ${r.name} | ver=${r.keyVersion} hash=${r.hn} int=${r.isInternal}`);
    lines.push(`reveal: ${existsSync(path.join(scratch, "pending-key-reveals.json"))}`);
    writeFileSync(out, lines.join("\n"));
  });
});
