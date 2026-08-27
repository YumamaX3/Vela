// W3b — minimal DOM render helper for the happy-dom proof suites.
// No Testing Library dependency: render with react-dom/client createRoot into
// a fresh container, wrapped in React's `act` so the concurrent render flushes
// synchronously (React 19 does not commit on createRoot().render() alone —
// the root.render call schedules work; act drains it before we query the DOM).
import { act } from "react";
import { createRoot } from "react-dom/client";

export async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    root,
    // Text-content query (substring, case-insensitive).
    text: (s) => container.textContent?.toLowerCase().includes(s.toLowerCase()) ?? false,
    // Element query by CSS selector within the container.
    query: (sel) => container.querySelector(sel),
    queryAll: (sel) => [...container.querySelectorAll(sel)],
    // Re-run an act() flush for interactions that set state (click handlers,
    // input changes) before asserting on the DOM.
    flush: () => act(async () => {}),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

// Reset the DOM between tests.
export function cleanupDom() {
  document.body.innerHTML = "";
}
