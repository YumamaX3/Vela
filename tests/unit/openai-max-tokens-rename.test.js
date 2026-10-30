// Current OpenAI models reject `max_tokens` with HTTP 400 ("Use
// 'max_completion_tokens' instead"), but the 4-series and the embedding / tts /
// stt / image lanes still take only `max_tokens`. The rename is therefore
// scoped to the modern families, not the whole provider.
import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/transformer/translator/concerns/paramSupport.js";

const run = (provider, model, body) => stripUnsupportedParams(provider, model, { ...body });

describe("openai max_tokens rename", () => {
  it("renames on the gpt-5 family", () => {
    for (const model of ["gpt-5.4", "gpt-5.4-mini", "gpt-5", "gpt-5-mini"]) {
      expect(run("openai", model, { max_tokens: 100 })).toEqual({ max_completion_tokens: 100 });
    }
  });

  it("renames on the o-series", () => {
    for (const model of ["o1", "o1-mini", "o3", "o3-pro", "o4-mini"]) {
      expect(run("openai", model, { max_tokens: 100 })).toEqual({ max_completion_tokens: 100 });
    }
  });

  it("keeps max_tokens on the 4-series and the non-chat lanes", () => {
    for (const model of ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4.1", "text-embedding-3-large", "tts-1", "whisper-1"]) {
      expect(run("openai", model, { max_tokens: 100 })).toEqual({ max_tokens: 100 });
    }
  });

  it("keeps an explicit max_completion_tokens the client already sent", () => {
    expect(run("openai", "gpt-5.4", { max_tokens: 100, max_completion_tokens: 55 }))
      .toEqual({ max_completion_tokens: 55 });
  });

  it("does not rename for other providers", () => {
    expect(run("github", "gpt-5.4", { max_tokens: 100 })).toEqual({ max_tokens: 100 });
  });
});
