"use client";

import { useState, useMemo } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * MintWizard — the template-driven create flow (W3a). Pick a saved key preset
 * (the W2 templates route), preview its normalized shape via applyShape, and
 * mint through the single mintKey chokepoint. The 201 show-once reveal is
 * handed back up to the orchestrator (vault capture stays in useKeys).
 *
 * Fail-open: no templates / fetch error → the wizard still shows the "Blank"
 * fallback (a plain empty create), so the flow never dead-ends.
 */
export default function MintWizard({
  open,
  onClose,
  templates = [],
  templatesLoading,
  onMint,
  categories = [],
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId]
  );

  if (!open) return null;

  const presetOptions = [{ id: null, name: translate("Blank (no preset)"), description: translate("Start empty") }, ...templates];

  const handleMint = async () => {
    setError("");
    const res = await onMint({
      template: selected,
      name: name.trim() || selected?.name || "Minted Key",
      category: category.trim() || null,
    });
    if (res && res.error) setError(res.error);
  };

  const previewAcl = selected?.acl || {};
  const previewLimits = selected?.limits || {};
  const aclCount =
    Object.values(previewAcl).filter((v) => Array.isArray(v) && v.length).length;
  const limitCount = Object.values(previewLimits).filter((v) => v != null && v !== "").length;

  return (
    <Modal isOpen={open} title={translate("Mint from Template")} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Template picker */}
        <div>
          <p className="text-sm font-medium mb-2">{translate("Choose a preset")}</p>
          {templatesLoading ? (
            <p className="text-xs text-text-muted inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {translate("Loading templates…")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto custom-scrollbar">
              {presetOptions.map((t) => {
                const isActive = selectedId === t.id;
                return (
                  <button
                    key={t.id || "blank"}
                    onClick={() => setSelectedId(t.id)}
                    className={`flex items-start gap-2.5 text-left px-3 py-2.5 rounded-[10px] border transition-all ${
                      isActive
                        ? "bg-primary/10 border-primary/40"
                        : "bg-surface-2 border-border-subtle hover:border-primary/30"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${isActive ? "text-primary" : "text-text-muted"}`}>
                      {t.builtIn ? "auto_awesome" : "description"}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text-main truncate">{t.name}</span>
                      {t.description && <span className="block text-[11px] text-text-muted truncate">{t.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Shape preview */}
        {selected && (
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3 flex flex-col gap-1.5">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{translate("Preset applies")}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted border border-border-subtle">
                {translate("ACL fields")}: {aclCount}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted border border-border-subtle">
                {translate("Limit fields")}: {limitCount}
              </span>
              {selected.categoryDefault && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted border border-border-subtle">
                  {translate("Category")}: {selected.categoryDefault}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Name + category override */}
        <Input
          label={translate("Key Name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={selected?.name || translate("Minted Key")}
        />
        <Input
          label={translate("Category (optional)")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={translate("e.g. friend, hermes, others")}
          list="key-category-options"
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleMint} fullWidth disabled={templatesLoading}>
            {translate("Mint Key")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {translate("Cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}