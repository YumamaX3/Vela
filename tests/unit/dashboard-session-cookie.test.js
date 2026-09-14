/**
 * M0-4 cookie fix (ADR-004, upstream 628ff1ea rebased): the dashboard session
 * cookie must carry maxAge so its window matches the JWT's 24h exp. Pre-fix the
 * JWT died at 24h while the cookie lived for the browser's lifetime — a jar
 * holding a token that can only fail.
 *
 * Vela exceed over upstream: BOTH windows now derive from SESSION_MAX_AGE_SEC,
 * so they cannot drift. The second case pins the drift guard — mint a token,
 * decode its exp, and require it to sit at now + the shared window (±60s for
 * clock jitter across the sign call).
 *
 * JWT_SECRET is pinned so loadJwtSecret never touches a real DATA_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalSecret = process.env.JWT_SECRET;
beforeAll(() => {
  process.env.JWT_SECRET = "cookie-maxage-test-secret";
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const mod = await import("../../src/lib/auth/dashboardSession.js");
const { setDashboardAuthCookie, AUTH_COOKIE_NAME, SESSION_MAX_AGE_SEC } = mod;

function fakeCookieStore() {
  const calls = [];
  return {
    calls,
    set(name, value, options) {
      calls.push({ name, value, options });
    },
    delete() {},
  };
}

const req = new Request("http://localhost:32060/dashboard");

describe("dashboard session cookie lifecycle (ADR-004 M0-4)", () => {
  it("sets maxAge pinned to the session window, alongside the hardened flags", async () => {
    const store = fakeCookieStore();
    await setDashboardAuthCookie(store, req, { loginMethod: "password" });
    expect(store.calls).toHaveLength(1);
    const { name, options } = store.calls[0];
    expect(name).toBe(AUTH_COOKIE_NAME);
    expect(options.maxAge).toBe(SESSION_MAX_AGE_SEC);
    expect(options.maxAge).toBe(86400); // 24h — upstream 628ff1ea parity
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("the JWT's own exp sits at now + SESSION_MAX_AGE_SEC — one source for both windows", async () => {
    const store = fakeCookieStore();
    const before = Math.floor(Date.now() / 1000);
    await setDashboardAuthCookie(store, req);
    const after = Math.floor(Date.now() / 1000);
    // Decode the signed token's payload (base64url, no verify needed — we only
    // read the claim we just set).
    const [, payloadB64] = store.calls[0].value.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp).toBeGreaterThanOrEqual(before + SESSION_MAX_AGE_SEC);
    expect(payload.exp).toBeLessThanOrEqual(after + SESSION_MAX_AGE_SEC);
    // Regression pin: a raw *number* passed to jose setExpirationTime is an
    // absolute epoch date (Jan 1970), not a span. exp > now is the proof the
    // Date form is used.
    expect(payload.exp).toBeGreaterThan(after);
  });
});
