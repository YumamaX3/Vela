"use client";

import { Modal, Button, Input, Toggle, KeyLimitsEditor } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { SERVICE_KINDS } from "../endpointConstants";
import AclChipGroup from "./AclChipGroup";
import CategoryCombo from "./CategoryCombo";

/**
 * The create flow — name, category, description, scope toggle + grouped model
 * picker, the 4-way ACL chips, and the shared limits editor. On success the
 * orchestrator opens the show-once reveal (vault capture lives in useKeys).
 */
export default function KeyCreateModal({
  showAddModal,
  onClose,
  form,
  setForm,
  onScopeToggle,
  onAddModel,
  onRemoveModel,
  onCreate,
  error,
  categories,
  // Per-category key counts, keyed by category name (for the dropdown chips).
  keyCount = {},
  combos,
}) {
  if (!showAddModal) return null;
  const set = (patch) => setForm({ ...form, ...patch });

  const providers = Object.keys(form.modelAliases || {});
  const comboOptions = (form.comboOptions || combos || []);

  const toggleAcl = (field, value) => {
    const current = form[field] || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    // Tri-state contract: an emptied chip set maps to null (unrestricted) —
    // the server treats [] as "deny all", which no empty chip state intends.
    set({ [field]: next.length ? next : null });
  };

  return (
    <Modal
      isOpen={showAddModal}
      title={translate("Create API Key")}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <Input
          label={translate("Key Name")}
          value={form.name || ""}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={translate("Production Key")}
        />
        <Input
          label={translate("Description (optional)")}
          value={form.description || ""}
          onChange={(e) => set({ description: e.target.value })}
          placeholder={translate("What this key is used for")}
        />
        <div>
          <label className="text-xs font-medium text-text-muted">{translate("Category (optional)")}</label>
          <CategoryCombo
            value={form.category || null}
            onChange={(cat) => set({ category: cat })}
            categories={categories}
            keyCount={keyCount}
            placeholder={translate("Pick a category…")}
          />
          <p className="text-[11px] text-text-muted mt-1">{translate("Group keys by purpose — pick an existing one or create a new one.")}</p>
        </div>

        {/* Allowed models — grouped per provider, same picker the combos use */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium">{translate("Restrict models")}</p>
              <p className="text-xs text-text-muted">{translate("Limit which models this key can call")}</p>
            </div>
            <Toggle size="sm" checked={form.scopeOn} onChange={onScopeToggle} />
          </div>
          {form.scopeOn && (
            <>
              <Button icon="add" variant="outline" size="sm" onClick={onAddModel}>
                {translate("Add Model")}
              </Button>
              {form.scope.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.scope.map((m) => (
                    <span key={m} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs font-mono">
                      {m}
                      <button onClick={() => onRemoveModel(m)} className="text-text-muted hover:text-red-500" aria-label={translate("Remove")}>
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-2">{translate("No models selected")}</p>
              )}
              {form.scope.length > 0 && (
                <p className="text-xs text-text-muted mt-1.5">{form.scope.length} {translate("selected")}</p>
              )}
            </>
          )}
        </div>

        {/* 4-way ACL chips */}
        <div className="border border-border-subtle rounded-lg p-3 flex flex-col gap-3">
          <p className="text-sm font-medium">{translate("Access control")}</p>

          <AclChipGroup
            label={translate("Service kinds")}
            options={SERVICE_KINDS}
            value={form.allowedKinds || []}
            onToggle={(v) => toggleAcl("allowedKinds", v)}
            noneLabel={translate("All kinds")}
          />

          <AclChipGroup
            label={translate("Providers")}
            options={providers}
            value={form.allowedProviders || []}
            onToggle={(v) => toggleAcl("allowedProviders", v)}
            noneLabel={translate("All providers")}
          />

          <AclChipGroup
            label={translate("Combos")}
            options={comboOptions}
            value={form.allowedCombos || []}
            onToggle={(v) => toggleAcl("allowedCombos", v)}
            noneLabel={translate("All combos")}
          />
        </div>

        {/* W3 limits — rate, budgets, window, expiry, IP allowlist */}
        <KeyLimitsEditor
          key={`create-${showAddModal}`}
          value={form.limits}
          onChange={(limits) => set({ limits })}
        />

        {/* Key Domain Ascension — daily request cap */}
        <Input
          label={translate("Daily request cap (optional)")}
          type="number"
          min="1"
          value={form.requestCapDaily == null ? "" : String(form.requestCapDaily)}
          onChange={(e) => set({ requestCapDaily: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value) || 0)) })}
          placeholder={translate("unlimited")}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={onCreate} fullWidth disabled={!form.name?.trim()}>
            {translate("Create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {translate("Cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

