"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import BudgetAlertsSection from "../components/BudgetAlertsSection";
import UsageWebhookSection from "../components/UsageWebhookSection";

export default function AlertsPage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    patch: ctx.patch,
    toggle: ctx.toggle,
    setString: ctx.setString,
    setNumber: ctx.setNumber,
    patchNested: ctx.patchNested,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Alerts & Webhooks</h1>
        <p className="text-sm text-text-muted mt-1">
          Budget alerts via Discord or n8n, weekly usage digest, and usage
          telemetry webhook for external monitoring.
        </p>
      </div>
      <BudgetAlertsSection {...sp} />
      <UsageWebhookSection {...sp} />
    </div>
  );
}