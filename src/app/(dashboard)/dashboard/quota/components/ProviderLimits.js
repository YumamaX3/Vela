// Provider Limits — per-account quota gauges (simplified version)
"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card } from "@/shared/components";

export default function ProviderLimits({ keysLimit = 200 }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/keys?limit=${keysLimit}`)
      .then((r) => r.json())
      .then((data) => {
        setKeys(data.keys || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [keysLimit]);

  if (loading) {
    return (
      <Card className="h-96 flex items-center justify-center bg-surface-2 rounded-xl p-4 border border-border-subtle">
        <div className="animate-pulse text-text-muted">Loading quotas...</div>
      </Card>
    );
  }

  return (
    <Card header={`Account Quotas (${keys.length} keys)`}>
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-50 text-xs uppercase text-gray-700">
          <tr>
            <th className="px-4 py-3">Key Name</th>
            <th className="px-4 py-3">Requests</th>
            <th className="px-4 py-3">Spend</th>
          </tr>
        </thead>
        <tbody>
          {keys.slice(0, 10).map((key, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-2">{key.name}</td>
              <td className="px-4 py-2 tabular-nums">{key.requests ?? "—"}</td>
              <td className="px-4 py-2 tabular-nums">${(key.spend ?? 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

ProviderLimits.propTypes = {
  keysLimit: PropTypes.number,
};
