"use client";
// EndpointModals — the ceremonies. Create / created-once / edit, the tunnel and
// Tailscale dialogs, the grouped scope picker, and the confirm gate. Extracted
// verbatim from the page client; only its address changed.
import { Button, Input, Modal, Toggle, ConfirmModal, ModelSelectModal, KeyLimitsEditor } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { TUNNEL_BENEFITS } from "../../lib/constants";
import CategoryPicker from "../keys/CategoryPicker";
import StatusAlert from "../endpoint/StatusAlert";

export default function Modals({ c }) {
  const {
    activeProviders,
    categories,
    closeCreatedKeyModal,
    confirmState,
    copied,
    copy,
    createError,
    createLimits,
    createdKey,
    createdKeyAck,
    editingKey,
    handleConnectTailscale,
    handleCreateKey,
    handleDisableTailscale,
    handleDisableTunnel,
    handleEnableTunnel,
    handleInstallTailscale,
    handleSaveKey,
    handleScopeDeselect,
    handleScopeSelect,
    keys,
    modelAliases,
    newKeyCategory,
    newKeyDescription,
    newKeyName,
    newKeyScope,
    newKeyScopeOn,
    resetCreateForm,
    scopePickerFor,
    setConfirmState,
    setCreateLimits,
    setCreatedKeyAck,
    setEditingKey,
    setNewKeyCategory,
    setNewKeyDescription,
    setNewKeyName,
    setNewKeyScope,
    setNewKeyScopeOn,
    setScopePickerFor,
    setShowAddModal,
    setShowDisableTsModal,
    setShowDisableTunnelModal,
    setShowEnableTunnelModal,
    setShowTsModal,
    setTsStatus,
    setTsSudoPassword,
    showAddModal,
    showDisableTsModal,
    showDisableTunnelModal,
    showEnableTunnelModal,
    showTsModal,
    tsInstallLog,
    tsInstalled,
    tsInstalling,
    tsLoading,
    tsLogRef,
    tsStatus,
    tunnelLoading,
  } = c;

  return (
    <>
      {/* Add Key Modal — Prism redesign: sectioned ceremony (Identity/Access/Limits),
          pinned footer, terminal-styled reveal on the created-key step. All state
          wiring preserved verbatim; only the rendering is reborn. */}
      <Modal
        isOpen={showAddModal}
        title={translate("Create API Key")}
        size="lg"
        className="p-0! max-h-[90vh] h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col"
        onClose={() => {
          setShowAddModal(false);
          resetCreateForm();
        }}
      >
        <div className="flex flex-col h-full min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 flex flex-col gap-5">
            {/* Section: Identity */}
            <section className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">badge</span>
                <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Identity")}</h3>
              </div>
              <Input
                label={translate("Key Name")}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder={translate("Production Key")}
              />
              <Input
                label={translate("Description (optional)")}
                value={newKeyDescription}
                onChange={(e) => setNewKeyDescription(e.target.value)}
                placeholder={translate("What this key is used for")}
              />
              <div>
                <label className="text-sm font-medium text-text-main mb-1.5 block">
                  {translate("Category (optional)")}
                </label>
                <CategoryPicker
                  idPrefix="create"
                  value={newKeyCategory}
                  existing={categories}
                  onChange={setNewKeyCategory}
                />
                <p className="text-[10px] text-text-muted mt-1">
                  {translate("Group keys by purpose — pick an existing one or type your own")}
                </p>
              </div>
            </section>

            <div className="border-t border-border-subtle" role="presentation" />

            {/* Section: Access */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">shield_lock</span>
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Restrict models")}</h3>
                    <p className="text-xs text-text-muted">{translate("Limit which models this key can call")}</p>
                  </div>
                </div>
                <Toggle size="sm" checked={newKeyScopeOn} onChange={(c) => { setNewKeyScopeOn(c); if (!c) setNewKeyScope([]); }} />
              </div>
              {newKeyScopeOn && (
                <div className="rounded-lg border border-border-subtle bg-surface-2/30 p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">
                      {newKeyScope.length > 0
                        ? `${newKeyScope.length} ${translate("selected")}`
                        : translate("No models selected")}
                    </span>
                    <Button icon="add" variant="outline" size="sm" onClick={() => setScopePickerFor("create")}>
                      {translate("Add Model")}
                    </Button>
                  </div>
                  {newKeyScope.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {newKeyScope.map((m) => (
                        <span key={m} className="group inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md bg-primary/10 border border-primary/30 text-xs font-mono">
                          {m}
                          <button
                            onClick={() => setNewKeyScope((prev) => prev.filter((x) => x !== m))}
                            className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 motion-control"
                            aria-label={`${translate("Remove")} ${m}`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="border-t border-border-subtle" role="presentation" />

            {/* Section: Limits */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">tune</span>
                <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Limits")}</h3>
              </div>
              {/* W3 limits — rate, budgets, window, expiry, IP allowlist */}
              <KeyLimitsEditor
                key={`create-${showAddModal}`}
                value={createLimits}
                onChange={setCreateLimits}
              />
            </section>

            {createError && (
              <p className="text-sm text-red-500 flex items-center gap-1.5" role="alert">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }} aria-hidden="true">error</span>
                {createError}
              </p>
            )}
          </div>

          {/* Pinned footer — save is always visible, no scroll-to-save */}
          <div className="border-t border-border-subtle px-4 py-3 sm:px-5 bg-surface-2/20 flex flex-col-reverse sm:flex-row gap-2 shrink-0">
            <Button
              onClick={() => {
                setShowAddModal(false);
                resetCreateForm();
              }}
              variant="ghost"
              fullWidth
            >
              {translate("Cancel")}
            </Button>
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              {translate("Create")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal — the one-time show-once ceremony.
          Prism redesign: the key lives in the terminal panel (the warm-ink
          token, like the command deck) because a one-time secret should
          read as a vault opening, not a form field. */}
      <Modal
        isOpen={!!createdKey}
        title={translate("API Key Created")}
        onClose={() => { if (createdKeyAck) closeCreatedKeyModal(); }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3.5">
            <span className="material-symbols-outlined text-warning shrink-0" style={{ fontSize: "20px" }} aria-hidden="true">key</span>
            <div>
              <p className="text-sm text-text-main mb-1 font-semibold">
                {translate("Save this key now!")}
              </p>
              <p className="text-xs text-text-muted">
                {translate("This is the only time this key will ever be shown. Vela stores only its hash — if you lose it, create a new key and delete this one.")}
              </p>
            </div>
          </div>

          {/* The vault — terminal panel styling, the one deliberate accent surface */}
          <div
            className="rounded-lg border border-black/20 dark:border-white/10 p-4 font-mono text-sm break-all select-all"
            style={{ background: "var(--color-terminal)", color: "var(--color-terminal-text)" }}
          >
            <p className="text-[10px] uppercase tracking-wider opacity-60 mb-2" style={{ color: "var(--color-terminal-text)" }}>
              vela api key · shown once
            </p>
            <p className="leading-relaxed">{createdKey?.key || ""}</p>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey?.key, "created_key")}
            >
              {copied === "created_key" ? translate("Copied!") : translate("Copy")}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={createdKeyAck}
              onChange={(e) => setCreatedKeyAck(e.target.checked)}
              className="accent-primary"
            />
            {translate("I have saved this key in a secure location")}
          </label>
          <Button onClick={closeCreatedKeyModal} fullWidth disabled={!createdKeyAck}>
            {translate("Done")}
          </Button>
        </div>
      </Modal>

      {/* Edit Key Modal — whitelist mutation (name, description, allowed models).
          Prism redesign: mirrors the create ceremony's sectioned rhythm so the
          two surfaces read as one family. State wiring preserved verbatim. */}
      <Modal
        isOpen={!!editingKey}
        title={translate("Edit API Key")}
        size="lg"
        className="p-0! max-h-[90vh] h-dvh sm:h-auto sm:max-h-[85vh] flex flex-col"
        onClose={() => setEditingKey(null)}
      >
        <div className="flex flex-col h-full min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 flex flex-col gap-5">
            {/* Section: Identity */}
            <section className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">badge</span>
                <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Identity")}</h3>
              </div>
              <Input
                label={translate("Key Name")}
                value={editingKey?.name || ""}
                onChange={(e) => setEditingKey((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={translate("Production Key")}
              />
              <Input
                label={translate("Description (optional)")}
                value={editingKey?.description || ""}
                onChange={(e) => setEditingKey((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={translate("What this key is used for")}
              />
              <div>
                <label className="text-sm font-medium text-text-main mb-1.5 block">
                  {translate("Category (optional)")}
                </label>
                <CategoryPicker
                  idPrefix="edit"
                  value={editingKey?.category || ""}
                  existing={categories}
                  onChange={(cat) => setEditingKey((prev) => (prev ? { ...prev, category: cat } : prev))}
                />
                <p className="text-[10px] text-text-muted mt-1">
                  {translate("Leave empty to keep this key uncategorized")}
                </p>
              </div>
            </section>

            <div className="border-t border-border-subtle" role="presentation" />

            {/* Section: Access */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">shield_lock</span>
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Restrict models")}</h3>
                    <p className="text-xs text-text-muted">{translate("Limit which models this key can call")}</p>
                  </div>
                </div>
                <Toggle
                  size="sm"
                  checked={editingKey?.scopeOn || false}
                  onChange={(c) => setEditingKey((prev) => ({ ...prev, scopeOn: c, allowedModels: c ? prev.allowedModels : [] }))}
                />
              </div>
              {editingKey?.scopeOn && (
                <div className="rounded-lg border border-border-subtle bg-surface-2/30 p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">
                      {(editingKey?.allowedModels || []).length > 0
                        ? `${(editingKey?.allowedModels || []).length} ${translate("selected")}`
                        : translate("No models selected")}
                    </span>
                    <Button icon="add" variant="outline" size="sm" onClick={() => setScopePickerFor("edit")}>
                      {translate("Add Model")}
                    </Button>
                  </div>
                  {(editingKey?.allowedModels || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(editingKey?.allowedModels || []).map((m) => (
                        <span key={m} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md bg-primary/10 border border-primary/30 text-xs font-mono">
                          {m}
                          <button
                            onClick={() => setEditingKey((prev) => ({ ...prev, allowedModels: prev.allowedModels.filter((x) => x !== m) }))}
                            className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 motion-control"
                            aria-label={`${translate("Remove")} ${m}`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="border-t border-border-subtle" role="presentation" />

            {/* Section: Limits — seeded from the server record, saved in full */}
            {editingKey && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }} aria-hidden="true">tune</span>
                  <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{translate("Limits")}</h3>
                </div>
                <KeyLimitsEditor
                  key={editingKey.id}
                  value={editingKey.limits}
                  onChange={(limits) => setEditingKey((prev) => (prev ? { ...prev, limits } : prev))}
                />
              </section>
            )}

            {editingKey?.error && (
              <p className="text-sm text-red-500 flex items-center gap-1.5" role="alert">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }} aria-hidden="true">error</span>
                {editingKey.error}
              </p>
            )}
          </div>

          {/* Pinned footer */}
          <div className="border-t border-border-subtle px-4 py-3 sm:px-5 bg-surface-2/20 flex flex-col-reverse sm:flex-row gap-2 shrink-0">
            <Button onClick={() => setEditingKey(null)} variant="ghost" fullWidth>
              {translate("Cancel")}
            </Button>
            <Button onClick={handleSaveKey} fullWidth disabled={!editingKey?.name?.trim() || editingKey?.saving}>
              {editingKey?.saving ? translate("Saving...") : translate("Save")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local Vela to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Grouped model-scope picker — same ModelSelectModal the combos use.
          Combo names are hidden (showCombos=false): for combos the gate checks
          each MEMBER model against the scope, so scoping happens per model. */}
      {scopePickerFor && (
        <ModelSelectModal
          isOpen
          onClose={() => setScopePickerFor(null)}
          onSelect={handleScopeSelect}
          onDeselect={handleScopeDeselect}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={translate("Select models")}
          addedModelValues={scopePickerFor === "create" ? newKeyScope : (editingKey?.allowedModels || [])}
          closeOnSelect={false}
          showCombos={false}
        />
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
      </>
  );
}
