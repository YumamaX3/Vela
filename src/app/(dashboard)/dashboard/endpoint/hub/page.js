import HubClient from "./HubClient";

// The Endpoint hub — the console's front door, now its own address (§3.1 · W4).
export default function HubPage() {
  return <HubClient />;
}
