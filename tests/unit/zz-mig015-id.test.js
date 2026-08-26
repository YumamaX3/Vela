import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("015 identity", () => {
  const scratch = path.join(tmpdir(), `vela-mig015id-${Date.now()}`);
  const out = path.join(tmpdir(), "mig015-id-out.txt");
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });
  afterAll(() => { delete process.env.VELA_DATA_DIR; delete process.env.API_KEY_SECRET; });

  it("checks the registry entry + runs up directly", async () => {
    const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
    const m = MIGRATIONS.find((x) => x.version === 15);
    const lines = [];
    lines.push(`m15 found: ${!!m}, name: ${m?.name}`);
    lines.push(`m15.up type: ${typeof m?.up}`);
    lines.push(`m15 is same obj as default? ${m === (await import("@/lib/db/migrations/015-legacy-key-cleanup.js")).default}`);
    // Run up() DIRECTLY on a fresh adapter
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    try {
      m.up(db);
      lines.push("direct up() completed");
    } catch (e) {
      lines.push(`direct up() THREW: ${e.message}`);
    }
    const rows = db.all(`SELECT COUNT(*) AS c FROM apiKeys`);
    lines.push(`rows after direct up(): ${rows[0].c}`);
    const tombstones = db.all(`SELECT COUNT(*) AS c FROM apiKeys WHERE keyVersion='legacy'`);
    lines.push(`legacy remaining: ${tombstones[0].c}`);
    writeFileSync(out, lines.join("\n"));
  });
});
