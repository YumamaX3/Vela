"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import { formatTokens, formatCost, limitBadges, formatTime } from "../lib/keyFormat";
import { lifecycleOf, LIFECYCLE_META } from "@/lib/endpoint/lifecycleOf.js";
import { scoreKey } from "@/lib/endpoint/hygieneScoring.js";
import KeyHealth from "./KeyHealth";
import LifecycleTimeline from "./LifecycleTimeline";
import Button from "@/shared/components/Button";

/**
 * GovernanceDrawer v2 — the W3a upgrade of the detail drawer. Everything the
 * old KeyDrawer had (status grid, limits, 4-way ACL, 24h usage, actions)
 * PLUS the Governance Center's three new surfaces:
 *   • lifecycle pill — the 6-state machine (lifecycleOf) with its precedence
 *   • hygiene ring — scoreKey's posture/urgency factors as a colored band
 *   • tags — the W2 tags route (add/remove/rename via props)
 *   • mutation ledger — this key's append-only provenance (W2 ledger route)
 * The drawer stays presentational; all fetches/mutations live in useKeys.
 */
export default function GovernanceDrawer({
  rowKey: k,
  usage,
  health,
  copied,
  onCopy,
  hasKeyOnDevice,
  onPause,
  onResume,
  onRotate,
  onDuplicate,
  onRevive,
  onTest,
  testResult,
  onEdit,
  onExpire,
  onRenew,
  onDelete,
  onShare,
  shareUrl,
  onLogs,
  onClose,
  busy,
  activity,
  activityLoading,
  // W3a governance surfaces
  tags = [],
  onAddTag,
  onRemoveTag,
  ledger = [],
  ledgerLoading,
  serverNow: now,
}) {
  const [tagDraft, setTagDraft] = useState("");
  if (!k) return null;

  const openLogs = onLogs || (() => {
    if (typeof window !== "undefined") {
      window.location.href = `/dashboard/logs?key=${encodeURIComponent(k.id)}`;
    }
  });

  const paused = k.isActive === false;
  const isExpired = k.expiresAt ? new Date(k.expiresAt).getTime() < Date.now() : false;
  const activeKinds = Array.isArray(k.allowedKinds) ? k.allowedKinds : null;
  const activeProviders = Array.isArray(k.allowedProviders) ? k.allowedProviders : null;
  const activeCombos = Array.isArray(k.allowedCombos) ? k.allowedCombos : null;
  const activeModels = Array.isArray(k.allowedModels) ? k.allowedModels : null;

  const lastUsed = formatTime(k.lastUsedAt);
  const expires = formatTime(k.expiresAt);
  const test = testResult && testResult.keyId === k.id ? testResult : null;
  const revoked = k.revoked === true;

  // ── Governance surfaces (W3a) ──────────────────────────────────────────
  // lifecycleOf needs a server-stamped clock; the orchestrator passes the
  // frame's serverNow. Falls back to Date.now() only for the pure render
  // (clock-pinning is enforced at the API seam, not the drawer).
  const life = lifecycleOf(k, now || Date.now());
  const lifeMeta = LIFECYCLE_META[life] || LIFECYCLE_META.active;
  const hygiene = scoreKey(k, now || Date.now());

  const actions = [
    { icon: "content_copy", label: translate("Copy full key"), onClick: () => onCopy(k.id, k.id), disabled: !hasKeyOnDevice },
    revoked
      ? { icon: "restart_alt", label: translate("Revive (mint fresh key)"), onClick: () => onRevive(k), danger: false }
      : paused
        ? { icon: "play_arrow", label: translate("Resume"), onClick: () => onResume(k), danger: false }
        : { icon: "pause", label: translate("Pause"), onClick: () => onPause(k), danger: false },
    revoked
      ? { icon: "block", label: translate("Revoked — cannot resume"), onClick: () => {}, danger: false, disabled: true }
      : { icon: "autorenew", label: translate("Rotate"), onClick: () => onRotate(k), danger: true },
    revoked
      ? { icon: "block", label: translate("Revoked — cannot duplicate"), onClick: () => {}, danger: false, disabled: true }
      : { icon: "content_paste", label: translate("Duplicate"), onClick: () => onDuplicate(k), danger: false },
    { icon: "edit", label: translate("Edit"), onClick: () => onEdit(k), danger: false },
    { icon: "link", label: translate("Share access link"), onClick: () => onShare(k), danger: false },
    { icon: "receipt_long", label: translate("View request logs"), onClick: () => openLogs(k), danger: false },
    isExpired
      ? { icon: "update", label: translate("Renew"), onClick: () => onRenew(k), danger: false }
      : { icon: "schedule", label: translate("Expire now"), onClick: () => onExpire(k), danger: true },
    { icon: "delete", label: translate("Delete (revoke)"), onClick: () => onDelete(k), danger: true },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-surface border-l border-border-subtle shadow-[var(--shadow-elev)] slide-in-right flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-main truncate">{k.name}</h3>
            <code className="text-xs text-text-muted font-mono">{k.keyPrefix}</code>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Lifecycle pill — the 6-state machine replaces the binary pill */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${lifeTone(lifeMeta.tone)}`}>
              {translate(lifeMeta.label)}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
              aria-label={translate("Close")}
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
          {/* Health + hygiene */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{translate("Health")}</span>
            <KeyHealth healthKey={k} usage={usage} health={health} />
          </div>
          {hygiene && (
            <HygieneStrip hygiene={hygiene} />
          )}

          {/* Test result */}
          {test && (
            <div
              className={`text-xs rounded-lg border p-2.5 ${
                test.ok
                  ? "bg-green-500/5 border-green-500/30 text-green-700 dark:text-green-400"
                  : test.error
                    ? "bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-400"
                    : "bg-blue-500/5 border-blue-500/30 text-blue-700 dark:text-blue-400"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">
                  {test.ok ? "check_circle" : test.error ? "error" : "progress_activity"}
                </span>
                {test.pending ? translate("Testing…") : test.message || (test.ok ? translate("Key verified") : translate("Test failed"))}
              </span>
              {test.duration != null && !test.pending && (
                <span className="ml-2 text-text-muted">{test.duration}ms</span>
              )}
            </div>
          )}

          {/* Status grid */}
          <div className="grid grid-cols-2 gap-2">
            <MetaCell icon="calendar_today" label={translate("Created")} value={new Date(k.createdAt).toLocaleDateString()} />
            <MetaCell
              icon="history"
              label={translate("Last used")}
              value={lastUsed ? lastUsed.relative : translate("Never used")}
              title={lastUsed ? lastUsed.absolute : null}
            />
            <MetaCell
              icon="schedule"
              label={translate("Expires")}
              value={expires ? expires.relative : translate("Never")}
              title={expires ? expires.absolute : null}
              tone={isExpired ? "danger" : "default"}
            />
            <MetaCell
              icon="swap_calls"
              label={translate("Requests (24h)")}
              value={usage ? String(usage.requests.toLocaleString()) : "0"}
            />
            <MetaCell
              icon="token"
              label={translate("Tokens (24h)")}
              value={usage ? formatTokens(usage.totalTokens) : "0"}
            />
            <MetaCell
              icon="paid"
              label={translate("Est. Cost")}
              value={usage ? formatCost(usage.cost) : "$0.00"}
            />
          </div>

          {/* Tags — W3a surface */}
          <Section title={translate("Tags")}>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.length === 0 ? (
                <p className="text-xs text-text-muted">{translate("No tags")}</p>
              ) : (
                tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                    {t}
                    {onRemoveTag && (
                      <button onClick={() => onRemoveTag(t)} className="text-text-muted hover:text-red-500" aria-label={translate("Remove tag")}>
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
            {onAddTag && (
              <div className="flex gap-1.5">
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagDraft.trim()) {
                      onAddTag(tagDraft.trim());
                      setTagDraft("");
                    }
                  }}
                  placeholder={translate("Add a tag…")}
                  className="flex-1 py-1.5 px-2.5 text-xs text-text-main bg-surface-2 rounded-[8px] border border-transparent placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all"
                />
                <Button size="sm" variant="outline" icon="add" disabled={!tagDraft.trim()} onClick={() => { onAddTag(tagDraft.trim()); setTagDraft(""); }}>
                  {translate("Add")}
                </Button>
              </div>
            )}
          </Section>

          {/* Limits */}
          <Section title={translate("Limits")}>
            {limitBadges(k).length === 0 ? (
              <p className="text-xs text-text-muted">{translate("No limits set — unrestricted")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {limitBadges(k).map((b) => (
                  <span key={b.k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle">
                    {b.text}
                  </span>
                ))}
              </div>
            )}
            {k.description && <p className="text-xs text-text-muted mt-2">{k.description}</p>}
            {k.category && (
              <p className="text-xs text-text-muted mt-1">
                {translate("Category")}: <span className="text-text-main">{k.category}</span>
              </p>
            )}
          </Section>

          {/* ACL — the 4-way tri-state */}
          <Section title={translate("Access control")}>
            <AclRow label={translate("Service kinds")} value={activeKinds} placeholder={translate("All kinds")} />
            <AclRow label={translate("Providers")} value={activeProviders} placeholder={translate("All providers")} />
            <AclRow label={translate("Combos")} value={activeCombos} placeholder={translate("All combos")} />
            <AclRow label={translate("Models")} value={activeModels} placeholder={translate("All models")} />
          </Section>

          {/* Lifecycle timeline — the mutation ledger as a vertical rail */}
          <Section title={translate("Lifecycle")}>
            <LifecycleTimeline ledger={ledger} loading={ledgerLoading} />
          </Section>

          {/* Recent activity — the last few requests this key made */}
          <Section title={translate("Recent activity")}>
            {activityLoading ? (
              <p className="text-xs text-text-muted inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                {translate("Loading…")}
              </p>
            ) : activity && activity.length > 0 ? (
              <div className="flex flex-col gap-1">
                {activity.map((a, i) => (
                  <ActivityRow key={i} a={a} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">{translate("No recent requests for this key")}</p>
            )}
          </Section>

          {/* Actions */}
          <Section title={translate("Actions")}>
            <div className="flex flex-col gap-1.5">
              {actions.map((a) => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  disabled={a.disabled || !!busy}
                  className={`flex items-center gap-2.5 w-full text-sm px-3 py-2 rounded-[10px] border transition-all ${
                    a.danger
                      ? "text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/10"
                      : "text-text-main border-border-subtle hover:bg-surface-2"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="material-symbols-outlined text-[18px]">{a.icon}</span>
                  {a.label}
                  {busy && <span className="material-symbols-outlined animate-spin text-[14px] ml-auto">progress_activity</span>}
                </button>
              ))}
            </div>
          </Section>

          {shareUrl && (
            <div className="text-xs text-text-muted bg-surface-2 border border-border-subtle rounded-lg p-2.5 break-all">
              <span className="material-symbols-outlined text-[13px] align-middle mr-1">link</span>
              {shareUrl}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function lifeTone(tone) {
  switch (tone) {
    case "green": return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
    case "amber": return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "red": return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";
    case "blue": return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
    case "muted": return "bg-surface-2 text-text-muted border-border-subtle";
    default: return "bg-surface-2 text-text-muted border-border-subtle";
  }
}

/** Hygiene band — the score + posture/urgency chips from scoreKey. */
function HygieneStrip({ hygiene }) {
  const ringTone = hygiene.band === "good" ? "text-green-500" : hygiene.band === "fair" ? "text-amber-500" : "text-red-500";
  return (
    <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 border border-border-subtle p-2.5">
      <div className="relative w-10 h-10 shrink-0">
        <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${(hygiene.score / 100) * 100} 100`}
            className={ringTone}
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums ${ringTone}`}>
          {hygiene.score}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text-main capitalize">{translate(hygiene.band)} hygiene</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {hygiene.factors.slice(0, 3).map((f) => (
            <span key={f.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted">
              {translate(f.label)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetaCell({ icon, label, value, tone = "default", title }) {
  return (
    <div className="bg-surface-2 border border-border-subtle rounded-[10px] p-2.5" title={title}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted mb-1">
        <span className="material-symbols-outlined text-[13px]">{icon}</span>
        {label}
      </div>
      <p className={`text-sm font-medium truncate ${tone === "danger" ? "text-red-600 dark:text-red-400" : "text-text-main"}`}>
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

function AclRow({ label, value, placeholder }) {
  if (!value || value.length === 0) {
    return (
      <p className="text-xs text-text-muted mb-1.5">
        {label}: <span className="text-text-muted italic">{placeholder}</span>
      </p>
    );
  }
  const shown = value.slice(0, 8);
  const rest = value.length - shown.length;
  return (
    <div className="mb-1.5">
      <p className="text-xs text-text-muted mb-1">{label}:</p>
      <div className="flex flex-wrap gap-1">
        {shown.map((v) => (
          <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
            {v}
          </span>
        ))}
        {rest > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle">
            +{rest}
          </span>
        )}
      </div>
    </div>
  );
}

/** One request in the key's recent-activity feed. */
function ActivityRow({ a }) {
  const time = formatTime(a.timestamp);
  return (
    <div className="flex items-center justify-between gap-2 text-xs border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 py-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`material-symbols-outlined text-[13px] shrink-0 ${a.status === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
          {a.status === "error" ? "error" : "check_circle"}
        </span>
        <span className="font-mono text-[11px] text-text-main truncate">{a.model || "—"}</span>
        {a.provider && (
          <span className="text-[10px] text-text-muted truncate">{a.provider}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 text-[11px] text-text-muted">
        <span title="Tokens">{formatTokens((a.promptTokens || 0) + (a.completionTokens || 0))}</span>
        {a.cost > 0 && <span className="font-medium text-text-main">{formatCost(a.cost)}</span>}
        {a.latencyMs != null && <span title="Latency">{a.latencyMs}ms</span>}
        {time && <span title={time.absolute}>{time.relative}</span>}
      </div>
    </div>
  );
}
