# AMRouter Proxy System - Quick Analysis Summary

## 🎯 Core Findings

### 1. Proxy-Related Files (13 key files)
- **Core**: `src/lib/network/connectionProxy.js`, `outboundProxy.js`, `proxyTest.js`
- **MITM**: `src/mitm/config.js`, `handlers/base.js`, `cert/rootCA.js`
- **Tunnel**: `src/lib/tunnel/` (cloudflare + tailscale modules)
- **Automation**: `src/automation/cloudflare_signup.py` (2,839 lines)

---

### 2. MITM Architecture Overview

**How it intercepts traffic:**

```
IDE → HTTPS to localhost:8080 (MITM) 
     ↓
Dynamic leaf cert signed by Root CA (generates per domain)
     ↓
Extract request → Apply model aliases → Forward to 9Router
     ↓
Response piped back via SSE streaming
```

**Target Tools & Hosts:**
- Antigravity: `daily-cloudcode-pa.googleapis.com`
- Copilot: `api.individual.githubcopilot.com`  
- Cursor: `api2.cursor.sh`
- Kiro: `q.us-east-1.amazonaws.com`

**Key Functions:**
- Line 57-79 (`config.js`): `getToolForHost()` routes by domain
- Line 12-33 (`antigravity.js`): `intercept()` - main handler
- Line 45-68 (`base.js`): `pipeSSE()` - zero-buffer streaming

**Role of Proxies:**
MITM runs as local HTTPS proxy (localhost:8080). IDEs configured to use this proxy. When IDE connects to upstream, MITM decrypts → forwards to 9Router which may apply proxy pool → returns response.

---

### 3. Proxy Selection & Rotation

**Priority Resolution** (`connectionProxy.js` lines 39-160):
1. **Proxy Pool** (from UI selection or auto-pick)
2. **Legacy Proxy** (single hardcoded URL)
3. **No Proxy** (direct)

**Supported Types:**
- HTTP/S proxies (`http://`, `https://`)
- SOCKS5 (`socks5://host:port`)
- Relay proxies (Vercel/Cloudflare/Deno - special case)

**Auto-Rotation Strategy:**
- VansRouter adds EWMA-based fitness scoring (α=0.3)
- Unfit TTL: `country_blocked`=24h, `ip_capped`=1h
- Auto-heal after timeout expires

---

### 4. Cloudflare Workers AI Automation Flow

**Complete Pipeline** (`cloudflare_signup.py`):

```python
Phase 1: Email Provisioning (Ammail API)
   └─ Create inbox → Poll for verification email

Phase 2: Turnstile Solving (2Captcha)  
   └─ Scrape sitekey → Submit task → Poll for token

Phase 3: Account Creation (Camoufox browser)
   └─ Navigate → Fill form → Solve captcha → Verify email

Phase 4: Token Creation (Two strategies)
   A) Global API Key route (preferred)
      └─ Parse GAK from email → CF API call → Scoped token
   B) Session-based route (fallback)
      └─ Playwright request.fetch() with cookies → CF API → Token

Phase 5: Store Credentials
   └─ Output JSON → Backend stores in DB → Ready for use
```

**How Keys Get Added:**
1. Automation outputs: `{"api_key": "cfk_...", "account_id": "...", "email": "..."}`
2. Backend parses stdout, encrypts credentials
3. Creates connection record in SQLite
4. UI shows new connection ready to use

**Integration Points:**
- Lines 58-168: Ammail helpers (inbox creation, polling)
- Lines 175-215: Turnstile solver (scrapes live sitekey)
- Lines 1850-1925: Global API key token creation
- Lines 1928-2010: Session-based fallback

---

### 5. Tunnel Integration

**Cloudflare Quick Tunnel** (`tunnel/cloudflare/`):
- Spawns `cloudflared tunnel --url http://localhost:3001`
- Registers shortId + tunnelUrl with central worker
- Health checks both direct + public URLs
- Auto-restart on unexpected exit

**Tailscale Funnel** (`tunnel/tailscale/`):
- Installs via Homebrew (macOS) / curl script (Linux) / MSI (Windows)
- Custom socket path: `~/.amrouter/tailscale/tailscaled.sock`
- TUN mode (sudo) for Funnel TLS / userspace mode fallback
- Extracts DNSName for public URL: `https://<device>.ts.net`

**State Persistence** (`tunnel/shared/state.js`):
```javascript
fs.writeFileSync(state.json, {shortId, tunnelUrl})
// Survives restart, enables instant resume
```

---

### 6. Connection Proxy Config Per Provider

**Standard Providers:**
```javascript
{ authType: "apikey", authHeader: "bearer" }
// Uses HTTP_PROXY env var
```

**Relay-Based Providers:**
```javascript
if (proxyPool.type === "vercel") {
  return { source: "vercel", connectionProxyEnabled: false, vercelRelayUrl: url };
}
// Uses URL rewriting + custom headers instead
```

**Environment Management** (`outboundProxy.js`):
```javascript
process.env.NINE_ROUTER_PROXY_MANAGED = "1"; // Track ownership
process.env.HTTP_PROXY = url; // Apply to child processes
// Only cleans what we manage
```

---

## ✨ Unique Patterns Worth Absorbing into Vela

| Pattern | Location | Value for Vela | Effort |
|---------|----------|----------------|--------|
| **MITM Certificate Lifecycle** | `mitm/cert/rootCA.js` (175 lines) | Auto-generate root CA + dynamic leaf certs | 2h |
| **Model Alias Canonicalization** | `mitm/config.js` (lines 34-69) | Synonym + regex pattern chain for model names | 2h |
| **Automated Account Provisioning** | `automation/cloudflare_signup.py` | End-to-end signup automation (email → captcha → token) | 8h+ |
| **Tunnel Stateful Resilience** | `tunnel/cloudflare/manager.js` | Persistent state + dual-health probing + smart reuse | 1h |
| **Cleanup-Aware Env Vars** | `network/outboundProxy.js` | Flag managed vars, avoid clobbering user config | 30m |
| **Socks5 Dispatcher Detection** | `network/proxyTest.js` | Scheme-based undici dispatcher factory | 3h |
| **Relay Proxy Abstraction** | `network/connectionProxy.js` (lines 74-88) | Special-case handling for Vercel/CF relays | 2h |

---

## 🚀 Immediate Actions for Vela

1. **Copy alias resolution engine** (`mitm/config.js` lines 34-69)
   - Adds compatibility for provider model renames
   - Reduces maintenance burden

2. **Implement cleanup-aware env management**
   ```javascript
   process.env.NINE_ROUTER_PROXY_MANAGED = "1";
   // Only delete these on disable
   ```

3. **Add tunnel state persistence**
   - Save `shortId`, `tunnelUrl` to file
   - Probe before respawn on restart

4. **Integrate Socks5 support**
   - Use undici's built-in `Socks5ProxyAgent`
   - Test all proxy types in test suite

5. **Consider automating account provisioning**
   - Reuse Python automation framework
   - Extract captcha solver as generic module

---

## 📁 File Reference Map

| Functionality | File Path | Line Range |
|---------------|-----------|------------|
| MITM Config | `src/mitm/config.js` | 1-89 |
| MITM Handlers | `src/mitm/handlers/base.js` | 1-227 |
| Proxy Resolution | `src/lib/network/connectionProxy.js` | 1-160 |
| Proxy Env Mgmt | `src/lib/network/outboundProxy.js` | 1-68 |
| Proxy Testing | `src/lib/network/proxyTest.js` | 1-91 |
| Root CA Gen | `src/mitm/cert/rootCA.js` | 1-175 |
| Tunnel Manager | `src/lib/tunnel/cloudflare/manager.js` | 1-151 |
| Tailscale CLI | `src/lib/tunnel/tailscale/tailscale.js` | 1-790 |
| Tunnel State | `src/lib/tunnel/shared/state.js` | 1-41 |
| CF Automation | `src/automation/cloudflare_signup.py` | 1-2839 |

---

*Summary prepared from deep analysis of AMRouter codebase. Full report available at `AMRouter_Proxy_System_Analysis.md`.*
