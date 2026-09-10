"use client";

// StatusBeacon — the mast's live instrument.
//
// Polls /api/version (server answers stale-while-revalidate in ~0ms, cached 1h
// per process) and renders a compact status chip in the header:
//   · ok   → green breathing dot + current version (e.g. "v0.9.59")
//   · update available → coral glowing dot + "v0.9.59 → v0.9.60" + a link
//     straight to the release notes on GitHub
//   · unreachable → amber dot, "offline" — honest, not hidden
//
// Fail-open everywhere: any fetch error or unexpected shape renders the
// neutral state (just the green dot, no version text) rather than a crash.
// The happy-dom layout test stubs fetch to `{}`; every field is optional
// and the component renders fine with nothing.

import { useEffect, useState } from "react";
import PropTypes from "prop-types";

export default function StatusBeacon({ className = "" }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function probe() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!cancelled) setInfo({
          current: typeof data?.currentVersion === "string" ? data.currentVersion : null,
          latest: typeof data?.latestVersion === "string" ? data.latestVersion : null,
          hasUpdate: !!data?.hasUpdate,
        });
      } catch {
        if (!cancelled) setInfo({ current: null, latest: null, hasUpdate: false, offline: true });
        if (!cancelled) timer = setTimeout(probe, 30000);
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // The dot's color/glow class — the instrument's truth at a glance.
  const dotClass = info?.offline
    ? "bg-warning/80"
    : info?.hasUpdate
      ? "bg-primary mast-beacon-call"
      : "bg-success mast-beacon-dot";

  const label = info?.hasUpdate && info.current && info.latest
    ? `${info.current} → ${info.latest}`
    : info?.current
      ? info.current
      : "";

  // Update available → the whole chip is a link to the release notes.
  const Chip = info?.hasUpdate && info.latest ? "a" : "div";
  const chipProps = info?.hasUpdate && info.latest
    ? {
        href: `https://github.com/YumamaX3/Vela/releases/tag/${info.latest.startsWith("v") ? info.latest : `v${info.latest}`}`,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Open release notes",
      }
    : { title: info?.offline ? "Cannot reach the update horizon" : "Vela version" };

  return (
    <Chip
      {...chipProps}
      className={`hidden md:flex items-center gap-2 h-7 px-2.5 rounded-md border border-border bg-surface/60 text-[11px] font-medium text-text-muted transition-colors hover:border-primary/40 hover:text-text-main ${className}`}
    >
      <span className={`relative flex size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      {label && <span className="font-mono tracking-tight">{label}</span>}
      {info?.hasUpdate && (
        <span className="material-symbols-outlined text-[13px] text-primary" aria-hidden="true">
          north_east
        </span>
      )}
      <span className="sr-only">
        {info?.offline
          ? "Status: cannot reach the update horizon"
          : info?.hasUpdate
            ? `Update available: ${info.current} to ${info.latest}`
            : "All systems nominal"}
      </span>
    </Chip>
  );
}

StatusBeacon.propTypes = {
  className: PropTypes.string,
};
