// Usage Observatory W3 — Quota Panel (shared between /dashboard/quota page and Usage "quota" tab).
// Shows plan status band, per-account quota gauges from /api/keys usage, budget tracker from /api/usage/budgets.
"use client";

import { useEffect, useState, useCallback } from "react";
import Card from "@/shared/components/Card";
import QuotaProgressBar from "../ProviderLimits/QuotaProgressBar";
import { t } from "../../lib/t";

export default function QuotaPanel() {
  const [settings, setSettings] = useState(null);
  const [keys, setKeys] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, keysRes, budgetsRes] = await Promise.all([
        fetch("/api/settings").then((r) => r.ok ? r.json() : null),
        fetch("/api/keys?limit=200").then((r) => r.ok ? r.json() : null),
        fetch("/api/usage/budgets").then((r) => r.ok ? r.json() : null),
      ]);

      setSettings(settingsRes || {});
      setKeys(keysRes?.keys || []);
      setBudgets(budgetsRes || {});
    } catch {
      // fail-open
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchData().then(() => { if (!alive) return; });
    return () => { alive = false; };
  }, [fetchData]);

  if (loading) {
    return <Card padding="md"><p className="text-text-muted">Loading...</p></Card>;
  }

  const fmtCost = (cents) => {
    if (!cents || cents <= 0) return "$0.00";
    if (cents < 0.01) return "<$0.01";
    return `$${(cents / 100).toFixed(2)}`;
  };

  // Plan status band
  const PlanStatusBand = () => {
    const plan = settings?.billingPlan || "free";
    const planLabel = {
      free: translate("Free"),
      pro: translate("Pro"),
      enterprise: translate("Enterprise"),
    }[plan] || plan;

    return (
      <div className="mb-4 rounded-xl border border-brand-500/20 bg-gradient-to-r from-brand-500/10 to-brand-400/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider">{t("Current plan")}</p>
            <p className="text-sm font-semibold text-text-main mt-0.5">{planLabel}</p>
          </div>
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
            plan === "enterprise" ? "bg-green-500/20 text-green-600" :
            plan === "pro" ? "bg-blue-500/20 text-blue-600" :
            "bg-gray-500/20 text-gray-600"
          }`}>
            <span className="material-symbols-outlined text-[20px]">diamond</span>
          </span>
        </div>
      </div>
    );
  };

  // Per-key quota gauges
  const KeyUsageGauges = () => {
    if (!Array.isArray(keys) || !keys.length) {
      return <p className="text-sm text-text-muted py-4">{t("No API keys found")}</p>;
    }

    return (
      <div className="space-y-3">
        {keys.map((key) => {
          const limit = key.monthlySpendLimit || 0;
          const used = key.currentSpend || 0;
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

          return (
            <div key={key.id} className="rounded-lg border border-border bg-bg p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-main">{key.name}</p>
                  <code className="truncate text-[10px] text-text-muted" data-i18n-skip="true">{key.keyPrefix}</code>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-text-main" data-i18n-skip="true">{fmtCost(used)}</p>
                  {limit > 0 && (
                    <p className="text-xs text-text-muted">/ {fmtCost(limit)}</p>
                  )}
                </div>
              </div>
              <QuotaProgressBar value={pct} max={100} showLabel={false} />
            </div>
          );
        })}
      </div>
    );
  };

  // Budget tracker
  const BudgetTracker = () => {
    if (!budgets || !Object.keys(budgets).length) {
      return <p className="text-sm text-text-muted py-4">{t("No budgets configured")}</p>;
    }

    return (
      <div className="space-y-3">
        {Object.entries(budgets).map(([keyId, budget]) => {
          const key = keys?.find((k) => k.id === keyId);
          const name = key?.name || keyId;
          const threshold = budget.thresholdCents || 0;
          const currentSpend = budget.currentSpendCents || 0;
          const pct = threshold > 0 ? Math.min(100, (currentSpend / threshold) * 100) : 0;

          return (
            <div key={keyId} className="rounded-lg border border-border bg-bg p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-text-main">{name}</p>
                <p className="text-sm font-medium text-text-main" data-i18n-skip="true">{fmtCost(currentSpend)} / {fmtCost(threshold)}</p>
              </div>
              <QuotaProgressbar value={pct} max={100} showLabel={true} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PlanStatusBand />

      <h2 className="text-base font-semibold text-text-main">{t("API key quotas")}</h2>
      <KeyUsageGauges />

      <h2 className="pt-4 text-base font-semibold text-text-main">{t("Budget tracking")}</h2>
      <BudgetTracker />
    </div>
  );
}

function QuotaProgressbar({ value, max, showLabel = false }) {
  const width = (value / max) * 100;
  const colorClass = value >= 90 ? "bg-error" : value >= 70 ? "bg-warning" : "bg-success";

  return (
    <div className="relative">
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={`h-full ${colorClass} transition-[width] duration-300`}
          style={{ width: `${width}%` }}
        />
      </div>
      {showLabel && (
        <p className={`mt-1 text-xs ${
          value >= 90 ? "text-error" : value >= 70 ? "text-warning" : "text-success"
        }`}>
          {t("Used")} {Math.round(width)}%
        </p>
      )}
    </div>
  );
}

function translate(key) {
  // Fallback to English key for simple translation
  return key;
}
