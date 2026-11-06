import EndpointProvider from "./EndpointProvider";
import EndpointModalsHost from "./components/EndpointModalsHost";

// The Endpoint console's layout — home of the shared fleet store.
//
// Everything under `/dashboard/endpoint/*` renders inside this provider, so the
// five shores (hub, keys, access, security, diagnostics) share ONE copy of the
// fleet and one census. The provider is a client component; `children` is
// passed through from the server as a slot, so the pages themselves keep their
// own rendering mode.
//
// The modals host sits BESIDE the shores, not inside any of them (§3.1 · W4):
// a dialog opened on Keys survives a walk to Access, because the overlay lives
// above the routes — the never-strand law the old shell enforced, now across
// routes.
export default function EndpointLayout({ children }) {
  return (
    <EndpointProvider>
      {children}
      <EndpointModalsHost />
    </EndpointProvider>
  );
}
