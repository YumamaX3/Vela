import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, copyFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("migration 015 revival (scratch, secret present)", () => {
  const scratch = path.join(tmpdir(), `vela-mig015rev-${Date.now()}`);
  beforeAll(() => {
    process.env.VELA_DATA_DIR = scratch;
    process.env.API_KEY_SECRET = "mig015-test-secret";
    mkdirSync(path.join(scratch, "db"), { recursive: true });
    copyFileSync(path.join(process.env.APPDATA, "vela", "db", "data.sqlite"), path.join(scratch, "db", "data.sqlite"));
  });

  it("revives 9 tombstones into working keys + converts the fossil + writes the reveal file", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const db = await getAdapter();
    await runMigrationOnce(db);

    const rows = db.all(`SELECT name, isInternal, isActive, keyHash IS NULL AS hn, keyVersion FROM apiKeys ORDER BY createdAt`);
    expect(rows.some((r) => r.name.includes("[legacy]"))).toBe(false);
    const internal = rows.find((r) => r.name === "internal:model-test");
    expect(internal).toBeTruthy();
    expect(internal.isInternal).toBe(1);
    expect(internal.isActive).toBe(1);
    const publics = rows.filter((r) => !r.isInternal);
    expect(publics.length).toBe(9);
    for (const p of publics) {
      expect(p.hn).toBe(0);
      expect(p.keyVersion).toBe("v1");
      expect(p.isActive).toBe(1);
    }
    const names = publics.map((p) => p.name).sort();
    expect(names).toEqual(["Belfast", "CLine", "Claude Code", "Default Key", "Hermes", "Kafka", "Ruan Mei", "Shorekeeper", "Silver Wolf"].sort());

    const revealFile = path.join(scratch, "pending-key-reveals.json");
    expect(existsSync(revealFile)).toBe(true);
    const reveals = JSON.parse(readFileSync(revealFile, "utf8"));
    expect(reveals.length).toBe(9);
    for (const r of reveals) {
      expect(r.key).toMatch(/^vela-v1-[0-9a-f]{32}-[0-9a-f]{8}$/);
      expect(typeof r.name).toBe("string");
    }
  });
});
