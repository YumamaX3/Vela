// Log Harbor — the gateway's own record, four views in one room (System
// category). The active view lives in ?tab=unified|console|container|requests
// (and in ?view=unified, which M9 accepts as the §7 deep-link).
//
// The page itself stays a server component with no rendering directives: the
// tab is a CLIENT concern (it lives in `window.location`), and `LogHarbor`
// reads it after mount so the server HTML and the first client render agree.
// A `force-dynamic` here would change caching without fixing that mismatch.
import LogHarbor from "./LogHarbor";

export default function LogsPage() {
  return <LogHarbor />;
}
