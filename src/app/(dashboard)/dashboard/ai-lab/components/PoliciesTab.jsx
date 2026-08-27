"use client";

import { useState } from "react";
import { Card, Button, Modal, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { saveLabCollection } from "../lib/labApi";

/**
 * Policies tab — content-policy profile CRUD (S4). Each profile: action
 * (flag|redact|block), an enable toggle, and a pattern list with a
 * test-string sandbox that highlights matches. The engine-side ReDoS guard
 * (contentPolicy.validatePattern) mirrors this UI: patterns that would hang
 * the gateway are flagged at edit time.
 */
export default function PoliciesTab({ settings, onChange }) {
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const policies = settings.contentPolicies || [];

  const savePolicies = async (next) => {
    try {
      await saveLabCollection("contentPolicies", next);
      setNotice({ kind: "ok", text: "policies saved" });
      onChange();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
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
          <h2 className="font-semibold">{translate("Content Policies")}</h2>
          <Button onClick={() => setEditing("new")}>{translate("New policy")}</Button>
        </div>
        {policies.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">{translate("No policies yet — flag, redact, or block response text on the assistant lane.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border border-border-subtle hover:bg-surface-2 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-text-muted truncate font-mono">{p.patterns?.join(" · ") || "—"}</div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                  p.action === "block" ? "text-red-600 bg-red-50 border-red-200"
                  : p.action === "redact" ? "text-amber-600 bg-amber-50 border-amber-200"
                  : "text-sky-600 bg-sky-50 border-sky-200"
                }`}>{p.action}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${p.enabled === false ? "text-text-muted bg-surface-2" : "text-emerald-600 bg-emerald-50 border-emerald-200"}`}>
                  {p.enabled === false ? "disabled" : "active"}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>{translate("Edit")}</Button>
                <Button variant="ghost" size="sm" onClick={() => savePolicies(policies.filter((x) => x.id !== p.id))}>{translate("Delete")}</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing !== null && (
        <PolicyEditorModal
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            const exists = draft.id ? policies.some((p) => p.id === draft.id) : false;
            const next = exists ? policies.map((p) => (p.id === draft.id ? { ...p, ...draft } : p)) : [...policies, { ...draft, id: draft.id || crypto.randomUUID() }];
            await savePolicies(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PolicyEditorModal({ policy, onClose, onSave }) {
  const [name, setName] = useState(policy?.name || "");
  const [action, setAction] = useState(policy?.action || "flag");
  const [patterns, setPatterns] = useState((policy?.patterns || []).join("\n"));
  const [testStr, setTestStr] = useState("");
  const [sandbox, setSandbox] = useState(null);

  const patternList = patterns.split("\n").map((s) => s.trim()).filter(Boolean);

  const runSandbox = () => {
    let hits = [];
    let flagged = [];
    for (const p of patternList) {
      if (p.length > 256 || /\([^)]*(?:[+*]|\|[^)]*)+\)\s*[+*{]/.test(p) || /\(\s*[^)]*\|\s*[^)]*\|\s*[^)]*\)\s*[+*]/.test(p)) {
        flagged.push(p);
        continue;
      }
      try {
        if (new RegExp(p, "i").test(testStr)) hits.push(p);
      } catch { flagged.push(p); }
    }
    setSandbox({ hits, flagged });
  };

  return (
    <Modal isOpen onClose={onClose} title={policy ? `Edit — ${policy.name}` : "New policy"}>
      <div className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. No explicit text" />
        <div>
          <label className="text-xs font-medium text-text-muted">Action</label>
          <div className="flex gap-3 mt-1">
            {["flag", "redact", "block"].map((a) => (
              <label key={a} className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={action === a} onChange={() => setAction(a)} /> {a}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-1">block is the declared fail-open exception — a positive match closes, a detector crash opens.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-text-muted">Patterns (one per line)</label>
          <textarea className="w-full mt-1 p-2 rounded-lg border border-border-subtle bg-surface-2 font-mono text-sm min-h-[72px]" value={patterns} onChange={(e) => setPatterns(e.target.value)} placeholder={"violent content\nexplicit text"} />
        </div>
        <div>
          <label className="text-xs font-medium text-text-muted">Test string sandbox</label>
          <div className="flex gap-2 mt-1">
            <input className="flex-1 p-2 rounded-lg border border-border-subtle bg-surface-2 text-sm" value={testStr} onChange={(e) => setTestStr(e.target.value)} placeholder="type text to test patterns against…" />
            <Button variant="ghost" size="sm" onClick={runSandbox}>Test</Button>
          </div>
          {sandbox && (
            <div className="text-xs mt-1">
              {sandbox.hits.length > 0 && <div className="text-red-600">matches: {sandbox.hits.join(", ")}</div>}
              {sandbox.flagged.length > 0 && <div className="text-amber-600">rejected (ReDoS guard): {sandbox.flagged.join(", ")}</div>}
              {sandbox.hits.length === 0 && sandbox.flagged.length === 0 && <div className="text-text-muted">no matches</div>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={onClose}>{translate("Cancel")}</Button>
          <Button disabled={!name.trim() || patternList.length === 0} onClick={() => onSave({ ...(policy || {}), name, action, patterns: patternList })}>{translate("Save")}</Button>
        </div>
      </div>
    </Modal>
  );
}
