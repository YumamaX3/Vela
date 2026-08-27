// User-defined prompt injectors — operator-configured named prompts appended
// (or prepended) to the system message of the final request body, just before
// dispatch — riding the same injectSystemPrompt seam as caveman/ponytail.
//
// AI Lab W1: this file is now a THIN DELEGATION WRAPPER over the pipeline's
// injector band (open-sse/rtk/pipeline.js) and the pure expansion module
// (open-sse/rtk/expansion.js). The public surface — applyUserInjectors,
// normalizeUserInjectors, __test__ — is preserved byte-for-byte so the 20
// locking assertions across tests/unit/user-injectors*.test.js keep exercising
// the real production path.
//
// Settings shape (settings.userInjectors):
//   [ { id?, name, enabled, prompt, position: "append"|"prepend",
//       applyTo: "llm"|"*", variables?: {} } ]
// Fail-open: missing/malformed entries are skipped, never break the request.

import { normalizeUserInjectors, normalizeInjector as normalizeInjectorShim, renderInjection } from "./expansion.js";
import { captureSystemText, applyRendered } from "./pipeline.js";
import { injectSystemPrompt } from "./systemInject.js";

/**
 * Apply user injectors to the final body. Returns the number applied.
 * Delegates to the pipeline's injector-band logic; the return contract
 * (applied count) is unchanged from v0.9.23.
 */
export function applyUserInjectors(body, format, { injectors = [], kind = "llm", log = null, ctx = null } = {}) {
  if (!body || !Array.isArray(injectors) || injectors.length === 0) return 0;
  let applied = 0;
  const base = { ...(ctx || {}), kind };
  const preImage = captureSystemText(body, format);
  for (const raw of injectors) {
    const inj = normalizeInjectorShim(raw);
    if (!inj || !inj.enabled) continue;
    if (inj.applyTo !== "*" && inj.applyTo !== kind) continue;
    const rendered = renderInjection(raw, base);
    if (!rendered) continue;
    if (applyRendered(body, format, rendered, preImage)) {
      applied += 1;
      log?.info?.("INJECT", `${inj.name} (${inj.position})${/\{\{/.test(rendered.text) ? " [unresolved vars]" : ""}`);
    }
  }
  return applied;
}

export { normalizeUserInjectors };
export const __test__ = { normalizeInjector: normalizeInjectorShim };
export { injectSystemPrompt };
