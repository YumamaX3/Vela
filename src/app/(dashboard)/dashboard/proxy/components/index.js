// The proxy console's component barrel — the shell imports from one place, and a
// new lens joins the console by being listed here once.
export { default as ProxyCensus } from "./ProxyCensus";
export { default as HealthVerdict, PoolVerdictBadge, ResultVerdictBadge, VerdictBadge } from "./HealthVerdict";
export { default as FleetTab } from "./FleetTab";
export { default as FitnessTab } from "./FitnessTab";
export { default as EgressTab } from "./EgressTab";
export { default as RelayTab } from "./RelayTab";
