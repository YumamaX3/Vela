// Sibling Harbor Ports — W1 catalog wiring guard.
//
// Why this test exists: `open-sse/providers/registry/index.js` is a hand-edited
// static-import list (no generator exists in scripts/ or package.json). A registry
// file can therefore sit on disk, look correct, and be invisible to the runtime —
// the exact silent failure the plan flags as High×Low risk. This test does not
// check that files exist; it checks that each ported provider is REACHABLE through
// the runtime PROVIDERS map built from the registry, with a usable baseUrl and a
// non-empty model list.
//
// The 19 ids are the §3.3 port set (18 by three-way set difference + `a6api` by
// the Star's Gate-18 overrule, with its affiliate referral params stripped).
import { describe, it, expect } from "vitest";
import { PROVIDERS, PROVIDER_MODELS } from "open-sse/providers/index.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// id → the alias PROVIDER_MODELS is keyed by (registry `alias` field).
const PORTED = {
  a6api: "a6api",
  baseten: "baseten",
  bytez: "bytez",
  codestral: "codestral",
  deepinfra: "deepinfra",
  friendliai: "friendli",
  galadriel: "galadriel",
  gigachat: "gigachat",
  heroku: "heroku",
  llamagate: "llamagate",
  nanogpt: "nanogpt",
  nscale: "nscale",
  ovhcloud: "ovh",
  predibase: "predibase",
  publicai: "publicai",
  upstage: "upstage",
  volcengine: "volcengine",
  wandb: "wandb",
  zenmux: "zenmux",
};

const IDS = Object.keys(PORTED);

describe("sibling provider wiring — every ported id resolves through PROVIDERS", () => {
  it("ports exactly 19 ids and they are all distinct", () => {
    expect(IDS).toHaveLength(19);
    expect(new Set(IDS).size).toBe(19);
  });

  it.each(IDS)("%s is a real entry in the runtime registry", (id) => {
    const entry = REGISTRY.find((r) => r.id === id);
    expect(entry, `registry entry for "${id}" missing — index.js wiring?`).toBeTruthy();
  });

  it.each(IDS)("%s resolves to a provider object via PROVIDERS", (id) => {
    const provider = PROVIDERS[id];
    expect(provider, `PROVIDERS["${id}"] is undefined — import/export line missing`).toBeTruthy();
    expect(typeof provider).toBe("object");
    // buildTransport always re-applies the shared format default.
    expect(provider.format).toBe("openai");
  });

  it.each(IDS)("%s has a non-empty transport.baseUrl", (id) => {
    const provider = PROVIDERS[id];
    expect(typeof provider.baseUrl).toBe("string");
    expect(provider.baseUrl.length).toBeGreaterThan(0);
    expect(provider.baseUrl).toMatch(/^https:\/\//);
  });

  it.each(IDS)("%s has a non-empty models array", (id) => {
    const models = PROVIDER_MODELS[PORTED[id]];
    expect(Array.isArray(models), `PROVIDER_MODELS["${PORTED[id]}"] is not an array`).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
    }
  });

  it("no ported id collides with an existing registry id", () => {
    // A duplicate id silently wins by last-write in PROVIDERS and hides one
    // provider, so the whole registry must stay id-unique. Note this is NOT a
    // claim that every file on disk is wired: `ai21.js` is a pre-existing
    // fork-only file Vela already held and the plan explicitly refuses to
    // re-create — its own wiring is out of W1's scope and unchanged here.
    const ids = REGISTRY.map((r) => r.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of IDS) {
      expect(REGISTRY.filter((r) => r.id === id)).toHaveLength(1);
    }
  });

  it("a6api carries no affiliate/referral query parameters anywhere", () => {
    const entry = REGISTRY.find((r) => r.id === "a6api");
    const urls = [
      entry.display?.website,
      entry.display?.notice?.apiKeyUrl,
      entry.transport?.baseUrl,
      entry.transport?.validateUrl,
      entry.embeddingConfig?.baseUrl,
      entry.imageConfig?.baseUrl,
      entry.modelsFetcher?.url,
    ].filter(Boolean);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(/\?/);
      expect(url).not.toMatch(/[?&](auth|aff|ref|referral|invite|utm_)/i);
    }
  });
});
