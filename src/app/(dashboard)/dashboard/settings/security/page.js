"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import SecuritySection from "../components/SecuritySection";

export default function SecurityPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    patch: ctx.patch,
    toggle: ctx.toggle,
    setString: ctx.setString,
    setNumber: ctx.setNumber,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="text-sm text-text-muted mt-1">
          Require login, password, session timeout, IP allowlist, brute-force
          lockout, security headers, alerts, and audit logging.
        </p>
      </div>
      <SecuritySection {...sp} />
    </div>
  );
}