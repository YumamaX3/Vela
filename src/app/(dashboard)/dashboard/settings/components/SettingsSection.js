"use client";

import { Card } from "@/shared/components";

/** Shared section wrapper — icon + title + children. */
export default function SettingsSection({ icon, title, children, accent = "primary" }) {
  const accents = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-500/10 text-blue-500",
    purple: "bg-purple-500/10 text-purple-500",
    indigo: "bg-indigo-500/10 text-indigo-500",
    orange: "bg-orange-500/10 text-orange-500",
    cyan: "bg-cyan-500/10 text-cyan-500",
    green: "bg-green-500/10 text-green-500",
    amber: "bg-amber-500/10 text-amber-500",
    red: "bg-red-500/10 text-red-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
    teal: "bg-teal-500/10 text-teal-500",
  };
  const ac = accents[accent] || accents.primary;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-lg shrink-0 ${ac}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

/** Row: label + description + toggle or control on the right. */
export function SettingsRow({ label, desc, children, className }) {
  return (
    <div className={`flex items-start sm:items-center justify-between gap-4 ${className || ""}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm sm:text-base">{label}</p>
        {desc && <p className="text-xs sm:text-sm text-text-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}