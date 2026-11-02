import crypto from "node:crypto";

// The second step — a server-side 2FA ticket.
//
// WHY A TICKET AND NOT A COOKIE: the password step must not mint anything a
// client could use before the second factor is proven. This map is that gap:
// one short-lived, single-use, IP-bound token that says "the password was
// right for THIS user; ask for a code". It carries no session and grants
// nothing on its own.
//
// WHY IN-MEMORY: a 2FA challenge is seconds long. Persisting it would give it
// a lifetime the threat model does not have (a stolen database row would be a
// usable second-step pass), and a restart during the five-minute window costs
// the operator one password entry — the fail-open direction.
//
// TTL 5 minutes: long enough for a human to open an authenticator app, short
// enough that a shoulder-surfed screen is stale before it is useful. Single
// use: the entry is deleted the moment a code is verified, so a replay of the
// same ticket buys nothing.
const TICKET_TTL_MS = 5 * 60 * 1000;
const tickets = new Map(); // ticket -> { userId, username, ip, expiresAt }

function pruneTickets(now = Date.now()) {
  for (const [id, t] of tickets) {
    if (t.expiresAt <= now) tickets.delete(id);
  }
}

export function mintTicket({ userId, username, ip }) {
  pruneTickets();
  const id = crypto.randomUUID();
  tickets.set(id, { userId, username, ip, expiresAt: Date.now() + TICKET_TTL_MS });
  return id;
}

/** Consume the ticket if it exists, is unexpired, and belongs to this IP. */
export function consumeTicket({ ticket, ip }) {
  pruneTickets();
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket); // single use, right or wrong
  if (entry.ip !== ip) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

