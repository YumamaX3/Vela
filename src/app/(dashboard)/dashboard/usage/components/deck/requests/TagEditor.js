// Usage Observatory W4-C — the request tag editor (sealed plan W4-C).
// The drawer's annotation surface: show the row's tags as removable chips,
// add new ones through a validated input. Every save REPLACEs the full set
// through PUT /api/usage/metrics/ledger/tags — the route validates the set
// (≤64 chars, charset allow-list, ≤8 tags, case-insensitive dedupe) and
// answers with the stored set, so the editor trusts the server's echo rather
// than its own optimism. Fail-open: a failed save restores the chips and
// shows the honest error line.
//
// Render safety: tag names come from the database (operator-authored), and
// React escapes text children by construction; the charset allow-list means
// a tag can never carry CSV-breaking or HTML-breaking characters anyway.
"use client";

import { useState } from "react";
import { t } from "../../../lib/t";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_REQUEST } from "@/lib/requestTagDef";

export default function TagEditor({ usageId, tags, onChange }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function saveSet(next) {
    if (saving) return;
    const prev = tags;
    setSaving(true);
    setError(null);
    // Optimistic chips; the server echo is the truth and replaces them.
    onChange(next);
    try {
      const res = await fetch("/api/usage/metrics/ledger/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: usageId, tags: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        onChange(prev); // rollback — the set never left the harbor
        setError(Array.isArray(data?.errors) && data.errors.length ? data.errors[0] : data?.error || t("Could not save tags"));
        return;
      }
      onChange(data?.tags || next);
    } catch {
      onChange(prev);
      setError(t("Could not save tags"));
    } finally {
      setSaving(false);
    }
  }

  const removeTag = (name) => saveSet(tags.filter((x) => x !== name));

  const addDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed || saving) return;
    if (tags.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return; // already worn — no error, just a quiet no-op
    }
    setDraft("");
    saveSet([...tags, trimmed]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] font-medium text-text"
            data-i18n-skip="true"
          >
            {name}
            <button
              type="button"
              onClick={() => removeTag(name)}
              disabled={saving}
              aria-label={t("Remove tag {tag}", { tag: name })}
              title={t("Remove tag {tag}", { tag: name })}
              className="rounded-full p-0.5 text-text-muted transition-colors hover:bg-primary/20 hover:text-text disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[12px]" aria-hidden="true">close</span>
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-text-muted">{t("No tags yet")}</span>}
      </div>
      {tags.length < MAX_TAGS_PER_REQUEST && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            maxLength={MAX_TAG_LENGTH}
            disabled={saving}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }}
            placeholder={t("Add tag…")}
            aria-label={t("Add tag…")}
            className="h-7 w-44 rounded-lg border border-border bg-bg-subtle px-2 text-[11px] text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={addDraft}
            disabled={saving || !draft.trim()}
            className="h-7 rounded-lg border border-border bg-surface px-2 text-[11px] font-medium text-text transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            {saving ? t("Saving") : t("Add")}
          </button>
        </div>
      )}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
