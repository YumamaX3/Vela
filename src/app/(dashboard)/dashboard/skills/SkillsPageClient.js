"use client";

import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { Badge, Drawer } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { sanitizeHtml } from "@/shared/utils/sanitizeHtml";
import {
  SKILLS,
  SKILL_GROUPS,
  SKILLS_REPO_URL,
  SKILLS_TREE_BASE,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";

marked.setOptions({ gfm: true, breaks: true });

const STORAGE_KEY = "vela.skills.url";
const PROBE_TIMEOUT_MS = 6000;

const AGENTS = [
  { id: "claude-code", name: "Claude Code", icon: "terminal" },
  { id: "cursor", name: "Cursor", icon: "code" },
  { id: "cline", name: "Cline", icon: "smart_toy" },
  { id: "codex", name: "Codex", icon: "data_object" },
  { id: "other", name: "Other", icon: "more_horiz" },
];

function normalizeUrl(raw) {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

function safeReadStorage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function safeWriteStorage(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode — the deck still works without memory */
  }
}

/** One paste-ready line per agent convention. */
function pasteLine(agentId, base, entryUrl) {
  switch (agentId) {
    case "claude-code":
      return `Use Vela as my AI gateway at ${base}. Read this skill and follow it:\n${entryUrl}`;
    case "cursor":
      return `Add this to your rules: Vela AI gateway is at ${base}. Full usage skill:\n${entryUrl}`;
    case "cline":
      return `Fetch this skill and use Vela (${base}) for all AI requests:\n${entryUrl}`;
    case "codex":
      return `Configure against the OpenAI-compatible gateway at ${base}/v1. Skill:\n${entryUrl}`;
    default:
      return `Read this skill and use it (Vela gateway: ${base}):\n${entryUrl}`;
  }
}

function CopyIconButton({ value, label = "Copy link", className = "" }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(value);
      }}
      aria-label={label}
      title={label}
      className={`shrink-0 inline-flex items-center justify-center size-8 rounded-[10px] border border-border-subtle text-text-muted hover:text-primary hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${className}`}
    >
      <span className="material-symbols-outlined text-[16px] leading-none">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

function ProbePill({ status }) {
  const map = {
    idle: { label: "Gateway not probed", cls: "bg-surface-2 text-text-muted", dot: "bg-text-muted/40" },
    probing: { label: "Probing gateway…", cls: "bg-surface-2 text-text-muted", dot: "bg-brand-500 animate-pulse" },
    up: { label: "Gateway reachable", cls: "bg-green-500/10 text-green-600 dark:text-green-400", dot: "bg-green-500" },
    down: { label: "Gateway unreachable", cls: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500" },
  };
  const it = map[status] || map.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${it.cls}`}>
      <span className={`size-1.5 rounded-full ${it.dot}`} />
      {it.label}
    </span>
  );
}

/* ── The Command Deck ─────────────────────────────────────────── */

function CommandDeck({ base, onProbe }) {
  const { copied, copy } = useCopyToClipboard();
  const [draft, setDraft] = useState("");
  const [agent, setAgent] = useState(AGENTS[0].id);
  const [probe, setProbe] = useState({ status: "idle", base: "" });
  const [probing, setProbing] = useState(false);

  // Restore the remembered gateway + probe it once on first visit.
  useEffect(() => {
    const saved = normalizeUrl(safeReadStorage());
    if (saved) {
      setDraft(saved);
      onProbe(saved);
      runProbe(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runProbe(url) {
    setProbing(true);
    setProbe({ status: "probing", base: url });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${url}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProbe({ status: "up", base: url });
    } catch {
      setProbe({ status: "down", base: url });
    } finally {
      setProbing(false);
    }
  }

  function connect() {
    const url = normalizeUrl(draft);
    if (!url) return;
    setDraft(url);
    safeWriteStorage(url);
    onProbe(url);
    runProbe(url);
  }

  const entryUrl = getSkillRawUrl("Vela");
  const activeBase = base || "http://localhost:32060";
  const snippet = pasteLine(agent, activeBase, entryUrl);

  const bulkLinks = SKILLS.map((s) => getSkillRawUrl(s.id)).join("\n");
  const fullSetup = [
    `export VELA_URL="${activeBase}"`,
    `export VELA_KEY="sk-..."   # Dashboard → Keys, only if auth is enabled`,
    "",
    `# Entry skill — paste this line to your AI agent:`,
    `Read this skill and use it: ${entryUrl}`,
  ].join("\n");

  return (
    <section className="rounded-[14px] border border-brand-500/25 bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      {/* Hairline gradient — the deck's signature */}
      <div className="h-[3px] bg-gradient-to-r from-brand-600 via-brand-400 to-transparent" />

      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-[12px] bg-brand-500 text-white flex items-center justify-center shadow-[var(--shadow-warm)]">
              <span className="material-symbols-outlined text-[20px] leading-none">deployed_code</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-main">Command Deck</h2>
              <p className="text-xs text-text-muted">
                Hand Vela to your AI agent. One paste, and it knows the whole gateway.
              </p>
            </div>
          </div>
          <ProbePill status={probe.status} />
        </div>

        {/* Gateway URL + probe */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] rounded-[10px] border border-border-subtle bg-bg-alt px-3 py-2 focus-within:shadow-[var(--shadow-focus)] transition-shadow">
            <span className="material-symbols-outlined text-[16px] leading-none text-text-muted">dns</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder="http://localhost:32060 — your Vela gateway"
              aria-label="Vela gateway URL"
              className="flex-1 bg-transparent text-[13px] font-mono text-text-main placeholder:text-text-muted/70 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={connect}
            disabled={probing || !draft.trim()}
            className="px-3.5 py-2 rounded-[10px] bg-brand-500 text-white text-[13px] font-semibold hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            {probing ? "Probing…" : probe.status === "up" || probe.status === "down" ? "Re-probe" : "Connect"}
          </button>
        </div>

        {/* Agent tabs + paste-ready snippet */}
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-2" role="tablist" aria-label="Choose your AI agent">
            {AGENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={agent === a.id}
                onClick={() => setAgent(a.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                  agent === a.id
                    ? "bg-brand-500/10 text-brand-600 dark:text-brand-300"
                    : "text-text-muted hover:text-text-main hover:bg-surface-2"
                }`}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">{a.icon}</span>
                {a.name}
              </button>
            ))}
          </div>

          <div className="relative rounded-[12px] bg-[var(--color-terminal)] text-[var(--color-terminal-text)] p-4 pr-14">
            <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed">{snippet}</pre>
            <button
              type="button"
              onClick={() => copy(snippet)}
              aria-label="Copy the paste-ready line"
              title="Copy"
              className="absolute top-3 right-3 inline-flex items-center justify-center size-8 rounded-[8px] opacity-70 hover:opacity-100 hover:bg-white/10 transition-[opacity,background-color] cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              style={{ color: "var(--color-terminal-text)" }}
            >
              <span className="material-symbols-outlined text-[16px] leading-none">
                {copied === snippet ? "check" : "content_copy"}
              </span>
            </button>
          </div>
          <p className="text-[11px] text-text-muted mt-1.5">
            {base ? `Snippets personalized for ${base}.` : "No gateway set — snippets use the localhost default. Probe above to personalize."}
          </p>
        </div>

        {/* Bulk deck */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border-subtle">
          <button
            type="button"
            onClick={() => copy(fullSetup, "setup")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-border-subtle text-[12px] font-medium text-text-main hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <span className="material-symbols-outlined text-[15px] leading-none">
              {copied === "setup" ? "check" : "terminal"}
            </span>
            {copied === "setup" ? "Setup copied" : "Copy full setup"}
          </button>
          <button
            type="button"
            onClick={() => copy(bulkLinks, "links")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-border-subtle text-[12px] font-medium text-text-main hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <span className="material-symbols-outlined text-[15px] leading-none">
              {copied === "links" ? "check" : "inventory_2"}
            </span>
            {copied === "links" ? "Links copied" : `Copy all ${SKILLS.length} skill links`}
          </button>
          <a
            href={SKILLS_TREE_BASE}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium"
          >
            <span className="material-symbols-outlined text-[15px] leading-none">open_in_new</span>
            Browse on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── The fleet ────────────────────────────────────────────────── */

function SkillCard({ skill, onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(skill)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(skill);
        }
      }}
      className="group text-left rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] p-4 transition-all hover:shadow-[var(--shadow-warm)] hover:border-brand-500/30 cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
    >
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-[10px] bg-brand-500/10 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[18px] leading-none">{skill.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
            {skill.endpoint && (
              <Badge variant="default" size="sm">
                <code className="text-[10px]">{skill.endpoint}</code>
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{skill.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CopyIconButton value={getSkillRawUrl(skill.id)} />
          <span className="material-symbols-outlined text-[16px] leading-none text-text-muted/40 group-hover:text-primary transition-colors">
            chevron_right
          </span>
        </div>
      </div>
    </div>
  );
}

function EntryCard({ skill, onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(skill)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(skill);
        }
      }}
      className="group rounded-[14px] border border-brand-500/40 bg-brand-500/5 p-5 transition-all hover:shadow-[var(--shadow-warm)] hover:border-brand-500/60 cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="size-11 rounded-[12px] bg-brand-500 text-white flex items-center justify-center shrink-0 shadow-[var(--shadow-warm)]">
          <span className="material-symbols-outlined text-[22px] leading-none">{skill.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-[15px] text-text-main">{skill.name}</h3>
            <Badge variant="primary" size="sm">START HERE</Badge>
          </div>
          <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            Read the skill
          </span>
          <CopyIconButton value={getSkillRawUrl(skill.id)} />
          <span className="material-symbols-outlined text-[18px] leading-none text-brand-500">chevron_right</span>
        </div>
      </div>
    </div>
  );
}

/* ── Preview drawer ───────────────────────────────────────────── */

function SkillPreviewDrawer({ skill, onClose }) {
  const [state, setState] = useState({ status: "loading", md: "" });

  useEffect(() => {
    if (!skill) return undefined;
    let alive = true;
    setState({ status: "loading", md: "" });
    fetch(getSkillRawUrl(skill.id))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!alive) return;
        const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
        // marked does not sanitize; the fetched prose is ours (verified
        // tier) but defense-in-depth strips anything non-documentation.
        setState({ status: "ready", md: sanitizeHtml(marked.parse(body)) });
      })
      .catch(() => {
        if (alive) setState({ status: "error", md: "" });
      });
    return () => {
      alive = false;
    };
  }, [skill]);

  return (
    <Drawer isOpen={Boolean(skill)} onClose={onClose} title={skill?.name || ""} width="lg">
      {skill && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {skill.endpoint ? (
              <Badge variant="default" size="md">
                <code className="text-[11px]">{skill.endpoint}</code>
              </Badge>
            ) : (
              <Badge variant="primary" size="md">Entry point</Badge>
            )}
            <CopyIconButton value={getSkillRawUrl(skill.id)} label="Copy raw link" />
            <a
              href={getSkillBlobUrl(skill.id)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on GitHub"
              title="Open on GitHub"
              className="shrink-0 inline-flex items-center justify-center size-8 rounded-[10px] border border-border-subtle text-text-muted hover:text-primary hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">open_in_new</span>
            </a>
          </div>

          {state.status === "loading" && (
            <div className="space-y-3 animate-pulse" aria-label="Loading skill">
              <div className="h-4 w-2/5 rounded bg-surface-2" />
              <div className="h-3 w-full rounded bg-surface-2" />
              <div className="h-24 w-full rounded bg-surface-2" />
              <div className="h-3 w-4/5 rounded bg-surface-2" />
            </div>
          )}

          {state.status === "error" && (
            <div className="rounded-[12px] border border-border-subtle bg-bg-alt p-6 text-center">
              <span className="material-symbols-outlined text-[28px] leading-none text-text-muted">cloud_off</span>
              <p className="text-sm text-text-main mt-2 font-medium">The skill could not be fetched.</p>
              <p className="text-xs text-text-muted mt-1">GitHub is unreachable from here right now. The raw link above still works.</p>
            </div>
          )}

          {state.status === "ready" && (
            <div className="skill-md-body text-[13px] text-text-main" dangerouslySetInnerHTML={{ __html: state.md }} />
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function SkillsPageClient() {
  const [query, setQuery] = useState("");
  const [gatewayBase, setGatewayBase] = useState("");
  const [openSkill, setOpenSkill] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SKILLS;
    return SKILLS.filter((s) =>
      [s.name, s.description, s.endpoint || "", ...(s.keywords || [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [query]);

  const entry = filtered.find((s) => s.isEntry);
  const groups = SKILL_GROUPS.map((g) => ({ ...g, items: filtered.filter((s) => s.group === g.id) })).filter(
    (g) => g.items.length > 0
  );
  const empty = filtered.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8">
      <CommandDeck base={gatewayBase} onProbe={setGatewayBase} />

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-semibold text-text-main">
            The fleet{" "}
            <span className="text-text-muted font-normal">
              · {filtered.length} skill{filtered.length === 1 ? "" : "s"}
            </span>
          </h2>
          <div className="flex items-center gap-2 rounded-[10px] border border-border-subtle bg-surface px-3 py-1.5 focus-within:shadow-[var(--shadow-focus)] transition-shadow">
            <span className="material-symbols-outlined text-[15px] leading-none text-text-muted">search</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the fleet…"
              aria-label="Search skills"
              className="bg-transparent text-[13px] text-text-main placeholder:text-text-muted/70 outline-none w-40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-text-muted hover:text-text-main cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">close</span>
              </button>
            )}
          </div>
        </div>

        {entry && (
          <div className="mb-4">
            <EntryCard skill={entry} onOpen={setOpenSkill} />
          </div>
        )}

        {empty ? (
          <div className="rounded-[14px] border border-border-subtle bg-surface p-10 text-center">
            <span className="material-symbols-outlined text-[32px] leading-none text-text-muted/60">sailing</span>
            <p className="text-sm font-medium text-text-main mt-2">No skill matches that current.</p>
            <p className="text-xs text-text-muted mt-1">Try a different word, or clear the search.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-3 px-3 py-1.5 rounded-[10px] border border-border-subtle text-[12px] font-medium text-text-main hover:border-brand-500/40 hover:bg-brand-500/5 transition-colors cursor-pointer"
            >
              Clear search
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.id} className="mb-5">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="material-symbols-outlined text-[15px] leading-none text-text-muted">{g.icon}</span>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-muted">{g.label}</h3>
                <span className="text-[11px] text-text-muted/70">{g.items.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.items.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} onOpen={setOpenSkill} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-[14px] border border-border-subtle bg-surface px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[18px] leading-none text-text-muted">menu_book</span>
          <p className="text-xs text-text-muted">
            Every skill lives in the repo's <code className="font-mono text-[11px]">skills/</code> directory. Add one, and it
            appears here.
          </p>
        </div>
        <a
          href={SKILLS_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium"
        >
          <span className="material-symbols-outlined text-[15px] leading-none">open_in_new</span>
          YumamaX3/Vela
        </a>
      </div>

      <SkillPreviewDrawer skill={openSkill} onClose={() => setOpenSkill(null)} />
    </div>
  );
}
