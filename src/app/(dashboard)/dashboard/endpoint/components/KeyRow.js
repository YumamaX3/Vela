"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatTokens, formatCost, limitBadges, formatTime, statusOf, usageRatio, expiryInfo } from "../lib/keyFormat";
import KeyHealth from "./KeyHealth";

/** One quick-action item in the row's ⋮ menu. */
function QuickAction({ icon, label, onClick, danger = false, disabled = false, title }) {
  return (
    <button
      onClick={() => { onClick?.(); }}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors ${
        danger
          ? "text-red-600 dark:text-red-400 hover:bg-red-500/10"
          : "text-text-main hover:bg-surface-2"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      title={title}
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      {label}
    </button>
  );
}

/** A usage/expiry progress bar in the row's posture cell. */
function PostureBar({ label, pct, used, limit, tone = "brand" }) {
  const pctClamped = Math.max(0, Math.min(100, Math.round((pct ?? 0) * 100)));
  const barTone =
    pctClamped >= 90 ? "bg-red-500" : pctClamped >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex-1 min-w-[110px]" title={`${label}: ${used} / ${limit}`}>
      <div className="flex items-center justify-between text-[10px] text-text-muted mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{used} / {limit}</span>
      </div>
      <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${barTone} transition-all`} style={{ width: `${pctClamped}%` }} />
      </div>
    </div>
  );
}

/**
 * One key row — posture cell (status dot, badges, usage/expiry progress bars,
 * expiry countdown), the ⋮ quick-action menu, the selection checkbox, and a
 * cleaner meta line. Presentational; every handler comes from props.
 */
export default function KeyRow({
  rowKey: k,
  usage,
  selected,
  onToggleSelect,
  onOpenDrawer,
  onPause,
  onResume,
  onRotate,
  onDuplicate,
  onRevive,
  onTest,
  onDelete,
  onEdit,
  onExpire,
  copied,
  onCopy,
  onForget,
  hasKeyOnDevice,
  busy,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const paused = k.isActive === false;
  const revoked = k.revoked === true;
  const status = statusOf(k);
  const exp = expiryInfo(k);
  const bars = usageRatio(k, usage);

  const STATUS_META = {
    active: { dot: "bg-green-500", label: translate("Active") },
    paused: { dot: "bg-amber-500", label: translate("Paused") },
    expiring: { dot: "bg-amber-500", label: translate("Expiring") },
    revoked: { dot: "bg-red-500", label: translate("Revoked") },
  };
  const statusMeta = STATUS_META[status] || STATUS_META.active;

  const run = (fn) => () => { setMenuOpen(false); fn?.(); };

  return (
    <div className={`group py-3 px-3 ${paused && !revoked ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        {/* Posture cell */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dot}`} title={statusMeta.label} />
            <p className="text-sm font-medium truncate">{k.name}</p>
            {revoked ? (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30"
                title="This key predates key governance. Its secret was purged — it can never be used again. Revive it to mint a fresh working key under the same name."
              >
                {translate("Revoked (legacy)")}
              </span>
            ) : (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                status === "expiring"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : paused
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
              }`}>
                {statusMeta.label}
              </span>
            )}
            {k.category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30" title={k.category}>
                {k.category}
              </span>
            )}
            {limitBadges(k).map((b) => (
              <span key={b.k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle" title={translate("Key limit")}>
                {b.text}
              </span>
            ))}
            {hasKeyOnDevice && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle" title="Full key captured in this browser's local vault">
                {translate("stored here")}
              </span>
            )}
            {/* Expiry countdown chip */}
            {exp && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                exp.tone === "danger"
                  ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                  : exp.tone === "warn"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-surface-2 text-text-muted border-border-subtle"
              }`} title={exp.iso}>
                {exp.days < 0 ? translate("Expired") : `${exp.days}d left`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            <code className="text-xs text-text-muted font-mono">{k.keyPrefix}</code>
            {hasKeyOnDevice && (
              <button
                onClick={() => onCopy(k.id, k.id)}
                className="p-0.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                title={translate("Copy full key (from this browser's vault)")}
              >
                <span className="material-symbols-outlined text-[14px]">{copied === k.id ? "check" : "content_copy"}</span>
              </button>
            )}
          </div>

          {k.description && <p className="text-xs text-text-muted mt-1 truncate">{k.description}</p>}

          <p className="text-xs text-text-muted mt-1">
            Created {new Date(k.createdAt).toLocaleDateString()}
            {(() => {
              const lastUsed = formatTime(k.lastUsedAt);
              return lastUsed ? ` · Last used ${lastUsed.relative}` : " · Never used";
            })()}
          </p>

          {/* Usage strip + posture bars */}
          {usage && (
            <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-text-muted">
              <span className="inline-flex items-center gap-1" title="Requests">
                <span className="material-symbols-outlined text-[13px] text-primary/70">swap_calls</span>
                {usage.requests.toLocaleString()}
              </span>
              <span className="inline-flex items-center gap-1" title="Total tokens">
                <span className="material-symbols-outlined text-[13px] text-violet-500/70">token</span>
                {formatTokens(usage.totalTokens)} total
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-text-main" title="Estimated spend">
                <span className="material-symbols-outlined text-[13px] text-amber-500/70">paid</span>
                {formatCost(usage.cost)}
              </span>
            </div>
          )}
          {bars.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap mt-2">
              {bars.map((b) => (
                <PostureBar key={b.kind} label={b.label} pct={b.pct} used={b.used} limit={b.limit} />
              ))}
            </div>
          )}
          <div className="mt-2">
            <KeyHealth healthKey={k} usage={usage} />
          </div>
        </div>

        {/* Right rail — toggle + quick menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Toggle
            size="sm"
            checked={revoked ? false : (k.isActive ?? true)}
            disabled={revoked}
            onChange={(checked) => (checked ? onResume(k) : onPause(k))}
            title={revoked ? translate("This key was revoked — it cannot be enabled") : (k.isActive ? translate("Pause key") : translate("Resume key"))}
          />
          <button
            onClick={() => onEdit(k)}
            className="p-1.5 rounded text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary transition-all"
            title={translate("Edit key")}
          >
            <span className="material-symbols-outlined text-[17px]">edit</span>
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary transition-all"
              title={translate("More actions")}
              aria-label={translate("More actions")}
              aria-expanded={menuOpen}
            >
              <span className="material-symbols-outlined text-[17px]">more_vert</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 p-1 rounded-[10px] border border-border-subtle bg-surface-3 shadow-[var(--shadow-soft)] flex flex-col gap-0.5">
                <QuickAction icon="info" label={translate("Details")} onClick={() => onOpenDrawer(k)} />
                {hasKeyOnDevice && (
                  <QuickAction icon={copied === k.id ? "check" : "content_copy"} label={translate("Copy full key")} onClick={() => onCopy(k.id, k.id)} />
                )}
                {hasKeyOnDevice && (
                  <QuickAction icon="lock_reset" label={translate("Forget from this device")} onClick={() => onForget(k.id)} />
                )}
                <QuickAction icon="play_arrow" label={translate("Test key")} onClick={() => onTest(k)} disabled={!!busy || revoked} />
                {!revoked && (
                  <>
                    {paused
                      ? <QuickAction icon="play_arrow" label={translate("Resume")} onClick={() => onResume(k)} />
                      : <QuickAction icon="pause" label={translate("Pause")} onClick={() => onPause(k)} />}
                    <QuickAction icon="autorenew" label={translate("Rotate")} onClick={() => onRotate(k)} />
                    <QuickAction icon="content_copy" label={translate("Duplicate")} onClick={() => onDuplicate(k)} />
                    {onExpire && <QuickAction icon="event_busy" label={translate("Expire")} onClick={() => onExpire(k)} />}
                    {onRevive && <QuickAction icon="restart_alt" label={translate("Revive")} onClick={() => onRevive(k)} />}
                    <div className="my-0.5 border-t border-border-subtle" />
                    <QuickAction danger icon="delete" label={translate("Delete")} onClick={() => onDelete(k)} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Select */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(k.id)}
          disabled={revoked}
          className="accent-primary w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
          title={revoked ? translate("Revoked keys cannot be bulk-selected") : translate("Select for bulk actions")}
        />
        <span className={`text-[10px] ${revoked ? "text-text-muted/60" : "text-text-muted"}`}>{translate("Select")}</span>
      </div>
    </div>
  );
}
