"use client";

import { useState, useEffect, useMemo } from "react";
import { Button, Input, ThemeToggle } from "@/shared/components";

// ── Deterministic starfield ─────────────────────────────────────────────
// Module-scope so the sky is identical on every render (no hydration
// jitter, no StrictMode reshuffle). mulberry32 keeps it seed-stable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededStars(seed, count) {
  const rnd = mulberry32(seed * 7919);
  return Array.from({ length: count }, () => ({
    left: (rnd() * 100).toFixed(2),
    top: (rnd() * 100).toFixed(2),
    delay: (rnd() * 7).toFixed(2),
  }));
}
const STAR_LAYERS = [
  { cls: "layer-1", stars: seededStars(1, 55) },
  { cls: "layer-2", stars: seededStars(2, 32) },
  { cls: "layer-3", stars: seededStars(3, 18) },
];

// ── The Vela constellation — the sail of Argo Navis ────────────────────
// Positions in % of the constellation box; γ Vel is the sail's brightest.
const VELA_STARS = [
  { x: 75, y: 22.5, size: 7, bright: true, name: "γ Vel" },
  { x: 37.5, y: 15, size: 5, bright: false, name: "δ Vel" },
  { x: 22.5, y: 45, size: 4, bright: false, name: "μ Vel" },
  { x: 30, y: 75, size: 4, bright: false, name: "φ Vel" },
  { x: 70, y: 82.5, size: 6, bright: true, name: "κ Vel" },
  { x: 82.5, y: 55, size: 5, bright: false, name: "λ Vel" },
];

const LOCK_MAX_ATTEMPTS = 5; // mirrors loginLimiter MAX_FAILS_BEFORE_LOCK

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [lockTotal, setLockTotal] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState(LOCK_MAX_ATTEMPTS);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState("Sign in with SAML SSO");
  // Tag 3: true once /api/auth/status reports no password configured
  // anywhere (no stored hash, no INITIAL_PASSWORD env). The login page is
  // only reachable on a loopback console in that state — the card explains
  // entry is frictionless instead of advertising a default password.
  const [unconfigured, setUnconfigured] = useState(false);

  // Footer status — version + gateway health, polled gently
  const [version, setVersion] = useState(null);
  const [gatewayOk, setGatewayOk] = useState(null);

  // Countdown for rate-limit lockout
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            window.location.assign("/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
          setUnconfigured(!(data.hasPassword || data.hasInitialPassword));
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSamlConfigured(data.samlConfigured === true);
          setSamlLoginLabel(data.samlLoginLabel || "Sign in with SAML SSO");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, []);

  // Footer telemetry — version once, health every 30s
  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVersion(d?.currentVersion || null))
      .catch(() => setVersion(null));
    const probeHealth = () =>
      fetch("/api/health")
        .then((r) => setGatewayOk(r.ok))
        .catch(() => setGatewayOk(false));
    probeHealth();
    const id = setInterval(probeHealth, 30000);
    return () => clearInterval(id);
  }, []);

  // Tag 3: an unconfigured install is only reachable on the loopback console —
  // the server admits such logins with no credential (frictionless, today's
  // posture) and hands back the session cookie.
  const handleFrictionlessEntry = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) openGate();
      else {
        const data = await res.json();
        setError(data.error || "An error occurred. Please try again.");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openGate = () => {
    setSuccess(true);
    setTimeout(() => window.location.assign("/dashboard"), 750);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        openGate();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) {
          const secs = Number(data.retryAfter);
          setRetryAfter(secs);
          setLockTotal(secs);
          setAttemptsLeft(0);
        } else if (typeof data.remainingBeforeLock === "number") {
          setAttemptsLeft(Math.max(0, data.remainingBeforeLock));
        }
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const handleSamlLogin = () => {
    window.location.href = "/api/auth/saml/start";
  };

  const trackCapsLock = (e) => {
    if (typeof e.getModifierState === "function") {
      setCapsLockOn(e.getModifierState("CapsLock"));
    }
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSsoType = ssoType || (authMode === "saml" ? "saml" : "oidc");

  const samlAvailable = isSsoEnabled && activeSsoType === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSsoType === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;

  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  const attemptsSpent = useMemo(
    () => Array.from({ length: LOCK_MAX_ATTEMPTS }, (_, i) => i >= attemptsLeft),
    [attemptsLeft]
  );
  const hasFailed = attemptsLeft < LOCK_MAX_ATTEMPTS || retryAfter > 0;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="login-page flex items-center justify-center p-4">
        <div className="relative z-10 text-center">
          <div className="login-crest inline-flex items-center justify-center">
            <img src="/vela-logo.svg" alt="Vela" className="size-14 animate-pulse" width={56} height={56} />
          </div>
          <p className="text-text-muted mt-4 text-sm">Charting the harbor…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page flex flex-col">
      {/* Sky layers */}
      <div className="login-grid" aria-hidden="true" />
      {STAR_LAYERS.map((layer) => (
        <div key={layer.cls} className={`login-stars ${layer.cls}`} aria-hidden="true">
          {layer.stars.map((s, i) => (
            <i
              key={i}
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
        </div>
      ))}

      {/* Theme toggle — top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle variant="card" />
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left — the constellation panel (desktop) */}
          <div className="hidden lg:flex flex-col gap-8 select-none">
            <div>
              <div className="flex items-center gap-4 mb-5">
                <div className="login-crest size-16 flex items-center justify-center">
                  <img src="/vela-logo.svg" alt="Vela" className="size-16" width={64} height={64} />
                </div>
                <div>
                  <h1 className="text-4xl font-bold tracking-tight text-text-main">Vela</h1>
                  <p className="text-sm text-brand-400 font-medium tracking-wide">THE HARBOR GATE</p>
                </div>
              </div>
              <p className="text-text-muted max-w-md leading-relaxed">
                One endpoint for every provider — forty-plus upstreams, routed,
                translated, and governed behind a single OpenAI-compatible gate.
              </p>
            </div>

            {/* The sail of Argo Navis */}
            <div className="login-constellation relative w-72 h-72" aria-hidden="true">
              <svg className="sail-lines absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                <path
                  pathLength="1"
                  d="M75,22.5 L37.5,15 L22.5,45 L30,75 L70,82.5 L82.5,55 Z"
                />
                <path pathLength="1" style={{ animationDelay: "1.6s" }} d="M37.5,15 L82.5,55" />
              </svg>
              {VELA_STARS.map((star) => (
                <span
                  key={star.name}
                  className={`star ${star.bright ? "bright" : ""}`}
                  style={{
                    left: `${star.x}%`,
                    top: `${star.y}%`,
                    width: star.size,
                    height: star.size,
                    animationDelay: `${0.5 + star.y / 90}s`,
                  }}
                  title={star.name}
                />
              ))}
              <p className="absolute -bottom-6 left-0 right-0 text-center text-[11px] tracking-[0.25em] text-text-subtle uppercase">
                Vela · the sails of Argo Navis
              </p>
            </div>

            <div className="flex flex-col gap-3 text-sm">
              {[
                { icon: "route", text: "One OpenAI-compatible endpoint — /v1" },
                { icon: "vpn_key", text: "Keys hashed at rest, shown once, governed per-key" },
                { icon: "monitoring", text: "Live usage, tokens, and spend per key" },
              ].map((f) => (
                <div key={f.icon} className="flex items-center gap-3 text-text-muted">
                  <span className="material-symbols-outlined text-[18px] text-brand-400/80">{f.icon}</span>
                  {f.text}
                </div>
              ))}
            </div>
          </div>

          {/* Right — the auth card */}
          <div className="w-full max-w-md mx-auto lg:mx-0 lg:justify-self-start">
            {/* Mobile brand — the constellation panel is desktop-only */}
            <div className="lg:hidden text-center mb-6">
              <div className="login-crest inline-flex items-center justify-center mb-3">
                <img src="/vela-logo.svg" alt="Vela" className="size-16" width={64} height={64} />
              </div>
              <h1 className="text-3xl font-bold text-text-main">Vela</h1>
              <p className="text-xs text-brand-400 font-medium tracking-[0.25em] mt-1">THE HARBOR GATE</p>
            </div>

            <div className="login-card p-7 sm:p-8">
              {unconfigured ? (
                <div className="login-stagger flex flex-col gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-text-main">Welcome</h2>
                    <p className="text-sm text-text-muted mt-0.5">
                      No dashboard password is set yet. Entry is open on this
                      machine — set a password under Profile → Security to
                      enable remote access.
                    </p>
                  </div>
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <Button type="button" variant="primary" className="w-full" icon="login" loading={loading} onClick={handleFrictionlessEntry}>
                    Enter dashboard
                  </Button>
                </div>
              ) : (
                <div className="login-stagger flex flex-col gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-text-main">
                      {samlAvailable
                        ? "Single sign-on"
                        : oidcAvailable
                        ? "Single sign-on"
                        : "Welcome back"}
                    </h2>
                    <p className="text-sm text-text-muted mt-0.5">
                      {samlAvailable
                        ? "Sign in with SAML 2.0 to enter the dashboard."
                        : oidcAvailable
                        ? "Sign in with your OIDC provider to enter the dashboard."
                        : "Enter your password to enter the dashboard."}
                    </p>
                  </div>

                  {samlAvailable && (
                    <Button type="button" variant="primary" className="w-full" icon="verified_user" onClick={handleSamlLogin}>
                      {samlLoginLabel}
                    </Button>
                  )}

                  {oidcAvailable && (
                    <Button type="button" variant="primary" className="w-full" icon="badge" onClick={handleOidcLogin}>
                      {oidcLoginLabel}
                    </Button>
                  )}

                  {ssoAvailable && passwordAvailable && (
                    <div className="flex items-center gap-3 text-[11px] text-text-subtle">
                      <div className="h-px flex-1 bg-border/60" />
                      or with password
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                  )}

                  {passwordAvailable ? (
                    <form onSubmit={handleLogin} className="flex flex-col gap-4">
                      {isSsoEnabled && !ssoAvailable && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                          {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login is enabled, but configuration is incomplete. Password login is still available for recovery.
                        </p>
                      )}

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium" htmlFor="password">Password</label>
                          {hasFailed && retryAfter <= 0 && (
                            <span className="login-attempts" title={`${attemptsLeft} of ${LOCK_MAX_ATTEMPTS} attempts left before lockout`}>
                              {attemptsSpent.map((spent, i) => (
                                <i key={i} className={spent ? "spent" : ""} />
                              ))}
                            </span>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyUp={trackCapsLock}
                            onKeyDown={trackCapsLock}
                            error={error || undefined}
                            required
                            autoFocus={!oidcAvailable}
                            inputClassName="pr-11"
                          />
                          <button
                            type="button"
                            className="login-eye"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            title={showPassword ? "Hide password" : "Show password"}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {showPassword ? "visibility_off" : "visibility"}
                            </span>
                          </button>
                        </div>
                        {capsLockOn && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">keyboard_capslock</span>
                            Caps Lock is on
                          </p>
                        )}
                        {retryAfter > 0 && (
                          <div className="login-error flex flex-col gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[14px]">lock_clock</span>
                              Locked. Retry in <span className="font-mono font-semibold">{retryAfter}s</span>.
                            </p>
                            {lockTotal > 0 && (
                              <div className="overflow-hidden rounded-full">
                                <div
                                  key={lockTotal}
                                  className="login-lockout-bar"
                                  style={{ animationDuration: `${lockTotal}s` }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {resetHint && (
                          <p className="text-xs text-text-muted">
                            Forgot password? Open <code className="bg-sidebar px-1 rounded">Vela</code> CLI on the host → <b>Settings</b> → <b>Reset Password (clear)</b>, then set a new one from the local console.
                          </p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        variant="primary"
                        className="w-full"
                        icon={retryAfter > 0 ? "lock" : "login"}
                        loading={loading}
                        disabled={retryAfter > 0}
                      >
                        {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                      </Button>

                      <div className="flex flex-col gap-1.5 mt-1">
                        {hasPassword === false && (
                          <p className="text-xs text-center text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">warning</span>
                            Security risk: no password set. Remote access stays locked until one is set (Profile → Security).
                          </p>
                        )}
                      </div>
                    </form>
                  ) : (
                    error && <p className="text-xs text-red-500">{error}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer — gateway status */}
      <footer className="relative z-10 pb-4 px-4">
        <div className="flex items-center justify-center gap-2 text-[11px] text-text-subtle">
          <span className={`login-status-dot ${gatewayOk === true ? "ok" : gatewayOk === false ? "bad" : ""}`} />
          <span>
            {gatewayOk === true ? "Gateway online" : gatewayOk === false ? "Gateway unreachable" : "Checking gateway…"}
          </span>
          {version && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-mono">v{version}</span>
            </>
          )}
          <span className="opacity-40">·</span>
          <span>One endpoint, every provider</span>
        </div>
      </footer>

      {/* Success flash — the gate opens */}
      {success && (
        <div className="login-success-flash" aria-hidden="true">
          <span className="ring" />
          <span className="ring" style={{ animationDelay: "0.4s" }} />
          <div className="relative flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[56px] text-brand-400">verified</span>
            <p className="text-sm text-text-muted">Entering the harbor…</p>
          </div>
        </div>
      )}
    </div>
  );
}
