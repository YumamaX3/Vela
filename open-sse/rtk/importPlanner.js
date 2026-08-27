// Pure AI Lab import planner (W6) — shared by POST /api/lab/import AND the
// lab-import-export locking suite, so the route can never drift from the
// tested contract. Zero db/log deps; the route persists the plan.
//
// Security covenant (K1): imported prompts are UNTRUSTED instruction
// material — every imported injector/mode/policy arrives `enabled:false`;
// the operator reviews, then enables. Caps: prompt ≤16KB, name ≤64 chars.
// Collisions get a " (2)" suffix, never an overwrite. injectorRefs re-bind
// by exported-id map, falling back to name match with a warning (S5).

const NAME_MAX = 64;
const PROMPT_MAX = 16384;
const SUPPORTED_SCHEMA = 1;

export function validateImportPayload(body) {
  if (!body || typeof body !== "object") throw new Error("invalid import payload");
  if (body.schemaVersion !== SUPPORTED_SCHEMA) {
    throw new Error(`unsupported schemaVersion ${body.schemaVersion} (expected ${SUPPORTED_SCHEMA})`);
  }
}

/**
 * Plan an import against current state. Pure — returns the next collections
 * and a diff report { added, renamed, rejected, warnings }.
 */
export function planImport(body, current = {}) {
  validateImportPayload(body);

  const injectors = Array.isArray(body.injectors) ? body.injectors : [];
  const modes = Array.isArray(body.modes) ? body.modes : [];
  const policies = Array.isArray(body.contentPolicies) ? body.contentPolicies : [];

  const curInjectors = Array.isArray(current.userInjectors) ? current.userInjectors : [];
  const curModes = Array.isArray(current.modeBundles) ? current.modeBundles : [];
  const curPolicies = Array.isArray(current.contentPolicies) ? current.contentPolicies : [];

  const report = { added: 0, renamed: 0, rejected: 0, warnings: [] };

  // Injectors: validate + cap + collision-rename + DISABLED-on-arrival.
  const knownNames = new Set(curInjectors.map((i) => i?.name).filter(Boolean));
  const nextInjectors = [...curInjectors];
  for (const raw of injectors) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const prompt = typeof raw?.prompt === "string" ? raw.prompt.trim() : "";
    if (!name || !prompt) { report.rejected++; continue; }
    if (name.length > NAME_MAX || prompt.length > PROMPT_MAX) { report.rejected++; continue; }
    let finalName = name;
    if (knownNames.has(finalName)) {
      finalName = `${name} (2)`;
      report.renamed++;
      report.warnings.push(`injector "${name}" renamed → "${finalName}" (collision)`);
    }
    knownNames.add(finalName);
    nextInjectors.push({
      id: raw.id && typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
      name: finalName,
      prompt,
      position: raw.position === "prepend" ? "prepend" : "append",
      applyTo: raw.applyTo === "*" ? "*" : "llm",
      enabled: false, // K1 — arrive disabled, operator enables
      source: "imported",
      variables: raw.variables && typeof raw.variables === "object" ? raw.variables : undefined,
    });
    report.added++;
  }

  // Modes: injectorRefs re-bind by exported-id map → name match fallback.
  const nextModes = [...curModes];
  for (const raw of modes) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > NAME_MAX) { report.rejected++; continue; }
    const refs = Array.isArray(raw.injectorRefs) ? raw.injectorRefs : [];
    const rebound = refs.map((r) => {
      if (!r || typeof r !== "object") return null;
      const match = nextInjectors.find((i) => i.id === r.id);
      if (match) return { id: match.id, modelGlob: r.modelGlob || null };
      const byName = nextInjectors.find((i) => i.name === (r.name || r.id));
      if (byName) {
        report.warnings.push(`mode "${name}" ref re-bound by name (${r.id || r.name} → ${byName.name})`);
        return { id: byName.id, modelGlob: r.modelGlob || null };
      }
      report.warnings.push(`mode "${name}" ref dropped (${r.id || r.name} not found)`);
      return null;
    }).filter(Boolean);
    nextModes.push({
      id: raw.id && typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
      name,
      injectorRefs: rebound,
      saverToggles: raw.saverToggles && typeof raw.saverToggles === "object" ? raw.saverToggles : {},
      contentPolicyProfileId: raw.contentPolicyProfileId || null,
      enabled: false, // arrive disabled
    });
    report.added++;
  }

  // Policies: validated shapes, disabled-on-arrival.
  const nextPolicies = [...curPolicies];
  for (const raw of policies) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const action = ["flag", "redact", "block"].includes(raw?.action) ? raw.action : null;
    const patterns = Array.isArray(raw?.patterns) ? raw.patterns.filter((p) => typeof p === "string" && p.length <= 256) : [];
    if (!name || name.length > NAME_MAX || !action || patterns.length === 0) { report.rejected++; continue; }
    nextPolicies.push({
      id: raw.id && typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
      name,
      action,
      patterns,
      enabled: false, // arrive disabled
    });
    report.added++;
  }

  return {
    injectors: nextInjectors,
    modes: nextModes,
    policies: nextPolicies,
    report,
  };
}

export const __test__ = { NAME_MAX, PROMPT_MAX, SUPPORTED_SCHEMA };
