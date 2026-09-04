// Proxy Fleet Rebirth — milestone 1 (Security Closure), §5.5 + §5.5b
// The SSRF gate on pool proxyUrl, and the relay-deploy bypass it nearly missed.
//
// §5.5 — POST /api/proxy-pools and PUT /api/proxy-pools/[id] now judge operator-typed
//   proxyUrl through validateProxyPoolUrl BEFORE the duplicate check and before the
//   write. A pool URL is dialed on every proxied request, so it is the highest-leverage
//   operator-controlled fetch target in the gateway.
//
// §5.5b — the three relay deploy routes write pool.proxyUrl through persistRelayPool,
//   a DIFFERENT door than POST/PUT. deno-deploy interpolated operator projectName AND
//   orgSlug raw into `https://${projectName}.${orgSlug}.deno.net`; measured,
//   projectName="169.254.169.254/#" persisted a cloud-metadata pool. Fixed in two
//   layers: early slug validation per route (before any platform call, so a refusal
//   cannot orphan a live relay) + validateProxyPoolUrl at the persistRelayPool
//   chokepoint (so a fourth platform route cannot forget it).
//
// WHY A SEPARATE FUNCTION, NOT A FLAG ON validateProviderTestUrl — measured, not assumed:
//   • validateProviderTestUrl refuses socks5:// on its scheme gate (:275). Pools dial
//     socks5 (VALID_PROXY_TYPES, proxyFetch's Socks5ProxyAgent branch since v0.9.4, and
//     proxy-pools/route.js:3-9 records v0.9.42 specifically fixing socks5-pool creation).
//     Reusing it would re-open that wound.
//   • allowLocalLoopback is NOT a loopback exemption — it is a TOTAL bypass (:266 returns
//     before host judging AND the scheme gate, so 169.254.169.254 and file:///etc/passwd
//     both pass with the flag). Set by nobody in live source; §5.5 refuses to be its
//     first consumer.
//   • The exemption that matches the ADR's intent — literal loopback only, never the NAME
//     localhost — did not exist, so it is built here (isLiteralLoopbackHost).
//
// Every fixture uses TEST-NET-3 (203.0.113.0/24), example CGNAT (100.64/10), RFC1918
// examples, and the documented metadata IP 169.254.169.254 — never a live LAN or
// Tailscale value.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

// ── S1: the gate function itself ────────────────────────────────────────────
// validateProxyPoolUrl judged directly. No route, no DB — the law in isolation, so a
// failure here is the gate's, not a caller's.
describe("S1 — validateProxyPoolUrl: the pool gate's own law", () => {
  let validateProxyPoolUrl;
  beforeEach(async () => {
    ({ validateProxyPoolUrl } = await import("@/lib/network/providerUrlSafety.js"));
  });

  // The exemption the ADR asked for: literal loopback walks through.
  it("ALLOWS literal loopback — the Star's Clash 127.0.0.1:7890", () => {
    for (const url of [
      "http://127.0.0.1:7890", "socks5://127.0.0.1:7890", "https://127.0.0.1:7890",
      "socks5://[::1]:1080", "http://[::1]:7890",
    ]) {
      expect(validateProxyPoolUrl(url).ok, `${url} must be allowed (literal loopback)`).toBe(true);
    }
  });

  it("ALLOWS hostile spellings of loopback — the exemption cannot be dodged OR over-narrowed", () => {
    // These parse to 127.0.0.1 / ::1, so they are literal loopback and exempt. A gate
    // that string-matched "127.0.0.1" would refuse the operator's own valid shorthand
    // while a smarter attacker used 0x7f000001. Judging the NUMBER closes both.
    for (const url of ["http://127.1:7890", "http://0x7f000001:7890", "socks5://0x7f000001:1080", "http://017700000001:7890"]) {
      expect(validateProxyPoolUrl(url).ok, `${url} normalizes to loopback and must be allowed`).toBe(true);
    }
  });

  it("REFUSES the NAME localhost — DNS rebinding on the exempted class is killed", () => {
    // A literal cannot rebind; a name can. The ADR excludes hostnames from the exemption
    // for exactly this reason. Own refusal code so the operator gets an actionable
    // message ("use 127.0.0.1") rather than a generic "reserved range".
    for (const url of ["http://localhost:7890", "socks5://localhost:1080", "https://localhost"]) {
      const r = validateProxyPoolUrl(url);
      expect(r.ok, `${url} must be refused (a name can rebind)`).toBe(false);
      expect(r.code).toBe("loopback-name");
    }
  });

  it("REFUSES a bare 'localhost:7890' — the empty-hostname parser trap is closed", () => {
    // new URL("localhost:7890") does NOT throw — it parses "localhost:" as the SCHEME
    // with an EMPTY hostname, so a naive gate would never judge the host. The :// prefix
    // rule in validateProxyPoolUrl makes it judgeable, and it must then refuse.
    const r = validateProxyPoolUrl("localhost:7890");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("loopback-name");
  });

  it("ALLOWS RFC1918 / CGNAT / ULA — the homelab rationale, inherited not re-decided", () => {
    // The ADR's "RFC1918/CGNAT stay refused" sentence contradicts validateProviderTestUrl's
    // own documented policy (header :26-30) and the Star's live topology (LAN + Tailscale
    // proxies). The Star chose: allow them for pools. classifyIpv4/Ipv6 already do, so the
    // gate inherits it by delegating to judgeHost.
    for (const url of [
      "socks5://10.0.0.5:1080", "http://192.168.1.20:8080", "http://172.16.0.1:3128",
      "http://100.64.5.20:3128", "socks5://[fc00::1]:1080",
    ]) {
      expect(validateProxyPoolUrl(url).ok, `${url} is a legitimate homelab proxy`).toBe(true);
    }
  });

  it("ALLOWS public IPs and ordinary hostnames — including the relay deploy URLs", () => {
    // Relay pools persist https://<slug>.<org>.deno.net / .workers.dev / a vercel url.
    // Those are hostnames; refusing hostnames would break every relay deploy.
    for (const url of [
      "socks5://203.0.113.7:1080", "http://203.0.113.7:3128",
      "https://relay-a.example.workers.dev", "https://relay-1.acme.deno.net", "http://relay:8080",
    ]) {
      expect(validateProxyPoolUrl(url).ok, `${url} must be allowed`).toBe(true);
    }
  });

  it("REFUSES cloud metadata — the high-value SSRF target", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data", "socks5://169.254.169.254:1080",
      "http://[::ffff:169.254.169.254]/", "http://169.254.169.254",
    ]) {
      const r = validateProxyPoolUrl(url);
      expect(r.ok, `${url} must be refused (metadata)`).toBe(false);
      expect(r.code).toBe("blocked-range");
    }
  });

  it("REFUSES unspecified / link-local / documentation ranges", () => {
    for (const url of [
      "http://0.0.0.0:80", "socks5://[::]:1080", "http://[fe80::1]:80", "socks5://[2001:db8::1]:1080",
    ]) {
      expect(validateProxyPoolUrl(url).ok, `${url} must be refused`).toBe(false);
    }
  });

  it("REFUSES non-network schemes — file/gopher/data/javascript/ftp/socks", () => {
    // socks:// is refused on purpose: proxyFetch routes to Socks5ProxyAgent only on
    // /^socks5:\/\//i, so a socks:// pool reaches ProxyAgent and fails at dispatch time —
    // a row that saves and then cannot work. The gate judges schemes that actually dial.
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1:70", "data:text/plain,hi", "javascript:alert(1)", "ftp://203.0.113.7", "socks://127.0.0.1:1080"]) {
      const r = validateProxyPoolUrl(url);
      expect(r.ok, `${url} must be refused (scheme)`).toBe(false);
      expect(["scheme", "unparseable"]).toContain(r.code);
    }
  });

  it("REFUSES empty / missing / non-string without throwing", () => {
    // The invariant that matters is that NONE of these is accepted and none throws. The
    // specific refusal code legitimately varies, and pinning it was wrong the first time
    // I wrote this: `123` stringifies to a bare host that parseIpv4Literal reads as
    // 0.0.0.123 — inside the unspecified 0.0.0.0/8 block — so it refuses as
    // "blocked-range", which is CORRECT because it matches what the proxy stack would
    // actually dial (`http://123` → host 0.0.0.123). `{}` stringifies to "[object Object]"
    // which fails to parse. Both refuse; only the reason differs.
    //
    // `true` is deliberately NOT in this list: String(true) is "true", which prefixes to
    // http://true — and "true" is a legitimate single-label hostname, so the gate ALLOWS
    // it exactly as it allows http://relay:8080. Asserting a refusal there would be
    // asserting a bug that does not exist.
    for (const bad of ["", "   ", null, undefined, 123, {}, []]) {
      let r;
      expect(() => { r = validateProxyPoolUrl(bad); }, `${String(bad)} must not throw`).not.toThrow();
      expect(r.ok, `${String(bad)} must be refused`).toBe(false);
      expect(["unparseable", "blocked-range", "scheme"]).toContain(r.code);
    }
  });

  it("ALLOWS a single-label hostname — `true` stringifies to one, and that is correct", () => {
    // Pinned so nobody "fixes" the non-string refusal list by adding booleans and then
    // narrows the gate to dotted hosts only, which would break `http://relay:8080` — a
    // shape the product's own fixtures use.
    expect(validateProxyPoolUrl("http://relay:8080").ok).toBe(true);
    expect(validateProxyPoolUrl(true).ok).toBe(true);
  });

  it("ACCEPTS a bare host:port the way proxyFetch's normalizeProxyUrl does", () => {
    // proxyFetch tolerates "127.0.0.1:7890" (no scheme). The gate must agree, or an
    // operator who types the short form gets a 400 for something the proxy stack accepts.
    expect(validateProxyPoolUrl("127.0.0.1:7890").ok).toBe(true);
    expect(validateProxyPoolUrl("203.0.113.7:3128").ok).toBe(true);
    // And a bare metadata host:port is still refused (prefixed then judged).
    expect(validateProxyPoolUrl("169.254.169.254:80").ok).toBe(false);
  });

  it("REFUSES a userinfo-bearing URL that smuggles a blocked host", () => {
    // http://user@169.254.169.254 — the userinfo must not confuse the host judge.
    const r = validateProxyPoolUrl("http://operator:pw@169.254.169.254:1080");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("blocked-range");
  });
});

  it("calls judgeHost with allowLocal:false — defense-in-depth pinned by source guard", () => {
    // WHY A SOURCE GUARD, NOT A BEHAVIORAL TEST. A mutation harness flagged flipping
    // `allowLocal:false → true` here as VACUOUS (stayed green). Brute-force probe over
    // ~28 loopback-classified host spellings proved why: at THIS call site the parameter
    // is unreachable-as-loopback. judgeHost's allowLocal only changes its verdict when
    // classification === "loopback", and every loopback host is already short-circuited
    // above — IPv4 127/8 and IPv6 ::1 by the isLiteralLoopbackHost early-return, the name
    // "localhost" by the bare-check refusal. The only hosts that actually reach this
    // judgeHost call as "blocked" are 0.0.0.0/8 and metadata, which allowLocal does NOT
    // affect. So there is no behavior to assert; a behavioral test for a no-op is itself
    // a false green.
    //
    // It is still load-bearing as DEFENSE-IN-DEPTH: if a future edit removed the
    // `bare === "localhost"` refusal above, `allowLocal:false` would become the line that
    // keeps a rebinding name out. Pinning the literal makes that intent explicit and
    // turns the mutation red, so the depth is not silently lost.
    const src = readSrc("src/lib/network/providerUrlSafety.js");
    const fnStart = src.indexOf("export function validateProxyPoolUrl");
    expect(fnStart).toBeGreaterThan(-1);
    const fn = src.slice(fnStart, src.indexOf("\nexport function", fnStart + 10));
    expect(fn).toContain("judgeHost(hostname, { allowLocal: false })");
    // The raw-spelling re-check must ALSO be allowLocal:false — same depth on both passes.
    expect(fn).toContain("judgeHost(rawHost, { allowLocal: false })");
    expect(fn).not.toContain("allowLocal: true");
  });
describe("S2 — the relay slug validators: layer 1 of the deploy-route fix", () => {
  let validateRelaySlug, validateRelayOrgDomain;
  beforeEach(async () => {
    ({ validateRelaySlug, validateRelayOrgDomain } = await import("@/lib/network/relayDeploy.js"));
  });

  it("ADMITs the generated default and the dashboard's own presets", () => {
    // If the validator refused these, the deploy button would break for every operator.
    expect(validateRelaySlug(`relay-${Date.now().toString(36)}`).ok).toBe(true);
    expect(validateRelaySlug("vercel-relay").ok).toBe(true);
    expect(validateRelaySlug("cloudflare-relay").ok).toBe(true);
    expect(validateRelaySlug("my-relay").ok).toBe(true);
    expect(validateRelaySlug("vela-relay-1").ok).toBe(true);
    expect(validateRelaySlug("relay").ok).toBe(true);
    expect(validateRelaySlug("r1").ok).toBe(true);
  });

  it("REFUSES the exact injections that persisted a metadata pool", () => {
    // These are the measured §5.5b payloads. Each must fall at layer 1, before any
    // platform call, so no relay is orphaned.
    for (const bad of ["169.254.169.254/#", "evil.com/#", "evil.com/?", "127.0.0.1/#", "a/b"]) {
      expect(validateRelaySlug(bad).ok, `${bad} must be refused`).toBe(false);
    }
  });

  it("REFUSES uppercase, underscore, leading/trailing hyphen, and over-length", () => {
    for (const bad of ["Relay-One", "relay_one", "-relay", "relay-", "a".repeat(64), "relay name", "relay.name"]) {
      expect(validateRelaySlug(bad).ok, `${bad} must be refused`).toBe(false);
    }
    // 63 chars is the DNS-label max and must pass.
    expect(validateRelaySlug("a".repeat(63)).ok).toBe(true);
  });

  it("REFUSES empty / missing / non-string", () => {
    for (const bad of ["", "   ", null, undefined, 42]) {
      expect(validateRelaySlug(bad).ok).toBe(false);
    }
  });

  it("orgDomain: ADMITs a plain hostname, REFUSES the suffix-escape payloads", () => {
    expect(validateRelayOrgDomain("acme.deno.net").ok).toBe(true);
    expect(validateRelayOrgDomain("your-org.deno.net").ok).toBe(true);
    // The measured escapes: a "/" or "?" in the domain truncates the persisted authority.
    for (const bad of ["a/b.deno.net", "x?y.deno.net", "acme.deno.net#", "acme@evil.com"]) {
      expect(validateRelayOrgDomain(bad).ok, `${bad} must be refused`).toBe(false);
    }
  });

  it("orgDomain: REFUSES a single label and an empty value", () => {
    // A single label means split(".")[0] is the whole string with no org — not a domain
    // the platform resolves. Require >=2 labels so the caller's .split is meaningful.
    expect(validateRelayOrgDomain("acme").ok).toBe(false);
    expect(validateRelayOrgDomain("").ok).toBe(false);
    expect(validateRelayOrgDomain(null).ok).toBe(false);
  });
});

// ── S3: assertRelayProxyUrl (§5.5b layer 2 — the chokepoint) ────────────────
describe("S3 — assertRelayProxyUrl: layer 2, the chokepoint gate", () => {
  let assertRelayProxyUrl;
  beforeEach(async () => {
    ({ assertRelayProxyUrl } = await import("@/lib/network/relayDeploy.js"));
  });

  it("returns the URL for a legitimate relay host", () => {
    expect(assertRelayProxyUrl("https://relay-1.acme.deno.net")).toBe("https://relay-1.acme.deno.net");
    expect(assertRelayProxyUrl("https://relay-a.example.workers.dev")).toContain("relay-a");
  });

  it("THROWS with status 400 for a metadata-pointing URL", () => {
    // Layer 2 exists for the route that forgot layer 1. Even if a future platform route
    // skips slug validation, this gate stops a metadata pool reaching the DB.
    let caught = null;
    try { assertRelayProxyUrl("https://169.254.169.254/latest"); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(caught.status).toBe(400);
    expect(caught.code).toBe("blocked-range");
  });

  it("THROWS for a loopback-name and a non-network scheme", () => {
    expect(() => assertRelayProxyUrl("https://localhost:7890")).toThrow();
    expect(() => assertRelayProxyUrl("file:///etc/passwd")).toThrow();
  });

  it("does NOT throw for literal loopback (a loopback relay is legitimate)", () => {
    // The chokepoint uses the SAME gate as POST/PUT, so a 127.0.0.1 relay is allowed.
    expect(() => assertRelayProxyUrl("http://127.0.0.1:7890")).not.toThrow();
  });
});

// ── S4: persistRelayPool wires the chokepoint ───────────────────────────────
// The structural proof: persistRelayPool must call assertRelayProxyUrl on its proxyUrl
// BEFORE createProxyPool/updateProxyPool, and search adoption by the GATED url.
describe("S4 — persistRelayPool: the chokepoint is wired into the writers", () => {
  it("gates the url before persisting, and adopts by the gated url", () => {
    const src = readSrc("src/lib/network/relayDeploy.js");
    const fnStart = src.indexOf("export async function persistRelayPool");
    expect(fnStart, "persistRelayPool must exist").toBeGreaterThan(-1);
    // Slice to the NEXT top-level export, not a fixed char count. The first version sliced
    // a fixed 2000 chars, which ended before createProxyPool — so createAt was -1 and
    // `expect(491).toBeLessThan(-1)` FAILED. That was a correct red (a -1 makes the
    // comparison fail loudly, it does not silently pass), but for the wrong reason: the
    // slice, not the ordering. Bounding on the real function end makes every index real.
    const nextExport = src.indexOf("\n/** Find an existing pool", fnStart);
    const fn = src.slice(fnStart, nextExport === -1 ? fnStart + 4000 : nextExport);

    // The gate runs first. Each index is asserted found BEFORE the ordering comparison, so
    // a future refactor that moves createProxyPool out of this function reports "not
    // found" rather than an ordering failure that misnames the cause.
    const gateAt = fn.indexOf("assertRelayProxyUrl(proxyUrl)");
    const createAt = fn.indexOf("createProxyPool(fields)");
    const updateAt = fn.indexOf("updateProxyPool(");
    expect(gateAt, "must call assertRelayProxyUrl").toBeGreaterThan(-1);
    expect(createAt, "must call createProxyPool").toBeGreaterThan(-1);
    expect(updateAt, "must call updateProxyPool").toBeGreaterThan(-1);
    expect(gateAt, "gate must precede createProxyPool").toBeLessThan(createAt);
    expect(gateAt, "gate must precede updateProxyPool").toBeLessThan(updateAt);

    // fields persists the GATED url, not the raw input.
    expect(fn).toContain("proxyUrl: gatedUrl");
    // Adoption searches by the GATED url — searching by the raw input would miss a
    // re-deploy whose spelling normalizes, minting the orphan this fn prevents.
    expect(fn).toContain("findPoolByProxyUrl(gatedUrl)");
    expect(fn).not.toContain("findPoolByProxyUrl(proxyUrl)");
  });
});

// ── S5: the three deploy routes validate BEFORE their first platform call ───
// Source-order guards. The orphan hazard is real: a refusal AFTER the platform deploy
// leaves a live publicly-reachable relay with a minted secret and no pool row. So the
// validator call must precede the first `await fetch(` in each route.
describe("S5 — deploy routes: slug validation precedes the first platform call", () => {
  const ROUTES = {
    deno: "src/app/api/proxy-pools/deno-deploy/route.js",
    cloudflare: "src/app/api/proxy-pools/cloudflare-deploy/route.js",
    vercel: "src/app/api/proxy-pools/vercel-deploy/route.js",
  };

  it.each(Object.entries(ROUTES))("%s validates the slug before its first fetch", (name, file) => {
    const src = readSrc(file);
    const slugAt = src.indexOf("validateRelaySlug(");
    const firstFetch = src.indexOf("await fetch(");
    expect(slugAt, `${name} must call validateRelaySlug`).toBeGreaterThan(-1);
    expect(firstFetch, `${name} must have a platform fetch`).toBeGreaterThan(-1);
    // The validation must come first, or a refusal orphans a deployed relay.
    expect(slugAt, `${name}: slug validation must precede the first platform call`).toBeLessThan(firstFetch);
  });

  it("deno ALSO validates orgDomain before its first fetch", () => {
    const src = readSrc(ROUTES.deno);
    const orgAt = src.indexOf("validateRelayOrgDomain(");
    const firstFetch = src.indexOf("await fetch(");
    expect(orgAt, "deno must validate orgDomain").toBeGreaterThan(-1);
    expect(orgAt).toBeLessThan(firstFetch);
  });

  it("each deploy route imports its validator from relayDeploy", () => {
    for (const [name, file] of Object.entries(ROUTES)) {
      const src = readSrc(file);
      expect(src, `${name} must import validateRelaySlug`).toContain("validateRelaySlug");
      expect(src, `${name} must import from relayDeploy`).toContain('from "@/lib/network/relayDeploy.js"');
    }
  });

  it("deno and cloudflare do NOT interpolate raw body.projectName into deployUrl anymore", () => {
    // The regression this whole subsection exists to prevent: a route that derives
    // projectName straight from the body and interpolates it. After the fix, projectName
    // is the VALIDATED slug (slugCheck.slug), so the interpolated value is already safe.
    for (const name of ["deno", "cloudflare"]) {
      const src = readSrc(ROUTES[name]);
      expect(src).toContain("const projectName = slugCheck.slug");
      // The raw `body.projectName?.trim() || ...` must feed the VALIDATOR, not bind
      // projectName directly.
      expect(src).not.toMatch(/const projectName = body\.projectName/);
    }
  });
});

// ── S6: POST/PUT routes wire the §5.5 gate ──────────────────────────────────
describe("S6 — POST/PUT routes call validateProxyPoolUrl before the write", () => {
  const CREATE = "src/app/api/proxy-pools/route.js";
  const UPDATE = "src/app/api/proxy-pools/[id]/route.js";

  it("POST gates proxyUrl before the duplicate check and createProxyPool", () => {
    const src = readSrc(CREATE);
    const gateAt = src.indexOf("validateProxyPoolUrl(");
    const dupAt = src.indexOf("findDuplicateProxyPool(");
    const createAt = src.indexOf("createProxyPool(");
    expect(gateAt, "POST must call validateProxyPoolUrl").toBeGreaterThan(-1);
    // Gate precedes the duplicate comparison (an invalid url must not disclose whether a
    // matching pool exists) and the write.
    expect(gateAt).toBeLessThan(dupAt);
    expect(gateAt).toBeLessThan(createAt);
  });

  it("PUT gates only when proxyUrl is actually present, before the write", () => {
    const src = readSrc(UPDATE);
    const gateAt = src.indexOf("validateProxyPoolUrl(");
    const updateAt = src.indexOf("updateProxyPool(id");
    expect(gateAt, "PUT must call validateProxyPoolUrl").toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(updateAt);
    // The omission-friendly guard: a PUT that leaves proxyUrl absent must NOT re-judge a
    // stored value (which could lock out editing a pool created before this gate).
    expect(src).toMatch(/hasOwnProperty\.call\(normalized\.updates, "proxyUrl"\)/);
  });

  it("both routes surface the refusal as a 400 with the message", () => {
    for (const file of [CREATE, UPDATE]) {
      const src = readSrc(file);
      expect(src).toContain("gate.ok");
      expect(src).toContain("status: 400");
    }
  });
});
