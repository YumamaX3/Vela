// The proxy family's component barrel — every separated shore imports from one place,
// and a new lens joins the family by being listed here once.
//
// The four lens components keep their `*Tab` names on purpose: they ARE the console's
// tabs, moved onto their own routes. Renaming them would churn four files and every
// test for a change of address, and the names still say what they hold.
export { default as ProxyCensus } from "./ProxyCensus";
export { default as ProxyShore } from "./ProxyShore";
export { default as HealthVerdict, PoolVerdictBadge, ResultVerdictBadge, VerdictBadge } from "./HealthVerdict";
export { default as FleetTab } from "./FleetTab";
export { default as FitnessTab } from "./FitnessTab";
export { default as EgressTab } from "./EgressTab";
export { default as RelayTab } from "./RelayTab";
// §3.3 · W4 — the relay deploy forms, shared by Relay and Tools (one credential form).
export { default as RelayDeployForm, RelayForm, RelayBlurb, canDeploy, DEFAULT_FORM, RELAY_BLURB } from "./RelayDeployForm";
// §3.1 · W4 — the shared row + panel primitives the three new shores (and the
// hub) are built from. `PoolIdentity` is exported on its own for a card-shaped
// surface that needs the identity without a <tr>.
export { default as PoolRow, PoolIdentity } from "./PoolRow";
export { default as SectionCard } from "./SectionCard";
