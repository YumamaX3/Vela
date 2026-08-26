"use client";

import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Endpoint hero — the gateway URL plaque with live status dot, copy action,
 * a test request button, and the capability legend. The status is derived
 * from the tunnel/tailscale machines: a tunneled URL is "public", otherwise
 * "local".
 */
export default function EndpointHero({ baseUrl, copied, onCopy, tunnelUrl, tunnelEnabled, tsUrl, tsEnabled, onTest, testing }) {
  const remoteUrl = (tunnelEnabled && tunnelUrl) || (tsEnabled && tsUrl) || null;
  const displayUrl = remoteUrl ? `${remoteUrl}/v1` : baseUrl;

  const capabilities = [
    { icon: "open_in_new", label: translate("Gateway Endpoint") },
    { icon: "swap_calls", label: translate("Requests (24h)") },
    { icon: "bolt", label: translate("Multi-provider routing") },
    { icon: "translate", label: translate("Format translation") },
  ];

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-5 shadow-[var(--shadow-elev)]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          {translate("Gateway Endpoint")}
        </h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
              remoteUrl
                ? "text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10"
                : "text-text-muted border-border-subtle bg-surface-2"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${remoteUrl ? "bg-green-500 animate-pulse" : "bg-text-subtle"}`} />
            {remoteUrl ? translate("Public") : translate("Local")}
          </span>
          <Button size="sm" variant="outline" icon="bolt" onClick={onTest} loading={testing}>
            {translate("Test")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <code className="flex-1 font-mono text-sm px-3 py-2 rounded-[10px] bg-surface-2 border border-border-subtle text-text-main truncate">
          {displayUrl}
        </code>
        <button
          onClick={() => onCopy(displayUrl, "hero_url")}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
          title={translate("Copy endpoint URL")}
        >
          <span className="material-symbols-outlined text-[18px]">{copied === "hero_url" ? "check" : "content_copy"}</span>
        </button>
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-3">
        {capabilities.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <span className="material-symbols-outlined text-[14px] text-primary/70">{c.icon}</span>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
