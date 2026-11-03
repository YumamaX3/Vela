// A/B tester verdict — the pure refusal matcher. Case-insensitive,
// word-boundary: a phrase inside a word ("canal't") must never fire, and a
// bare "can't" without the subject must not either.
import { describe, it, expect } from "vitest";
import { detectRefusal, buildRefusalMatcher, REFUSAL_PHRASES } from "@/shared/utils/refusalVerdict.js";

describe("detectRefusal — phrase hits", () => {
  it.each([
    ["I can't help with that.", "I can't"],
    ["i cannot do that", "i cannot"],
    ["As an AI, I should explain…", "As an AI"],
    ["as an ai language model, I…", "as an ai language model"],
    ["I'm sorry, but I won't.", "I'm sorry, but I"],
    ["I'm   unable   to   assist", "I'm   unable   to   assist"],
  ])("refuses %j", (text) => {
    expect(detectRefusal(text).refused).toBe(true);
  });

  it("reports the matched phrase verbatim", () => {
    expect(detectRefusal("Well. As an AI I can't.").phrase.toLowerCase()).toBe("as an ai");
  });

  it("finds a phrase mid-text after a newline", () => {
    expect(detectRefusal("Sure:\nI cannot share that.").refused).toBe(true);
  });
});

describe("detectRefusal — boundaries", () => {
  it("does not fire inside a longer word", () => {
    expect(detectRefusal("The canal't is a typo").refused).toBe(false);
    expect(detectRefusal("his can't is odd").refused).toBe(false);
  });

  it("does not fire without the leading I", () => {
    expect(detectRefusal("She said can't").refused).toBe(false);
    expect(detectRefusal("they cannot go").refused).toBe(false);
  });

  it("does not fire on plain answers", () => {
    expect(detectRefusal("Sure, here is the code.").refused).toBe(false);
    expect(detectRefusal("The migration is safe.").refused).toBe(false);
  });

  it("does not fire on I can with an apostrophe-less continuation", () => {
    expect(detectRefusal("I can do that quickly").refused).toBe(false);
  });
});

describe("detectRefusal — tolerant", () => {
  it.each([null, undefined, 0, 123, {}, []])("non-string %j → not refused", (v) => {
    expect(detectRefusal(v)).toEqual({ refused: false, phrase: null });
  });

  it("empty and whitespace strings are not refused", () => {
    expect(detectRefusal("").refused).toBe(false);
    expect(detectRefusal("   \n\t ").refused).toBe(false);
  });

  it("custom phrase lists are honoured by buildRefusalMatcher", () => {
    const re = buildRefusalMatcher(["policy denied"]);
    expect(re.test("The POLICY DENIED this")).toBe(true);
    expect(re.test("I can't")).toBe(false);
  });

  it("the default list carries the brief's three examples", () => {
    for (const p of ["I can't", "I cannot", "As an AI"]) expect(REFUSAL_PHRASES).toContain(p);
  });
});
