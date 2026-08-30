/**
 * Defense-in-depth sanitizer for fetched markdown HTML.
 *
 * The skills drawer renders SKILL.md files fetched from our own GitHub repo
 * (first-party, verified-tier content) through dangerouslySetInnerHTML after
 * marked.parse. marked does NOT sanitize. This filter parses the rendered
 * HTML with native DOM APIs and strips everything that is not a
 * documentation-safe element or attribute — scripts, handlers, event URLs,
 * external resources. Zero dependencies; used only where fetched prose
 * crosses an innerHTML boundary.
 */

const ALLOWED_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6",
  "P", "BR", "HR",
  "UL", "OL", "LI",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
  "PRE", "CODE", "BLOCKQUOTE",
  "STRONG", "B", "EM", "I", "DEL", "S",
  "A", "SPAN", "DIV",
]);

const ALLOWED_ATTRS = new Map([
  ["A", new Set(["href"])],
]);

const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

export function sanitizeHtml(dirtyHtml) {
  const template = document.createElement("template");
  template.innerHTML = dirtyHtml;

  (function walk(node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          // Unwrap unknown tags: keep visible text, drop the element.
          walk(child);
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          continue;
        }
        const keep = ALLOWED_ATTRS.get(child.tagName);
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (!keep || !keep.has(name)) {
            child.removeAttribute(attr.name);
            continue;
          }
          if (!SAFE_URL.test(attr.value.trim())) {
            child.removeAttribute(attr.name);
          }
        }
        if (child.tagName === "A") {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noreferrer");
        }
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        // Comments, processing instructions, CDATA — all go.
        node.removeChild(child);
      }
    }
  })(template.content);

  return template.innerHTML;
}
