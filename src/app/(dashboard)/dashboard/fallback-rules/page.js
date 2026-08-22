"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ConfirmModal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const DEFAULT_STATUSES = "429,503";
const STATUS_PRESETS = ["429", "403", "500", "502", "503", "504"];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function normalizeFormData(data = {}) {
  return {
    sourceModel: data.sourceModel || "",
    targetModel: data.targetModel || "",
    triggerOnStatus: data.triggerOnStatus || DEFAULT_STATUSES,
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

  const saveRule = async () => {
    if (!formData.sourceModel.trim() || !formData.targetModel.trim()) {
      notify({ type: "error", message: "Source and target model are required" });
      return;
    }

    setSaving(true);
    try {
      const url = editingRule ? `/api/fallback-rules/${editingRule.id}` : "/api/fallback-rules";
      const method = editingRule ? "PATCH" : "POST";
      const payload = editingRule
        ? {
            targetModel: formData.targetModel,
            triggerOnStatus: formData.triggerOnStatus,
            priority: Number(formData.priority) || 0,
            maxRetries: Number(formData.maxRetries) || 0,
            isActive: formData.isActive,
          }
        : {
            sourceModel: formData.sourceModel,
            targetModel: formData.targetModel,
            triggerOnStatus: formData.triggerOnStatus,
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
    setConfirmState({ title: "Delete fallback rule", message: `Delete rule "${rule.sourceModel} → ${rule.targetModel}"?`, action: async () => {
      try {
        const res = await fetch(`/api/fallback-rules/${rule.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete rule");
        notify({ type: "success", message: "Rule deleted" });
        await fetchData();
      } catch (err) {
        notify({ type: "error", message: err.message });
      }
    }});
  };

  if (loading) return <CardSkeleton rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Fallback Rules</h1>
          <p className="text-sm text-muted-foreground">
            When a combo model fails with a trigger status, the configured target model is appended to the fallback chain — no code edits needed.
          </p>
        </div>
        <Button onClick={openCreate}>Add Rule</Button>
      </div>

      <Card>
        {rules.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No fallback rules yet. Add one to define what happens when a model returns 429 or 503.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Source</th>
                <th className="p-3">Target</th>
                <th className="p-3">Triggers</th>
                <th className="p-3 text-right">Priority</th>
                <th className="p-3 text-right">Retries</th>
                <th className="p-3">Active</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="p-3 font-mono text-xs">{rule.sourceModel}</td>
                  <td className="p-3 font-mono text-xs">{rule.targetModel}</td>
                  <td className="p-3 font-mono text-xs">{rule.triggerOnStatus}</td>
                  <td className="p-3 text-right">{rule.priority}</td>
                  <td className="p-3 text-right">{rule.maxRetries}</td>
                  <td className="p-3">
                    <Toggle checked={rule.isActive === 1 || rule.isActive === true} onChange={() => toggleActive(rule)} />
                  </td>
                  <td className="p-3 text-right space-x-2">
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
            <label className="text-xs text-muted-foreground">Target model</label>
            <Input
              value={formData.targetModel}
              onChange={(e) => setFormData({ ...formData, targetModel: e.target.value })}
              placeholder="e.g. provider/fallback-model"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Trigger statuses</label>
            <div className="flex flex-wrap gap-2">
              {STATUS_PRESETS.map((status) => {
                const active = formData.triggerOnStatus.split(",").map((s) => s.trim()).includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      const list = formData.triggerOnStatus.split(",").map((s) => s.trim()).filter(Boolean);
                      const next = active ? list.filter((s) => s !== status) : [...list, status];
                      setFormData({ ...formData, triggerOnStatus: next.join(",") || DEFAULT_STATUSES });
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
