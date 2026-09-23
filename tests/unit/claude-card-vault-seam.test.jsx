// @vitest-environment happy-dom
/**
 * The Claude card's vault seam — the import the v0.9.71 port carried out while
 * leaving four calls behind (v0.9.91).
 *
 * WHY THIS SUITE EXISTS: `ClaudeToolCard.js` called `parseKeyId` / `storeKey`
 * (in the init effect) and `resolveKeyRef` (twice: `handleApplySettings` and
 * `getManualConfigs`). The Far Current port that reshaped this card deleted the
 * `import { resolveKeyRef, parseKeyId, storeKey } from "@/shared/utils/keyVault"`
 * line and kept every call — one of them NOT behind a button: `configs={getManualConfigs()}`
 * evaluates during render, so the room died on mount with
 *   `Runtime ReferenceError: resolveKeyRef is not defined`
 * and could never open at all. Every instrument the house owns was green: a bare
 * identifier is a parse success and a runtime failure, so `npm run build`
 * compiled, and NO TEST HAD EVER RENDERED THIS CARD — the fifth instance of one
 * class (a name declared and never resolvable) across four releases.
 *
 * This suite renders the card the way the room does and asserts the words an
 * operator actually receives in the manual config. It is deliberately narrow:
 * the seam and the round trip, not the styling or the room.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The card's chrome is not what this suite is about; the vault seam is. Light
// stand-ins keep the card's OWN body running (which is where the wound lived)
// without dragging the whole component library in. ManualConfigModal records the
// props it was handed — that is where the resolved bearer token surfaces.
const seen = { manualConfig: null };
vi.mock("@/shared/components", () => ({
  Card: ({ children }) => children ?? null,
  Button: ({ children, ...rest }) => (children ?? null),
  ModelSelectModal: () => null,
  Tooltip: ({ children }) => children ?? null,
  ManualConfigModal: (props) => {
    seen.manualConfig = props;
    return null;
  },
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/i18n/runtime", () => ({ translate: (s) => s }));

import ClaudeToolCard from "@/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard";

// A real Vela key shape: `vela-v1-{keyId}-{crc}`, keyId 128-bit hex — the exact
// shape `parseKeyId` reads its identity from (src/shared/utils/apiKey.js).
const KEY_ID = "0123456789abcdef0123456789abcdef";
const FULL_KEY = `vela-v1-${KEY_ID}-deadbeef`;

const TOOL = {
  name: "Claude Code",
  description: "Anthropic's CLI",
  defaultModels: [
    { alias: "opus", name: "Opus", envKey: "ANTHROPIC_MODEL", defaultValue: "" },
  ],
};

const mounted = [];

/** The minimum Web Storage surface the vault touches, held in memory. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function render(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ClaudeToolCard
        tool={TOOL}
        isExpanded
        onToggle={() => {}}
        activeProviders={[]}
        modelMappings={{}}
        onModelMappingChange={() => {}}
        baseUrl="http://localhost:32060"
        hasActiveProviders={false}
        apiKeys={[{ id: KEY_ID, keyPrefix: "vela-v1-0123456789ab…" }]}
        cloudEnabled={false}
        initialStatus={null}
        tunnelEnabled={false}
        tunnelPublicUrl={null}
        tailscaleEnabled={false}
        tailscaleUrl={null}
        {...props}
      />
    );
  });
  mounted.push({ container, root });
}

/** The manual config's `~/.claude/settings.json` env, as the operator receives it. */
function manualEnv() {
  const cfg = seen.manualConfig?.configs?.[0];
  expect(cfg, "the card must hand ManualConfigModal a config").toBeTruthy();
  return JSON.parse(cfg.content).env;
}

beforeEach(() => {
  seen.manualConfig = null;
  // An explicit in-memory store: this environment hands the bare `localStorage`
  // global to Node's experimental implementation (which the runner opens with a
  // stray `--localstorage-file` and which does not answer `clear`), while the
  // vault reads whichever object the global holds. Binding our own removes the
  // ambiguity instead of depending on which one wins.
  vi.stubGlobal("localStorage", memoryStorage());
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  while (mounted.length) {
    const { container, root } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("ClaudeToolCard — the vault seam", () => {
  it("mounts and renders without a ReferenceError", () => {
    expect(() => render()).not.toThrow();
  });

  it("captures the on-disk key into the vault and hands back the FULL key, not the keyId", () => {
    // The init effect reads ANTHROPIC_AUTH_TOKEN from the CLI's own settings,
    // parses the keyId out of it, captures the whole key, and selects by id.
    // The manual config must then resolve that id BACK to the full key — the
    // round trip the port severed.
    render({
      initialStatus: {
        installed: true,
        settings: { env: { ANTHROPIC_AUTH_TOKEN: FULL_KEY, ANTHROPIC_BASE_URL: "http://localhost:32060/v1" } },
      },
    });

    expect(manualEnv().ANTHROPIC_AUTH_TOKEN).toBe(FULL_KEY);
  });

  it("falls back to the placeholder when this device holds no key for the id", () => {
    // Nothing captured in the vault: resolveKeyRef must answer null (never the
    // bare keyId), and the card must tell the operator to fetch the real key
    // from the dashboard rather than writing a config that cannot authenticate.
    render({
      initialStatus: { installed: true, settings: { env: { ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_BASE_URL: "http://localhost:32060/v1" } } },
    });

    expect(manualEnv().ANTHROPIC_AUTH_TOKEN).toBe("<API_KEY_FROM_DASHBOARD>");
  });
});
