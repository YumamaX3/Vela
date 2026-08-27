"use client";

import { useState } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const SAMPLE_JSON = `[
  { "name": "friend-1", "category": "friend" },
  { "name": "batch-1", "rateLimitRpm": 30, "tokenBudgetDaily": 500000 }
]`;

const SAMPLE_CSV = `name,category,rateLimitRpm,tokenBudgetDaily
friend-1,friend,,
batch-1,,30,500000`;

/**
 * ImportModal — bulk-mint keys from a JSON array or CSV string (Key Domain
 * Ascension). Every row converges on mintKey() (surface "import-mint"); the
 * one-time secrets are NOT returned here — they ride the pending-reveals flow,
 * so the modal points the operator at the reveal collector.
 */
export default function ImportModal({ open, onClose, onImport }) {
  const [mode, setMode] = useState("json");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const close = () => {
    setText("");
    setError("");
    setResult(null);
    setBusy(false);
    onClose();
  };

  const run = async () => {
    if (!text.trim()) {
      setError(translate("Paste key rows first"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const payload = mode === "json"
        ? (() => {
            try {
              const parsed = JSON.parse(text);
              return { keys: Array.isArray(parsed) ? parsed : parsed?.keys || [] };
            } catch (e) {
              throw new Error(translate("Invalid JSON: ") + e.message);
            }
          })()
        : { csv: text };
      const res = await onImport(payload);
      if (res?.ok) setResult(res);
      else setError(res?.error || translate("Import failed"));
    } catch (e) {
      setError(e?.message || translate("Import failed"));
    } finally {
      setBusy(false);
    }
  };

  const loadSample = () => setText(mode === "json" ? SAMPLE_JSON : SAMPLE_CSV);

  return (
    <Modal isOpen={open} onClose={close} title={translate("Import keys")} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {["json", "csv"].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); setResult(null); }}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                mode === m ? "bg-primary/10 border-primary/40 text-primary" : "border-border-subtle text-text-muted hover:text-text-main"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={loadSample}>{translate("Load sample")}</Button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={mode === "json" ? translate('[{ "name": "friend-1", "category": "friend" }]') : translate("name,category,rateLimitRpm")}
          className="w-full p-3 rounded-lg border border-border-subtle bg-surface-2 text-xs font-mono resize-y"
        />

        <p className="text-xs text-text-muted">
          {translate("Columns: name (required), description, category, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt.")}
        </p>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {result && (
          <div className="border border-green-300 dark:border-green-800 bg-green-500/5 rounded-lg p-3 text-sm">
            <p className="font-medium text-green-700 dark:text-green-400">
              {translate(`${result.summary?.ok || 0} of ${result.summary?.total || 0} key(s) minted`)}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {translate("The one-time secrets ride the pending-reveals flow — collect them from the Keys tab reveal collector. They are never shown here.")}
            </p>
            {result.results?.some((r) => !r.ok) && (
              <ul className="text-xs text-amber-600 dark:text-amber-400 mt-2 max-h-32 overflow-y-auto">
                {result.results.filter((r) => !r.ok).slice(0, 10).map((r, i) => (
                  <li key={i}>✗ {r.name}: {r.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={run} fullWidth disabled={busy}>{busy ? translate("Importing…") : translate("Import")}</Button>
          <Button onClick={close} variant="ghost" fullWidth>{translate("Close")}</Button>
        </div>
      </div>
    </Modal>
  );
}
