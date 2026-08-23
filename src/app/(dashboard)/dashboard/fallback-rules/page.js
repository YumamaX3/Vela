"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ConfirmModal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const DEFAULT_STATUSES = "429,503";
const STATUS_PRESETS = ["429", "403", "500", "502", "503", "504"];

const TRIGGER_TYPES = [
  { value: "status", label: "HTTP status", hint: "Fires when the upstream returns a listed status (e.g. 429, 503)" },
  { value: "contentPolicy", label: "Content policy", hint: "Fires when the provider refuses content (400/403 + policy language)" },
  { value: "contextWindow", label: "Context window", hint: "Fires BEFORE dispatch when the input is near the model's window (saves a doomed call)" },
  { value: "timeout", label: "Timeout", hint: "Fires when the upstream call times out" },
  { value: "anyError", label: "Any error", hint: "Fires on every failure" },
];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function chainFromRule(rule) {
  if (Array.isArray(rule?.targetModels) && rule.targetModels.length > 0) return rule.targetModels;
  if (rule?.targetModel) return [rule.targetModel];
  return [];
}

function normalizeFormData(data = {}) {
  const chain = chainFromRule(data);
  return {
    sourceModel: data.sourceModel || "",
    targetModels: chain.length > 0 ? chain : [""],
    triggerType: data.triggerType || "status",
    conditionVal: data.conditionVal ?? data.triggerOnStatus ?? DEFAULT_STATUSES,
    conditionOp: data.conditionOp || "in",
    cooldownSkip: data.cooldownSkip ? 1 : 0,
    priority: data.priority ?? 100,
    maxRetries: data.maxRetries ?? 1,
    isActive: data.isActive !== false,
  };
}

export default function FallbackRulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [testState, setTestState] = useState(null); // { rule, status, inputTokens, contextLimit, result, targets }
  const notify = useNotificationStore((s) => s.notify);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/fallback-rules");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load fallback rules");
      }
      setRules(await res.json());
    } catch (err) {
      notify({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const openCreate = () => {
    setEditingRule(null);
    setFormData(normalizeFormData());
    setShowFormModal(true);
  };

  const openEdit = (rule) => {
    setEditingRule(rule);
    setFormData(normalizeFormData(rule));
    setShowFormModal(true);
  };

  const updateChainModel = (index, value) => {
    const next = [...formData.targetModels];
    next[index] = value;
    setFormData({ ...formData, targetModels: next });
  };

  const addChainStep = () => {
    setFormData({ ...formData, targetModels: [...formData.targetModels, ""] });
  };

  const removeChainStep = (index) => {
    const next = formData.targetModels.filter((_, i) => i !== index);
    setFormData({ ...formData, targetModels: next.length ? next : [""] });
  };

  const saveRule = async () => {
    const chain = formData.targetModels.map((t) => t.trim()).filter(Boolean);
    if (!formData.sourceModel.trim() || chain.length === 0) {
      notify({ type: "error", message: "Source model and at least one target are required" });
      return;
    }

    setSaving(true);
    try {
      const url = editingRule ? `/api/fallback-rules/${editingRule.id}` : "/api/fallback-rules";
      const method = editingRule ? "PATCH" : "POST";
      const payload = editingRule
        ? {
            targetModels: chain,
            triggerType: formData.triggerType,
            conditionVal: formData.triggerType === "status" || formData.triggerType === "contextWindow" ? formData.conditionVal : null,
            conditionOp: formData.conditionOp,
            cooldownSkip: formData.cooldownSkip,
            priority: Number(formData.priority) || 0,
            maxRetries: Number(formData.maxRetries) || 0,
            isActive: formData.isActive,
          }
        : {
            sourceModel: formData.sourceModel,
            targetModels: chain,
            triggerType: formData.triggerType,
            conditionVal: formData.triggerType === "status" || formData.triggerType === "contextWindow" ? formData.conditionVal : null,
            conditionOp: formData.conditionOp,
            cooldownSkip: formData.cooldownSkip,
            priority: Number(formData.priority) || 0,
            maxRetries: Number(formData.maxRetries) || 0,
          };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save rule");
      }
      notify({ type: "success", message: editingRule ? "Rule updated" : "Rule created" });
      setShowFormModal(false);
      setLoading(true);
      await fetchData();
    } catch (err) {
      notify({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule) => {
    try {
      const res = await fetch(`/api/fallback-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle rule");
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    } catch (err) {
      notify({ type: "error", message: err.message });
    }
  };

  const deleteRule = async (rule) => {
    setConfirmState({
      title: "Delete fallback rule",
      message: `Delete rule "${rule.sourceModel} → ${chainFromRule(rule).join(" → ")}"?`,
      action: async () => {
        try {
          const res = await fetch(`/api/fallback-rules/${rule.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Failed to delete rule");
          notify({ type: "success", message: "Rule deleted" });
          await fetchData();
        } catch (err) {
          notify({ type: "error", message: err.message });
        }
      },
    });
  };

  const openTest = (rule) => {
    setTestState({
      rule,
      status: "429",
      inputTokens: "80000",
      contextLimit: "200000",
      result: null,
      targets: chainFromRule(rule),
    });
  };

  // Pure client-side dry-run mirroring the server matcher (fallbackRuleMatcher).
  const runTest = () => {
    const t = testState;
    if (!t) return;
    const rule = t.rule;
    const status = Number(t.status) || 0;
    const inputTokens = Number(t.inputTokens) || 0;
    const contextLimit = Number(t.contextLimit) || 0;
    const type = rule.triggerType || "status";
    let fires = false;

    if (type === "status") {
      const csv = rule.conditionVal ?? rule.triggerOnStatus ?? "429,503";
      fires = String(csv).split(",").map((s) => s.trim()).includes(String(status));
    } else if (type === "anyError") {
      fires = status > 0;
    } else if (type === "contextWindow") {
      if (contextLimit > 0) {
        const ratio = inputTokens / contextLimit;
        const threshold = parseFloat(rule.conditionVal) || 1;
        fires = (rule.conditionOp === "lte" ? ratio <= threshold : ratio >= threshold);
      }
    } else if (type === "timeout") {
      fires = status === 504;
    } else if (type === "contentPolicy") {
      fires = (status === 400 || status === 403);
    }

    setTestState({
      ...t,
      result: fires ? "fires" : "no-fire",
      targets: fires ? chainFromRule(rule) : [],
    });
  };

  if (loading) return <CardSkeleton rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Fallback Rules</h1>
          <p className="text-sm text-muted-foreground">
            When a combo model fails — or a request is about to exceed its context window — the configured chain is appended to the fallback rotation. No code edits needed.
          </p>
        </div>
        <Button onClick={openCreate}>Add Rule</Button>
      </div>

      <Card>
        {rules.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No fallback rules yet. Add one to define what happens when a model fails or a request overflows its context window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Source</th>
                <th className="p-3">Chain</th>
                <th className="p-3">Trigger</th>
                <th className="p-3 text-right">Priority</th>
                <th className="p-3">Active</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="p-3 font-mono text-xs">{rule.sourceModel}</td>
                  <td className="p-3 font-mono text-xs">{chainFromRule(rule).join(" → ") || "—"}</td>
                  <td className="p-3 font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        rule.triggerType === "contextWindow" ? "bg-blue-500/10 text-blue-400"
                        : rule.triggerType === "contentPolicy" ? "bg-amber-500/10 text-amber-400"
                        : rule.triggerType === "timeout" ? "bg-purple-500/10 text-purple-400"
                        : rule.triggerType === "anyError" ? "bg-red-500/10 text-red-400"
                        : "bg-emerald-500/10 text-emerald-400"
                      }`}>
                        {rule.triggerType || "status"}
                      </span>
                      {rule.conditionVal ? <span className="text-muted-foreground">{rule.conditionVal}</span> : null}
                    </span>
                  </td>
                  <td className="p-3 text-right">{rule.priority}</td>
                  <td className="p-3">
                    <Toggle checked={rule.isActive === 1 || rule.isActive === true} onChange={() => toggleActive(rule)} />
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => openTest(rule)}>Test</Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteRule(rule)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showFormModal} onClose={() => setShowFormModal(false)} title={editingRule ? "Edit Fallback Rule" : "Add Fallback Rule"}>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Source model</label>
            <Input
              value={formData.sourceModel}
              onChange={(e) => setFormData({ ...formData, sourceModel: e.target.value })}
              placeholder="e.g. combo/flagship or provider/model (glob * allowed)"
              disabled={!!editingRule}
            />
            <p className="text-xs text-muted-foreground">
              The model that failed. Glob patterns are supported (e.g. <code className="font-mono">freebuff/*</code>).
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Trigger type</label>
            <div className="space-y-1">
              {TRIGGER_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, triggerType: t.value })}
                  className={`w-full text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                    formData.triggerType === t.value
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-muted text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {(formData.triggerType === "status" || formData.triggerType === "contextWindow") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {formData.triggerType === "status" ? "Trigger statuses (comma-separated)" : "Context ratio threshold"}
              </label>
              {formData.triggerType === "status" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_PRESETS.map((status) => {
                      const active = String(formData.conditionVal || "").split(",").map((s) => s.trim()).includes(status);
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() => {
                            const list = String(formData.conditionVal || "").split(",").map((s) => s.trim()).filter(Boolean);
                            const next = active ? list.filter((s) => s !== status) : [...list, status];
                            setFormData({ ...formData, conditionVal: next.join(",") || DEFAULT_STATUSES });
                          }}
                          className={`px-2 py-1 rounded-md border text-xs font-mono transition-colors ${
                            active ? "bg-primary/10 border-primary text-primary" : "border-muted text-muted-foreground hover:border-muted-foreground"
                          }`}
                        >
                          {status}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={formData.conditionVal}
                    onChange={(e) => setFormData({ ...formData, conditionVal: e.target.value })}
                    placeholder="429,503"
                  />
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.05"
                    value={formData.conditionVal}
                    onChange={(e) => setFormData({ ...formData, conditionVal: e.target.value })}
                  />
                  <select
                    value={formData.conditionOp}
                    onChange={(e) => setFormData({ ...formData, conditionOp: e.target.value })}
                    className="rounded-md border bg-transparent px-2 py-1 text-xs"
                  >
                    <option value="gte">ratio ≥</option>
                    <option value="lte">ratio ≤</option>
                  </select>
                  <span className="text-xs text-muted-foreground">of the model's context window</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Fallback chain (ordered — first tried first)</label>
            <div className="space-y-2">
              {formData.targetModels.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">{i + 1}.</span>
                  <Input
                    value={m}
                    onChange={(e) => updateChainModel(i, e.target.value)}
                    placeholder={`e.g. provider/fallback-${i + 1}`}
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeChainStep(i)} disabled={formData.targetModels.length <= 1}>✕</Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addChainStep}>+ Add hop</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Priority (lower runs first)</label>
              <Input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max retries</label>
              <Input
                type="number"
                value={formData.maxRetries}
                onChange={(e) => setFormData({ ...formData, maxRetries: e.target.value })}
              />
            </div>
          </div>

          {editingRule && (
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Active</label>
              <Toggle checked={formData.isActive} onChange={(v) => setFormData({ ...formData, isActive: v })} />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowFormModal(false)}>Cancel</Button>
            <Button onClick={saveRule} disabled={saving}>
              {saving ? "Saving..." : editingRule ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!testState} onClose={() => setTestState(null)} title={`Test rule — ${testState?.rule?.sourceModel || ""}`}>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/40 p-3 text-xs font-mono">
            {testState?.rule?.sourceModel} → {(testState?.targets || []).join(" → ") || "—"}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">HTTP status</label>
              <Input value={testState?.status || ""} onChange={(e) => setTestState({ ...testState, status: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Input tokens</label>
              <Input value={testState?.inputTokens || ""} onChange={(e) => setTestState({ ...testState, inputTokens: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Context limit</label>
              <Input value={testState?.contextLimit || ""} onChange={(e) => setTestState({ ...testState, contextLimit: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={runTest}>Run dry-run</Button>
          </div>
          {testState?.result && (
            <div className={`rounded-md p-3 text-xs ${testState.result === "fires" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/40 text-muted-foreground"}`}>
              {testState.result === "fires"
                ? `✓ This rule FIRES — the chain ${(testState.targets || []).join(" → ")} would be appended.`
                : "✕ This rule does NOT fire under those conditions."}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        onConfirm={async () => {
          await confirmState?.action();
          setConfirmState(null);
        }}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
