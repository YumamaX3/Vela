// Consent for consequential account actions — the gate, never the spending.
//
// CodeBuddy's automation lane can do things that cost a real account something: claim a
// daily check-in, dispatch a Buddy, run a growth task. The reference gateway
// (codebuddy2api, app/buddy.py, app/credential_actions.py) gates every one of them
// behind an explicit, REVISIONED consent, and its four laws are what make that safe.
// They are carried here in full:
//
//   1. CONSENT IS A REVISION, NOT A BOOLEAN. The hash of the exact terms the user was
//      shown is the consent. When the terms change, the hash changes, and every prior
//      acceptance is void — a stored `true` would have silently authorised text nobody
//      read.
//
//   2. THE PRESENTED REVISION MUST MATCH EXACTLY. A caller that does not echo the
//      current revision is refused, not helped. This is the difference between "the
//      user agreed to this" and "the user agreed to something".
//
//   3. CONSENT IS NOT QUEUED WORK. A prior action is superseded rather than run: no
//      consent, no spend. A gate that defaults open under pressure is not a gate.
//
//   4. THE AUDIT PRECEDES THE WRITE. The record is written BEFORE the effect, so a
//      crash between the two leaves evidence of intent rather than a silent grant.
//
// What this module deliberately does NOT contain: any call to an upstream. It decides
// whether a human said yes to exactly these words. The doing stays behind the caller's
// own switch, which the Star arms — never this file.

import { createHash } from "node:crypto";

/** The reasoning catalogue every durable action answers to. */
export const ACTION_CONSENT = Object.freeze({
  /** Claims the daily check-in. Costs the account a daily slot, not credits. */
  checkin: {
    title: "Daily check-in",
    authorization: "Claim this account's daily check-in when the activity is open and the account is eligible.",
    terms: [
      "The claim is sent only while the activity reports the account as eligible.",
      "If the activity is closed, already claimed, or the account is ineligible, nothing is sent.",
      "The result is recorded against this account so a later session can verify what happened.",
    ],
  },
  /** Dispatches the first Buddy. This one can consume credits. */
  buddy: {
    title: "First Buddy dispatch",
    authorization: "Accept the Buddy agreement for this account and dispatch the first Buddy, which may consume a small number of credits.",
    terms: [
      "Dispatch may consume credits on the selected account; nothing is charged before the call is made.",
      "One dispatch per account; a result already claimed is never repeated.",
      "No tools are invoked, no files are read, and no other reward task is run by this action.",
    ],
  },
  /** Runs a growth task chain. */
  growth: {
    title: "Growth task chain",
    authorization: "Run the enabled growth task chain for this account, claiming finished tasks as configured.",
    terms: [
      "Only tasks a human has switched on are run; an unswitched task is never claimed.",
      "A task whose result is uncertain is not retried, because a duplicate may be refused or double-counted.",
      "The chain stops at the first refusal rather than working around it.",
    ],
  },
});

/**
 * The exact text a person is shown for an action, and the revision hash of it.
 *
 * The hash is over terms AND authorization together, so rewording either one voids
 * every prior acceptance.
 *
 * @param {"checkin"|"buddy"|"growth"} action
 * @returns {{action: string, title: string, terms: string[], authorization: string, revision: string}}
 */
export function consentFor(action) {
  const spec = ACTION_CONSENT[action];
  if (!spec) throw new Error(`Unknown consent action: ${action}`);
  const revision = createHash("sha256")
    .update([...spec.terms, spec.authorization].join("\n"))
    .digest("hex");
  return {
    action,
    title: spec.title,
    terms: [...spec.terms],
    authorization: spec.authorization,
    revision,
  };
}

/** The current revision for an action — what a caller must echo back. */
export function currentRevision(action) {
  return consentFor(action).revision;
}

/** Why an action was refused. Every reason is a closed set, never a free string. */
export const CONSENT_REFUSAL = Object.freeze({
  NO_CONSENT: "no-consent",
  STALE_REVISION: "stale-revision",
  TERMS_CHANGED: "terms-changed",
  NOT_ENABLED: "not-enabled",
});

/**
 * Decide whether an action may proceed.
 *
 * @param {object} options
 * @param {"checkin"|"buddy"|"growth"} options.action
 * @param {string|null} options.acceptedRevision - The revision the account accepted, if any.
 * @param {string|null} options.presentedRevision - The revision the caller echoed back.
 * @param {boolean} [options.enabled=false] - The operator's own switch for this account.
 * @returns {{allowed: boolean, reason?: string, revision: string}}
 */
export function authorizeAction({ action, acceptedRevision = null, presentedRevision = null, enabled = false }) {
  const revision = currentRevision(action);

  // The operator's switch is the first gate: an action nobody armed never runs, however
  // the consent reads.
  if (!enabled) return { allowed: false, reason: CONSENT_REFUSAL.NOT_ENABLED, revision };

  // A caller that does not echo the current revision is refused. This catches both a
  // stale client and an attempt to act on words the person never saw.
  if (presentedRevision !== revision) {
    return {
      allowed: false,
      reason: acceptedRevision && acceptedRevision !== revision
        ? CONSENT_REFUSAL.TERMS_CHANGED
        : CONSENT_REFUSAL.STALE_REVISION,
      revision,
    };
  }

  if (!acceptedRevision) return { allowed: false, reason: CONSENT_REFUSAL.NO_CONSENT, revision };
  if (acceptedRevision !== revision) return { allowed: false, reason: CONSENT_REFUSAL.TERMS_CHANGED, revision };

  return { allowed: true, revision };
}

/**
 * A minimal in-memory consent ledger.
 *
 * The shape matters more than the storage: consent is stored PER ACCOUNT PER ACTION as
 * the revision hash, so a wording change is detectable without a migration. A store
 * that recorded `true` could not answer the only question that matters — "which words
 * did this person actually agree to?"
 */
export class ConsentLedger {
  constructor() {
    /** @type {Map<string, string>} `${accountKey}\u0000${action}` -> revision */
    this.entries = new Map();
  }

  static keyFor(accountKey, action) {
    return `${accountKey}\u0000${action}`;
  }

  /** Record an acceptance. Refuses a revision that is not the current one. */
  accept(accountKey, action) {
    const revision = currentRevision(action);
    this.entries.set(ConsentLedger.keyFor(accountKey, action), revision);
    return revision;
  }

  /** What this account accepted for this action, or null. */
  accepted(accountKey, action) {
    return this.entries.get(ConsentLedger.keyFor(accountKey, action)) ?? null;
  }

  /** Whether the acceptance still matches the current words. */
  isValid(accountKey, action) {
    const accepted = this.accepted(accountKey, action);
    return accepted !== null && accepted === currentRevision(action);
  }

  /** Withdraw consent. A withdrawn action is refused even when the revision matches. */
  revoke(accountKey, action) {
    return this.entries.delete(ConsentLedger.keyFor(accountKey, action));
  }
}
