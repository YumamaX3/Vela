// Facade — path-stable entry point for keyTemplatesRepo (Governance Center,
// W1b). bindFacade dispatches by posture: sqlite re-exports the harbor
// verbatim; mysql binds repos/mysql/keyTemplatesRepo.js.
import * as sqlite from "./sqlite/keyTemplatesRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/keyTemplatesRepo.js"));

export const listTemplates = bound.listTemplates;
export const getTemplate = bound.getTemplate;
export const createTemplate = bound.createTemplate;
export const updateTemplate = bound.updateTemplate;
export const deleteTemplate = bound.deleteTemplate;
// Pure constructor — passes through untouched.
export const applyShape = bound.applyShape;
