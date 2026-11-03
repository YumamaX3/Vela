// Pure template store for the prompt-injector page. NOT executed, ever: a
// template is a name + a prompt string, copied into the injector form on
// request and saved only when the operator presses Create/Save.
//
// Storage: one JSON file in DATA_DIR. Chosen over the settings blob because
// that blob is shallow-merged by updateSettings() and a per-key deep-merge
// branch would race page.js's own userInjectors PATCH; chosen over a repo
// twin because this is two reads and two writes. Fail-open everywhere:
// absent or malformed file reads as [].
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

const FILE = "prompt-templates.json";
export const MAX_TEMPLATES = 200;
export const MAX_NAME = 80;
export const MAX_PROMPT = 16000;

const filePath = () => path.join(DATA_DIR, FILE);

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // absent or corrupt — fail-open, never throw at the door
  }
}

function writeAll(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${filePath()}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, filePath()); // atomic on the same volume
}

/** The store/API dialect. Returns { ok, value } or { ok:false, errors:[…] }. */
export function normalizeTemplate(input = {}) {
  const errors = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!name) errors.push("name is required");
  if (name.length > MAX_NAME) errors.push(`name exceeds ${MAX_NAME} characters`);
  if (!prompt.trim()) errors.push("prompt is required");
  if (prompt.length > MAX_PROMPT) errors.push(`prompt exceeds ${MAX_PROMPT} characters`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, prompt } };
}

export function listTemplates() {
  return readAll().filter((t) => t && typeof t.id === "string");
}

export function getTemplate(id) {
  return listTemplates().find((t) => t.id === id) || null;
}

export function createTemplate(input) {
  const n = normalizeTemplate(input);
  if (!n.ok) return { ok: false, errors: n.errors };
  const list = listTemplates();
  if (list.length >= MAX_TEMPLATES) return { ok: false, errors: [`at most ${MAX_TEMPLATES} templates`] };
  const now = new Date().toISOString();
  const t = { id: crypto.randomUUID(), name: n.value.name, prompt: n.value.prompt, createdAt: now, updatedAt: now };
  writeAll([...list, t]);
  return { ok: true, template: t };
}

export function updateTemplate(id, input) {
  const list = listTemplates();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, errors: ["template not found"], notFound: true };
  const n = normalizeTemplate({ ...list[idx], ...input });
  if (!n.ok) return { ok: false, errors: n.errors };
  const t = { ...list[idx], name: n.value.name, prompt: n.value.prompt, updatedAt: new Date().toISOString() };
  list[idx] = t;
  writeAll(list);
  return { ok: true, template: t };
}

export function deleteTemplate(id) {
  const list = listTemplates();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return { ok: false, errors: ["template not found"], notFound: true };
  writeAll(next);
  return { ok: true };
}
