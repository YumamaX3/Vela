"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-dismissing status banner. Listens to status from Context.
 * Success dismisses after 3s. Error stays until the user dismisses it.
 * A new status message replaces the current one.
 */
export default function SettingsStatusBanner({ status, onDismiss }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (status?.type === "success") {
      timerRef.current = setTimeout(() => onDismiss?.(), 3500);
    }
    return () => clearTimeout(timerRef.current);
  }, [status, onDismiss]);

  if (!status?.message) return null;

  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3 ${
        status.type === "error"
          ? "bg-red-500/10 text-red-500 border border-red-500/20"
          : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px]">
          {status.type === "error" ? "error" : "check_circle"}
        </span>
        <span>{status.message}</span>
      </div>
      <button
        type="button"
        onClick={() => onDismiss?.()}
        className="shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}