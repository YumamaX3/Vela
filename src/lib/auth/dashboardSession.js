import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { timingSafeEqual } from "@/shared/utils/timingSafeEqual.js";
import { getAdapter } from "@/lib/db/driver.js";
import { getSessionRow } from "@/lib/db/repos/authStoreRepo.js";

// Tag 3 (M0 security foundation): the "123456" default password is retired.
// There is no longer any guessable fallback — an unset password cannot
// authenticate anyone, from any origin.

// Vela's own session cookie. Browsers key cookies by domain, NOT by port, so a
// cookie named `auth_token` (Vela's) is shared between both gateways when they
// run side by side on localhost — logging into one evicts the other. Vela's jar
// is its own (v0.6.12).
export const AUTH_COOKIE_NAME = "vela_auth_token";
// One source for the session window: the JWT exp AND the cookie maxAge both
// derive from this, so they can never drift apart again (ADR-004 — upstream
// 628ff1ea fixed the cookie but left the two values to be edited in tandem).
export const SESSION_MAX_AGE_SEC = 24 * 60 * 60; // 24h, in seconds

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  // Auth Hardening W1: every minted token carries its own `jti`, so the session
  // ledger has an identity to key its row by and a revocation has a name to use.
  // A caller-supplied jti wins (the SSO paths pass one they also record).
  const { jti = crypto.randomUUID(), ...rest } = claims || {};
  return new SignJWT({ authenticated: true, ...rest })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    // A number here would be an ABSOLUTE NumericDate (seconds since epoch), not
    // a relative span — so express the shared window as a Date. Cookie maxAge
    // below still wants the raw seconds; both derive from SESSION_MAX_AGE_SEC.
    .setExpirationTime(new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000))
    .sign(SECRET);
}

// ── The session ledger's veto (Auth Hardening W1) ──────────────────────────
//
// The dashboard JWT stays stateless, but a stateless token cannot be killed
// once issued. So the verifier consults the ledger — and because that consult
// sits on the hot path (every guarded request), its answer is memoised
// in-process for REVOCATION_TTL_MS. THE HONEST COST, NAMED: a revocation lands
// within the TTL, not instantly. Bounded staleness, never unbounded trust.
//
// FAIL-OPEN, deliberately: a store that cannot be read must never lock the
// operator out of their own dashboard. A token with no `jti` (minted before the
// ledger existed) or with no row (pruned) is NOT revoked — the ledger only ever
// ADDS a way to kill a session; it never retroactively invalidates one.
const REVOCATION_TTL_MS = 15_000;
const REVOCATION_CACHE_MAX = 5_000;
const revocationCache = new Map(); // jti -> { revoked, at }

export async function isSessionRevoked(jti) {
  if (!jti) return false;
  const now = Date.now();
  const hit = revocationCache.get(jti);
  if (hit && now - hit.at < REVOCATION_TTL_MS) return hit.revoked;
  let revoked = false;
  try {
    const db = await getAdapter();
    const row = getSessionRow(db, jti);
    revoked = Boolean(row && row.revokedAt);
  } catch {
    revoked = false; // fail-open — see the block comment above
  }
  if (revocationCache.size >= REVOCATION_CACHE_MAX) revocationCache.clear();
  revocationCache.set(jti, { revoked, at: now });
  return revoked;
}

/** Test hygiene: clears the memo so a test observes a fresh consult. */
export function resetRevocationCacheForTests() {
  revocationCache.clear();
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    // The ledger's veto, consulted only after the signature proved the token
    // is ours — an unsigned guess never reaches the store.
    if (await isSessionRevoked(payload?.jti)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  // The jti is minted HERE as well as in createDashboardAuthToken, so the caller
  // receives the session's identity without re-verifying what it just signed.
  const jti = claims?.jti || crypto.randomUUID();
  const token = await createDashboardAuthToken({ ...claims, jti });
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    // ADR-004 wound-fix (upstream 628ff1ea rebased): the JWT already dies at
    // 24h (setExpirationTime above); an unset maxAge made the cookie browser-
    // lifetime, so the jar outlived its own token — a dead cookie that only
    // fails on the next request. Pin the cookie to the token's window.
    maxAge: SESSION_MAX_AGE_SEC,
  });
  // Additive return (Auth Hardening W1): the login and SSO routes record their
  // ledger row from this. Every pre-existing caller ignored the void return, so
  // nothing they do changes.
  return { jti, expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000).toISOString() };
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete(AUTH_COOKIE_NAME);
}

// Verify the current dashboard password (re-auth for sensitive actions).
// Tag 3: a stored hash verifies via bcrypt; an INITIAL_PASSWORD env fallback
// compares in constant time; anything else is UNCONFIGURED and never
// authenticates (the old "123456" fallback is retired).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD;
  if (typeof initialPassword !== "string" || !initialPassword) return false;
  // Constant-time compare (house pattern) for the env fallback.
  return timingSafeEqual(password, initialPassword);
}
