"use client";

import { useEffect, useState } from "react";
import { Card, CardSkeleton } from "@/shared/components";
import { useEndpointFacets } from "@/shared/hooks/useEndpointFacets";
import { translate } from "@/i18n/runtime";
import LabTabBar from "./components/LabTabBar";
import InjectorsTab from "./components/InjectorsTab";
import ModesTab from "./components/ModesTab";
import PoliciesTab from "./components/PoliciesTab";
import LibraryTab from "./components/LibraryTab";
import SimulatorTab from "./components/SimulatorTab";
import ObserveTab from "./components/ObserveTab";
import { fetchLabSettings } from "./lib/labApi";

const VALID_TABS = new Set(["injectors", "modes", "policies", "library", "simulator", "observe"]);

/**
 * The AI Lab — governed instruction-layering (the 16-phase Mirror's seal).
 * Thin orchestrator: loads Lab settings (userInjectors + modeBundles +
 * contentPolicies) once, owns the URL-facet tab deck, and composes the
 * per-tab sections. Every mutating action goes through the shared labApi
 * surface (session-auth'd) — the engine refuses what the UI would mis-save.
 */
export default function AiLabClient() {
  const facets = useEndpointFacets();
  const activeTab = VALID_TABS.has(facets.state.tab) ? facets.state.tab : "injectors";
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = async () => {
    try {
      const data = await fetchLabSettings();
      setSettings(data);
      setError(null);
    } catch (e) {
      setError(e.message || "failed to load Lab settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">science</span>
              {translate("AI Lab")}
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              {translate("Governed instruction-layering — modes, policies, and lanes that honor them.")}
            </p>
          </div>
        </div>
        <LabTabBar active={activeTab} onSelect={(t) => facets.setFacets({ tab: t })} />
      </header>

      {loading ? (
        <CardSkeleton />
      ) : error ? (
        <Card className="p-4 text-red-600 text-sm">{error}</Card>
      ) : (
        <section data-lab-tab={activeTab}>
          {activeTab === "injectors" && <InjectorsTab settings={settings} onChange={reload} />}
          {activeTab === "modes" && <ModesTab settings={settings} onChange={reload} />}
          {activeTab === "policies" && <PoliciesTab settings={settings} onChange={reload} />}
          {activeTab === "library" && <LibraryTab settings={settings} onChange={reload} />}
          {activeTab === "simulator" && <SimulatorTab settings={settings} />}
          {activeTab === "observe" && <ObserveTab settings={settings} />}
        </section>
      )}
    </div>
  );
}
