"use client";
// EndpointModalsHost — the ceremonies' one mount point, above every shore.
//
// WHY IT EXISTS: the modals used to be mounted by the page client, so a tab
// switch kept them alive (the same component stayed mounted). The separation
// gives every shore its own route — a route change UNMOUNTS the page — so a
// modal opened on Keys would be stranded by a walk to Access unless the modals
// live above the routes. This host is mounted once by `layout.js` under the
// provider, so a dialog opened on one shore survives a walk to another (the
// never-strand law the old shell enforced, now across routes).
//
// It mounts the facade itself and passes it down, exactly as the old shell
// passed its controller: the ceremonies are overlays, not panels, and they read
// the same current the shores read.
import EndpointModals from "./modals/EndpointModals";
import { useEndpointFacade } from "../hooks/useEndpointFacade";

export default function EndpointModalsHost() {
  const c = useEndpointFacade();
  return <EndpointModals c={c} />;
}
