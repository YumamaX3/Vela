"use client";

import { createContext, useContext, useCallback, useState, useEffect, useRef } from "react";

const Ctx = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ type: "", message: "" });
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Settings fetch failed");
      const data = await res.json();
      if (mountedRef.current) setSettings(data);
    } catch { /* fail-open */ }
    if (mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    reload();
    return () => { mountedRef.current = false; };
  }, [reload]);

  const patch = useCallback(async (patchObj) => {
    const prev = settings;
    setSettings((s) => s ? { ...s, ...patchObj } : s);
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
        setSettings((s) => s ? { ...s, ...data } : s);
        setStatus({ type: "success", message: "Settings saved" });
      }
    } catch {
      setSettings(prev);
      setStatus({ type: "error", message: "Network error" });
    }
  }, [settings]);

  const toggle   = useCallback((k) => patch({ [k]: !settings?.[k] }), [patch, settings]);
  const setNumber = useCallback((k, v) => { const n = Number(v); if (Number.isFinite(n)) patch({ [k]: Math.round(n) }); }, [patch]);
  const setString = useCallback((k, v) => patch({ [k]: v }), [patch]);
  const patchNested = useCallback((k, nested) => { const cur = settings?.[k] || {}; return patch({ [k]: { ...cur, ...nested } }); }, [patch, settings]);

  return (
    <Ctx.Provider value={{ settings, loading, status, setStatus, reload, patch, toggle, setNumber, setString, patchNested }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettingsContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettingsContext must be used within <SettingsProvider>");
  return ctx;
}