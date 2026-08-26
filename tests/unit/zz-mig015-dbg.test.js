import { describe, it, beforeAll } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("debug 015", () => {
  const scratch = path.join(tmpdir(), `vela-mig015dbg-${Date.now()}`);
  const out = path.join(tmpdir(), "mig015-dbg-out.txt");
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });

  it("dumps post-migration state to file", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const db = await getAdapter();
    await runMigrationOnce(db);
    const lines = [];
    const ver = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    lines.push(`schemaVersion: ${ver?.value}`);
    const rows = db.all(`SELECT name, keyVersion, keyHash IS NULL AS hn, isInternal, key FROM apiKeys`);
    for (const r of rows) lines.push(`| ${r.name} | ver=${r.keyVersion} hash=${r.hn} int=${r.isInternal} key=${String(r.key).slice(0,22)}`);
    lines.push(`reveal file: ${require("node:fs").existsSync(path.join(scratch, "pending-key-reveals.json"))}`);
    writeFileSync(out, lines.join("\n"));
  });
});
