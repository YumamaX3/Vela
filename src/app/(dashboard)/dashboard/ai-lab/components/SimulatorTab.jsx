"use client";

import { useState } from "react";
import { Card, Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Simulator tab (criterion-1) — pick a rule, fabricate a refusal, watch the
 * REAL buildFallbackChain render the chain to the serving lane. Uses the same
 * shared expansion + matcher modules the engine uses, so what the operator
 * sees IS what dispatch does.
 */
export default function SimulatorTab({ settings }) {
  const [model, setModel] = useState("gpt-5");
  const [status, setStatus] = useState("403");
  const [errorText, setErrorText] = useState("content policy blocked by gateway");
  const [chain, setChain] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/lab/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, status: Number(status), errorText }),
      });
      const data = await res.json();
      setChain(data);
    } catch {
      setChain({ chain: [], note: "simulate endpoint unavailable" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold mb-1">{translate("Fallback Simulator")}</h2>
      <p className="text-xs text-text-muted mb-3">
        {translate("Fabricate a refusal → the real matcher renders the fallback chain → the serving lane that honors it.")}
      </p>
      <div className="flex flex-wrap gap-3 mb-3">
        <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} className="w-40" />
        <div>
          <label className="text-xs font-medium text-text-muted">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 p-2 rounded-lg border border-border-subtle bg-surface-2 text-sm">
            <option value="403">403</option>
            <option value="451">451</option>
            <option value="429">429</option>
            <option value="503">503</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-text-muted">Error text</label>
          <input className="mt-1 w-full p-2 rounded-lg border border-border-subtle bg-surface-2 text-sm font-mono" value={errorText} onChange={(e) => setErrorText(e.target.value)} />
        </div>
      </div>
      <Button onClick={run} disabled={running}>{running ? "Simulating…" : "Simulate"}</Button>

      {chain && (
        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 p-3">
          <div className="text-xs text-text-muted mb-1">verdict: {chain.verdict || "—"}</div>
          {chain.chain?.length ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono px-2 py-1 rounded bg-surface-3">{model}</span>
              <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
              {chain.chain.map((m, i) => (
                <span key={i} className="text-xs font-mono px-2 py-1 rounded bg-primary/10 text-primary">{m}</span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-text-muted">{chain.note || "no chain — no matching rules for this event"}</div>
          )}
        </div>
      )}
    </Card>
  );
}
