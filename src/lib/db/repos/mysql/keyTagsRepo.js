// Storage Covenant — the mysql twin of sqlite/keyTagsRepo.js
// (Governance Center, W1b). Mirrors the same contract on the MariaDB harbor.
import { getMysqlAdapter } from "../../mysql/adapter.js";

export async function sanitizeTag(raw) {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!t || t.length > 32) return null;
  return t;
}

export async function tagsForKeys(keyIds) {
  const db = await getMysqlAdapter();
  if (!Array.isArray(keyIds) || keyIds.length === 0) return {};
  const out = {};
  const CHUNK = 500;
  for (let i = 0; i < keyIds.length; i += CHUNK) {
    const chunk = keyIds.slice(i, i + CHUNK);
    const marks = chunk.map(() => "?").join(",");
    const rows = await db.all(`SELECT keyId, tag FROM keyTags WHERE keyId IN (${marks})`, chunk);
    for (const r of rows) {
      (out[r.keyId] = out[r.keyId] || []).push(r.tag);
    }
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

export async function addTag(keyId, tagRaw) {
  const tag = await sanitizeTag(tagRaw);
  if (!tag) return { error: "Tag must be 1–32 characters after trimming" };
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  await db.run(`INSERT IGNORE INTO keyTags (keyId, tag, createdAt) VALUES (?, ?, ?)`, [keyId, tag, now]);
  return { keyId, tag };
}

export async function removeTag(keyId, tagRaw) {
  const tag = await sanitizeTag(tagRaw);
  if (!tag) return { error: "Tag must be 1–32 characters after trimming" };
  const db = await getMysqlAdapter();
  await db.run(`DELETE FROM keyTags WHERE keyId = ? AND tag = ?`, [keyId, tag]);
  return true;
}

export async function renameTag(oldRaw, newRaw) {
  const oldTag = await sanitizeTag(oldRaw);
  const newTag = await sanitizeTag(newRaw);
  if (!oldTag || !newTag) return { error: "Tags must be 1–32 characters after trimming" };
  if (oldTag === newTag) return true;
  const db = await getMysqlAdapter();
  try {
    await db.run(`UPDATE keyTags SET tag = ? WHERE tag = ?`, [newTag, oldTag]);
    return true;
  } catch (e) {
    return { error: `Tag rename conflicts with an existing tag (${newTag})` };
  }
}

export async function deleteForKey(keyId) {
  const db = await getMysqlAdapter();
  await db.run(`DELETE FROM keyTags WHERE keyId = ?`, [keyId]);
  return true;
}
