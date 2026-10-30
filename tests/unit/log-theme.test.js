// The Logbook voice — table-driven proof that the two tongues switch cleanly.
// Covers: the pure kit (normalize / strip / realms), the logger's in-memory
// voice holder, and the throttled store read. Mocks follow the vi.hoisted
// convention of apikey-gate-acl.test.js: state is created before the mocks.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitLeveledConsole: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/consoleLogBuffer.js", () => ({
  emitLeveledConsole: mocks.emitLeveledConsole,
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: mocks.getSettings,
}));

const { normalizeLogTheme, stripTheme, realmOf, bannerOf, LOG_THEMES, GENERIC } = await import(
  "../../open-sse/utils/logfmt.js"
);
const { info, banner, getLogTheme, setLogTheme, refreshLogTheme, stream } = await import(
  "@/sse/utils/logger.js"
);

const EMOJI = /\p{Extended_Pictographic}/u;

/** The text handed to the funnel by the most recent emit. */
function lastText() {
  const call = mocks.emitLeveledConsole.mock.calls.at(-1);
  return call?.[0]?.text ?? "";
}

describe("normalizeLogTheme — only the exact word is plain", () => {
  it.each([
    ["plain", "plain"],
    ["PLAIN", "plain"],
    ["  Plain  ", "plain"],
    ["themed", "themed"],
    [undefined, "themed"],
    [null, "themed"],
    ["", "themed"],
    ["plainly", "themed"],
    ["plain text", "themed"],
    ["垃圾", "themed"],
    [42, "themed"],
    [true, "themed"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeLogTheme(raw)).toBe(expected);
  });

  it("exposes the frozen theme names", () => {
    expect(LOG_THEMES).toEqual({ THEMED: "themed", PLAIN: "plain" });
    expect(Object.isFrozen(LOG_THEMES)).toBe(true);
  });
});

describe("stripTheme — decoration goes, words and numbers stay", () => {
  it("keeps the tide's numbers untouched", () => {
    expect(stripTheme("⚓ voyage closed in 5.6s · IN 40,625")).toBe("voyage closed in 5.6s · IN 40,625");
  });

  it("removes multi-codepoint marks (ZWJ, variation selector, keycap)", () => {
    expect(stripTheme("🗝️ keys refreshed")).toBe("keys refreshed");
    expect(stripTheme("🖌️ painted")).toBe("painted");
    // The keycap's base digit is a WORD-level character and survives by law.
    expect(stripTheme("1️⃣ first")).toBe("1 first");
  });

  it("leaves an already-plain line byte-identical", () => {
    const plain = "[12:00:00] [COMBO] casting the next net · model=opus";
    expect(stripTheme(plain)).toBe(plain);
  });

  it("collapses gaps the glyphs left behind and trims separators", () => {
    expect(stripTheme("ℹ️  [COMBO] net")).toBe("[COMBO] net");
    expect(stripTheme("— · voyage")).toBe("voyage");
  });

  it("never throws on empty or strange input", () => {
    expect(stripTheme("")).toBe("");
    expect(stripTheme(undefined)).toBe("");
    expect(stripTheme(null)).toBe("");
  });
});

describe("realmOf — every tag finds its shore", () => {
  it.each([
    ["CHAT", "⚓ THE CURRENT", "🧭"],
    ["COMBO", "🧭 THE CHARTED ROUTE", "⛵"],
    ["PROXY", "🌊 THE PASSAGE", "🔗"],
    ["TOKEN_REFRESH", "🔑 THE KEEPER'S KEYS", "🗝️"],
  ])("%s", (tag, bannerText, mark) => {
    expect(realmOf(tag).banner).toBe(bannerText);
    expect(realmOf(tag).mark).toBe(mark);
    expect(bannerOf(tag)).toBe(bannerText);
  });

  it("is case-insensitive", () => {
    expect(realmOf("combo")).toBe(realmOf("COMBO"));
  });

  it.each([["NO_SUCH_REALM"], [""], [undefined], [null]])("unknown %j → GENERIC", (tag) => {
    expect(realmOf(tag)).toBe(GENERIC);
    expect(bannerOf(tag)).toBe("🕯️ THE LOGBOOK");
  });

  it("bannerOf always answers a string, never the record", () => {
    for (const tag of ["CHAT", "COMBO", "PROXY", "STREAM", "NOPE"]) {
      expect(typeof bannerOf(tag)).toBe("string");
    }
  });
});

describe("the logger's voice", () => {
  let logSpy;

  beforeEach(() => {
    mocks.emitLeveledConsole.mockClear();
    setLogTheme("themed");
  });

  // Raw-console emitters are silenced so the suite's own output stays quiet;
  // the tests that care about them read the spy instead of the funnel.
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("setLogTheme/getLogTheme round-trips through the normalizer", () => {
    expect(setLogTheme("plain")).toBe("plain");
    expect(getLogTheme()).toBe("plain");
    expect(setLogTheme("THEMED")).toBe("themed");
    expect(getLogTheme()).toBe("themed");
    expect(setLogTheme("nonsense")).toBe("themed");
  });

  it("themed: the realm mark and icon reach the funnel", () => {
    info("COMBO", "casting the next net");
    const text = lastText();
    expect(text).toContain("ℹ️");
    expect(text).toContain("[⛵ COMBO]");
    expect(text).toContain("casting the next net");
  });

  it("plain: decoration goes, the [TAG] bracket stays, words stay", () => {
    setLogTheme("plain");
    info("COMBO", "casting the next net");
    const text = lastText();
    expect(text).not.toMatch(EMOJI);
    expect(text).toContain("[COMBO]");
    expect(text).toContain("casting the next net");
    expect(text).not.toContain("⛵");
  });

  it("plain keeps the data chain and its numbers", () => {
    setLogTheme("plain");
    info("USAGE", "voyage closed", { duration: "5.6s", tokens: "40,625" });
    const text = lastText();
    expect(text).toContain("voyage closed");
    expect(text).toContain("5.6s");
    expect(text).toContain("40,625");
    expect(text).not.toMatch(EMOJI);
  });

  it("flipping back to themed restores the mark", () => {
    setLogTheme("plain");
    info("PROXY", "a");
    expect(lastText()).not.toContain("🔗");

    setLogTheme("themed");
    info("PROXY", "b");
    expect(lastText()).toContain("[🔗 PROXY]");
  });

  it("banner() speaks through the same funnel with the realm banner", () => {
    banner("TOKEN_REFRESH", "the keys turned");
    const themed = lastText();
    expect(themed).toContain("🔑 THE KEEPER'S KEYS");
    expect(themed).toContain("the keys turned");

    setLogTheme("plain");
    banner("TOKEN_REFRESH", "the keys turned");
    const plain = lastText();
    expect(plain).toContain("THE KEEPER'S KEYS");
    expect(plain).not.toMatch(EMOJI);
  });

  it("stream() keeps the [STREAM] tag in both voices", () => {
    stream("delta", { n: 1 });
    expect(logSpy.mock.calls.at(-1)[0]).toContain("[STREAM]");

    setLogTheme("plain");
    stream("delta", { n: 1 });
    const text = logSpy.mock.calls.at(-1)[0];
    expect(text).toContain("[STREAM]");
    expect(text).not.toMatch(EMOJI);
  });
});

describe("refreshLogTheme — the store speaks, fail-open stands", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset();
    setLogTheme("themed");
  });

  it("reads the stored voice and flips the tongue", async () => {
    mocks.getSettings.mockResolvedValue({ logTheme: "plain" });
    const theme = await refreshLogTheme({ force: true });
    expect(theme).toBe("plain");
    expect(getLogTheme()).toBe("plain");
  });

  it("a throwing store leaves the previous voice standing", async () => {
    setLogTheme("plain");
    mocks.getSettings.mockRejectedValue(new Error("db down"));
    const theme = await refreshLogTheme({ force: true });
    expect(theme).toBe("plain");
    expect(getLogTheme()).toBe("plain");
  });

  it("an unreadable value does not wedge the voice", async () => {
    setLogTheme("plain");
    mocks.getSettings.mockResolvedValue({ logTheme: "garbage" });
    expect(await refreshLogTheme({ force: true })).toBe("themed");
  });

  it("reads at most once per 5s without force", async () => {
    mocks.getSettings.mockResolvedValue({ logTheme: "plain" });
    // Start from "never read": earlier tests in this module may have refreshed.
    vi.setSystemTime(new Date(Date.now() + 3_600_000));
    await refreshLogTheme(); // first read (last refresh is long past)
    expect(mocks.getSettings).toHaveBeenCalledTimes(1);
    mocks.getSettings.mockResolvedValue({ logTheme: "themed" });
    await refreshLogTheme(); // inside the window — must NOT read again
    expect(mocks.getSettings).toHaveBeenCalledTimes(1);
    expect(getLogTheme()).toBe("plain");

    // Forcing past the guard reads again and honours the store.
    expect(await refreshLogTheme({ force: true })).toBe("themed");
    expect(mocks.getSettings).toHaveBeenCalledTimes(2);
  });
});
