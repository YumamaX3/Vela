"use client";
// Single Sign-On — the enterprise door, SAML 2.0 or OIDC.
//
// This is the room's heaviest lens, and it was the old page's deepest wound: a
// 600-line form folded inside a collapsed accordion, closed by default, in a
// 1,710-line room. An operator who came to configure SSO arrived at a header
// they had to click again. Here the TAB is the disclosure — it stayed collapsed
// only because that page had nowhere else to put it.
//
// Two other things moved on purpose. The posture notice ("SSO is active,
// password login is disabled") lived at the very bottom, under the whole form;
// it now sits at the top, because it describes what the form is about to do.
// And every blue/indigo hue the old markup wore is the room's single coral.
import { useState, useEffect, useRef } from "react";
import { Button, Card, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { testOidc, testSaml } from "../../lib/settingsApi";
import StatusLine from "../StatusLine";

const OIDC_KEYS = [
  "authMode",
  "ssoType",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcScopes",
  "oidcLoginLabel",
  "oidcClientSecret",
];

const SAML_KEYS = [
  "authMode",
  "ssoType",
  "samlEntryPoint",
  "samlIssuer",
  "samlCert",
  "samlLoginLabel",
  "samlAttributeEmail",
  "samlAttributeName",
];

export default function SsoTab({ deck }) {
  const { settings, loading, patch } = deck;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const oidcRedirectUri = origin ? `${origin}/api/auth/oidc/callback` : "/api/auth/oidc/callback";
  const samlAcsUrl = origin ? `${origin}/api/auth/saml/acs` : "/api/auth/saml/acs";
  const samlMetadataUrl = origin ? `${origin}/api/auth/saml/metadata` : "/api/auth/saml/metadata";

  const [ssoTypeTab, setSsoTypeTab] = useState("saml");

  const [oidcForm, setOidcForm] = useState({
    authMode: "password",
    oidcIssuerUrl: "",
    oidcClientId: "",
    oidcScopes: "openid profile email",
    oidcLoginLabel: "Sign in with OIDC",
  });
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcStatus, setOidcStatus] = useState({ type: "", message: "" });
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState({ type: "", message: "" });

  const [samlForm, setSamlForm] = useState({
    samlEntryPoint: "",
    samlIssuer: "urn:Vela:sp",
    samlCert: "",
    samlLoginLabel: "Sign in with SAML SSO",
    samlAttributeEmail: "email",
    samlAttributeName: "name",
  });
  const [samlStatus, setSamlStatus] = useState({ type: "", message: "" });
  const [samlLoading, setSamlLoading] = useState(false);
  const [samlTestLoading, setSamlTestLoading] = useState(false);
  const [samlTestStatus, setSamlTestStatus] = useState({ type: "", message: "" });
  const [showSamlGuide, setShowSamlGuide] = useState(false);
  const idpMetadataFileRef = useRef(null);
  const certFileRef = useRef(null);

  // Hydrate ONCE, from the first loaded settings — never on every later change.
  // `deck.settings` is replaced by each successful patch, so an effect keyed on
  // it alone would rewrite the operator's half-typed issuer URL the moment any
  // other row saved. The old room hydrated from a mount-once fetch; this is the
  // same guarantee, phrased for a deck that reloads.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || loading) return;
    hydrated.current = true;
    setOidcForm({
      authMode: settings?.authMode || "password",
      oidcIssuerUrl: settings?.oidcIssuerUrl || "",
      oidcClientId: settings?.oidcClientId || "",
      oidcScopes: settings?.oidcScopes || "openid profile email",
      oidcLoginLabel: settings?.oidcLoginLabel || "Sign in with OIDC",
    });
    setOidcClientSecret("");
    setSsoTypeTab(settings?.ssoType || "saml");
    setSamlForm({
      samlEntryPoint: settings?.samlEntryPoint || "",
      samlIssuer: settings?.samlIssuer || "urn:Vela:sp",
      samlCert: settings?.samlCert || "",
      samlLoginLabel: settings?.samlLoginLabel || "Sign in with SAML SSO",
      samlAttributeEmail: settings?.samlAttributeEmail || "email",
      samlAttributeName: settings?.samlAttributeName || "name",
    });
  }, [loading, settings]);

  const updateOidcForm = (field, value) => setOidcForm((prev) => ({ ...prev, [field]: value }));
  const updateSamlForm = (field, value) => setSamlForm((prev) => ({ ...prev, [field]: value }));

  const saveOidcSettings = async (authMode = oidcForm.authMode || "password") => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (authMode !== "password" && (!issuerUrl || !clientId || !secret) && !settings.oidcConfigured) {
      setOidcStatus({
        type: "error",
        message: "Issuer URL, client ID, and client secret are required to enable OIDC.",
      });
      return;
    }

    setOidcLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    const payload = {
      authMode,
      ssoType: "oidc",
      oidcIssuerUrl: issuerUrl,
      oidcClientId: clientId,
      oidcScopes: scopes || "openid profile email",
      oidcLoginLabel: loginLabel || "Sign in with OIDC",
    };
    if (secret) payload.oidcClientSecret = secret;

    const r = await patch(payload, OIDC_KEYS);
    if (r.ok) {
      const data = r.data || {};
      setOidcForm({
        authMode: data.authMode || authMode,
        oidcIssuerUrl: data.oidcIssuerUrl || issuerUrl,
        oidcClientId: data.oidcClientId || clientId,
        oidcScopes: data.oidcScopes || scopes || "openid profile email",
        oidcLoginLabel: data.oidcLoginLabel || loginLabel || "Sign in with OIDC",
      });
      setOidcClientSecret("");
      setOidcStatus({
        type: "success",
        message:
          authMode === "oidc"
            ? "OIDC login enabled"
            : authMode === "both"
              ? "Password and OIDC login enabled"
              : "OIDC settings saved",
      });
    } else {
      setOidcStatus({ type: "error", message: r.error || "Failed to save OIDC settings" });
    }
    setOidcLoading(false);
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({
        type: "error",
        message: "Issuer URL and client ID are required to test the connection.",
      });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    // Save first, then test the SAVED values — a test against unsaved form state
    // would verify a configuration the server is not running.
    const saveBody = {
      authMode: oidcForm.authMode || settings.authMode || "password",
      oidcIssuerUrl: issuerUrl,
      oidcClientId: clientId,
      oidcScopes: scopes || "openid profile email",
      oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || "Sign in with OIDC",
    };
    if (secret) saveBody.oidcClientSecret = secret;

    const saved = await patch(saveBody, OIDC_KEYS);
    if (!saved.ok) {
      setOidcTestStatus({
        type: "error",
        message: saved.error || "Failed to save OIDC settings before testing",
      });
      setOidcTestLoading(false);
      return;
    }

    const s = saved.data || {};
    try {
      const data = await testOidc({
        issuerUrl: s.oidcIssuerUrl || issuerUrl,
        clientId: s.oidcClientId || clientId,
        scopes: s.oidcScopes || scopes || "openid profile email",
      });
      if (data?.ok) {
        const statusMessage = data.clientSecretTested
          ? data.clientSecretValid === true
            ? `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.`
            : `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.`
          : `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({ type: "success", message: statusMessage });
      } else {
        setOidcTestStatus({ type: "error", message: data?.error || "OIDC connection test failed" });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: err.message || "OIDC connection test failed" });
    }
    setOidcTestLoading(false);
  };

  const handleIdpMetadataUpload = (event) => {
    const file = event.target.files?.[0];
    if (idpMetadataFileRef.current) idpMetadataFileRef.current.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xmlText = e.target?.result || "";
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, "text/xml");
        if (doc.querySelector("parsererror")) {
          setSamlStatus({
            type: "error",
            message: "Unable to parse valid SAML IdP metadata from XML file",
          });
          return;
        }

        const entityID = doc.documentElement.getAttribute("entityID") || "";
        // The `*|` selectors are deliberate: IdP metadata declares its own XML
        // namespace, so a bare `SingleSignOnService` selector finds nothing.
        const ssoNodes = Array.from(doc.querySelectorAll("SingleSignOnService, *|SingleSignOnService"));
        let ssoUrl = "";
        for (const node of ssoNodes) {
          const binding = node.getAttribute("Binding") || "";
          const location = node.getAttribute("Location") || "";
          if (location) {
            ssoUrl = location;
            if (binding.includes("HTTP-Redirect")) break;
          }
        }

        const certNodes = Array.from(doc.querySelectorAll("X509Certificate, *|X509Certificate"));
        const certStr = certNodes.length > 0 ? certNodes[0].textContent.trim() : "";

        setSamlForm((prev) => ({
          ...prev,
          samlEntryPoint: ssoUrl || prev.samlEntryPoint,
          samlIssuer: prev.samlIssuer || "urn:Vela:sp",
          samlCert: certStr || prev.samlCert,
        }));

        setSamlStatus({
          type: "success",
          message: `IdP Metadata imported! (SSO URL: ${ssoUrl ? "found" : "not found"}, EntityID: ${entityID ? "found" : "not found"}, Cert: ${certStr ? "found" : "not found"})`,
        });
      } catch {
        setSamlStatus({ type: "error", message: "Error reading IdP Metadata XML file" });
      }
    };
    reader.readAsText(file);
  };

  const handleCertFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (certFileRef.current) certFileRef.current.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result || "";
      setSamlForm((prev) => ({ ...prev, samlCert: text.trim() }));
      setSamlStatus({ type: "success", message: "Certificate file loaded into configuration." });
    };
    reader.readAsText(file);
  };

  const saveSamlSettings = async (targetAuthMode = oidcForm.authMode || "password") => {
    setSamlLoading(true);
    setSamlStatus({ type: "", message: "" });
    setSamlTestStatus({ type: "", message: "" });

    const payload = {
      authMode: targetAuthMode,
      ssoType: "saml",
      samlEntryPoint: samlForm.samlEntryPoint.trim(),
      samlIssuer: samlForm.samlIssuer.trim() || "urn:Vela:sp",
      samlCert: samlForm.samlCert.trim(),
      samlLoginLabel: samlForm.samlLoginLabel.trim() || "Sign in with SAML SSO",
      samlAttributeEmail: samlForm.samlAttributeEmail.trim() || "email",
      samlAttributeName: samlForm.samlAttributeName.trim() || "name",
    };

    const r = await patch(payload, SAML_KEYS);
    if (r.ok) {
      const data = r.data || {};
      setSamlForm({
        samlEntryPoint: data.samlEntryPoint || payload.samlEntryPoint,
        samlIssuer: data.samlIssuer || payload.samlIssuer,
        samlCert: data.samlCert || payload.samlCert,
        samlLoginLabel: data.samlLoginLabel || payload.samlLoginLabel,
        samlAttributeEmail: data.samlAttributeEmail || payload.samlAttributeEmail,
        samlAttributeName: data.samlAttributeName || payload.samlAttributeName,
      });
      setSamlStatus({
        type: "success",
        message:
          targetAuthMode === "sso" || targetAuthMode === "saml"
            ? "SAML SSO login enabled"
            : targetAuthMode === "both"
              ? "Password and SAML SSO login enabled"
              : "SAML 2.0 settings saved",
      });
    } else {
      setSamlStatus({ type: "error", message: r.error || "Failed to save SAML settings" });
    }
    setSamlLoading(false);
  };

  const testSamlConnection = async () => {
    setSamlTestLoading(true);
    setSamlStatus({ type: "", message: "" });
    setSamlTestStatus({ type: "", message: "" });

    try {
      const data = await testSaml({
        samlEntryPoint: samlForm.samlEntryPoint.trim(),
        samlIssuer: samlForm.samlIssuer.trim(),
        samlCert: samlForm.samlCert.trim(),
      });
      if (data?.ok) {
        setSamlTestStatus({ type: "success", message: data.message || "SAML configuration verified!" });
      } else {
        setSamlTestStatus({ type: "error", message: data?.error || "SAML configuration test failed" });
      }
    } catch (err) {
      setSamlTestStatus({
        type: "error",
        message: err.message || "An error occurred while testing SAML configuration",
      });
    }
    setSamlTestLoading(false);
  };

  const protocolName = ssoTypeTab === "saml" ? "SAML 2.0" : "OIDC";
  const protocol = settings.ssoType === "saml" ? "SAML 2.0" : "OIDC";
  const ssoOnly =
    settings.authMode === "sso" || settings.authMode === "saml" || settings.authMode === "oidc";

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px] leading-none">lock_open</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Single Sign-On (SSO)</h3>
          <p className="text-sm text-text-muted mt-0.5">
            Configure enterprise Single Sign-On for dashboard access using SAML 2.0 or OIDC.
          </p>
        </div>
      </div>

      {/* The posture notice leads, because it describes what the form below does. */}
      {ssoOnly && (
        <div className="mb-4">
          <StatusLine
            status={{
              type: "warn",
              message: `SSO login (${protocol}) is currently active. Password login is disabled until you switch back.`,
            }}
          />
        </div>
      )}
      {settings.authMode === "both" && (
        <div className="mb-4">
          <StatusLine
            status={{ type: "warn", message: `Password and SSO login (${protocol}) are both active.` }}
          />
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* SSO protocol switcher */}
        <div>
          <label className="font-medium text-sm text-text-main">SSO Protocol</label>
          <div className="flex p-1 mt-2 rounded-[10px] bg-surface border border-border-subtle">
            {[
              { id: "saml", label: "SAML 2.0" },
              { id: "oidc", label: "OIDC" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSsoTypeTab(p.id)}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-[8px] font-medium text-sm motion-control text-center cursor-pointer",
                  ssoTypeTab === p.id
                    ? "bg-bg text-text-main shadow-[var(--shadow-soft)]"
                    : "text-text-muted hover:text-text-main"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Auth mode */}
        <div>
          <label className="font-medium text-sm text-text-main">Auth Mode</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            {[
              { value: "password", title: "Password only", desc: "Keep legacy password login." },
              {
                value: "sso",
                title: `${protocolName} only`,
                desc: "Require SSO for dashboard access.",
              },
              { value: "both", title: "Both", desc: "Allow password or SSO login." },
            ].map((option) => {
              const currentMode = oidcForm.authMode;
              const active =
                option.value === "password"
                  ? currentMode === "password"
                  : option.value === "sso"
                    ? currentMode === "sso" || currentMode === "saml" || currentMode === "oidc"
                    : currentMode === "both";
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateOidcForm("authMode", option.value)}
                  disabled={loading || oidcLoading || samlLoading}
                  className={cn(
                    "text-left rounded-[10px] border p-3 motion-control cursor-pointer",
                    active
                      ? "border-brand-500 bg-brand-500/5"
                      : "border-border-subtle bg-bg hover:bg-brand-500/5"
                  )}
                >
                  <p className="font-medium text-sm text-text-main">{option.title}</p>
                  <p className="text-sm text-text-muted mt-1">{option.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {ssoTypeTab === "saml" ? (
          /* ---------------------------- SAML panel ---------------------------- */
          <div className="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <div className="rounded-[10px] border border-border-subtle bg-surface overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSamlGuide((prev) => !prev)}
                className="w-full p-3 flex items-center justify-between gap-2 text-left hover:bg-brand-500/5 motion-control cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-500 text-[20px] leading-none">
                    menu_book
                  </span>
                  <div>
                    <p className="font-semibold text-sm text-text-main">
                      IdP Setup Guidelines & Provider Configuration Instructions
                    </p>
                    <p className="text-[11px] text-text-muted">
                      Click to view setup steps for AWS IAM Identity Center, Okta, Entra ID, Keycloak, & Authentik
                    </p>
                  </div>
                </div>
                <span
                  className="material-symbols-outlined text-text-muted motion-control text-[20px] leading-none"
                  style={{ transform: showSamlGuide ? "rotate(180deg)" : "none" }}
                >
                  expand_more
                </span>
              </button>

              {showSamlGuide && (
                <div className="p-4 border-t border-border-subtle text-xs text-text-main flex flex-col gap-3">
                  <div className="p-2.5 rounded-[8px] border border-brand-500/20 bg-brand-500/5 text-brand-700 dark:text-brand-300">
                    <p className="font-semibold mb-1">Required Service Provider (SP) values for your IdP setup:</p>
                    <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                      <li>
                        <b>Assertion Consumer Service (ACS) URL:</b>{" "}
                        <code className="bg-bg px-1 py-0.5 rounded break-all">{samlAcsUrl}</code>
                      </li>
                      <li>
                        <b>SP Entity ID / Audience URI:</b>{" "}
                        <code className="bg-bg px-1 py-0.5 rounded break-all">
                          {samlForm.samlIssuer || "urn:Vela:sp"}
                        </code>
                      </li>
                      <li>
                        <b>NameID Format:</b>{" "}
                        <code className="bg-bg px-1 py-0.5 rounded">EmailAddress</code> or{" "}
                        <code className="bg-bg px-1 py-0.5 rounded">Unspecified</code>
                      </li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-[8px] border border-border-subtle bg-bg/50 flex flex-col gap-1.5">
                      <p className="font-semibold text-text-main">AWS IAM Identity Center</p>
                      <ol className="list-decimal pl-4 text-text-muted space-y-1">
                        <li>Applications → <b>Add application</b> → Select <b>Add custom SAML 2.0 application</b>.</li>
                        <li>Set <b>Application ACS URL</b> to <code className="text-text-main font-mono">{samlAcsUrl}</code>.</li>
                        <li>Set <b>Application SAML audience</b> to <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:Vela:sp"}</code>.</li>
                        <li>Under <i>Attribute mappings</i>, map <code className="text-text-main font-mono">Subject</code> or <code className="text-text-main font-mono">email</code> to <code className="text-text-main font-mono">${`{user:email}`}</code>.</li>
                        <li>Download <b>IAM Identity Center SAML metadata XML</b> file and use 1-Click Import below.</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded-[8px] border border-border-subtle bg-bg/50 flex flex-col gap-1.5">
                      <p className="font-semibold text-text-main">Microsoft Entra ID (Azure AD)</p>
                      <ol className="list-decimal pl-4 text-text-muted space-y-1">
                        <li>Enterprise Applications → <b>New application</b> → <b>Create your own application</b>.</li>
                        <li>Select <b>Single sign-on</b> → <b>SAML</b>.</li>
                        <li><b>Identifier (Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:Vela:sp"}</code></li>
                        <li><b>Reply URL (ACS):</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                        <li>Download <b>Federation Metadata XML</b> and import or copy X.509 Certificate.</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded-[8px] border border-border-subtle bg-bg/50 flex flex-col gap-1.5">
                      <p className="font-semibold text-text-main">Okta / Auth0</p>
                      <ol className="list-decimal pl-4 text-text-muted space-y-1">
                        <li>Applications → <b>Create App Integration</b> → Select <b>SAML 2.0</b>.</li>
                        <li><b>Single Sign-On URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                        <li><b>Audience URI (SP Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:Vela:sp"}</code></li>
                        <li>Name ID format: <i>EmailAddress</i>.</li>
                        <li>Download Identity Provider metadata XML or copy the X.509 cert.</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded-[8px] border border-border-subtle bg-bg/50 flex flex-col gap-1.5">
                      <p className="font-semibold text-text-main">Keycloak / Authentik</p>
                      <ol className="list-decimal pl-4 text-text-muted space-y-1">
                        <li>Clients → <b>Create client</b> → Select <b>SAML</b>.</li>
                        <li><b>Client ID:</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:Vela:sp"}</code></li>
                        <li><b>Master SAML Processing URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                        <li>Export SAML Descriptor XML or copy IDP Certificate PEM.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 rounded-[10px] border border-dashed border-brand-500/40 bg-brand-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm text-text-main">1-Click IdP Metadata XML Import</p>
                <p className="text-xs text-text-muted">Auto-fill SSO URL, Issuer & Cert from XML metadata</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon="upload_file"
                onClick={() => idpMetadataFileRef.current?.click()}
              >
                Upload Metadata XML
              </Button>
              <input
                ref={idpMetadataFileRef}
                type="file"
                accept=".xml,application/xml,text/xml"
                className="hidden"
                onChange={handleIdpMetadataUpload}
              />
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="font-medium text-sm text-text-main">
                  Single Sign-On Service URL (samlEntryPoint)
                </label>
                <Input
                  placeholder="https://idp.example.com/app/saml/sso/..."
                  value={samlForm.samlEntryPoint}
                  onChange={(e) => updateSamlForm("samlEntryPoint", e.target.value)}
                  disabled={loading || samlLoading}
                  className="mt-2"
                />
              </div>

              <div>
                <label className="font-medium text-sm text-text-main">
                  SP Entity ID / Audience (samlIssuer)
                </label>
                <Input
                  placeholder="urn:Vela:sp"
                  value={samlForm.samlIssuer}
                  onChange={(e) => updateSamlForm("samlIssuer", e.target.value)}
                  disabled={loading || samlLoading}
                  className="mt-2"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="font-medium text-sm text-text-main">
                    IdP X.509 Certificate (samlCert)
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon="file_upload"
                    onClick={() => certFileRef.current?.click()}
                  >
                    Upload Certificate
                  </Button>
                  <input
                    ref={certFileRef}
                    type="file"
                    accept=".crt,.pem,.cer,text/plain"
                    className="hidden"
                    onChange={handleCertFileUpload}
                  />
                </div>
                <textarea
                  rows={4}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIIC...&#10;-----END CERTIFICATE-----"
                  value={samlForm.samlCert}
                  onChange={(e) => updateSamlForm("samlCert", e.target.value)}
                  disabled={loading || samlLoading}
                  className="w-full mt-2 p-2.5 rounded-[10px] border border-border-subtle bg-bg text-xs font-mono text-text-main focus:outline-none focus:border-brand-500"
                />
                <p className="text-xs text-text-muted mt-1.5">Paste raw Base64 certificate or PEM block.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="font-medium text-sm text-text-main">Login Button Label</label>
                  <Input
                    placeholder="Sign in with SAML SSO"
                    value={samlForm.samlLoginLabel}
                    onChange={(e) => updateSamlForm("samlLoginLabel", e.target.value)}
                    disabled={loading || samlLoading}
                    className="mt-2"
                  />
                </div>
                <div>
                  <label className="font-medium text-sm text-text-main">Email Claim Attribute</label>
                  <Input
                    placeholder="email"
                    value={samlForm.samlAttributeEmail}
                    onChange={(e) => updateSamlForm("samlAttributeEmail", e.target.value)}
                    disabled={loading || samlLoading}
                    className="mt-2"
                  />
                </div>
                <div>
                  <label className="font-medium text-sm text-text-main">Display Name Claim</label>
                  <Input
                    placeholder="name"
                    value={samlForm.samlAttributeName}
                    onChange={(e) => updateSamlForm("samlAttributeName", e.target.value)}
                    disabled={loading || samlLoading}
                    className="mt-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 p-3 rounded-[10px] border border-border-subtle bg-bg text-sm text-text-muted">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-text-main">ACS Callback URL</p>
                  <code className="block break-all font-mono text-xs">{samlAcsUrl}</code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon="content_copy"
                  onClick={() => {
                    navigator.clipboard.writeText(samlAcsUrl);
                    setSamlStatus({ type: "success", message: "ACS URL copied to clipboard!" });
                  }}
                >
                  Copy
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-text-main">SP XML Metadata</p>
                  <code className="block break-all font-mono text-xs">{samlMetadataUrl}</code>
                </div>
                <a
                  href={samlMetadataUrl}
                  download="Vela-sp-metadata.xml"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px] leading-none">download</span>
                  Download XML
                </a>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border-subtle">
              <Button
                type="button"
                variant="primary"
                loading={samlLoading}
                onClick={() => saveSamlSettings(oidcForm.authMode)}
                className="w-full sm:w-auto"
              >
                Save SAML settings
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={samlTestLoading}
                onClick={testSamlConnection}
                className="w-full sm:w-auto"
              >
                Test SAML settings
              </Button>
            </div>

            <StatusLine status={samlTestStatus} />
            <StatusLine status={samlStatus} />
          </div>
        ) : (
          /* ---------------------------- OIDC panel ---------------------------- */
          <div className="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <div className="flex flex-col gap-4">
              <div>
                <label className="font-medium text-sm text-text-main">Issuer URL</label>
                <Input
                  placeholder="https://auth.example.com/application/o/Vela/"
                  value={oidcForm.oidcIssuerUrl}
                  onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)}
                  disabled={loading || oidcLoading}
                  className="mt-2"
                />
              </div>

              <div>
                <label className="font-medium text-sm text-text-main">Client ID</label>
                <Input
                  placeholder="Vela-dashboard"
                  value={oidcForm.oidcClientId}
                  onChange={(e) => updateOidcForm("oidcClientId", e.target.value)}
                  disabled={loading || oidcLoading}
                  className="mt-2"
                />
              </div>

              <div>
                <label className="font-medium text-sm text-text-main">Client Secret</label>
                <Input
                  type="password"
                  placeholder="Leave blank to keep existing secret"
                  value={oidcClientSecret}
                  onChange={(e) => setOidcClientSecret(e.target.value)}
                  disabled={loading || oidcLoading}
                  className="mt-2"
                />
                <p className="text-xs text-text-muted mt-1.5">This value is write-only after saving.</p>
              </div>

              <div>
                <label className="font-medium text-sm text-text-main">Scopes</label>
                <Input
                  placeholder="openid profile email"
                  value={oidcForm.oidcScopes}
                  onChange={(e) => updateOidcForm("oidcScopes", e.target.value)}
                  disabled={loading || oidcLoading}
                  className="mt-2"
                />
              </div>

              <div>
                <label className="font-medium text-sm text-text-main">Login Button Label</label>
                <Input
                  placeholder="Sign in with OIDC"
                  value={oidcForm.oidcLoginLabel}
                  onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)}
                  disabled={loading || oidcLoading}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="rounded-[10px] border border-border-subtle bg-bg p-3 text-sm text-text-muted">
              <p className="font-medium text-text-main mb-1">Redirect URI</p>
              <code className="block break-all font-mono text-xs">{oidcRedirectUri}</code>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border-subtle">
              <Button
                type="button"
                variant="primary"
                loading={oidcLoading}
                onClick={() => saveOidcSettings()}
                className="w-full sm:w-auto"
              >
                Save OIDC settings
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={oidcTestLoading}
                onClick={testOidcConnection}
                className="w-full sm:w-auto"
              >
                Test connection
              </Button>
            </div>

            <StatusLine status={oidcTestStatus} />
            <StatusLine status={oidcStatus} />
          </div>
        )}
      </div>
    </Card>
  );
}
