// Facade — path-stable entry point for keyTagsRepo (Governance Center, W1b).
// bindFacade dispatches by posture: sqlite re-exports the harbor verbatim;
// mysql binds repos/mysql/keyTagsRepo.js.
import * as sqlite from "./sqlite/keyTagsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/keyTagsRepo.js"));

export const sanitizeTag = bound.sanitizeTag;
export const tagsForKeys = bound.tagsForKeys;
export const addTag = bound.addTag;
export const removeTag = bound.removeTag;
export const renameTag = bound.renameTag;
export const deleteForKey = bound.deleteForKey;
