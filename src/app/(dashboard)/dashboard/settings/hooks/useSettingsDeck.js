"use client";

// The settings deck's data current and its one write path.
//
// One read, one mutation door, and one place that decides what "configured"
// means. Every tab receives this same object and calls the same `patch` — so no
// tab can hold a private opinion about whether single sign-on is armed, and a
// tab added later cannot invent its own fetch.
//
// `pending` is keyed by SETTING NAME rather than by tab: the row that owns a
// control shows its own in-flight state, and saving the proxy does not dim the
// theme switcher two tabs away.

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSettings, patchSettings } from "../lib/settingsApi";

// authMode values that mean "an external identity provider is in play".
const SSO_MODES = ["sso", "saml", "oidc", "both"];

export default function useSettingsDeck() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState({});
  const [remoteHost, setRemoteHost] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
      setLoadError("");
      return data;
    } catch (err) {
      setLoadError(err.message || "Failed to load settings");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // `keys` names the settings the call touches. Omit it and every key in the
  // body is treated as in flight, which is the right default for a flat patch.
  const patch = useCallback(async (body, keys) => {
    const inflight = keys || Object.keys(body);
    setPending((prev) => {
      const next = { ...prev };
      for (const k of inflight) next[k] = true;
      return next;
    });
    try {
      const data = await patchSettings(body);
      // The response is the server's own view of settings, so the merge is a
      // reflection rather than an optimistic guess — if the write was refused or
      // normalized, the room shows what actually landed.
      setSettings((prev) => ({ ...prev, ...data }));
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to save settings" };
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        for (const k of inflight) delete next[k];
        return next;
      });
    }
  }, []);

  const derived = useMemo(() => {
    const authMode = settings.authMode || "password";
    return {
      authMode,
      hasPassword: settings.hasPassword === true,
      ssoMode: SSO_MODES.includes(authMode),
      oidcConfigured: settings.oidcConfigured === true,
      samlConfigured: !!(settings.samlEntryPoint && settings.samlCert),
      proxyEnabled: settings.outboundProxyEnabled === true,
      observabilityEnabled: settings.enableObservability === true,
      requireLogin: settings.requireLogin === true,
      roundRobin: settings.fallbackStrategy === "round-robin",
      comboRoundRobin: settings.comboStrategy === "round-robin",
      // What the masthead reports as "armed". Ordered the way an operator
      // reads a console: the door first, then the identity behind it.
      armed: {
        password: settings.requireLogin === true,
        sso: SSO_MODES.includes(authMode),
        proxy: settings.outboundProxyEnabled === true,
        recording: settings.enableObservability === true,
      },
    };
  }, [settings]);

  return {
    settings,
    loading,
    loadError,
    pending,
    patch,
    reload,
    remoteHost,
    ...derived,
  };
}
