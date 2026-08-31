// CLI Rebirth M0 — Tag 1 established constant-time compare for the fallback
// path; Tag 3 RETIRED the "123456" default entirely. What remains: an unset
// password never authenticates (any origin / any caller), INITIAL_PASSWORD
// env still works through the constant-time fallback, and the bcrypt path
// for stored hashes stays untouched. Wrong lengths must reject gracefully,
// never throw.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/dataDir", () => ({ DATA_DIR: "/tmp/vela-test-no-such-dir" }));

// JWT_SECRET must exist before the module's loadJwtSecret runs, so the
// session module never touches the real DATA_DIR.
process.env.JWT_SECRET = "test-jwt-secret";

const { verifyDashboardPassword } = await import("../../src/lib/auth/dashboardSession.js");

describe("verifyDashboardPassword — retired default password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({}); // no stored hash
    delete process.env.INITIAL_PASSWORD;
  });

  afterEach(() => {
    delete process.env.INITIAL_PASSWORD;
  });

  it("no longer authenticates with the retired 123456 default", async () => {
    await expect(verifyDashboardPassword("123456")).resolves.toBe(false);
  });

  it("rejects any password when nothing is configured", async () => {
    await expect(verifyDashboardPassword("wrong-password")).resolves.toBe(false);
    await expect(verifyDashboardPassword("1")).resolves.toBe(false);
    await expect(verifyDashboardPassword("1234567890-much-longer")).resolves.toBe(false);
  });

  it("rejects absent/empty passwords gracefully", async () => {
    await expect(verifyDashboardPassword("")).resolves.toBe(false);
    await expect(verifyDashboardPassword(undefined)).resolves.toBe(false);
  });

  it("honors INITIAL_PASSWORD when set (constant-time compare)", async () => {
    process.env.INITIAL_PASSWORD = "correct-horse-battery";

    await expect(verifyDashboardPassword("correct-horse-battery")).resolves.toBe(true);
    await expect(verifyDashboardPassword("wrong-horse")).resolves.toBe(false);
    // Wrong-length guesses reject gracefully on the constant-time path.
    await expect(verifyDashboardPassword("1")).resolves.toBe(false);
    await expect(verifyDashboardPassword("correct-horse-battery-extra")).resolves.toBe(false);
  });

  it("still uses the bcrypt path when a stored hash exists", async () => {
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("s3cret-pass", 10) });

    await expect(verifyDashboardPassword("s3cret-pass")).resolves.toBe(true);
    await expect(verifyDashboardPassword("other-pass")).resolves.toBe(false);
    // bcrypt.compare handles wrong lengths itself — no throw either way.
    await expect(verifyDashboardPassword("x")).resolves.toBe(false);
  });
});
