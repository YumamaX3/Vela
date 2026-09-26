// Facade — path-stable entry point for the credential store (migration 017).
//
// bindFacade dispatches by posture: sqlite re-exports the harbor verbatim;
// mysql binds repos/mysql/usersRepo.js; mirror binds the sqlite harbor behind
// the mirror decorator so the outbox pump carries every credential write to the
// twin. The authUsers table was forged by migration 017 (sqlite) and by
// bootstrap.js's additive TABLES diff (mysql), so the store is posture-bound
// like every W3+ surface.
import * as sqlite from "./sqlite/usersRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/usersRepo.js"));

export const getUserByUsername = bound.getUserByUsername;
export const getUserById = bound.getUserById;
export const createUser = bound.createUser;
export const updateUser = bound.updateUser;
export const setUserPassword = bound.setUserPassword;
export const touchUserLogin = bound.touchUserLogin;
export const listUsers = bound.listUsers;
export const countUsers = bound.countUsers;
export const deleteAllUsers = bound.deleteAllUsers;
