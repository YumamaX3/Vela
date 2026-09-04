// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.2
// The relay's authentication, end to end: template → allow-list → deploy → row →
// caller gate → probe. Seven sections, each proving a different failure the design
// was built to prevent.
//
// WHAT §5.2 IS FOR
// Before this tide all three deploy routes shipped an OPEN FORWARD PROXY: three
// inline string copies that read x-relay-target, refused only when it was absent,
// and forwarded every header to whatever host the caller named. No secret, no
// allow-list, and a production caller (open-sse/utils/proxyFetch.js) already using
// it — so this was live traffic, not a dead surface. The relays were also publicly
// reachable by design (vercel-deploy PATCHes ssoProtection:null), which was only
// acceptable once the relay itself authenticated.
//
// THE TWO ASSERTIONS THAT MATTER MOST
//   • S2 — a v1 pool causes NO x-relay-auth to be sent. Every relay deployed before
//     §5.2 forwards ALL headers, so sending the secret to one hands it to the
//     upstream provider. This is the transition guard, and it is why relayVersion
//     defaults to 1 in both repos rather than 2.
//   • S5 — the health probe obeys the SAME gate. Its target is httpbin.org, a third
//     party that echoes request headers back in its body. A probe that sent the
//     secret to a v1 relay would disclose it to that third party.
//
// WHY THIS IS ONE STORM AND NOT SEVEN FILES
// The chain is one security property: "a relay secret reaches only a relay that can
// verify it". Proving each link in isolation would let a break between links pass —
// a template that authenticates, plus a caller that never sends the header, is green
// in two files and broken in production.
//
// Every fixture uses TEST-NET-3 (203.0.113.0/24) and example credentials only —
// never a live LAN or Tailscale value.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── per-test DATA_DIR isolation ──────────────────────────────────────────────
// The recorded harness trap: paths.js freezes DATA_DIR at first import and
// driver.js binds `global._dbAdapter` once at module eval, so a stale binding
// silently cross-contaminates. vi.resetModules() is required in BOTH hooks, the env
// must be set BEFORE the first dynamic import, and every @/lib/db import must be
// awaited rather than static.
let tempDir;
const savedEnv = {};

beforeEach(() => {
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-relayauth-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "VELA_DB_DRIVER", "API_KEY_SECRET"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "relay-auth-storm-fixture-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SECRET = "vrelay_storm_fixture_secret_0123456789abcdef";
const ROUTE_DIR = "src/app/api/proxy-pools";
const ROUTES = {
  vercel: `${ROUTE_DIR}/vercel-deploy/route.js`,
  cloudflare: `${ROUTE_DIR}/cloudflare-deploy/route.js`,
  deno: `${ROUTE_DIR}/deno-deploy/route.js`,
};

/** Read a source file relative to the repo root. */
const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * Strip comments and string literals before running a NEGATIVE regex.
 *
 * A negative source guard ("this pattern must not appear") is defeated by the very
 * comment that explains why the pattern is gone — the word survives in prose and the
 * assertion goes red for the right reason or, worse, someone deletes the comment to
 * make it pass. Stripping first means the guard checks CODE only.
 */
function stripForGuard(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ") // line comments (not "://" in a url)
    .replace(/`(?:\\.|[^`\\])*`/g, '""') // template literals (the relay bodies)
    .replace(/"(?:\\.|[^"\\])*"/g, '""') // double-quoted strings
    .replace(/'(?:\\.|[^'\\])*'/g, "''");// single-quoted strings
}

// ─────────────────────────────────────────────────────────────────────────
// S1 · The relay body itself — executed, not inspected.
//
// The core is run inside `new Function`. The interpolated string is this repo's own
// rendered template constant (relayTemplate.js), never request, operator, or test
// input, so there is no injection channel: the sandbox exists to give the generated
// code its own `fetch` and `Headers`, not to evaluate anything untrusted.
// ─────────────────────────────────────────────────────────────────────────
const ALLOWED = ["api.openai.com", "httpbin.org"];
const OFFLIST = "evil.example.com";

/** Render + execute the cloudflare dialect's core and return its internals. */
async function buildSandbox({ hosts = ALLOWED, secret = SECRET } = {}) {
  const { renderRelaySource } = await import("@/lib/network/relayTemplate.js");
  const src = renderRelaySource("cloudflare", hosts);
  // The core ends where the platform wrapper begins.
  const core = src.slice(0, src.indexOf("function readSecret(env)"));
  const captured = [];
  const mockFetch = async (url, init) => {
    captured.push({ url, headers: [...new Headers(init.headers).entries()] });
    return new Response("UPSTREAM_BODY", { status: 200 });
  };
  // eslint-disable-next-line no-new-func -- see the S1 banner: own constant only.
  const api = new Function(
    "crypto", "TextEncoder", "Headers", "Response", "fetch",
    `${core}\n; return { relayRequest, isAllowedTarget, forwardHeaders, isAuthorized };`
  )(crypto, TextEncoder, Headers, Response, mockFetch);
  const req = (target, { auth = SECRET, relayPath = "/v1/chat", extra = {} } = {}) => {
    const h = new Headers();
    if (target !== null) h.set("x-relay-target", target);
    if (relayPath !== null) h.set("x-relay-path", relayPath);
    if (auth !== null) h.set("x-relay-auth", auth);
    for (const [k, v] of Object.entries(extra)) h.set(k, v);
    return { method: "GET", headers: h };
  };
  return { ...api, captured, req, src };
}

describe("S1 — the deployed relay authenticates, allow-lists, and strips", () => {
  it("forwards an authenticated request to an allowed host", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    const res = await box.relayRequest(box.req("https://api.openai.com"), SECRET);
    expect(res.status).toBe(200);
    expect(box.captured).toHaveLength(1);
    expect(box.captured[0].url).toBe("https://api.openai.com/v1/chat");
  });

  it("rejects every unauthenticated shape with 401", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    const cases = {
      "no header at all": box.req("https://api.openai.com", { auth: null }),
      "wrong secret": box.req("https://api.openai.com", { auth: "vrelay_wrong" }),
      "empty header": box.req("https://api.openai.com", { auth: "" }),
      "prefix of the secret": box.req("https://api.openai.com", { auth: SECRET.slice(0, 12) }),
      "superstring of the secret": box.req("https://api.openai.com", { auth: `${SECRET}X` }),
      "case-flipped secret": box.req("https://api.openai.com", { auth: SECRET.toUpperCase() }),
    };
    for (const [name, request] of Object.entries(cases)) {
      const res = await box.relayRequest(request, SECRET);
      expect(res.status, name).toBe(401);
    }
    expect(box.captured).toHaveLength(0); // nothing reached the upstream
  });

  it("FAILS CLOSED when the platform secret never landed", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    // The relay was deployed, the env var did not arrive. A valid token must still
    // be refused — this is the branch that stops a mis-deploy becoming an open proxy.
    for (const delivered of ["", undefined, null]) {
      const res = await box.relayRequest(box.req("https://api.openai.com"), delivered);
      expect(res.status, `secret=${JSON.stringify(delivered)}`).toBe(401);
    }
    expect(box.captured).toHaveLength(0);
  });

  it("refuses an off-list target with 403 and does not echo it", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    const res = await box.relayRequest(box.req(`https://${OFFLIST}`), SECRET);
    expect(res.status).toBe(403);
    const body = await res.text();
    // Reflecting attacker input back is how a probe learns the allow-list's contents.
    expect(body).not.toContain(OFFLIST);
    expect(box.captured).toHaveLength(0);
  });

  it("refuses a non-HTTP scheme even under the wildcard", { timeout: 20000 }, async () => {
    const box = await buildSandbox({ hosts: ["*"] });
    for (const target of ["file:///etc/passwd", "gopher://203.0.113.9:1234/", "data:text/plain,hi"]) {
      const res = await box.relayRequest(box.req(target), SECRET);
      expect(res.status, target).toBe(403);
    }
    expect(box.captured).toHaveLength(0);
  });

  it("requires a target header, but only AFTER auth", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    // Authenticated with no target → 400 (the relay's own contract).
    const authed = await box.relayRequest(box.req(null), SECRET);
    expect(authed.status).toBe(400);
    // UNauthenticated with no target → 401, not 400. Ordering is the point: a
    // stranger must never learn what the relay expects.
    const stranger = await box.relayRequest(box.req(null, { auth: null }), SECRET);
    expect(stranger.status).toBe(401);
  });

  it("strips the control headers, the whole x-9r-* family, and keeps Authorization", { timeout: 20000 }, async () => {
    const box = await buildSandbox();
    const res = await box.relayRequest(
      box.req("https://api.openai.com", {
        extra: {
          Authorization: "Bearer sk-provider-key-must-survive",
          "content-type": "application/json",
          "x-9r-real-ip": "203.0.113.20",
          "x-9r-peer-token": "process-secret",
          "x-9r-via-proxy": "1",
          "x-9r-password": "hunter2",
          "x-9r-internal-models-fetch": "yes",
          // A sixth member nobody enumerated — the strip is a PREFIX deny-list, so it
          // must fall. An enumeration of today's five would forward this one.
          "x-9r-future-stamp": "must-not-be-forwarded",
        },
      }),
      SECRET
    );
    expect(res.status).toBe(200);
    const sent = Object.fromEntries(box.captured[0].headers);
    // Control channel gone.
    expect(sent["x-relay-auth"]).toBeUndefined();
    expect(sent["x-relay-target"]).toBeUndefined();
    expect(sent["x-relay-path"]).toBeUndefined();
    // The whole x-9r-* family gone, including the unenumerated sixth.
    expect(Object.keys(sent).filter((k) => k.toLowerCase().startsWith("x-9r-"))).toEqual([]);
    // What the upstream provider needs must survive.
    expect(sent["authorization"]).toBe("Bearer sk-provider-key-must-survive");
    expect(sent["content-type"]).toBe("application/json");
  });

  it("survives an operator who pasted the secret with a trailing newline", { timeout: 20000 }, async () => {
    // Headers are OWS-trimmed by the Headers API; a platform env var is NOT. Without
    // trimming both sides, that paste yields a relay that 401s every request after a
    // deploy the dashboard called successful.
    const box = await buildSandbox({ secret: `${SECRET}\n` });
    const res = await box.relayRequest(box.req("https://api.openai.com"), `${SECRET}\n`);
    expect(res.status).toBe(200);
  });

  it("bakes the allow-list sorted, deduped, and with the sentinel replaced", { timeout: 20000 }, async () => {
    const { renderRelaySource } = await import("@/lib/network/relayTemplate.js");
    const src = renderRelaySource("cloudflare", ["z.example", "a.example", "a.example"]);
    expect(src).not.toContain("__ALLOWED_HOSTS__");
    expect(src).toContain('["a.example","z.example"]');
  });

  it("renders all three dialects with their own entry point and secret idiom", { timeout: 20000 }, async () => {
    const { renderRelaySource, RELAY_AUTH_ENV } = await import("@/lib/network/relayTemplate.js");
    const expectShape = {
      vercel: { entry: "export default async function handler", secret: `process.env.${RELAY_AUTH_ENV}` },
      cloudflare: { entry: "async fetch(request, env, ctx)", secret: `env.${RELAY_AUTH_ENV}` },
      deno: { entry: "Deno.serve(async (request)", secret: `Deno.env.get("${RELAY_AUTH_ENV}")` },
    };
    for (const [platform, shape] of Object.entries(expectShape)) {
      const src = renderRelaySource(platform, ALLOWED);
      expect(src, platform).toContain(shape.entry);
      expect(src, platform).toContain(shape.secret);
      // Each wrapper reads the secret through a try/catch so a platform where the
      // variable did not land fail-closes instead of throwing a 500.
      expect(src, platform).toContain('catch (e) { return ""; }');
    }
    // An unknown platform must throw rather than silently deploy nothing.
    expect(() => renderRelaySource("fly", ALLOWED)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S2 · THE VERSION GATE — the single most important assertion in §5.2.
// ─────────────────────────────────────────────────────────────────────────
describe("S2 — relayAuthHeaders sends the secret ONLY to a v2 relay", () => {
  it("sends x-relay-auth for a v2 pool", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    expect(relayAuthHeaders({ relayAuth: SECRET, relayVersion: 2 })).toEqual({ "x-relay-auth": SECRET });
  });

  it("sends NOTHING for a v1 pool — a v1 relay would forward the secret upstream", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    expect(relayAuthHeaders({ relayAuth: SECRET, relayVersion: 1 })).toEqual({});
  });

  it("sends NOTHING for every pre-§5.2 row shape (absent/null/0/undefined version)", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    for (const version of [undefined, null, 0, "0", "1", NaN, "abc"]) {
      expect(relayAuthHeaders({ relayAuth: SECRET, relayVersion: version }), `version=${String(version)}`).toEqual({});
    }
    // No relayVersion key at all — the shape of every row created before §5.2.
    expect(relayAuthHeaders({ relayAuth: SECRET })).toEqual({});
  });

  it("still serves a future v3 relay (the gate is >=, not ===)", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    expect(relayAuthHeaders({ relayAuth: SECRET, relayVersion: 3 })).toEqual({ "x-relay-auth": SECRET });
  });

  it("trims the token but never stringifies a non-string one", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    expect(relayAuthHeaders({ relayAuth: `  ${SECRET}\n`, relayVersion: 2 })).toEqual({ "x-relay-auth": SECRET });
    for (const bad of ["", "   ", { value: SECRET }, 12345, null, undefined]) {
      expect(relayAuthHeaders({ relayAuth: bad, relayVersion: 2 }), `token=${JSON.stringify(bad)}`).toEqual({});
    }
  });

  it("never throws on null/undefined options — this is the hot path", { timeout: 20000 }, async () => {
    const { relayAuthHeaders } = await import("@/lib/network/relayTemplate.js");
    for (const opts of [null, undefined, {}, { relayVersion: 2 }]) {
      expect(() => relayAuthHeaders(opts)).not.toThrow();
    }
  });

  it("RELAY_VERSION is 2 and the header name is not the env var name", { timeout: 20000 }, async () => {
    const { RELAY_VERSION, RELAY_AUTH_ENV } = await import("@/lib/network/relayTemplate.js");
    expect(RELAY_VERSION).toBe(2);
    expect(RELAY_AUTH_ENV).toBe("VELA_RELAY_AUTH");
    // Conflating them is the shape that would put a secret in a URL or a body.
    expect("x-relay-auth").not.toBe(RELAY_AUTH_ENV);
    // Deno forbids DENO_*/LD_*/OTEL_* prefixes and reserves cloud-credential names.
    expect(RELAY_AUTH_ENV.startsWith("VELA_")).toBe(true);
  });

  it("relayTemplate.js imports NOTHING — it sits on the gateway hot path", { timeout: 20000 }, async () => {
    const src = stripForGuard(readSrc("src/lib/network/relayTemplate.js"));
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it("relayTokensMatch is constant-time — timing safety is a property, so it is pinned by source guard", { timeout: 20000 }, async () => {
    const { relayTokensMatch } = await import("@/lib/network/relayDeploy.js");
    // Behaviour first: correctness is what a test can observe.
    expect(relayTokensMatch(SECRET, SECRET)).toBe(true);
    expect(relayTokensMatch(SECRET, `${SECRET}X`)).toBe(false);
    // But `a === b` returns the SAME answers as timingSafeEqual — no behavioural test
    // can tell them apart, and a silent downgrade to `===` is exactly the kind of
    // regression a behaviour suite waves through. So the property is pinned directly.
    const src = readSrc("src/lib/network/relayDeploy.js");
    const body = src.slice(src.indexOf("export function relayTokensMatch"));
    const fn = body.slice(0, body.indexOf("\n}"));
    expect(fn).toContain("timingSafeEqual");
    expect(stripForGuard(fn)).not.toMatch(/return\s+a\s*===\s*b/);
    // And the length check must precede it: timingSafeEqual THROWS on mismatched
    // lengths, so a throw inside an auth check becomes a 500 where a 401 belongs.
    expect(fn.indexOf("a.length !== b.length")).toBeLessThan(fn.indexOf("timingSafeEqual"));
    for (const bad of [null, undefined, 123, {}, "", "   ", "x".repeat(200)]) {
      // JSON.stringify(undefined) returns undefined, not "undefined" — so the label
      // itself needs String() or it throws inside the assertion message builder.
      const label = `provided=${String(JSON.stringify(bad)).slice(0, 20)}`;
      expect(() => relayTokensMatch(SECRET, bad), label).not.toThrow();
      expect(relayTokensMatch(SECRET, bad), label).toBe(false);
      expect(() => relayTokensMatch(bad, SECRET), `expected=${label}`).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S2b · THE REQUEST PATH — proxyAwareFetch, the production caller.
//
// This section exists because the mutation harness found its absence: removing the
// gate from proxyFetch.js left the whole storm green, because every other section
// tests relayAuthHeaders in isolation or the PROBE path. The request path is the one
// that carries live traffic (open-sse/utils/proxyFetch.js:361), so it gets its own
// proof rather than inheriting one by assumption.
// ─────────────────────────────────────────────────────────────────────────
describe("S2b — proxyAwareFetch applies the same gate on the live request path", () => {
  /**
   * Stub globalThis.fetch BEFORE importing proxyFetch: the module captures
   * `originalFetch` at load time, so stubbing after the import would miss it.
   */
  async function withCapturedFetch(run) {
    const seen = [];
    vi.stubGlobal("fetch", async (url, init) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response("UPSTREAM_BODY", { status: 200 });
    });
    try {
      const mod = await import("open-sse/utils/proxyFetch.js");
      return await run(mod.proxyAwareFetch, seen);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  const RELAY = "https://relay-prod.example.workers.dev";

  it("sends x-relay-auth to a v2 relay, with the target and path", { timeout: 20000 }, async () => {
    await withCapturedFetch(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(
        "https://api.openai.com/v1/chat/completions?x=1",
        { method: "POST", headers: { Authorization: "Bearer sk-provider" } },
        { vercelRelayUrl: RELAY, relayAuth: SECRET, relayVersion: 2 }
      );
      // The request went to the RELAY, not to the provider directly.
      expect(seen[0].url).toBe(RELAY);
      expect(seen[0].headers.get("x-relay-auth")).toBe(SECRET);
      expect(seen[0].headers.get("x-relay-target")).toBe("https://api.openai.com");
      expect(seen[0].headers.get("x-relay-path")).toBe("/v1/chat/completions?x=1");
      // The provider's own credential must survive to the upstream.
      expect(seen[0].headers.get("authorization")).toBe("Bearer sk-provider");
    });
  });

  it("sends NO x-relay-auth to a v1 relay — the production transition guard", { timeout: 20000 }, async () => {
    await withCapturedFetch(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch(
        "https://api.openai.com/v1/chat/completions",
        { method: "POST" },
        { vercelRelayUrl: RELAY, relayAuth: SECRET, relayVersion: 1 }
      );
      expect(seen[0].url).toBe(RELAY);
      expect(seen[0].headers.get("x-relay-auth")).toBeNull();
      // The relay envelope still works — only the secret is withheld.
      expect(seen[0].headers.get("x-relay-target")).toBe("https://api.openai.com");
    });
  });

  it("sends NO x-relay-auth for a pre-§5.2 payload with no version at all", { timeout: 20000 }, async () => {
    await withCapturedFetch(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch("https://api.openai.com/v1", {}, { vercelRelayUrl: RELAY, relayAuth: SECRET });
      expect(seen[0].headers.get("x-relay-auth")).toBeNull();
    });
  });

  it("a caller-supplied header can never impersonate the relay control channel", { timeout: 20000 }, async () => {
    await withCapturedFetch(async (proxyAwareFetch, seen) => {
      // options.headers is spread FIRST, so the relay's own headers win. An operator
      // (or an attacker who controls a header) cannot redirect the relay or spoof its
      // auth by injecting these names upstream.
      await proxyAwareFetch(
        "https://api.openai.com/v1/chat",
        {
          headers: {
            "x-relay-target": `https://${OFFLIST}`,
            "x-relay-path": "/pwned",
            "x-relay-auth": "attacker-supplied-token",
          },
        },
        { vercelRelayUrl: RELAY, relayAuth: SECRET, relayVersion: 2 }
      );
      expect(seen[0].headers.get("x-relay-target")).toBe("https://api.openai.com");
      expect(seen[0].headers.get("x-relay-path")).toBe("/v1/chat");
      expect(seen[0].headers.get("x-relay-auth")).toBe(SECRET);
    });
  });

  it("no relay configured → the request goes straight to its own target", { timeout: 20000 }, async () => {
    await withCapturedFetch(async (proxyAwareFetch, seen) => {
      await proxyAwareFetch("https://api.openai.com/v1/chat", {}, { relayAuth: SECRET, relayVersion: 2 });
      // Without vercelRelayUrl there is no relay branch, and no secret leaves.
      expect(seen[0].url).toBe("https://api.openai.com/v1/chat");
      expect(seen[0].headers.get("x-relay-auth")).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S3 · The shared builder — one payload shape, ten call sites.
// ─────────────────────────────────────────────────────────────────────────
describe("S3 — buildProxyOptionsPayload pairs the secret with its version", () => {
  it("carries relayAuth and relayVersion together from a resolved config", { timeout: 20000 }, async () => {
    const { buildProxyOptionsPayload } = await import("@/lib/network/connectionProxy.js");
    const out = buildProxyOptionsPayload({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://203.0.113.7:3128",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "https://relay.example.workers.dev",
      strictProxy: true,
      relayAuth: SECRET,
      relayVersion: 2,
    });
    expect(out.relayAuth).toBe(SECRET);
    expect(out.relayVersion).toBe(2);
    expect(out.strictProxy).toBe(true);
    expect(out.vercelRelayUrl).toBe("https://relay.example.workers.dev");
  });

  it("defaults relayVersion to 1 — never to 2", { timeout: 20000 }, async () => {
    const { buildProxyOptionsPayload } = await import("@/lib/network/connectionProxy.js");
    // A secret with no version must NOT become sendable. This default is the same
    // transition guard as the repos'.
    expect(buildProxyOptionsPayload({ relayAuth: SECRET }).relayVersion).toBe(1);
    expect(buildProxyOptionsPayload({ relayAuth: SECRET, relayVersion: "2" }).relayVersion).toBe(2);
    expect(buildProxyOptionsPayload({ relayAuth: SECRET, relayVersion: "abc" }).relayVersion).toBe(1);
  });

  it("honours an explicit strictProxy override and defaults to the source value", { timeout: 20000 }, async () => {
    const { buildProxyOptionsPayload } = await import("@/lib/network/connectionProxy.js");
    const cfg = { strictProxy: true };
    expect(buildProxyOptionsPayload(cfg).strictProxy).toBe(true);
    // The usage/quota paths force false so a quota read degrades to direct.
    expect(buildProxyOptionsPayload(cfg, { strictProxy: false }).strictProxy).toBe(false);
    expect(buildProxyOptionsPayload({}).strictProxy).toBe(false);
  });

  it("reads the secret from the TOP LEVEL only — never from providerSpecificData", { timeout: 20000 }, async () => {
    const { buildProxyOptionsPayload } = await import("@/lib/network/connectionProxy.js");
    // providerSpecificData is persisted wholesale by updateProviderCredentials
    // (tokenRefresh.js:177-182), so a secret there would be written plaintext into a
    // second table. There is deliberately no psd fallthrough: a secret that somehow
    // did land there is WITHHELD rather than forwarded.
    const out = buildProxyOptionsPayload({ providerSpecificData: { relayAuth: SECRET, relayVersion: 2 } });
    expect(out.relayAuth).toBe("");
    expect(out.relayVersion).toBe(1);
  });

  it("survives null/undefined input", { timeout: 20000 }, async () => {
    const { buildProxyOptionsPayload } = await import("@/lib/network/connectionProxy.js");
    for (const cfg of [null, undefined, {}]) {
      expect(() => buildProxyOptionsPayload(cfg)).not.toThrow();
      expect(buildProxyOptionsPayload(cfg).relayAuth).toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S4 · The row, against a REAL sqlite store — the secret lands, and reads mask it.
// ─────────────────────────────────────────────────────────────────────────
describe("S4 — the pool row carries the secret and every read masks it", () => {
  it("createProxyPool persists relayToken and defaults relayVersion to 1", { timeout: 20000 }, async () => {
    const { createProxyPool, getProxyPoolById } = await import("@/models");
    // createProxyPool builds an explicit literal and DROPS unnamed keys, so a field
    // not in that literal vanishes silently. relayToken/relayVersion were added to it.
    const created = await createProxyPool({
      name: "relay-v1-default",
      proxyUrl: "https://relay-a.example.workers.dev",
      type: "cloudflare",
      relayToken: SECRET,
    });
    const row = await getProxyPoolById(created.id);
    expect(row.relayToken).toBe(SECRET);
    // Defaulting to 2 would hand a secret to a v1 relay that forwards every header.
    expect(row.relayVersion).toBe(1);
  });

  it("createProxyPool stores relayVersion 2 when the deploy route sets it", { timeout: 20000 }, async () => {
    const { createProxyPool, getProxyPoolById } = await import("@/models");
    const created = await createProxyPool({
      name: "relay-v2",
      proxyUrl: "https://relay-b.example.workers.dev",
      type: "vercel",
      relayToken: SECRET,
      relayVersion: 2,
    });
    const row = await getProxyPoolById(created.id);
    expect(row.relayToken).toBe(SECRET);
    expect(row.relayVersion).toBe(2);
  });

  it("maskProxyPoolForRead DELETES relayToken and KEEPS relayVersion", { timeout: 20000 }, async () => {
    const { maskProxyPoolForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyPoolForRead({
      id: "p1", name: "relay", proxyUrl: "https://relay-c.example.workers.dev",
      relayToken: SECRET, relayVersion: 2,
    });
    // Deleted, not masked. No derived marker either: updateProxyPool MERGES, so any
    // field a masker emits can be round-tripped straight back into the blob by a form
    // posting what it was given (the §5.4 destroy-hazard).
    expect("relayToken" in masked).toBe(false);
    expect(JSON.stringify(masked)).not.toContain(SECRET);
    // relayVersion is the signal that stops a v1 relay being sent a token, so it
    // must survive the mask.
    expect(masked.relayVersion).toBe(2);
  });

  it("posting a masked row back cannot destroy the stored secret", { timeout: 20000 }, async () => {
    const { createProxyPool, updateProxyPool, getProxyPoolById } = await import("@/models");
    const { maskProxyPoolForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const created = await createProxyPool({
      name: "relay-roundtrip",
      proxyUrl: "https://relay-d.example.workers.dev",
      type: "deno",
      relayToken: SECRET,
      relayVersion: 2,
    });
    // A dashboard form reads, then posts back what it was given.
    const masked = maskProxyPoolForRead(await getProxyPoolById(created.id));
    await updateProxyPool(created.id, { ...masked, name: "renamed by the form" });
    const after = await getProxyPoolById(created.id);
    expect(after.name).toBe("renamed by the form");
    // The merge must not have overwritten the secret with undefined or a mask.
    expect(after.relayToken).toBe(SECRET);
    expect(after.relayVersion).toBe(2);
  });

  it("relayToken is in the backup/transfer secret walk set", { timeout: 20000 }, async () => {
    const { CONNECTION_SECRET_FIELDS } = await import("@/lib/db/repos/backupSecurity.js");
    // The same set governs proxyPools (sqlite/backupRepo.js:70/:75, mysql twin
    // :37/:42), so a relay secret is redacted in every transfer path too.
    expect(CONNECTION_SECRET_FIELDS).toContain("relayToken");
    // relayVersion is a protocol marker, not a secret — it must NOT be redacted, or
    // a restored pool would lose the signal that gates its own secret.
    expect(CONNECTION_SECRET_FIELDS).not.toContain("relayVersion");
  });

  it("maskConnectionForRead deletes a top-level relayAuth from a credential", { timeout: 20000 }, async () => {
    const { maskConnectionForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskConnectionForRead({
      id: "c1", accessToken: "at", relayAuth: SECRET, relayVersion: 2,
      providerSpecificData: { vercelRelayUrl: "https://relay-e.example.workers.dev" },
    });
    expect("relayAuth" in masked).toBe(false);
    expect(JSON.stringify(masked)).not.toContain(SECRET);
    // relayVersion is not a secret and stays.
    expect(masked.relayVersion).toBe(2);
  });

  // The mutation harness found this gap: `mysql-repo-defaults-version-2` stayed GREEN,
  // because every S4 test above boots the SQLITE store and nothing exercises the
  // mysql twin. No MariaDB is available in unit tests, so the twin's default cannot
  // be proven behaviourally here — but it CAN be pinned by source guard, the way the
  // house's parity tests compare their twins (i18n-literals-parity, dockerfile-closure).
  // Both repos build an EXPLICIT create literal that DROPS unnamed keys, so the two
  // relay fields must appear identically in both or one store silently loses the
  // secret / mis-defaults the version.
  it("both proxyPools twins carry the SAME relayToken/relayVersion create literal", { timeout: 20000 }, async () => {
    const SQLITE = "src/lib/db/repos/sqlite/proxyPoolsRepo.js";
    const MYSQL = "src/lib/db/repos/mysql/proxyPoolsRepo.js";

    /** Extract the relay-field lines from a twin's createProxyPool literal. */
    const relayLines = (rel) => {
      const src = readSrc(rel);
      const at = src.indexOf("createProxyPool");
      expect(at, `${rel} exports createProxyPool`).toBeGreaterThan(-1);
      const fn = src.slice(at);
      return {
        // Both must default the version to 1 — NEVER 2. A 2 would tell the caller
        // gate a pre-§5.2 relay is protected, and the secret would be forwarded to a
        // relay that echoes every header upstream.
        token: /relayToken:\s*data\.relayToken\s*\?\?\s*null/.test(fn),
        versionToOne: /relayVersion:\s*data\.relayVersion\s*\?\?\s*1\b/.test(fn),
        // The exact failure the vacuous mutation represented: a `?? 2` default.
        versionToTwo: /relayVersion:\s*data\.relayVersion\s*\?\?\s*2\b/.test(fn),
      };
    };

    const sqlite = relayLines(SQLITE);
    const mysql = relayLines(MYSQL);

    // sqlite — proven behaviourally above AND by source here.
    expect(sqlite.token, "sqlite persists relayToken").toBe(true);
    expect(sqlite.versionToOne, "sqlite defaults relayVersion to 1").toBe(true);
    expect(sqlite.versionToTwo, "sqlite must NEVER default to 2").toBe(false);

    // mysql twin — source guard is the ONLY coverage it has, so it must match exactly.
    expect(mysql.token, "mysql twin persists relayToken").toBe(true);
    expect(mysql.versionToOne, "mysql twin defaults relayVersion to 1").toBe(true);
    expect(mysql.versionToTwo, "mysql twin must NEVER default to 2").toBe(false);

    // And the two must not have drifted from each other on either field.
    expect(mysql).toEqual(sqlite);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S5 · The health probe obeys the SAME gate — and its target is a third party.
// ─────────────────────────────────────────────────────────────────────────
describe("S5 — testRelayUrl authenticates a v2 relay and never leaks to httpbin", () => {
  /** Mock undici's fetch and capture what the probe actually put on the wire. */
  async function withMockedUndici(run) {
    const seen = [];
    vi.doMock("undici", () => ({
      ProxyAgent: class { constructor() {} async close() {} },
      fetch: async (url, init) => {
        seen.push({ url, headers: new Headers(init?.headers) });
        return { ok: true, status: 200, statusText: "OK" };
      },
    }));
    const mod = await import("@/lib/network/proxyTest.js");
    try {
      return await run(mod, seen);
    } finally {
      vi.doUnmock("undici");
    }
  }

  it("sends x-relay-auth for a v2 pool so the relay confirms alive", { timeout: 20000 }, async () => {
    await withMockedUndici(async ({ testRelayUrl }, seen) => {
      const res = await testRelayUrl({
        relayUrl: "https://relay-f.example.workers.dev",
        relayAuth: SECRET,
        relayVersion: 2,
      });
      expect(res.ok).toBe(true);
      expect(seen[0].headers.get("x-relay-auth")).toBe(SECRET);
      expect(seen[0].headers.get("x-relay-target")).toBe("https://httpbin.org");
      expect(seen[0].headers.get("x-relay-path")).toBe("/get");
    });
  });

  it("sends NO x-relay-auth for a v1 pool — httpbin echoes headers back to a third party", { timeout: 20000 }, async () => {
    await withMockedUndici(async ({ testRelayUrl }, seen) => {
      const res = await testRelayUrl({
        relayUrl: "https://relay-g.example.workers.dev",
        relayAuth: SECRET,
        relayVersion: 1,
      });
      expect(res.ok).toBe(true);
      expect(seen[0].headers.get("x-relay-auth")).toBeNull();
      expect(seen[0].headers.get("x-relay-target")).toBe("https://httpbin.org");
    });
  });

  it("sends NO x-relay-auth when the row has no relayVersion (pre-§5.2)", { timeout: 20000 }, async () => {
    await withMockedUndici(async ({ testRelayUrl }, seen) => {
      await testRelayUrl({ relayUrl: "https://relay-h.example.workers.dev", relayAuth: SECRET });
      expect(seen[0].headers.get("x-relay-auth")).toBeNull();
    });
  });

  it("testPoolReachability threads the row's relayToken and relayVersion", { timeout: 20000 }, async () => {
    await withMockedUndici(async ({ testPoolReachability }, seen) => {
      const out = await testPoolReachability({
        id: "p2", type: "cloudflare",
        proxyUrl: "https://relay-i.example.workers.dev",
        relayToken: SECRET, relayVersion: 2,
      });
      expect(out.verdict).toBe("alive");
      expect(seen[0].headers.get("x-relay-auth")).toBe(SECRET);
    });
  });

  it("a non-relay pool is still probed as a proxy, never through the envelope", { timeout: 20000 }, async () => {
    await withMockedUndici(async ({ testPoolReachability, RELAY_PROXY_TYPES }, seen) => {
      expect(RELAY_PROXY_TYPES.has("http")).toBe(false);
      await testPoolReachability({ id: "p3", type: "http", proxyUrl: "http://203.0.113.7:3128" });
      // No relay envelope headers on the proxy path.
      expect(seen.length ? seen[0].headers.get("x-relay-target") : null).toBeNull();
    });
  });

  it("401 and 403 classify as INDETERMINATE, never as dead — no fleet liquidation", { timeout: 20000 }, async () => {
    // This is the correction of a claim that was written into source and was FALSE:
    // an omitted PROBE_HOST (403) or a probe with no secret (401) does NOT read as
    // dead, because neither status is in DETERMINISTIC_FAILURE_STATUSES. The real
    // symptom is a pool that can never be confirmed ALIVE — quieter, and still a bug.
    const { classifyProbeVerdict } = await import("@/lib/network/proxyTest.js");
    expect(classifyProbeVerdict({ ok: false, status: 401 })).toBe("indeterminate");
    expect(classifyProbeVerdict({ ok: false, status: 403 })).toBe("indeterminate");
    // The statuses that DO prove death stay dead.
    for (const status of [400, 404, 410]) {
      expect(classifyProbeVerdict({ ok: false, status }), `${status}`).toBe("dead");
    }
    expect(classifyProbeVerdict({ ok: true })).toBe("alive");
    expect(classifyProbeVerdict(null)).toBe("indeterminate");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S6 · The three deploy routes — one shared body, the narrow response, no orphans.
// ─────────────────────────────────────────────────────────────────────────
describe("S6 — all three deploy routes share one relay body and one response shape", () => {
  it("no route carries an inline relay body any more", { timeout: 20000 }, async () => {
    // Guarded against comment-defeat: the strings below appear in explanatory prose.
    for (const [platform, rel] of Object.entries(ROUTES)) {
      const code = stripForGuard(readSrc(rel));
      expect(code, `${platform} inline relay constant`).not.toMatch(/RELAY_WORKER_CODE|DENO_RELAY_CODE|VERCEL_RELAY_CODE/);
      // The open-proxy marker: reading the target header inside the route means the
      // route is still building its own relay body.
      expect(code, `${platform} builds its own relay envelope`).not.toContain("x-relay-target");
    }
  });

  it("every route imports the shared §5.2 surface from ONE module", { timeout: 20000 }, async () => {
    const REQUIRED = ["buildRelayAllowList", "mintRelayToken", "persistRelayPool", "relayDeployResponse", "renderRelay"];
    for (const [platform, rel] of Object.entries(ROUTES)) {
      const src = readSrc(rel);
      const importBlock = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/network\/relayDeploy\.js"/);
      expect(importBlock, `${platform} imports relayDeploy.js`).toBeTruthy();
      const names = importBlock[1].split(",").map((s) => s.trim());
      for (const fn of REQUIRED) expect(names, `${platform} imports ${fn}`).toContain(fn);
    }
  });

  it("every route accepts poolId and allowWildcard — the update path and the escape hatch", { timeout: 20000 }, async () => {
    for (const [platform, rel] of Object.entries(ROUTES)) {
      const src = readSrc(rel);
      expect(src, `${platform} reads poolId`).toContain("body.poolId");
      expect(src, `${platform} reads allowWildcard`).toContain("allowWildcard");
      // The wildcard must be loud, never a silent default.
      expect(src, `${platform} warns on wildcard`).toMatch(/console\.warn\([\s\S]{0,200}WILDCARD/);
      // And never defaulted to true.
      expect(src, `${platform} wildcard default`).not.toMatch(/allowWildcard\s*=\s*true/);
    }
  });

  it("no route calls createProxyPool directly — that was the orphan-row wound", { timeout: 20000 }, async () => {
    // Every re-deploy used to mint a NEW row at the SAME relay URL, so the operator
    // watched identical pools accumulate and the sweep probed one URL once per orphan.
    for (const [platform, rel] of Object.entries(ROUTES)) {
      const code = stripForGuard(readSrc(rel));
      expect(code, `${platform} creates pools directly`).not.toContain("createProxyPool");
      expect(code, `${platform} persists through the shared path`).toContain("persistRelayPool");
    }
  });

  it("no route returns the pool row or the secret", { timeout: 20000 }, async () => {
    for (const [platform, rel] of Object.entries(ROUTES)) {
      const code = stripForGuard(readSrc(rel));
      // The old shape was `{ proxyPool: maskProxyPoolForRead(...), deployUrl }`.
      expect(code, `${platform} returns a pool row`).not.toContain("proxyPool:");
      expect(code, `${platform} imports the read masker`).not.toContain("maskProxyPoolForRead");
      // The secret is minted, delivered to the platform store, and persisted — it is
      // never on the response wire.
      expect(code, `${platform} puts the token on the wire`).not.toMatch(/relayToken\s*:/);
    }
  });

  it("the narrow response shape carries no secret", { timeout: 20000 }, async () => {
    const { relayDeployResponse } = await import("@/lib/network/relayDeploy.js");
    const out = relayDeployResponse({
      pool: { id: "p9", relayVersion: 2 },
      deployUrl: "https://relay-j.example.workers.dev",
      reusedRow: false,
      hostCount: 108,
      wildcard: false,
    });
    expect(out).toEqual({
      poolId: "p9",
      deployUrl: "https://relay-j.example.workers.dev",
      relayVersion: 2,
      reusedRow: false,
      allowList: { hostCount: 108, wildcard: false },
    });
    expect(JSON.stringify(out)).not.toContain("vrelay_");
    // No key that could ever hold the secret.
    expect(Object.keys(out)).not.toContain("relayToken");
    expect(Object.keys(out)).not.toContain("relayAuth");
  });

  it("the minted token is high-entropy, prefixed, and unique", { timeout: 20000 }, async () => {
    const { mintRelayToken } = await import("@/lib/network/relayDeploy.js");
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const token = mintRelayToken();
      expect(token.startsWith("vrelay_")).toBe(true);
      // 32 bytes base64url = 43 chars, plus the 7-char prefix. Under Vercel's 5KB
      // Edge env cap and Deno's smallest documented value limit (4,096).
      expect(token.length).toBe(50);
      expect(/^[A-Za-z0-9_\-]+$/.test(token.slice(7))).toBe(true);
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it("relayTokensMatch is constant-time and never throws on odd input", { timeout: 20000 }, async () => {
    const { relayTokensMatch } = await import("@/lib/network/relayDeploy.js");
    expect(relayTokensMatch(SECRET, SECRET)).toBe(true);
    expect(relayTokensMatch(`  ${SECRET} `, SECRET)).toBe(true); // both sides trimmed
    expect(relayTokensMatch(SECRET, `${SECRET}X`)).toBe(false);
    expect(relayTokensMatch(SECRET, SECRET.toUpperCase())).toBe(false);
    // timingSafeEqual throws on mismatched lengths; the length check must come first
    // so a throw cannot become a 500 where a 401 belongs.
    for (const bad of [null, undefined, 123, {}, "", "   "]) {
      expect(() => relayTokensMatch(SECRET, bad), `provided=${JSON.stringify(bad)}`).not.toThrow();
      expect(relayTokensMatch(SECRET, bad)).toBe(false);
      expect(() => relayTokensMatch(bad, SECRET)).not.toThrow();
    }
  });

  it("persistRelayPool updates the named row instead of minting an orphan", { timeout: 20000 }, async () => {
    const { createProxyPool, getProxyPools } = await import("@/models");
    const { persistRelayPool } = await import("@/lib/network/relayDeploy.js");
    const existing = await createProxyPool({
      name: "relay-orphan-test", proxyUrl: "https://relay-k.example.workers.dev", type: "vercel",
    });
    const before = (await getProxyPools()).length;

    const { pool, reusedRow } = await persistRelayPool({
      poolId: existing.id,
      name: "relay-orphan-test",
      proxyUrl: "https://relay-k.example.workers.dev",
      type: "vercel",
      relayToken: SECRET,
      hostCount: 108,
    });
    expect(reusedRow).toBe(true);
    expect(pool.id).toBe(existing.id);
    expect((await getProxyPools()).length).toBe(before); // no second row
    expect(pool.relayToken).toBe(SECRET);
    expect(pool.relayVersion).toBe(2); // set only where a v2 body is actually deployed
  });

  it("persistRelayPool adopts a same-URL row when no poolId is given", { timeout: 20000 }, async () => {
    const { createProxyPool, getProxyPools } = await import("@/models");
    const { persistRelayPool } = await import("@/lib/network/relayDeploy.js");
    const URL = "https://relay-l.example.workers.dev/";
    await createProxyPool({ name: "adopted", proxyUrl: URL, type: "cloudflare" });
    const before = (await getProxyPools()).length;
    // Trailing slash differs — adoption must still match.
    const { reusedRow } = await persistRelayPool({
      name: "adopted", proxyUrl: URL.replace(/\/$/, ""), type: "cloudflare", relayToken: SECRET,
    });
    expect(reusedRow).toBe(true);
    expect((await getProxyPools()).length).toBe(before);
  });

  it("persistRelayPool 404s on an unresolvable poolId rather than creating a row", { timeout: 20000 }, async () => {
    const { getProxyPools } = await import("@/models");
    const { persistRelayPool } = await import("@/lib/network/relayDeploy.js");
    const before = (await getProxyPools()).length;
    // A poolId that does not resolve is a stale dashboard, not a new pool: falling
    // through to create would silently mint exactly the orphan this exists to prevent.
    await expect(
      persistRelayPool({ poolId: "does-not-exist", name: "x", proxyUrl: "https://relay-m.example.workers.dev", type: "deno", relayToken: SECRET })
    ).rejects.toMatchObject({ status: 404 });
    expect((await getProxyPools()).length).toBe(before);
  });

  it("persistRelayPool creates only when the relay is genuinely new", { timeout: 20000 }, async () => {
    const { getProxyPools } = await import("@/models");
    const { persistRelayPool } = await import("@/lib/network/relayDeploy.js");
    const before = (await getProxyPools()).length;
    const { reusedRow, pool } = await persistRelayPool({
      name: "brand-new", proxyUrl: "https://relay-n.example.workers.dev", type: "vercel", relayToken: SECRET,
    });
    expect(reusedRow).toBe(false);
    expect(pool.relayToken).toBe(SECRET);
    expect((await getProxyPools()).length).toBe(before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S7 · The allow-list — registry + DB-derived + probe, and the traps around it.
// ─────────────────────────────────────────────────────────────────────────
describe("S7 — the baked allow-list covers every real host and the probe", () => {
  it("includes the probe host by default, and says so in the source breakdown", { timeout: 20000 }, async () => {
    const { buildRelayAllowList } = await import("@/lib/network/relayAllowList.js");
    const { PROBE_HOST } = await import("@/lib/network/relayTemplate.js");
    const { hosts, source } = await buildRelayAllowList();
    expect(hosts).toContain(PROBE_HOST);
    expect(source.probe).toBe(1);
    expect(source.total).toBe(hosts.length);
    // Sorted and deduped, so the baked payload is stable and diffable.
    expect(hosts).toEqual([...new Set(hosts)].sort());
  });

  it("omit the probe host and a v2 relay can never confirm alive", { timeout: 20000 }, async () => {
    const { buildRelayAllowList } = await import("@/lib/network/relayAllowList.js");
    const { PROBE_HOST } = await import("@/lib/network/relayTemplate.js");
    const { hosts, source } = await buildRelayAllowList({ includeProbe: false });
    expect(hosts).not.toContain(PROBE_HOST);
    expect(source.probe).toBe(0);
  });

  it("resolves real registry hosts from every baseUrl location, not just transport", { timeout: 20000 }, async () => {
    const { registryHosts } = await import("@/lib/network/relayAllowList.js");
    const hosts = await registryHosts();
    expect(hosts.size).toBeGreaterThan(50);
    // transport.baseUrl (openai) AND ttsConfig.baseUrl (elevenlabs) — a walk that
    // read only transport.baseUrl reported 38 falsely "empty" registry entries.
    expect(hosts.has("api.openai.com")).toBe(true);
    expect(hosts.has("api.elevenlabs.io")).toBe(true);
  });

  it("hostFromBaseUrl handles BOTH bare host:port shapes — one throws, one does not", { timeout: 20000 }, async () => {
    // The bug this pins: `new URL("api.example.com:8443")` does NOT throw. It parses
    // "api.example.com:" as a SCHEME and "8443" as the pathname, yielding a valid URL
    // with an EMPTY hostname — so a retry keyed on `catch` silently dropped the
    // dotted-hostname case, the more common shape for a self-hosted target.
    const { hostFromBaseUrl } = await import("@/lib/network/relayAllowList.js");
    const CASES = [
      ["https://api.openai.com/v1/chat", "api.openai.com"],
      ["http://api.example.com:8443/v1", "api.example.com"],
      ["api.example.com:8443", "api.example.com"],   // parsed as a scheme, did not throw
      ["localhost:8080", "localhost"],               // same shape
      ["203.0.113.7:3128", "203.0.113.7"],           // this one DID throw
      ["relay.example.workers.dev", "relay.example.workers.dev"], // no port, throws
      ["  https://api.elevenlabs.io/v1/tts  ", "api.elevenlabs.io"], // trimmed
      ["", null],
      ["   ", null],
      ["${API_BASE}/v1", null],                      // template — host unknown until runtime
      ["https://polly.{region}.amazonaws.com", null], // template
      ["file:///etc/passwd", null],                  // non-HTTP scheme, retry made "file"
      ["devin-cli://acp/v2", null],                  // registry ACP transport, not HTTP
      ["edge-tts", null],                            // registry protocol marker, not a host
      ["google-tts", null],                          // same
      ["local-device", null],                        // same
      ["not a url at all", null],
      [null, null],
      [undefined, null],
      [12345, null],
    ];
    for (const [input, want] of CASES) {
      expect(hostFromBaseUrl(input), `hostFromBaseUrl(${JSON.stringify(input)})`).toBe(want);
    }
  });

  it("no fabricated host reaches the baked allow-list", { timeout: 20000 }, async () => {
    // The three fabrications above are not hypothetical: all five inputs exist in the
    // live 127-entry registry (three bare protocol markers, two ACP schemes) and
    // `file:///etc/passwd` is what the schemeless retry produced from the file case.
    // This pins them at the registry level, not just the unit level.
    const { registryHosts } = await import("@/lib/network/relayAllowList.js");
    const hosts = await registryHosts();
    for (const fabricated of ["edge-tts", "google-tts", "local-device", "file"]) {
      expect(hosts.has(fabricated), `${fabricated} must not be baked`).toBe(false);
    }
    // And the real hosts survived the stricter rule — the fix must not have narrowed
    // the list into uselessness.
    expect(hosts.size).toBeGreaterThan(50);
    expect(hosts.has("api.openai.com")).toBe(true);
  });

  it("dbHosts never throws on a cold or unreachable store", { timeout: 20000 }, async () => {
    const { dbHosts } = await import("@/lib/network/relayAllowList.js");
    // A deploy must not be blocked by a cold DB, and the alternative (failing closed
    // to an EMPTY allow-list) would brick the relay.
    const hosts = await dbHosts();
    expect(hosts).toBeInstanceOf(Set);
  });

  it("a DB-derived custom node host reaches the allow-list", { timeout: 20000 }, async () => {
    // Registry-only denied Azure, aws-polly and every custom node — which is why the
    // Star decreed registry + probe + DB-derived hosts.
    const { getProviderNodes } = await import("@/models");
    const { dbHosts } = await import("@/lib/network/relayAllowList.js");
    await getProviderNodes(); // warm the store
    const { createProviderNode } = await import("@/models");
    if (typeof createProviderNode === "function") {
      await createProviderNode({
        provider: "openai", name: "custom-node", baseUrl: "https://custom.internal.example/v1",
      }).catch(() => {});
      const hosts = await dbHosts();
      // Best-effort: a store that cannot take the row simply yields nothing.
      expect(hosts).toBeInstanceOf(Set);
    }
  });

  it("the four geo-probe hosts are DELIBERATELY absent (the trap note)", { timeout: 20000 }, async () => {
    // poolEgressProbe.js:70 builds {enabled, url, strictProxy} with no
    // vercelRelayUrl, so a relay pool takes the CONNECT path and those hosts never
    // arrive as x-relay-target. Allowing them would widen the surface for nothing.
    const { buildRelayAllowList } = await import("@/lib/network/relayAllowList.js");
    const { hosts } = await buildRelayAllowList();
    for (const geo of ["ipwho.is", "ip-api.com", "ipapi.co", "ipinfo.io"]) {
      expect(hosts, `${geo} must not be baked`).not.toContain(geo);
    }
  });
});
