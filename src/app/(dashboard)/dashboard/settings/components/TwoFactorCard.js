"use client";
// Two-factor — the second lock on the dashboard's door.
//
// The card draws its state from GET /api/auth/totp (booleans + a count, never a
// secret) and offers three arcs, each ending where the server decides:
//
//   not enrolled → enroll (secret + otpauth:// URI) → enter a code → activate
//                  → the ONCE-ONLY backup-code sheet, with a copy button
//   enrolled     → status + remaining codes, regenerate (needs a code) and
//                  disable (needs a code)
//
// Two laws this card keeps, because the server's are worthless if the screen
// lies about them:
//   • the plaintext backup codes exist only in this component's state, for one
//     render cycle — the server never sends them again, so neither do we
//   • a wrong code is the server's to refuse; the card passes the message back
//     verbatim rather than guessing, so lockout counting stays in one place
//
// Reuses the room's shared parts (Card, Button, Input) and its StatusLine, so
// this room reads as one room rather than a stranger's furniture.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";
import StatusLine from "./StatusLine";

const ENDPOINT = "/api/auth/totp";

async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function TwoFactorCard() {
  const [state, setState] = useState({ enabled: false, enrolled: false, backupCodesRemaining: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  // The enrollment in flight: secret + URI live only until activation.
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  // The one-time sheet. `null` means "not currently shown".
  const [backupCodes, setBackupCodes] = useState(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({
          enabled: data.enabled === true,
          enrolled: data.enrolled === true,
          backupCodesRemaining: Number(data.backupCodesRemaining || 0),
        });
      }
    } catch {
      /* fail-open — the card never breaks the page */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const run = async (fn) => {
    setBusy(true);
    setStatus({ type: "", message: "" });
    setCopied(false);
    try {
      await fn();
    } catch {
      setStatus({ type: "error", message: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  const enroll = () =>
    run(async () => {
      const { ok, data } = await postJson(ENDPOINT, { action: "enroll" });
      if (!ok) {
        setStatus({ type: "error", message: data.error || "Could not begin enrollment." });
        return;
      }
      setPending({ secret: data.secret, uri: data.uri });
      setCode("");
      setBackupCodes(null);
    });

  const activate = () =>
    run(async () => {
      const { ok, data } = await postJson(ENDPOINT, { action: "activate", code });
      if (!ok) {
        setStatus({ type: "error", message: data.error || "That code did not verify." });
        return;
      }
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setPending(null);
      setCode("");
      setStatus({ type: "success", message: "Two-factor is on. Save your backup codes now — they are shown once." });
      await refresh();
    });

  const disable = () =>
    run(async () => {
      const { ok, data } = await postJson(ENDPOINT, { action: "disable", code });
      if (!ok) {
        setStatus({ type: "error", message: data.error || "That code did not verify." });
        return;
      }
      setCode("");
      setBackupCodes(null);
      setStatus({ type: "success", message: "Two-factor is off." });
      await refresh();
    });

  const regenerate = () =>
    run(async () => {
      const { ok, data } = await postJson(`${ENDPOINT}/backup-codes`, { action: "regenerate", code });
      if (!ok) {
        setStatus({ type: "error", message: data.error || "That code did not verify." });
        return;
      }
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setCode("");
      setStatus({ type: "success", message: "New backup codes minted. The old sheet is now dead." });
      await refresh();
    });

  const copyCodes = async () => {
    if (!backupCodes?.length) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
    } catch {
      setStatus({ type: "error", message: "Could not copy — select the codes and copy them by hand." });
    }
  };

  // Which arc the card is in.
  const showingCodes = Array.isArray(backupCodes);
  const enrolling = !!pending;
  const halfEnrolled = !state.enabled && state.enrolled;
  const needsEnroll = !state.enabled && !state.enrolled;

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-xl leading-none">passkey</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Two-factor authentication</h3>
          <p className="text-sm text-text-muted mt-0.5">
            A code from your authenticator app, on top of your password.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Reading the lock…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ── Arc 1: first enrollment (or a half-enrolled row) ───────── */}
          {!state.enabled && (needsEnroll || halfEnrolled) && (
            <>
              {!enrolling && !showingCodes && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-text-muted">
                    {halfEnrolled
                      ? "Enrollment was started but never confirmed. Begin again to get a fresh secret."
                      : "Not enabled. Adding a second factor protects this dashboard if your password leaks."}
                  </p>
                  <Button variant="primary" size="sm" onClick={enroll} loading={busy}>
                    {halfEnrolled ? "Restart enrollment" : "Enable 2FA"}
                  </Button>
                </div>
              )}

              {enrolling && (
                <div className="flex flex-col gap-3 pt-3 border-t border-border-subtle">
                  <p className="text-sm text-text-main">
                    Scan or enter this secret in your authenticator app, then enter the 6-digit code it shows.
                  </p>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">Secret (base32)</span>
                    <code className="font-mono text-sm break-all rounded-[8px] bg-surface-2 px-3 py-2 select-all">
                      {pending.secret}
                    </code>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">otpauth URI (for a QR viewer)</span>
                    <code className="font-mono text-xs break-all rounded-[8px] bg-surface-2 px-3 py-2 select-all">
                      {pending.uri}
                    </code>
                  </div>
                  <Input
                    label="Verification code"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="primary" onClick={activate} loading={busy} disabled={!code.trim()}>
                      Activate
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPending(null);
                        setCode("");
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Arc 2: enrolled ─────────────────────────────────────────── */}
          {state.enabled && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-400">
                  enabled
                </span>
                <span className="text-sm text-text-muted">
                  {state.backupCodesRemaining} backup code{state.backupCodesRemaining === 1 ? "" : "s"} remaining
                </span>
              </div>

              {/* The one-time sheet. The plaintext lives in state alone — the
                  server sent it once and will never send it again, so "I have
                  saved them" is the only way it ever leaves this screen. */}
              {showingCodes && (
                <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3 flex flex-col gap-3">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Save these {backupCodes.length} backup codes somewhere safe. Each works once, and
                    they will not be shown again.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 font-mono text-sm text-text-main">
                    {backupCodes.map((c) => (
                      <span key={c} className="px-2 py-1 rounded bg-surface-2 select-all">{c}</span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={copied ? "check" : "content_copy"} onClick={copyCodes}>
                      {copied ? "Copied" : "Copy codes"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setBackupCodes(null)}>
                      I have saved them
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-3 border-t border-border-subtle">
                <Input
                  label="Code to confirm"
                  hint="A code from your app, or one remaining backup code."
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={regenerate} loading={busy} disabled={!code.trim()}>
                    Regenerate backup codes
                  </Button>
                  <Button variant="danger" onClick={disable} loading={busy} disabled={!code.trim()}>
                    Disable 2FA
                  </Button>
                </div>
              </div>
            </>
          )}

          <StatusLine status={status} />
        </div>
      )}
    </Card>
  );
}
