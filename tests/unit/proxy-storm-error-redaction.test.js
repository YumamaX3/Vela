// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.4 error path
// The operator's proxy credential must never leave the process inside an error message.
//
// THE LEAK, MEASURED (not assumed from the ADR)
// proxyFetch.js's getDispatcher composed `unsupported proxy scheme for ${normalized}`
// where `normalized` is the FULL proxy URL, userinfo included. The ADR §5.4 traced it
// one hop — to poolEgressProbe.js:142's console.warn. It travels further:
//
//   proxyFetch.js throw (with user:password@)
//     → :489/:511 the strictProxy wrapper re-throws, interpolating proxyError.message
//     → combo.js:480  lastError = error.message || String(error)
//     → combo.js:492  const msg = lastError
//     → combo.js:501  new Response(JSON.stringify({ error: { message: msg } }), …)
//
// So an operator's proxy password lands in an HTTP response body handed to EVERY
// authenticated /v1 client that triggers the failure. That crosses a privilege
// boundary the console path does not: clients are authorized to USE the gateway,
// never to see its upstream plumbing.
//
// FIX AT THE ORIGIN, NOT THE SINK. `catch (error) { msg = error.message }` is a funnel
// with N consumers today and more tomorrow; masking each sink is a losing race.
//
// DELIBERATELY NOT DONE — wrapping the dispatcher constructors. Probed 7 malformed
// URL shapes × 2 constructors (14 cases): undici throws a generic "Invalid URL" or an
// InvalidArgumentError naming the protocol, and NEVER echoes the input into .message
// or .cause.message (it survives only on err.input, which getErrorMessage never
// reads). A guard there would protect a hazard that does not exist — and no test
// could prove it works, because removing it would leave this suite green. An
// untestable guard is a false green wearing armour. See the in-source comment.
//
// THE SECOND OBLIGATION — do not over-mask. `normalized` is BOTH the message source
// AND the dispatcher cache key AND the constructor argument. The last two need the
// real credentials to authenticate upstream. Masking the variable instead of the
// interpolation would silently break every authenticated proxy. S3 pins that.
//
// Every fixture uses TEST-NET-3 (203.0.113.0/24) and example credentials only —
// never a live LAN, Tailscale, or real proxy value.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PASSWORD = "hunter2-example";
const USER = "operator";
const HOSTPORT = "203.0.113.7:1080";
const SOCKS_WITH_CREDS = `socks5://${USER}:${PASSWORD}@${HOSTPORT}`;
const TARGET = "https://api.openai.com/v1/chat/completions";

const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

beforeEach(() => { vi.resetModules(); });
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("undici");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Import proxyFetch with undici's agents REMOVED, so getDispatcher takes the
 * `unsupported proxy scheme` throw — the leaking path — without needing a real
 * undici build that lacks Socks5ProxyAgent.
 *
 * The exports are present-but-undefined ON PURPOSE. `vi.doMock("undici", () => ({}))`
 * makes the property ACCESS itself throw vitest's own "No export is defined on the
 * mock" error, so `if (!Socks5ProxyAgent)` never runs and the code under test is
 * never reached. That made every assertion below pass for the wrong reason — vitest's
 * error message contains no password, so `not.toContain(PASSWORD)` was satisfied by
 * an error that had nothing to do with the fix. A green test that never executed the
 * code is worse than a red one.
 */
async function importWithMissingAgents() {
  vi.doMock("undici", () => ({ Socks5ProxyAgent: undefined, ProxyAgent: undefined }));
  return import("open-sse/utils/proxyFetch.js");
}

/**
 * Assert which error path actually ran, so a mock/runtime error can never silently
 * satisfy the masking assertions. Every S1/S2 test calls this on the composed text.
 */
function expectUnsupportedSchemePath(text) {
  expect(text, "the masking path must be the one exercised").toContain("unsupported proxy scheme");
}

/** Import proxyFetch with recording fake agents, to observe what reaches the ctor. */
async function importWithRecordingAgents() {
  const calls = { socks5: [], proxy: [] };
  vi.doMock("undici", () => ({
    Socks5ProxyAgent: class {
      constructor(url) { calls.socks5.push(url); this.closed = false; }
      async close() { this.closed = true; }
    },
    ProxyAgent: class {
      constructor(opts) { calls.proxy.push(opts?.uri); this.closed = false; }
      async close() { this.closed = true; }
    },
  }));
  const mod = await import("open-sse/utils/proxyFetch.js");
  return { mod, calls };
}

const proxied = (url, extra = {}) => ({
  connectionProxyEnabled: true,
  connectionProxyUrl: url,
  ...extra,
});

describe("S1 — the warn path (poolEgressProbe's console.warn, the ADR's named hop)", () => {
  it("the fallback warn carries NO password", { timeout: 20000 }, async () => {
    const warns = [];
    vi.spyOn(console, "warn").mockImplementation((...a) => warns.push(a.map(String).join(" ")));
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));

    const { proxyAwareFetch } = await importWithMissingAgents();
    await proxyAwareFetch(TARGET, {}, proxied(SOCKS_WITH_CREDS));

    const text = warns.join("\n");
    // Prove the masking path actually ran BEFORE asserting what it masked — otherwise
    // a vitest mock error or an undici TypeError would satisfy every not.toContain
    // below without touching the code under test.
    expectUnsupportedSchemePath(text);
    // The leak: the password must not appear anywhere in the logged output.
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(`${USER}:${PASSWORD}`);
    expect(text).not.toContain("@");
    // …and the warn still happened — we did not silence the failure, only masked it.
    expect(text).toContain("[ProxyFetch] Proxy failed");
  });

  it("the masked URL still IDENTIFIES the pool — host:port survives", { timeout: 20000 }, async () => {
    // maskProxyUrlForRead's whole purpose: keep the identifying part so an operator
    // can tell pools apart. A redaction that blanked the URL would be useless for
    // diagnosis and would tempt someone to remove it.
    const warns = [];
    vi.spyOn(console, "warn").mockImplementation((...a) => warns.push(a.map(String).join(" ")));
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));

    const { proxyAwareFetch } = await importWithMissingAgents();
    await proxyAwareFetch(TARGET, {}, proxied(SOCKS_WITH_CREDS));

    const text = warns.join("\n");
    expectUnsupportedSchemePath(text);
    expect(text).toContain(HOSTPORT);
    expect(text).toContain("socks5://");
    expect(text).not.toContain(PASSWORD);
  });

  it("a userinfo-free proxy URL is untouched — no collateral masking", { timeout: 20000 }, async () => {
    const warns = [];
    vi.spyOn(console, "warn").mockImplementation((...a) => warns.push(a.map(String).join(" ")));
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));

    const bare = `socks5://${HOSTPORT}`;
    const { proxyAwareFetch } = await importWithMissingAgents();
    await proxyAwareFetch(TARGET, {}, proxied(bare));

    const text = warns.join("\n");
    expectUnsupportedSchemePath(text);
    // There was never a secret, so the full URL stays — an operator debugging a
    // credential-less pool sees exactly what they configured.
    expect(text).toContain(bare);
    expect(text).not.toContain("[REDACTED]");
  });
});

describe("S2 — the strictProxy throw path (the one that reaches an API CLIENT)", () => {
  it("the thrown error.message carries NO password", { timeout: 20000 }, async () => {
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));
    const { proxyAwareFetch } = await importWithMissingAgents();

    let caught = null;
    try {
      await proxyAwareFetch(TARGET, {}, proxied(SOCKS_WITH_CREDS, { strictProxy: true }));
    } catch (e) { caught = e; }

    // strictProxy must still FAIL HARD — masking is not swallowing. The behaviour
    // change in v0.9.44's LIVE-A class was a silent direct fallback; this asserts the
    // throw survives.
    expect(caught).toBeTruthy();
    expectUnsupportedSchemePath(caught.message);
    expect(caught.message).toContain("strictProxy=true");
    expect(caught.message).toContain(HOSTPORT);
    // The leak that travelled to combo.js:501 and out to the client.
    expect(caught.message).not.toContain(PASSWORD);
    expect(caught.message).not.toContain(USER);
    expect(caught.message).not.toContain("@");
  });

  it("the http(s) branch masks identically — both throws, not just socks5", { timeout: 20000 }, async () => {
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));
    const { proxyAwareFetch } = await importWithMissingAgents();

    // The ProxyAgent branch is the one most pools use; masking only socks5 would
    // leave the common case leaking.
    let caught = null;
    try {
      await proxyAwareFetch(TARGET, {}, proxied(`https://${USER}:${PASSWORD}@${HOSTPORT}`, { strictProxy: true }));
    } catch (e) { caught = e; }

    expect(caught).toBeTruthy();
    expectUnsupportedSchemePath(caught.message);
    expect(caught.message).toContain(HOSTPORT);
    expect(caught.message).not.toContain(PASSWORD);
    expect(caught.message).not.toContain("@");
  });

  it("the error survives String(err) — combo.js:480's fallback branch", { timeout: 20000 }, async () => {
    // combo.js:480 is `lastError = error.message || String(error)`. Both operands
    // must be clean, or the fallback re-opens the leak.
    vi.stubGlobal("fetch", async () => new Response("DIRECT", { status: 200 }));
    const { proxyAwareFetch } = await importWithMissingAgents();

    let caught = null;
    try {
      await proxyAwareFetch(TARGET, {}, proxied(SOCKS_WITH_CREDS, { strictProxy: true }));
    } catch (e) { caught = e; }

    expectUnsupportedSchemePath(String(caught));
    expect(String(caught)).not.toContain(PASSWORD);
    expect(JSON.stringify({ message: caught.message })).not.toContain(PASSWORD);
  });
});

describe("S3 — do NOT over-mask: the constructor still receives real credentials", () => {
  it("Socks5ProxyAgent gets the FULL url — masking the variable would break auth", { timeout: 20000 }, async () => {
    vi.stubGlobal("fetch", async () => new Response("UPSTREAM", { status: 200 }));
    const { mod, calls } = await importWithRecordingAgents();

    await mod.proxyAwareFetch(TARGET, {}, proxied(SOCKS_WITH_CREDS));

    expect(calls.socks5.length).toBe(1);
    // POSITIONAL argument (the v0.9.44 LIVE-A fix) AND unmasked: the proxy needs the
    // credentials to authenticate. If a future edit masks `normalized` instead of the
    // message interpolation, this goes red.
    expect(calls.socks5[0]).toBe(SOCKS_WITH_CREDS);
    expect(calls.socks5[0]).toContain(PASSWORD);
  });

  it("ProxyAgent gets the FULL uri — same obligation on the http(s) branch", { timeout: 20000 }, async () => {
    vi.stubGlobal("fetch", async () => new Response("UPSTREAM", { status: 200 }));
    const { mod, calls } = await importWithRecordingAgents();

    const httpsCreds = `https://${USER}:${PASSWORD}@${HOSTPORT}`;
    await mod.proxyAwareFetch(TARGET, {}, proxied(httpsCreds));

    expect(calls.proxy.length).toBe(1);
    expect(calls.proxy[0]).toBe(httpsCreds);
    expect(calls.proxy[0]).toContain(PASSWORD);
  });

  it("the dispatcher CACHE KEY is the full url — masked keys would collide", { timeout: 20000 }, async () => {
    vi.stubGlobal("fetch", async () => new Response("UPSTREAM", { status: 200 }));
    const { mod, calls } = await importWithRecordingAgents();

    // Two pools differing ONLY by credentials. If the cache key were masked, both
    // would hash to the same entry and the second would silently reuse the first
    // pool's dispatcher — connecting with the WRONG credentials.
    await mod.proxyAwareFetch(TARGET, {}, proxied(`socks5://alice:pw-one@${HOSTPORT}`));
    await mod.proxyAwareFetch(TARGET, {}, proxied(`socks5://bob:pw-two@${HOSTPORT}`));

    expect(calls.socks5.length).toBe(2);
    expect(calls.socks5[0]).toContain("pw-one");
    expect(calls.socks5[1]).toContain("pw-two");
  });

  it("the SAME proxy url REUSES its dispatcher — a masked key would construct one per request", { timeout: 20000 }, async () => {
    // This is the observation the test above cannot make, and a mutation harness
    // proved the gap: keying set()/get() on `safeUrl` while has() still checks
    // `normalized` makes the cache NEVER HIT. Both fetches above then construct, so
    // `calls.socks5.length === 2` holds under the mutation too and the test stayed
    // green — while production built a fresh dispatcher per request.
    //
    // A dispatcher owns a connection pool and its sockets; one per request is exactly
    // the fd leak the v0.9.42 eviction-close comment documents. Reuse is the
    // assertion that catches it.
    vi.stubGlobal("fetch", async () => new Response("UPSTREAM", { status: 200 }));
    const { mod, calls } = await importWithRecordingAgents();

    const url = SOCKS_WITH_CREDS;
    await mod.proxyAwareFetch(TARGET, {}, proxied(url));
    await mod.proxyAwareFetch(TARGET, {}, proxied(url));
    await mod.proxyAwareFetch(TARGET, {}, proxied(url));

    // Three requests, ONE dispatcher constructed — the cache hit twice.
    expect(calls.socks5.length).toBe(1);
    expect(calls.socks5[0]).toBe(url);
  });
});

describe("S4 — source guards: the fix cannot be silently undone", () => {
  it("neither throw interpolates the raw normalized url", { timeout: 20000 }, async () => {
    const src = readSrc("open-sse/utils/proxyFetch.js");
    // The exact regressed shape. If someone reverts to `${normalized}` in either
    // unsupported-scheme throw, this goes red.
    expect(src).not.toContain("unsupported proxy scheme for ${normalized}");
    expect(src).toContain("unsupported proxy scheme for ${safeUrl}");
    // Both branches masked, not just one.
    const masked = src.split("unsupported proxy scheme for ${safeUrl}").length - 1;
    expect(masked).toBe(2);
  });

  it("safeUrl is derived from maskProxyUrlForRead — the existing §5.4 seam", { timeout: 20000 }, async () => {
    // ADR §5.4: "extend the existing seam, do not invent one." A hand-rolled regex
    // masker here would be a second source of truth for redaction.
    const src = readSrc("open-sse/utils/proxyFetch.js");
    // Specifier-spelling agnostic: the law is that the masker comes FROM
    // proxyRedaction.js, by alias or by relative path.
    expect(src).toMatch(
      /import\s*\{\s*maskProxyUrlForRead\s*\}\s*from\s*"(?:@\/lib\/db\/repos\/|\.\.\/\.\.\/src\/lib\/db\/repos\/)proxyRedaction\.js"/
    );
    expect(src).toContain("const safeUrl = maskProxyUrlForRead(normalized)");
    // No competing local masker.
    expect(src).not.toMatch(/function\s+mask\w*Proxy\w*\s*\(/);
  });

  it("imports proxyRedaction RELATIVELY, never via the @/ alias", { timeout: 20000 }, async () => {
    // v0.9.45 — a regression guard earned the hard way. This file's first draft used
    // `@/lib/db/repos/proxyRedaction.js`, reasoning that open-sse already imports
    // `@/lib/usageDb` six times. That reasoning held for those six (db modules reached
    // through vite's transform) and FAILED here, because proxyFetch.js is also loadable
    // through Node's native ESM: tests/unit/reasoningContentInjector.test.js builds a
    // graph that reparses open-sse/executors/base.js as an ES module, never consults
    // vite's alias table, and died at import time with
    //   Cannot find package '@/lib' imported from open-sse/utils/proxyFetch.js
    // That suite passed at pristine HEAD and failed on this change — a real regression
    // caught by the whole-directory blast-radius diff, not by this storm.
    // proxyFetch.js is the engine's most-mocked module (25 suites); pinning its import
    // shape to a build tool was the wrong trade. The same law covers relayTemplate.js.
    const src = readSrc("open-sse/utils/proxyFetch.js");
    for (const mod of ["proxyRedaction", "relayTemplate"]) {
      const aliased = src.match(new RegExp(`from\\s*"@/[^"]*${mod}\\.js"`));
      expect(aliased, `${mod} must not be imported via the @/ alias`).toBeNull();
      const relative = src.match(new RegExp(`from\\s*"\\.\\./\\.\\./src/[^"]*${mod}\\.js"`));
      expect(relative, `${mod} must be imported relatively`).not.toBeNull();
    }
  });

  it("proxyRedaction.js stays a PURE module — the gateway must not gain weight", { timeout: 20000 }, async () => {
    // proxyFetch is on every proxied request. Importing a module that itself pulls in
    // the DB driver would drag SQLite/undici init into the hot path.
    const src = readSrc("src/lib/db/repos/proxyRedaction.js");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\s*\(/);
  });

  it("maskProxyUrlForRead's contract holds on the shapes this path produces", { timeout: 20000 }, async () => {
    const { maskProxyUrlForRead } = await import("@/lib/db/repos/proxyRedaction.js");
    // Credential-bearing → host kept, credential gone.
    const masked = maskProxyUrlForRead(SOCKS_WITH_CREDS);
    expect(masked).toContain(HOSTPORT);
    expect(masked).not.toContain(PASSWORD);
    expect(masked).not.toContain(USER);
    // Credential-free → unchanged (no collateral damage).
    expect(maskProxyUrlForRead(`socks5://${HOSTPORT}`)).toBe(`socks5://${HOSTPORT}`);
    // Unparseable WITH a userinfo shape → whole-value redaction, never a fragment.
    const unparseable = `socks5://${USER}:${PASSWORD}@not a url`;
    const red = maskProxyUrlForRead(unparseable);
    expect(red).not.toContain(PASSWORD);
    expect(red === "[REDACTED]" || !red.includes(PASSWORD)).toBe(true);
  });
});
