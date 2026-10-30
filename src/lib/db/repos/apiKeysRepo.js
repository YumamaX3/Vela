// Facade — path-stable entry point for the apiKeysRepo contract.
// Storage Covenant A8: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
// Non-function exports (KeyLimitsValidationError) pass through untouched.
import * as sqlite from "./sqlite/apiKeysRepo.js";
import { bindFacade } from "./bind.js";
import { keyAccessFromColumns } from "@/shared/utils/keyAccess.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/apiKeysRepo.js"));

export const KeyLimitsValidationError = bound.KeyLimitsValidationError;
export const sanitizeCategory = bound.sanitizeCategory;
export const getApiKeys = bound.getApiKeys;
export const getApiKeyById = bound.getApiKeyById;
export const createApiKey = bound.createApiKey;
export const updateApiKey = bound.updateApiKey;
export const deleteApiKey = bound.deleteApiKey;
export const resolveKey = bound.resolveKey;
export const validateApiKey = bound.validateApiKey;
export const ensureInternalKey = bound.ensureInternalKey;

/**
 * The presented key's access entry — what the /v1 handlers read to decide
 * whether a key is restricted. Resolves through the SAME hash-at-rest lookup
 * as the gate (resolveKey), never a plaintext `key = ?` match. Returns
 * { id, name, access } or null for an unknown key.
 */
export async function getApiKeyByKey(apiKey) {
  const row = await bound.resolveKey(apiKey);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || null,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}
