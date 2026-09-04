// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.4
// Read-boundary credential masking, proven against a real sqlite store.
//
// WHAT §5.4 IS FOR
// A proxy url carries its credential as userinfo (`scheme://user:pass@host:port`)
// and the dashboard rendered it RAW (page.js:759) and loaded it plaintext into
// the edit form. Because §5.1 keeps GET /api/proxy-pools posture-consistent, a
// REMOTE UNAUTHENTICATED caller reaches that read on a requireLogin=false
// instance — so masking is what makes the read-list safe at all. The two ship
// together or not at all; that coupling is the reason this storm and
// proxy-storm-security-gate are the same milestone's exit criterion.
//
// THE DESTROY-HAZARD THIS STORM GUARDS (S4)
// Masking a read has a second-order effect: the edit form no longer holds the
// credential, and `updateProxyPool` MERGES (`{ ...rowToPool(row), ...data }`). A
// form that posts back what it was given would therefore overwrite the stored
// plaintext with a masked string — silently killing the pool, with no error
// anywhere. The fix is that the form OMITS proxyUrl when untouched and
// normalizeProxyPoolUpdate is hasOwnProperty-guarded. S4 proves that end-to-end
// against the real repo, because "the guard exists" is not the same as "the
// credential survived".
//
// WHERE MASKING MAY NOT LIVE (S6)
// The repo is the gateway's well: internal readers in proxyFleet, connectionProxy,
// poolEgressProbe, auth and relayDeploy read pool rows directly and need plaintext to
// build a dispatcher. Neither line numbers NOR a total are cited here, and both
// omissions are deliberate. The first draft cited connectionProxy.js:86, which is a
// COMMENT line, and a stale cite reads as authority while pointing at nothing; a later
// draft put a total on the readers, and a total cannot be reproduced mid-release —
// relayDeploy.js is added by a different commit than this test, so the grep below
// returns a different number depending on which commit's tree it runs against.
// Re-derive with `grep -rnE "getProxyPools\(|getProxyPoolById\(" src open-sse --include=*.js`.
// Masking belongs at the HTTP edge only. S6 fails if anyone "tidies" the masker down
// into the repo layer, and the plaintext assertion below is what makes that tidy-up
// unable to slip through.
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
// silently cross-contaminates. vi.resetModules() is required in BOTH hooks, the
// env must be set BEFORE the first dynamic import, and every @/lib/db import
// must be awaited rather than static.
let tempDir;
const savedEnv = {};

beforeEach(() => {
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-redact-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "VELA_DB_DRIVER", "API_KEY_SECRET"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "redaction-storm-fixture-secret";
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
});

const CRED = "s3cretpass";
const HOST = "203.0.113.7";
const URL_WITH_CRED = `http://user1:${CRED}@${HOST}:1080`;
const URL_NO_CRED = `http://${HOST}:3128`;

// ─────────────────────────────────────────────────────────────────────────
// S1 · The masker itself — the credential leaves, the identity stays.
// ─────────────────────────────────────────────────────────────────────────
describe("S1 — maskProxyUrlForRead drops the credential and keeps the identity", () => {
  it("removes userinfo from an http url, keeping scheme/host/port", async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyUrlForRead(URL_WITH_CRED);
    expect(masked).not.toContain(CRED);
    expect(masked).not.toContain("user1");
    expect(masked).not.toContain("@");
    expect(masked).toContain(HOST);
    expect(masked).toContain("1080");
    expect(masked.startsWith("http://")).toBe(true);
  });

  it("removes userinfo from a socks5 url", async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyUrlForRead(`socks5://user2:${CRED}@203.0.113.8:1080`);
    expect(masked).not.toContain(CRED);
    expect(masked).toBe("socks5://203.0.113.8:1080");
  });

  it("handles a percent-encoded password without leaking a fragment", async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    // "@" inside the password is the classic string-surgery failure: a naive
    // split-on-first-"@" or a regex over the raw text leaves part of it behind.
    // Parsing exposes username/password separately, so the whole thing goes.
    const masked = maskProxyUrlForRead(`http://u:p%40ss%3Aword@${HOST}:1080`);
    expect(masked).not.toContain("p%40ss");
    expect(masked).not.toContain("ss%3Aword");
    expect(masked).not.toContain("@");
  });

  it("preserves path and query while dropping userinfo", async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyUrlForRead(`http://relayuser:relaypass@${HOST}:1080/workers/dev?x=1`);
    expect(masked).not.toContain("relaypass");
    expect(masked).not.toContain("relayuser");
    expect(masked).not.toContain("@");
    expect(masked).toContain("/workers/dev");
    expect(masked).toContain("x=1");
    expect(masked).toContain(HOST);
  });

  it.each([
    ["http url with no userinfo", URL_NO_CRED],
    ["https relay url", "https://relay.example/workers/dev"],
    ["bare host:port (the stack tolerates it)", `${HOST}:3128`],
  ])("leaves %s unchanged — there was never a secret in it", async (_label, url) => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    expect(maskProxyUrlForRead(url)).toBe(url);
  });

  it("redacts WHOLE an unparseable value that carries userinfo", async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    // Not a URL the platform can parse, but the userinfo shape is present.
    // Keeping an identifiable fragment is impossible here, so whole-redaction is
    // the only fail-safe: better an unreadable row than a leaked credential.
    const masked = maskProxyUrlForRead("nonsense://u:p@not a url");
    expect(masked).not.toContain("p@not");
    expect(masked).toBe("[REDACTED]");
  });

  it.each([
    ["empty string", "", ""],
    ["whitespace", "   ", ""],
    ["null", null, null],
    ["undefined", undefined, undefined],
    ["a number", 42, 42],
  ])("passes through %s without inventing a value", async (_l, input, expected) => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    expect(maskProxyUrlForRead(input)).toBe(expected);
  });

  it("never mutates its input", async () => {
    const { maskProxyPoolForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const pool = { id: "p1", name: "n", proxyUrl: URL_WITH_CRED, noProxy: "localhost" };
    const before = JSON.stringify(pool);
    maskProxyPoolForRead(pool);
    // The repo hands out live objects that a caller may still need in plaintext,
    // so the masker must copy. A mutation here would corrupt the gateway's view.
    expect(JSON.stringify(pool)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S2 · The pool and connection masks.
// ─────────────────────────────────────────────────────────────────────────
describe("S2 — pool and connection masks cover every credential field", () => {
  it("masks proxyUrl but leaves noProxy readable", async () => {
    const { maskProxyPoolForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyPoolForRead({
      id: "p1", name: "tokyo", proxyUrl: URL_WITH_CRED,
      noProxy: "localhost,127.0.0.1", type: "http", isActive: true,
    });
    expect(masked.proxyUrl).not.toContain(CRED);
    // noProxy is a bypass list, not a credential — masking it would hide
    // configuration the operator needs to read.
    expect(masked.noProxy).toBe("localhost,127.0.0.1");
    expect(masked.id).toBe("p1");
    expect(masked.name).toBe("tokyo");
  });

  it("masks every pool in a list, and passes a non-array through", async () => {
    const { maskProxyPoolsForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskProxyPoolsForRead([
      { id: "a", proxyUrl: URL_WITH_CRED },
      { id: "b", proxyUrl: `socks5://u2:${CRED}@203.0.113.8:1080` },
    ]);
    expect(masked).toHaveLength(2);
    for (const m of masked) expect(JSON.stringify(m)).not.toContain(CRED);
    expect(maskProxyPoolsForRead(null)).toBe(null);
  });

  it("drops every top-level credential and masks the nested legacy proxy url", async () => {
    const { maskConnectionForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const masked = maskConnectionForRead({
      id: "c1", provider: "openai", name: "conn",
      apiKey: "sk-plaintext-that-must-never-cross",
      accessToken: "at-secret", refreshToken: "rt-secret", idToken: "id-secret",
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: URL_WITH_CRED,
        connectionNoProxy: "localhost",
        keep: 1,
      },
    });
    for (const f of ["apiKey", "accessToken", "refreshToken", "idToken"]) {
      expect(masked).not.toHaveProperty(f);
    }
    expect(masked.providerSpecificData.connectionProxyUrl).not.toContain(CRED);
    expect(masked.providerSpecificData.connectionProxyEnabled).toBe(true);
    expect(masked.providerSpecificData.connectionNoProxy).toBe("localhost");
    expect(masked.providerSpecificData.keep).toBe(1);
    expect(JSON.stringify(masked)).not.toContain("sk-plaintext");
  });

  it("leaves a connection with no proxy url structurally untouched", async () => {
    const { maskConnectionForRead, maskConnectionProxyForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    const psd = { keep: 1 };
    // Returning the SAME reference (not a copy) matters: inventing a
    // connectionProxyUrl key on a connection that never had one would make
    // `hasLegacyProxy` in ConnectionsCard.js:42 truthy and render a phantom
    // proxy badge.
    expect(maskConnectionProxyForRead(psd)).toBe(psd);
    const masked = maskConnectionForRead({ id: "c2", providerSpecificData: psd });
    expect(masked.providerSpecificData).not.toHaveProperty("connectionProxyUrl");
  });

  it("does not emit a dedupe token on the wire", async () => {
    const { maskProxyPoolForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    // The first cut of this module emitted proxyUrlDedupeToken. It was dropped
    // before shipping: a bare sha256 is an offline brute-force oracle in the
    // hands of the row-B unauthenticated reader, and a keyed HMAC is one the
    // client cannot compute. If a token ever reappears, this test must fail so
    // the reasoning gets re-read rather than quietly re-added.
    const masked = maskProxyPoolForRead({ id: "p1", proxyUrl: URL_WITH_CRED });
    expect(Object.keys(masked)).not.toContain("proxyUrlDedupeToken");
    expect(Object.keys(masked)).not.toContain("proxyUrlHash");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S3 · Server-side duplicate detection — exact, on plaintext.
// ─────────────────────────────────────────────────────────────────────────
describe("S3 — findDuplicateProxyPool compares plaintext exactly", () => {
  const ROWS = [
    { id: "a", name: "one", proxyUrl: URL_WITH_CRED, noProxy: "" },
    { id: "b", name: "two", proxyUrl: URL_NO_CRED, noProxy: "" },
  ];

  it("finds an exact match ignoring surrounding whitespace", async () => {
    const { findDuplicateProxyPool } = await import("@/lib/db/repos/proxyRedaction.js");
    const hit = findDuplicateProxyPool(ROWS, `  ${URL_WITH_CRED}  `);
    expect(hit?.id).toBe("a");
  });

  it.each([
    ["different credential", `http://user1:otherpass@${HOST}:1080`],
    ["different host", `http://user1:${CRED}@203.0.113.99:1080`],
    ["different port", `http://user1:${CRED}@${HOST}:2080`],
    ["different scheme", `socks5://user1:${CRED}@${HOST}:1080`],
    ["the masked form of a stored url", `http://${HOST}:1080/`],
  ])("reports no duplicate for %s", async (_l, candidate) => {
    const { findDuplicateProxyPool } = await import("@/lib/db/repos/proxyRedaction.js");
    expect(findDuplicateProxyPool(ROWS, candidate)).toBeNull();
  });

  it.each([
    ["a non-array store", null, URL_WITH_CRED],
    ["a non-string candidate", ROWS, 42],
    ["an empty candidate", ROWS, ""],
    ["a whitespace-only candidate", ROWS, "   "],
  ])("returns null rather than throwing for %s", async (_l, store, candidate) => {
    const { findDuplicateProxyPool } = await import("@/lib/db/repos/proxyRedaction.js");
    expect(findDuplicateProxyPool(store, candidate)).toBeNull();
  });

  it("ignores rows with a malformed proxyUrl instead of throwing", async () => {
    const { findDuplicateProxyPool } = await import("@/lib/db/repos/proxyRedaction.js");
    expect(findDuplicateProxyPool([{ id: "x" }, { id: "y", proxyUrl: 5 }, ROWS[0]], URL_WITH_CRED)?.id).toBe("a");
  });

  it("builds a leak-safe 409 marker — no url, no stored row", async () => {
    const { duplicatePoolMarker } = await import("@/lib/db/repos/proxyRedaction.js");
    const body = duplicatePoolMarker(ROWS[0]);
    expect(body.error).toBe("PROXY_POOL_ALREADY_EXISTS");
    expect(body.existingPoolId).toBe("a");
    expect(body.existingPoolName).toBe("one");
    // The caller learns a duplicate exists and which row to inspect. It must not
    // learn the stored credential — the whole point of the mask.
    expect(JSON.stringify(body)).not.toContain(CRED);
    expect(JSON.stringify(body)).not.toContain(URL_WITH_CRED);
    expect(duplicatePoolMarker(null).existingPoolId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S4 · THE DESTROY-HAZARD — a PUT that omits proxyUrl must preserve the stored
//      plaintext. Proven through the real repo, write → update → read.
// ─────────────────────────────────────────────────────────────────────────
describe("S4 — masking a read cannot destroy the stored credential", () => {
  it("an omission-friendly update preserves the plaintext credential", { timeout: 20000 }, async () => {
    const { createProxyPool, updateProxyPool, getProxyPoolById } =
      await import("@/lib/db/repos/proxyPoolsRepo.js");

    const created = await createProxyPool({
      name: "tokyo", proxyUrl: URL_WITH_CRED, noProxy: "localhost",
      type: "http", isActive: true, strictProxy: false,
    });
    expect(created.proxyUrl).toBe(URL_WITH_CRED);

    // This is EXACTLY the `updates` object the PUT route builds when the operator
    // changes only the name: normalizeProxyPoolUpdate is hasOwnProperty-guarded
    // per field, so an absent proxyUrl never enters `updates`. (That function is
    // module-private to the route, so the route-level contract is proven in S5's
    // "PUT ... masks its response" case, which drives the real handler; this case
    // isolates the repo half — the merge.)
    const updates = { name: "tokyo-renamed", noProxy: "localhost", isActive: true, strictProxy: true };
    expect(updates).not.toHaveProperty("proxyUrl");

    await updateProxyPool(created.id, updates);

    const stored = await getProxyPoolById(created.id);
    expect(stored.name).toBe("tokyo-renamed");
    expect(stored.strictProxy).toBe(true);
    // THE assertion this whole section exists for: the merge kept the real
    // credential, because the key was never in `updates`.
    expect(stored.proxyUrl).toBe(URL_WITH_CRED);
    expect(stored.proxyUrl).toContain(CRED);
  });

  it("posting the MASKED value back would destroy the credential — proving the guard is load-bearing", { timeout: 20000 }, async () => {
    const { createProxyPool, updateProxyPool, getProxyPoolById } =
      await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");

    const created = await createProxyPool({
      name: "tokyo", proxyUrl: URL_WITH_CRED, type: "http", isActive: true,
    });

    // The failure mode S4 exists to prevent: a form that round-trips what it was
    // given. The merge accepts it silently — no error, no warning, and the pool
    // is now permanently broken (it will connect unauthenticated).
    const masked = maskProxyUrlForRead(URL_WITH_CRED);
    await updateProxyPool(created.id, { proxyUrl: masked });

    const stored = await getProxyPoolById(created.id);
    expect(stored.proxyUrl).not.toContain(CRED);
    expect(stored.proxyUrl).toBe(masked);
  });

  it("a typed replacement still lands", { timeout: 20000 }, async () => {
    const { createProxyPool, updateProxyPool, getProxyPoolById } =
      await import("@/lib/db/repos/proxyPoolsRepo.js");
    const created = await createProxyPool({ name: "n", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });
    const replacement = `socks5://user9:newpass@203.0.113.20:1080`;
    await updateProxyPool(created.id, { proxyUrl: replacement });
    expect((await getProxyPoolById(created.id)).proxyUrl).toBe(replacement);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S5 · The HTTP read boundary emits masked values — driven through the route.
// ─────────────────────────────────────────────────────────────────────────
describe("S5 — the proxy-pools routes never put a credential on the wire", () => {
  const mkReq = (url, init = {}) => new Request(url, init);

  it("GET /api/proxy-pools masks every pool, with and without includeUsage", { timeout: 20000 }, async () => {
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    await createProxyPool({ name: "tokyo", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });
    await createProxyPool({ name: "osaka", proxyUrl: `socks5://u2:${CRED}@203.0.113.8:1080`, type: "socks5", isActive: true });

    const route = await import("@/app/api/proxy-pools/route.js");
    for (const qs of ["", "?includeUsage=true"]) {
      const res = await route.GET(mkReq(`http://localhost/api/proxy-pools${qs}`));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(CRED);
      expect(text).not.toContain("user1:");
      const body = JSON.parse(text);
      expect(body.proxyPools).toHaveLength(2);
      // Host:port stays — it is what an operator reads to tell pools apart, and
      // it is not a credential.
      expect(text).toContain("203.0.113.7");
    }
  });

  it("GET /api/proxy-pools/[id] masks the single pool", { timeout: 20000 }, async () => {
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const created = await createProxyPool({ name: "tokyo", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });
    const route = await import("@/app/api/proxy-pools/[id]/route.js");
    const res = await route.GET(mkReq(`http://localhost/api/proxy-pools/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(CRED);
    expect(JSON.parse(text).proxyPool.id).toBe(created.id);
  });

  it("POST /api/proxy-pools masks its own response", { timeout: 20000 }, async () => {
    const route = await import("@/app/api/proxy-pools/route.js");
    const res = await route.POST(mkReq("http://localhost/api/proxy-pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new", proxyUrl: URL_WITH_CRED, type: "http" }),
    }));
    const text = await res.text();
    expect(res.status).toBe(201);
    // The creator typed this url, so nothing is hidden from them — but a
    // response can be logged, proxied, or replayed in devtools. The law is that
    // no credential crosses this boundary in either direction.
    expect(text).not.toContain(CRED);
  });

  it("POST /api/proxy-pools refuses a duplicate with a leak-safe 409", { timeout: 20000 }, async () => {
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    await createProxyPool({ name: "existing", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });

    const route = await import("@/app/api/proxy-pools/route.js");
    const post = (name) => route.POST(mkReq("http://localhost/api/proxy-pools", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, proxyUrl: URL_WITH_CRED, type: "http" }),
    }));

    const dup = await post("dupe");
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.error).toBe("PROXY_POOL_ALREADY_EXISTS");
    expect(JSON.stringify(body)).not.toContain(CRED);

    // A different url still creates — dedupe must not over-match.
    const ok = await route.POST(mkReq("http://localhost/api/proxy-pools", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "other", proxyUrl: URL_NO_CRED, type: "http" }),
    }));
    expect(ok.status).toBe(201);
  });

  it("PUT /api/proxy-pools/[id] masks its response and 409s onto another pool's url", { timeout: 20000 }, async () => {
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const a = await createProxyPool({ name: "a", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });
    await createProxyPool({ name: "b", proxyUrl: URL_NO_CRED, type: "http", isActive: true });

    const route = await import("@/app/api/proxy-pools/[id]/route.js");
    const put = (body) => route.PUT(mkReq(`http://localhost/api/proxy-pools/${a.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: a.id }) });

    // Editing onto b's url is a way around the POST check, so it must 409 too.
    const collide = await put({ proxyUrl: URL_NO_CRED });
    expect(collide.status).toBe(409);
    expect((await collide.json()).error).toBe("PROXY_POOL_ALREADY_EXISTS");

    // An edit that leaves proxyUrl ABSENT must not be compared against every
    // other pool — otherwise renaming a pool could 409 on its own stored url.
    const renamed = await put({ name: "a-renamed" });
    expect(renamed.status).toBe(200);
    const text = await renamed.text();
    expect(text).not.toContain(CRED);
    expect(JSON.parse(text).proxyPool.name).toBe("a-renamed");

    // And a genuine replacement is still allowed onto a free url.
    const moved = await put({ proxyUrl: `socks5://u3:p3@203.0.113.30:1080` });
    expect(moved.status).toBe(200);
    expect((await moved.text())).not.toContain("p3");
  });

  it("GET /api/providers/[id] masks the connection AND the nested legacy proxy url", { timeout: 20000 }, async () => {
    const { createProviderConnection } = await import("@/models");
    const created = await createProviderConnection({
      provider: "openai", authType: "apikey", name: "conn",
      apiKey: "sk-plaintext-that-must-never-cross",
      providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: URL_WITH_CRED },
    });

    const route = await import("@/app/api/providers/[id]/route.js");
    const res = await route.GET(mkReq(`http://localhost/api/providers/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("sk-plaintext");
    expect(text).not.toContain(CRED);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S6 · PLACEMENT — the repo stays plaintext, because the gateway dials with it.
// ─────────────────────────────────────────────────────────────────────────
describe("S6 — masking lives at the HTTP edge, never in the repo", () => {
  it("the repo returns the PLAINTEXT url (the gateway depends on it)", { timeout: 20000 }, async () => {
    const { createProxyPool, getProxyPools, getProxyPoolById } =
      await import("@/lib/db/repos/proxyPoolsRepo.js");
    const created = await createProxyPool({ name: "tokyo", proxyUrl: URL_WITH_CRED, type: "http", isActive: true });

    // Internal readers — proxyFleet (dispatcher construction + rotation),
    // connectionProxy (pool→proxyOptions resolution), poolEgressProbe, auth and
    // relayDeploy — build a dispatcher from these values. If anyone "tidies" the
    // masker into the repo, every proxied request breaks — or worse, silently falls
    // back to DIRECT egress, which is the exact wound LIVE-A caused. This is the
    // placement guard. No line numbers and no total: both drifted across this file's
    // drafts (the header records the corrections), and the grep that re-derives the set
    // lives up there.
    expect((await getProxyPoolById(created.id)).proxyUrl).toBe(URL_WITH_CRED);
    expect((await getProxyPools())[0].proxyUrl).toBe(URL_WITH_CRED);
  });

  it("the repo module does not import the masker", async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/lib/db/repos/sqlite/proxyPoolsRepo.js"), "utf8"
    );
    expect(src).not.toContain("proxyRedaction");
    expect(src).not.toContain("maskProxyPoolForRead");
  });
});
