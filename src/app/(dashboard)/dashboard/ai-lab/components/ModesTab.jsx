"use client";

import { useState } from "react";
import { Card, Button, Toggle, Modal, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { saveLabCollection } from "../lib/labApi";

/**
 * Modes tab — named mode bundles (S1). Each bundle is an ordered list of
 * injector refs (+ optional modelGlob chips), sparse saver toggles, and a
 * content-policy profile. "Set as default" flattens the mode into the key's
 * default via one PATCH (the Activate semantic, adapted). Resolution is
 * read-only at dispatch: x-vela-mode header → key defaultMode → none.
 */
export default function ModesTab({ settings, onChange }) {
  const [editing, setEditing] = useState(null); // mode | "new" | null
  const [notice, setNotice] = useState(null);

  const modes = settings.modeBundles || [];
  const injectors = settings.userInjectors || [];
  const policies = settings.contentPolicies || [];

  const saveModes = async (next) => {
    try {
      await saveLabCollection("modeBundles", next);
      setNotice({ kind: "ok", text: "modes saved" });
      onChange();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  };

  const toggle = async (m) => {
    await saveModes(modes.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)));
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
          <h2 className="font-semibold">{translate("Mode Bundles")}</h2>
          <Button onClick={() => setEditing("new")}>{translate("New mode")}</Button>
        </div>
        {modes.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">{translate("No modes yet — compose one to bundle injectors under a name clients can select.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {modes.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg border border-border-subtle hover:bg-surface-2 transition-colors">
                <Toggle checked={!!m.enabled} onChange={() => toggle(m)} label={m.name} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{m.name}</div>
                  <div className="text-xs text-text-muted">
                    {m.injectorRefs?.length || 0} injector refs
                    {m.contentPolicyProfileId ? " · policy bound" : ""}
                    {m.saverToggles?.caveman ? " · caveman" : ""}
                    {m.saverToggles?.ponytail ? " · ponytail" : ""}
                  </div>
                </div>
                <code className="text-[11px] text-text-muted bg-surface-2 px-2 py-1 rounded font-mono">x-vela-mode: {m.name}</code>
                <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>{translate("Edit")}</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => saveModes(modes.filter((x) => x.id !== m.id))}
                >
                  {translate("Delete")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing !== null && (
        <ModeEditorModal
          mode={editing === "new" ? null : editing}
          injectors={injectors}
          policies={policies}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            const exists = draft.id ? modes.some((m) => m.id === draft.id) : false;
            const next = exists ? modes.map((m) => (m.id === draft.id ? { ...m, ...draft } : m)) : [...modes, { ...draft, id: draft.id || crypto.randomUUID() }];
            await saveModes(next);
            setEditing(null);
          }}
          // A defaultMode is PER-KEY state, not a global one — the audit lesson:
          // a global "Set as default" here had no key context and could only
          // claim success. The per-key surface lives in the key editor
          // (Endpoint page → Edit key → AI Lab governance → Default mode),
          // which writes the real defaultMode the gate honors at modeStage.
          onSetDefault={async (mode) => {
            setNotice({ kind: "ok", text: `"${mode.name}" is set as that key's default in the key editor (Endpoint → Edit key → AI Lab governance).` });
          }}
        />
      )}
    </div>
  );
}

function ModeEditorModal({ mode, injectors, policies, onClose, onSave, onSetDefault }) {
  const [name, setName] = useState(mode?.name || "");
  const [refs, setRefs] = useState(mode?.injectorRefs || []);
  const [policyId, setPolicyId] = useState(mode?.contentPolicyProfileId || "");
  // Saver-toggle contract: the mode bundle's saverToggles express an EXACT
  // explicit "off" for a saver (the string "off"), or null (leave the saver's
  // global setting untouched). The checkbox reads that 1:1 — never invert.
  const saverFlaggedOff = (toggleState) => toggleState === "off";

  const [saverCaveman, setSaverCaveman] = useState(saverFlaggedOff(mode?.saverToggles?.caveman));
  const [saverPonytail, setSaverPonytail] = useState(saverFlaggedOff(mode?.saverToggles?.ponytail));

  const toggleRef = (id) => {
    setRefs((prev) => (prev.some((r) => r.id === id) ? prev.filter((r) => r.id !== id) : [...prev, { id, modelGlob: null }]));
  };

  const draft = {
    ...(mode || {}),
    name,
    injectorRefs: refs,
    contentPolicyProfileId: policyId || null,
    saverToggles: {
      caveman: saverCaveman ? "off" : null,
      ponytail: saverPonytail ? "off" : null,
    },
    // saverToggles above uses the SAME contract as saverFlaggedOff: an
    // explicit "off" string means "disable this saver in this mode"; null
    // defers to the global setting. The checkbox is the 1:1 image of it.
  };

  return (
    <Modal isOpen onClose={onClose} title={mode ? `Edit — ${mode.name}` : "New mode"}>
      <div className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. json-only" />
        <div>
          <label className="text-xs font-medium text-text-muted">Injector refs</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {injectors.map((i) => (
              <button
                key={i.id}
                onClick={() => toggleRef(i.id)}
                className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                  refs.some((r) => r.id === i.id)
                    ? "bg-primary text-white border-primary"
                    : "bg-surface-2 border-border-subtle text-text-muted hover:text-text-main"
                }`}
              >
                {i.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-text-muted">Content policy profile</label>
          <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} className="w-full mt-1 p-2 rounded-lg border border-border-subtle bg-surface-2 text-sm">
            <option value="">— none —</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.action})</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saverCaveman} onChange={(e) => setSaverCaveman(e.target.checked)} /> disable caveman</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saverPonytail} onChange={(e) => setSaverPonytail(e.target.checked)} /> disable ponytail</label>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="ghost" onClick={() => onSetDefault(draft)} disabled={!name.trim()}>{translate("How per-key defaults work")}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{translate("Cancel")}</Button>
            <Button disabled={!name.trim()} onClick={() => onSave(draft)}>{translate("Save")}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
