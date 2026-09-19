"use client";
// SecurityTab — the three controls that decide whether this gateway is safe to
// expose, each stated as a fact rather than a mood. Nothing here is inferred:
// every row reads a value the controller already loaded from /api/settings.
//
// R-31 / R-22: the status pill is SEMANTIC — it reports one of two measured
// states, and its meaning is carried in words, not only in colour (WCAG 1.4.1).
// The dials are Toggle, the house primitive, not a bespoke switch.
// Contrast: pill ink is green-700 / amber-700 on a 10% wash (measured in the
// Delivery Gate); body copy is --color-text-main on --color-surface.
import { Card, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import SecurityWarning from "../endpoint/SecurityWarning";
import Tooltip from "../endpoint/Tooltip";

/** One control: what it is, whether it is on, and why it matters. */
function ControlRow({ icon, title, description, checked, onChange, onLabel, offLabel, warn, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-border-subtle last:border-b-0">
      <div className="flex items-start gap-3 min-w-0">
        <span className="material-symbols-outlined text-[18px] text-brand-500 shrink-0 mt-0.5" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{title}</p>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                checked
                  ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
              }`}
            >
              {checked ? onLabel : offLabel}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function SecurityTab({ c }) {
  const {
    requireApiKey, handleRequireApiKey,
    requireLogin, hasPassword,
    isRemoteHost, tunnelEnabled, tsEnabled,
    tunnelDashboardAccess, handleTunnelDashboardAccess,
    isLoginUnsafe, unsafeReason,
  } = c;

  const exposed = tunnelEnabled || tsEnabled;
  const unmet = [
    !requireApiKey,
    !requireLogin,
    requireLogin && !hasPassword,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      {/* The verdict first — one line the operator can act on */}
      <div
        className={`rounded-[14px] border p-4 flex items-start gap-3 ${
          unmet === 0
            ? "border-green-500/30 bg-green-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}
      >
        <span
          className={`material-symbols-outlined text-[20px] shrink-0 ${
            unmet === 0 ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"
          }`}
          aria-hidden="true"
        >
          {unmet === 0 ? "verified_user" : "shield"}
        </span>
        <div>
          <p className="text-sm font-semibold">
            {unmet === 0
              ? translate("This gateway is gated")
              : `${unmet} ${translate(unmet === 1 ? "control needs attention" : "controls need attention")}`}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {exposed
              ? translate("A remote transport is currently enabled.")
              : translate("No remote transport is enabled — nothing is exposed to the network yet.")}
          </p>
        </div>
      </div>

      {isLoginUnsafe && (
        <SecurityWarning
          message={unsafeReason}
          action={{ label: translate("Open settings"), href: "/dashboard/profile" }}
        />
      )}

      <Card>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-500" aria-hidden="true">shield_lock</span>
          {translate("Access controls")}
        </h2>
        <p className="text-xs text-text-muted mb-2">
          {translate("These decide whether a request that reaches the gateway is allowed through.")}
        </p>

        <ControlRow
          icon="vpn_key"
          title={translate("Require API key")}
          description={translate("Requests without a valid key are rejected with 401.")}
          checked={requireApiKey}
          onChange={() => handleRequireApiKey(!requireApiKey)}
          onLabel={translate("On")}
          offLabel={translate("Off")}
        />

        <div className="flex items-start justify-between gap-4 py-4 border-b border-border-subtle last:border-b-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="material-symbols-outlined text-[18px] text-brand-500 shrink-0 mt-0.5" aria-hidden="true">
              password
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">{translate("Require dashboard login")}</p>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    requireLogin && hasPassword
                      ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                  }`}
                >
                  {requireLogin && hasPassword ? translate("On") : translate("Attention")}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                {hasPassword
                  ? translate("The dashboard is protected by your own password.")
                  : translate("The dashboard still uses the default password — change it in Profile.")}
              </p>
            </div>
          </div>
          <a
            href="/dashboard/profile"
            className="shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-700 dark:text-brand-300 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] rounded"
          >
            <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">settings</span>
            {translate("Profile")}
          </a>
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mt-3">
            <SecurityWarning message={translate("Endpoint is exposed without an API key.")} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-500" aria-hidden="true">router</span>
          {translate("Remote transports")}
        </h2>
        <p className="text-xs text-text-muted mb-2">
          {translate("A transport that is on makes this gateway reachable beyond this machine.")}
        </p>

        <div className="flex items-center gap-3 py-4 border-b border-border-subtle">
          <span className="material-symbols-outlined text-[18px] text-brand-500 shrink-0" aria-hidden="true">cloud_upload</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Cloudflare Tunnel</p>
            <p className="text-xs text-text-muted">
              {tunnelEnabled ? translate("Enabled — reachable from the public internet.") : translate("Disabled.")}
            </p>
          </div>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
              tunnelEnabled
                ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                : "bg-surface-2 text-text-muted border-border-subtle"
            }`}
          >
            {tunnelEnabled ? translate("On") : translate("Off")}
          </span>
        </div>

        <div className="flex items-center gap-3 py-4 border-b border-border-subtle">
          <span className="material-symbols-outlined text-[18px] text-brand-500 shrink-0" aria-hidden="true">vpn_lock</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Tailscale Funnel</p>
            <p className="text-xs text-text-muted">
              {tsEnabled ? translate("Enabled — reachable on your tailnet.") : translate("Disabled.")}
            </p>
          </div>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
              tsEnabled
                ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                : "bg-surface-2 text-text-muted border-border-subtle"
            }`}
          >
            {tsEnabled ? translate("On") : translate("Off")}
          </span>
        </div>

        {exposed && (
          <div className="pt-4 flex items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm">{translate("Allow dashboard access via tunnel")}</p>
              <Tooltip text={translate("When enabled, the dashboard can be reached through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel is blocked entirely.")} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
