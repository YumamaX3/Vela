// Pure prompt-expansion module (AI Lab W1 — shared by the engine at dispatch
// AND the dashboard preview endpoint, so "preview is truth" is structural).
//
// Zero db/log dependencies: every function here is a pure transform over plain
// inputs, importable from the gateway hot path and the app layer alike. The
// client-side previewPrompt() regex in prompt-injectors/page.js is DELETED in
// W5 — this module is the single renderer.

const VALID_POSITIONS = new Set(["append", "prepend"]);

/** Normalize one injector entry. Missing/empty name+prompt → null (fail-open). */
export function normalizeInjector(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : null;
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : null;
  if (!name || !prompt) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : null,
    name,
    prompt,
    enabled: raw.enabled !== false,
    position: VALID_POSITIONS.has(raw.position) ? raw.position : "append",
    applyTo: raw.applyTo === "*" ? "*" : "llm",
    // v2: operator custom variables — { name: defaultValue }, overridable
    // per-request via x-vela-inject-var-<name> headers (governed by the key's
    // injectVarAllowlist from W3). Kept as-is; the engine ignores unknowns.
    variables: raw.variables && typeof raw.variables === "object" ? raw.variables : undefined,
  };
}

/** Normalize an operator-supplied injector list. Always returns an array. */
export function normalizeUserInjectors(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeInjector).filter(Boolean);
}

/**
 * Build the variable map for an injector. Built-ins come from ctx; operator
 * custom variables (injector.variables) can be overridden per-request via
 * `x-vela-inject-var-<name>` headers (ctx.headers, case-insensitive).
 *
 * W3: when ctx.varAllowlist is present, header overrides are honored ONLY for
 * names in the allowlist ([] = deny all; null/absent = today's behavior).
 */
export function buildVarMap(injector, ctx = {}, { varAllowlist } = {}) {
  const map = {
    date: ctx.date || new Date().toISOString().slice(0, 10),
    time: ctx.time || new Date().toISOString().slice(11, 19),
    model: ctx.model != null ? String(ctx.model) : "",
    kind: ctx.kind || "llm",
    keyPrefix: ctx.keyPrefix != null ? String(ctx.keyPrefix) : "",
    requestId: ctx.requestId != null ? String(ctx.requestId) : "",
    userAgent: ctx.userAgent != null ? String(ctx.userAgent) : "",
  };
  // Operator custom variables (injector.variables = { name: defaultValue }).
  const custom = injector.variables && typeof injector.variables === "object" ? injector.variables : {};
  for (const [k, v] of Object.entries(custom)) {
    map[k] = v != null ? String(v) : "";
  }
  // Per-request overrides via headers: x-vela-inject-var-<name>.
  const headers = ctx.headers && typeof ctx.headers.forEach === "function" ? ctx.headers : null;
  if (headers && allowOverride(varAllowlist)) {
    headers.forEach((value, key) => {
      const lower = String(key).toLowerCase();
      const m = lower.match(/^x-vela-inject-var-(.+)$/);
      if (m && isAllowedVar(m[1], varAllowlist)) map[m[1]] = String(value);
    });
  }
  return map;
}

function allowOverride(allowlist) {
  // null/undefined = all overrides allowed (back-compat, tri-state NULL = all);
  // [] = deny all; [names] = named allowlist; ["*"] = all.
  return allowlist === null || allowlist === undefined || allowlist === "*" ||
    (Array.isArray(allowlist) && allowlist.length > 0);
}

function isAllowedVar(name, allowlist) {
  if (allowlist === null || allowlist === undefined || allowlist === "*") return true;
  if (!Array.isArray(allowlist)) return false;
  return allowlist.includes(name);
}

/** Expand {{token}} placeholders in a prompt string against a var map. */
export function expandVars(str, vars) {
  return String(str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : `{{${name}}}`;
  });
}

/**
 * Render one injector's prompt against ctx, honoring the per-key var allowlist.
 * Returns { name, position, text, resolved } — or null if the entry is skipped.
 */
export function renderInjection(injector, ctx = {}, { varAllowlist } = {}) {
  const inj = normalizeInjector(injector);
  if (!inj || !inj.enabled) return null;
  const vars = buildVarMap(inj, { ...(ctx || {}), kind: ctx.kind || "llm" }, { varAllowlist });
  const text = expandVars(inj.prompt, vars);
  return { name: inj.name, position: inj.position, text, id: inj.id };
}

/**
 * Expand a list of injectors into rendered injections, in order.
 * Applied-count is hardened per DISTINCT rendered text (two injectors rendering
 * identical text count once — the S5 semantics).
 * @returns { rendered: [{name, position, text, id}], appliedDistinct: number }
 */
export function expandInjections(list, ctx = {}, { varAllowlist } = {}) {
  const rendered = [];
  const seen = new Set();
  for (const raw of list) {
    const inj = renderInjection(raw, ctx, { varAllowlist });
    if (!inj) continue;
    rendered.push(inj);
    seen.add(inj.text);
  }
  return { rendered, appliedDistinct: seen.size };
}

/**
 * Resolve the active mode bundle (AI Lab W2 — S1 semantics).
 * Precedence: x-vela-mode header → key defaultMode → none.
 * Returns { mode: bundle|null, resolved: name|null }.
 * - Unknown mode name → { unknown: name } so the gate can 400 explicitly
 *   (explicit client intent must not silently no-op).
 * - ACL denial is handled by keyGate.modeStage (pre-dispatch) + the W3
 *   tri-state filter inside the injector stage.
 */
export function resolveMode(modeBundles, { headerMode = null, keyDefaultMode = null } = {}) {
  const list = Array.isArray(modeBundles) ? modeBundles : [];
  const requested = headerMode || keyDefaultMode;
  if (!requested) return { mode: null, resolved: null };
  const match = list.find((m) => m && (m.id === requested || m.name === requested));
  if (!match) return { mode: null, resolved: null, unknown: requested };
  if (match.enabled === false) return { mode: null, resolved: null, unknown: requested };
  return { mode: match, resolved: requested };
}

/**
 * Expand a mode bundle's injectorRefs into concrete injector entries.
 * Refs are { id, modelGlob? } — a non-null modelGlob applies only when the
 * dispatched model matches (target-scoped attachment, W4b). Entries whose id
 * is missing from the injector list are skipped (log-report, never broken).
 * @returns { injectors: [...], skips: [{id, reason}] }
 */
export function expandModeRefs(mode, injectors, { model = null } = {}) {
  const byId = new Map();
  for (const inj of Array.isArray(injectors) ? injectors : []) {
    const norm = normalizeInjector(inj);
    if (norm && norm.id) byId.set(norm.id, norm);
  }
  const out = [];
  const skips = [];
  for (const ref of Array.isArray(mode?.injectorRefs) ? mode.injectorRefs : []) {
    if (!ref || typeof ref !== "object") { skips.push({ id: null, reason: "malformed-ref" }); continue; }
    const glob = ref.modelGlob;
    if (glob && model && !globMatch(glob, model)) { skips.push({ id: ref.id, reason: "model-glob" }); continue; }
    const entry = byId.get(ref.id);
    if (!entry) { skips.push({ id: ref.id, reason: "missing-injector" }); continue; }
    out.push(entry);
  }
  return { injectors: out, skips };
}

/** PATTERN_PRICING-style glob match: "grok-web", "freebuff/*", "*". */
export function globMatch(glob, model) {
  const g = String(glob || "");
  const m = String(model || "");
  if (g === "*" || g === "") return true;
  if (g.endsWith("/*")) {
    const prefix = g.slice(0, -1);
    return m.startsWith(prefix) || m.startsWith(prefix.slice(0, -1) + "/");
  }
  if (g.startsWith("*.")) return m.endsWith(g.slice(1));
  return m === g || m.endsWith(`/${g}`) || m.startsWith(`${g}/`);
}

/**
 * Tri-state check (mirrors keyGate.triStateAllowed — NULL=all, []=deny,
 * [names]=whitelist). Lives here so the pure expansion module can enforce
 * ACLs without importing the gate; keyGate remains the outer defense.
 */
export function triStateAllowed(allowlist, value) {
  if (allowlist == null) return true; // unrestricted
  if (!Array.isArray(allowlist)) return true; // malformed → fail-open
  if (allowlist.length === 0) return false; // [] = deny all
  return allowlist.includes(value);
}

export const triStateAllowedLocal = triStateAllowed;

export const __test__ = { isAllowedVar, allowOverride, globMatch };
