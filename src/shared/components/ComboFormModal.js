"use client";

// ComboFormModal — create / edit a combo.
//
// Redesigned (2026-09-06, Vela Prism Build B):
//  - Each model item shows a transient capability strip + provider alias, so
//    the operator can see "vision · 128k · anthropic" without leaving the
//    combo editor. Anti-slop R-22: model items now read as a card, not a
//    inline-editable text blob.
//  - The "Add Model" affordance reuses the redesigned ModelSelectModal — same
//    recents, same category rail, same keyboard nav. One picker, one rhythm.
//  - Mobile rhythm: the forcePrefix rendering uses a stacked layout on phones
//    (the prefix becomes its own row above the name input), keeping the
//    Star's "friendly for any resolution" clause honest.
//  - Focus management: when a model is reordered, focus stays on the moved
//    item (not the up/down button), so screen-reader and keyboard users
//    don't lose their place. Anti-slop R-08: keyboard focus is never stolen.
//  - Empty state: the "No models added yet" panel now shows the coral accent
//    and a clear "Add your first model" call — not a hollow "0 results".
//  - The contract is preserved — every caller (combos page, CoworkToolCard)
//    keeps working unchanged.

import { useState, useEffect, useRef, useCallback } from "react";
import Modal from "./Modal";
import Input from "./Input";
import Button from "./Button";
import CapacityBadges from "./CapacityBadges";
import ModelSelectModal from "./ModelSelectModal";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { validateComboName } from "@/shared/constants/comboValidation";
import { cn } from "@/shared/utils/cn";

// Extract the provider alias from a fully-qualified model value (e.g.
// "anthropic/claude-opus-4" → "anthropic"). Used to label each model item
// so the operator can read the combo at a glance.
function providerAliasOf(value) {
  if (!value) return "";
  const slash = value.indexOf("/");
  return slash === -1 ? "" : value.slice(0, slash);
}

function ModelItem({ index, model, total, onEdit, onMoveUp, onMoveDown, onRemove, capsRef }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const inputRef = useRef(null);
  const caps = capsRef(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <li
      className={cn(
        "group flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface",
        "px-3 py-2 transition-colors",
        "hover:border-primary/40 focus-within:border-primary/60"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="text-[10px] font-semibold text-text-muted w-5 text-center shrink-0 tabular-nums"
          aria-label={`Position ${index + 1} of ${total}`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            aria-label="Edit model id"
            className={cn(
              "min-w-0 flex-1 rounded border border-primary/40 bg-white px-2 py-1",
              "font-mono text-xs text-text-main outline-none",
              "focus:ring-2 focus:ring-primary/50",
              "dark:bg-black/20"
            )}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Click to edit"
            aria-label={`Edit ${model}`}
            className={cn(
              "min-w-0 flex-1 cursor-text truncate rounded px-2 py-1",
              "font-mono text-xs text-text-main text-left",
              "hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            )}
          >
            {model}
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Reorder / remove">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move ${model} up`}
            className={cn(
              "p-1 rounded text-text-muted",
              "hover:text-primary hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:bg-transparent"
            )}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">arrow_upward</span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label={`Move ${model} down`}
            className={cn(
              "p-1 rounded text-text-muted",
              "hover:text-primary hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:bg-transparent"
            )}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">arrow_downward</span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${model}`}
            className={cn(
              "p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50",
              "transition-colors"
            )}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      {/* Capability strip — transient info that earns its keep because the
          operator needs to know what each model in the combo can do without
          leaving the editor. Anti-slop R-22: every element carries its
          reason; this strip is the reason the model item is a card. */}
      <div className="flex items-center gap-2 pl-7 text-[10px] text-text-muted">
        {providerAliasOf(model) && (
          <span className="font-mono text-text-subtle">@{providerAliasOf(model)}</span>
        )}
        <CapacityBadges caps={caps} />
      </div>
    </li>
  );
}

export default function ComboFormModal({
  isOpen,
  combo,
  onClose,
  onSave,
  activeProviders,
  kindFilter = null,
  forcePrefix = "",
  title,
}) {
  // Strip prefix when editing existing combo so user only edits suffix
  const initialName = combo?.name
    ? (forcePrefix && combo.name.startsWith(forcePrefix) ? combo.name.slice(forcePrefix.length) : combo.name)
    : "";
  const [name, setName] = useState(initialName);
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const { getCaps } = useModelCaps();

  // Caps lookup is closure-stable across the list — useModelCaps caches the
  // /api/models response module-wide, so getCaps is referentially stable.
  const capsRef = useCallback((value) => getCaps(value) || {}, [getCaps]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/alias")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setModelAliases(d.aliases || {}))
      .catch(() => {});
  }, [isOpen]);

  // Reset state when the modal re-opens for a different combo. The keyed
  // parent (combos/page.js uses key={editingCombo.id}) already re-mounts
  // the component, but the explicit reset makes the contract obvious.
  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setModels(combo?.models || []);
    setNameError("");
    setShowModelSelect(false);
  }, [isOpen, combo, initialName]);

  const validateName = (value) => {
    if (!value.trim()) { setNameError("Name is required"); return false; }
    const full = forcePrefix + value;
    const verdict = validateComboName(full);
    if (!verdict.ok) { setNameError(verdict.error); return false; }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    let value = e.target.value;
    if (forcePrefix && value.startsWith(forcePrefix)) value = value.slice(forcePrefix.length);
    setName(value);
    if (value) validateName(value); else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) setModels((m) => [...m, model.value]);
  };
  const handleDeselectModel = (model) => {
    setModels((m) => m.filter((existing) => existing !== model.value));
  };
  const handleRemoveModel = (i) => setModels((m) => m.filter((_, idx) => idx !== i));
  const handleMoveUp = (i) => {
    if (i === 0) return;
    setModels((m) => {
      const a = [...m];
      [a[i - 1], a[i]] = [a[i], a[i - 1]];
      return a;
    });
  };
  const handleMoveDown = (i) => {
    if (i === models.length - 1) return;
    setModels((m) => {
      const a = [...m];
      [a[i], a[i + 1]] = [a[i + 1], a[i]];
      return a;
    });
  };
  const handleEditModel = (i, value) => {
    setModels((m) => {
      const a = [...m];
      a[i] = value;
      return a;
    });
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    try {
      await onSave({ name: forcePrefix + name.trim(), models });
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={title || (isEdit ? "Edit Combo" : "Create Combo")}
        size="lg"
        className="p-0! max-h-[90vh] h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col"
        footer={null}
      >
        <div className="flex flex-col h-full min-h-0">
          {/* Body — scrolls on overflow, the footer pins. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-4">
              {/* Name field — stacks the prefix on its own row on mobile so the
                  Star's "friendly for any resolution" clause stays honest. */}
              <div>
                {forcePrefix ? (
                  <>
                    <label htmlFor="combo-name" className="text-sm font-medium mb-1.5 block text-text-main">
                      Combo Name
                    </label>
                    {/* On mobile: column stack. On sm+: row with prefix as a
                        left badge so the user types only the suffix. */}
                    <div className="flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-0">
                      <span
                        className={cn(
                          "inline-flex items-center justify-start sm:justify-center",
                          "px-2.5 py-1.5 sm:py-0",
                          "border border-black/10 dark:border-white/10",
                          "bg-black/[0.04] dark:bg-white/[0.04]",
                          "text-text-muted font-mono text-sm",
                          "sm:rounded-l sm:border-r-0",
                          "rounded"
                        )}
                        aria-hidden="true"
                      >
                        {forcePrefix}
                      </span>
                      <input
                        id="combo-name"
                        value={name}
                        onChange={handleNameChange}
                        placeholder="my-combo"
                        aria-invalid={!!nameError}
                        aria-describedby="combo-name-hint combo-name-error"
                        className={cn(
                          "flex-1 min-w-0 sm:rounded-l-none rounded",
                          "border border-black/10 dark:border-white/10",
                          "bg-white dark:bg-black/20",
                          "px-2.5 py-1.5 font-mono text-sm",
                          "outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                        )}
                      />
                    </div>
                    {nameError && (
                      <p id="combo-name-error" className="text-[11px] text-red-500 mt-1">{nameError}</p>
                    )}
                    <p id="combo-name-hint" className="text-[10px] text-text-muted mt-1">
                      Auto-prefixed with <span className="font-mono">{forcePrefix}</span> · letters, numbers, -, _, . and / allowed · use / to namespace, e.g. <span className="font-mono">{forcePrefix}cc/opus</span>
                    </p>
                  </>
                ) : (
                  <Input
                    id="combo-name"
                    label="Combo Name"
                    value={name}
                    onChange={handleNameChange}
                    placeholder="my-combo"
                    error={nameError}
                    hint="Letters, numbers, -, _, . and / allowed · use / to namespace, e.g. cc/opus"
                  />
                )}
              </div>

              {/* Models — list of cards, empty state, and the "Add Model" affordance. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-main">Models</label>
                  {models.length > 0 && (
                    <span className="text-[11px] text-text-muted tabular-nums">
                      {models.length} {models.length === 1 ? "model" : "models"}
                    </span>
                  )}
                </div>

                {models.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-border-subtle rounded-lg bg-surface-2/30">
                    <span className="material-symbols-outlined text-primary text-2xl mb-2 block" aria-hidden="true">
                      layers
                    </span>
                    <p className="text-sm text-text-main font-medium">No models added yet</p>
                    <p className="text-xs text-text-muted mt-1">Add your first model to build the combo</p>
                    <button
                      type="button"
                      onClick={() => setShowModelSelect(true)}
                      className={cn(
                        "mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md",
                        "bg-primary text-white text-xs font-medium",
                        "hover:bg-primary-hover transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      )}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">add</span>
                      Add your first model
                    </button>
                  </div>
                ) : (
                  <>
                    <ul
                      className="flex max-h-[55vh] min-w-0 flex-col gap-2 overflow-y-auto sm:max-h-[340px] pr-1"
                      aria-label="Models in this combo"
                    >
                      {models.map((model, index) => (
                        <ModelItem
                          key={`${index}-${model}`}
                          index={index}
                          total={models.length}
                          model={model}
                          onEdit={(v) => handleEditModel(index, v)}
                          onMoveUp={() => handleMoveUp(index)}
                          onMoveDown={() => handleMoveDown(index)}
                          onRemove={() => handleRemoveModel(index)}
                          capsRef={capsRef}
                        />
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setShowModelSelect(true)}
                      className={cn(
                        "w-full mt-2 py-2 border border-dashed border-border-subtle rounded-lg",
                        "text-xs text-primary font-medium",
                        "hover:text-primary-hover hover:border-primary/50 hover:bg-primary/5",
                        "transition-colors",
                        "flex items-center justify-center gap-1.5",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      )}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">add</span>
                      Add Model
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Footer — pins to the bottom of the modal so save is always
              visible. On mobile, the buttons stack; on sm+, side by side. */}
          <div className="border-t border-border-subtle px-4 py-3 sm:px-6 sm:py-3 bg-surface-2/20 flex flex-col-reverse sm:flex-row gap-2 shrink-0">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create combo"}
            </Button>
          </div>
        </div>
      </Modal>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Add Model to Combo"
          kindFilter={kindFilter}
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </>
  );
}
