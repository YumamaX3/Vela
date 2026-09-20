// Facade — path-stable entry point for the authStoreRepo contract
// (Auth Hardening W1, migration 016).
//
// Unlike its siblings, this facade does NOT call bindFacade, and the reason is
// load-bearing rather than an omission: bindFacade's mysql branch wraps every
// bound name in an async loader, but loginLimiter.js needs the failure row
// SYNCHRONOUSLY (its public contract is sync — the login route consults the
// ladder before it parses a body). Wrapping would either break that contract or
// reduce the durable arm to a no-op under the mysql posture. The harbor's own
// header carries the full reasoning and the honest consequence (auth rows are
// not mirrored to the twin); this file stays a plain re-export so the
// path-stable surface consumers import never changes shape.
export * from "./sqlite/authStoreRepo.js";
