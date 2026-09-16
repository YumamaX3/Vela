// Pure helpers for the codex-settings route, in their own module: a
// "use server" file may only export async Server Actions, so the synchronous
// config redactor lives here where route.js can import it and the unit test
// can assert it without importing a server boundary at all. (ADR-004 M2)

// Redact the provider's Authorization header from the config text returned to
// the dashboard. Since the M2 key move the API key lives in config.toml's
// [model_providers.Vela.http_headers] (Codex reads the FILE), so GET — which
// echoes the config for the card to parse base_url/model — must not hand the
// bearer token to the browser. The card only needs base_url/model/subagent;
// the secret stays on disk. confbox serializes http_headers as a DEDICATED
// sub-table ([model_providers.Vela.http_headers] then Authorization = "..."),
// which is the primary shape; the inline form and single quotes are covered
// too (probed against stringifyTOML output, not assumed).
export const redactConfigSecrets = (text) => {
  if (typeof text !== "string") return text;
  return text
    // dedicated-table AND inline forms: any Authorization key/value pair
    .replace(/(Authorization\s*=\s*)"([^"]*)"/g, '$1"Bearer <redacted>"')
    .replace(/(Authorization\s*=\s*)'([^']*)'/g, "$1'Bearer <redacted>'")
    // a bearer token typed without a key name (defensive; not confbox's shape)
    .replace(/Bearer\s+["']?[A-Za-z0-9._~+\/-]{12,}["']?/g, 'Bearer <redacted>')
    // basic auth in a URL just in case: user:pass@
    .replace(/(:\/\/)([^/@\s"']+):([^/@\s"']+)@/g, '$1$2:<redacted>@');
};
