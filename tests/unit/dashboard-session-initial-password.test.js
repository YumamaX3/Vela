// CLI Rebirth M0 Tag 1 — the initial/default password fallback compare is
// constant-time (house pattern: SHA-256 digests, length-check-first). Wrong
// lengths must reject gracefully, never throw. The bcrypt path for stored
// hashes stays untouched.
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

describe("verifyDashboardPassword — initial password fallback (constant-time)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({}); // no stored hash → fallback path
    delete process.env.INITIAL_PASSWORD;
  });

  afterEach(() => {
    delete process.env.INITIAL_PASSWORD;
  });

  it("accepts the DEFAULT_PASSWORD when no stored hash exists", async () => {
    await expect(verifyDashboardPassword("123456")).resolves.toBe(true);
  });

  it("rejects a wrong password on the fallback path", async () => {
    await expect(verifyDashboardPassword("wrong-password")).resolves.toBe(false);
  });

  it("rejects a wrong-length password gracefully (no throw)", async () => {
    await expect(verifyDashboardPassword("1")).resolves.toBe(false);
    await expect(verifyDashboardPassword("1234567890-much-longer")).resolves.toBe(false);
  });

  it("rejects absent/empty passwords gracefully", async () => {
    await expect(verifyDashboardPassword("")).resolves.toBe(false);
    await expect(verifyDashboardPassword(undefined)).resolves.toBe(false);
  });

  it("honors INITIAL_PASSWORD when set", async () => {
    process.env.INITIAL_PASSWORD = "correct-horse-battery";

    await expect(verifyDashboardPassword("correct-horse-battery")).resolves.toBe(true);
    await expect(verifyDashboardPassword("wrong-horse")).resolves.toBe(false);
  });

  it("still uses the bcrypt path when a stored hash exists", async () => {
    mocks.getSettings.mockResolvedValue({ password: bcrypt.hashSync("s3cret-pass", 10) });

    await expect(verifyDashboardPassword("s3cret-pass")).resolves.toBe(true);
    await expect(verifyDashboardPassword("other-pass")).resolves.toBe(false);
    // bcrypt.compare handles wrong lengths itself — no throw either way.
    await expect(verifyDashboardPassword("x")).resolves.toBe(false);
  });
});
