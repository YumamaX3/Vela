// AI Lab client API surface — session-auth'd fetch helpers. Every Lab
// mutation goes through the settings PATCH route (the shared validator) so
// the UI can never persist what the engine would reject.

async function j(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let msg = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* keep status message */ }
    throw new Error(msg);
  }
  return res.json();
}

/** Load the Lab settings blob (injectors + modes + policies). */
export async function fetchLabSettings() {
  const s = await j("/api/settings");
  return {
    userInjectors: Array.isArray(s.userInjectors) ? s.userInjectors : [],
    modeBundles: Array.isArray(s.modeBundles) ? s.modeBundles : [],
    contentPolicies: Array.isArray(s.contentPolicies) ? s.contentPolicies : [],
  };
}

/** Persist a full Lab sub-collection via the validated settings PATCH. */
export async function saveLabCollection(key, value) {
  return j("/api/settings", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
}

/** Live preview — renders injectors through the SAME pure expansion module. */
export async function labPreview(injectors, { model = null, kind = "llm" } = {}) {
  return j("/api/lab/preview", { method: "POST", body: JSON.stringify({ injectors, model, kind }) });
}
