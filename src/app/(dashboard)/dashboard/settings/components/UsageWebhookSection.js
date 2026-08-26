"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input } from "@/shared/components";

export default function UsageWebhookSection({ settings, loading, toggle, setString, setNumber }) {
  if (!settings) return null;

  return (
    <SettingsSection icon="webhook" title="Usage Webhook" accent="indigo">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Enable webhook" desc="POST usage telemetry to an external endpoint (n8n, Discord, Slack)">
          <Toggle checked={settings.usageWebhookEnabled === true}
            onChange={() => toggle("usageWebhookEnabled")} disabled={loading} />
        </SettingsRow>

        {settings.usageWebhookEnabled && (
          <div>
            <label className="text-xs font-medium block mb-1">Webhook URL</label>
            <Input type="url" placeholder="https://n8n.example.com/webhook/usage" value={settings.usageWebhookUrl || ""}
              onChange={(e) => setString("usageWebhookUrl", e.target.value)} disabled={loading} />
            <p className="text-xs text-text-muted mt-1">Secret-bearing — Discord/Slack URLs carry tokens. Never echoed back.</p>
          </div>
        )}

        <hr className="border-border/50" />

        <p className="text-xs text-text-muted italic">
          Each completed request fires a POST with model, tokens, cost, key prefix, and status.
          Combine with n8n for Slack/Discord/email dispatch.
        </p>
      </div>
    </SettingsSection>
  );
}