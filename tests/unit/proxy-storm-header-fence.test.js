// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.3
// The egress header fence: the x-9r-* security family must never reach a provider.
//
// WHAT §5.3 IS FOR
// custom-server.js:120-121 stamps x-9r-real-ip AND x-9r-peer-token — the per-process
// secret that PROVES the real-ip stamp — onto inbound request headers. modelsList.js:99
// forwards connection headers outbound to a provider node. So any route that spreads
// inbound headers into an outbound provider call hands the peer-token to a third party
// (OpenAI, Anthropic, whoever the node points at). That is credential disclosure on a
// live path, not a theoretical concern.
//
// THE FENCE is a prefix deny-list at ONE chokepoint (the top of proxyAwareFetch),
// covering all five outbound spreads. It is NOT an allow-list: the ADR measured 65+
// provider-declared custom headers across 19 registries, and an allow-list would have
// to enumerate every one and be edited per new provider — a silent-breakage machine
// whose failures surface as upstream 400s far from the cause.
//
// THE ONE EXEMPTION (Star's decree, 2026-09-04)
// x-9r-internal-models-fetch carries the literal "1", not a secret, and is the
// cross-instance recursion guard (modelsList.js:99 sets it → api/v1/models/route.js:20
// reads it to skip the dynamic fetch). Stripping it breaks Vela-as-a-node-of-Vela, so
// the prefix rule exempts exactly this one name. Every other x-9r-* member — including
// any future one the stamping protocol grows — is stripped.
//
// Every fixture uses TEST-NET-3 (203.0.113.0/24) and example values only — never a
// live LAN or Tailscale value.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TARGET = "https://api.openai.com/v1/chat/completions";
const PEER_TOKEN = "per-process-secret-must-never-leave";

const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
function stripForGuard(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── ENV ISOLATION ────────────────────────────────────────────────────────────
// proxyAwareFetch's getEnvProxyUrl() reads process.env.HTTPS_PROXY / HTTP_PROXY /
// ALL_PROXY (and their lowercase twins). On a machine or shell that sets one — which
// is exactly what a proxy-fleet developer's shell does — every "direct path" test
// below would instead take the dispatcher branch: it would construct a real
// ProxyAgent, fail to connect, log a warn, and fall back to originalFetch. The fence
// assertions would STILL PASS, but for the wrong reason and only on some machines.
// Clearing them makes the branch under test deterministic and the suite honest about
// what it proves. Saved and restored so no other suite sees the change.
const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
];
const savedProxyEnv = {};
beforeAll(() => {
  for (const k of PROXY_ENV_KEYS) {
    if (k in process.env) savedProxyEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const k of PROXY_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, savedProxyEnv);
});

/**
 * Capture what proxyAwareFetch actually puts on the wire. globalThis.fetch is stubbed
 * BEFORE the import because proxyFetch captures `originalFetch = globalThis.fetch` at
 * module load — stubbing after would miss it.
 */
async function captureWire(run) {
  const seen = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const raw = init?.headers;
    // Record the RAW init alongside a Headers view. Building `new Headers(raw)`
    // unconditionally made the stub throw on a string headers value — a shape real
    // fetch also rejects, so the stub was fabricating a failure that belongs to the
    // caller, not to the fence. `headers` is null for any non-record shape; those
    // cases assert on `raw` instead.
    let headers = null;
    if (raw && typeof raw === "object" && typeof raw !== "string") {
      try { headers = new Headers(raw); } catch { headers = null; }
    }
    seen.push({ url: String(url), raw, headers });
    return new Response("UPSTREAM", { status: 200 });
  });
  try {
    const mod = await import("open-sse/utils/proxyFetch.js");
    return await run(mod.proxyAwareFetch, seen);
  } finally {
    vi.unstubAllGlobals();
  }
}

// The five security-family members custom-server.js can stamp today.
const X9R_SECRETS = {
  "x-9r-real-ip": "203.0.113.20",
  "x-9r-peer-token": PEER_TOKEN,
  "x-9r-via-proxy": "1",
  "x-9r-password": "hunter2-example",
  // A sixth member nobody enumerated — the prefix rule must catch it. An enumeration
  // of today's names would forward this to the provider.
  "x-9r-future-stamp": "must-not-be-forwarded",
};
const EXEMPT = { "x-9r-internal-models-fetch": "1" };
// Provider-declared headers the ADR measured — these MUST survive the fence.
const PROVIDER_HEADERS = {
  Authorization: "Bearer sk-provider-key-must-survive",
  "anthropic-version": "2023-06-01",
  "Anthropic-Beta": "a-very-long-beta-flag-string",
  "X-Stainless-Lang": "js",
  "connect-protocol-version": "1",
  "X-Grpc-Web": "1",
  "content-type": "application/json",
};

describe("S1 — the fence strips the whole x-9r-* security family", () => {
  it("removes every stamped secret from a direct provider call", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, {
        method: "POST",
        headers: { ...PROVIDER_HEADERS, ...X9R_SECRETS },
      });
      const sent = seen[0].headers;
      for (const name of Object.keys(X9R_SECRETS)) {
        expect(sent.get(name), `${name} must be stripped`).toBeNull();
      }
      // The peer-token — the actual secret — is the one that matters most.
      expect(JSON.stringify([...seen[0].headers.entries()])).not.toContain(PEER_TOKEN);
    });
  });

  it("strips the unenumerated sixth member — the prefix rule cannot be outgrown", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, { headers: { "x-9r-future-stamp": "secret" } });
      expect(seen[0].headers.get("x-9r-future-stamp")).toBeNull();
    });
  });

  it("is case-insensitive on the prefix — a mixed-case stamp still falls", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, {
        headers: { "X-9R-PEER-TOKEN": PEER_TOKEN, "X-9r-Real-IP": "203.0.113.20" },
      });
      expect(seen[0].headers.get("x-9r-peer-token")).toBeNull();
      expect(seen[0].headers.get("x-9r-real-ip")).toBeNull();
    });
  });

  it("preserves every provider-declared header — the fence is a deny-list, not an allow-list", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, { headers: { ...PROVIDER_HEADERS, ...X9R_SECRETS } });
      const sent = seen[0].headers;
      // Each provider header survives untouched — a deny-list must never block these.
      expect(sent.get("authorization")).toBe("Bearer sk-provider-key-must-survive");
      expect(sent.get("anthropic-version")).toBe("2023-06-01");
      expect(sent.get("anthropic-beta")).toBe("a-very-long-beta-flag-string");
      expect(sent.get("x-stainless-lang")).toBe("js");
      expect(sent.get("connect-protocol-version")).toBe("1");
      expect(sent.get("x-grpc-web")).toBe("1");
      expect(sent.get("content-type")).toBe("application/json");
    });
  });

  it("does not strip a header that merely CONTAINS x-9r — only the prefix", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, {
        headers: { "my-x-9r-looking-header": "keep-me", "x-custom": "keep-me-too" },
      });
      // Prefix match only: "my-x-9r-..." does not START with x-9r-, so it survives.
      expect(seen[0].headers.get("my-x-9r-looking-header")).toBe("keep-me");
      expect(seen[0].headers.get("x-custom")).toBe("keep-me-too");
    });
  });
});

describe("S2 — the recursion-guard exemption", () => {
  it("x-9r-internal-models-fetch SURVIVES the fence (value '1', not a secret)", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, { headers: { ...EXEMPT, ...X9R_SECRETS } });
      // The exempt marker survives — it is the cross-instance recursion guard.
      expect(seen[0].headers.get("x-9r-internal-models-fetch")).toBe("1");
      // …while every genuine secret in the SAME request is stripped.
      expect(seen[0].headers.get("x-9r-peer-token")).toBeNull();
      expect(seen[0].headers.get("x-9r-real-ip")).toBeNull();
    });
  });

  it("the exemption is EXACTLY one name — no other x-9r-* is whitelisted", { timeout: 20000 }, async () => {
    const src = readSrc("open-sse/utils/proxyFetch.js");
    const set = src.match(/const X9R_EXEMPT = new Set\(\[([^\]]*)\]\)/);
    expect(set, "X9R_EXEMPT must exist").toBeTruthy();
    const members = set[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    expect(members).toEqual(["x-9r-internal-models-fetch"]);
  });
});

describe("S3 — the fence is a single chokepoint covering every outbound spread", () => {
  it("strips on the RELAY path too, not only the direct path", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(
        TARGET,
        { headers: { ...PROVIDER_HEADERS, ...X9R_SECRETS } },
        { vercelRelayUrl: "https://relay.example.workers.dev", relayAuth: "vrelay_x", relayVersion: 2 }
      );
      // The request went to the relay…
      expect(seen[0].url).toBe("https://relay.example.workers.dev");
      // …and the peer-token did NOT ride along to be forwarded onward.
      expect(seen[0].headers.get("x-9r-peer-token")).toBeNull();
      expect(seen[0].headers.get("x-9r-real-ip")).toBeNull();
      // Provider headers and the relay auth still present.
      expect(seen[0].headers.get("authorization")).toBe("Bearer sk-provider-key-must-survive");
      expect(seen[0].headers.get("x-relay-auth")).toBe("vrelay_x");
    });
  });

  it("never mutates the CALLER's header object", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch) => {
      // A caller that reuses one options object across two fetches must not find its
      // headers silently gone on the second call — the fence rebinds to a copy.
      const callerHeaders = { ...X9R_SECRETS, Authorization: "Bearer keep" };
      await proxyAwareFetch(TARGET, { headers: callerHeaders });
      expect(callerHeaders["x-9r-peer-token"]).toBe(PEER_TOKEN); // caller object intact
      expect(callerHeaders["x-9r-real-ip"]).toBe("203.0.113.20");
      expect(callerHeaders.Authorization).toBe("Bearer keep");
    });
  });

  it("the only header-read outside the chokepoint is dead code", { timeout: 20000 }, async () => {
    // gotScrapingFetch reads options.headers DIRECTLY (line 40 of the disabled block),
    // which would bypass the fence entirely. It is reachable only via
    // tryGotScrapingFetch, and that name appears in live source NOWHERE — once in the
    // block comment wrapping the whole JA3 path, once in the "Re-enable per-host by
    // wrapping with…" line comment. This pins that it stays dead.
    //
    // stripForGuard runs FIRST: a negative source guard defeated by the comment that
    // explains it is the exact false-green class this house already sealed once. Only
    // EXECUTABLE code is searched. If someone re-wires the JA3 path, this goes red and
    // the fence must move into gotScrapingFetch or be duplicated there.
    const src = readSrc("open-sse/utils/proxyFetch.js");
    const executable = stripForGuard(src);
    expect(executable).not.toContain("tryGotScrapingFetch");
    expect(executable).not.toContain("gotScrapingFetch");
    // …and the guard itself is real, not a no-op: the names DO exist in raw source.
    expect(src).toContain("tryGotScrapingFetch");
    expect(src).toContain("gotScrapingFetch");
  });

  it("proxyAwareFetch fences BEFORE reading proxyOptions — order is the chokepoint", { timeout: 20000 }, async () => {
    const src = readSrc("open-sse/utils/proxyFetch.js");
    const fnStart = src.indexOf("export async function proxyAwareFetch");
    expect(fnStart).toBeGreaterThan(-1);
    // Slice generously: the explanatory comment above the fence is ~700 chars, and a
    // slice that ends before the relay line would make `relayAt` -1 and the ordering
    // assertion pass for the wrong reason.
    const fn = src.slice(fnStart, fnStart + 3000);
    const fenceAt = fn.indexOf("fenceEgressHeaders");
    const relayAt = fn.indexOf("vercelRelayUrl = normalizeString");
    expect(fenceAt, "the fence call must appear in proxyAwareFetch").toBeGreaterThan(-1);
    expect(relayAt, "the relay branch must appear within the slice").toBeGreaterThan(-1);
    // The fence must precede the first branch that spreads options.headers.
    expect(fenceAt).toBeLessThan(relayAt);
  });
});

describe("S4 — robustness on the hot path", () => {
  it("survives absent / null headers without throwing", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      // AWAITED, deliberately. `expect(() => fn()).not.toThrow()` on an async function
      // is a VACUOUS assertion: it catches only a synchronous throw, while the real
      // failure mode arrives as a rejected promise nobody observes. Each shape is
      // awaited so a rejection actually fails the test.
      for (const opts of [{}, { headers: null }, { headers: undefined }]) {
        const res = await proxyAwareFetch(TARGET, opts);
        expect(res.status).toBe(200);
      }
      expect(seen.length).toBe(3);
    });
  });

  it("a STRING headers value passes through untouched — and that is the caller's failure, not the fence's", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      // fenceEgressHeaders guards `typeof headers === "object"`, so a string is left
      // exactly as the caller wrote it. The fence neither throws nor silently
      // reinterprets — it is not the fence's job to repair an invalid caller argument
      // (undici/Headers rejects a string headers value on its own). What matters for
      // §5.3 is that the fence does not ADD a new failure mode on this shape.
      const res = await proxyAwareFetch(TARGET, { headers: "not-an-object" });
      expect(res.status).toBe(200);
      expect(seen[0].raw).toBe("not-an-object");
    });
  });

  it("an ARRAY of header pairs is filtered, not corrupted, and still strips x-9r-*", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      // undici/fetch accept [["name","value"], …]. An earlier fence revision spread
      // this with `{...headers}`, which yields `{0:["authorization","Bearer x"]}` —
      // VALID headers corrupted into nonsense while the fence believed it had walked
      // them. The pair form is now filtered by index 0.
      const res = await proxyAwareFetch(TARGET, {
        headers: [
          ["authorization", "Bearer keep-me"],
          ["x-9r-peer-token", PEER_TOKEN],
          ["content-type", "application/json"],
        ],
      });
      expect(res.status).toBe(200);
      // Still an array — the shape survived the fence.
      expect(Array.isArray(seen[0].raw)).toBe(true);
      const names = seen[0].raw.map((p) => p[0].toLowerCase());
      expect(names).toContain("authorization");
      expect(names).toContain("content-type");
      // …and the secret pair is gone.
      expect(names).not.toContain("x-9r-peer-token");
      expect(JSON.stringify(seen[0].raw)).not.toContain(PEER_TOKEN);
    });
  });

  it("a HEADERS instance is fenced without losing every other header", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      // The catastrophic case. `{...new Headers(...)}` enumerates NOTHING — Headers is
      // not a plain object — so the spread produced `{}` and the fence deleted
      // Authorization, content-type, everything. A security fix that breaks every
      // request is not a fix. Walked via keys() + delete() instead.
      const h = new Headers({
        authorization: "Bearer keep-me",
        "content-type": "application/json",
        "x-9r-peer-token": PEER_TOKEN,
        "x-9r-real-ip": "203.0.113.20",
        "x-9r-internal-models-fetch": "1",
      });
      const res = await proxyAwareFetch(TARGET, { headers: h });
      expect(res.status).toBe(200);
      const sent = seen[0].headers;
      expect(sent).toBeTruthy();
      // Provider headers SURVIVE — this is the assertion the spread revision failed.
      expect(sent.get("authorization")).toBe("Bearer keep-me");
      expect(sent.get("content-type")).toBe("application/json");
      // Secrets stripped, exemption kept.
      expect(sent.get("x-9r-peer-token")).toBeNull();
      expect(sent.get("x-9r-real-ip")).toBeNull();
      expect(sent.get("x-9r-internal-models-fetch")).toBe("1");
    });
  });

  it("the CALLER's Headers instance is never mutated — the fence clones it", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch) => {
      // The plain-object path rebinds to a copy; the Headers path must too. A caller
      // that reuses one Headers across two fetches would otherwise lose its stamp on
      // the second call — and would have no idea why.
      const h = new Headers({ authorization: "Bearer keep", "x-9r-peer-token": PEER_TOKEN });
      await proxyAwareFetch(TARGET, { headers: h });
      expect(h.get("x-9r-peer-token")).toBe(PEER_TOKEN); // caller instance intact
      expect(h.get("authorization")).toBe("Bearer keep");
    });
  });

  it("a request with no x-9r-* at all is forwarded byte-for-byte", { timeout: 20000 }, async () => {
    await captureWire(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(TARGET, { headers: { ...PROVIDER_HEADERS } });
      const sent = seen[0].headers;
      expect(sent.get("authorization")).toBe("Bearer sk-provider-key-must-survive");
      expect(sent.get("anthropic-beta")).toBe("a-very-long-beta-flag-string");
      // Nothing was added or removed beyond what the caller sent.
      expect([...sent.keys()].sort()).toEqual(Object.keys(PROVIDER_HEADERS).map((k) => k.toLowerCase()).sort());
    });
  });

  it("the fence helper is not exported — it is internal to proxyFetch", { timeout: 20000 }, async () => {
    // Exporting it would invite callers to fence by hand at some sites and not others,
    // which is the drift the single-chokepoint design exists to prevent.
    const mod = await import("open-sse/utils/proxyFetch.js");
    expect(mod.fenceEgressHeaders).toBeUndefined();
    expect(typeof mod.proxyAwareFetch).toBe("function");
  });
});
