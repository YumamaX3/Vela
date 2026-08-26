"use client";

import { Modal, Button, Input, Toggle, KeyLimitsEditor } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { SERVICE_KINDS } from "../endpointConstants";
import AclChipGroup from "./AclChipGroup";

/**
 * The full edit modal — name, description, category, rate limit + token
 * budget + spend cap (via the shared KeyLimitsEditor), expiration, IP
 * allowlist, and the 4-way ACL chips (kinds / providers / combos / models).
 * The grouped model picker (ModelSelectModal) is owned by the orchestrator
 * via scopePickerFor — this modal just renders the chips it manages.
 */
export default function KeyEditModal({
  editingKey,
  onChange,
  onSave,
  onClose,
  onAddModel,
  onRemoveModel,
  modelAliases,
  combos,
}) {
  if (!editingKey) return null;
  const set = (patch) => onChange({ ...editingKey, ...patch });

  const providers = Object.keys(modelAliases || {});
  // The combos OPTIONS are the full catalog; the key's own allowedCombos are
  // the currently-selected VALUE. (These were once conflated, which hid the
  // catalog and made it impossible to add a combo to an existing key.)
  const comboOptions = combos || [];

  const toggleAcl = (field, value) => {
    const current = editingKey[field] || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    // Tri-state contract: an emptied chip set maps to null (unrestricted) —
    // the server treats [] as "deny all", which no empty chip state intends.
    set({ [field]: next.length ? next : null });
  };

  return (
    <Modal
      isOpen={!!editingKey}
      title={translate("Edit API Key")}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <Input
          label={translate("Key Name")}
          value={editingKey.name || ""}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={translate("Production Key")}
        />
        <Input
          label={translate("Description (optional)")}
          value={editingKey.description || ""}
          onChange={(e) => set({ description: e.target.value })}
          placeholder={translate("What this key is used for")}
        />
        <Input
          label={translate("Category (optional)")}
          value={editingKey.category || ""}
          onChange={(e) => set({ category: e.target.value })}
          placeholder={translate("e.g. friend, hermes, others")}
          list="key-category-options"
          hint={translate("Leave empty to keep this key uncategorized")}
        />

        {/* 4-way ACL */}
        <div className="border border-border-subtle rounded-lg p-3 flex flex-col gap-3">
          <p className="text-sm font-medium">{translate("Access control")}</p>

          <AclChipGroup
            label={translate("Service kinds")}
            options={SERVICE_KINDS}
            value={editingKey.allowedKinds || []}
            onToggle={(v) => toggleAcl("allowedKinds", v)}
            noneLabel={translate("All kinds")}
          />

          <AclChipGroup
            label={translate("Providers")}
            options={providers}
            value={editingKey.allowedProviders || []}
            onToggle={(v) => toggleAcl("allowedProviders", v)}
            noneLabel={translate("All providers")}
          />

          <AclChipGroup
            label={translate("Combos")}
            options={comboOptions}
            value={editingKey.allowedCombos || []}
            onToggle={(v) => toggleAcl("allowedCombos", v)}
            noneLabel={translate("All combos")}
          />

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-text-muted">{translate("Models")}</p>
              <Button size="sm" variant="outline" icon="add" onClick={onAddModel}>
                {translate("Add Model")}
              </Button>
            </div>
            {(editingKey.allowedModels || []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(editingKey.allowedModels || []).map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs font-mono">
                    {m}
                    <button onClick={() => onRemoveModel(m)} className="text-text-muted hover:text-red-500" aria-label={translate("Remove")}>
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted mt-1">{translate("All models")}</p>
            )}
          </div>
        </div>

        {/* W3 limits — seeded from the server record, saved in full */}
        <KeyLimitsEditor
          key={editingKey.id}
          value={editingKey.limits}
          onChange={(limits) => set({ limits })}
        />

        {editingKey.error && (
          <p className="text-sm text-red-500">{editingKey.error}</p>
        )}

        <div className="flex gap-2">
          <Button onClick={onSave} fullWidth disabled={!editingKey?.name?.trim() || editingKey?.saving}>
            {editingKey?.saving ? translate("Saving...") : translate("Save")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {translate("Cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

