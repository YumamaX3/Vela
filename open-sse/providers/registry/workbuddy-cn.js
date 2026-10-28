// WorkBuddy (China) — the WorkBuddy product, domestic shore.
// Same credential SHAPE and the same model catalog as its CodeBuddy sibling, but a
// DIFFERENT account: a CodeBuddy token is not a WorkBuddy token, and the two are not
// interchangeable. Routing between the four products lives in
// open-sse/shared/codebuddy/siteRouting.js, which derives the profile from the
// credential's own domain and JWT issuer — never from an input URL.
//
// The chat door is identical in path (/v2/chat/completions) across all four products
// and differs only in host; that was measured against the reference gateway, not assumed.
export default {
  id: "workbuddy-cn",
  alias: "cbw",
  uiAlias: "cbw",
  hidden: false,
  priority: 91,
  display: {
    name: "WorkBuddy (China)",
    icon: "groups",
    color: "#0EA5E9",
    website: "https://www.workbuddy.cn",
    notice: {
      signupUrl: "https://www.workbuddy.cn",
      text: "WorkBuddy shares CodeBuddy's catalog and wire shape but keeps its own account pool. Sign in with a WorkBuddy account.",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.workbuddy.cn/v2/chat/completions",
    forceStream: true,
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "WorkBuddy/5.9.2 WorkBuddy/5.9.2 CLI/2.165.0",
      "X-Product": "SaaS",
      "X-IDE-Type": "WorkBuddy",
      "X-IDE-Name": "WorkBuddy",
      "X-IDE-Version": "5.9.2",
      "X-Private-Data": "true",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
    usage: { url: "https://www.workbuddy.cn/v2/billing/meter/get-user-resource" },
  },
  // The catalog is the SAME list the CodeBuddy lanes expose — one backend, one lineup.
  // The login door. Without this block `hasOAuth: true` would render a button wired
  // to undefined — every field below is the reference's own value, and `platform`
  // is the one that differs from CodeBuddy: BOTH WorkBuddy sites send lowercase
  // "workbuddy", where CodeBuddy's international site requires uppercase "CLI".
  oauth: {
    baseUrl: "https://www.workbuddy.cn",
    stateUrl: "https://www.workbuddy.cn/v2/plugin/auth/state",
    tokenUrl: "https://www.workbuddy.cn/v2/plugin/auth/token",
    refreshUrl: "https://www.workbuddy.cn/v2/plugin/auth/token/refresh",
    userAgent: "WorkBuddy/5.9.2 WorkBuddy/5.9.2 CLI/2.165.0",
    platform: "workbuddy",
    pollInterval: 5000,
  },
  models: [
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "hy3-preview", name: "Hy3 Preview" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    // deepseek-v4-flash replaced server-side by deepseek-v4.1-flash (same
    // catalog as CN; the old endpoint still answers 200 but the list is the contract).
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
  ],
  serviceKinds: ["llm"],
};
