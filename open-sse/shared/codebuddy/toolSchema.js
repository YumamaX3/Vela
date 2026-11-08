// Tool-schema normalization for the CodeBuddy wire — ported from the reference
// gateway (codebuddy2api v1.5.4, app/upstream_compat.py:11-176).
//
// Clients hand us every schema dialect the ecosystem has produced, and the CodeBuddy
// upstream (a Go gateway fronting an RE2-flavoured validator) refuses three of them:
//
//   * An EMPTY parameter root — `parameters: {}` — is rejected where an explicit
//     object schema is accepted.
//   * LEGACY FIELD MAPS — a root whose values are fields carrying boolean `required`
//     flags, types, or enums — are read as a schema-keyword map upstream, so the
//     fields vanish and the call arrives with no parameters at all.
//   * `\_` ESCAPES in pattern strings — RE2 treats `\__x_` differently from JS/Python
//     regex, and the upstream refuses patterns it cannot parse. Python's own JSON
//     round-trip means a schema containing `\_` serializes as `\\_`.
//
// The law normalizes exactly these three, touching nothing else: standard schemas,
// roots with `$`/`x-` extensions, and nested schemas pass through UNCHANGED, and the
// body is copied only when something actually changed (the same reference-preserving
// contract as toolChoice.js). Channel/origin fallback law lives in channelCheck.js,
// NOT here — this module is schema-only.

import crypto from "node:crypto";

/** Schema keywords whose values are MAPS of schemas — upstream_compat.py:11-12. */
const SCHEMA_MAPS = new Set([
  "properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies",
]);

/** Schema keywords whose values are ARRAYS of schemas — upstream_compat.py:13. */
const SCHEMA_ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems", "items"]);

/** Schema keywords whose value is ONE schema — upstream_compat.py:14-16. */
const SCHEMA_CHILDREN = new Set([
  "items", "additionalItems", "contains", "unevaluatedItems", "additionalProperties",
  "unevaluatedProperties", "propertyNames", "not", "if", "then", "else", "contentSchema",
]);

/** Keywords whose values are schemas cannot be told apart from fields by shape alone. */
const SCHEMA_VALUED = new Set([...SCHEMA_MAPS, ...SCHEMA_CHILDREN]);

/** Keywords holding arbitrary instance data are ambiguous whatever their shape. */
const INSTANCE_KEYWORDS = new Set(["const", "default"]);

/** A schema string containing "\_" serializes as "\\_" in JSON — upstream_compat.py:27. */
const ESCAPED_UNDERSCORE = "\\\\";

/** Remove only unescaped backslashes before underscores, preserving escaped backslashes.
 *  A run of N backslashes before `_` loses one backslash when N is even (it was escaped),
 *  keeps all N when odd (the trailing backslash escapes the underscore). — upstream_compat.py:30-39. */
function normalizePattern(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\\+_/g, (match) => (match.length % 2 === 0 ? match.slice(1) : match));
}

/** Normalize RE2-incompatible underscore escapes ONLY in schema pattern positions —
 *  upstream_compat.py:42-70. `pattern` values and `patternProperties` KEYS are the
 *  pattern positions; everything else recurses as schema structure. */
function normalizeSchemaPatterns(schema) {
  if (!schema || typeof schema !== "object") return;
  const pattern = schema.pattern;
  if (typeof pattern === "string") schema.pattern = normalizePattern(pattern);
  const properties = schema.patternProperties;
  if (properties && typeof properties === "object") {
    const normalized = {};
    for (const [key, value] of Object.entries(properties)) {
      const normalizedKey = normalizePattern(key);
      if (normalizedKey in normalized) {
        // allOf also accepts boolean schemas, so no colliding constraint is lost.
        normalized[normalizedKey] = { allOf: [normalized[normalizedKey], value] };
      } else {
        normalized[normalizedKey] = value;
      }
    }
    schema.patternProperties = normalized;
  }
  for (const key of SCHEMA_MAPS) {
    const value = schema[key];
    if (value && typeof value === "object") for (const child of Object.values(value)) normalizeSchemaPatterns(child);
  }
  for (const key of SCHEMA_ARRAYS) {
    const value = schema[key];
    if (Array.isArray(value)) for (const child of value) normalizeSchemaPatterns(child);
  }
  for (const key of SCHEMA_CHILDREN) normalizeSchemaPatterns(schema[key]);
}

/** Cheaply detect a backslash before an underscore anywhere in a JSON-compatible value —
 *  upstream_compat.py:73-78. Unserializable input is treated as carrying one (repair,
 *  never assume cleanliness). */
function hasUnderscoreEscape(value) {
  try {
    return JSON.stringify(value).includes(ESCAPED_UNDERSCORE);
  } catch {
    return true;
  }
}

/** A legacy field carries a boolean required flag, a field type or an enum — upstream_compat.py:81-84. */
function looksLikeField(value) {
  return (
    typeof value?.required === "boolean" ||
    typeof value?.type === "string" ||
    Array.isArray(value?.type) ||
    Array.isArray(value?.enum)
  );
}

/** Whether an object under this root key is a legacy field rather than a schema-keyword
 *  value — upstream_compat.py:87-94. const/default never count; schema-valued keywords
 *  must ALSO look like a field; anything else holds scalars, so an object is a field. */
function holdsField(name, value) {
  if (INSTANCE_KEYWORDS.has(name)) return false;
  if (SCHEMA_VALUED.has(name)) return looksLikeField(value);
  return true;
}

/** Wrap an empty root or a field map with legacy boolean required flags in an object
 *  schema — upstream_compat.py:97-124. A root is legacy only when every value is a
 *  field object, at least one carries a boolean `required`, and none starts with
 *  `$`/`x-`. Anything else passes through untouched. */
function parameterRoot(parameters) {
  if (!parameters || typeof parameters !== "object") return parameters;
  if (Object.keys(parameters).length === 0) {
    return { type: "object", properties: {} };
  }
  const entries = Object.entries(parameters);
  const startsExtension = ([name]) => name.startsWith("$") || name.startsWith("x-");
  // Upstream reads required with a default of false (upstream_compat.py:110), so a
  // field WITHOUT the key still passes the shape gate; holdsField rejects non-fields.
  const everyFieldObject = ([, field]) => field && typeof field === "object" && (field.required === undefined || typeof field.required === "boolean");
  const anyRequired = ([, field]) => "required" in field;
  const allHoldField = ([name, field]) => holdsField(name, field);
  if (
    entries.some(startsExtension) ||
    !entries.every(everyFieldObject) ||
    !entries.some(anyRequired) ||
    !entries.every(allHoldField)
  ) {
    return parameters;
  }
  const properties = {};
  const required = [];
  for (const [name, field] of entries) {
    const fieldCopy = { ...field };
    // Upstream pops unconditionally (upstream_compat.py:117-120); only a TRUE
    // flag names the field required — a false flag is deleted, never carried.
    const wasRequired = fieldCopy.required === true;
    delete fieldCopy.required;
    if (wasRequired) required.push(name);
    properties[name] = fieldCopy;
  }
  const result = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

/** Return the declaration with normalized parameters, or the SAME object when nothing
 *  changed — upstream_compat.py:127-136. */
function normalizeDeclaration(declaration, roots) {
  if (!declaration || typeof declaration !== "object" || !("parameters" in declaration)) {
    return declaration;
  }
  const original = declaration.parameters;
  let parameters = roots ? parameterRoot(original) : original;
  if (hasUnderscoreEscape(parameters)) {
    parameters = structuredClone(parameters);
    normalizeSchemaPatterns(parameters);
  }
  return parameters === original ? declaration : { ...declaration, parameters };
}

/** Normalize one tool entry — upstream_compat.py:139-151. OpenAI wrappers normalize
 *  their `function` with roots; bare entries still get pattern repair (no roots). */
function normalizeTool(tool, key) {
  if (key === "functions") return normalizeDeclaration(tool, true);
  if (!tool || typeof tool !== "object") return tool;
  const fn = tool.function;
  if (fn && typeof fn === "object" && (tool.type ?? "function") === "function") {
    const normalized = normalizeDeclaration(fn, true);
    if (normalized !== fn || !("type" in tool)) {
      // An explicit type lets named tool_choice and upstream recognize the declaration.
      return { ...tool, type: "function", function: normalized };
    }
  }
  return normalizeDeclaration(tool, false);
}

/**
 * Make tool and structured-output schemas acceptable upstream, copying only what
 * changes — upstream_compat.py:154-176. Returns the SAME reference when untouched.
 *
 * @template T
 * @param {T} body - the request body
 * @returns {T} the normalized body (new reference only when a change was made)
 */
export function normalizeToolSchemas(body) {
  if (!body || typeof body !== "object") return body;
  let result = body;
  for (const key of ["tools", "functions"]) {
    const tools = body[key];
    if (!Array.isArray(tools)) continue;
    const normalized = tools.map((tool) => normalizeTool(tool, key));
    if (normalized.some((next, i) => next !== tools[i])) {
      result = result === body ? { ...body } : result;
      result[key] = normalized;
    }
  }
  const responseFormat = body.response_format;
  if (responseFormat && typeof responseFormat === "object" && hasUnderscoreEscape(responseFormat)) {
    result = result === body ? { ...body } : result;
    result.response_format = structuredClone(responseFormat);
    const jsonSchema = result.response_format.json_schema;
    if (jsonSchema && typeof jsonSchema === "object") normalizeSchemaPatterns(jsonSchema.schema);
  }
  return result;
}

/** Test hooks — parity vectors for the vitest battery. */
export const __test__ = { normalizePattern, normalizeSchemaPatterns, parameterRoot };
