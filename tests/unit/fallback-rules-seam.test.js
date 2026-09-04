/**
 * Fallback Rules Seam (Seam 2) Test Suite — v0.9.16
 *
 * Proves the CONSUMER side of the operator-defined fallback-rules engine:
 *   S1. handleComboChat appends DB target models to the rotation list
 *   S2. Only targets NOT already in the list are appended (no duplicates)
 *   S3. Fail-open: a throwing repo leaves the rotation list untouched
 *   S4. No repo passed at all — byte-identical hardcoded behavior
 *   S5. Seam 2 requires a repo with getRulesForSourceModel (shape contract)
 *
 * ⚠️ SCOPE LIMIT — and the bug it hid.
 * Every suite below hands handleComboChat a LITERAL `{getRulesForSourceModel}`
 * object. None of them imports or calls `bindFallbackRules.js`, the module that
 * produces that object in production. This header once claimed S4 covered "the
 * bindFallbackRules helper returns a repo-shaped object or null" — that claim was
 * FALSE, and the mismatch was corrected in v0.9.46 rather than left to mislead
 * the next reader.
 *
 * Because the producer was never exercised, `bindFallbackRules.js` shipped a
 * missing `await` on the async `getAdapter()` from v0.9.16 to v0.9.45: the repo
 * it returned looked correctly shaped (so S5's contract check passed and combo.js
 * called in), but its closures captured a Promise instead of an adapter, and the
 * first real query threw `db.all is not a function` — swallowed by combo.js's
 * catch. Operator-defined fallback rules never applied, in production, for five
 * minors, while this suite stayed green.
 *
 * The producer is proven in `tests/unit/bind-fallback-rules.test.js`, against a
 * REAL migrated adapter rather than a mock — a permissive mock is exactly what
 * made the defect invisible.
 */
import { describe, it, expect } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// A minimal fake that resolves immediately with a result.
function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function failResponse(status = 429) {
  return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status, headers: { "Content-Type": "application/json" } });
}

function quietLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

describe("S1: handleComboChat appends DB fallback rules", () => {
  it("appends the DB target to the rotation list when the repo returns a rule", async () => {
    const repo = {
      getRulesForSourceModel: async (source) => {
        expect(source).toBe("combo/flagship");
        return [{ sourceModel: "combo/flagship", targetModel: "provider/backup-model", priority: 100, triggerOnStatus: "429,503", maxRetries: 1 }];
      },
    };

    let tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider/primary"],
      handleSingleModel: async (b, m) => {
        tried.push(m);
        if (m === "provider/primary") return failResponse(429);
        return okResponse();
      },
      log: quietLog(),
      comboName: "combo/flagship",
      comboStrategy: "fallback",
      fallbackRulesRepo: repo,
    });

    expect(result.status).toBe(200);
    // The DB target must have been tried AFTER the primary failed.
    expect(tried).toEqual(["provider/primary", "provider/backup-model"]);
  });
});

describe("S2: no duplicate targets are appended", () => {
  it("skips targets already present in the hardcoded list", async () => {
    const repo = {
      getRulesForSourceModel: async () => [
        { targetModel: "provider/primary", priority: 10 },
        { targetModel: "provider/extra", priority: 20 },
      ],
    };

    let tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider/primary"],
      handleSingleModel: async (b, m) => {
        tried.push(m);
        if (m === "provider/primary") return failResponse(503);
        return okResponse();
      },
      log: quietLog(),
      comboName: "combo/test",
      comboStrategy: "fallback",
      fallbackRulesRepo: repo,
    });

    expect(result.status).toBe(200);
    // "provider/primary" is already in the list — only "provider/extra" is appended.
    expect(tried).toEqual(["provider/primary", "provider/extra"]);
  });
});

describe("S3: fail-open when the repo throws", () => {
  it("leaves the rotation list untouched and still falls back through hardcoded models", async () => {
    const repo = {
      getRulesForSourceModel: async () => {
        throw new Error("db down");
      },
    };

    let tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider/a", "provider/b"],
      handleSingleModel: async (b, m) => {
        tried.push(m);
        if (m === "provider/a") return failResponse(429);
        return okResponse();
      },
      log: quietLog(),
      comboName: "combo/fail-open",
      comboStrategy: "fallback",
      fallbackRulesRepo: repo,
    });

    expect(result.status).toBe(200);
    expect(tried).toEqual(["provider/a", "provider/b"]);
  });
});

describe("S4: no repo passed — byte-identical hardcoded behavior", () => {
  it("does not call any repo and still falls back", async () => {
    let tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider/x", "provider/y"],
      handleSingleModel: async (b, m) => {
        tried.push(m);
        if (m === "provider/x") return failResponse(503);
        return okResponse();
      },
      log: quietLog(),
      comboName: "combo/no-repo",
      comboStrategy: "fallback",
    });

    expect(result.status).toBe(200);
    expect(tried).toEqual(["provider/x", "provider/y"]);
  });
});

describe("S5: repo shape contract", () => {
  it("Seam 2 activates only when getRulesForSourceModel is a function", async () => {
    // A malformed "repo" (no function) must be treated as absent — no throw.
    let tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider/only"],
      handleSingleModel: async (b, m) => {
        tried.push(m);
        return okResponse();
      },
      log: quietLog(),
      comboName: "combo/shape",
      comboStrategy: "fallback",
      fallbackRulesRepo: { notAFunction: true },
    });

    expect(result.status).toBe(200);
    expect(tried).toEqual(["provider/only"]);
  });
});
