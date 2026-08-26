"use client";

import { useState } from "react";
import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Button, Input } from "@/shared/components";

export default function SSOSection({ settings, loading, patch, toggle, setString }) {
  if (!settings) return null;
  const authMode = settings.authMode || "password";
  const ssoType = settings.ssoType || "oidc";

  return (
    <SettingsSection icon="key" title="Authentication & SSO" accent="amber">
      <div className="flex flex-col gap-4">
        {/* Auth mode */}
        <div>
          <label className="font-medium text-sm block mb-2">Auth Mode</label>
          <div className="flex flex-wrap gap-2">
            {["password", "sso", "both"].map((mode) => (
              <button key={mode} type="button" onClick={() => setString("authMode", mode)} disabled={loading}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium border transition-all capitalize ${
                  authMode === mode ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:border-primary/40"
                }`}>
                {mode === "both" ? "Password + SSO" : mode}
              </button>
            ))}
          </div>
        </div>

        {(authMode === "sso" || authMode === "both") && (
          <>
            <hr className="border-border/50" />

            <div>
              <label className="font-medium text-sm block mb-2">SSO Type</label>
              <div className="flex gap-2">
                {["oidc", "saml"].map((type) => (
                  <button key={type} type="button" onClick={() => setString("ssoType", type)} disabled={loading}
                    className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium border transition-all uppercase ${
                      ssoType === type ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted hover:border-primary/40"
                    }`}>
                    {type === "oidc" ? "OIDC" : "SAML 2.0"}
                  </button>
                ))}
              </div>
            </div>

            {ssoType === "oidc" ? <OIDCForm settings={settings} loading={loading} />
              : <SAMLForm settings={settings} loading={loading} />}
          </>
        )}

        <hr className="border-border/50" />

        <SettingsRow label="API Key required" desc="Require an API key for gateway requests">
          <Toggle checked={settings.requireApiKey !== false} onChange={() => toggle("requireApiKey")} disabled={loading} />
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}

/** Save helper — PATCHes the given settings keys, returns {ok, error}. */
async function saveKeys(patchObj) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patchObj),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data } : { ok: false, error: data.error || "Failed" };
}

function OIDCForm({ settings, loading }) {
  const [issuer, setIssuer] = useState(settings.oidcIssuerUrl || "");
  const [clientId, setClientId] = useState(settings.oidcClientId || "");
  const [secret, setSecret] = useState("");
  const [scopes, setScopes] = useState(settings.oidcScopes || "openid profile email");
  const [label, setLabel] = useState(settings.oidcLoginLabel || "Sign in with OIDC");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });

  const configured = settings.oidcConfigured === true;

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg({ type: "", message: "" });
    const body = { oidcIssuerUrl: issuer, oidcClientId: clientId, oidcScopes: scopes, oidcLoginLabel: label };
    if (secret.trim()) body.oidcClientSecret = secret.trim(); // empty = keep stored
    const { ok, error } = await saveKeys(body);
    if (ok) { setMsg({ type: "success", message: "Saved" }); setSecret(""); }
    else setMsg({ type: "error", message: error });
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3 pt-2 border-t border-border/50">
      <div>
        <label className="text-xs font-medium block mb-1">Issuer URL</label>
        <Input placeholder="https://accounts.google.com" value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={loading} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Client ID</label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Client Secret</label>
          <Input type="password" placeholder={configured ? "Configured — enter a new secret to rotate" : "Client secret"} value={secret} onChange={(e) => setSecret(e.target.value)} disabled={loading} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Scopes</label>
          <Input value={scopes} onChange={(e) => setScopes(e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Login Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={loading} />
        </div>
      </div>
      {msg.message && <p className={`text-xs ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>{msg.message}</p>}
      <Button type="submit" variant="primary" loading={busy} size="sm" className="self-start">Save OIDC</Button>
    </form>
  );
}

function SAMLForm({ settings, loading }) {
  const [entryPoint, setEntryPoint] = useState(settings.samlEntryPoint || "");
  const [issuer, setIssuer] = useState(settings.samlIssuer || "urn:Vela:sp");
  const [cert, setCert] = useState(settings.samlCert || "");
  const [label, setLabel] = useState(settings.samlLoginLabel || "Sign in with SAML SSO");
  const [attrEmail, setAttrEmail] = useState(settings.samlAttributeEmail || "email");
  const [attrName, setAttrName] = useState(settings.samlAttributeName || "name");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg({ type: "", message: "" });
    const { ok, error } = await saveKeys({
      samlEntryPoint: entryPoint, samlIssuer: issuer, samlCert: cert, samlLoginLabel: label,
      samlAttributeEmail: attrEmail, samlAttributeName: attrName,
    });
    setMsg(ok ? { type: "success", message: "Saved" } : { type: "error", message: error });
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3 pt-2 border-t border-border/50">
      <div>
        <label className="text-xs font-medium block mb-1">Entry Point</label>
        <Input placeholder="https://idp.example.com/sso/saml" value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} disabled={loading} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Issuer (SP Entity ID)</label>
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Login Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={loading} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Email Attribute</label>
          <Input value={attrEmail} onChange={(e) => setAttrEmail(e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Name Attribute</label>
          <Input value={attrName} onChange={(e) => setAttrName(e.target.value)} disabled={loading} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">IdP Certificate (PEM)</label>
        <textarea rows={4} value={cert} onChange={(e) => setCert(e.target.value)} disabled={loading}
          className="w-full rounded-lg border bg-surface-2 text-sm p-3 font-mono text-xs resize-y"
          placeholder="-----BEGIN CERTIFICATE-----&#10;..." />
      </div>
      {msg.message && <p className={`text-xs ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>{msg.message}</p>}
      <Button type="submit" variant="primary" loading={busy} size="sm" className="self-start">Save SAML</Button>
    </form>
  );
}