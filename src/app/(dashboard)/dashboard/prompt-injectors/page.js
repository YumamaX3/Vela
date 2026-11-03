"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ConfirmModal, Toggle } from "@/shared/components";
import PageShell from "@/shared/components/layouts/PageShell";
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
const SCRIPT_KIND = "script";
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 8000;
const EMPTY_TURN = { role: "user", content: "" };
const isScript = (inj) => inj?.kind === SCRIPT_KIND;
function turnPreview(inj) {
  const turns = Array.isArray(inj?.turns) ? inj.turns : [];
  if (!turns.length) return "(empty script)";
  return turns.map((t) => `${t.role === "assistant" ? "assistant" : "user"}: ${t.content}`).join(" · ");
}

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
  const [templates, setTemplates] = useState([]);
  const [templatePick, setTemplatePick] = useState("");
  const [tplForm, setTplForm] = useState(null);
  const [abPrompt, setAbPrompt] = useState("");
  const [abMessage, setAbMessage] = useState("");
  const [abModel, setAbModel] = useState("");
  const [abRunning, setAbRunning] = useState(false);
  const [abResult, setAbResult] = useState(null);
  const [models, setModels] = useState([]);
  // addNotification, not notify — the store exposes no `notify` key, so the old
  // selector returned undefined and every notify({...}) call threw TypeError.
  // All 15 call sites already pass addNotification's exact { type, message } shape.
  const notify = useNotificationStore((s) => s.addNotification);

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

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/prompt-templates", { cache: "no-store" });
      const data = await res.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      notify({ type: "error", message: err.message });
    }
  }, [notify]);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      const data = await res.json();
      setModels(Array.isArray(data?.data) ? data.data.map((m) => m.id || m.name).filter(Boolean) : []);
    } catch { /* the model field stays free-text */ }
  }, []);

  useEffect(() => {
    load();
    loadTemplates();
    loadModels();
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
    setTemplatePick("");
    setFormData(EMPTY_FORM);
    setShowFormModal(true);
  };

  const openEdit = (index) => {
    setEditingIndex(index);
    setFormData({
      ...EMPTY_FORM,
      ...injectors[index],
      variables: injectors[index].variables || {},
      turns: Array.isArray(injectors[index].turns) ? injectors[index].turns : [],
    });
    setShowFormModal(true);
  };

  const save = async () => {
    const script = isScript(formData);
    const turns = (formData.turns || []).filter((t) => t.content && t.content.trim());
    if (!formData.name.trim()) {
      notify({ type: "error", message: "Name is required" });
      return;
    }
    if (script && turns.length === 0) {
      notify({ type: "error", message: "A script needs at least one turn with content" });
      return;
    }
    if (!script && !formData.prompt.trim()) {
      notify({ type: "error", message: "Prompt is required" });
      return;
    }
    setSaving(true);
    try {
      const next = [...injectors];
      const cleaned = script
        ? {
            name: formData.name.trim(),
            kind: SCRIPT_KIND,
            turns: turns.map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.content })),
            applyTo: formData.applyTo,
            enabled: formData.enabled,
            variables: formData.variables || {},
          }
        : { ...formData, name: formData.name.trim(), kind: "system", variables: formData.variables || {}, turns: undefined };
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

  const saveTemplate = async () => {
    if (!tplForm) return;
    const editing = !!tplForm.id;
    try {
      const res = await fetch(editing ? `/api/prompt-templates?id=${encodeURIComponent(tplForm.id)}` : "/api/prompt-templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tplForm.name, prompt: tplForm.prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save template");
      setTplForm(null);
      await loadTemplates();
      notify({ type: "success", message: editing ? "Template updated" : "Template saved" });
    } catch (err) {
      notify({ type: "error", message: err.message });
    }
  };

  const removeTemplate = (tpl) => {
    setConfirmState({
      title: "Delete template",
      message: `Delete template "${tpl.name}"?`,
      action: async () => {
        try {
          const res = await fetch(`/api/prompt-templates?id=${encodeURIComponent(tpl.id)}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete template");
          if (templatePick === tpl.id) setTemplatePick("");
          await loadTemplates();
          notify({ type: "success", message: "Template deleted" });
        } catch (err) {
          notify({ type: "error", message: err.message });
        }
      },
    });
  };

  const runAb = async () => {
    if (!abModel.trim() || !abMessage.trim()) {
      notify({ type: "error", message: "Pick a model and a sample user message" });
      return;
    }
    setAbRunning(true);
    setAbResult(null);
    try {
      const res = await fetch("/api/prompt-injectors/ab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: abModel.trim(), prompt: abPrompt, message: abMessage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "A/B test failed");
      setAbResult(data);
    } catch (err) {
      notify({ type: "error", message: err.message });
    } finally {
      setAbRunning(false);
    }
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
    <PageShell
      title="Prompt Injectors"
      // The subtitle is a plain string ATTRIBUTE, not a JSX text child, and that
      // is the fix rather than a style choice: as text, `{{model}}` parsed as an
      // expression container holding the object shorthand and threw
      // ReferenceError on every render, so this page could not paint at all. An
      // attribute value is a string, so those braces are literal and the hazard
      // is gone. The em dash the old comment deferred to "the redesign tide" is
      // settled here, in that tide, as a comma.
      subtitle="Operator-defined prompts injected into the system message of every matching chat request, with live variables ({{model}}, {{date}}…) and per-request overrides."
      icon="auto_awesome"
      bodyClassName="space-y-4"
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowPresets(true)}>Presets</Button>
          <Button onClick={openCreate}>Add Injector</Button>
        </div>
      }
    >

      <Card>
        {injectors.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-muted">
            No prompt injectors yet. Add one to layer a custom instruction into every chat completion — or start from a preset.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {injectors.map((inj, index) => (
              <div key={index} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-text-muted font-mono">#{index + 1}</span>
                    <p className="text-sm font-medium">{inj.name}</p>
                    {isScript(inj) ? (
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-3xs uppercase tracking-wide text-amber-500">script</span>
                    ) : (
                      <span className="rounded-md border px-1.5 py-0.5 text-3xs uppercase tracking-wide text-text-muted">{inj.position}</span>
                    )}
                    <span className="rounded-md border px-1.5 py-0.5 text-3xs uppercase tracking-wide text-text-muted">{inj.applyTo}</span>
                    {Object.keys(inj.variables || {}).length > 0 && (
                      <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-3xs text-blue-400">vars</span>
                    )}
                    {!inj.enabled && <span className="text-xs text-text-muted">(disabled)</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{isScript(inj) ? turnPreview(inj) : inj.prompt}</p>
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

      <Modal isOpen={showFormModal} onClose={() => setShowFormModal(false)} title={editingIndex === null ? "Add Injector" : "Edit Injector"}>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Kind</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "system", label: "System prompt", hint: "One instruction in the system message" },
                { value: SCRIPT_KIND, label: "Chat script", hint: "Example turns inserted as history" },
              ].map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, kind: k.value })}
                  className={`rounded-md border p-3 text-left motion-control ${formData.kind === k.value ? "border-primary" : "border-border hover:border-primary/60"}`}
                >
                  <span className="block text-sm font-medium">{k.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{k.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Name</label>
            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Always respond in Indonesian" />
          </div>
          {isScript(formData) ? (
            <div className="space-y-2">
              <label className="text-xs text-text-muted">Turns (inserted in order, before the conversation)</label>
              <div className="space-y-2">
                {(formData.turns || []).map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <select
                      value={t.role}
                      onChange={(e) => {
                        const next = [...(formData.turns || [])];
                        next[i] = { ...next[i], role: e.target.value };
                        setFormData({ ...formData, turns: next });
                      }}
                      className="w-28 shrink-0 rounded-md border bg-transparent px-2 py-2 text-xs outline-none"
                    >
                      <option value="user">user</option>
                      <option value="assistant">assistant</option>
                    </select>
                    <textarea
                      value={t.content}
                      maxLength={MAX_TURN_CHARS}
                      onChange={(e) => {
                        const next = [...(formData.turns || [])];
                        next[i] = { ...next[i], content: e.target.value };
                        setFormData({ ...formData, turns: next });
                      }}
                      rows={2}
                      className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder={t.role === "assistant" ? "How the model should answer…" : "What a user might say…"}
                    />
                    <Button variant="ghost" size="sm" className="shrink-0 text-red-500" onClick={() => setFormData({ ...formData, turns: (formData.turns || []).filter((_, j) => j !== i) })}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" disabled={(formData.turns || []).length >= MAX_TURNS} onClick={() => setFormData({ ...formData, turns: [...(formData.turns || []), { ...EMPTY_TURN }] })}>
                + Add turn
              </Button>
            </div>
          ) : (
          <>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">From template</label>
            <select
              value={templatePick}
              onChange={(e) => {
                const id = e.target.value;
                setTemplatePick(id);
                const t = templates.find((x) => x.id === id);
                if (!t) return;
                setFormData((f) => ({ ...f, prompt: t.prompt }));
              }}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
            >
              <option value="">— choose a saved template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-xs text-text-muted">Copying a template does not save an injector — press {editingIndex === null ? "Create" : "Save"} to keep it.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Prompt</label>
            <textarea
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              rows={5}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="The instruction injected into the system message… ({{date}}, {{model}} and friends expand live)"
            />
            <p className="text-xs text-text-muted">
              Variables:{" "}
              {BUILTIN_VARS.map((v) => (
                <code key={v.name} title={v.desc} className="mr-1 cursor-help rounded bg-surface-2 px-1 py-0.5 font-mono text-3xs">
                  {`{{${v.name}}}`}
                </code>
              ))}
            </p>
          </div>
          </>
          )}

          <div className="space-y-1">
            <label className="text-xs text-text-muted">Custom variables (overridable via x-vela-inject-var-&lt;name&gt; headers)</label>
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

          <div className={`grid gap-4 ${isScript(formData) ? "grid-cols-1" : "grid-cols-2"}`}>
            {!isScript(formData) && (
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Position</label>
              <select
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
              >
                <option value="append">Append (after system)</option>
                <option value="prepend">Prepend (before system)</option>
              </select>
            </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Applies to</label>
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
            <label className="text-xs text-text-muted">Preview</label>
            <div className="rounded-md bg-surface-2/40 p-3 text-xs whitespace-pre-wrap">
              {isScript(formData)
                ? (formData.turns || []).filter((t) => t.content.trim()).map((t, i) => (
                    <span key={i} className="block">
                      <strong>{t.role}:</strong> {previewPrompt(t.content, formData.variables)}
                    </span>
                  ))
                : previewPrompt(formData.prompt, formData.variables)}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-text-muted">Enabled</label>
            <Toggle checked={formData.enabled !== false} onChange={(v) => setFormData({ ...formData, enabled: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowFormModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editingIndex === null ? "Create" : "Save"}</Button>
          </div>
        </div>
      </Modal>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-medium">Template library</p>
            <p className="text-xs text-text-muted">Reusable prompt text. Copied into an injector on request — never executed here.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTplForm({ id: null, name: "", prompt: "" })}>Save as template</Button>
        </div>
        {templates.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">No templates yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{t.name}</p>
                  <p className="line-clamp-1 text-xs text-text-muted">{t.prompt}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setTplForm({ id: t.id, name: t.name, prompt: t.prompt })}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => removeTemplate(t)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={!!tplForm} onClose={() => setTplForm(null)} title={tplForm?.id ? "Edit template" : "Save as template"}>
        {tplForm && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Name</label>
              <Input value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="e.g. Terse code reviewer" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Prompt</label>
              <textarea
                value={tplForm.prompt}
                onChange={(e) => setTplForm({ ...tplForm, prompt: e.target.value })}
                rows={6}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTplForm(null)}>Cancel</Button>
              <Button onClick={saveTemplate}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <Card>
        <div className="mb-2">
          <p className="text-sm font-medium">A/B tester</p>
          <p className="text-xs text-text-muted">Two real turns through the gateway — one bare, one with the prompt applied. Nothing is saved; each verdict is a pure phrase match.</p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Model</label>
              <Input list="ab-model-list" value={abModel} onChange={(e) => setAbModel(e.target.value)} placeholder="provider/model — type or pick" />
              <datalist id="ab-model-list">
                {models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Prompt to try (optional)</label>
              <Input value={abPrompt} onChange={(e) => setAbPrompt(e.target.value)} placeholder="System prompt — empty compares bare vs bare" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Sample user message</label>
            <textarea
              value={abMessage}
              onChange={(e) => setAbMessage(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="The one message both sides will answer…"
            />
          </div>
          <Button onClick={runAb} disabled={abRunning}>{abRunning ? "Running…" : "Run A/B"}</Button>
          {abResult && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[["Bare", abResult.bare], ["With prompt", abResult.applied]].map(([label, side]) => (
                <div key={label} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium">{label}</p>
                    {side?.skipped ? (
                      <span className="text-3xs text-text-muted">skipped — no prompt</span>
                    ) : (
                      <span className={`rounded-md border px-1.5 py-0.5 text-3xs ${side?.verdict?.refused ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-green-500/30 bg-green-500/10 text-green-500"}`}>
                        {side?.verdict?.refused ? `Refused — "${side.verdict.phrase}"` : "Answered"}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-xs">{side?.content || (side?.skipped ? "—" : "")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Modal isOpen={showPresets} onClose={() => setShowPresets(false)} title="Injector presets">
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="w-full text-left rounded-md border border-border p-3 hover:border-primary motion-control"
            >
              <span className="text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-text-muted mt-0.5">{p.prompt.slice(0, 80)}{p.prompt.length > 80 ? "…" : ""}</span>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        onConfirm={async () => {
          await confirmState?.action();
          setConfirmState(null);
        }}
        onClose={() => setConfirmState(null)}
      />
    </PageShell>
  );
}
