// Combo name validation — the single law for combo names, shared by the API
// routes (POST /api/combos, PATCH /api/combos/[id]) and the dashboard UI.
//
// v0.9.39 decree (the Star): combo names may carry slashes so operators can
// namespace their fleets — "vela/cc/opus", "vela/anthropic/sonnet". Guards
// keep the shape honest: no leading/trailing slash, no empty segments, no
// "." / ".." segments, and no "combo/" prefix (the keyGate combo/ addressing
// convention strips that prefix, so a combo named "combo/x" would read two
// ways in per-key ACLs).
export const COMBO_NAME_MAX_LENGTH = 128;

export function validateComboName(name) {
  if (!name || typeof name !== "string") {
    return { ok: false, error: "Name is required" };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Name is required" };
  }
  if (trimmed.length > COMBO_NAME_MAX_LENGTH) {
    return { ok: false, error: `Name is too long (max ${COMBO_NAME_MAX_LENGTH} characters)` };
  }
  if (!/^[a-zA-Z0-9_.\-/]+$/.test(trimmed)) {
    return {
      ok: false,
      error: "Name can only contain letters, numbers, -, _, . and /",
    };
  }
  if (trimmed.startsWith("/")) {
    return { ok: false, error: "Name cannot start with /" };
  }
  if (trimmed.endsWith("/")) {
    return { ok: false, error: "Name cannot end with /" };
  }
  if (trimmed.includes("//")) {
    return { ok: false, error: "Name cannot contain empty segments (//)" };
  }
  const segments = trimmed.split("/");
  if (segments.some((s) => s === "." || s === "..")) {
    return { ok: false, error: 'Name cannot contain "." or ".." segments' };
  }
  if (trimmed.startsWith("combo/")) {
    return {
      ok: false,
      error: 'Name cannot start with "combo/" — that prefix is reserved for combo addressing',
    };
  }
  return { ok: true, name: trimmed };
}
