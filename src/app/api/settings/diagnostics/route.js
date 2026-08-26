// GET /api/settings/diagnostics — one honest snapshot of the harbor's health:
// DB engine + size, process uptime/memory, circuit-breaker states, pool-geo
// probe freshness, and open issues (stale credentials, idle pools). Every
// subsystem is fail-open — a failure degrades to a null field, never a 500.
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getAdapter } from "@/lib/db/driver.js";
import { SCHEMA_VERSION } from "@/lib/db/schema.js";

export const dynamic = "force-dynamic";

function fmtBytes(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function uptimeSeconds() {
  try {
    return Math.round(process.uptime());
  } catch {
    return null;
  }
}

export async function GET() {
  const issues = [];

  // ── Database ─────────────────────────────────────────────────────────────
  let dbInfo = { driver: null, mode: null, sizeBytes: null, schemaVersion: SCHEMA_VERSION };
  try {
    const db = await getAdapter();
    dbInfo.driver = db.driver || null;
    try {
      const { getDbMode } = await import("@/lib/db/repos/bind.js");
      dbInfo.mode = getDbMode();
    } catch {
      /* fail-open */
    }
    try {
      const row = db.get(`SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()`);
      dbInfo.sizeBytes = Number(row?.bytes) || null;
    } catch {
      /* non-sqlite posture — size unknown */
    }
    if (!dbInfo.sizeBytes) {
      try {
        const fs = await import("node:fs");
        const { DATA_DIR } = await import("@/lib/dataDir");
        const file = `${DATA_DIR}/db/data.sqlite`;
        if (fs.existsSync(file)) dbInfo.sizeBytes = fs.statSync(file).size;
      } catch {
        /* fail-open */
      }
    }
  } catch {
    issues.push({ severity: "high", message: "Database adapter unavailable" });
  }

  // ── Circuit breaker states ───────────────────────────────────────────────
  let breaker = { total: 0, cooldown: 0, exhausted: 0 };
  try {
    const { getSnapshot } = await import("@/lib/network/circuitBreaker.js");
    for (const s of getSnapshot()) {
      breaker.total += 1;
      if (s.state === "cooldown") breaker.cooldown += 1;
      if (s.state === "exhausted") breaker.exhausted += 1;
    }
  } catch {
    /* fail-open */
  }
  if (breaker.cooldown > 0) {
    issues.push({ severity: "medium", message: `${breaker.cooldown} circuit(s) in cooldown` });
  }

  // ── Pool geo freshness ───────────────────────────────────────────────────
  let poolGeo = { pools: 0, fresh: 0, stale: 0 };
  try {
    const { poolGeoSnapshot } = await import("@/lib/network/poolGeo.js");
    const snap = poolGeoSnapshot();
    poolGeo.pools = Object.keys(snap || {}).length;
    const now = Date.now();
    for (const g of Object.values(snap || {})) {
      if (g?.checkedAt && now - g.checkedAt < 60 * 60 * 1000) poolGeo.fresh += 1;
      else poolGeo.stale += 1;
    }
  } catch {
    /* fail-open */
  }

  // ── Settings-derived signals ─────────────────────────────────────────────
  try {
    const settings = await getSettings();
    const usingDefaultPassword = !settings.password; // no hash stored → INITIAL_PASSWORD path
    if (usingDefaultPassword) {
      issues.push({
        severity: "high",
        message: "Dashboard still uses the initial password — set one before remote access",
      });
    }
    if (settings.outboundProxyEnabled === true && !String(settings.outboundProxyUrl || "").trim()) {
      issues.push({ severity: "low", message: "Outbound proxy enabled with no URL (inherits env)" });
    }
    if (settings.headroomEnabled === true) {
      // The headroom sidecar is optional — flag when unreachable.
      try {
        const url = settings.headroomUrl || "http://localhost:8787";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        await fetch(url, { signal: controller.signal }).catch(() => {
          throw new Error();
        });
        clearTimeout(timer);
      } catch {
        issues.push({ severity: "low", message: "Headroom sidecar enabled but unreachable" });
      }
    }
  } catch {
    /* fail-open */
  }

  // ── Process ──────────────────────────────────────────────────────────────
  let memoryMb = null;
  try {
    memoryMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
  } catch {
    /* fail-open */
  }

  return NextResponse.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      health: { status: "ok", uptimeSeconds: uptimeSeconds(), memoryMb },
      database: { ...dbInfo, sizeLabel: fmtBytes(dbInfo.sizeBytes) },
      breaker,
      poolGeo,
      issues,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
