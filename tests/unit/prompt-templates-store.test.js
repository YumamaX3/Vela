// Prompt templates — the small JSON store + its API door. A template is prompt
// TEXT only (never executed); these tests pin CRUD, the honest 400s, atomic
// writes, and fail-open reads, against a temp DATA_DIR (the saved-views
// harness: relocate DATA_DIR before the store module loads, reset modules).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-tpl-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

const store = () => import("@/shared/utils/promptTemplates.js");
const route = () => import("@/app/api/prompt-templates/route.js");
const req = (method, qs = "", body) => {
  const init = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost/api/prompt-templates${qs ? `?${qs}` : ""}`, init);
};

describe("promptTemplates store", () => {
  it("an absent file reads as an empty list, not an error", async () => {
    expect((await store()).listTemplates()).toEqual([]);
  });

  it("create → get → list", async () => {
    const s = await store();
    const r = s.createTemplate({ name: "  Reviewer ", prompt: "Be terse." });
    expect(r.ok).toBe(true);
    expect(r.template.name).toBe("Reviewer");
    expect(r.template.id).toEqual(expect.any(String));
    expect(s.getTemplate(r.template.id).prompt).toBe("Be terse.");
    expect(s.listTemplates()).toHaveLength(1);
  });

  it("create is durable across module reloads (the file is the truth)", async () => {
    const created = (await store()).createTemplate({ name: "A", prompt: "alpha" });
    vi.resetModules();
    expect((await store()).getTemplate(created.template.id)?.name).toBe("A");
    const raw = JSON.parse(fs.readFileSync(path.join(tempDir, "prompt-templates.json"), "utf8"));
    expect(raw).toHaveLength(1);
  });

  it("update rewrites fields and bumps updatedAt, keeps id", async () => {
    const s = await store();
    const { template } = s.createTemplate({ name: "A", prompt: "alpha" });
    await new Promise((r) => setTimeout(r, 5));
    const u = s.updateTemplate(template.id, { name: "B" });
    expect(u.ok).toBe(true);
    expect(u.template).toMatchObject({ id: template.id, name: "B", prompt: "alpha", createdAt: template.createdAt });
    expect(u.template.updatedAt >= template.updatedAt).toBe(true);
  });

  it("update of an unknown id is notFound, and writes nothing", async () => {
    const s = await store();
    const before = fs.existsSync(path.join(tempDir, "prompt-templates.json"));
    const u = s.updateTemplate("nope", { name: "X" });
    expect(u.notFound).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "prompt-templates.json"))).toBe(before);
  });

  it("delete removes exactly one; unknown id is honest", async () => {
    const s = await store();
    const a = s.createTemplate({ name: "A", prompt: "a" }).template;
    s.createTemplate({ name: "B", prompt: "b" });
    expect(s.deleteTemplate(a.id).ok).toBe(true);
    expect(s.listTemplates().map((t) => t.name)).toEqual(["B"]);
    expect(s.deleteTemplate(a.id)).toMatchObject({ ok: false, notFound: true });
  });

  it("validation: empty name / empty prompt / overlong name are refused", async () => {
    const s = await store();
    expect(s.createTemplate({ name: "", prompt: "x" })).toMatchObject({ ok: false });
    expect(s.createTemplate({ name: "n", prompt: "   " })).toMatchObject({ ok: false });
    expect(s.createTemplate({ name: "n".repeat(s.MAX_NAME + 1), prompt: "x" })).toMatchObject({ ok: false });
    expect(s.listTemplates()).toEqual([]);
  });

  it("a corrupt file fails open to [] and the next write heals it", async () => {
    fs.writeFileSync(path.join(tempDir, "prompt-templates.json"), "{not json");
    const s = await store();
    expect(s.listTemplates()).toEqual([]);
    const r = s.createTemplate({ name: "Heal", prompt: "ok" });
    expect(r.ok).toBe(true);
    expect(s.listTemplates()).toHaveLength(1);
  });
});

describe("prompt-templates route", () => {
  it("POST → 201, GET → list, PATCH → 200, DELETE → ok", async () => {
    const api = await route();
    const created = await api.POST(req("POST", "", { name: "T", prompt: "p" }));
    expect(created.status).toBe(201);
    const t = await created.json();

    const list = await (await api.GET(req("GET"))).json();
    expect(list.templates.map((x) => x.id)).toEqual([t.id]);

    const one = await (await api.GET(req("GET", `id=${t.id}`))).json();
    expect(one.name).toBe("T");

    const patched = await api.PATCH(req("PATCH", `id=${t.id}`, { name: "T2" }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("T2");

    expect((await api.DELETE(req("DELETE", `id=${t.id}`))).status).toBe(200);
    expect((await api.GET(req("GET", `id=${t.id}`))).status).toBe(404);
  });

  it("honest 400/404 edges", async () => {
    const api = await route();
    expect((await api.POST(req("POST", "", "not json"))).status).toBe(400);
    expect((await api.POST(req("POST", "", { name: "", prompt: "" }))).status).toBe(400);
    expect((await api.PATCH(req("PATCH", "", { name: "x" }))).status).toBe(400);
    expect((await api.PATCH(req("PATCH", "id=missing", { name: "x" }))).status).toBe(404);
    expect((await api.DELETE(req("DELETE"))).status).toBe(400);
    expect((await api.DELETE(req("DELETE", "id=missing"))).status).toBe(404);
    expect((await api.GET(req("GET", "id=missing"))).status).toBe(404);
  });
});
