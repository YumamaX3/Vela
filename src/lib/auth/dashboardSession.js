import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { timingSafeEqual } from "@/shared/utils/timingSafeEqual.js";

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
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // A number here would be an ABSOLUTE NumericDate (seconds since epoch), not
    // a relative span — so express the shared window as a Date. Cookie maxAge
    // below still wants the raw seconds; both derive from SESSION_MAX_AGE_SEC.
    .setExpirationTime(new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000))
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
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
  const token = await createDashboardAuthToken(claims);
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
