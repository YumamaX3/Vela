// GET  /api/trust-events                            — the inbox + {unread}
// POST /api/trust-events {action:"read", id}        — dismiss one
// POST /api/trust-events {action:"read-all"}        — dismiss every unread
//
// The bell in the header reads {unread} from the GET and renders NOTHING when
// it is 0 (the zero-suppression law — a "0" badge is noise, not a signal).
// Events are written only by the honest writers (src/lib/security/
// securityEvents.js): a key revoked, a guardrail blocking traffic. There are
// no decorative notices here.
import { NextResponse } from "next/server";
import {
  listTrustEvents,
  countUnreadTrustEvents,
  markTrustEventRead,
  markAllTrustEventsRead,
  TRUST_EVENTS_MAX_LIMIT,
} from "@/lib/db/repos/trustEventsRepo.js";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    let limit = 20;
    if (rawLimit !== null) {
      const n = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
      }
      limit = Math.min(n, TRUST_EVENTS_MAX_LIMIT);
    }
    const rawOffset = searchParams.get("offset");
    const offset = rawOffset === null ? 0 : Math.max(0, Number.parseInt(rawOffset, 10) || 0);
    const unreadOnly = searchParams.get("unread") === "1" || searchParams.get("unread") === "true";

    const [page, unread] = await Promise.all([
      listTrustEvents({ limit, offset, unreadOnly }),
      countUnreadTrustEvents(),
    ]);
    return NextResponse.json({ events: page.events, total: page.total, unread, limit: page.limit, offset: page.offset });
  } catch (error) {
    log.error("API", "Failed to list trust events:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read trust inbox" }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body with an action is required" }, { status: 400 });
  }
  const action = body?.action;
  try {
    if (action === "read-all") {
      const updated = await markAllTrustEventsRead();
      return NextResponse.json({ status: "ok", updated, unread: await countUnreadTrustEvents() });
    }
    if (action === "read") {
      const id = body?.id;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "id is required for action \"read\"" }, { status: 400 });
      }
      const found = await markTrustEventRead(id);
      if (!found) return NextResponse.json({ error: "Event not found" }, { status: 404 });
      return NextResponse.json({ status: "ok", id, unread: await countUnreadTrustEvents() });
    }
    return NextResponse.json({ error: "action must be \"read\" or \"read-all\"" }, { status: 400 });
  } catch (error) {
    log.error("API", "Failed to update trust events:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to update trust inbox" }, { status: 500 });
  }
}
