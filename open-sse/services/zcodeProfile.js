// G9 — the zcode client profile. The four identity slots the official client
// broadcasts (X-Platform, X-Os-Version, X-Client-Language, X-Client-Timezone)
// read from here instead of literals inside buildHeaders. Pure, dependency-free,
// and never mutating: a missing or partial providerSpecificData.zcodeProfile
// simply layers on top of the baked defaults.
//
// Values that are not usable strings are skipped rather than coerced — an
// object spilled into the slot must not become "[object Object]" on the wire.

const ZCODE_PROFILE_DEFAULTS = Object.freeze({
  platform: "darwin-x64",
  osVersion: "21.6.0",
  language: "en-US",
  timezone: "Europe/Bucharest",
});

export function defaultZcodeProfile() {
  return { ...ZCODE_PROFILE_DEFAULTS };
}

export function resolveZcodeProfile(providerSpecificData) {
  const profile = { ...ZCODE_PROFILE_DEFAULTS };
  const overrides = providerSpecificData?.zcodeProfile;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return profile;
  for (const key of Object.keys(ZCODE_PROFILE_DEFAULTS)) {
    const value = overrides[key];
    if (typeof value === "string" && value.trim() !== "") profile[key] = value;
  }
  return profile;
}

export default defaultZcodeProfile;
