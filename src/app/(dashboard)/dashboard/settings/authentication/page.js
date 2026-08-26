"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import SSOSection from "../components/SSOSection";

export default function AuthenticationPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    patch: ctx.patch,
    toggle: ctx.toggle,
    setString: ctx.setString,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Authentication</h1>
        <p className="text-sm text-text-muted mt-1">
          Auth mode (password / SSO / both), OIDC, SAML 2.0 identity provider
          configuration, and API key requirement.
        </p>
      </div>
      <SSOSection {...sp} />
    </div>
  );
}