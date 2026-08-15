// Facade — path-stable entry point for the apiKeysRepo contract.
// Storage Covenant A8: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
// Non-function exports (KeyLimitsValidationError) pass through untouched.
import * as sqlite from "./sqlite/apiKeysRepo.js";
import { bindFacade } from "./bind.js";

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
