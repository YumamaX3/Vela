import {
  KIRO_ALIASES,
  KIRO_UNION_ADDITIONS,
  KIRO_WIRE_ENUM,
  kiroUpstreamModelIdFor as KIRO_UPSTREAM_ID_FOR,
  kiroUnionVariantIds as KIRO_UNION_VARIANT_IDS,
  kiroUnionDisplayName as KIRO_UNION_DISPLAY_NAMES,
} from "./kiroModelAliases.js";

// Dated Anthropic ids ride `auto` — see the union block below.
const KIRO_UNION_UPSTREAM_ID = "auto";

export default {
  id: "kiro",
  priority: 10,
  alias: "kr",
  uiAlias: "kr",
  display: {
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    website: "https://kiro.dev",
    notice: {
      signupUrl: "https://kiro.dev",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    baseUrls: [
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    ],
    format: "kiro",
    retry: {
      "429": 0,
    },
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.amazon.eventstream",
      "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
      "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
    },
    tokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authUrl: "https://prod.us-east-1.auth.desktop.kiro.dev",
    usage: {
      cwHost: "https://codewhisperer.us-east-1.amazonaws.com",
      qHost: "https://q.us-east-1.amazonaws.com",
      limitsPath: "/getUsageLimits",
    },
  },
  models: [
    // Opus (added per kiro.dev/changelog/models and kiro.dev/docs/models)
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5-thinking", name: "Claude Opus 5 (Thinking)" },
    { id: "claude-opus-5-agentic", name: "Claude Opus 5 (Agentic)" },
    { id: "claude-opus-5-thinking-agentic", name: "Claude Opus 5 (Thinking + Agentic)" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.8-thinking", name: "Claude Opus 4.8 (Thinking)" },
    { id: "claude-opus-4.8-agentic", name: "Claude Opus 4.8 (Agentic)" },
    { id: "claude-opus-4.8-thinking-agentic", name: "Claude Opus 4.8 (Thinking + Agentic)" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.7-thinking", name: "Claude Opus 4.7 (Thinking)" },
    { id: "claude-opus-4.7-agentic", name: "Claude Opus 4.7 (Agentic)" },
    { id: "claude-opus-4.7-thinking-agentic", name: "Claude Opus 4.7 (Thinking + Agentic)" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-opus-4.5-thinking", name: "Claude Opus 4.5 (Thinking)" },
    { id: "claude-opus-4.5-agentic", name: "Claude Opus 4.5 (Agentic)" },
    { id: "claude-opus-4.5-thinking-agentic", name: "Claude Opus 4.5 (Thinking + Agentic)" },
    // Sonnet
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    // Haiku
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    // Non-Anthropic
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image","audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image","audio"] },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Thinking variants
    { id: "claude-sonnet-5-thinking", name: "Claude Sonnet 5 (Thinking)" },
    { id: "claude-sonnet-4.5-thinking", name: "Claude Sonnet 4.5 (Thinking)" },
    { id: "claude-haiku-4.5-thinking", name: "Claude Haiku 4.5 (Thinking)" },
    { id: "gpt-5.6-sol-thinking", name: "GPT 5.6 Sol (Thinking)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-thinking", name: "GPT 5.6 Terra (Thinking)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-thinking", name: "GPT 5.6 Luna (Thinking)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Agentic variants
    { id: "claude-sonnet-5-agentic", name: "Claude Sonnet 5 (Agentic)" },
    { id: "claude-sonnet-4.5-agentic", name: "Claude Sonnet 4.5 (Agentic)" },
    { id: "claude-haiku-4.5-agentic", name: "Claude Haiku 4.5 (Agentic)" },
    { id: "gpt-5.6-sol-agentic", name: "GPT 5.6 Sol (Agentic)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-agentic", name: "GPT 5.6 Terra (Agentic)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-agentic", name: "GPT 5.6 Luna (Agentic)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Thinking + Agentic variants
    { id: "claude-sonnet-5-thinking-agentic", name: "Claude Sonnet 5 (Thinking + Agentic)" },
    { id: "claude-sonnet-4.5-thinking-agentic", name: "Claude Sonnet 4.5 (Thinking + Agentic)" },
    { id: "claude-haiku-4.5-thinking-agentic", name: "Claude Haiku 4.5 (Thinking + Agentic)" },
    { id: "gpt-5.6-sol-thinking-agentic", name: "GPT 5.6 Sol (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-thinking-agentic", name: "GPT 5.6 Terra (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-thinking-agentic", name: "GPT 5.6 Luna (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // ── Union additions (M3 · C2) ──────────────────────────────────────────
    // The three ids the sealed plan adds to the union. None of them is in the
    // wire enum (KIRO_WIRE_ENUM), so they ride upstream as `auto`: the
    // control plane picks the concrete Anthropic model server-side. That is
    // why upstreamModelId is `auto` rather than the dated public id — sending a
    // dated id the enum never evidenced is exactly the extrapolation the law
    // forbids. The four synthetic variants come from kiroUnionVariantIds().
    ...KIRO_UNION_ADDITIONS.flatMap((baseId) => KIRO_UNION_VARIANT_IDS(baseId)).map((id) => {
      const base = id.replace(/-(thinking-agentic|thinking|agentic)$/, "");
      const variant = id.slice(base.length);
      const label = variant === "-thinking" ? " (Thinking)"
        : variant === "-agentic" ? " (Agentic)"
          : variant === "-thinking-agentic" ? " (Thinking + Agentic)"
            : "";
      return {
        id,
        name: `${KIRO_UNION_DISPLAY_NAMES(base) || base}${label}`,
        // The union ids have no enum id; their wire id is `auto` (see above).
        // kiroUpstreamModelIdFor() would keep the dated id verbatim, which is
        // exactly the guess the law forbids — so `auto` is stated, not derived.
        upstreamModelId: KIRO_UPSTREAM_ID_FOR(id) || KIRO_UNION_UPSTREAM_ID,
        description: `Anthropic dated id — rides the Kiro control plane's auto routing (enum has no CLAUDE id for it)`,
      };
    }),
  ],
  // Public-spelling aliases (M3 · C2) — resolved in kiroModelAliases.js BEFORE
  // any `-thinking` / `-agentic` suffix is stripped.
  modelAliases: KIRO_ALIASES,
  // Enum data (M3 · C1) — read straight off this entry by the control-plane
  // client, so the alias/enum table can be co-located with the roster WITHOUT
  // being mistaken for a provider file on disk (the census pins that).
  wireEnum: KIRO_WIRE_ENUM,
  unionAdditions: KIRO_UNION_ADDITIONS,
  oauth: {
    ssoOidcEndpoint: "https://oidc.us-east-1.amazonaws.com",
    registerClientUrl: "https://oidc.us-east-1.amazonaws.com/client/register",
    deviceAuthUrl: "https://oidc.us-east-1.amazonaws.com/device_authorization",
    tokenUrl: "https://oidc.us-east-1.amazonaws.com/token",
    startUrl: "https://view.awsapps.com/start",
    clientName: "kiro-oauth-client",
    clientType: "public",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
    ],
    grantTypes: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
    issuerUrl: "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
    socialAuthEndpoint: "https://prod.us-east-1.auth.desktop.kiro.dev",
    socialLoginUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/login",
    socialTokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
    socialRefreshUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authMethods: [
      "builder-id",
      "idc",
      "google",
      "github",
      "import",
    ],
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
