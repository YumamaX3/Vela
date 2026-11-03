"use client";

// The fleet's smallest marks, defined ONCE.
//
// A key's posture, scope, category, ceilings and usage strip appear on the card
// lens, in the table lens and in the detail drawer. Three implementations of the
// same badge is how a "Paused" pill and a "paused" pill end up in the same
// screenshot — so every mark lives here, and each lens composes them.

import { translate } from "@/i18n/runtime";
import {
  TONES,
  formatCost,
  formatTokens,
  keyLimitBadges,
  postureMeta,
  tokenBudgetFill,
} from "../../lib/keyFormat";

function Pill({ tone = "muted", icon, children, title }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-3xs font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${TONES[tone] || TONES.muted}`}
      title={title}
    >
      {icon && <span className="material-symbols-outlined text-2xs">{icon}</span>}
      {children}
    </span>
  );
}

/** The key's posture — the one verdict every view must agree on. */
export function PosturePill({ posture, title }) {
  const meta = postureMeta(posture);
  return (
    <Pill tone={meta.tone} icon={meta.icon} title={title || translate("Key posture")}>
      {meta.label}
    </Pill>
  );
}

export function CategoryPill({ category }) {
  if (!category) return null;
  return (
    <Pill tone="indigo" icon="label" title={translate("Category")}>
      {category}
    </Pill>
  );
}

/** Model scope — or the honest absence of one, which is the more important fact. */
export function ScopePill({ k }) {
  const count = Array.isArray(k.allowedModels) ? k.allowedModels.length : 0;
  if (count === 0) {
    return (
      <Pill tone="muted" icon="shield_lock" title={translate("Reaches every provider this harbor can dial")}>
        {translate("All models")}
      </Pill>
    );
  }
  return (
    <Pill tone="primary" icon="security" title={(k.allowedModels || []).join(", ")}>
      {count} {count === 1 ? translate("model") : translate("models")}
    </Pill>
  );
}

/** Ceilings the operator actually set — the repo's own badge list, verbatim. */
export function LimitPills({ k }) {
  const badges = keyLimitBadges(k);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <Pill key={b.k} tone="muted" icon="speed" title={translate("Key ceiling")}>
          {b.text}
        </Pill>
      ))}
    </>
  );
}

export function StoredHerePill({ title }) {
  return (
    <Pill tone="muted" icon="save" title={title || translate("Full key captured in this browser's vault")}>
      {translate("stored here")}
    </Pill>
  );
}

/** Requests, in/out/total tokens and spend — the identical strip the room has
 *  always shown, so a returning operator reads it without learning anything.
 *  Beside them, when the key carries a token budget AND the strip is showing
 *  that budget's own window, a slim quota meter. Absent budget, absent usage,
 *  or a mismatched period renders exactly today's strip. See tokenBudgetFill. */
export function UsageStrip({ usage, k, period, className = "" }) {
  if (!usage) return null;
  const fill = tokenBudgetFill({
    usage,
    tokenBudgetDaily: k?.tokenBudgetDaily,
    budgetScope: k?.budgetScope,
    period,
  });
  // Zero-suppression: at 0 the numbers already say "nothing used" — a full
  // empty frame would be noise, so no bar is drawn at all.
  const budget = Number(k?.tokenBudgetDaily);
  const pct = fill == null ? null : Math.round(fill * 100);
  const showMeter = pct != null && pct > 0;
  return (
    <div className={`flex items-center gap-3 flex-wrap text-2xs text-text-muted ${className}`}>
      {showMeter && (
        <span
          className="inline-flex items-center gap-1.5 basis-full min-w-0"
          title={translate("Token budget used")}
        >
          <span
            role="progressbar"
            aria-label={translate("Token budget used")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="relative h-1 w-24 shrink-0 rounded-full bg-surface-2 border border-border-subtle overflow-hidden"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="tabular-nums font-medium text-text-main">
            {pct}% {translate("of budget")}
          </span>
          <span className="tabular-nums">
            {formatTokens(usage.totalTokens)} / {formatTokens(budget)}
          </span>
        </span>
      )}
      <span className="inline-flex items-center gap-1" title={translate("Requests")}>
        <span className="material-symbols-outlined text-sm text-primary/70">swap_calls</span>
        {Number(usage.requests || 0).toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Input tokens")}>
        <span className="material-symbols-outlined text-sm text-sky-500/70">south</span>
        {formatTokens(usage.promptTokens)} {translate("in")}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Output tokens")}>
        <span className="material-symbols-outlined text-sm text-emerald-500/70">north</span>
        {formatTokens(usage.completionTokens)} {translate("out")}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Total tokens")}>
        <span className="material-symbols-outlined text-sm text-violet-500/70">token</span>
        {formatTokens(usage.totalTokens)} {translate("total")}
      </span>
      <span className="inline-flex items-center gap-1 font-medium text-text-main" title={translate("Estimated spend")}>
        <span className="material-symbols-outlined text-sm text-amber-500/70">paid</span>
        {formatCost(usage.cost)}
      </span>
    </div>
  );
}

/** The select box every lens carries — one control, two lenses, no drift. */
export function SelectBox({ checked, onChange, title }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      title={title || translate("Select")}
      className="size-3.5 rounded border-border cursor-pointer accent-[var(--color-brand-500)]"
    />
  );
}
