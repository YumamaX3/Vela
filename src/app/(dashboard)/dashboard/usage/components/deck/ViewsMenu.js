// Usage Observatory W4-A — the saved-views menu on the Needle bar.
//
// A saved view IS the compass query string (tab + every facet). Applying one
// is a plain URL replace; saving one captures `searchParams.toString()` —
// the server whitelists the compass keys (savedViewDef.js), so a view can
// only ever re-shape the compass, never carry foreign state. Fail-open
// throughout: an unreachable API leaves the menu quiet, never broken.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { t } from "../../lib/t";

export default function ViewsMenu({ compass }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); // "" | "exists" | message

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/usage/views");
      if (!r.ok) return; // fail-open — the menu stays quiet
      const d = await r.json();
      setViews(Array.isArray(d.views) ? d.views : []);
    } catch { /* fail-open */ }
  }, []);

  // Initial load rides the effect like the Needle's facet sources — inline
  // fetch with an alive-guard, never a named state-setter call.
  useEffect(() => {
    let alive = true;
    fetch("/api/usage/views").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (alive && d) setViews(Array.isArray(d.views) ? d.views : []);
    }).catch(() => {}); // fail-open
    return () => { alive = false; };
  }, []);

  // Close on any click outside the popover.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const applyView = (view) => {
    router.replace(`?${view.params}`, { scroll: false });
    setOpen(false);
  };

  const saveView = async (replace = false) => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t("View name is required")); return; }
    const existing = views.find((v) => v.name === trimmed);
    if (existing && !replace) { setError("exists"); return; }
    setSaving(true);
    setError("");
    try {
      const params = searchParams.toString() || `tab=${compass.tab}`;
      const r = await fetch("/api/usage/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, params }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.errors?.[0] || t("Failed to save view"));
        return;
      }
      setName("");
      await load();
    } catch {
      setError(t("Failed to save view"));
    } finally {
      setSaving(false);
    }
  };

  const deleteView = async (id) => {
    try {
      await fetch(`/api/usage/views?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch { /* fail-open */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          open
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-text-muted hover:bg-bg-hover hover:text-text"
        }`}
        title={t("Saved views")}
      >
        <span className="material-symbols-outlined text-[14px] leading-none">bookmark</span>
        {t("Views")}
        {views.length > 0 && (
          <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">{views.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t("Saved views")}
          </div>

          {views.length === 0 ? (
            <div className="px-1 pb-2 text-xs text-text-muted">
              {t("No saved views yet")}
              <div className="mt-1 opacity-70">{t("Saved views keep your compass settings one click away.")}</div>
            </div>
          ) : (
            <ul className="max-h-52 overflow-y-auto">
              {views.map((v) => (
                <li key={v.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyView(v)}
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-bg-hover"
                    title={v.params}
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteView(v.id)}
                    title={t("Delete view")}
                    className="rounded-md p-1 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-red-500 group-hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-[14px] leading-none">delete</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 border-t border-border pt-2">
            <div className="px-1 pb-1 text-xs font-medium text-text">{t("Save current view")}</div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={name}
                maxLength={64}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") saveView(); }}
                placeholder={t("View name")}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="button"
                onClick={() => saveView()}
                disabled={saving || !name.trim()}
                className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? t("Saving…") : t("Save")}
              </button>
            </div>
            {error === "exists" ? (
              <div className="mt-1 flex items-center gap-2 rounded-md bg-bg-subtle px-2 py-1.5 text-xs text-text-muted">
                <span className="min-w-0 flex-1">
                  {t("A view named \"{name}\" already exists — saving replaces it.").replace("{name}", name.trim())}
                </span>
                <button
                  type="button"
                  onClick={() => saveView(true)}
                  className="shrink-0 rounded bg-primary px-2 py-0.5 font-semibold text-white hover:opacity-90"
                >
                  {t("Replace")}
                </button>
              </div>
            ) : error ? (
              <div className="mt-1 px-1 text-xs text-red-500">{error}</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
