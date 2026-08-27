// The AI Lab pipeline engine (W1 skeleton — behavior-neutral).
//
// Promotes the RTK layer from a loose pile of side-effect calls scattered
// through chatCore.js into an ordered registry of NAMED stages in declared
// bands:
//   SAVERS (compress/headroom/caveman/ponytail) → INJECTORS (settings-order,
//   then mode-bundle) → pxpipe (unchanged final pre-dispatch saver)
//   → [dispatch → upstream] → POLICY (response-path content inspection)
//
// W1 lands the skeleton + the injector band only. Later waves add the mode
// resolution (W2), the ACL filter at the hook (W3), and the response-path
// policy band (W4a). Every stage is fail-open: a throwing or disabled stage
// returns null and leaves the body untouched. The ONLY abort path is the
// policy-band `block` verdict (the declared exception, W4a).
//
// The engine returns an AppliedTrace consumed by the xf log accumulator, the
// x-vela-applied-injectors header, and usage tags (W3).

import { normalizeInjector, normalizeUserInjectors, renderInjection, triStateAllowed } from "./expansion.js";
import { injectSystemPrompt } from "./systemInject.js";

/** Capture the system text for change detection (same shapes systemInject touches). */
export function captureSystemText(body, format) {
  try {
    const target = body?.request && typeof body.request === "object" ? body.request : body;
    if (typeof body?.instructions === "string") return `instructions:${body.instructions}`;
    const arr = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : null;
    if (arr) {
      const sys = arr.find((m) => m && (m.role === "system" || m.role === "developer"));
      if (sys && typeof sys.content === "string") return `msg:${sys.content}`;
      if (sys && Array.isArray(sys.content)) return `arr:${sys.content.length}`;
    }
    if (typeof target?.system === "string") return `sys:${target.system}`;
    if (Array.isArray(target?.system)) return `sysArr:${target.system.length}`;
    const sysKey = Object.prototype.hasOwnProperty.call(target, "system_instruction") ? "system_instruction" : "systemInstruction";
    const sys = target?.[sysKey];
    if (sys && Array.isArray(sys.parts)) return `gem:${sys.parts.length}`;
  } catch { /* fail-open */ }
  return "";
}

/**
 * Apply a single rendered injection through the systemInject seam.
 * @returns {boolean} true if the system text actually changed.
 */
export function applyRendered(body, format, rendered, preImage) {
  if (!body || !rendered) return false;
  const before = preImage !== undefined ? preImage : captureSystemText(body, format);
  injectSystemPrompt(body, format, rendered.text, rendered.position);
  return captureSystemText(body, format) !== before;
}

/**
 * The injector band: settings-order injectors, then (W2+) mode-bundle injectors.
 * W1 shape — settings-order only, byte-identical to the old applyUserInjectors.
 *
 * Applied-count semantics (S5): captureSystemText is computed ONCE before the
 * band (2N→1 walks) and compared after; appliedDistinct counts DISTINCT
 * rendered texts (two injectors rendering identical text count once).
 *
 * W3 — the DECISIVE ACL seam: `acl.allowedInjectors` (tri-state from the
 * resolved key) gates each injector by id/name BEFORE rendering. No UI-only
 * path exists: the dashboard toggles an allowlist, the ENGINE refuses. Denied
 * injectors are skipped with a bounded DEBUG log (never a request failure).
 *
 * @returns {{ applied, appliedDistinct, names: string[], denials: {name, reason}[] }}
 */
export function runInjectorBand(body, format, { injectors = [], modeInjectors = [], kind = "llm", log = null, ctx = null, varAllowlist, acl = null } = {}) {
  const applied = [];
  const denials = [];
  const seen = new Set();
  const list = [...injectors, ...(Array.isArray(modeInjectors) ? modeInjectors : [])];
  if (!body || list.length === 0) return { applied: 0, appliedDistinct: 0, names: [], denials: [] };

  const base = { ...(ctx || {}), kind };
  const preImage = captureSystemText(body, format);
  for (const raw of list) {
    const inj = normalizeInjector(raw);
    if (!inj || !inj.enabled) continue;
    if (inj.applyTo !== "*" && inj.applyTo !== kind) continue;
    // W3: tri-state ACL at the hook — the seam refuses, not the dashboard.
    if (acl?.allowedInjectors != null) {
      const keyed = inj.id || inj.name;
      if (!triStateAllowed(acl.allowedInjectors, keyed)) {
        denials.push({ name: inj.name, reason: "acl-denied" });
        log?.debug?.("INJECT", `skipped ${inj.name}: acl-denied`);
        continue;
      }
    }
    const rendered = renderInjection(raw, base, { varAllowlist });
    if (!rendered) continue;
    if (applyRendered(body, format, rendered, preImage)) {
      applied.push(rendered);
      if (!seen.has(rendered.text)) seen.add(rendered.text);
      log?.info?.("INJECT", `${inj.name} (${inj.position})${/\{\{/.test(rendered.text) ? " [unresolved vars]" : ""}`);
    }
  }
  return { applied: applied.length, appliedDistinct: seen.size, names: applied.map((r) => r.name), denials };
}

/**
 * The W1 pipeline entry: runs the injector band. Later waves extend this into
 * the full SAVERS → INJECTORS → [dispatch] → POLICY registry.
 * @returns {{ body, trace: { applied, appliedDistinct, names } }}
 */
export function runRtkPipeline(body, format, opts = {}) {
  const trace = runInjectorBand(body, format, opts);
  return { body, trace };
}

// Back-compat shim: the legacy entry point — normalized + applied exactly as
// v0.9.23 behaved (delegates to the pipeline; never runs alongside it).
export function applyUserInjectorsLegacy(body, format, { injectors = [], kind = "llm", log = null, ctx = null } = {}) {
  const { trace } = runRtkPipeline(body, format, { injectors, kind, log, ctx });
  return trace.applied;
}

export const __test__ = { normalizeUserInjectors, normalizeInjector };
