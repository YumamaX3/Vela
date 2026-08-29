"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { marked } from "marked";
import { translate } from "@/i18n/runtime";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// The horizon bell — the update notice, Vela style.
// The ancestor's notice was a green strip with two buttons; this one carries
// the ship's log section for the incoming tide, names the berth (docker /
// npm / k8s) and hands the right command for it. Coral single accent,
// warm neutrals, no fabricated urgency.

const DEPLOYMENT_LABELS = {
  docker: "Docker",
  k8s: "Kubernetes",
  npm: "npm (CLI)",
  dev: "Development",
};

// Defense-in-depth fence: the release notes come from the ship's log we
// author ourselves, but the HTML crosses a dangerouslySetInnerHTML boundary,
// so scrub it anyway — strip scripts, inline event handlers, and javascript:
// URLs. Dependency-free on purpose; the content is ours, this is the gate.
function sanitizeChangelogHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=[^\s>]*/gi, "")
    .replace(/javascript\s*:/gi, "");
}

export default function UpdateNoticeModal({ isOpen, onClose, info, onTriggerLegacyUpdate }) {
  const { copied, copy } = useCopyToClipboard(2000);
  const [notesHtml, setNotesHtml] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setNotesHtml(info?.releaseNotes ? sanitizeChangelogHtml(marked.parse(info.releaseNotes)) : "");
  }, [isOpen, info?.releaseNotes]);

  if (!isOpen || typeof document === "undefined") return null;

  const isCli = info?.deployment === "npm";
  const command = info?.updateCommand || "";

  const handlePrimary = () => {
    if (isCli && onTriggerLegacyUpdate) {
      // The npm/CLI berth keeps the ancestor's in-place updater flow.
      onClose();
      onTriggerLegacyUpdate();
      return;
    }
    if (command) copy(command);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] border border-border-subtle bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header — the coral signature */}
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-brand-400 px-6 py-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white/15 text-white">
                <span className="material-symbols-outlined text-[26px]">sailing</span>
              </span>
              <div>
                <h2 className="text-[17px] font-semibold text-white">{translate("A new tide is on the horizon")}</h2>
                <p className="mt-0.5 font-mono text-[12px] text-white/85">
                  v{info?.currentVersion}
                  <span className="mx-1.5 text-white/60">→</span>
                  <span className="font-semibold text-white">v{info?.latestVersion}</span>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={translate("Close")}
              className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Meta — the honest facts of the tide */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-6 py-3">
          {info?.deployment && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2 px-2.5 py-1 text-[10.5px] font-medium text-text-muted">
              <span className="material-symbols-outlined text-[12px] text-primary">anchor</span>
              {DEPLOYMENT_LABELS[info.deployment] || info.deployment}
            </span>
          )}
          {info?.source && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2 px-2.5 py-1 text-[10.5px] font-medium text-text-muted">
              <span className="material-symbols-outlined text-[12px] text-primary">travel_explore</span>
              {info.source === "npm" ? "npm registry" : "GitHub"}
            </span>
          )}
          {info?.checkedAt && (
            <span className="ml-auto font-mono text-[10px] text-text-subtle">
              {translate("checked")} {new Date(info.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Body — the ship's log section for the incoming tide */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {notesHtml ? (
            <div
              className="changelog-body text-text-main"
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
          ) : (
            <p className="text-sm text-text-muted">
              {translate("No release notes are aboard this tide yet. The full log keeps every verse.")}
            </p>
          )}
        </div>

        {/* Footer — the command for this berth */}
        <div className="border-t border-border-subtle bg-surface-2/50 px-6 py-4">
          {command && !isCli && (
            <button
              type="button"
              onClick={() => copy(command)}
              className="mb-3 block w-full truncate rounded-[10px] border border-border-subtle bg-surface px-3 py-2 text-left font-mono text-[11px] text-text-muted transition-colors hover:border-primary/40"
              title={translate("Copy update command")}
            >
              {copied ? `${translate("Copied")} ✓` : command}
            </button>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-text-subtle">
              {isCli
                ? translate("The in-place updater handles this berth.")
                : translate("Run the command where your Vela sleeps, then it returns on the new tide.")}
            </p>
            <button
              type="button"
              onClick={handlePrimary}
              className="shrink-0 rounded-[10px] bg-brand-500 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-600"
            >
              {isCli ? translate("Update now") : command && copied ? translate("Copied") : translate("Copy update command")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

UpdateNoticeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  info: PropTypes.shape({
    currentVersion: PropTypes.string,
    latestVersion: PropTypes.string,
    releaseNotes: PropTypes.string,
    deployment: PropTypes.string,
    updateCommand: PropTypes.string,
    source: PropTypes.string,
    checkedAt: PropTypes.string,
  }),
  onTriggerLegacyUpdate: PropTypes.func,
};
