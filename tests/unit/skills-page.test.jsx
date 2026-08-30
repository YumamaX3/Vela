// @vitest-environment happy-dom
/**
 * Skills page client — the command deck, the fleet, the drawer.
 * Rendered in happy-dom: real DOM, real state transitions, zero browser.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SkillsPageClient from "@/app/(dashboard)/dashboard/skills/SkillsPageClient";
import { sanitizeHtml } from "@/shared/utils/sanitizeHtml";
import { SKILLS, SKILL_GROUPS, SKILLS_TREE_BASE, getSkillRawUrl } from "@/shared/constants/skills";

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

/** React 19 tracks input values internally; the native setter bypasses it. */
function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const buttonByText = (container, label) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === label);

const flush = async () => act(async () => {});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("skills constants integrity", () => {
  it("every skill rides the Vela naming and a declared group", () => {
    const groupIds = new Set(SKILL_GROUPS.map((g) => g.id));
    for (const skill of SKILLS) {
      expect(skill.id).toMatch(/^Vela/);
      expect(skill.group === "foundation" || groupIds.has(skill.group)).toBe(true);
    }
    const nonEntry = SKILLS.filter((s) => !s.isEntry);
    expect(nonEntry.every((s) => groupIds.has(s.group))).toBe(true);
  });

  it("the GitHub tree link sails on main", () => {
    expect(SKILLS_TREE_BASE).toContain("/tree/main/skills");
    expect(getSkillRawUrl("Vela")).toContain("/refs/heads/main/skills/Vela/SKILL.md");
  });

  it("every skills/ directory has a card", () => {
    // skills/ ships 9 skills (entry + 8 capabilities incl. video); the fleet must match.
    expect(SKILLS).toHaveLength(9);
    expect(SKILLS.some((s) => s.id === "Vela-video")).toBe(true);
  });
});

describe("SkillsPageClient render", () => {
  it("renders the deck, the fleet, and all nine skills", async () => {
    const { container } = render(<SkillsPageClient />);
    await flush();
    const text = container.textContent;
    expect(text).toContain("Command Deck");
    expect(text).toContain("The fleet");
    expect(text).toContain("9 skills");
    for (const skill of SKILLS) {
      expect(text).toContain(skill.name);
    }
    expect(text).toContain("START HERE");
    expect(text).toContain("Conversation & Knowledge");
    expect(text).toContain("Voice & Vision");
  });

  it("search filters the fleet and shows the empty state", async () => {
    const { container } = render(<SkillsPageClient />);
    await flush();
    const search = container.querySelector('input[aria-label="Search skills"]');

    await act(async () => {
      setInput(search, "grok");
    });
    expect(container.textContent).toContain("Video Generation");
    expect(container.textContent).not.toContain("Embeddings");

    await act(async () => {
      setInput(search, "zzz-no-such-skill");
    });
    expect(container.textContent).toContain("No skill matches that current.");

    await act(async () => {
      setInput(search, "");
    });
    expect(container.textContent).toContain("Embeddings");
  });

  it("personalizes the snippet once a gateway is connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '{"ok":true}' })
    );
    const { container } = render(<SkillsPageClient />);
    await flush();

    const input = container.querySelector('input[aria-label="Vela gateway URL"]');
    await act(async () => {
      setInput(input, "http://10.0.0.7:32060");
    });
    await act(async () => {
      buttonByText(container, "Connect").click();
    });
    await flush();

    const text = container.textContent;
    expect(text).toContain("Gateway reachable");
    expect(text).toContain("http://10.0.0.7:32060");
    expect(text).toContain("Snippets personalized");
  });

  it("opens the preview drawer and renders the fetched skill", async () => {
    const markdown = "---\nname: vela-chat\n---\n\n# Vela — Chat\n\nRequires `VELA_URL`.\n\n## Endpoints\n\n- POST /v1/chat/completions\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        if (String(url).includes("/skills/Vela-chat/SKILL.md")) {
          return Promise.resolve({ ok: true, text: async () => markdown });
        }
        return Promise.resolve({ ok: true, text: async () => "{}" });
      })
    );
    const { container } = render(<SkillsPageClient />);
    await flush();

    const card = Array.from(container.querySelectorAll('[role="button"]')).find((el) =>
      el.textContent.includes("Chat")
    );
    expect(card).toBeTruthy();
    await act(async () => card.click());
    await flush();
    await flush();

    const text = document.body.textContent;
    expect(text).toContain("Vela — Chat");
    expect(text).toContain("Requires");
    expect(text).toContain("/v1/chat/completions");
    // frontmatter stripped before render
    expect(text).not.toContain("name: vela-chat");
  });
});

describe("sanitizeHtml — the defense-in-depth gate", () => {
  it("strips scripts, handlers, and javascript: URLs", () => {
    const dirty =
      '<p onclick="evil()">safe <script>evil()<\/script><a href="javascript:evil()">bait</a><a href="https://example.com">fine</a></p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("safe");
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('rel="noreferrer"');
  });

  it("keeps documentation shapes — tables, code, headings", () => {
    const doc = "<h1>Title</h1><pre><code>curl $VELA_URL</code></pre><table><tr><td>a</td></tr></table>";
    const clean = sanitizeHtml(doc);
    expect(clean).toContain("<h1>Title</h1>");
    expect(clean).toContain("<pre><code>");
    expect(clean).toContain("<table>");
  });
});
