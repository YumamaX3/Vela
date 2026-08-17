/**
 * Fleet Status Panel — per-provider proxy fleet view with real-time fitness
 */
"use client";

import { useState, useEffect } from "react";
import { Badge, Card } from "@/shared/components";

export default function FleetStatusPanel({ providerId, proxyPools }) {
  const [fitnessData, setFitnessData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFitness() {
      try {
        const res = await fetch(`/api/proxy-pools/fitness?provider=${providerId}`);
        const data = await res.json();
        if (data.fitness) {
          setFitnessData(data.fitness.filter(f => f.provider === providerId));
        }
      } catch (err) {
        console.warn("[FleetStatusPanel] load failed:", err.message);
      } finally {
        setLoading(false);
      }
    }
    loadFitness();
  }, [providerId]);

  const getStatusBadge = (score, unfitReason) => {
    if (unfitReason) {
      return <Badge color="red" label={`Unfit: ${unfitReason}`} />;
    }
    if (score >= 0.7) return <Badge color="green" label="Fit" />;
    if (score >= 0.4) return <Badge color="yellow" label="Caution" />;
    return <Badge color="red" label="Poor" />;
  };

  if (loading || fitnessData.length === 0) {
    return (
      <Card title="Fleet Status" subtitle="Loading fitness data...">
        <p className="text-sm text-gray-500">No pools bound to this provider</p>
      </Card>
    );
  }

  return (
    <Card title="Fleet Status" subtitle={`Real-time fitness for ${providerId}`}>
      <div className="space-y-2">
        {fitnessData.map((f) => (
          <div key={`${f.poolId}|${f.provider}`} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div>
              <p className="font-medium text-sm">{f.poolId}</p>
              <p className="text-xs text-gray-500">
                Score: {(f.score * 100).toFixed(0)}% |
                Success: {f.successCount} | Fail: {f.failureCount}
              </p>
            </div>
            {getStatusBadge(f.score, f.unfitReason)}
          </div>
        ))}
      </div>
    </Card>
  );
}
