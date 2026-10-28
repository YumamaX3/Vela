# Troubleshooting

Most problems with Vela are one of five things: it is not running, the key is wrong, the model name does not exist, a provider is out of quota, or a network in between is in the way.

This page takes them in the order you are likely to meet them. Every fix is something you can check in under a minute.

---

## First, two checks that solve half of everything

```bash
# 1. Is the gateway alive?
curl http://localhost:32060/api/health
# → {"ok":true}

# 2. Can it see any models?
curl http://localhost:32060/v1/models -H "Authorization: Bearer <your key>"
```

- **No answer at all** → it is not running, or it is on a different port. See [Connection refused](#connection-refused).
- **An answer, but an empty model list** → no provider is connected. See [Model not found](#model-not-found).
- **A `401`** → the key. See [API key invalid](#api-key-invalid).
- **A `429`** → quota, rate limit or a budget you set. See [Rate limiting](#rate-limiting).

---

## "Language model did not provide messages"

**What it means:** the request reached a provider and came back empty or refused.

**Causes:** exhausted quota, an expired connection, or a model that the upstream no longer serves.

**Fixes:**

1. **Check the allowance** — **Quota**, for this provider's remaining amount and reset countdown.
2. **Check the connection** — **Providers**: an expired OAuth connection shows as needing attention. Disconnect, then Connect again.
3. **Use a combo** so the next model answers while you investigate:

   ```
   cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
   ```

---

## Rate limiting

**What it means:** `429 Too Many Requests`, often with a retry hint.

**Causes:** the subscription window is closed, a per-minute limit was hit by a burst, or a budget ceiling on your key was reached.

**Fixes:**

1. **Read the code in the response.** A `budget_exceeded` code means you set a ceiling and reached it — edit it under **Endpoint & Key**. A bare rate limit means waiting or switching.
2. **Check the reset countdown** on **Quota**.
3. **Spread the load** — **Settings → Routing → Round robin** across several accounts of the same provider.
4. **Use the cheap lane** while the subscription recovers: `glm/glm-4.7`, `minimax/MiniMax-M2.1`.
5. **Retry with backoff** in your own code — respect the retry hint, do not hammer.

---

## OAuth token expired

**What it means:** `Unauthorized`, or a provider that worked yesterday and does not today.

**Causes:** the refresh failed (the provider invalidated the session, the network was down mid-refresh, or you changed the account's password).

**Fixes:**

1. **Reconnect:** **Providers → [provider] → Disconnect → Connect**, and complete the login again.
2. If the provider shows several accounts, check the right one is enabled.
3. For a headless server, complete the OAuth flow on another machine and paste the callback back, if the provider allows it.

---

## Connection refused

**What it means:** `ECONNREFUSED`, or "Cannot connect to localhost:32060".

**Causes:** Vela is not running, it is on a different port, or a firewall is in the way.

**Fixes:**

```bash
# Start it
vela

# or, if it is running elsewhere
vela --port 8080

# Is anything listening?
lsof -i :32060            # macOS / Linux
netstat -ano | findstr :32060   # Windows
```

Check your tool's base URL ends in `/v1` — `http://localhost:32060` without it will hit the dashboard, not the API.

If you are connecting from another machine, remember the default bind is `0.0.0.0` but a firewall may still block it; and if you started with `--host 127.0.0.1`, only that machine can reach it.

---

## Dashboard does not open

**What it means:** `http://localhost:32060/dashboard` is blank, spinning, or unreachable.

**Causes:** the port is taken, Vela crashed, or a browser cache is stale.

**Fixes:**

1. **Check the process** — `vela --log` shows its output. If nothing is running, start it.
2. **Check the port**:
   ```bash
   lsof -i :32060                               # macOS / Linux
   lsof -ti:32060 | xargs kill -9               # stop the squatter
   netstat -ano | findstr :32060                # Windows
   taskkill /PID <PID> /F
   ```
3. **Try a private window** to rule out cache or an extension.
4. **From another machine?** That is the password gate. Local access is open; remote access is refused until you set a password under **Settings → Access**.

---

## Model not found

**What it means:** `404` or "model not found".

**Causes:** a typo, a provider that is not connected, or a model id that was renamed upstream.

**Fixes:**

1. **Ask the gateway what it has:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
2. **Check the format** — `prefix/model`, for example `glm/glm-4.7`, not `glm-4.7` on its own.
3. **Connect the provider** the model belongs to.
4. **Model lists move.** If a model worked last month and not today, the provider probably retired the id. Pick a current one from the list above.

---

## Slow responses

**What it means:** requests take a long time to start streaming, or time out.

**Causes:** provider latency, large contexts, free-tier priority, or a proxy buffering the stream.

**Fixes:**

1. **Try a faster model** — `cc/claude-haiku-4-5-20251001`, `minimax/MiniMax-M2.5-highspeed`, `qwen/qwen-turbo`.
2. **Reduce the context** — trim the history, send the relevant file rather than the repository.
3. **Free tiers are slow under load**, by design. Move up a lane if it matters.
4. **Behind a proxy?** Streaming needs buffering off:
   ```nginx
   proxy_buffering off;
   proxy_read_timeout 86400;
   ```
5. **Check the network** between you and the provider.

---

## API key invalid

**What it means:** `401 Unauthorized`.

**Causes:** a wrong key, a truncated paste, a key that was deleted, or `REQUIRE_API_KEY` on with no key sent.

**Fixes:**

1. **Create a fresh key:** **Endpoint & Key → Create Key**. Keys are shown once at creation and stored only as a hash; there is no way to look an old one up.
2. **Check the format** — Vela keys look like `vela-v1-<id>-<checksum>`. A key in an old `sk-...` style predates this format and is no longer accepted.
3. **Check the header** — `Authorization: Bearer <key>`, with no stray spaces or line breaks.
4. **Test it:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
5. **If the key has a scope**, confirm the model you are asking for is inside it.

---

## "Invalid API key" from the provider, not from Vela

**What it means:** Vela accepted your key, but the upstream rejected the provider credential.

**Fixes:**

1. Re-check the provider's API key or login under **Providers**.
2. Confirm the upstream account has credit.
3. Regenerate the upstream key if it may have been exposed.

---

## Everything worked yesterday

This is the most common shape of trouble, and almost always upstream:

- a free tier tightened its limits
- a provider retired a model id
- an OAuth session was invalidated
- a provider had an outage

Check the provider's status page, reconnect it under **Providers**, and let a combo carry you until it recovers.

---

## Still stuck

- Confirm your version: `npm list -g vela` (this documentation covers 1.2.5).
- Look at **Log Harbor** for the exact request and its error.
- Search the [issues](https://github.com/YumamaX3/Vela/issues), and open one with your version, the error text, and the steps that produced it.

---

## Need more help?

- **GitHub Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Documentation:** [vela.my.id/docs](https://vela.my.id/docs)
- **FAQ:** [faq.md](faq.md)
