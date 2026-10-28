// CodeBuddy and WorkBuddy client identities — four products, four real fingerprints.
//
// The gateway recognises a caller by its identity headers. Sending the wrong ones does
// not fail loudly: it fails as a channel rejection (code 11128) or a silent cooldown.
// Carried from the reference gateway (codebuddy2api, app/client_profiles.py and
// app/auth_oauth.py), whose facts are these:
//
//   CodeBuddy CLI   UA "CLI/<cli> CodeBuddy/<cli>",  X-IDE-Type CLI,       X-IDE-Name CLI
//   WorkBuddy       UA "WorkBuddy/<wb> <name>/<wb> CLI/<cli>",
//                   X-IDE-Type WorkBuddy, X-IDE-Name WorkBuddy, X-IDE-Version <wb>,
//                   X-Private-Data true
//
// and whose versions are per shore:
//
//   domestic      CLI 2.165.0   WorkBuddy 5.9.2
//   international CLI 2.161.0   WorkBuddy 5.8.4
//
// The domestic WorkBuddy name is "WorkBuddy"; the international one is "WorkBuddy AI".
//
// Two further facts that a hand-written registry gets wrong:
//
//   * X-Product is "SaaS" on every product — it is NOT the product name.
//   * The OAuth platform parameter is LOWERCASE "workbuddy" for both WorkBuddy sites,
//     while CodeBuddy's international site requires uppercase "CLI". One shared value
//     sends the wrong platform to at least one shore.

/** Verified package versions, per shore. */
export const CODEBUDDY_VERSIONS = Object.freeze({
  domestic: Object.freeze({ cli: "2.165.0", workbuddy: "5.9.2" }),
  international: Object.freeze({ cli: "2.161.0", workbuddy: "5.8.4" }),
});

/** The plugin root every product shares for auth and refresh. */
export const CODEBUDDY_PLUGIN_PREFIX = "/v2/plugin";

/** The OAuth site hosts, keyed by the site a caller names. */
export const CODEBUDDY_SITE_HOSTS = Object.freeze({
  cn: "https://www.codebuddy.cn",
  intl: "https://www.workbuddy.ai",
  "intl-codebuddy": "https://www.codebuddy.ai",
});

/**
 * The `platform` query parameter for the auth/state door.
 *
 * CodeBuddy's international site requires uppercase CLI; every WorkBuddy site —
 * domestic and international alike — sends lowercase `workbuddy`.
 */
export function authPlatformForSite(site) {
  return site === "intl-codebuddy" ? "CLI" : "workbuddy";
}

/** Which shore a profile belongs to, for version selection. */
function shoreOf(profile) {
  return profile.startsWith("intl") ? "international" : "domestic";
}

/**
 * The identity headers for a product profile.
 *
 * @param {"cn-cli"|"cn-work"|"intl-cli"|"intl-work"} profile
 * @returns {Record<string,string>}
 */
export function identityHeaders(profile) {
  const shore = shoreOf(profile);
  const versions = CODEBUDDY_VERSIONS[shore];
  const isWork = profile.endsWith("-work");

  if (!isWork) {
    return {
      "User-Agent": `CLI/${versions.cli} CodeBuddy/${versions.cli}`,
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": versions.cli,
    };
  }

  // The international desktop client calls itself "WorkBuddy AI"; the domestic one
  // is plain "WorkBuddy". Both ride a CLI version alongside their own.
  const name = shore === "international" ? "WorkBuddy AI" : "WorkBuddy";
  return {
    "User-Agent": `WorkBuddy/${versions.workbuddy} ${name}/${versions.workbuddy} CLI/${versions.cli}`,
    "X-IDE-Type": "WorkBuddy",
    "X-IDE-Name": "WorkBuddy",
    "X-IDE-Version": versions.workbuddy,
    "X-Private-Data": "true",
  };
}

/**
 * The full transport header block for a profile: identity plus the shared product
 * fields every CodeBuddy-family request carries.
 *
 * X-Product is "SaaS" for all four — it names the commercial tier, never the product.
 */
export function transportHeaders(profile) {
  return {
    ...identityHeaders(profile),
    "X-Product": "SaaS",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  };
}

/** The profile a provider id belongs to. */
export const PROVIDER_PROFILE = Object.freeze({
  "codebuddy-cn": "cn-cli",
  "codebuddy-intl": "intl-cli",
  "workbuddy-cn": "cn-work",
  "workbuddy-intl": "intl-work",
});
