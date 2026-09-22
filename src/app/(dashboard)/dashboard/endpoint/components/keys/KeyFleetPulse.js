"use client";

// The fleet's pulse: four postures, the coverage of scope and ceilings, and the
// two short lists an operator actually scans — what is busy, and what needs a
// look. All of it is the census the stats route computed; nothing is derived a
// second time here. When the census is dark the masthead says so rather than
// painting zeroes, because a zero that means "unknown" is a lie with a number
// on it.
import { translate } from "@/i18n/runtime";
import { POSTURE_ORDER, TONES, postureMeta } from "../../lib/keyFormat";

const TONE_TEXT = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-500",
  muted: "text-text-muted",
  indigo: "text-indigo-600 dark:text-indigo-400",
  primary: "text-primary",
};

function Stat({ label, value, tone = "muted", icon, title }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-surface-2 border border-border-subtle" title={title || label}>
      {icon && <span className={`material-symbols-outlined text-[16px] ${TONE_TEXT[tone] || TONE_TEXT.muted}`}>{icon}</span>}
      <div className="leading-tight">
        <div className={`text-sm font-semibold ${TONE_TEXT[tone] || TONE_TEXT.muted}`}>{value}</div>
        <div className="text-[10px] text-text-muted">{label}</div>
      </div>
    </div>
  );
}

export default function KeyFleetPulse({ c, deck }) {
  const { keys, keyUsage } = c;
  const { stats, statsError, postureCounts, posture, setPosture, openDetail } = deck;

  // The census when it answered; the client's own derivation while it is in
  // flight. The label says which, so the number is never ambiguous.
  const byPosture = stats?.byPosture || postureCounts;
  const total = stats?.totals?.keys ?? keys.length;
  const scoped = stats?.coverage?.scoped;
  const limited = stats?.coverage?.limited;
  const idle = stats?.coverage?.idle;

  const attention = stats?.attention || [];
  const busiest = stats?.top || [];
  const requests = stats?.totals?.requests ?? Object.values(keyUsage || {}).reduce((sum, u) => sum + (u?.requests || 0), 0);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Stat label={translate("keys")} value={total} tone="primary" icon="vpn_key" title={translate("Keys in the fleet")} />
        {POSTURE_ORDER.map((postureName) => {
          const meta = postureMeta(postureName);
          const count = byPosture[postureName] || 0;
          const isOn = posture === postureName;
          // A tile with nobody in it stays visible but dim — its absence is a
          // fact worth one glance, not a reason to hide the word "Expired". A
          // tile you can reach nothing through is not a filter, so it is only
          // clickable when it has something to show.
          const empty = count === 0;
          return (
            <button
              key={postureName}
              onClick={() => setPosture(isOn ? null : postureName)}
              disabled={empty}
              aria-pressed={isOn}
              className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border motion-control ${
                empty
                  ? "bg-surface-2 text-text-muted border-border-subtle opacity-60 cursor-default"
                  : TONES[meta.tone]
              } ${isOn ? "ring-2 ring-offset-1 ring-primary/60" : ""}`}
              title={empty ? `${meta.label} — nothing in this posture` : `${translate("Show only")} ${meta.label.toLowerCase()}`}
            >
              <span className="material-symbols-outlined text-[16px]">{meta.icon}</span>
              <div className="leading-tight text-left">
                <div className="text-sm font-semibold">{count}</div>
                <div className="text-[10px]">{meta.label}</div>
              </div>
            </button>
          );
        })}
        <Stat
          label={translate("requests, window")}
          value={Number(requests).toLocaleString()}
          tone="muted"
          icon="swap_calls"
          title={translate("Requests attributed to keys in the selected window")}
        />
      </div>

      {(scoped != null || limited != null || idle != null) && (
        <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px] text-text-muted">
          {scoped != null && (
            <span title={translate("Keys narrowed by model scope or ACL — the rest reach every provider")}>
              {scoped} {translate("scoped")}
            </span>
          )}
          {limited != null && (
            <span title={translate("Keys carrying at least one ceiling (rate, tokens, spend or IP)")}>
              {limited} {translate("with ceilings")}
            </span>
          )}
          {idle != null && (
            <span title={translate("Keys with no traffic in this window")}>
              {idle} {translate("idle")}
            </span>
          )}
        </div>
      )}

      {statsError && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
          {translate("The harbor's census could not be read — the counts above are this browser's own.")}
        </p>
      )}

      {(attention.length > 0 || busiest.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {attention.length > 0 && (
            <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                {translate("Worth a look")}
              </p>
              <ul className="mt-2 space-y-1">
                {attention.slice(0, 3).map((row) => (
                  <li key={row.id}>
                    <button
                      onClick={() => openDetail(row.id)}
                      className="w-full text-left text-xs hover:text-primary motion-control"
                    >
                      <span className="font-medium">{row.name}</span>
                      <span className="text-text-muted"> — {row.reasons.map((r) => translate(r)).join(", ")}</span>
                    </button>
                  </li>
                ))}
                {attention.length > 3 && (
                  <li className="text-[11px] text-text-muted">
                    {translate("and")} {attention.length - 3} {translate("more")}
                  </li>
                )}
              </ul>
            </div>
          )}

          {busiest.length > 0 && (
            <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-primary">bolt</span>
                {translate("Carrying the load")}
              </p>
              <ul className="mt-2 space-y-1">
                {busiest.slice(0, 3).map((row) => (
                  <li key={row.id}>
                    <button
                      onClick={() => openDetail(row.id)}
                      className="w-full text-left text-xs hover:text-primary motion-control"
                    >
                      <span className="font-medium">{row.name}</span>
                      <span className="text-text-muted"> — {Number(row.requests).toLocaleString()} {translate("requests")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
