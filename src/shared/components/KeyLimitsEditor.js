"use client";
// Key limits editor — shared by the create-key and edit-key modals.
// Plan: plans/vela-key-governance.md §3.6 W3c. Controlled component:
//   value = {
//     rateLimitRpm:  null | int,     requests/minute (null = unlimited)
//     tokenBudget:   null | int,     tokens per window
//     budgetScope:   "daily"|"weekly"|"monthly"|"yearly"  (window for BOTH budgets)
//     spendCapCents: null | int,     dollars*100 per window
//     expiresAt:     null | ISO string
//     ipAllowlist:   null | string[] (CIDRs)
//   }
// The parent maps tokenBudget→tokenBudgetDaily and spendCapCents→spendCapDailyCents
// at submit time (column names carry "Daily" for migration compatibility).
import { useState } from "react";
import { Select, Toggle, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const RPM_PRESETS = [10, 60, 300, 600, 1000];
const TOKEN_PRESETS = [
  { v: 1_000_000, label: "1M" },
  { v: 10_000_000, label: "10M" },
  { v: 100_000_000, label: "100M" },
  { v: 1_000_000_000, label: "1B" },
];
const SPEND_PRESETS = [
  { v: 500, label: "$5" },
  { v: 1000, label: "$10" },
  { v: 5000, label: "$50" },
  { v: 10000, label: "$100" },
];
const BUDGET_SCOPES = ["daily", "weekly", "monthly", "yearly"];

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary border border-primary/40 transition-all"
          : "px-2.5 py-1 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border-subtle hover:border-primary/40 hover:text-primary transition-all"
      }
    >
      {children}
    </button>
  );
}

function Section({ title, hint, on, onChange, children }) {
  return (
    <div className="border border-border-subtle rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-text-muted">{hint}</p>
        </div>
        <Toggle size="sm" checked={on} onChange={onChange} />
      </div>
      {on && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

export default function KeyLimitsEditor({ value, onChange }) {
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });

  // Expiry picker mode is display state — the truth lives in value.expiresAt.
  // Parent mounts this component with a key per form, so mode resets per key.
  const [expiryMode, setExpiryMode] = useState(v.expiresAt ? "custom" : "never");
  const expiryToDate = v.expiresAt ? v.expiresAt.slice(0, 10) : "";

  const setExpiry = (mode) => {
    setExpiryMode(mode);
    if (mode === "never") return set({ expiresAt: null });
    if (mode === "custom") {
      // Keep an existing date when switching to custom; default to +30 days.
      if (!v.expiresAt) set({ expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
      return;
    }
    const days = { "7d": 7, "30d": 30, "90d": 90 }[mode];
    set({ expiresAt: new Date(Date.now() + days * 864e5).toISOString() });
  };

  const budgetsActive = v.tokenBudget != null || v.spendCapCents != null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-text-main">{translate("Limits")}</p>

      {/* Rate limit — requests per minute */}
      <Section
        title={translate("Rate limit")}
        hint={translate("Requests per minute")}
        on={v.rateLimitRpm != null}
        onChange={(c) => set({ rateLimitRpm: c ? (v.rateLimitRpm ?? 60) : null })}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {RPM_PRESETS.map((p) => (
            <Chip key={p} active={v.rateLimitRpm === p} onClick={() => set({ rateLimitRpm: p })}>
              {p}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => set({ rateLimitRpm: null })}
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border-subtle hover:text-primary hover:border-primary/40 transition-all"
          >
            {translate("Unlimited")}
          </button>
        </div>
        <Input
          type="number"
          min="1"
          placeholder={translate("Custom")}
          value={v.rateLimitRpm ?? ""}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            set({ rateLimitRpm: Number.isFinite(n) && n > 0 ? n : null });
          }}
        />
      </Section>

      {/* Token budget + window */}
      <Section
        title={translate("Token budget")}
        hint={translate("Tokens allowed per window")}
        on={v.tokenBudget != null}
        onChange={(c) => set({ tokenBudget: c ? (v.tokenBudget ?? 1_000_000) : null })}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {TOKEN_PRESETS.map((p) => (
            <Chip key={p.label} active={v.tokenBudget === p.v} onClick={() => set({ tokenBudget: p.v })}>
              {p.label}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => set({ tokenBudget: null })}
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border-subtle hover:text-primary hover:border-primary/40 transition-all"
          >
            {translate("Unlimited")}
          </button>
        </div>
        <Input
          type="number"
          min="1"
          placeholder={translate("Custom")}
          value={v.tokenBudget ?? ""}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            set({ tokenBudget: Number.isFinite(n) && n > 0 ? n : null });
          }}
        />
      </Section>

      {/* Spend cap */}
      <Section
        title={translate("Spend cap")}
        hint={translate("Maximum spend per window")}
        on={v.spendCapCents != null}
        onChange={(c) => set({ spendCapCents: c ? (v.spendCapCents ?? 1000) : null })}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {SPEND_PRESETS.map((p) => (
            <Chip key={p.label} active={v.spendCapCents === p.v} onClick={() => set({ spendCapCents: p.v })}>
              {p.label}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => set({ spendCapCents: null })}
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border-subtle hover:text-primary hover:border-primary/40 transition-all"
          >
            {translate("Unlimited")}
          </button>
        </div>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          placeholder={translate("Custom")}
          value={v.spendCapCents != null ? (v.spendCapCents / 100).toString() : ""}
          onChange={(e) => {
            const d = parseFloat(e.target.value);
            set({ spendCapCents: Number.isFinite(d) && d > 0 ? Math.round(d * 100) : null });
          }}
        />
      </Section>

      {/* One window governs both budgets — selector appears when either is set */}
      {budgetsActive && (
        <Select
          label={translate("Reset window")}
          hint={translate("Budget window applies to both token budget and spend cap")}
          value={v.budgetScope || "daily"}
          onChange={(e) => set({ budgetScope: e.target.value })}
          options={BUDGET_SCOPES.map((s) => ({
            value: s,
            label: translate(s.charAt(0).toUpperCase() + s.slice(1)),
          }))}
        />
      )}

      {/* Expiration */}
      <Select
        label={translate("Expiration")}
        value={expiryMode}
        onChange={(e) => setExpiry(e.target.value)}
        options={[
          { value: "never", label: translate("Never") },
          { value: "7d", label: translate("In 7 days") },
          { value: "30d", label: translate("In 30 days") },
          { value: "90d", label: translate("In 90 days") },
          { value: "custom", label: translate("Custom date") },
        ]}
      />
      {expiryMode === "custom" && (
        <Input
          type="date"
          value={expiryToDate}
          onChange={(e) => {
            if (!e.target.value) return set({ expiresAt: null });
            // End of the chosen local day — the key lives through that day.
            set({ expiresAt: new Date(`${e.target.value}T23:59:59`).toISOString() });
          }}
        />
      )}

      {/* IP allowlist */}
      <Section
        title={translate("IP allowlist")}
        hint={translate("Only these addresses may use this key")}
        on={v.ipAllowlist != null}
        onChange={(c) => set({ ipAllowlist: c ? (v.ipAllowlist ?? []) : null })}
      >
        <textarea
          rows={3}
          placeholder={translate("One CIDR per line (e.g. 10.0.0.0/8). Empty = unrestricted.")}
          value={(v.ipAllowlist || []).join("\n")}
          onChange={(e) =>
            set({ ipAllowlist: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })
          }
          className="w-full text-sm font-mono p-3 bg-surface-2 border border-transparent rounded-[10px] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all"
        />
      </Section>
    </div>
  );
}
