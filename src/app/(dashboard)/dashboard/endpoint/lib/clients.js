// Client catalog + snippet builders for the Endpoint room's Quick Connect.
//
// Every snippet here is copied from the shape the CLI Tools room already
// generates, so the two rooms can never disagree about how a client is wired:
//   · Claude Code — ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
//     (cli-tools/components/ClaudeToolCard.js:241)
//   · Cline       — openAiBaseUrl WITHOUT /v1 + openAiApiKey in secrets.json
//     (ClineToolCard.js:132,140,147)
//   · Codex       — [model_providers.Vela] with base_url ending /v1, wire_api
//     "responses", and the key in http_headers (CodexToolCard.js:169-179)
//   · Cursor / any OpenAI-compatible client — base_url ending /v1
//
// R-31: one reason for this file existing — the Endpoint room is where an
// operator first asks "how do I point my client here?", and answering it with
// the CLI Tools room's own conventions is the difference between a true
// snippet and a plausible one. Nothing here guesses at a config key.

/** Strip a trailing /v1 so Cline (which appends its own) is not doubled. */
export function withoutV1(base) {
  return base.endsWith("/v1") ? base.slice(0, -3) : base;
}

/** The canonical base every client expects: always ending in /v1. */
export function withV1(base) {
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export const CLIENTS = [
  { id: "claude-code", name: "Claude Code", icon: "terminal" },
  { id: "cursor", name: "Cursor", icon: "code" },
  { id: "cline", name: "Cline", icon: "smart_toy" },
  { id: "codex", name: "Codex CLI", icon: "data_object" },
  { id: "openai", name: "OpenAI SDK", icon: "api" },
];

/**
 * The paste-ready snippet for one client.
 * `key` may be null — when the operator has not stored a key in this browser's
 * vault we say so honestly rather than printing a convincing fake credential.
 */
export function snippetFor(clientId, base, key) {
  const v1 = withV1(base);
  const k = key || "<YOUR_API_KEY>";
  switch (clientId) {
    case "claude-code":
      return [
        "# Claude Code — settings.json env block",
        `ANTHROPIC_BASE_URL=${v1}`,
        `ANTHROPIC_AUTH_TOKEN=${k}`,
      ].join("\n");
    case "cursor":
      return [
        "# Cursor — Settings → Models → OpenAI API Key",
        "# Override Base URL:",
        v1,
        "# API Key:",
        k,
      ].join("\n");
    case "cline":
      return [
        "# ~/.cline/data/globalState.json",
        `{ "openAiBaseUrl": "${withoutV1(v1)}", "actModeApiProvider": "openai" }`,
        "# ~/.cline/data/secrets.json",
        `{ "openAiApiKey": "${k}" }`,
      ].join("\n");
    case "codex":
      return [
        "# ~/.codex/config.toml",
        'model_provider = "Vela"',
        "[model_providers.Vela]",
        'name = "Vela"',
        `base_url = "${v1}"`,
        'wire_api = "responses"',
        `http_headers = { Authorization = "Bearer ${k}" }`,
      ].join("\n");
    default:
      return [
        "# Any OpenAI-compatible client",
        `export OPENAI_BASE_URL="${v1}"`,
        `export OPENAI_API_KEY="${k}"`,
      ].join("\n");
  }
}
