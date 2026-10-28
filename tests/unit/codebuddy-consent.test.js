// The consent gate, proven at its refusals.
//
// A consent gate is only worth having if it says NO in every case where a person did
// not clearly say yes to exactly these words. Every assertion here is a refusal.
import { describe, expect, it } from "vitest";
import {
  ACTION_CONSENT,
  CONSENT_REFUSAL,
  ConsentLedger,
  authorizeAction,
  consentFor,
  currentRevision,
} from "../../open-sse/shared/codebuddy/consent.js";

const ACTIONS = Object.keys(ACTION_CONSENT);

describe("consent is a revision of exact words", () => {
  it("produces a stable 64-hex revision per action", () => {
    for (const action of ACTIONS) {
      const rev = currentRevision(action);
      expect(rev).toMatch(/^[0-9a-f]{64}$/);
      expect(currentRevision(action)).toBe(rev); // stable
    }
  });

  it("different actions have different revisions", () => {
    const revs = ACTIONS.map(currentRevision);
    expect(new Set(revs).size).toBe(ACTIONS.length);
  });

  it("carries the text a person is shown", () => {
    const c = consentFor("buddy");
    expect(c.title).toBe("First Buddy dispatch");
    expect(c.terms.length).toBeGreaterThan(0);
    expect(c.authorization).toMatch(/credits/);
    expect(c.revision).toBe(currentRevision("buddy"));
  });

  it("refuses an unknown action rather than inventing consent", () => {
    expect(() => consentFor("teleport")).toThrow(/Unknown consent action/);
    expect(() => currentRevision("teleport")).toThrow();
  });
});

describe("the operator's switch comes first", () => {
  it("refuses when the action is not enabled, even with perfect consent", () => {
    const rev = currentRevision("buddy");
    const r = authorizeAction({ action: "buddy", acceptedRevision: rev, presentedRevision: rev, enabled: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(CONSENT_REFUSAL.NOT_ENABLED);
  });
});

describe("the presented revision must match exactly", () => {
  it("refuses a caller that echoes nothing", () => {
    const r = authorizeAction({ action: "checkin", presentedRevision: null, enabled: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(CONSENT_REFUSAL.STALE_REVISION);
  });

  it("refuses a caller echoing a revision the account never accepted", () => {
    const r = authorizeAction({ action: "checkin", presentedRevision: "deadbeef", enabled: true });
    expect(r.allowed).toBe(false);
  });

  it("allows only when presented, accepted and current all agree", () => {
    const rev = currentRevision("checkin");
    const r = authorizeAction({ action: "checkin", acceptedRevision: rev, presentedRevision: rev, enabled: true });
    expect(r.allowed).toBe(true);
    expect(r.revision).toBe(rev);
  });
});

describe("stale consent is void, not softened", () => {
  it("refuses an acceptance from an older wording", () => {
    const r = authorizeAction({
      action: "growth",
      acceptedRevision: "0".repeat(64),
      presentedRevision: currentRevision("growth"),
      enabled: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(CONSENT_REFUSAL.TERMS_CHANGED);
  });

  it("refuses when nothing was ever accepted", () => {
    const r = authorizeAction({
      action: "buddy",
      acceptedRevision: null,
      presentedRevision: currentRevision("buddy"),
      enabled: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(CONSENT_REFUSAL.NO_CONSENT);
  });

  it("every refusal reason comes from the closed set", () => {
    const reasons = new Set(Object.values(CONSENT_REFUSAL));
    const cases = [
      { action: "checkin", enabled: false },
      { action: "checkin", enabled: true },
      { action: "checkin", enabled: true, presentedRevision: "x" },
      { action: "checkin", enabled: true, acceptedRevision: "y", presentedRevision: currentRevision("checkin") },
    ];
    for (const c of cases) {
      const r = authorizeAction(c);
      expect(r.allowed).toBe(false);
      expect(reasons.has(r.reason)).toBe(true);
    }
  });
});

describe("the ledger stores per account, per action", () => {
  it("records and validates an acceptance", () => {
    const ledger = new ConsentLedger();
    const rev = ledger.accept("acct-1", "checkin");
    expect(rev).toBe(currentRevision("checkin"));
    expect(ledger.isValid("acct-1", "checkin")).toBe(true);
  });

  it("another account's acceptance does not carry over", () => {
    const ledger = new ConsentLedger();
    ledger.accept("acct-1", "checkin");
    expect(ledger.isValid("acct-2", "checkin")).toBe(false);
  });

  it("another action's acceptance does not carry over", () => {
    const ledger = new ConsentLedger();
    ledger.accept("acct-1", "checkin");
    expect(ledger.isValid("acct-1", "buddy")).toBe(false);
  });

  it("a revoked action is refused", () => {
    const ledger = new ConsentLedger();
    ledger.accept("acct-1", "buddy");
    expect(ledger.revoke("acct-1", "buddy")).toBe(true);
    expect(ledger.isValid("acct-1", "buddy")).toBe(false);
  });

  it("stores the REVISION, never a bare boolean", () => {
    const ledger = new ConsentLedger();
    ledger.accept("acct-1", "growth");
    expect(ledger.accepted("acct-1", "growth")).toBe(currentRevision("growth"));
    expect(typeof ledger.accepted("acct-1", "growth")).toBe("string");
  });
});
