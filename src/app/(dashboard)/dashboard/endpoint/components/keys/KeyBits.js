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
} from "../../lib/keyFormat";

function Pill({ tone = "muted", icon, children, title }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${TONES[tone] || TONES.muted}`}
      title={title}
    >
      {icon && <span className="material-symbols-outlined text-[11px]">{icon}</span>}
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
 *  always shown, so a returning operator reads it without learning anything. */
export function UsageStrip({ usage, className = "" }) {
  if (!usage) return null;
  return (
    <div className={`flex items-center gap-3 flex-wrap text-[11px] text-text-muted ${className}`}>
      <span className="inline-flex items-center gap-1" title={translate("Requests")}>
        <span className="material-symbols-outlined text-[13px] text-primary/70">swap_calls</span>
        {Number(usage.requests || 0).toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Input tokens")}>
        <span className="material-symbols-outlined text-[13px] text-sky-500/70">south</span>
        {formatTokens(usage.promptTokens)} {translate("in")}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Output tokens")}>
        <span className="material-symbols-outlined text-[13px] text-emerald-500/70">north</span>
        {formatTokens(usage.completionTokens)} {translate("out")}
      </span>
      <span className="inline-flex items-center gap-1" title={translate("Total tokens")}>
        <span className="material-symbols-outlined text-[13px] text-violet-500/70">token</span>
        {formatTokens(usage.totalTokens)} {translate("total")}
      </span>
      <span className="inline-flex items-center gap-1 font-medium text-text-main" title={translate("Estimated spend")}>
        <span className="material-symbols-outlined text-[13px] text-amber-500/70">paid</span>
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
