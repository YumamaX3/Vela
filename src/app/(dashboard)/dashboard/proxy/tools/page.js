import ToolsClient from "./ToolsClient";

// The Tools lens on its own route — the toolbox, §4 · W4 (§1 "The toolbox —
// batch ops, health sweep, geo toggle, import/export"; §3.3 the eight tools).
export default function ProxyToolsPage() {
  return <ToolsClient />;
}
