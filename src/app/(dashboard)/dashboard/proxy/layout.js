import ProxyProvider from "./ProxyProvider";

// The Proxy console's layout — home of the shared fleet store.
//
// Everything under `/dashboard/proxy/*` renders inside this provider, so the eight
// shores (hub, pools, fitness, egress, relay, ledger, usage, tools) share ONE copy of
// the fleet and one census. The provider is a client component; `children` is passed
// through from the server as a slot, so the pages themselves keep their own rendering
// mode.
export default function ProxyLayout({ children }) {
  return <ProxyProvider>{children}</ProxyProvider>;
}
