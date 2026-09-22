"use client";

// The key room's masthead: what the fleet IS (the pulse), what the harbor's
// posture is (the require-key gate — the element the old `#require-api-key`
// deep link still resolves through, so the anchor lives here now), and the four
// acts that change it: mint, export, import, and the usage window every strip
// below is measured over.
import { Button, Card, Select, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { PERIODS } from "../../hooks/useKeyDeck";
import SecurityWarning from "../endpoint/SecurityWarning";
import KeyFleetPulse from "./KeyFleetPulse";

export default function KeysMasthead({ c, deck }) {
  const { requireApiKey, handleRequireApiKey, isRemoteHost, openCreateModal } = c;

  return (
    <Card id="require-api-key">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            {translate("API Keys")}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {translate("One endpoint, many keys — each with its own scope, ceilings and budget.")}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* The window every usage strip is measured over. It is a lens, not a
              filter — changing it never hides a key, only re-measures it. */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted hidden sm:inline">{translate("Window")}</span>
            <Select
              value={deck.usagePeriod}
              onChange={(e) => deck.setUsagePeriod(e.target.value)}
              options={PERIODS}
              className="w-[120px]"
            />
          </div>
          <Button icon="download" onClick={deck.exportFleet}>
            {translate("Export")}
          </Button>
          <Button icon="file_upload" onClick={deck.openImport}>
            {translate("Import")}
          </Button>
          <Button icon="add" onClick={openCreateModal}>
            {translate("Create Key")}
          </Button>
        </div>
      </div>

      {/* The pulse — the fleet's posture in one breath, before any row is read. */}
      <KeyFleetPulse c={c} deck={deck} />

      <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-border">
        <div className="min-w-0">
          <p className="font-medium">{translate("Require API key")}</p>
          <p className="text-sm text-text-muted">
            {translate("Requests without a valid key will be rejected")}
          </p>
        </div>
        <Toggle
          checked={requireApiKey}
          onChange={() => handleRequireApiKey(!requireApiKey)}
        />
      </div>

      {isRemoteHost && !requireApiKey && (
        <div className="mt-4">
          <SecurityWarning message="Endpoint is exposed without an API key." />
        </div>
      )}
    </Card>
  );
}
