import { QODER_CN_CONFIG } from "../constants/oauth.js";
// Vela's qoder.js exports a READY provider (a plain object), not a factory —
// upstream's factory shape was never carried across. The CN lane reuses the
// same object and only swaps its config, so no factory is required here.
import qoderBase from "./qoder.js";

// Qoder CN (qoder.com.cn) — same device flow as intl Qoder, CN endpoints.
export default { ...qoderBase, config: QODER_CN_CONFIG };
