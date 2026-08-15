// Facade — path-stable entry point for the pricingRepo contract.
// Wave A of the Storage Covenant: the sqlite harbor is the only implementation,
// so this facade is a pure re-export (zero indirection, sync functions stay sync).
// bind.js dispatches to the mysql/mirror harbors from Wave A6 onward.
export * from "./sqlite/pricingRepo.js";
