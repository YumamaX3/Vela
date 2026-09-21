"use client";
// OverviewTab — the room's answer to one question: "is my gateway reachable,
// and from where?" Three transport postures, the two security controls that
// decide whether those transports are safe to switch on, and a live
// paste-ready snippet so a client can be pointed here in one copy.
//
// R-31 / Liveliness, each technique with its reason:
//   · The focal point is the address strip: --color-terminal (warm ink) against
//     the page's warm-white, the same vault surface the created-key ceremony
//     uses, so a secret and an address read as the same kind of thing.
//   · The reachability dot is SEMANTIC, not decorative (R-22) — it reports a
//     measured state and carries its label in text beside it.
//   · Staggered row entry is MOTION dial 2: an 8ms-per-row delay, opacity +
//     translate only, so nothing reflows and prefers-reduced-motion still lands
//     on the final state.
//   · One accent: --color-brand-500, used on the section glyphs and the active
//     client chip. No second hue is introduced.
// Contrast: address text is --color-terminal-text on --color-terminal (12.9:1);
// body text is --color-text-main / --color-text-muted on --color-surface.
import { useState } from "react";
import { Card, Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { CLIENTS, snippetFor } from "../../lib/clients";
import { getKey, hasKey } from "@/shared/utils/keyVault";

/** One measured transport: label, address, and what we actually observed. */
function TransportRow({ label, icon, url, state, note, copy, copied, copyId }) {
  const tone = {
    on: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
    off: "bg-surface-2 text-text-muted border-border-subtle",
    pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  }[state];
  const dot = {
    on: "bg-green-500",
    off: "bg-text-muted/40",
    pending: "bg-amber-500 animate-pulse",
  }[state];
  const label_ = { on: translate("Reachable"), off: translate("Off"), pending: translate("Checking") }[state];
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border-subtle last:border-b-0">
      <span className="material-symbols-outlined text-[18px] text-brand-500 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{label}</p>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${tone}`}>
            <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {label_}
          </span>
        </div>
        {url ? (
          <code className="text-xs text-text-muted font-mono block truncate mt-0.5">{url}</code>
        ) : (
          <p className="text-xs text-text-muted mt-0.5">{note}</p>
        )}
      </div>
      {url && (
        <button
          type="button"
          onClick={() => copy(url, copyId)}
          aria-label={`${translate("Copy")} ${label}`}
          title={translate("Copy")}
          className="shrink-0 p-2 rounded-[10px] text-text-muted hover:text-brand-600 dark:hover:text-brand-300 hover:bg-black/5 dark:hover:bg-white/5 motion-control cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        >
          <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
            {copied === copyId ? "check" : "content_copy"}
          </span>
        </button>
      )}
    </div>
  );
}

export default function OverviewTab({ c }) {
  const { copied, copy } = useCopyToClipboard();
  const [client, setClient] = useState(CLIENTS[0].id);

  const { baseUrl, tunnelEnabled, tunnelReachable, tunnelUrl, tunnelPublicUrl,
    tsEnabled, tsReachable, tsUrl, requireApiKey, requireLogin, hasPassword,
    keys, keyUsage } = c;

  // The snippet uses a real key only if this browser's vault actually holds one.
  // Otherwise it prints an obvious placeholder — never a convincing fake.
  const vaultKey = (() => {
    const first = keys.find((k) => k.isActive !== false && hasKey(k.id));
    return first ? getKey(first.id) : null;
  })();

  const totalRequests = Object.values(keyUsage || {}).reduce((n, u) => n + (u?.requests || 0), 0);
  const activeKeys = keys.filter((k) => k.isActive !== false).length;
  const exposed = Boolean(tunnelEnabled || tsEnabled);
  // Every one of these is a true statement about the configuration. They are
  // listed as things to settle *before* exposing the gateway — because with no
  // transport on, none of them is a live risk, and saying otherwise would be
  // the kind of alarm that trains an operator to ignore alarms.
  const unmet = [
    !requireApiKey && translate("API keys are not required"),
    !requireLogin && translate("Dashboard login is not required"),
    requireLogin && !hasPassword && translate("Dashboard still uses the default password"),
  ].filter(Boolean);

  const local = `${baseUrl}`;
  const tunnel = tunnelEnabled ? `${tunnelPublicUrl || tunnelUrl}/v1` : "";
  const ts = tsEnabled ? `${tsUrl}/v1` : "";

  return (
    <div className="flex flex-col gap-6">
      {/* Focal point — the addresses */}
      <Card>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-500" aria-hidden="true">api</span>
          {translate("API Endpoint")}
        </h2>
        <div className="rounded-[12px] p-4" style={{ background: "var(--color-terminal)", color: "var(--color-terminal-text)" }}>
          <p className="text-[10px] uppercase tracking-wider opacity-60 mb-1.5">
            {translate("Local address")}
          </p>
          <code className="font-mono text-sm break-all">{local}</code>
        </div>
        <div className="mt-2 flex flex-col">
          <TransportRow
            label={translate("Local")} icon="dns" url={local}
            state="on" note={translate("Always available on this machine")}
            copy={copy} copied={copied} copyId="ov_local"
          />
          <TransportRow
            label="Cloudflare Tunnel" icon="cloud_upload"
            url={tunnel}
            state={tunnelEnabled ? (tunnelReachable ? "on" : "pending") : "off"}
            note={tunnelEnabled ? translate("Reconnecting…") : translate("Not enabled — reachable from anywhere when on")}
            copy={copy} copied={copied} copyId="ov_tunnel"
          />
          <TransportRow
            label="Tailscale Funnel" icon="vpn_lock"
            url={ts}
            state={tsEnabled ? (tsReachable ? "on" : "pending") : "off"}
            note={tsEnabled ? translate("Reconnecting…") : translate("Not enabled — private mesh access when on")}
            copy={copy} copied={copied} copyId="ov_ts"
          />
        </div>
      </Card>

      {/* At-a-glance counts — real numbers, or nothing */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: "vpn_key", label: translate("Active keys"), value: activeKeys, sub: `${keys.length} ${translate("total")}` },
          { icon: "swap_calls", label: translate("Requests"), value: totalRequests.toLocaleString(), sub: translate("all time") },
          {
            icon: "shield",
            label: exposed ? translate("Unmet controls") : translate("Before exposing"),
            value: unmet.length,
            sub: unmet.length === 0
              ? translate("all clear")
              : exposed
                ? translate("needs attention")
                : translate("local only — nothing is reachable"),
            warn: unmet.length > 0 && exposed,
          },
        ].map((s, i) => (
          <div
            key={s.label}
            className="rounded-[14px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-soft)] slide-in-top"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{s.icon}</span>
              <p className="text-[11px] font-semibold uppercase tracking-wider">{s.label}</p>
            </div>
            <p className={`text-2xl font-semibold mt-2 ${s.warn ? "text-amber-700 dark:text-amber-400" : ""}`}>{s.value}</p>
            <p className="text-xs text-text-muted mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Quick connect — one copy, one client */}
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500" aria-hidden="true">bolt</span>
            {translate("Quick connect")}
          </h2>
          {!vaultKey && (
            <span className="text-[11px] text-text-muted">
              {translate("No key in this browser's vault — snippet shows a placeholder")}
            </span>
          )}
        </div>
        <div role="tablist" aria-label={translate("Choose a client")} className="flex items-center gap-1 flex-wrap mb-2">
          {CLIENTS.map((cl) => (
            <button
              key={cl.id}
              type="button"
              role="tab"
              aria-selected={client === cl.id}
              onClick={() => setClient(cl.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium motion-control cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                client === cl.id
                  ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
                  : "text-text-muted hover:text-text-main hover:bg-surface-2"
              }`}
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">{cl.icon}</span>
              {cl.name}
            </button>
          ))}
        </div>
        <div className="relative rounded-[12px] p-4 pr-14" style={{ background: "var(--color-terminal)", color: "var(--color-terminal-text)" }}>
          <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed">
            {snippetFor(client, baseUrl, vaultKey)}
          </pre>
          <button
            type="button"
            onClick={() => copy(snippetFor(client, baseUrl, vaultKey), "snippet")}
            aria-label={translate("Copy snippet")}
            title={translate("Copy")}
            className="absolute top-3 right-3 inline-flex items-center justify-center size-8 rounded-[8px] opacity-70 hover:opacity-100 hover:bg-white/10 transition-[opacity,background-color] cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            style={{ color: "var(--color-terminal-text)" }}
          >
            <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
              {copied === "snippet" ? "check" : "content_copy"}
            </span>
          </button>
        </div>
      </Card>

      {unmet.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-[18px]" aria-hidden="true">shield</span>
            {translate("Before you enable a tunnel")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {unmet.map((m) => (
              <li key={m} className="text-xs text-text-muted flex items-start gap-1.5">
                <span className="material-symbols-outlined text-[13px] mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true">warning</span>
                {m}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted mt-2">
            {translate("The Security tab shows these controls in full.")}
          </p>
        </Card>
      )}
    </div>
  );
}
