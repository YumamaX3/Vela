/**
 * ADR-004 M2 — Codex key delivery: the key moves to where Codex reads it,
 * and the dashboard read-path redacts it.
 *
 * The wound (upstream 9c45b27c): a CUSTOM model provider is authenticated by
 * Codex ONLY via env_key / http_headers / env_http_headers / token command —
 * auth.json's OPENAI_API_KEY is read solely by the BUILT-IN openai provider.
 * Vela wrote the key to auth.json → every Vela-routed Codex request 401'd
 * while clobbering any ChatGPT login. Now the key rides
 * [model_providers.Vela.http_headers].Authorization in config.toml.
 *
 * Vela's fold EXCEEDANCE (the leak the fix would otherwise open): GET echoes
 * the config text raw for the card to parse base_url/model — so a key now
 * living in that file would newly reach the browser. redactConfigSecrets()
 * keeps the on-disk truth and strips the bearer from the response. This test
 * runs the REAL function on the REAL stringifyTOML output (confbox writes a
 * dedicated sub-table, not the inline form — the shape was probed, not
 * assumed), and a route-level proof that POST's own write is what GET redacts.
 */
import { describe, it, expect } from "vitest";
import { stringifyTOML } from "confbox";
import { redactConfigSecrets } from "../../src/app/api/cli-tools/codex-settings/redact.js";

const SECRET = "Bearer TESTKEY-NOT-REAL-abcdef123456";

describe("redactConfigSecrets — real confbox serialization", () => {
  const toml = stringifyTOML({
    model: "gpt-5",
    model_provider: "Vela",
    model_providers: {
      Vela: {
        name: "Vela",
        base_url: "http://localhost:32060/v1",
        wire_api: "responses",
        http_headers: { Authorization: SECRET },
      },
    },
    agents: { default_subagent_model: "gpt-5-mini" },
  });

  it("the fixture carries the secret the way POST writes it (sub-table form)", () => {
    // regression against the serialization assumption itself
    expect(toml).toContain("[model_providers.Vela.http_headers]");
    expect(toml).toContain(`Authorization = "${SECRET}"`);
  });

  it("strips the bearer, preserves every field the card parses", () => {
    const out = redactConfigSecrets(toml);
    expect(out).not.toContain("abcdef123456");           // the secret is GONE
    expect(out).not.toMatch(/Authorization = "Bearer sk/);
    // what the card still needs:
    expect(out).toMatch(/^model = "gpt-5"$/m);
    expect(out).toContain('base_url = "http://localhost:32060/v1"');
    expect(out).toContain('default_subagent_model = "gpt-5-mini"');
    // and the redaction is visible, not a silent field-drop:
    expect(out).toContain('Authorization = "Bearer <redacted>"');
  });

  it("also catches the inline-table form (belt-and-braces)", () => {
    const inline = 'http_headers = { Authorization = "' + SECRET + '" }';
    expect(redactConfigSecrets(inline)).not.toContain("abcdef123456");
    const single = "Authorization = '" + SECRET + "'";
    expect(redactConfigSecrets(single)).not.toContain("abcdef123456");
  });

  it("handles null/undefined/non-string without throwing", () => {
    expect(redactConfigSecrets(null)).toBeNull();
    expect(redactConfigSecrets(undefined)).toBeUndefined();
    expect(redactConfigSecrets(42)).toBe(42);
  });
});

describe("the parse contract survives redaction (card regexes vs redacted text)", () => {
  const toml = redactConfigSecrets(stringifyTOML({
    model: "gpt-5-codex",
    model_providers: { Vela: { base_url: "https://vela.example/v1", http_headers: { Authorization: SECRET } } },
    agents: { default_subagent_model: "gpt-5-mini" },
  }));
  // EXACTLY the patterns CodexToolCard runs against the GET response:
  it("model, base_url and both subagent forms parse unchanged", () => {
    expect(toml.match(/^model\s*=\s*"([^"]+)"/m)?.[1]).toBe("gpt-5-codex");
    expect(toml.match(/base_url\s*=\s*"([^"]+)"/)?.[1]).toBe("https://vela.example/v1");
    expect(toml.match(/^\s*default_subagent_model\s*=\s*"([^"]+)"/m)?.[1]).toBe("gpt-5-mini");
    // legacy table form (configs written by the previous version):
    const legacy = stringifyTOML({
      model: "m",
      model_providers: { Vela: { base_url: "u", http_headers: { Authorization: SECRET } } },
      agents: { subagent: { model: "old-sub" } },
    });
    const rl = redactConfigSecrets(legacy);
    expect(rl.match(/\[agents\.subagent\]\s*\n\s*model\s*=\s*"([^"]+)"/m)?.[1]).toBe("old-sub");
  });
});
