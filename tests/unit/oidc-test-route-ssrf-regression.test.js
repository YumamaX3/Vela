// SECURITY REGRESSION (SRV-1, CRITICAL) — /api/auth/oidc/test must never be
// anonymously reachable, must never dial an internal host, and must never ship
// the stored IdP client secret to a caller-supplied issuer.
//
// The defect: canAccessTestRoute() returned `true` whenever
// settings.requireLogin === false, opening the route with NO credential in the
// no-login posture. The handler then fetched a caller-supplied issuerUrl and
// POSTed the STORED oidcClientSecret to whatever token_endpoint that URL's
// discovery document named — unauthenticated SSRF plus theft of the enterprise
// IdP client secret. dashboardGuard passes the whole /api/auth/oidc prefix via
// PUBLIC_API_PATHS, so this route's own gate was the only defence.
//
// These assertions cover all THREE legs. A test that only counted the gate
// would ratify a half-close — importing assertPublicUrl without ever calling it
// is exactly the failure mode the suite must be able to name.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROUTE = path.resolve("src/app/api/auth/oidc/test/route.js");
const source = fs.readFileSync(ROUTE, "utf8");

const gateStart = source.indexOf("async function canAccessTestRoute");
const handlerStart = source.indexOf("export async function POST");
const gate = source.slice(gateStart, handlerStart);
const handler = source.slice(handlerStart);

describe("SRV-1 · OIDC test route closes all three legs", () => {
  it("leg 0 — declares exactly ONE access gate (a duplicate would shadow it)", () => {
    const defs = source.match(/async function canAccessTestRoute/g) || [];
    expect(defs.length).toBe(1);
  });

  it("leg 0 — has no `requireLogin === false → open` bypass", () => {
    expect(source).not.toMatch(/requireLogin\s*===\s*false\s*\)\s*return\s+true/);
  });

  it("leg 0 — the gate requires a verified dashboard token, not a setting flag", () => {
    expect(gate).toMatch(/verifyDashboardAuthToken/);
  });

  it("leg 1 — CALLS the SSRF guard on the caller-supplied issuerUrl", () => {
    // The call must guard issuerUrl specifically. Counting the identifier would
    // ratify a fix that imports the guard and never invokes it.
    expect(handler).toMatch(/assertPublicUrl\s*\(\s*issuerUrl\s*\)/);
  });

  it("leg 1 — a blocked URL is refused with 400 before any fetch", () => {
    // The assert must precede the discovery fetch, or it guards nothing.
    const assertAt = handler.indexOf("assertPublicUrl");
    const fetchAt = handler.indexOf("fetchOidcDiscovery");
    expect(assertAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(fetchAt);
    expect(handler).toMatch(/catch\s*\{[\s\S]*?status:\s*400/);
  });

  it("leg 2 — never defaults the STORED secret to a non-configured issuer", () => {
    expect(source).toMatch(/probingConfiguredIssuer/);
    expect(source).toMatch(/issuerUrl\s*===\s*configuredIssuer/);
  });

  it("leg 2 — the refusal fires for the STORED secret, not a caller-supplied one", () => {
    // The guard must be scoped by `usingStoredSecret`: a caller probing their
    // OWN secret against their OWN issuer is the ordinary "test before you save"
    // flow and must keep working. Only the operator's stored credential is
    // protected — that is the theft this closes.
    expect(handler).toMatch(/usingStoredSecret\s*&&\s*!probingConfiguredIssuer/);
    expect(source).toMatch(/usingStoredSecret\s*=\s*!callerSuppliedSecret/);
  });
});