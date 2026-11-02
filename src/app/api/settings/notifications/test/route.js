// POST /api/settings/notifications/test — the two "Test" buttons (proxy-test
// precedent: the operator gets the real verdict back, sanitized).
//
//   { kind: "webhook", event?: "usage"|"quota"|"error" }  → testWebhook()
//   { kind: "telegram" }                                   → testTelegram()
//
// Both helpers are fail-open at heart (never throw); this route shapes their
// verdict into HTTP 200 with `ok:false` for a failed DELIVERY (the test ran,
// the receiver refused) and 400 for a malformed request. Neither the webhook
// secret, the URL's query, nor the bot token ever rides the response.
import { NextResponse } from "next/server";
import { testWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks.js";
import { testTelegram } from "@/lib/notify.js";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const kind = body?.kind;

    if (kind === "webhook") {
      const event = body?.event;
      if (event !== undefined && !WEBHOOK_EVENTS.includes(event)) {
        return NextResponse.json(
          { ok: false, error: `Unknown event "${event}" — valid: ${WEBHOOK_EVENTS.join(", ")}` },
          { status: 400 }
        );
      }
      const verdict = await testWebhook({ event });
      return NextResponse.json(verdict);
    }

    if (kind === "telegram") {
      const verdict = await testTelegram();
      return NextResponse.json(verdict);
    }

    return NextResponse.json({ ok: false, error: 'kind must be "webhook" or "telegram"' }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, error: "Test failed" }, { status: 500 });
  }
}
