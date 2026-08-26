"use client";

import { Button, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatTokens, formatCost, limitBadges, formatTime } from "../lib/keyFormat";
import KeyHealth from "./KeyHealth";

/**
 * One key row in the management table: prefix, meta badges, health, usage
 * strip, status toggle, and the icon action cluster (drawer, rotate,
 * duplicate, test, delete). Selection checkbox feeds the bulk bar.
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
  copied,
  onCopy,
  onForget,
  hasKeyOnDevice,
  busy,
}) {
  const paused = k.isActive === false;
  const scopeCount = Array.isArray(k.allowedModels) ? k.allowedModels.length : 0;

  // Tombstoned legacy rows (migration 002) — hash purged, permanently dead.
  // The toggle is disabled and the row carries an honesty marker.
  const revoked = k.revoked === true;

  return (
    <div className={`group py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${paused && !revoked ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{k.name}</p>
            {revoked ? (
              <>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30"
                  title="This key predates key governance. Its secret was purged — it can never be used again. Revive it to mint a fresh working key under the same name."
                >
                  {translate("Revoked (legacy)")}
                </span>
                <button
                  onClick={() => onRevive(k)}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-all"
                  title={translate("Mint a fresh working key under this name (the old secret can never be recovered)")}
                >
                  <span className="material-symbols-outlined text-[11px] align-[-2px] mr-0.5">restart_alt</span>
                  {translate("Revive")}
                </button>
              </>
            ) : paused ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">{translate("Paused")}</span>
            ) : (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30">{translate("Active")}</span>
            )}
            {k.category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30" title={k.category}>
                {k.category}
              </span>
            )}
            {scopeCount > 0 ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30" title={k.allowedModels.join(", ")}>
                {scopeCount} model{scopeCount === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle" title="No model restriction">
                {translate("All models")}
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
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-xs text-text-muted font-mono">{k.keyPrefix}</code>
            {hasKeyOnDevice && (
              <>
                <button
                  onClick={() => onCopy(k.id, k.id)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                  title={translate("Copy full key (from this browser's vault)")}
                >
                  <span className="material-symbols-outlined text-[14px]">{copied === k.id ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => onForget(k.id)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-red-500 transition-all"
                  title={translate("Forget the full key from this browser's vault")}
                >
                  <span className="material-symbols-outlined text-[14px]">lock_reset</span>
                </button>
              </>
            )}
            <button
              onClick={() => onEdit(k)}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
              title={translate("Edit name, description, allowed models")}
            >
              <span className="material-symbols-outlined text-[14px]">edit</span>
            </button>
            <button
              onClick={() => onOpenDrawer(k)}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
              title={translate("Key details")}
            >
              <span className="material-symbols-outlined text-[14px]">info</span>
            </button>
          </div>
          {k.description && <p className="text-xs text-text-muted mt-1 truncate">{k.description}</p>}
          {(() => {
            const lastUsed = formatTime(k.lastUsedAt);
            const expires = formatTime(k.expiresAt);
            return (
              <p className="text-xs text-text-muted mt-1">
                Created {new Date(k.createdAt).toLocaleDateString()}
                {lastUsed ? ` · Last used ${lastUsed.relative}` : " · Never used"}
                {expires ? ` · Expires ${expires.relative}` : ""}
              </p>
            );
          })()}
          {/* Usage strip — requests, in/out/total tokens, spend */}
          {usage && (
            <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-text-muted">
              <span className="inline-flex items-center gap-1" title="Requests">
                <span className="material-symbols-outlined text-[13px] text-primary/70">swap_calls</span>
                {usage.requests.toLocaleString()}
              </span>
              <span className="inline-flex items-center gap-1" title="Input tokens">
                <span className="material-symbols-outlined text-[13px] text-sky-500/70">south</span>
                {formatTokens(usage.promptTokens)} in
              </span>
              <span className="inline-flex items-center gap-1" title="Output tokens">
                <span className="material-symbols-outlined text-[13px] text-emerald-500/70">north</span>
                {formatTokens(usage.completionTokens)} out
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
          <div className="mt-1.5">
            <KeyHealth healthKey={k} usage={usage} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Toggle
            size="sm"
            checked={revoked ? false : (k.isActive ?? true)}
            disabled={revoked}
            onChange={(checked) => (checked ? onResume(k) : onPause(k))}
            title={revoked ? translate("This key was revoked — it cannot be enabled") : (k.isActive ? translate("Pause key") : translate("Resume key"))}
          />
          <button
            onClick={() => onRotate(k)}
            disabled={revoked}
            className={`p-2 rounded text-text-muted transition-all ${revoked ? "opacity-40 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5 hover:text-amber-500"}`}
            title={revoked ? translate("Cannot rotate a revoked key") : translate("Rotate key")}
          >
            <span className="material-symbols-outlined text-[18px]">autorenew</span>
          </button>
          <button
            onClick={() => onDuplicate(k)}
            disabled={revoked}
            className={`p-2 rounded text-text-muted transition-all ${revoked ? "opacity-40 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary"}`}
            title={revoked ? translate("Cannot duplicate a revoked key") : translate("Duplicate key")}
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
          </button>
          <button
            onClick={() => onTest(k)}
            disabled={!!busy || revoked}
            className={`p-2 rounded text-text-muted transition-all ${revoked ? "opacity-40 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5 hover:text-green-600"}`}
            title={revoked ? translate("Cannot test a revoked key") : translate("Test key")}
          >
            <span className="material-symbols-outlined text-[18px]">{busy ? "progress_activity" : "play_arrow"}</span>
          </button>
          <button
            onClick={() => onDelete(k)}
            className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
            title={translate("Delete (revoke)")}
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
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
