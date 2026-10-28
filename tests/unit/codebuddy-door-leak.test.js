// The door that must not leak — SC-2 of the sealed plan (plans/2026-10-28-codebuddy-family.md).
//
// The old lanes held the console-door diversion in an instance field (`this._forcedUrl`)
// on a module-load singleton. A throw mid-retry skipped the reset, and every later
// request on that executor dialled the console door forever. The family carries the
// diversion through the credentials object instead — request-scoped by construction.
//
// This suite proves the isolation with two interleaved turns on ONE instance:
// the first requests the console door (via runtimeTransport), the second does not.
// If the diversion leaks, the second turn's URL is the console door.

import { describe, expect, it } from "vitest";
import { CodeBuddyFamilyExecutor } from "../../open-sse/executors/codebuddy-family.js";

const CONSOLE_DOOR = "https://www.codebuddy.ai/console/chat/completions";
const PRIMARY = "https://www.codebuddy.ai/v2/chat/completions";

describe("the console-door diversion never leaks across requests (SC-2)", () => {
  it("a diverted turn leaves no trace on the next turn's URL", () => {
    const exec = new CodeBuddyFamilyExecutor("codebuddy-intl");

    const diverted = { connectionId: "conn-a", runtimeTransport: { baseUrl: CONSOLE_DOOR, headers: {} } };
    const plain = { connectionId: "conn-b" };

    // The diverted turn builds the console door…
    expect(exec.buildUrl("glm-5.2", true, 0, diverted)).toBe(CONSOLE_DOOR);
    // …and the interleaved plain turn on the SAME singleton sees the primary door,
    // never the diverted one.
    expect(exec.buildUrl("glm-5.2", true, 0, plain)).toBe(PRIMARY);
    // A third turn, after the diverted one is long gone, stays clean.
    expect(exec.buildUrl("glm-5.2", true, 0, plain)).toBe(PRIMARY);
  });

  it("every product's profile keys its own breaker — no cross-product collision", () => {
    const cn = new CodeBuddyFamilyExecutor("codebuddy-cn");
    const work = new CodeBuddyFamilyExecutor("workbuddy-intl");
    const creds = { connectionId: "shared-conn" };
    expect(cn.breakerKey(creds)).not.toBe(work.breakerKey(creds));
    expect(cn.breakerKey(creds)).toBe("codebuddy-cn:shared-conn");
    expect(work.breakerKey(creds)).toBe("workbuddy-intl:shared-conn");
  });

  it("a constructor with an unknown id refuses to build a lane", () => {
    expect(() => new CodeBuddyFamilyExecutor("openai")).toThrow(/no profile/);
  });
});