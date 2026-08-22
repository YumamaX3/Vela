// Shared system-prompt injector: appends (or prepends) an instruction into the
// system message of the final request body, dispatching by format so it works
// for translated and native-passthrough flows. Used by caveman.js, ponytail.js,
// and user-defined prompt injectors (v0.9.19).

import { FORMATS } from "../translator/formats.js";

const SEP = "\n\n";

export function injectSystemPrompt(body, format, prompt, position = "append") {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt, position);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt, position);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, prompt, position);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body, prompt, position = "append") {
  // OpenAI Responses API: top-level string field
  if (typeof body.instructions === "string") {
    body.instructions = position === "prepend" && body.instructions
      ? `${prompt}${SEP}${body.instructions}`
      : body.instructions
        ? `${body.instructions}${SEP}${prompt}`
        : prompt;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex(m => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt, position);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg, prompt, position = "append") {
  if (typeof msg.content === "string") {
    msg.content = position === "prepend"
      ? `${prompt}${SEP}${msg.content}`
      : `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // Responses-style array of parts {type:"input_text"|"text", text}
    position === "prepend"
      ? msg.content.unshift({ type: "input_text", text: prompt })
      : msg.content.push({ type: "input_text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt, position = "append") {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = position === "prepend"
      ? `${prompt}${SEP}${body.system}`
      : `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      position === "prepend"
        ? body.system.splice(lastCacheIdx, 0, block) // still inside the cached prefix
        : body.system.splice(lastCacheIdx, 0, block);
    } else {
      position === "prepend"
        ? body.system.unshift(block)
        : body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt, position = "append") {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    position === "prepend"
      ? sys.parts.unshift({ text: prompt })
      : sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
