import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];

// Settings Observatory: usageWebhookUrl is secret-bearing (a Discord/Slack
// webhook URL carries a token) — same law as budgetAlerts above: presence
// flag only, never an echo.
export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    if ("usageWebhookUrl" in safeSettings) {
      safeSettings.hasUsageWebhook =
        typeof safeSettings.usageWebhookUrl === "string" && !!safeSettings.usageWebhookUrl.trim();
      delete safeSettings.usageWebhookUrl;
    }
    // W3-C: budget webhook URLs are secret-bearing (a Discord webhook URL
    // carries a token) — never echo them back. Expose presence flags only,
    // mirroring the oidcConfigured / hasPassword precedent.
    if (safeSettings.budgetAlerts) {
      const ba = safeSettings.budgetAlerts;
      safeSettings.budgetAlerts = {
        discordEnabled: !!ba.discordEnabled,
        n8nEnabled: !!ba.n8nEnabled,
        weeklyDigestEnabled: !!ba.weeklyDigestEnabled,
        hasDiscordWebhook: !!(typeof ba.discordWebhookUrl === "string" && ba.discordWebhookUrl.trim()),
        hasN8nWebhook: !!(typeof ba.n8nWebhookUrl === "string" && ba.n8nWebhookUrl.trim()),
      };
    }
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error getting settings:", error?.message || error);
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    // Settings Observatory — numeric fields: coerce + clamp before persisting
    // so a stray string from an <input> never poisons the settings blob.
    const NUMERIC_BOUNDS = [
      ["sessionTimeoutMins", 0, 10080],
      ["auditRetentionDays", 1, 3650],
      ["maxRetries", 0, 10],
      ["requestTimeoutSecs", 5, 3600],
      ["connectTimeoutSecs", 1, 120],
      ["usageRetentionDays", 1, 36500],
    ];
    for (const [key, min, max] of NUMERIC_BOUNDS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const n = Math.round(Number(body[key]));
        if (!Number.isFinite(n)) delete body[key];
        else body[key] = Math.min(max, Math.max(min, n));
      }
    }

    // Enum-typed fields: reject unknown values rather than storing them.
    const ENUM_FIELDS = {
      fallbackStrategy: ["fill-first", "round-robin", "least-used", "random"],
      accentColor: ["coral", "ocean", "emerald", "violet", "amber"],
      density: ["comfortable", "compact"],
      fontSize: ["s", "m", "l", "xl"],
      defaultPage: ["/dashboard", "/dashboard/endpoint", "/dashboard/usage", "/dashboard/logs"],
    };
    for (const [key, allowed] of Object.entries(ENUM_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(body, key) && !allowed.includes(body[key])) {
        return NextResponse.json({ error: `Invalid value for "${key}"` }, { status: 400 });
      }
    }

    // usageWebhookUrl: empty string means "keep the stored one" (write-only
    // secret, mirroring oidcClientSecret); a non-empty value overwrites.
    if (
      Object.prototype.hasOwnProperty.call(body, "usageWebhookUrl") &&
      typeof body.usageWebhookUrl === "string" &&
      !body.usageWebhookUrl.trim()
    ) {
      delete body.usageWebhookUrl;
    }

    // W3-C: budgetAlerts is a nested object — updateSettings shallow-merges
    // top-level keys, so a partial client payload would clobber stored
    // webhook URLs. Deep-merge against the current values; an empty-string
    // URL means "keep the stored one" (the UI shows a placeholder, never the
    // secret itself).
    if (Object.prototype.hasOwnProperty.call(body, "budgetAlerts")) {
      const current = ((await getSettings()) || {}).budgetAlerts || {};
      const patch = body.budgetAlerts && typeof body.budgetAlerts === "object" ? body.budgetAlerts : {};
      body.budgetAlerts = {
        discordEnabled: "discordEnabled" in patch ? !!patch.discordEnabled : !!current.discordEnabled,
        n8nEnabled: "n8nEnabled" in patch ? !!patch.n8nEnabled : !!current.n8nEnabled,
        weeklyDigestEnabled: "weeklyDigestEnabled" in patch ? !!patch.weeklyDigestEnabled : !!current.weeklyDigestEnabled,
        discordWebhookUrl:
          typeof patch.discordWebhookUrl === "string" && patch.discordWebhookUrl.trim()
            ? patch.discordWebhookUrl.trim()
            : (typeof current.discordWebhookUrl === "string" ? current.discordWebhookUrl : ""),
        n8nWebhookUrl:
          typeof patch.n8nWebhookUrl === "string" && patch.n8nWebhookUrl.trim()
            ? patch.n8nWebhookUrl.trim()
            : (typeof current.n8nWebhookUrl === "string" ? current.n8nWebhookUrl : ""),
      };
    }

    // Settings Observatory v2 — section reset. The frontend sends
    // { _resetSection: "security" } and the server fills in defaults
    // for only that section's keys, leaving the rest of the blob intact.
    // The section-key map lives here (not in settingsDefaults) because
    // the reset logic is a PATCH concern.
    if (
      Object.prototype.hasOwnProperty.call(body, "_resetSection") &&
      typeof body._resetSection === "string"
    ) {
      const { mergeWithDefaults } = await import("@/lib/db/repos/settingsDefaults");
      const defaults = mergeWithDefaults({});
      const SECTION_KEYS = {
        appearance: [
          "accentColor", "density", "fontSize", "reduceMotion",
          "highContrast", "showVersionBadge", "autoDetectLocale",
        ],
        security: [
          "requireLogin", "sessionTimeoutMins", "ipAllowlist",
          "bruteForceLockout", "securityHeadersEnabled",
          "securityAlerts", "auditEnabled", "auditRetentionDays",
        ],
        authentication: ["authMode", "ssoType", "requireApiKey"],
        routing: [
          "fallbackStrategy", "stickyRoundRobinLimit",
          "comboStrategy", "comboStickyRoundRobinLimit", "maxRetries",
        ],
        network: [
          "outboundProxyEnabled", "outboundProxyUrl", "outboundNoProxy",
          "requestTimeoutSecs", "connectTimeoutSecs",
          "keepAlivePool", "dnsPrefetch", "poolGeoProbe", "poolGeoProbeUrl",
        ],
        "token-savers": [
          "rtkEnabled", "cavemanEnabled", "cavemanLevel",
          "ponytailEnabled", "ponytailLevel",
          "pxpipeEnabled", "pxpipeMinChars", "pxpipeTimeoutMs",
          "headroomEnabled", "headroomUrl", "headroomCompressUserMessages",
        ],
        storage: ["usageRetentionDays", "keepRequestPayloads"],
        alerts: ["budgetAlerts", "usageWebhookEnabled", "usageWebhookUrl"],
        observability: [
          "enableObservability", "observabilityMaxRecords",
          "observabilityBatchSize", "observabilityFlushIntervalMs",
          "observabilityMaxJsonSize",
        ],
        capacity: ["capacityAdapter"],
      };
      const keys = SECTION_KEYS[body._resetSection];
      if (keys) {
        for (const k of keys) body[k] = defaults[k];
      }
      delete body._resetSection;
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // W3-D: the weekly digest scheduler is settings-driven (budgetAlerts
    // .weeklyDigestEnabled) — arm/disarm it on any budgetAlerts change.
    if (Object.prototype.hasOwnProperty.call(body, "budgetAlerts")) {
      import("@/sse/services/usageDigest.js")
        .then(({ configureDigestScheduler }) => configureDigestScheduler())
        .catch((error) => console.warn("[digest] scheduler configure failed:", error.message));
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    if ("usageWebhookUrl" in safeSettings) {
      safeSettings.hasUsageWebhook =
        typeof safeSettings.usageWebhookUrl === "string" && !!safeSettings.usageWebhookUrl.trim();
      delete safeSettings.usageWebhookUrl;
    }
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error updating settings:", error?.message || error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
