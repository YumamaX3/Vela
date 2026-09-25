"use client";
// OffsiteCard — is the 3-2-1 off-site leg armed?
//
// The S3 off-site copy has existed since Wave C6, but no surface ever told the
// operator whether it was actually running — the readiness check (isS3Enabled:
// enabled AND endpoint AND bucket AND credentials) lived only in env and code.
// This card reads that same check from /api/backup/inventory and says plainly
// whether off-site copies are leaving the box.
//
// CREDENTIALS NEVER SURFACE: the endpoint is shown as its host only (the
// inventory route strips userinfo), and access/secret keys are never sent — the
// card reports armed/not-armed and the destination, nothing more.
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/shared/components";

export default function OffsiteCard({ data, refreshKey }) {
  const [offsite, setOffsite] = useState(null);

  const refresh = useCallback(async () => {
    // The room may hand us the off-site block from its own single census
    // (DataTab fetches /api/backup/inventory once). Only ask when it did not —
    // two fetches of the same endpoint on one page is a request spent twice.
    if (data) return;
    try {
      const res = await fetch("/api/backup/inventory", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.offsite) setOffsite(body.offsite);
    } catch {
      /* fail-open */
    }
  }, [data]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh, refreshKey]);

  // The parent may pass a ready-made block (one fetch for the whole room).
  const o = data ?? offsite;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">
            {o?.armed ? "cloud_done" : "cloud_off"}
          </span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Off-site copies</h3>
          <p className="text-xs text-text-muted">
            The 3-2-1 leg — sealed backups uploaded beyond this machine.
          </p>
        </div>
        <span
          className={`ml-auto text-xs px-2 py-0.5 rounded shrink-0 ${
            o?.armed ? "bg-brand-500/10 text-brand-500" : "bg-surface-2 text-text-muted"
          }`}
        >
          {o ? (o.armed ? "armed" : "off") : "—"}
        </span>
      </div>

      {o?.armed ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs sm:text-sm">
          <div>
            <p className="text-text-muted">Endpoint</p>
            <p className="font-medium truncate" title={o.endpointHost || ""}>{o.endpointHost || "—"}</p>
          </div>
          <div>
            <p className="text-text-muted">Bucket</p>
            <p className="font-medium truncate">{o.bucket || "—"}</p>
          </div>
          <div>
            <p className="text-text-muted">Region</p>
            <p className="font-medium">{o.region || "—"}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted">
          {o?.enabled
            ? "S3 is enabled but not fully configured — set the endpoint, bucket and credentials in the environment."
            : "Off-site copies are off. Set VELA_BACKUP_S3_ENABLED=true and the endpoint, bucket and credentials in the environment to arm them. Uploads carry the already-sealed bytes; failures never fail the local backup."}
        </p>
      )}
    </Card>
  );
}
