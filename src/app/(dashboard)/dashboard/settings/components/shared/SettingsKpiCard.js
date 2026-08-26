"use client";

import Link from "next/link";

const COLORS = {
  ok: "text-emerald-500 bg-emerald-500/10",
  warn: "text-amber-500 bg-amber-500/10",
  error: "text-red-500 bg-red-500/10",
  none: "text-text-muted bg-surface-2",
};

export default function SettingsKpiCard({ icon, label, value, status = "none", href }) {
  const CardTag = href ? Link : "div";

  return (
    <CardTag
      href={href || ""}
      className={`block rounded-xl border p-4 transition-all ${
        href ? "hover:border-brand-500/30 hover:shadow-sm cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${COLORS[status] || COLORS.none}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-medium">
            {label}
          </p>
          <p className={`font-semibold text-sm truncate ${
            status === "warn" ? "text-amber-500" : ""
          }`}>
            {value}
          </p>
        </div>
      </div>
    </CardTag>
  );
}