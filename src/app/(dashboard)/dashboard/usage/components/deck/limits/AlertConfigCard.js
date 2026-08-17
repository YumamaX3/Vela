// Usage Observatory W3-C + W3-D — the alert channel configuration card.
//
// Where the Star arms the budget alert channels: Discord webhook + n8n
// webhook toggles, each with its URL input, and the weekly usage digest
// toggle (W3-D) that rides the same channels every Monday. Reads the MASKED
// shape from GET /api/settings (presence flags only — the webhook URLs are
// secret-bearing and never round-trip to the client), and PATCHes
// settings.budgetAlerts. The server deep-merges: an omitted/empty URL keeps
// the stored one, so the input reads as a "replace" field, never an echo of
// the secret.
//
// Delivery itself is fail-open (budgetAlerts.js / usageDigest.js) — this card
// only configures.
"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Toggle from "@/shared/components/Toggle";
import { t } from "../../../lib/t";

const isHttpUrl = (v) => !v || /^https?:\/\//i.test(v.trim());

export default function AlertConfigCard() {
  const [form, setForm] = useState(null); // { discordEnabled, n8nEnabled, weeklyDigestEnabled }
  const [flags, setFlags] = useState({}); // { hasDiscordWebhook, hasN8nWebhook }
  const [discordUrl, setDiscordUrl] = useState("");
  const [n8nUrl, setN8nUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg } | null

  const load = useCallback(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ba = d?.budgetAlerts || {};
        setForm({
          discordEnabled: !!ba.discordEnabled,
          n8nEnabled: !!ba.n8nEnabled,
          weeklyDigestEnabled: !!ba.weeklyDigestEnabled,
        });
        setFlags({ hasDiscordWebhook: !!ba.hasDiscordWebhook, hasN8nWebhook: !!ba.hasN8nWebhook });
      })
      .catch(() => setForm({ discordEnabled: false, n8nEnabled: false, weeklyDigestEnabled: false })); // fail-open
  }, []);

  useEffect(() => { load(); }, [load]);

  const invalidUrl = !isHttpUrl(discordUrl) || !isHttpUrl(n8nUrl);

  const save = async () => {
    if (!form || saving || invalidUrl) return;
    setSaving(true);
    setStatus(null);
    try {
      const patch = {
        discordEnabled: !!form.discordEnabled,
        n8nEnabled: !!form.n8nEnabled,
        weeklyDigestEnabled: !!form.weeklyDigestEnabled,
      };
      // Empty URL = keep the stored one (server deep-merge); only send when set.
      if (discordUrl.trim()) patch.discordWebhookUrl = discordUrl.trim();
      if (n8nUrl.trim()) patch.n8nWebhookUrl = n8nUrl.trim();
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetAlerts: patch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDiscordUrl("");
      setN8nUrl("");
      setStatus({ ok: true, msg: t("Saved") });
      load(); // refresh presence flags
    } catch {
      setStatus({ ok: false, msg: t("Save failed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="none">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text">{t("Alert channels")}</span>
          <span className="text-[11px] text-text-muted">
            {t("Budget alerts fire at 50%, 80%, and 100% of each budget window.")}
          </span>
        </div>
        <span className="material-symbols-outlined text-[18px] text-text-muted">notifications_active</span>
      </div>

      {form === null ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="h-5 w-2/5 animate-pulse rounded bg-bg-subtle" />
          <div className="h-5 w-3/5 animate-pulse rounded bg-bg-subtle" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          {/* Discord channel */}
          <div className="flex flex-col gap-2">
            <Toggle
              checked={form.discordEnabled}
              onChange={(v) => setForm((f) => ({ ...f, discordEnabled: v }))}
              label={t("Discord webhook")}
              description={t("Send budget alerts to a Discord channel.")}
              size="md"
            />
            <input
              type="url"
              value={discordUrl}
              onChange={(e) => { setDiscordUrl(e.target.value); setStatus(null); }}
              placeholder={flags.hasDiscordWebhook ? t("Stored — replace to change") : "https://discord.com/api/webhooks/…"}
              aria-label={t("Discord webhook URL")}
              data-i18n-skip="true"
              className="w-full rounded-[10px] border border-border bg-bg px-3 py-1.5 font-mono text-[12px] text-text placeholder:text-text-muted/60 focus:border-primary focus:outline-none"
            />
          </div>

          {/* n8n channel */}
          <div className="flex flex-col gap-2">
            <Toggle
              checked={form.n8nEnabled}
              onChange={(v) => setForm((f) => ({ ...f, n8nEnabled: v }))}
              label={t("n8n webhook")}
              description={t("Send budget alerts to an n8n workflow.")}
              size="md"
            />
            <input
              type="url"
              value={n8nUrl}
              onChange={(e) => { setN8nUrl(e.target.value); setStatus(null); }}
              placeholder={flags.hasN8nWebhook ? t("Stored — replace to change") : "https://n8n.example/webhook/…"}
              aria-label={t("n8n webhook URL")}
              data-i18n-skip="true"
              className="w-full rounded-[10px] border border-border bg-bg px-3 py-1.5 font-mono text-[12px] text-text placeholder:text-text-muted/60 focus:border-primary focus:outline-none"
            />
          </div>

          {/* Weekly digest — W3-D, rides the channels above */}
          <div className="border-t border-border pt-3">
            <Toggle
              checked={form.weeklyDigestEnabled}
              onChange={(v) => setForm((f) => ({ ...f, weeklyDigestEnabled: v }))}
              label={t("Weekly digest")}
              description={t("Send a summary of last week's usage to the channels above every Monday.")}
              size="md"
            />
          </div>

          {/* Footer — status + save */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span
              className={`text-[11px] ${status?.ok ? "text-success" : status ? "text-error" : "text-text-muted"}`}
            >
              {status?.msg || t("Webhook URLs are stored masked — never echoed back.")}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving || invalidUrl}
              className="shrink-0 rounded-[10px] bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t("Saving…") : t("Save")}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
