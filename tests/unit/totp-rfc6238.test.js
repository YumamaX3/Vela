// RFC 6238 vectors against src/lib/auth/totp.js — the arithmetic, proven.
//
// The second lock is only as strong as the six digits it mints. An arithmetic
// bug here is silent: codes would still look right and a real authenticator
// would simply never match. So the module is checked against the RFC's OWN
// ground truth — Appendix B's SHA-1 table (the 8-digit column; the 6-digit
// column is asserted as well, since the app ships 6) — plus the three laws the
// house builds on top: base32 is lossless, verification tolerates exactly ±1
// step of drift, and the otpauth URI carries the secret an app must read.
import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUri,
  counterAt,
} from "../../src/lib/auth/totp.js";

// The RFC 6238 Appendix B seed, exactly as published.
const RFC_SEED_ASCII = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = base32Encode(RFC_SEED_ASCII); // GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ

// Appendix B — SHA-1, the only algorithm the app ships. The RFC's 8-digit
// column is the published truth; the 6-digit column is its own table in the
// same appendix (the last 6 of each 8-digit code).
const VECTORS_SHA1 = [
  { t: 59, eight: "94287082", six: "287082" },
  { t: 1111111109, eight: "07081804", six: "081804" },
  { t: 1111111111, eight: "14050471", six: "050471" },
  { t: 1234567890, eight: "89005924", six: "005924" },
  { t: 2000000000, eight: "69279037", six: "279037" },
  { t: 20000000000, eight: "65353130", six: "353130" },
];

describe("totp.js — RFC 6238 Appendix B vectors (SHA-1)", () => {
  for (const v of VECTORS_SHA1) {
    it(`T=${v.t}s → 8 digits ${v.eight}, 6 digits ${v.six}`, () => {
      // 8-digit: the RFC's published column, straight through hotp() with the
      // RFC's own counter — T/30, FLOORED (T=59 is step 1, not 1.97).
      expect(hotp(RFC_SECRET, Math.floor(v.t / 30), { digits: 8 })).toBe(v.eight);
      // 6-digit: the shape the app ships, via totp() with the RFC's instant.
      expect(totp(RFC_SECRET, v.t * 1000, { digits: 6 })).toBe(v.six);
    });
  }

  it("counterAt is the RFC's T = floor((now - T0) / X)", () => {
    for (const v of VECTORS_SHA1) {
      expect(counterAt(v.t * 1000, 30)).toBe(Math.floor(v.t / 30));
    }
  });
});

describe("totp.js — the base32 seam an authenticator app reads", () => {
  it("encodes the RFC seed exactly as the published secret", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("round-trips bytes → base32 → bytes losslessly", () => {
    for (let n = 1; n <= 40; n++) {
      const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff));
      expect(Buffer.compare(base32Decode(base32Encode(bytes)), bytes)).toBe(0);
    }
  });

  it("tolerates whitespace, padding and lowercase on decode (a pasted secret)", () => {
    const messy = " gezd gnbv gy3t qojq gezd gnbv gy3t qojq == ";
    expect(base32Decode(messy).toString("ascii")).toBe("12345678901234567890");
  });

  it("throws on an illegal character rather than silently decoding another secret", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow(/illegal character/);
  });

  it("generateSecret mints 160 bits (RFC 4226's recommended length)", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(secret).length).toBe(20);
    expect(generateSecret()).not.toBe(secret);
  });
});

describe("totp.js — verification window and comparison", () => {
  const now = 1_234_567_890 * 1000;
  const current = totp(RFC_SECRET, now);

  it("accepts the current step", () => {
    expect(verifyTotp(RFC_SECRET, current, now)).toEqual({ ok: true, step: counterAt(now) });
  });

  it("accepts ±1 step of drift (RFC 6238 §5.2's window)", () => {
    const prev = totp(RFC_SECRET, now - 30_000);
    const next = totp(RFC_SECRET, now + 30_000);
    expect(verifyTotp(RFC_SECRET, prev, now).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, next, now).ok).toBe(true);
  });

  it("refuses ±2 steps of drift", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 60_000), now).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 60_000), now).ok).toBe(false);
  });

  it("refuses malformed input without throwing", () => {
    for (const bad of ["", null, undefined, "12345", "1234567", "abcdef", "12 34 5"]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toEqual({ ok: false, step: null });
    }
  });

  it("refuses a code from a different secret", () => {
    const other = generateSecret();
    expect(verifyTotp(other, current, now).ok).toBe(false);
  });
});

describe("totp.js — the otpauth URI", () => {
  it("carries the secret, the account, and the issuer in the Key URI format", () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: "admin", issuer: "Vela" });
    expect(uri.startsWith("otpauth://totp/Vela:admin?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe(RFC_SECRET);
    expect(params.get("issuer")).toBe("Vela");
    expect(params.get("algorithm")).toBe("SHA1");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});
