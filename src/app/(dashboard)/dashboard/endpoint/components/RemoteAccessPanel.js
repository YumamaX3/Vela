"use client";

import { Card, Button, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import Tooltip from "./Tooltip";
import StatusAlert from "./StatusAlert";
import SecurityWarning from "./SecurityWarning";
import SecurityCallout from "./SecurityCallout";
import { TUNNEL_BENEFITS } from "../endpointConstants";
import EndpointRow from "./EndpointRow";

/**
 * Tunnel + Tailscale + the security gates + dashboard-access toggle. Receives
 * both state machines from the orchestrator (useTunnel / useTailscale) plus
 * the settings gates — presentational, all handlers come from props.
 */
export default function RemoteAccessPanel({
  tunnel,
  tailscale,
  settings,
  copied,
  onCopy,
  baseUrl,
}) {
  const {
    tunnelEnabled, tunnelReachable, tunnelUrl, tunnelPublicUrl,
    tunnelLoading, setTunnelLoading, tunnelProgress, setTunnelProgress,
    tunnelStatus, tunnelEverReachable,
    showEnableTunnelModal, setShowEnableTunnelModal,
    showDisableTunnelModal, setShowDisableTunnelModal,
    handleEnableTunnel, handleDisableTunnel, handleEnableClick,
  } = tunnel;
  const {
    tsEnabled, tsReachable, tsUrl, tsLoading, setTsLoading, tsProgress, setTsProgress,
    tsStatus, setTsStatus, tsAuthUrl, tsAuthLabel, tsInstalled, tsInstalling, tsInstallLog,
    tsSudoPassword, setTsSudoPassword, tsConnecting, setTsConnecting, tsEverReachable,
    showTsModal, setShowTsModal, showDisableTsModal, setShowDisableTsModal,
    tsLogRef, handleInstallTailscale, handleConnectTailscale,
    handleDisableTailscale, handleOpenTsModal, clearUserAuth,
  } = tailscale;
  const {
    requireApiKey, requireLogin, hasPassword, tunnelDashboardAccess,
    handleTunnelDashboardAccess, isLoginUnsafe, unsafeReason,
  } = settings;

  const anyRemote = tunnelEnabled || tsEnabled;

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-primary">api</span>
        API Endpoint
      </h2>

      <div className="flex flex-col gap-2">
        {/* Local */}
        <EndpointRow label="Local" url={baseUrl} copyId="local_url" copied={copied} onCopy={onCopy} />

        {/* Cloudflare Tunnel */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
            tunnelEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
          }`}>Tunnel</span>
          {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
            <>
              <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
              <button
                onClick={() => onCopy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</span>
              </button>
              <button
                onClick={() => setShowDisableTunnelModal(true)}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Disable Tunnel"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                {tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}
              </div>
              <button
                onClick={() => setShowDisableTunnelModal(true)}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Disable Tunnel"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : tunnelLoading ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                {tunnelProgress || "Creating tunnel..."}
              </div>
              <button
                onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Stop"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : tunnelStatus?.type === "error" ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                <span className="material-symbols-outlined text-sm">error</span>
                {tunnelStatus.message}
              </div>
              <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
            </>
          ) : settings.tunnelChecking ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Checking...
              </div>
              <button
                onClick={() => settings.setTunnelChecking(false)}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Stop"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : (
            <Button size="sm" icon="cloud_upload" onClick={handleEnableClick}>
              Enable
            </Button>
          )}
        </div>

        {/* Tailscale */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
            tsEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
          }`}>Tailscale</span>
          {tsEnabled && !tsLoading && tsReachable ? (
            <>
              <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
              <button
                onClick={() => onCopy(`${tsUrl}/v1`, "ts_url")}
                className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</span>
              </button>
              <button
                onClick={() => setShowDisableTsModal(true)}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Disable Tailscale"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : tsEnabled && !tsLoading && !tsReachable ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                {tsEverReachable ? "Tailscale reconnecting..." : "Tailscale checking..."}
              </div>
              <button
                onClick={() => setShowDisableTsModal(true)}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Disable Tailscale"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : (tsLoading || tsConnecting) ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                {tsProgress || "Connecting..."}
              </div>
              {tsAuthUrl && (
                <Button
                  size="sm"
                  icon="open_in_new"
                  onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                >
                  {tsAuthLabel || "Open"}
                </Button>
              )}
              <button
                onClick={() => { tailscale.setTsLoading(false); tailscale.setTsConnecting(false); tailscale.setTsProgress(""); clearUserAuth(); }}
                className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                title="Stop"
              >
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
              </button>
            </>
          ) : tsStatus?.type === "error" ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                <span className="material-symbols-outlined text-sm">error</span>
                {tsStatus.message}
              </div>
              <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Button>
            </>
          ) : (
            <Button
              size="sm"
              icon="vpn_lock"
              onClick={() => {
                if (isLoginUnsafe) {
                  tailscale.setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                  return;
                }
                handleOpenTsModal();
              }}
              className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
            >
              Enable
            </Button>
          )}
        </div>
      </div>

      {/* Pre-enable security gate banner */}
      <SecurityCallout unsafeReason={isLoginUnsafe ? unsafeReason : null} enabled={anyRemote} />

      {/* Security warnings when tunnel or tailscale is active */}
      {anyRemote && (
        <div className="mt-4 flex flex-col gap-2">
          {!requireApiKey && (
            <SecurityWarning
              message="Require API key is disabled — your endpoint is publicly accessible without authentication."
              action={{ label: "Enable", href: "#require-api-key" }}
            />
          )}
          {(!requireLogin || !hasPassword) && (
            <SecurityWarning
              message={
                !requireLogin
                  ? "Require login is disabled — anyone can access your dashboard via tunnel."
                  : "Dashboard uses the default password — change it in Profile settings."
              }
              action={{
                label: !requireLogin ? "Enable" : "Change password",
                href: "/dashboard/settings",
              }}
            />
          )}
        </div>
      )}

      {/* Tunnel dashboard access option */}
      {anyRemote && (
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <Toggle
            checked={tunnelDashboardAccess}
            onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
          />
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
            <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
          </div>
        </div>
      )}

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
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); tailscale.setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

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

          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleConnectTailscale()} fullWidth>
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

      {/* Confirm Modal — tunnel/tailscale flows use the shared confirm surface */}
      <ConfirmModal
        isOpen={!!tunnel.confirmState || !!tailscale.confirmState}
        onClose={() => {
          tunnel.confirmState?.onClose?.();
          tailscale.confirmState?.onClose?.();
        }}
        onConfirm={tunnel.confirmState?.onConfirm || tailscale.confirmState?.onConfirm}
        title={tunnel.confirmState?.title || tailscale.confirmState?.title || "Confirm"}
        message={tunnel.confirmState?.message || tailscale.confirmState?.message}
        variant="danger"
      />
    </Card>
  );
}
