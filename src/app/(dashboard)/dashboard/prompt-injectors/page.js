"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ConfirmModal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const BUILTIN_VARS = [
  { name: "model", desc: "The upstream model id" },
  { name: "kind", desc: "Service kind (llm)" },
  { name: "date", desc: "Today's date (YYYY-MM-DD)" },
  { name: "time", desc: "Current time (HH:MM:SS)" },
  { name: "keyPrefix", desc: "First 7 chars of the API key" },
  { name: "requestId", desc: "The request connection id" },
  { name: "userAgent", desc: "Client user-agent string" },
];

const PRESETS = [
  {
    name: "Indonesian-first",
    position: "prepend",
    applyTo: "llm",
    prompt: "Always respond in Indonesian (Bahasa Indonesia) unless the user writes in another language.",
  },
  {
    name: "JSON-only output",
    position: "append",
    applyTo: "llm",
    prompt: "Respond with valid JSON only — no markdown fences, no commentary outside the JSON.",
  },
  {
    name: "Code-quality guard",
    position: "append",
    applyTo: "llm",
    prompt: "Prefer clean, readable, idiomatic code with brief comments. Point out edge cases.",
  },
  {
    name: "Date-aware context",
    position: "append",
    applyTo: "llm",
    prompt: "Today is {{date}} ({{time}}). Use this when answering time-sensitive questions.",
  },
];

const EMPTY_FORM = {
  name: "",
  prompt: "",
  position: "append",
  applyTo: "llm",
  enabled: true,
  variables: {},
};

function previewPrompt(prompt, variables = {}) {
  let out = String(prompt || "");
  for (const [k, v] of Object.entries(variables)) {
    if (v !== undefined && v !== null) out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), String(v));
  }
  // Leftover built-ins render as themselves (they expand at dispatch).
  return out;
}

export default function PromptInjectorsPage() {
  const [injectors, setInjectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [confirmState, setConfirmState] = useState(null);
  const [showPresets, setShowPresets] = useState(false);
  const notify = useNotificationStore((s) => s.notify);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json();
      setInjectors(Array.isArray(data.userInjectors) ? data.userInjectors : []);
    } catch (err) {
      notify({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInjectors: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to save injectors");
    }
  };

  const openCreate = () => {
    setEditingIndex(null);
    setFormData(EMPTY_FORM);
    setShowFormModal(true);
  };

  const openEdit = (index) => {
    setEditingIndex(index);
    setFormData({ ...EMPTY_FORM, ...injectors[index], variables: injectors[index].variables || {} });
    setShowFormModal(true);
  };

  const save = async () => {
    if (!formData.name.trim() || !formData.prompt.trim()) {
      notify({ type: "error", message: "Name and prompt are required" });
      return;
    }
    setSaving(true);
    try {
      const next = [...injectors];
      const cleaned = { ...formData, name: formData.name.trim(), variables: formData.variables || {} };
      if (editingIndex === null) {
        next.push(cleaned);
      } else {
        next[editingIndex] = cleaned;
      }
      await persist(next);
      setInjectors(next);
      notify({ type: "success", message: editingIndex === null ? "Injector created" : "Injector updated" });
      setShowFormModal(false);
    } catch (err) {
      notify({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (index) => {
    const next = injectors.map((inj, i) => (i === index ? { ...inj, enabled: !inj.enabled } : inj));
    try {
      await persist(next);
      setInjectors(next);
    } catch (err) {
      notify({ type: "error", message: err.message });
    }
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= injectors.length) return;
    const next = [...injectors];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await persist(next);
      setInjectors(next);
    } catch (err) {
      notify({ type: "error", message: err.message });
    }
  };

  const remove = async (index) => {
    const inj = injectors[index];
    setConfirmState({
      title: "Delete injector",
      message: `Delete injector "${inj.name}"?`,
      action: async () => {
        const next = injectors.filter((_, i) => i !== index);
        try {
          await persist(next);
          setInjectors(next);
          notify({ type: "success", message: "Injector deleted" });
        } catch (err) {
          notify({ type: "error", message: err.message });
        }
      },
    });
  };

  const applyPreset = (preset) => {
    setFormData({ ...EMPTY_FORM, ...preset });
    setShowPresets(false);
  };

  const updateVar = (key, value) => {
    const next = { ...(formData.variables || {}) };
    if (value === "") delete next[key];
    else next[key] = value;
    setFormData({ ...formData, variables: next });
  };

  if (loading) return <CardSkeleton rows={5} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Prompt Injectors</h1>
          <p className="text-sm text-muted-foreground">
            Operator-defined prompts injected into the system message of every matching chat request — with live variables ({{model}}, {{date}}…) and per-request overrides.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowPresets(true)}>Presets</Button>
          <Button onClick={openCreate}>Add Injector</Button>
        </div>
      </div>

      <Card>
        {injectors.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No prompt injectors yet. Add one to layer a custom instruction into every chat completion — or start from a preset.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {injectors.map((inj, index) => (
              <div key={index} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
                    <p className="text-sm font-medium">{inj.name}</p>
                    <span className="rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{inj.position}</span>
                    <span className="rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{inj.applyTo}</span>
                    {Object.keys(inj.variables || {}).length > 0 && (
                      <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">vars</span>
                    )}
                    {!inj.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{inj.prompt}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index === 0}>↑</Button>
                  <Button variant="ghost" size="sm" onClick={() => move(index, 1)} disabled={index === injectors.length - 1}>↓</Button>
                  <Toggle checked={inj.enabled !== false} onChange={() => toggleEnabled(index)} title={inj.enabled ? "Disable" : "Enable"} />
                  <Button variant="ghost" size="sm" onClick={() => openEdit(index)}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => remove(index)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showFormModal} onClose={() => setShowFormModal(false)} title={editingIndex === null ? "Add Injector" : "Edit Injector"}>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Always respond in Indonesian" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Prompt</label>
            <textarea
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              rows={5}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="The instruction injected into the system message… ({{date}}, {{model}} and friends expand live)"
            />
            <p className="text-xs text-muted-foreground">
              Variables:{" "}
              {BUILTIN_VARS.map((v) => (
                <code key={v.name} title={v.desc} className="mr-1 cursor-help rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {`{{${v.name}}}`}
                </code>
              ))}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Custom variables (overridable via x-vela-inject-var-&lt;name&gt; headers)</label>
            <div className="space-y-2">
              {Object.entries(formData.variables || {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <Input value={k} onChange={(e) => {
                    const next = { ...(formData.variables || {}) };
                    delete next[k];
                    if (e.target.value.trim()) next[e.target.value.trim()] = v;
                    setFormData({ ...formData, variables: next });
                  }} className="w-40 font-mono text-xs" placeholder="name" />
                  <Input value={v} onChange={(e) => updateVar(k, e.target.value)} className="font-mono text-xs" placeholder="default value" />
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setFormData({ ...formData, variables: { ...(formData.variables || {}), "": "" } })}>
                + Add variable
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Position</label>
              <select
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
              >
                <option value="append">Append (after system)</option>
                <option value="prepend">Prepend (before system)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Applies to</label>
              <select
                value={formData.applyTo}
                onChange={(e) => setFormData({ ...formData, applyTo: e.target.value })}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
              >
                <option value="llm">Chat (llm)</option>
                <option value="*">Everything</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Preview</label>
            <div className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {previewPrompt(formData.prompt, formData.variables)}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Enabled</label>
            <Toggle checked={formData.enabled !== false} onChange={(v) => setFormData({ ...formData, enabled: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowFormModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editingIndex === null ? "Create" : "Save"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showPresets} onClose={() => setShowPresets(false)} title="Injector presets">
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="w-full text-left rounded-md border border-muted p-3 hover:border-primary transition-colors"
            >
              <span className="text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{p.prompt.slice(0, 80)}{p.prompt.length > 80 ? "…" : ""}</span>
            </button>
          ))}
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
