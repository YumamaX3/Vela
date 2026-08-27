import { NextResponse } from "next/server";
import { sanitizeCategory } from "@/lib/localDb";
import { mintKey } from "@/lib/keys/mintService.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/keys/import — bulk-mint keys from a JSON array (or a CSV string
 * in `csv`). Every row converges on mintKey() (the single-writer chokepoint,
 * surface "import-mint"), so show-once reveal + the mutation ledger + the
 * reveal sink all behave exactly like single mints. Reveals are NOT returned
 * here — they ride the existing pending-reveals flow (the import modal shows
 * the count and points to the reveal collector).
 *
 * Row shape (JSON array):
 *   [{ name, description?, category?, rateLimitRpm?, tokenBudgetDaily?,
 *      spendCapDailyCents?, budgetScope?, expiresAt?, ipAllowlist? }]
 *
 * CSV columns (header row): name,description,category,rateLimitRpm,
 *   tokenBudgetDaily,spendCapDailyCents,budgetScope,expiresAt
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.keys) ? body.keys : Array.isArray(body) ? body : null;
    let rows = raw;
    if (!rows && typeof body.csv === "string" && body.csv.trim()) {
      rows = parseCsv(body.csv);
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Provide a JSON array in `keys` or a CSV string in `csv`" }, { status: 400 });
    }
    if (rows.length > 200) {
      return NextResponse.json({ error: "Import is limited to 200 keys per batch" }, { status: 400 });
    }

    const results = [];
    let okCount = 0;
    for (const r of rows) {
      const name = typeof r?.name === "string" ? r.name.trim() : "";
      if (!name) {
        results.push({ name: "", ok: false, error: "name is required" });
        continue;
      }

      const opts = {
        description: typeof r.description === "string" ? r.description.trim() || null : null,
        category: sanitizeCategorySafe(r.category),
        rateLimitRpm: intOrNull(r.rateLimitRpm),
        tokenBudgetDaily: intOrNull(r.tokenBudgetDaily),
        spendCapDailyCents: intOrNull(r.spendCapDailyCents),
        budgetScope: typeof r.budgetScope === "string" ? r.budgetScope : null,
        expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : null,
        ipAllowlist: Array.isArray(r.ipAllowlist) ? r.ipAllowlist : null,
      };

      try {
        const minted = await mintKey({ name, surface: "import-mint", actorClass: "dashboard", opts });
        if (minted.status === 201) {
          okCount += 1;
          results.push({ name, keyId: minted.envelope.keyId, keyPrefix: minted.envelope.keyPrefix, ok: true });
        } else {
          results.push({ name, ok: false, error: minted.detail || minted.error || "mint failed" });
        }
      } catch (e) {
        results.push({ name, ok: false, error: e?.message || "mint failed" });
      }
    }

    return NextResponse.json({
      summary: { total: rows.length, ok: okCount, failed: rows.length - okCount },
      results,
      revealNote: `${okCount} key(s) minted — the one-time secrets ride the pending-reveals flow (collect them in the Keys tab).`,
    }, { status: okCount === rows.length ? 201 : 200 });
  } catch (error) {
    console.error("[API] Failed to import keys:", error);
    return NextResponse.json({ error: "Failed to import keys" }, { status: 500 });
  }
}

function sanitizeCategorySafe(v) {
  try {
    return sanitizeCategory(v);
  } catch {
    return null;
  }
}

function intOrNull(v) {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    header.forEach((h, idx) => {
      if (cells[idx] !== undefined) row[h] = cells[idx];
    });
    out.push(row);
  }
  return out;
}

/** Minimal CSV line splitter — quoted fields with commas (no embedded newlines). */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
