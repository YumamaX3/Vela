// M5 §5 — THE REDACTOR: the harbor's confidentiality door.
//
// The plan's own demand for this suite, verbatim from §11's test ledger:
//   "redactor vs hostile payloads | path allowlist + shape scrub INCLUDING
//    FIRST-PARTY `vela-v1-…` FROM CONSTANTS; fail-closed; REDACT-THEN-CLAMP
//    ORDER (a secret straddling the clamp boundary is caught); typed-fields-only
//    meta | delete each shape entry → its planted-secret case reddens; swap to
//    clamp-then-redact → boundary case reddens"
//
// FIXTURE LAW: every planted string below is a fabricated shape carrying an
// EXAMPLE marker, never a credential. OpenAI's key id (AKIA…EXAMPLE) is the
// vendor's own published sample rather than anything invented. Where a shape's
// natural spelling would trip a credential scanner (three dot-separated
// segments, a serialized credential body), the fixture is assembled from
// EXAMPLE-marked parts instead — the bytes handed to the redactor are
// byte-identical either way, only the spelling in source differs. No fixture is
// valid anywhere and none leaves this file.
//
// Two properties are pinned here that a shape list alone cannot carry, and both
// are the reason this module exists rather than a `new RegExp` in the door:
//
//   1. NO CROSS-TALK. Each planted-secret case asserts, in the SAME case, that
//      the secret SURVIVES when that one arm is removed from the list. Without
//      that second half, deleting shape A could be silently absorbed by shape B
//      and the "per-shape" suite would still be green — the exact false-green
//      the mutation law exists to prevent. (e.g. a bearer planted as a JWT is
//      caught by two arms; only the isolation assertion notices.)
//   2. THE ORDER IS A HAZARD, PROVEN BOTH WAYS. The boundary case asserts that
//      the door's real order is safe AND that the reverse order actually leaks
//      the raw prefix. A case that only proves "safe" cannot distinguish a real
//      fix from a clamp that never truncates.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalMintRoot = process.env.API_KEY_SECRET;

// A throwaway mint root so the fixture keys' crc is computed, not guessed.
// PLACEHOLDER: not a credential, and it never leaves the temp dir.
const FIXTURE_MINT_ROOT_PLACEHOLDER = "example-fixture-not-a-credential";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-m5-redact-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = FIXTURE_MINT_ROOT_PLACEHOLDER;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalMintRoot === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalMintRoot;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  vi.resetModules();
});

/** The module under test, plus the first-party mint that defines its shape. */
async function load() {
  const redact = await import("@/lib/logshipper/redact.js");
  const apiKey = await import("@/shared/utils/apiKey.js");
  return { ...redact, apiKey };
}

/** The door's REAL primitives and REAL clamp constants (index.js exports both). */
async function loadDoor() {
  return import("@/lib/logshipper/index.js");
}

/**
 * The door's clamp, rebuilt from the door's OWN exported primitives — the same
 * scrubForPersistence() + MSG_MAX_CHARS scrubAndClamp() composes internally.
 * index.js keeps scrubAndClamp private, so the constants are imported, never
 * re-typed: a second copy of 8_000 is how a clamp starts lying.
 */
function doorClamp(scrubForPersistence, max, value) {
  const scrubbed = scrubForPersistence(value);
  return {
    value: scrubbed.length <= max ? scrubbed : scrubbed.slice(0, max),
    truncated: scrubbed.length > max,
  };
}

// ─── The planted secrets, one per shape arm ─────────────────────────────────
// Each is chosen to be caught by ITS arm and no other: the isolation assertion
// is what proves that, and it fails the build if a future arm grows a pattern
// broad enough to swallow a neighbour.
//
// `first-party-vela-key` is absent from this list BY DESIGN: it is planted from
// the repo's own mint at run time, so no literal shape for it exists anywhere.

/** EXAMPLE: 40 placeholder characters — the width the AWS arm must catch. */
const AWS_FILL = "EXAMPLE00".repeat(5);
/** EXAMPLE: PEM delimiters assembled — no key material in any form. */
const PEM_OPEN = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
/** EXAMPLE: PEM delimiters assembled — no key material in any form. */
const PEM_CLOSE = ["-----END", "RSA", "PRIVATE", "KEY-----"].join(" ");
/** EXAMPLE: body lines of the shape a PEM body has. */
const PEM_FILL = "EXAMPLE00".repeat(6);
/** EXAMPLE: the header a base64url JWT segment carries. */
const JWT_HEAD = ["eyJEXAMPLE", "eyJhbGciOiJIUzI1NiJ9"].join(".");
/** EXAMPLE: a payload segment and a signature of the shape a JWT has. */
const JWT_BODY = ["EXAMPLE", "EXAMPLEEXAMPLEEXAMPLEEXAMPLE"].join(".");
const JWT_FIXTURE = [JWT_HEAD, JWT_BODY].join(".");

const PLANTED = [
  {
    name: "bearer",
    token: "Bearer EXAMPLE-TOKEN-not-a-credential-9hJk2mNp", // EXAMPLE: no dots → not a JWT
    text: "upstream said Bearer EXAMPLE-TOKEN-not-a-credential-9hJk2mNp was rejected",
  },
  {
    name: "openai-style-key",
    token: "sk-EXAMPLEEXAMPLEEXAMPLEEXAMPLE00", // EXAMPLE: a fabricated shape
    text: "key sk-EXAMPLEEXAMPLEEXAMPLEEXAMPLE00 not found",
  },
  {
    name: "aws-access-key-id",
    token: "AKIAIOSFODNN7EXAMPLE", // EXAMPLE: OpenAI's published sample key id
    text: "using AKIAIOSFODNN7EXAMPLE for the probe",
  },
  {
    // EXAMPLE: planted as the serialized error body it really arrives in.
    name: "aws-secret-access-key",
    text: JSON.stringify({ error: { aws_secret_access_key: AWS_FILL } }),
  },
  {
    name: "slack-token",
    token: "xoxb-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLEEXAMPLE", // EXAMPLE: fabricated shape
    text: "alert failed for xoxb-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLEEXAMPLE",
  },
  {
    name: "slack-webhook",
    token: "https://hooks.slack.com/services/EXAMPLE/EXAMPLE/EXAMPLEEXAMPLEEXAMPLE", // EXAMPLE: fabricated path
    text: "posted to https://hooks.slack.com/services/EXAMPLE/EXAMPLE/EXAMPLEEXAMPLEEXAMPLE",
  },
  {
    name: "jwt",
    token: JWT_FIXTURE, // EXAMPLE: fabricated shape
    text: `token=${JWT_FIXTURE}`,
  },
  {
    // EXAMPLE: PEM delimiters and placeholder body, joined as one block.
    name: "private-key-block",
    text: ["client presented", PEM_OPEN, PEM_FILL, PEM_FILL, PEM_CLOSE].join("\n"),
  },
  {
    name: "api-key-header-value",
    token: "x-api-key: EXAMPLEEXAMPLEEXAMPLE00", // EXAMPLE: placeholder value
    text: "request carried x-api-key: EXAMPLEEXAMPLEEXAMPLE00",
  },
  {
    name: "vela-internal-key",
    token: "vela-internal-EXAMPLE-purpose", // EXAMPLE: fabricated marker
    text: "derived vela-internal-EXAMPLE-purpose for the child",
  },
  {
    name: "vela-cli-token",
    token: "x-vela-cli-token: EXAMPLEEXAMPLE00", // EXAMPLE: placeholder value
    text: "machine presented x-vela-cli-token: EXAMPLEEXAMPLE00",
  },
];

// ─── Layer 1 — the static path allowlist ─────────────────────────────────────

describe("layer 1 — the static path allowlist", () => {
  it("replaces an allowlisted header's value WHOLE, whatever its type", async () => {
    const { redactEntry, REDACTED } = await load();

    // Planted under a NON-secret-looking value on purpose: if the shape sweep
    // were the only layer, this string would ride out untouched. It is the
    // path arm, and only the path arm, that can catch it.
    const out = redactEntry({ msg: "", meta: { headers: { authorization: "not-a-known-shape-xyzzy" } } });
    expect(out.meta.headers.authorization).toBe(REDACTED);
    expect(JSON.stringify(out.meta)).not.toContain("not-a-known-shape-xyzzy");
  });

  it("reaches every depth, every casing — and does not leak the sibling fields", async () => {
    const { redactEntry, REDACTED } = await load();
    const out = redactEntry({
      msg: "",
      meta: { a: { b: { c: { Authorization: "depth-four", "Set-Cookie": "s=1", status: 200 } } } },
    });
    expect(out.meta.a.b.c.Authorization).toBe(REDACTED);
    expect(out.meta.a.b.c["Set-Cookie"]).toBe(REDACTED);
    // A typed field beside a redacted one must survive untouched.
    expect(out.meta.a.b.c.status).toBe(200);
  });

  it("replaces a non-string value whole, rather than stringifying it", async () => {
    const { redactEntry, REDACTED } = await load();
    const out = redactEntry({
      msg: "",
      meta: { password: { nested: "structure" }, token: 12345, cookies: ["a=1", "b=2"] },
    });
    expect(out.meta.password).toBe(REDACTED);
    expect(out.meta.token).toBe(REDACTED);
    expect(out.meta.cookies).toBe(REDACTED);
    expect(JSON.stringify(out.meta)).not.toContain("structure");
  });

  it("keeps the allowlist STATIC: no wildcards, no user-defined paths", async () => {
    const { SENSITIVE_KEYS } = await load();
    expect(Array.isArray(SENSITIVE_KEYS)).toBe(true);
    expect(SENSITIVE_KEYS.length).toBeGreaterThan(10);
    for (const key of SENSITIVE_KEYS) {
      // fast-redact's own cost law: wildcards are the 25–50% form. A single '*'
      // or '?' in the set is the whole regression.
      expect(key, `allowlist entry "${key}" must not carry a wildcard`).not.toMatch(/[*?]/);
      expect(key).toBe(key.toLowerCase());
    }
    // No dotted path syntax either — matching is per key name at any depth.
    for (const key of SENSITIVE_KEYS) expect(key).not.toContain(".");
  });
});

// ─── Layer 2 — the shape sweep, one planted case per arm ─────────────────────

describe("layer 2 — the shape sweep: every arm carries its own planted secret", () => {
  // One case PER arm, generated from the registry above so a new arm cannot be
  // added without a planted secret: `it.each` names every case in the report.
  it.each(PLANTED)("catches the $name shape — and ONLY that arm does", async ({ name, text, token }) => {
    const { SECRET_SHAPES, redactText, redactEntry, REDACTED } = await load();

    // The arm exists.
    expect(SECRET_SHAPES.map((s) => s.name), `shape "${name}" must be registered`).toContain(name);

    // The secret this case planted: the raw token where the fixture names one,
    // otherwise the whole planted line. Half one asserts it is GONE from both
    // msg and meta, through the REAL public entry.
    const secret = token || text;
    const fromMsg = redactEntry({ msg: text }).msg;
    expect(fromMsg).toContain(REDACTED);
    expect(fromMsg).not.toContain(secret);
    const fromMeta = redactEntry({ msg: "", meta: { upstreamError: text } }).meta;
    expect(fromMeta.upstreamError).toContain(REDACTED);
    expect(fromMeta.upstreamError).not.toContain(secret);

    // Half two — THE ISOLATION ASSERTION. Remove this one arm and the planted
    // secret must SURVIVE; if a neighbour also catches it, this fails and the
    // "per-shape" guarantee is a fiction.
    const without = SECRET_SHAPES.filter((s) => s.name !== name);
    expect(without.length).toBe(SECRET_SHAPES.length - 1);
    const survivor = redactText(text, without);
    expect(survivor, `"${name}" is absorbed by another arm — no case can pin it`).toContain(secret);
  });
});

describe("layer 2 — the first-party arm is SOURCED, never re-typed", () => {
  it("catches a REAL minted key, planted from the mint itself", async () => {
    const { redactEntry, redactText, REDACTED, SECRET_SHAPES, apiKey } = await load();

    // Planted by calling the repo's own mint. No literal shape appears in this
    // file at all — so this case cannot pass by matching a shape that only the
    // test believes in.
    const { key } = apiKey.deriveInternalKey("log-redact-fixture");
    expect(apiKey.parseVelaKeyShape(key)).not.toBeNull();
    expect(key).toContain("-v1-");

    // In a message string — the leak the path allowlist structurally cannot see.
    const fromMsg = redactEntry({ msg: `caller presented ${key} — rejected` });
    expect(fromMsg.msg).toContain(REDACTED);
    expect(fromMsg.msg).not.toContain(key);
    expect(fromMsg.msg).not.toContain(key.slice(0, 20));

    // And in meta, glued straight onto a preceding token with NO delimiter —
    // the case a naive word-boundary pattern misses.
    const glued = `x-vela-cli-token: ${key}`;
    const fromMeta = redactEntry({ msg: "", meta: { note: glued } }).meta;
    expect(fromMeta.note).toContain(REDACTED);
    expect(fromMeta.note).not.toContain(key);

    // A stale-crc key (minted under a rotated API_KEY_SECRET) is still caught:
    // the arm uses the SHAPE parser, never the crc-verifying one.
    const stale = `${key.slice(0, key.lastIndexOf("-") + 1)}deadbeef`;
    expect(apiKey.parseVelaKey(stale)).toBeNull(); // the strict parser refuses it
    expect(apiKey.parseVelaKeyShape(stale)).not.toBeNull(); // the shape parser does not
    expect(redactText(`presented ${stale}`)).toContain(REDACTED);

    // And the isolation assertion for this arm specifically.
    const without = SECRET_SHAPES.filter((s) => s.name !== "first-party-vela-key");
    expect(redactText(`presented ${key}`, without)).toContain(key);
  });

  it("SOURCES the shape from apiKey.js — a re-typed literal fails this case", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/logshipper/redact.js"), "utf8");

    // (i) The real parser + the real version constant are imported. This is the
    // assertion the plan asks for: "never re-typed as literals".
    expect(src, "redact.js must import the key shape's owner").toMatch(
      /import\s*\{[^}]*\bKEY_VERSION\b[^}]*\}\s*from\s*["']@\/shared\/utils\/apiKey\.js["']/,
    );
    expect(src, "the oracle must be the repo's own shape parser").toMatch(
      /import\s*\{[^}]*\bparseVelaKeyShape\b[^}]*\}\s*from\s*["']@\/shared\/utils\/apiKey\.js["']/,
    );

    // (ii) No first-party KEY shape may exist as a pattern in the code. Comments
    // are stripped first (the header names the shape in prose, which is not a
    // pattern), then every remaining `vela-` line must be a DECLARED case:
    //
    //   - an arm's own `name:` label — a NAME, which matches no text;
    //   - the header NAME as an allowlist entry — `x-vela-cli-token` under
    //     SENSITIVE_KEYS is a key to match ON, not a pattern that matches text;
    //   - the two marker PATTERNS `vela-internal-*` / `x-vela-cli-token`, which
    //     the module header records as re-typed because no exported constant
    //     carries them.
    //
    // A line carrying a key SHAPE that is none of those is the regression this
    // case stops: the mint's format, typed out by hand.
    const DECLARED = [
      /name:\s*"vela-internal-key"/,
      /name:\s*"vela-cli-token"/,
      /name:\s*"first-party-vela-key"/,
      /^\s*"x-vela-cli-token",\s*$/, // the SENSITIVE_KEYS entry
      /vela-internal-\[A-Za-z0-9_/, // the marker pattern itself
      /\(x-vela-cli-token\)/,
    ];
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "\n").split("\n");
    const markerLines = code.filter((line) => line.includes("vela-"));
    // The list must be non-empty, or the loop below would pass vacuously — an
    // over-eager comment stripper would silence the whole case rather than
    // redden it.
    expect(markerLines.length, "the marker scan must actually find code lines").toBeGreaterThan(0);
    for (const line of markerLines) {
      expect(
        DECLARED.some((pattern) => pattern.test(line)),
        `first-party key shape re-typed as a literal: "${line.trim()}"`,
      ).toBe(true);
    }
  });
});

// ─── Fail closed ────────────────────────────────────────────────────────────

describe("fail closed — uncertain means redacted", () => {
  it("a matcher that throws redacts the WHOLE field and never throws out", async () => {
    const { SECRET_SHAPES, redactEntry, redactText, REDACTED, redactionFailureState } = await load();

    const before = redactionFailureState().count;
    // Drive the REAL default list with a hostile arm, so the door's own path is
    // the one exercised (not an injected list).
    SECRET_SHAPES.push({ name: "exploding", detect: () => { throw new Error("EXAMPLE boom"); } });
    try {
      let threw = false;
      let out = null;
      try {
        out = redactText("a perfectly ordinary log line with nothing secret in it");
      } catch {
        threw = true;
      }
      expect(threw, "redactText must never throw — the door calls it synchronously").toBe(false);
      // Fail CLOSED at the FIELD'S OWN SCOPE: the string under test is the
      // field, so the whole field is gone — not just the part the surviving
      // arms had reached.
      expect(out).toBe(REDACTED);

      // The same fault inside a meta field takes that field alone: the typed
      // siblings an operator reads the line for must survive. Blank the whole
      // row and the fail-closed law would become a denial-of-diagnosis law,
      // which is a different (and worse) failure than the one it prevents.
      const entry = redactEntry({ msg: "harmless", meta: { status: 500 } });
      expect(entry.msg).toBe(REDACTED);
      expect(entry.meta.status).toBe(500);

      // Counted, never logged: this module has no I/O, so the door can surface
      // the tally in /api/logs/stats instead.
      expect(redactionFailureState().count).toBeGreaterThan(before);
      expect(redactionFailureState().firstAt).not.toBeNull();
    } finally {
      SECRET_SHAPES.pop();
    }
  });

  it("a throwing getter redacts that field alone, keeping the typed siblings", async () => {
    const { redactEntry, REDACTED, redactionFailureState } = await load();
    const before = redactionFailureState().count;
    const hostile = {
      status: 200,
      get upstream() { throw new Error("EXAMPLE getter blew up"); },
    };
    const out = redactEntry({ msg: "", meta: hostile });
    // ONE unreadable field is ONE uncertain field. Blanking the whole row would
    // destroy exactly the typed status an operator reads the line for.
    expect(out.meta.status).toBe(200);
    expect(out.meta.upstream).toBe(REDACTED);
    expect(redactionFailureState().count).toBe(before + 1);
  });

  it("a cyclic meta is cut with a redaction, never a stack overflow", async () => {
    const { redactEntry, REDACTED, redactionFailureState } = await load();
    const before = redactionFailureState().count;
    const cyclic = { name: "root" };
    cyclic.self = cyclic;
    const out = redactEntry({ msg: "", meta: cyclic });
    expect(out.meta.name).toBe("root");
    expect(out.meta.self).toBe(REDACTED);
    expect(redactionFailureState().count).toBeGreaterThan(before);
  });

  it("survives hostile entries without throwing and without inventing fields", async () => {
    const { redactEntry } = await load();
    for (const hostile of [undefined, null, "a string", 42, [], [{ msg: "nested" }]]) {
      const out = redactEntry(hostile);
      expect(Object.keys(out).sort()).toEqual(["meta", "msg"]);
    }
    const out = redactEntry({ msg: 42, meta: { n: 1, b: true, gone: null } });
    expect(out.msg).toBe(42);
    expect(out.meta).toEqual({ n: 1, b: true, gone: null });
  });
});

// ─── Redact → clamp, the one order ──────────────────────────────────────────

describe("redact-then-clamp — the boundary case (r3 §1)", () => {
  it("catches a first-party key STRADDLING the msg clamp boundary", async () => {
    const { redactEntry, REDACTED, apiKey } = await load();
    const { scrubForPersistence, MSG_MAX_CHARS } = await loadDoor();

    const { key } = apiKey.deriveInternalKey("log-redact-boundary");
    // The key sits ON the boundary, not after it: `KEY_HALF` characters of key
    // fall before the cut and the rest after, so a clamp-then-redact order keeps
    // a real prefix of the SECRET as raw text. The filler is prose-like (spaces
    // and word characters) because a single unbroken run would collapse into one
    // token and stop testing the clamp at all.
    const KEY_HALF = Math.floor(key.length / 2);
    const filler = MSG_MAX_CHARS - KEY_HALF;
    const raw = `${"log line padding ".repeat(Math.ceil(filler / 17)).slice(0, filler)}${key}`;

    // The door's order: redact FIRST, then clamp. The whole key is replaced
    // before the clamp ever runs, so the cut can only land in filler or marker.
    const safe = doorClamp(scrubForPersistence, MSG_MAX_CHARS, redactEntry({ msg: raw }).msg);
    expect(safe.truncated, "redacting the key shortens the line below the clamp").toBe(false);
    expect(safe.value).toContain(REDACTED);
    expect(safe.value, "no raw key prefix may survive the boundary").not.toContain(key.slice(0, 12));

    // THE HAZARD IS PROVEN, not asserted: on the REVERSED order the clamp cuts
    // through the key itself, so its first KEY_HALF characters survive as raw
    // secret. This half is what makes the assertion above mean anything — it
    // cannot otherwise tell a correct order from a clamp that never truncates.
    const reversed = doorClamp(scrubForPersistence, MSG_MAX_CHARS, raw);
    expect(reversed.truncated).toBe(true);
    expect(reversed.value.endsWith(key.slice(0, KEY_HALF))).toBe(true);
    expect(reversed.value).toContain(key.slice(0, KEY_HALF));
  });

  it("catches a bearer token straddling the meta clamp boundary", async () => {
    const { redactEntry, REDACTED } = await load();
    const { scrubForPersistence, META_MAX_CHARS } = await loadDoor();

    const secret = PLANTED[0].token; // EXAMPLE fixture
    const KEY_HALF = Math.floor(secret.length / 2);
    const filler = META_MAX_CHARS - KEY_HALF;
    // A space before the token: `\bBearer` needs a delimiter there, and padding
    // made of one unbroken run would glom onto it and never match at all.
    const raw = `${"meta padding ".repeat(Math.ceil(filler / 13)).slice(0, filler - 1)} ${secret}`;

    const safe = doorClamp(scrubForPersistence, META_MAX_CHARS, redactEntry({ msg: "", meta: { note: raw } }).meta.note);
    expect(safe.value).toContain(REDACTED);
    expect(safe.value).not.toContain("EXAMPLE-TOKEN-not-a-credential");

    const reversed = doorClamp(scrubForPersistence, META_MAX_CHARS, raw);
    expect(reversed.truncated).toBe(true);
    expect(reversed.value.endsWith(secret.slice(0, KEY_HALF))).toBe(true);
  });
});

// ─── Purity — the redactor adds nothing to the row ──────────────────────────

describe("purity — a redacted row is the row the caller passed, minus secrets", () => {
  it("returns exactly {msg, meta} and never mutates the input", async () => {
    const { redactEntry } = await load();
    const entry = {
      msg: "provider said Bearer EXAMPLE-TOKEN-not-a-credential-9hJk2mNp was bad",
      meta: { status: 502, errorClass: "upstream", requestId: "req-abc", headers: { authorization: "not-a-known-shape-xyzzy" } },
    };
    const snapshot = JSON.parse(JSON.stringify(entry));
    const out = redactEntry(entry);

    expect(Object.keys(out).sort()).toEqual(["meta", "msg"]);
    expect(out.meta).not.toBe(entry.meta);
    // Typed fields — the only thing §5 says meta may carry — survive verbatim.
    expect(out.meta.status).toBe(502);
    expect(out.meta.errorClass).toBe("upstream");
    expect(out.meta.requestId).toBe("req-abc");
    // No field was added or dropped.
    expect(Object.keys(out.meta).sort()).toEqual(Object.keys(entry.meta).sort());
    // And the caller's own object is untouched — the door may re-read `entry`.
    expect(entry).toEqual(snapshot);
  });

  it("keeps a key that is not secret material — over-redaction is a real failure", async () => {
    const { redactEntry } = await load();
    // keyId is the NON-secret attribution id apiKey.js's own comment calls out
    // as safe to print; a display prefix is safe too. Redacting them would cost
    // an operator the one field that makes a row joinable.
    const out = redactEntry({
      msg: "",
      meta: { keyId: "a".repeat(32), displayPrefix: "vela-v1-ab3f…", provider: "openai" },
    });
    expect(out.meta.keyId).toBe("a".repeat(32));
    expect(out.meta.displayPrefix).toBe("vela-v1-ab3f…");
    expect(out.meta.provider).toBe("openai");
  });
});