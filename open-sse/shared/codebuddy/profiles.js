// The four CodeBuddy-family products, as data.
//
// Each entry is a frozen record of everything that genuinely differs between the
// products. The executor reads these fields and never asks which product it serves,
// so a fifth sibling costs one object here and no new code.
//
// Two facts a hand-written table gets wrong, both measured against the reference
// gateway (maiphucgiang/codebuddy2api, app/client_profiles.py):
//   * X-Product is "SaaS" on every product — it names the commercial tier, never the
//     product. The product is named by X-IDE-Type / X-IDE-Name and the User-Agent.
//   * The OAuth platform parameter is lowercase "workbuddy" on both WorkBuddy shores,
//     while CodeBuddy's international site requires uppercase "CLI".

/**
 * @typedef {object} CodeBuddyProfile
 * @property {string} id            the provider id this profile serves
 * @property {string} product       one of cn-cli | cn-work | intl-cli | intl-work
 * @property {string} host          the chat host this product dials
 * @property {"rebuild"|"sanitise-in-place"} messageShape
 *                                  how the conversation is presented upstream
 * @property {string} opener        the system line a rebuilt conversation opens with
 * @property {boolean} sanitise     whether system text is substituted in place
 * @property {boolean} consoleDoor  whether the console door is available as one retry
 * @property {string|null} refreshUserAgent  a product-specific UA for token refresh
 */

/** @type {Record<string, CodeBuddyProfile>} */
export const CODEBUDDY_PROFILES = Object.freeze({
  "codebuddy-cn": Object.freeze({
    id: "codebuddy-cn",
    product: "cn-cli",
    host: "copilot.tencent.com",
    // The domestic lane is structurally different, not merely differently worded:
    // it keeps the client's own system text and substitutes brand signals in place.
    messageShape: "sanitise-in-place",
    opener: "You are CodeBuddy Code.",
    sanitise: true,
    consoleDoor: false,
    refreshUserAgent: null,
  }),

  "codebuddy-intl": Object.freeze({
    id: "codebuddy-intl",
    product: "intl-cli",
    host: "www.codebuddy.ai",
    messageShape: "rebuild",
    opener: "You are CodeBuddy Code.",
    sanitise: true,
    consoleDoor: true,
    refreshUserAgent: null,
  }),

  "workbuddy-cn": Object.freeze({
    id: "workbuddy-cn",
    product: "cn-work",
    host: "www.workbuddy.cn",
    messageShape: "rebuild",
    opener: "You are WorkBuddy, a powerful AI assistant.",
    sanitise: true,
    consoleDoor: true,
    refreshUserAgent: null,
  }),

  "workbuddy-intl": Object.freeze({
    id: "workbuddy-intl",
    product: "intl-work",
    host: "www.workbuddy.ai",
    messageShape: "rebuild",
    opener: "You are WorkBuddy, a powerful AI assistant.",
    sanitise: true,
    consoleDoor: true,
    refreshUserAgent: null,
  }),
});

/** The four ids, in registration order. */
export const CODEBUDDY_FAMILY = Object.freeze(Object.keys(CODEBUDDY_PROFILES));

/** The profile for a provider id, or undefined when it is not a family member. */
export function profileFor(providerId) {
  return CODEBUDDY_PROFILES[providerId];
}
