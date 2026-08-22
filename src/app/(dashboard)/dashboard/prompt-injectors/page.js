"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ConfirmModal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const EMPTY_FORM = {
  name: "",
  prompt: "",
  position: "append",
  applyTo: "llm",
  enabled: true,
};

export default function PromptInjectorsPage() {
  const [injectors, setInjectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [confirmState, setConfirmState] = useState(null);
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
    setFormData({ ...EMPTY_FORM, ...injectors[index] });
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
      if (editingIndex === null) {
        next.push({ ...formData, name: formData.name.trim() });
      } else {
        next[editingIndex] = { ...formData, name: formData.name.trim() };
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

  if (loading) return <CardSkeleton rows={5} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Prompt Injectors</h1>
          <p className="text-sm text-muted-foreground">
            Operator-defined prompts injected into the system message of every matching chat request — before dispatch, after built-in savers.
          </p>
        </div>
        <Button onClick={openCreate}>Add Injector</Button>
      </div>

      <Card>
        {injectors.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No prompt injectors yet. Add one to layer a custom instruction into every chat completion.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {injectors.map((inj, index) => (
              <div key={inj.name} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{inj.name}</p>
                    <span className="rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {inj.position}
                    </span>
                    <span className="rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {inj.applyTo}
                    </span>
                    {!inj.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{inj.prompt}</p>
                </div>
                <div className="flex items-center gap-2">
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
              placeholder="The instruction injected into the system message…"
            />
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
