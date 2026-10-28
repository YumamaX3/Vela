// The capability preflight — refuse before a credit is spent.
//
// A request the account cannot serve has, until now, been discovered by sending it
// upstream and paying for the discovery. The reference gateway checks first; so do we.
//
// It is DEAD BY DEFAULT, and honestly so. The reference reads capability declarations
// from its own catalog, which Vela does not yet carry for these products. Inventing
// them here would refuse real requests on a guess — so `declarationsFor` answers null,
// the gate stays silent, and the upstream remains the judge until a real catalogue lands.
//
// Two laws bound this gate when it IS armed, because a strict door is a dead lane:
//
//   1. REFUSE ONLY WHAT CANNOT BE STRIPPED. If Vela's own strip seam would remove a
//      modality for the caller, the gate must stay silent — the strip is the answer,
//      and a refusal here would turn a working request into a dead one.
//
//   2. THE REFUSAL IS THE REQUEST'S FAULT, NEVER THE ACCOUNT'S. It is a plain 400
//      carrying no text any ERROR_RULES entry matches, so the classifier reads it as
//      request-scoped: the credential is not cooled and combo fallback still advances.

/**
 * The capability declaration for a provider, or null when none is known.
 *
 * This is the seam a future catalogue plugs into. Until it exists, the answer is
 * null — never a fabricated declaration.
 *
 * @param {string} _provider
 * @returns {{images?:boolean, tools?:boolean, reasoning?:boolean, maxOutputTokens?:number|null}|null}
 */
export function declarationsFor(_provider) {
  return null;
}

/** Effort values the upstream accepts, in the order the reference prefers them. */
export const SUPPORTED_EFFORTS = Object.freeze(["high", "medium", "low", "xhigh", "max", "minimal"]);

/**
 * What a request needs of the account, read from the body it actually carries.
 * Deliberately conservative: anything unclear is reported as not required, because
 * a false requirement refuses a request the upstream would have answered.
 *
 * @param {object} body
 * @returns {{images:boolean, tools:boolean, effort:string|null, maxOutput:number|null}}
 */
export function requirementsOf(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const images = messages.some((m) =>
    Array.isArray(m?.content) && m.content.some((p) => p && p.type === "image_url"),
  );
  const tools = (Array.isArray(body?.tools) && body.tools.length > 0)
    || messages.some((m) => m?.role === "tool" || (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0));
  const effortRaw = body?.reasoning_effort;
  const effort = typeof effortRaw === "string" && effortRaw.trim() ? effortRaw.trim() : null;
  const maxRaw = body?.max_tokens ?? body?.max_completion_tokens ?? body?.max_output_tokens;
  const maxOutput = typeof maxRaw === "number" && Number.isInteger(maxRaw) && maxRaw > 0 ? maxRaw : null;
  return { images, tools, effort, maxOutput };
}

/**
 * Decide whether the request may proceed.
 *
 * @param {object} body      the request as the client sent it
 * @param {string} model     the model id
 * @param {{images?:boolean, tools?:boolean, reasoning?:boolean, maxOutputTokens?:number|null}} [declared]
 *        what the account declares it can serve. ABSENT declarations are never a
 *        refusal — `unknown` is not `unsupported`, and the upstream remains the judge.
 * @returns {{code:string, message:string}|null}
 */
export function capabilityRefusal(body, model, declared = null) {
  if (!declared || typeof declared !== "object") return null;
  const needs = requirementsOf(body);

  if (needs.images && declared.images === false) {
    return {
      code: "unsupported_image_input",
      message: `codebuddy: model "${model}" cannot accept image input on this account`,
    };
  }

  if (needs.tools && declared.tools === false) {
    return {
      code: "unsupported_tool_call",
      message: `codebuddy: model "${model}" cannot accept tool calls on this account`,
    };
  }

  // A reasoning request is only refused when the account says reasoning is off AND
  // the ask is not the one value that means "do not reason".
  const asksForReasoning = needs.effort !== null && needs.effort !== "none" && needs.effort !== "off";
  if (asksForReasoning && declared.reasoning === false) {
    return {
      code: "unsupported_reasoning",
      message: `codebuddy: model "${model}" cannot reason on this account`,
    };
  }

  if (needs.maxOutput !== null && typeof declared.maxOutputTokens === "number"
      && needs.maxOutput > declared.maxOutputTokens) {
    return {
      code: "model_output_limit",
      message: `codebuddy: model "${model}" allows at most ${declared.maxOutputTokens} output tokens`,
    };
  }

  return null;
}
