// ADHD injector — same seam as caveman and ponytail, applied after both so
// the action-first contract is the model's last style instruction.
import { injectSystemPrompt } from "./systemInject.js";
import { getADHDPrompt } from "./adhdPrompt.js";

export function injectADHD(body, format, level) {
  injectSystemPrompt(body, format, getADHDPrompt(level));
}
