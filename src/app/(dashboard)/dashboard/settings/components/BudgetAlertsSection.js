"use client";

import { useState } from "react";
import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input, Button } from "@/shared/components";

export default function BudgetAlertsSection({ settings, loading, patchNested }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });
  if (!settings) return null;
  const ba = settings.budgetAlerts || {};

  // Webhook URLs are write-only secrets — the GET response never echoes them.
  // We only know whether one is configured (hasDiscordWebhook / hasN8nWebhook).
  const saveChannel = async (channel, { enabled, webhookUrl }) => {
    setBusy(true); setMsg({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgetAlerts: {
            ...(channel === "discord"
              ? { discordEnabled: enabled, discordWebhookUrl: webhookUrl || "" }
              : { n8nEnabled: enabled, n8nWebhookUrl: webhookUrl || "" }),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ type: "error", message: data.error || "Failed" }); return; }
      // The server response carries the new presence flags — sync them locally.
      if (data.budgetAlerts) patchNested("budgetAlerts", data.budgetAlerts);
      setMsg({ type: "success", message: "Saved" });
    } catch { setMsg({ type: "error", message: "An error occurred" }); }
    setBusy(false);
  };

  return (
    <SettingsSection icon="notifications" title="Budget Alerts" accent="orange">
      <div className="flex flex-col gap-4">
        {/* Discord */}
        <ChannelRow
          title="Discord"
          icon="chat"
          desc="Send budget alerts to a Discord channel via webhook"
          enabled={ba.discordEnabled === true}
          hasWebhook={ba.hasDiscordWebhook === true}
          webhookPlaceholder={ba.hasDiscordWebhook ? "Webhook configured — enter a new URL to replace it" : "https://discord.com/api/webhooks/..."}
          onSave={(enabled, url) => saveChannel("discord", { enabled, webhookUrl: url })}
          loading={loading || busy}
        />

        <hr className="border-border/50" />

        {/* n8n */}
        <ChannelRow
          title="n8n"
          icon="account_tree"
          desc="Send budget alerts to an n8n webhook workflow"
          enabled={ba.n8nEnabled === true}
          hasWebhook={ba.hasN8nWebhook === true}
          webhookPlaceholder={ba.hasN8nWebhook ? "Webhook configured — enter a new URL to replace it" : "https://n8n.example.com/webhook/..."}
          onSave={(enabled, url) => saveChannel("n8n", { enabled, webhookUrl: url })}
          loading={loading || busy}
        />

        <hr className="border-border/50" />

        {/* Weekly Digest */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm">Weekly Digest</p>
            <Toggle checked={ba.weeklyDigestEnabled === true}
              onChange={() => patchNested("budgetAlerts", { weeklyDigestEnabled: !ba.weeklyDigestEnabled })} disabled={loading} />
          </div>
          <p className="text-xs text-text-muted">Receive a weekly usage summary through configured alert channels</p>
        </div>

        {msg.message && <p className={`text-xs ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>{msg.message}</p>}
      </div>
    </SettingsSection>
  );
}

function ChannelRow({ title, icon, desc, enabled, hasWebhook, webhookPlaceholder, onSave, loading }) {
  const [url, setUrl] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>
          <p className="font-medium text-sm">{title}</p>
          {hasWebhook && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">webhook set</span>
          )}
        </div>
        <Toggle checked={enabled} onChange={() => onSave(!enabled, url)} disabled={loading} />
      </div>
      <p className="text-xs text-text-muted mb-2">{desc}</p>
      {enabled && (
        <div className="flex gap-2">
          <Input type="url" placeholder={webhookPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} disabled={loading} />
          <Button type="button" variant="secondary" size="sm" loading={loading} disabled={!url.trim()} onClick={() => onSave(true, url)}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}