// Muse (Meta Model API) — dual auth, same pattern as kimi:
//   oauth  = Muse Code subscription (Meta account device code, mints an LLM|… key)
//   apikey = pay-as-you-go Model API key from dev.meta.ai
// Transport is shared; oauth accounts get x-api-version via the museHeaders hook.
// Meta issues no refresh token for the subscription flow → re-login on 401.
//
// Multi-endpoint: Meta accepts Chat Completions and Responses wire formats on
// the same key. Muse Spark reasoning (incl. encrypted_content replay) only
// round-trips on Responses, so those models pin targetFormat there.
export default {
  id: "muse",
  alias: "muse",
  uiAlias: "muse",
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  priority: 120,
  display: {
    name: "Muse (Meta Model API)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MU",
    website: "https://muse.ai",
    notice: {
      text: "Sign in with your Meta account (Muse Code subscription) or paste a Model API key from dev.meta.ai. Subscription keys are minted per account; Meta may train on contributor-tier data.",
      apiKeyUrl: "https://dev.meta.ai",
      signupUrl: "https://muse.ai",
    },
  },
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    modelsUrl: "https://api.meta.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.meta.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
      // Strict Responses API: rejects top-level reasoning_effort, needs reasoning:{effort,summary}.
      thinkingFormat: "openai-responses",
    },
  ],
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  passthroughModels: true,
  oauth: {
    clientId: "1031625952748946",
    deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
    tokenUrl: "https://auth.meta.com/oidc/device/token/",
  },
};
