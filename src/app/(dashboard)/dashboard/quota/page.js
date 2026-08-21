// Quota page — client component rendering a QuotaPanel (shared with Usage "quota" tab).
"use client";

import { Suspense } from "react";
import { Card, CardSkeleton } from "@/shared/components";
import QuotaPanel from "../usage/components/deck/QuotaPanel";

export default function QuotaPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<CardSkeleton />}>
        <QuotaPanel />
      </Suspense>
    </div>
  );
}
