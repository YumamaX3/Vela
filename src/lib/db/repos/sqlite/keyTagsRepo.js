// keyTagsRepo — sqlite harbor (Governance Center, W1b).
// Free-form per-key tags (migration 016). Plain table, app-level scrub
// (Covenant M5): apiKeysRepo.deleteWithScrub purges tag rows in-transaction.
import { getAdapter } from "../../driver.js";

/** Sanitize a single tag: trim, 1–32 chars, lowercase-normalized. */
export function sanitizeTag(raw) {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!t || t.length > 32) return null;
  return t;
}

export async function tagsForKeys(keyIds) {
  const db = await getAdapter();
  if (!Array.isArray(keyIds) || keyIds.length === 0) return {};
  const out = {};
  // Chunked IN-clause (≤500) — one batched query, no N+1.
  const CHUNK = 500;
  for (let i = 0; i < keyIds.length; i += CHUNK) {
    const chunk = keyIds.slice(i, i + CHUNK);
    const marks = chunk.map(() => "?").join(",");
    const rows = db.all(`SELECT keyId, tag FROM keyTags WHERE keyId IN (${marks})`, chunk);
    for (const r of rows) {
      (out[r.keyId] = out[r.keyId] || []).push(r.tag);
    }
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

export async function addTag(keyId, tagRaw) {
  const tag = sanitizeTag(tagRaw);
  if (!tag) return { error: "Tag must be 1–32 characters after trimming" };
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`INSERT OR IGNORE INTO keyTags (keyId, tag, createdAt) VALUES (?, ?, ?)`, [keyId, tag, now]);
  return { keyId, tag };
}

export async function removeTag(keyId, tagRaw) {
  const tag = sanitizeTag(tagRaw);
  if (!tag) return { error: "Tag must be 1–32 characters after trimming" };
  const db = await getAdapter();
  db.run(`DELETE FROM keyTags WHERE keyId = ? AND tag = ?`, [keyId, tag]);
  return true;
}

export async function renameTag(oldRaw, newRaw) {
  const oldTag = sanitizeTag(oldRaw);
  const newTag = sanitizeTag(newRaw);
  if (!oldTag || !newTag) return { error: "Tags must be 1–32 characters after trimming" };
  if (oldTag === newTag) return true;
  const db = await getAdapter();
  // Respect UNIQUE — conflict reported, not swallowed.
  try {
    db.run(`UPDATE keyTags SET tag = ? WHERE tag = ?`, [newTag, oldTag]);
    return true;
  } catch (e) {
    return { error: `Tag rename conflicts with an existing tag (${newTag})` };
  }
}

export async function deleteForKey(keyId) {
  const db = await getAdapter();
  db.run(`DELETE FROM keyTags WHERE keyId = ?`, [keyId]);
  return true;
}
