"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Central settings hook — fetches the full settings blob once, exposes
 * every setting field plus typed updaters. Every component on the settings
 * page reads from and writes through this single source of truth.
 * Fail-open: the UI renders defaults; a failed PATCH reverts the local state.
 */
export function useSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ type: "", message: "" });

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch { /* fail-open */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  /** Patch one or more top-level keys. Reverts local state on failure. */
  const patch = useCallback(async (patchObj) => {
    const prev = settings;
    setSettings((s) => ({ ...s, ...patchObj }));
    setStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchObj),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettings(prev);
        setStatus({ type: "error", message: data.error || "Failed to update settings" });
      } else {
        setSettings((s) => ({ ...s, ...data }));
      }
    } catch {
      setSettings(prev);
      setStatus({ type: "error", message: "An error occurred" });
    }
  }, [settings, reload]);

  /** Toggle a boolean setting. */
  const toggle = useCallback((key) => {
    patch({ [key]: !settings?.[key] });
  }, [patch, settings]);

  /** Set a numeric setting (coerced). */
  const setNumber = useCallback((key, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    patch({ [key]: Math.round(n) });
  }, [patch]);

  /** Set a string setting. */
  const setString = useCallback((key, value) => {
    patch({ [key]: value });
  }, [patch]);

  /** Deep-merge a nested object (e.g. budgetAlerts, capacityAdapter). */
  const patchNested = useCallback(async (key, nested) => {
    const current = settings?.[key] || {};
    return patch({ [key]: { ...current, ...nested } });
  }, [patch, settings]);

  return {
    settings,
    loading,
    status,
    setStatus,
    reload,
    patch,
    toggle,
    setNumber,
    setString,
    patchNested,
  };
}