"use client";

import { useMemo } from "react";

/**
 * Derives a per-section status from the settings blob.
 * Pure computation — no fetch, no state. Recalculates on every settings update.
 *
 * "ok"   = configured / active / safe
 * "warn" = needs operator attention (e.g. login disabled, SSO unconfigured)
 * "none" = neutral / untouched
 */
export function useSettingsStatus(settings) {
  return useMemo(() => {
    if (!settings) return {};
    const ba = settings.budgetAlerts || {};
    return {
      appearance: "none",
      security:
        settings.requireLogin === false
          ? "warn"
          : settings.hasPassword === false
            ? "warn"
            : "ok",
      authentication:
        settings.authMode !== "password" &&
        !settings.oidcConfigured &&
        !settings.samlEntryPoint
          ? "warn"
          : settings.oidcConfigured || settings.samlEntryPoint
            ? "ok"
            : "none",
      routing: "none",
      "token-savers":
        settings.rtkEnabled !== false
          ? settings.cavemanEnabled ||
            settings.ponytailEnabled ||
            settings.pxpipeEnabled ||
            settings.headroomEnabled
            ? "ok"
            : "none"
          : "none",
      network:
        settings.outboundProxyEnabled === true ? "ok" : "none",
      storage: "none",
      alerts:
        ba.discordEnabled || ba.n8nEnabled || ba.weeklyDigestEnabled
          ? "ok"
          : "none",
      observability:
        settings.enableObservability === true ? "ok" : "none",
      capacity: "none",
      system: "none",
    };
  }, [settings]);
}