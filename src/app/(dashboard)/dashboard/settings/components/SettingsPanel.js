"use client";
// SettingsPanel — the tabpanel half of the TabBar contract.
//
// TabBar emits `aria-controls={`panel-${id}`}`, so the panel it points at must
// carry that id and the matching `aria-labelledby`. A rail whose tabs point at
// panels that do not exist promises a keyboard user a destination and delivers
// a jump to nothing.
//
// `hidden` rather than conditional rendering, deliberately: the settings room
// carries forms (an SSO issuer, a certificate, a proxy URL) whose contents are
// long and awkward to retype, and unmounting on a tab switch would throw that
// work away. The repo already holds this line in the sidebar's rail — labels are
// kept in the DOM and hidden, never removed. Panels are mounted on FIRST VISIT
// (see page.js) so a room nobody opens costs no request.
export default function SettingsPanel({ id, active, children }) {
  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={!active}
      className="flex flex-col gap-4"
    >
      {children}
    </div>
  );
}
