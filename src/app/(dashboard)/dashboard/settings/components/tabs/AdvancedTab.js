"use client";
// Advanced — the odd instruments, and the two acts that end a session.
//
// Three rooms own settings that used to be scattered through this page's prose:
// the token savers, the pxpipe filter, and the prompt injectors. Rather than
// duplicate their controls here (two switches writing one key is how a setting
// silently reverts), this tab names each room and links to it, so every knob has
// exactly one home.
//
// What stays is what nothing else owns: the request-recording toggle, and the
// shutdown/logout pair — kept apart from ordinary settings because both end the
// session, one of them for the machine.
import { useState } from "react";
import Link from "next/link";
import { Button, Card, ConfirmModal, Toggle } from "@/shared/components";
import { APP_CONFIG } from "@/shared/constants/config";
import { shutdownServer, logout } from "../../lib/settingsApi";
import StatusLine from "../StatusLine";
import SettingRow from "../SettingRow";

// The rooms that own savers and injectors, named with the keys they hold — so an
// operator who knows the setting name still finds its home.
const OTHER_ROOMS = [
  {
    href: "/dashboard/token-saver",
    icon: "compress",
    label: "Token saver",
    owns: "RTK filters — Caveman, Ponytail, and the Headroom sidecar",
  },
  {
    href: "/dashboard/pxpipe",
    icon: "swap_horiz",
    label: "Pxpipe",
    owns: "the request-pipe filter and its activation rules",
  },
  {
    href: "/dashboard/prompt-injectors",
    icon: "edit_note",
    label: "Prompt injectors",
    owns: "operator-defined system prompts, appended or prepended",
  },
];

export default function AdvancedTab({ deck }) {
  const { settings, loading, pending, patch, remoteHost } = deck;
  const observability = settings.enableObservability === true;

  const [status, setStatus] = useState({ type: "", message: "" });
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  const toggleObservability = async (value) => {
    const r = await patch({ enableObservability: value }, ["enableObservability"]);
    if (!r.ok) setStatus({ type: "error", message: r.error });
  };

  const doShutdown = async () => {
    setShuttingDown(true);
    try {
      // The server dies mid-response by design, so a thrown network error here is
      // the expected shape of success — the old room swallowed it for this reason.
      await shutdownServer();
    } catch {
      /* expected: the process is gone before the response lands */
    }
  };

  return (
    <>
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">monitoring</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Observability</h3>
            <p className="text-sm text-text-muted mt-0.5">
              How much detail this gateway keeps about the requests it carries.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <SettingRow
            label="Request recording"
            description="Record request details for inspection in the logs view."
            control={
              <Toggle
                checked={observability}
                onChange={() => toggleObservability(!observability)}
                disabled={loading || !!pending.enableObservability}
              />
            }
          />
          <StatusLine status={status} />
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">tune</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Other instruments</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Each of these rooms owns its settings outright — this console will not hold a
              second switch for them.
            </p>
          </div>
        </div>

        <div className="flex flex-col">
          {OTHER_ROOMS.map((room, i) => (
            <Link
              key={room.href}
              href={room.href}
              className={`flex items-center gap-3 py-3 group ${i > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <span className="material-symbols-outlined text-[20px] leading-none text-text-muted group-hover:text-brand-500 motion-control">
                {room.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-text-main group-hover:text-brand-500 motion-control">
                  {room.label}
                </span>
                <span className="block text-sm text-text-muted truncate">{room.owns}</span>
              </span>
              <span className="material-symbols-outlined text-[18px] leading-none text-text-muted shrink-0">
                chevron_right
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">power_settings_new</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Session</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Leaving, and stopping the machine behind this console.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setConfirmShutdown(true)}
            disabled={shuttingDown}
            className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
          >
            Shutdown Vela
          </Button>
          <Button variant="outline" fullWidth icon="logout" onClick={logout}>
            Log out
          </Button>
        </div>

        <div className="mt-6 pt-4 border-t border-border-subtle text-sm text-text-muted">
          <span className="font-medium text-text-main">
            {APP_CONFIG.name} v{APP_CONFIG.version}
          </span>
          <span className="block mt-0.5">
            {remoteHost
              ? "Remote Mode - served through this host"
              : "Local Mode - All data stored on your machine"}
          </span>
        </div>
      </Card>

      <ConfirmModal
        isOpen={confirmShutdown}
        onClose={() => setConfirmShutdown(false)}
        onConfirm={doShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={shuttingDown}
      />
    </>
  );
}
