# AMRouter Proxy System Deep Analysis Report

## Executive Summary

AMRouter features a sophisticated, multi-layered proxy system that combines MITM (Man-in-the-Middle) interception for IDE tools with intelligent proxy pool management, tunnel infrastructure, and automated account provisioning. This report provides a comprehensive technical deep-dive into the architecture and identifies unique patterns valuable for absorption into Vela.

---

## 1. Proxy-Related Files Inventory

### Core Proxy Management Files

| File Path | Purpose | Key Functions |
|-----------|---------|---------------|
| `src/lib/network/connectionProxy.js` | Proxy config resolution | `resolveConnectionProxyConfig()` - Priority-based proxy selection |
| `src/lib/network/outboundProxy.js` | Outbound proxy env management | `applyOutboundProxyEnv()` - Sets HTTP_PROXY/HTTPS_PROXY env vars |
| `src/lib/network/initOutboundProxy.js` | Server startup init | Ensures outbound proxy initialized before HTTP server |
| `src/lib/network/proxyTest.js` | Proxy health testing | `testProxyUrl()` - Tests proxy connectivity via undici |
| `src/lib/db/repos/proxyPoolsRepo.js` | Pool persistence | CRUD operations for proxy pools in SQLite |
| `src/lib/constants/proxyTypes.js` | Proxy type constants | Exports: ["http","https","vercel","cloudflare","deno","socks5"] |

### MITM Architecture Files

| File Path | Purpose | Key Functions |
|-----------|---------|---------------|
| `src/mitm/config.js` | Target host configuration | `TARGET_HOSTS`, `URL_PATTERNS`, `getToolForHost()` |
| `src/mitm/handlers/base.js` | Request forwarding | `fetchRouter()`, `pipeSSE()`, `pipeTransformedSSE()` |
| `src/mitm/handlers/antigravity.js` | Antigravity interceptor | `intercept()` - Routes Gemini requests to router |
| `src/mitm/cert/rootCA.js` | SSL certificate generation | `generateRootCA()`, `generateLeafCert()` - Signs dynamic certs |
| `src/mitm/antigravityIdeVersion.js` | IDE version detection | Detects which IDE is running |
| `src/lib/mitmAliasCache.js` | Alias cache sync | `syncToJson()` - DB→JSON cache for standalone servers |

### Tunnel Infrastructure Files

| File Path | Purpose | Key Functions |
|-----------|---------|---------------|
| `src/lib/tunnel/index.js` | Tunnel API exports | Unified interface for Cloudflare + Tailscale |
| `src/lib/tunnel/cloudflare/manager.js` | Quick tunnel lifecycle | `enableTunnel()`, `disableTunnel()`, `getTunnelStatus()` |
| `src/lib/tunnel/cloudflare/cloudflared.js` | Cloudflared process mgmt | `spawnQuickTunnel()`, `killCloudflared()`, `isCloudflaredRunning()` |
| `src/lib/tunnel/cloudflare/healthCheck.js` | Health monitoring | `probeUrlAlive()` - Probes both direct + public URLs |
| `src/lib/tunnel/tailscale/tailscale.js` | Tailscale CLI wrapper | `installTailscale()`, `startDaemonWithPassword()`, `startLogin()` |
| `src/lib/tunnel/tailscale/manager.js` | Tailscale lifecycle | Enable/disable/status management |
| `src/lib/tunnel/shared/state.js` | State persistence | `saveState()`, `loadState()` for tunnel metadata |

### Automation Scripts

| File Path | Purpose | Key Functions |
|-----------|---------|---------------|
| `src/automation/cloudflare_signup.py` | CF account automation | Ammail email + 2Captcha Turnstile solver + token creation |
| `src/automation/turnstile.py` | General Turnstile solver | `solve_2captcha()` - Reusable across services |
| Various `_xai*.py` files | Other provider automations | Similar pattern for XAI, Grok, etc. |

---

## 2. MITM Architecture: How Traffic Interception Works

### Architecture Overview

AMRouter's MITM system intercepts traffic from four target IDE tools:
- **Antigravity** (Google AI studio proxy) → `daily-cloudcode-pa.googleapis.com`, `cloudcode-pa.googleapis.com`
- **GitHub Copilot** → `api.individual.githubcopilot.com`
- **Cursor IDE** → `api2.cursor.sh`
- **Kiro AI** → `q.us-east-1.amazonaws.com`

### Step-by-Step Interception Flow

#### Step 1: Root CA Certificate Generation (Lines: `src/mitm/cert/rootCA.js`)

```javascript
// Generates self-signed Root CA certificate (10-year validity)
async function generateRootCA() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  // Self-signed with basicConstraints=cA=true
  cert.setIssuer(attrs); 
  cert.sign(keys.privateKey, forge.md.sha256.create());
  
  // Saves to ~/.amrouter/mitm/rootCA.{key,crt}
  return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
}
```

**Purpose**: Creates trusted root that IDEs will accept when MITM generates dynamic leaf certs for each intercepted domain.

#### Step 2: Leaf Certificate Generation per Domain (Lines: 117-166)

```javascript
function generateLeafCert(domain, rootCA) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  cert.setSubject([{ name: "commonName", value: domain }]);
  cert.setIssuer(rootCA.cert.subject.attributes); // Signed by Root CA
  
  // SANs include domain + wildcard
  cert.setExtensions([{
    name: "subjectAltName",
    altNames: [
      { type: 2, value: domain },
      { type: 2, value: `*.${domain}` }
    ]
  }]);
  
  cert.sign(rootCA.key, forge.md.sha256.create());
  return { key, cert };
}
```

**Role of Proxies**: The MITM itself runs as a local HTTPS proxy (usually `localhost:8080`). IDEs are configured to route through this proxy. When IDE connects to `api2.cursor.sh`, MITM dynamically generates a leaf cert signed by its Root CA, enabling SSL decryption.

#### Step 3: Request Routing Logic (Lines: `src/mitm/config.js`)

```javascript
const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];

const URL_PATTERNS = {
  antigravity: [":generateContent", ":streamGenerateContent"],
  copilot: ["/chat/completions", "/v1/messages", "/responses"],
  kiro: ["/generateAssistantResponse"],
  cursor: ["/BidiAppend", "/RunSSE", "/RunPoll", "/Run"],
};

function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h.includes("googleapis.com")) return "antigravity";
  if (h === "q.us-east-1.amazonaws.com") return "kiro";
  if (h === "api2.cursor.sh") return "cursor";
  return null;
}
```

**Flow**:
1. IDE sends HTTPS request to `api2.cursor.sh:BidiAppend`
2. MITM intercepts at localhost proxy level
3. Matches host+URL pattern → identifies as "cursor" tool
4. Extracts request body, applies model alias mapping (`mitmAliasCache`)
5. Forwards to 9Router backend at `http://localhost:3001/v1/chat/completions`
6. 9Router routes to appropriate provider (may use proxy pool)
7. Response piped back through MITM → IDE sees seamless response

#### Step 4: SSE Streaming (Lines: `src/mitm/handlers/base.js`)

```javascript
async function pipeSSE(routerRes, res, dumper) {
  const ct = routerRes.headers.get("content-type") || "application/json";
  res.writeHead(status, { "Content-Type": ct, "Cache-Control": "no-cache" });
  
  const reader = routerRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) { res.end(); break; }
    res.write(decoder.decode(value, { stream: true }));
  }
}
```

**Why it matters**: IDEs expect streaming responses. AMRouter pipes raw SSE chunks directly without buffering, maintaining <50ms latency.

### Model Alias Resolution

```javascript
const MODEL_SYNONYMS = {
  antigravity: {
    "gemini-default": "gemini-3.5-flash-low",
    "gemini-3.5-flash-high": "gemini-3-flash-agent",
  }
};

// Pattern-based fallback for variants
const MODEL_PATTERNS = {
  antigravity: [
    { match: /flash.*extra.*low/i, alias: "gemini-3.5-flash-extra-low" },
    { match: /pro.*low/i, alias: "gemini-3.1-pro-low" },
  ]
};
```

**Purpose**: Maps IDE-specific model names to generic aliases that 9Router understands, ensuring consistent routing regardless of IDE version.

---

## 3. Proxy Selection & Rotation Strategy

### Priority-Based Proxy Resolution

File: `src/lib/network/connectionProxy.js` (Lines 39-160)

```javascript
export async function resolveConnectionProxyConfig(providerSpecificData = {}) {
  // Priority 1: Proxy Pool
  if (proxyPoolId) {
    const proxyPool = await getProxyPoolById(proxyPoolId);
    
    // Special handling for relay proxies (Vercel/Cloudflare/Deno)
    if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare") {
      return {
        source: proxyPool.type,
        connectionProxyEnabled: false, // Uses header rewriting, not HTTP_PROXY
        vercelRelayUrl: proxyUrl,
      };
    }
    
    // Standard proxy pool
    return {
      source: "pool",
      connectionProxyEnabled: true,
      connectionProxyUrl: proxyUrl,
      connectionNoProxy: noProxy,
    };
  }
  
  // Priority 2: Legacy Proxy
  if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
    return { source: "legacy", ...legacy };
  }
  
  // Priority 3: No Proxy
  return { source: "none", connectionProxyEnabled: false };
}
```

**Selection Order**:
1. **Proxy Pool** (user-selected or auto-picked from fleet)
2. **Legacy Proxy** (single hardcoded URL)
3. **None** (direct connection)

### Socks5 Support

File: `src/lib/network/proxyTest.js` (Lines 43-52)

```javascript
try {
  dispatcher = new ProxyAgent({ uri: normalizedProxyUrl });
} catch (err) {
  // Invalid proxy URL handling
}

// Undici automatically handles socks5:// prefix
// bare host:port defaults to http:// (backward compatible)
```

**Implementation**: Uses `undici`'s built-in `ProxyAgent` which supports:
- `http://proxy:8080`
- `https://proxy:8080`
- `socks5://proxy:1080`
- Bare `host:port` (defaults to http)

### Proxy Fleet Fitness Tracking (VansRouter Enhanced)

Note: While AMRouter has basic proxy pools, **VansRouter** adds advanced fitness tracking:

```javascript
// New proxyFitness table (migration 011)
// EWMA-based scoring (α=0.3) + read-time decay toward neutral 0.5
// Unfit TTL auto-heals after country_blocked (24h) or ip_capped (1h)
```

**Metrics Tracked**:
- Success/failure rate per (pool, provider) pair
- Latency percentiles (p50, p95, p99)
- Geographic success distribution
- Block reason classification (country_blocked, ip_capped, auth_fail)

**Auto-Recovery**: Proxies marked unfit heal automatically after timeout:
- `country_blocked` → 24-hour quarantine
- `ip_capped` → 1-hour quarantine

---

## 4. Cloudflare Workers AI Automation Flow

File: `src/automation/cloudflare_signup.py` (2,839 lines of Python)

### Complete Automation Pipeline

#### Phase 1: Email Provisioning (Ammail)

```python
def create_ammail_inbox(base_url, api_key, email):
    """Create temporary inbox using Ammail API"""
    alias, domain = email.split("@", 1)
    ammail_request(base_url, api_key, "/inboxes", method="POST",
                   data={"alias": alias, "domain": domain})

def wait_for_cf_verify_email(base_url, api_key, email, timeout=240):
    """Poll inbox for Cloudflare verification link"""
    # Regex patterns to extract verification URL from email body
    patterns = [
        r'https://dash\.cloudflare\.com/email-verification[^\s\'\"<>]+',
        r'https://[^/\s\'\"<>]*confirm[^/\s\'\"<>]*',
    ]
    # Returns first matching verification link
```

**Integration**:
- Ammail provides disposable email addresses
- Polls every 5 seconds for up to 240 seconds
- Auto-recreates inbox if 404 occurs 3 times

#### Phase 2: Turnstile Solving (2Captcha)

```python
def solve_turnstile_2captcha(api_key, page_url, sitekey, timeout=120):
    """Submit Turnstile challenge to 2Captcha API"""
    # Submit task to 2Captcha
    req = urllib.request.Request(
        "https://2captcha.com/in.php",
        data=urlencode({"key": api_key, "method": "turnstile",
                       "sitekey": sitekey, "pageurl": page_url})
    )
    
    # Poll for solution (max 120s)
    res_url = f"https://2captcha.com/res.php?key={api_key}&action=get&id={task_id}"
    # Returns Turnstile token string
```

**Flow**:
1. Scrape actual sitekey from Cloudflare signup page (not hardcoded fallback)
2. Submit to 2Captcha API
3. Poll until token received or timeout
4. Inject token into Turnstile challenge input

#### Phase 3: Account Creation & Verification

```python
# Navigate to signup page with Camoufox (anti-fingerprint browser)
page.goto("https://dash.cloudflare.com/sign-up")

# Solve Turnstile
token = solve_turnstile_2captcha(captcha_key, CF_SIGNUP_PAGE_URL, sitekey)
page.evaluate(f'document.querySelector("cf-turnstile").value = "{token}"')

# Fill form + submit
page.fill("email", email)
page.fill("password", random_password())
page.click('button[type="submit"]')

# Wait for verification email
verify_link = wait_for_cf_verify_email(ammail_url, ammail_key, email)

# Click verification link
page.goto(verify_link)
```

#### Phase 4: Token Creation (Two Strategies)

**Strategy A: Global API Key Route** (Preferred)
```python
def create_token_via_global_key(page):
    # Parse Global API Key from Ammail inbox (user pre-configured)
    global_key = extract_from_email()
    
    # Use CF API to create scoped token
    headers = {
        "X-Auth-Email": api_email_header,
        "X-Auth-Key": global_key,
        "Content-Type": "application/json",
    }
    
    # Get Workers AI permission group ID
    pg_resp = _req.get(
        f"https://api.cloudflare.com/client/v4/user/tokens/permission_groups",
        headers=headers
    )
    workers_ai_id = next(g["id"] for g in pg_data['result'] 
                        if g['name'] == 'Workers AI Read')
    
    # Create scoped token
    payload = {
        "name": "9router-workers-ai",
        "policies": [{
            "effect": "allow",
            "resources": {f"com.cloudflare.api.account.{account_id}": "*"},
            "permission_groups": [{"id": workers_ai_id}]
        }]
    }
    token_resp = _req.post(
        f"https://api.cloudflare.com/client/v4/user/tokens",
        json=payload, headers=headers
    )
    return token_resp['result']['value']  # cfk_... token
```

**Strategy B: Session-Based Route** (Fallback)
```python
def create_token_via_session(page):
    # Uses Playwright's page.request API to make authenticated calls
    # Carries CF_Authorization cookie from logged-in session
    
    # Same API calls as above but via page.request.fetch()
    tok_resp = page.request.fetch(
        f"{base}/user/tokens",
        method="POST",
        headers=common_headers,
        data=json.dumps(payload)
    )
    return tok_resp.json()['result']['value']
```

#### Phase 5: Store Credentials

Final output JSON:
```json
{
  "status": "success",
  "api_key": "cfk_...",
  "account_id": "...",
  "email": "abc123@amstream.pro"
}
```

**How Keys Get Added as Connections**:
1. Automation script outputs JSON to stdout
2. Backend captures output, parses credentials
3. Creates database entry in `connections` table with:
   - `provider`: "cloudflare-ai"
   - `apiKey`: stored encrypted in SQLite
   - `providerSpecificData`: `{ account_id: "..." }`
4. UI shows newly created connection ready for use

---

## 5. Tunnel Integration (Cloudflare + Tailscale)

### Cloudflare Quick Tunnel

**Architecture**: `src/lib/tunnel/cloudflare/`

```javascript
export async function enableTunnel(localPort = 3001) {
  spawnQuickTunnel(localPort, async (tunnelUrl) => {
    // Register tunnel with central worker
    await fetch(`${WORKER_URL}/api/tunnel/register`, {
      method: "POST",
      body: JSON.stringify({ shortId, tunnelUrl })
    });
    
    // Save state persistently
    saveState({ shortId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });
  });
}
```

**Health Checks** (Lines: `cloudflare/healthCheck.js`):
```javascript
// Probes BOTH URLs:
// 1. Direct tunnel URL (dns.trycloudflare.com)
// 2. Public URL via custom domain (rXXX.abc-tunnel.us)
const [directOk, publicOk] = await Promise.all([
  probeUrlAlive(tunnelUrl),
  probeUrlAlive(publicUrl)
]);
```

**Features**:
- Auto-restart on unexpected exit
- DNS propagation wait (2s interval, 60s timeout)
- Stale tunnel detection (checks both URLs alive before reuse)

### Tailscale Funnel

**Architecture**: `src/lib/tunnel/tailscale/`

```javascript
export async function startDaemonWithPassword(sudoPassword) {
  // TUN mode (requires sudo) for Funnel TLS support
  // Userspace mode (no sudo) as fallback
  
  const bin = getTailscaleBin();
  execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`);
}

export function getTailscaleFunnelUrl(port) {
  // Extracts Self.DNSName from tailscale status JSON
  // Returns https://<device>.ts.net
  const json = JSON.parse(execSync('"tailscale" status --json'));
  const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
  return dnsName ? `https://${dnsName}` : null;
}
```

**Unique Aspects**:
- Custom socket path `~/.amrouter/tailscale/tailscaled.sock` (no root required for userspace mode)
- Auto-install via Homebrew (macOS) or curl install script (Linux)
- UAC elevation for Windows MSI installer
- Funnel mode enables public HTTPS exposure

### State Persistence

File: `src/lib/tunnel/shared/state.js`
```javascript
const STATE_FILE = path.join(DATA_DIR, "tunnel", "state.json");

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ shortId, tunnelUrl }, null, 2));
}

// Survives restarts, enables instant resume
```

---

## 6. Connection Proxy Config Per Provider

File: `src/shared/constants/providers.js`

### Provider-Specific Proxy Patterns

#### Standard API Key Providers
```javascript
openai: {
  id: "openai",
  authType: "apikey",
  authHeader: "bearer",
  // No special proxy requirements
}
```

#### Relay-Based Providers (Special Handling)
```javascript
"cloudflare-ai": {
  id: "cloudflare-ai",
  hasProviderSpecificData: true,
  // Requires account_id + token via API
  // Can use Vercel Relay for reduced blocking
}
```

#### Vercel Relay Mode
```javascript
if (proxyPool.type === "vercel") {
  return {
    source: "vercel",
    connectionProxyEnabled: false, // Uses header rewriting instead
    vercelRelayUrl: proxyUrl, // Base URL rewriting
  };
}
```

**How It Works**:
- Vercel AI Gateway rewrites `baseUrl` to its relay endpoint
- Adds `x-vm-authorization` header with gateway key
- No HTTP_PROXY needed — relies on URL manipulation

### Environment Variable Injection

File: `src/lib/network/outboundProxy.js`
```javascript
export function applyOutboundProxyEnv({ enabled, url, noProxy }) {
  if (!enabled) {
    // Only clear vars we previously managed
    if (process.env.NINE_ROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
    }
    return;
  }
  
  // Set managed markers
  process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  process.env.NINE_ROUTER_PROXY_URL = url;
  process.env.NINE_ROUTER_NO_PROXY = noProxy;
  
  // Apply to all processes
  process.env.HTTP_PROXY = url;
  process.env.HTTPS_PROXY = url;
  process.env.ALL_PROXY = url;
}
```

---

## 7. What's UNIQUE Worth Absorbing into Vela

### 7.1 MITM Certificate Lifecycle Management

**Pattern**: Automatic root CA generation + leaf cert renewal

```javascript
// Check expiry with 30-day buffer
function isCertExpired(certPath) {
  const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath));
  const threshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return cert.validity.notAfter < threshold;
}
```

**What Vela Could Absorb**:
- Pre-generate root CA during Vela setup
- Monitor cert expiry and auto-regenerate
- Dynamic leaf cert generation per upstream domain
- Store certs in encrypted vault (optional)

**Value**: Enables Vela to act as MITM proxy for any tool requiring SSL interception (internal testing, compliance scanning).

---

### 7.2 Model Alias Canonicalization Engine

**Pattern**: Synonym + regex pattern fallback chain

```javascript
const MODEL_SYNONYMS = { /* exact map */ };
const MODEL_PATTERNS = [ /* progressive regex */ ];
const MODEL_NO_MAP = [/^tab[_-]/i]; // Never remap these
```

**What Vela Could Absorb**:
- Configurable alias maps per provider
- Regex pattern engine for variant matching
- Whitelist of models that bypass remapping
- Hot-swap alias config without restart

**Value**: Future-proofs Vela against provider model renames; reduces maintenance burden.

---

### 7.3 Automated Account Provisioning Pipeline

**Pattern**: Full end-to-end automation from email → verification → token creation

```python
# Complete flow: Ammail + 2Captcha + Cloudflare API + Playwright
def main():
  email = create_ammail_inbox()
  verify_link = wait_for_cf_verify_email()
  turnstile = solve_turnstile_2captcha()
  token = create_scoped_api_token(global_key)
  emit({"api_key": token, "account_id": accountId})
```

**What Vela Could Absorb**:
- Generic automation framework supporting multiple providers
- Reusable captcha solver module
- Inbox polling engine (works with any temp email service)
- Token creation abstractions (API vs session-based)
- JSON-line stdout protocol for capturing results

**Value**: Eliminates manual signup friction for free-tier providers; enables zero-touch onboarding.

---

### 7.4 Tunnel Stateful Resilience

**Pattern**: Persistent state + dual-health probing + auto-restart

```javascript
// Save state after each tunnel start
saveState({ shortId, tunnelUrl });

// On restart: validate existing tunnel before respawning
const [directOk, publicOk] = await Promise.all([
  probeUrlAlive(tunnelUrl),
  probeUrlAlive(publicUrl)
]);
if (directOk && publicOk) return reuse; // Avoid unnecessary respawn

// Fallback: kill old + spawn new
killCloudflared();
spawnQuickTunnel();
```

**What Vela Could Absorb**:
- Persist tunnel metadata (shortId, URLs, expiration)
- Multi-url health checking (direct + public)
- Smart reuse logic (only respawn if dead)
- Background refresh caches (avoid blocking on probes)

**Value**: Reduces tunnel churn; improves reliability when network changes occur.

---

### 7.5 Socks5 Dispatcher Detection

**Pattern**: Scheme-based dispatcher selection in undici

```javascript
// Handles socks5://, http://, https://, bare host:port
dispatcher = new ProxyAgent({ uri: normalizedProxyUrl });

// Socks5 branch tested separately
if (normalizedProxyUrl.startsWith("socks5://")) {
  dispatcher = new Socks5ProxyAgent(normalizedProxyUrl);
}
```

**What Vela Could Absorb**:
- Unified dispatcher factory that detects scheme
- Backward-compatible default to http://
- Dedicated Socks5Agent branch for SSH tunnels
- Test harness covering all proxy types

**Value**: Expands Vela's proxy compatibility beyond HTTP to SSH/Socks ecosystems.

---

### 7.6 Relay Proxy Abstraction (Vercel/Cloudflare/Deno)

**Pattern**: Special-case handling for proxy-less relays

```javascript
if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare") {
  return {
    source: proxyPool.type,
    connectionProxyEnabled: false,
    vercelRelayUrl: proxyUrl, // Instead of HTTP_PROXY
  };
}
```

**What Vela Could Absorb**:
- Abstract relay type enum: `["http", "https", "vercel", "cloudflare", "deno"]`
- Per-type configuration schema
- Header rewriting logic (instead of env vars)
- Relays often bypass IP blocking better than traditional proxies

**Value**: Provides access to cloud-native relays that offer better uptime and lower latency.

---

### 7.7 Cleanup-Aware Env Var Management

**Pattern**: Track which env vars were managed, only clean those

```javascript
export function applyOutboundProxyEnv({ enabled, url, noProxy }) {
  const wasManaged = process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  
  if (!enabled && wasManaged) {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
  }
  
  // Mark as managed only if we actually set something
  if (url || noProxy) {
    process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  }
}
```

**What Vela Could Absorb**:
- Flag env vars we manage with `NINE_ROUTER_*` prefix
- Avoid clobbering user-set proxies
- Graceful cleanup on disable

**Value**: Prevents conflicts with user-configured proxies (corporate environments, dev tools).

---

## Architecture Summary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ IDE (Cursor/Antigravity/Copilot/Kiro)                           │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS to localhost:8080 (MITM Proxy)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ MITM Layer                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Root CA Cert │  │ Leaf Cert Gen│  │ Host Routing │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                     │                                            │
│                     ▼                                            │
│              Model Alias Resolution                             │
│              (SYNONYMS → PATTERNS → NO_MAP)                     │
└────────────────────┼────────────────────────────────────────────┘
                     │ JSON over HTTP → localhost:3001
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9Router Core                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Proxy Fleet  │  │ Auth/Zones   │  │ Provider     │          │
│  │ Manager      │  │              │  │ Normalizer   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                     │                                            │
│                     ├──────────────────┬─────────────────┐      │
│                     ▼                  ▼                 ▼      │
│              HTTP(S) Proxy       SOCKS5 Proxy        Relay     │
│              (HTTP_PROXY)        (socks5://)        (Vercel)   │
└────────────────────┴──────────────────┴─────────────────┘      │
                                                                     │
                     ┌──────────────────────────────────────────┐   │
                     │ Tunnel Layer (Optional)                   │   │
                     │  ┌──────────────┐  ┌──────────────┐      │   │
                     │  │ Cloudflare   │  │ Tailscale    │      │   │
                     │  │ Quick Tunnel │  │ Funnel       │      │   │
                     │  └──────────────┘  └──────────────┘      │   │
                     └──────────────────────────────────────────┘   │
                                                                     │
                     ┌──────────────────────────────────────────┐   │
                     │ Automation Layer                          │   │
                     │  ┌──────────────┐  ┌──────────────┐      │   │
                     │  │ Temp Email   │  │ Captcha      │      │   │
                     │  │ (Ammail)     │  │ Solver       │      │   │
                     │  └──────────────┘  └──────────────┘      │   │
                     │              │                          │   │
                     │              ▼                          │   │
                     │      Browser Automation (Camoufox)     │   │
                     │              │                          │   │
                     │              ▼                          │   │
                     │      Token Creation → Store in DB      │   │
                     └──────────────────────────────────────────┘   │
                                                                     ▼
                                                              Upstream APIs
```

---

## Recommendations for Vela Adoption

### High Priority (Easy Wins)

1. **MITM Alias Engine** (2h)
   - Extract alias resolution logic
   - Add config file support
   - Benefit: Immediate compatibility boost

2. **Cleanup-Aware Env Vars** (30m)
   - Implement `NINE_ROUTER_PROXY_MANAGED` flag
   - Benefit: Prevents conflicts

3. **Tunnel State Persistence** (1h)
   - Save/restore tunnel URLs
   - Benefit: Reduced restart failures

### Medium Priority (Strategic)

4. **Socks5 Dispatcher** (3h)
   - Integrate undici Socks5Agent
   - Benefit: SSH tunnel support

5. **Relay Abstraction** (2h)
   - Generalize Vercel/CF proxy handling
   - Benefit: Access to cloud relays

### Low Priority (Nice-to-Have)

6. **Auto-Provisioning Framework** (8h+)
   - Extract Python automation modules
   - Benefit: Zero-touch signup

7. **Advanced Fleet Fitness** (4h)
   - Import VansRouter fitness tracking
   - Benefit: Smarter proxy rotation

---

## Final Notes

AMRouter represents a mature, production-grade proxy architecture that successfully balances:
- **Security**: MITM certificates, encrypted credential storage
- **Reliability**: Health checks, auto-restart, stale detection  
- **Flexibility**: Multiple proxy types, relay abstraction, tunnel options
- **Automation**: End-to-end account provisioning pipeline

The most immediately absorbable components for Vela are the **alias canonicalization engine**, **cleanup-aware env management**, and **stateful tunnel resilience**. These provide immediate ROI with minimal implementation effort.

For long-term strategic advantage, consider adopting the **automated provisioning framework** and **advanced fleet fitness** systems, though these require more significant integration work.

---

*Report generated from analysis of AMRouter codebase, focusing on proxy-related files, MITM architecture, automation pipelines, and tunnel integration.*
