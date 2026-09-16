export default {
  id: "clinepass",
  priority: 85,
  alias: "clinepass",
  uiAlias: "clinepass",
  display: {
    name: "ClinePass",
    icon: "vpn_key",
    color: "#5B9BD5",
    textIcon: "CP",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://app.cline.bot",
    },
  },
  category: "oauth",
  // ClinePass authenticates with a plain API key from app.cline.bot/settings/api-keys
  // (hence "apikey" first). The OAuth extension flow used by Cline does not issue
  // tokens the ClinePass API consumer endpoint accepts (HTTP 401) — upstream #2333.
  // (ported from upstream 9router f6e7cabe — ADR-004 M2)
  authModes: ["apikey", "oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    // Shares Cline's {"success":true,"data":{...}} non-stream envelope
    // (upstream 9router 122f23ee — ADR-004 M2)
    quirks: { clineEnvelope: true },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    { id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)" },
    { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code (ClinePass)" },
    { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6 (ClinePass)" },
    { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)" },
    { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash (ClinePass)" },
    { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5 (ClinePass)" },
    { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro (ClinePass)" },
    { id: "cline-pass/minimax-m3", name: "MiniMax M3 (ClinePass)" },
    { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max (ClinePass)" },
    { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};
