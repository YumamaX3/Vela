import FitnessClient from "./FitnessClient";

// The Fitness lens on its own route — the old `?tab=fitness`, now a URL (§4 · W3).
export default function ProxyFitnessPage() {
  return <FitnessClient />;
}
