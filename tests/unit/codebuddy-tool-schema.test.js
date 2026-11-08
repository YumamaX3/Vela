// The tool-schema normalization battery — the ported law (codebuddy2api v1.5.4,
// app/upstream_compat.py normalize_tool_schemas) proven as vectors: empty roots,
// legacy field maps, RE2 underscore repair, and reference preservation.
import { describe, it, expect } from "vitest";
import { normalizeToolSchemas, __test__ } from "../../open-sse/shared/codebuddy/toolSchema.js";

const { normalizePattern, normalizeSchemaPatterns, parameterRoot } = __test__;

describe("parameterRoot", () => {
  it("wraps an empty root into an explicit object schema", () => {
    expect(parameterRoot({})).toEqual({ type: "object", properties: {} });
  });

  it("wraps a legacy field map (boolean required) into properties + required", () => {
    const out = parameterRoot({
      q: { type: "string", required: true },
      n: { type: "number", required: false },
    });
    expect(out).toEqual({
      type: "object",
      properties: { q: { type: "string" }, n: { type: "number" } },
      required: ["q"],
    });
  });

  it("refuses roots with $/x- extensions", () => {
    const root = { "x-foo": { type: "string", required: true } };
    expect(parameterRoot(root)).toBe(root);
  });

  it("refuses roots where some value is not a field object", () => {
    const root = { a: { type: "string", required: true }, b: "scalar" };
    expect(parameterRoot(root)).toBe(root);
  });

  it("wraps a mixed root — fields without a required key ride along (upstream gate default)", () => {
    expect(
      parameterRoot({
        a: { type: "string", required: true },
        b: { type: "string" },
      }),
    ).toEqual({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] });
  });

  it("refuses roots with no boolean required anywhere", () => {
    const root = { a: { type: "string" } };
    expect(parameterRoot(root)).toBe(root);
  });

  it("treats const/default values as never-fields, leaving the root untouched", () => {
    const root = { const: { required: true }, type: { required: true } };
    expect(parameterRoot(root)).toBe(root);
  });

  it("treats a schema-valued keyword holding a field shape as a field", () => {
    const out = parameterRoot({ items: { type: "string", required: true } });
    expect(out).toEqual({ type: "object", properties: { items: { type: "string" } }, required: ["items"] });
  });
});

describe("normalizePattern (RE2 underscore escapes)", () => {
  it("strips a lone backslash — the smallest match (2 chars incl. underscore) is even", () => {
    expect(normalizePattern("a\\_b")).toBe("a_b");
  });

  it("drops one backslash from a 3-backslash run — match length 4 is even", () => {
    // Upstream trims a run by parity (len % 2 == 0 → slice(1)): 3 backslashes → 2.
    expect(normalizePattern("a\\\\\\_b")).toBe("a\\\\_b");
  });

  it("normalizes patternProperties keys and merges collisions via allOf", () => {
    const schema = { patternProperties: { "a\\_": 1, "a_": 2 } };
    normalizeSchemaPatterns(schema);
    expect(schema.patternProperties.a_).toEqual({ allOf: [1, 2] });
  });

  it("recurses through schema maps, arrays, and children only", () => {
    const schema = {
      properties: { inner: { pattern: "x\\_y" } },
      anyOf: [{ pattern: "z\\_w" }],
      not: { pattern: "q\\_r" },
      description: "keep \\_ here untouched",
    };
    normalizeSchemaPatterns(schema);
    expect(schema.properties.inner.pattern).toBe("x_y");
    expect(schema.anyOf[0].pattern).toBe("z_w");
    expect(schema.not.pattern).toBe("q_r");
    expect(schema.description).toBe("keep \\_ here untouched");
  });
});

describe("normalizeToolSchemas", () => {
  it("wraps empty function parameter roots through the tools list", () => {
    const body = {
      tools: [{ type: "function", function: { name: "f", parameters: {} } }],
    };
    const out = normalizeToolSchemas(body);
    expect(out.tools[0].function.parameters).toEqual({ type: "object", properties: {} });
    expect(out.tools[0].type).toBe("function");
  });

  it("wraps legacy roots through the bare functions list (roots=true)", () => {
    const body = {
      functions: [{ name: "g", parameters: { q: { type: "string", required: true } } }],
    };
    const out = normalizeToolSchemas(body);
    expect(out.functions[0].parameters).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    });
  });

  it("repairs response_format patterns only when an underscore escape is present", () => {
    const dirty = {
      response_format: { json_schema: { schema: { pattern: "x\\_y" } } },
    };
    const fixed = normalizeToolSchemas(dirty);
    expect(fixed.response_format.json_schema.schema.pattern).toBe("x_y");

    const clean = { response_format: { json_schema: { schema: { pattern: "xy" } } } };
    expect(normalizeToolSchemas(clean)).toBe(clean);
  });

  it("returns the same reference when nothing changed (standard schema)", () => {
    const std = {
      tools: [
        {
          type: "function",
          function: {
            name: "h",
            parameters: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
          },
        },
      ],
    };
    expect(normalizeToolSchemas(std)).toBe(std);
  });

  it("handles a null/undefined body safely", () => {
    expect(normalizeToolSchemas(null)).toBeNull();
    expect(normalizeToolSchemas(undefined)).toBeUndefined();
  });
});
