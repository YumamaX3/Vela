"use client";
// SettingsMasthead — the room's identity slab.
//
// The old room opened with a `max-w-2xl` column and buried the two facts an
// operator wants first — which instance am I configuring, and what is actually
// armed — under four cards of controls. Both are read, never operated, so both
// belong above the rail and above every control.
//
// The "Armed" strip is a census, not decoration: the old room showed a green dot
// per card, which is a status light that says "on" about things that were on
// by default and therefore said nothing. This strip names the four doors that
// can actually be closed and reports only the ones that ARE closed. If none are,
// it says so in words rather than showing four grey dots.
import { Card } from "@/shared/components";
import { APP_CONFIG } from "@/shared/constants/config";
import StatusLine from "./StatusLine";

// Ordered the way an operator reads a console: the door first, then the identity
// behind it, then the path out, then the record it keeps.
const ARMED = [
  { key: "password", label: "Password required", icon: "lock" },
  { key: "sso", label: "Single sign-on", icon: "vpn_key" },
  { key: "proxy", label: "Outbound proxy", icon: "cloud" },
  { key: "recording", label: "Request recording", icon: "monitoring" },
];

export default function SettingsMasthead({ deck }) {
  const active = ARMED.filter((a) => deck.armed?.[a.key]);

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {/* The one accent, and the only place it appears in the masthead */}
          <div className="p-2.5 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[22px] leading-none">settings</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-main leading-tight">
              Settings
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              {deck.remoteHost
                ? "Remote instance — served through this host"
                : "Local instance — data stays on this machine"}
            </p>
          </div>
        </div>

        <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-muted leading-none shrink-0">
          v{APP_CONFIG.version}
        </span>
      </div>

      <div className="mt-4 pt-4 border-t border-border-subtle flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-text-muted">Armed</span>
        {active.length === 0 ? (
          <span className="text-xs text-text-muted">
            Nothing — this dashboard opens without a password and reaches the internet directly.
          </span>
        ) : (
          active.map((a) => (
            <span
              key={a.key}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-500/20"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
                {a.icon}
              </span>
              {a.label}
            </span>
          ))
        )}
      </div>

      {deck.loadError && (
        <StatusLine status={{ type: "error", message: deck.loadError }} className="mt-3" />
      )}
    </Card>
  );
}
