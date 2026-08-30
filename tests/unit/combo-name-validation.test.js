/**
 * Combo name validation — the single shared law (v0.9.39 decree: combo names
 * may carry slashes so operators can namespace their fleets).
 */
import { describe, it, expect } from "vitest";
import { validateComboName, COMBO_NAME_MAX_LENGTH } from "@/shared/constants/comboValidation";

describe("validateComboName — what the harbor accepts", () => {
  it("keeps every classic name shape", () => {
    for (const name of ["my-combo", "opus4", "a.b_c-d", "Sonnet"]) {
      expect(validateComboName(name).ok).toBe(true);
    }
  });

  it("accepts namespaced slash names — the decree", () => {
    for (const name of ["vela/cc/opus", "vela/anthropic/sonnet", "vela/deepseek/deepseek-v4-flash", "a/b"]) {
      const verdict = validateComboName(name);
      expect(verdict.ok).toBe(true);
      expect(verdict.name).toBe(name);
    }
  });

  it("trims surrounding whitespace before sealing", () => {
    const verdict = validateComboName("  vela/cc/opus  ");
    expect(verdict.ok).toBe(true);
    expect(verdict.name).toBe("vela/cc/opus");
  });

  it("rejects empty and blank names", () => {
    for (const bad of ["", "   ", null, undefined, 42]) {
      expect(validateComboName(bad).ok).toBe(false);
    }
  });

  it("rejects malformed slashes", () => {
    for (const bad of ["/vela", "vela/", "vela//opus", "a//", "/"]) {
      const verdict = validateComboName(bad);
      expect(verdict.ok).toBe(false);
      expect(verdict.error).toBeTruthy();
    }
  });

  it('rejects "." and ".." segments', () => {
    for (const bad of ["vela/./opus", "vela/../opus", ".", "..", "a/.."]) {
      expect(validateComboName(bad).ok).toBe(false);
    }
  });

  it("rejects the reserved combo/ addressing prefix", () => {
    const verdict = validateComboName("combo/opus");
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("combo/");
  });

  it("rejects foreign characters", () => {
    for (const bad of ["vela cc", "opus@home", "combo!", "ünïcode", "a\\b"]) {
      expect(validateComboName(bad).ok).toBe(false);
    }
  });

  it("rejects names beyond the length bound", () => {
    const tooLong = "vela/" + "a".repeat(COMBO_NAME_MAX_LENGTH);
    expect(validateComboName(tooLong).ok).toBe(false);
  });
});
