"use client";

import { useState } from "react";
import { Card, Button, Toggle, Modal, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { saveLabCollection, labPreview } from "../lib/labApi";

/**
 * Injectors tab — uuid-keyed table with enable toggles, a drawer editor with
 * live preview (the SAME pure expansion module the engine uses — preview is
 * truth), and a block-verdict line (applied / skipped:acl-denied /
 * skipped:duplicate) as the operator's ACL debugger.
 */
export default function InjectorsTab({ settings, onChange }) {
  const [editing, setEditing] = useState(null); // injector | "new" | null
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const injectors = settings.userInjectors || [];

  const toggle = async (inj) => {
    try {
      const next = injectors.map((i) => (i.id === inj.id ? { ...i, enabled: !i.enabled } : i));
      await saveLabCollection("userInjectors", next);
      setNotice({ kind: "ok", text: `"${inj.name}" ${inj.enabled ? "disabled" : "enabled"}` });
      onChange();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  };

  const remove = async (inj) => {
    try {
      const next = injectors.filter((i) => i.id !== inj.id);
      await saveLabCollection("userInjectors", next);
      setNotice({ kind: "ok", text: `"${inj.name}" removed` });
      onChange();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  };

  const runPreview = async (draft) => {
    try {
      const res = await labPreview([{ ...draft, enabled: true }]);
      setPreview(res);
      setPreviewError(null);
    } catch (e) {
      setPreviewError(e.message);
      setPreview(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <div className={`text-sm px-3 py-2 rounded-lg border ${notice.kind === "ok" ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-red-600 border-red-200 bg-red-50"}`}>
          {notice.text}
        </div>
      )}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{translate("Prompt Injectors")}</h2>
          <Button onClick={() => { setEditing("new"); setPreview(null); }}>{translate("New injector")}</Button>
        </div>
        {injectors.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">{translate("No injectors yet — create one to layer governed instructions.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {injectors.map((inj) => (
              <div key={inj.id} className="flex items-center gap-3 p-2 rounded-lg border border-border-subtle hover:bg-surface-2 transition-colors">
                <Toggle checked={!!inj.enabled} onChange={() => toggle(inj)} label={inj.name} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{inj.name}</div>
                  <div className="text-xs text-text-muted truncate font-mono">{inj.prompt}</div>
                </div>
                <Badge tone={inj.enabled ? "ok" : "muted"}>{inj.enabled ? "enabled" : "disabled"}</Badge>
                <Badge tone="muted">{inj.position || "append"}</Badge>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(inj); runPreview(inj); }}>{translate("Edit")}</Button>
                <Button variant="danger" size="sm" onClick={() => remove(inj)}>{translate("Delete")}</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing !== null && (
        <EditorModal
          injector={editing === "new" ? null : editing}
          preview={preview}
          previewError={previewError}
          saving={saving}
          onPreview={runPreview}
          onClose={() => { setEditing(null); setPreview(null); setPreviewError(null); }}
          onSave={async (draft) => {
            setSaving(true);
            try {
              const exists = draft.id ? injectors.some((i) => i.id === draft.id) : false;
              const next = exists
                ? injectors.map((i) => (i.id === draft.id ? { ...i, ...draft } : i))
                : [...injectors, { ...draft, id: draft.id || crypto.randomUUID() }];
              await saveLabCollection("userInjectors", next);
              setNotice({ kind: "ok", text: `"${draft.name}" saved` });
              setEditing(null);
              onChange();
            } catch (e) {
              setNotice({ kind: "err", text: e.message });
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Badge({ tone = "muted", children }) {
  const tones = {
    ok: "text-emerald-600 bg-emerald-50 border-emerald-200",
    muted: "text-text-muted bg-surface-2 border-border-subtle",
    warn: "text-amber-600 bg-amber-50 border-amber-200",
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${tones[tone]}`}>{children}</span>;
}

function EditorModal({ injector, preview, previewError, saving, onPreview, onSave, onClose }) {
  const [name, setName] = useState(injector?.name || "");
  const [prompt, setPrompt] = useState(injector?.prompt || "");
  const [position, setPosition] = useState(injector?.position || "append");
  const [applyTo, setApplyTo] = useState(injector?.applyTo || "llm");

  const draft = { ...(injector || {}), name, prompt, position, applyTo };
  const canSave = name.trim() && prompt.trim();

  return (
    <Modal isOpen onClose={onClose} title={injector ? `Edit — ${injector.name}` : "New injector"}>
      <div className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Indonesian-first" />
        <div>
          <label className="text-xs font-medium text-text-muted">Prompt</label>
          <textarea
            className="w-full mt-1 p-2 rounded-lg border border-border-subtle bg-surface-2 font-mono text-sm min-h-[96px]"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Always respond in Indonesian. Model: {{model}}"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <label className="text-xs font-medium text-text-muted">Position</label>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={position === "append"} onChange={() => setPosition("append")} /> append
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={position === "prepend"} onChange={() => setPosition("prepend")} /> prepend
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-text-muted">Apply to</label>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={applyTo !== "*"} onChange={() => setApplyTo("llm")} /> chat completions only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={applyTo === "*"} onChange={() => setApplyTo("*")} /> all service kinds
              </label>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onPreview(draft)} disabled={!prompt.trim()}>
          Preview
        </Button>
        {previewError && <p className="text-xs text-red-600">{previewError}</p>}
        {preview && (
          <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap max-h-40 overflow-auto">
            {preview.rendered?.map((r, i) => (
              <div key={i} className="mb-2">
                <span className="text-primary">{r.name}</span> <span className="text-text-muted">({r.position})</span>
                <div className="mt-0.5">{r.text}</div>
              </div>
            ))}
            {preview.denials?.map((d, i) => (
              <div key={`d${i}`} className="text-amber-600">skipped:{d.reason} — {d.name}</div>
            ))}
            <div className="text-text-muted mt-1">applied distinct: {preview.appliedDistinct}</div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={onClose}>{translate("Cancel")}</Button>
          <Button disabled={!canSave || saving} onClick={() => onSave(draft)}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
