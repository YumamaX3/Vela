// v1m (System One) — calibrated decision engine. Fast probabilistic
// evaluations over state and questions, not a chat completion. Rides the
// /v1/systemone door Vela already serves.
export default {
  id: "v1m",
  alias: "v1m",
  uiAlias: "v1m",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 45,
  hasProviderSpecificData: true,
  display: {
    name: "v1m (System One)",
    icon: "psychology",
    color: "#6366F1",
    textIcon: "V1",
    website: "https://v1m.ir",
    notice: {
      text: "v1m System One calibrated decision engine. Fast probabilistic evaluations over state and questions.",
      apiKeyUrl: "https://v1m.ir",
    },
  },
  models: [
    { id: "rev-latest", name: "v1m Rev Latest (Calibrated)", kind: "systemone" },
    { id: "v1m-decision-engine", name: "v1m Decision Engine", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://v1m.ir/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
