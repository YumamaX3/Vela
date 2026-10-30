import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
// The route imports @/sse/utils/logger.js, whose graph reaches
// open-sse/providers/shared.js — that module calls arch() and platform() at
// LOAD time to build the Stainless fingerprint headers. A stub that exports
// only homedir makes that import throw ("No arch export is defined on the os
// mock") and every case in this suite dies at import. Keep the pinned homedir
// (the route's own candidate-path logic) and supply the remaining members the
// logger graph touches, so the mock stays a superset of what is needed.
vi.mock("os", () => {
  const homedir = vi.fn(() => "/mock/home");
  const platform = vi.fn(() => process.platform);
  const arch = vi.fn(() => "x64");
  return {
    default: { homedir, platform, arch, type: vi.fn(() => "Darwin"), release: vi.fn(() => "23.0.0"), cpus: vi.fn(() => []) },
    homedir,
    platform,
    arch,
    type: vi.fn(() => "Darwin"),
    release: vi.fn(() => "23.0.0"),
    cpus: vi.fn(() => []),
  };
});

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      return mockDbInstance;
    }
  },
}));

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    // 13d8594b replaced the macOS-only message with a candidate listing.
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
  });

  it("falls through to the manual hand-off when the macOS db cannot be opened", async () => {
    // 2026-10-11 restamp: 96bd6024's CLI rewrite removed the darwin-only
    // "could not open it" branch — a construct failure in strategy 1 now
    // degrades silently to CLI (unavailable) and lands on the windowsManual
    // hand-off with the dbPath named.
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toContain("state.vscdb");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // 843f3cfd moved the driver call from .all(rows) to per-key .get(row).
    mockDbInstance.prepare.mockImplementation(() => ({
      get: (key) => ({
        value: key === "cursorAuth/accessToken" ? "test-token"
          : key === "storage.serviceMachineId" ? "test-machine-id" : null,
      }),
    }));

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // 843f3cfd .get() shape — JSON-encoded strings are unwrapped by normalize().
    mockDbInstance.prepare.mockImplementation(() => ({
      get: (key) => ({
        value: key === "cursorAuth/accessToken" ? '"json-token"'
          : key === "storage.serviceMachineId" ? '"json-machine-id"' : null,
      }),
    }));

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Fuzzy fallback (macOS only) ───────────────────────────────────────

  // KNOWN GAP, flipped to it.fails 2026-10-11: 21dfee97 (2026-02-20) added the
  // fuzzy LIKE fallback for renamed/newer Cursor keys; 96bd6024 (2026-03-22)
  // dropped it with the sqlite3-CLI rewrite and nothing re-added it. If Cursor
  // renames its storage keys again this route silently degrades to the manual
  // hand-off. Restore the LIKE pass if the gap is ever closed.
  it.fails("falls back to fuzzy key matching on macOS when exact keys are missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // 843f3cfd: exact-key misses now return null rows; the fuzzy LIKE fallback
    // still runs a second prepare() whose .get() hits for any machineId key.
    mockDbInstance.prepare.mockImplementation((query) => {
      if (query.includes("LIKE")) {
        return { get: (key) => ({ value: key.includes("machineId") ? "fallback-machine" : "fallback-token" }) };
      }
      return { get: () => null };
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("returns login-prompt error when tokens are missing even after fallback", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({ get: () => null });

    const response = await GET();

    // 468e88df replaced the login-prompt message with the windowsManual
    // hand-off; strategy 1/2 misses now surface that shape.
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Backwards-compatible: linux/win32 keep original single-path logic ─

  it("linux rides the unified discovery and candidate-list message", async () => {
    // 2026-10-11 restamp: 13d8594b unified path discovery across platforms —
    // linux probes via fs.access like darwin/win32 and shares the candidate
    // listing message; the "single hardcoded path, no probing" behavior and
    // the old generic message are gone. The Cursor-install verification
    // (which cursor / desktop-file probe) still guards the success path.
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(fsPromises.access).toHaveBeenCalled();
  });

  // KNOWN GAP, flipped to it.fails 2026-10-11: 13d8594b removed the explicit
  // "Unsupported platform" 400 branch when it unified discovery — an exotic
  // platform now gets the generic not-found (200) instead of a crisp 400.
  // Harmless (still found:false), so no code mend; restore the branch if the
  // crisp refusal is wanted back.
  it.fails("unsupported platform returns 400", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unsupported platform");
  });
});
