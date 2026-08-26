"use client";

import { useState } from "react";
import { Toggle, Button, Input } from "@/shared/components";
import SettingsSection, { SettingsRow } from "./SettingsSection";

export default function SecuritySection({ settings, loading, patch, toggle, setNumber, setString }) {
  if (!settings) return null;

  return (
    <SettingsSection icon="shield" title="Security" accent="red">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Require login" desc="When ON, dashboard requires password. When OFF, access without login.">
          <Toggle checked={settings.requireLogin === true} onChange={() => toggle("requireLogin")} disabled={loading} />
        </SettingsRow>

        {settings.requireLogin && (
          <PasswordForm hasPassword={!!settings.hasPassword} loading={loading} patch={patch} />
        )}

        <hr className="border-border/50" />

        <SettingsRow label="Session timeout" desc="Idle minutes before auto-logout (0 = never expire)">
          <Input type="number" min="0" max="10080" value={settings.sessionTimeoutMins ?? 0}
            onChange={(e) => setNumber("sessionTimeoutMins", e.target.value)} disabled={loading} className="w-20 text-center" />
        </SettingsRow>

        <div>
          <label className="font-medium text-sm block mb-1">Dashboard IP Allowlist</label>
          <p className="text-xs text-text-muted mb-2">Comma-separated IPs/CIDRs. Leave empty for all.</p>
          <Input placeholder="192.168.1.0/24, 10.0.0.5" value={settings.ipAllowlist || ""}
            onChange={(e) => setString("ipAllowlist", e.target.value)} disabled={loading} />
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <SettingsRow label="Brute-force lockout" desc="Lock login after repeated failed attempts">
            <Toggle checked={settings.bruteForceLockout !== false} onChange={() => toggle("bruteForceLockout")} disabled={loading} />
          </SettingsRow>
          <SettingsRow label="Security headers" desc="HSTS, CSP, X-Frame-Options, etc.">
            <Toggle checked={settings.securityHeadersEnabled !== false} onChange={() => toggle("securityHeadersEnabled")} disabled={loading} />
          </SettingsRow>
          <SettingsRow label="Security alerts" desc="Notify on failed logins and new sessions">
            <Toggle checked={settings.securityAlerts === true} onChange={() => toggle("securityAlerts")} disabled={loading} />
          </SettingsRow>
        </div>

        <hr className="border-border/50" />

        <SettingsRow label="Audit enabled" desc="Log security-relevant events">
          <Toggle checked={settings.auditEnabled !== false} onChange={() => toggle("auditEnabled")} disabled={loading} />
        </SettingsRow>
        {settings.auditEnabled !== false && (
          <SettingsRow label="Audit retention" desc="Days to keep audit log entries">
            <Input type="number" min="1" max="3650" value={settings.auditRetentionDays ?? 90}
              onChange={(e) => setNumber("auditRetentionDays", e.target.value)} disabled={loading} className="w-20 text-center" />
          </SettingsRow>
        )}
      </div>
    </SettingsSection>
  );
}

function PasswordForm({ hasPassword, loading, patch }) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });

  const submit = async (e) => {
    e.preventDefault();
    if (newPw !== confirm) { setMsg({ type: "error", message: "Passwords do not match" }); return; }
    setBusy(true); setMsg({ type: "", message: "" });
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ type: "success", message: "Password updated" });
      setCurrent(""); setNewPw(""); setConfirm("");
    } else {
      setMsg({ type: "error", message: data.error || "Failed to update password" });
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 pt-2 border-t border-border/50">
      {hasPassword && (
        <div>
          <label className="text-xs font-medium block mb-1">Current Password</label>
          <Input type="password" placeholder="Enter current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">New Password</label>
          <Input type="password" placeholder="Enter new password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Confirm</label>
          <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
      </div>
      {msg.message && <p className={`text-xs ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>{msg.message}</p>}
      <Button type="submit" variant="primary" loading={busy} className="w-full sm:w-auto">
        {hasPassword ? "Update Password" : "Set Password"}
      </Button>
    </form>
  );
}