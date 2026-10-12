// (Upstream shipped this suite on node:test — vitest 4 refuses a bare-test()
// file with "No test suite found"; the assertions are theirs, the harness is
// ours. Vela's house is vitest.)
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  formatX509Certificate,
  isSamlConfigured,
  generateSamlMetadata,
  pickSamlEmail,
  pickSamlDisplayName,
} from "../../src/lib/auth/saml.js";

describe("SAML SP auth helpers", () => {
  it("formatX509Certificate normalizes Base64 strings into PEM blocks", () => {
  const rawBase64 = "MIIC1234567890123456789012345678901234567890123456789012345678901234567890";
  const formatted = formatX509Certificate(rawBase64);
  assert.match(formatted, /-----BEGIN CERTIFICATE-----/);
  assert.match(formatted, /-----END CERTIFICATE-----/);
  assert.equal(formatX509Certificate(""), "");
});

  it("isSamlConfigured checks required fields", () => {
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso", samlCert: "cert" }), true);
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso" }), false);
  assert.equal(isSamlConfigured({}), false);
});

  it("generateSamlMetadata produces valid SP XML", () => {
  const settings = {
    samlEntryPoint: "https://idp.example.com/sso",
    samlIssuer: "urn:Vela:sp",
    samlCert: "MIIC123456789012345678901234567890123456789012345678901234567890",
  };
  const xml = generateSamlMetadata("https://localhost:20127", settings);
  assert.match(xml, /entityID="urn:Vela:sp"/);
  assert.match(xml, /Location="https:\/\/localhost:20127\/api\/auth\/saml\/acs"/);
});

  it("Claims Extraction pickSamlEmail & pickSamlDisplayName", () => {
  const profile = { email: "test@example.com", name: "Test User" };
    assert.equal(pickSamlEmail(profile, {}), "test@example.com");
    assert.equal(pickSamlDisplayName(profile, {}), "Test User");
  });
});
