/**
 * POST /api/proxy-pools/[id]/probe
 * IP-echo egress probe through pool's dispatcher
 */
import { NextResponse } from "next/server";
import { getProxyPoolById } from "@/lib/localDb";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain for probe execution

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await fleet.probeEgress(id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[probe]", err.message);
    return NextResponse.json({ error: "probe failed" }, { status: 500 });
  }
}
