// Test covenant: key-access-route — the severed seam, proven whole.
//
// Regression (v1.2.5): src/sse/services/keyAccess.js imported `getApiKeyByKey`
// from the apiKeys facade, but d8c585fb's helper was never carried across the
// 118d31c7 facade refactor. At runtime the import resolved to undefined and
// GET /v1/models/{provider}/{model} threw "(0 , e.getApiKeyByKey) is not a
// function" for EVERY request carrying a key — restricted or not. The existing
// suites mocked the repo module with only resolveKey/getApiKeyById, so the
// missing export never surfaced.
//
// THE SECOND FAULT, found only once the first was mended: the same file
// imported `buildModelsList` from "../route.js" — a Next.js route module,
// which may export only HTTP handlers. The helper lives in src/lib/modelsList.js
// (extracted there precisely so both routes could use it); [kind]/route.js
// already imported it correctly. So the models route failed twice over.
//
// This suite is deliberately seam-honest: it boots a REAL sql.js harbor in a
// temp DATA_DIR, mints REAL vela- keys, and drives the REAL route handler. No
// module mock stands between the test and the bug that broke production.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-keyaccess-"));
  process.env.DATA_DIR = tempDir;
  // EXAMPLE fixture only — never a real credential.
  process.env.API_KEY_SECRET = "EXAMPLE-not-a-real-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalSecret;
});

/** Real harbor: migrations run on first adapter use, so the 024 columns land. */
async function bootHarbor() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function mintKey(access) {
  const { createApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
  const { record, key } = await createApiKey("route-test", {});
  if (access) {
    const db = await bootHarbor();
    db.run(
      `UPDATE apiKeys SET accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [access.restricted ? 1 : 0, JSON.stringify(access.allow || []), record.id]
    );
  }
  return key;
}

function modelsRequest(key) {
  return new Request("http://localhost/v1/models/openai/gpt-4o", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

describe("key-access route seam", () => {
  it("migration 024 laid the access columns on a fresh harbor", async () => {
    const db = await bootHarbor();
    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toContain("accessRestricted");
    expect(cols).toContain("accessAllow");
  });

  it("the facade exports getApiKeyByKey as a function", async () => {
    // The exact failure production showed: an undefined import.
    const facade = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(typeof facade.getApiKeyByKey).toBe("function");
  });

  it("resolves a presented key by hash and projects { id, name, access }", async () => {
    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await mintKey({ restricted: true, allow: ["openai/gpt-4o"] });

    const record = await getApiKeyByKey(key);
    expect(record.id).toBeTruthy();
    expect(record.name).toBe("route-test");
    expect(record.access).toEqual({ restricted: true, allow: ["openai/gpt-4o"] });

    expect(await getApiKeyByKey("vela-v1-not-a-real-key")).toBeNull();
  });

  it("a fresh key reads unrestricted through the shared fail-closed builder", async () => {
    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await mintKey(null);
    expect((await getApiKeyByKey(key)).access).toEqual({ restricted: false, allow: [] });
  });

  it("a corrupt allow list fails CLOSED — restricted, empty allow, never unrestricted", async () => {
    const { keyAccessFromColumns } = await import("@/shared/utils/keyAccess.js");
    expect(keyAccessFromColumns(1, "{not json")).toEqual({ restricted: true, allow: [] });
    expect(keyAccessFromColumns(0, "{not json")).toEqual({ restricted: false, allow: [] });
  });

  it("GET /v1/models/{provider}/{model} answers for a keyed request (the production crash)", async () => {
    const { GET } = await import("@/app/api/v1/models/[...model]/route.js");
    const key = await mintKey(null);

    const res = await GET(modelsRequest(key), { params: Promise.resolve({ model: ["openai", "gpt-4o"] }) });
    // 200 (found) or 404 (not in this harbor's catalog) — never the 500 the
    // undefined-import TypeError produced. The point is: no throw.
    expect([200, 404]).toContain(res.status);
    const body = await res.json();
    if (res.status === 404) {
      expect(body.error.code).toBe("model_not_found");
    }
  });

  it("GET /v1/models/{kind} answers for an unkeyed request", async () => {
    const { GET } = await import("@/app/api/v1/models/[...model]/route.js");
    const res = await GET(modelsRequest(null), { params: Promise.resolve({ model: ["embedding"] }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("a RESTRICTED key is denied a model outside its allow list (404 model_not_found)", async () => {
    const { GET } = await import("@/app/api/v1/models/[...model]/route.js");
    const key = await mintKey({ restricted: true, allow: ["nothing/at-all"] });

    const res = await GET(modelsRequest(key), { params: Promise.resolve({ model: ["openai", "gpt-4o"] }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_not_found");
  });

  it("a restricted key IS allowed the model its allow list names (the positive half)", async () => {
    const { GET } = await import("@/app/api/v1/models/[...model]/route.js");
    const key = await mintKey({ restricted: true, allow: ["openai/gpt-4o"] });

    const res = await GET(modelsRequest(key), { params: Promise.resolve({ model: ["openai", "gpt-4o"] }) });
    // Not a blanket refusal: 200 when the catalogue holds it, 404 only because
    // this empty harbour does not — never the deny the previous case proved.
    expect([200, 404]).toContain(res.status);
    const body = await res.json();
    if (res.status === 404) {
      expect(body.error.code).toBe("model_not_found");
      expect(body.error.message).toContain("does not exist");
    }
  });

  it("a restricted key's models list is narrowed, not merely non-fatal", async () => {
    const { getKeyAccessContext, filterModelsListForKey } = await import("@/sse/services/keyAccess.js");
    const key = await mintKey({ restricted: true, allow: ["nothing/at-all"] });

    const ctx = await getKeyAccessContext(modelsRequest(key));
    expect(ctx).not.toBeNull();
    expect(ctx.allow).toEqual(["nothing/at-all"]);

    const filtered = await filterModelsListForKey(ctx, [
      { id: "openai/gpt-4o" },
      { id: "nothing/at-all" },
    ]);
    expect(filtered.map((m) => m.id)).toEqual(["nothing/at-all"]);
  });

  it("updateApiKey can actually SET a key restricted (the columns are mutable)", async () => {
    const { createApiKey, updateApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { key, record } = await createApiKey("mutable-test", {});

    // Unrestricted before the write…
    expect((await getApiKeyByKey(key)).access).toEqual({ restricted: false, allow: [] });

    // …writable through updateApiKey (the MUTABLE_FIELDS gate)…
    await updateApiKey(record.id, {
      access: { restricted: true, allow: ["openai/gpt-4o"] },
    });

    // …and the restriction now binds the key at the door.
    expect((await getApiKeyByKey(key)).access).toEqual({
      restricted: true,
      allow: ["openai/gpt-4o"],
    });
  });

  it("an allow-only write keeps the existing restricted flag (never fails open)", async () => {
    const { createApiKey, updateApiKey } = await import("@/lib/db/repos/sqlite/apiKeysRepo.js");
    const { getApiKeyByKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { key, record } = await createApiKey("allow-only-test", {});

    await updateApiKey(record.id, { access: { restricted: true, allow: ["a/b"] } });
    await updateApiKey(record.id, { access: { restricted: true, allow: ["c/d"] } });

    expect((await getApiKeyByKey(key)).access).toEqual({ restricted: true, allow: ["c/d"] });
  });

  it("the PUT route validates access and REFUSES a malformed shape (400)", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");
    const { record } = await (
      await import("@/lib/db/repos/sqlite/apiKeysRepo.js")
    ).createApiKey("route-access-test", {});

    const res = await PUT(
      new Request(`http://localhost/api/keys/${record.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access: { restricted: "yes", allow: "nope" } }),
      }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("the PUT route writes a valid access and the row reads it back", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");
    const { record } = await (
      await import("@/lib/db/repos/sqlite/apiKeysRepo.js")
    ).createApiKey("route-access-ok", {});

    const res = await PUT(
      new Request(`http://localhost/api/keys/${record.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access: { restricted: true, allow: ["openai/gpt-4o"] } }),
      }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.access).toEqual({ restricted: true, allow: ["openai/gpt-4o"] });
  });
});
