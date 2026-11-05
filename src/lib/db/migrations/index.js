// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-apikey-governance.js";
import m003 from "./003-key-categories.js";
import m004 from "./004-usage-dedupe.js";
import m005 from "./005-backup-ledger.js";
import m006 from "./006-outbox.js";
import m007 from "./007-mirror-seq.js";
import m008 from "./008-usage-telemetry.js";
import m009 from "./009-saved-views.js";
import m010 from "./010-usage-request-tags.js";
import m011 from "./011-proxy-fitness.js";
import m012 from "./012-fallback-rules.js";
import m013 from "./013-key-acl.js";
import m014 from "./014-fallback-rules-v2-triggers.js";
import m015 from "./015-combo-usage.js";
import m016 from "./016-auth-sessions-audit.js";
import m017 from "./017-auth-users.js";
import m018 from "./018-log-events.js";
import m019 from "./019-circuit-breaker-keys.js";
import m020 from "./020-guardrails.js";
import m021 from "./021-credential-vault.js";
import m022 from "./022-semantic-cache.js";
import m023 from "./023-plans.js";
import m024 from "./024-key-access.js";
import m025 from "./025-key-rate-dimensions.js";
import m026 from "./026-guardrail-prompts.js";
import m027 from "./027-policy-kinds.js";
import m028 from "./028-user-totp.js";
import m029 from "./029-security-log-trust-inbox.js";
import m030 from "./030-proxy-console-telemetry.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011.default || m011, m012.default || m012, m013.default || m013, m014.default || m014, m015.default || m015, m016.default || m016, m017.default || m017, m018.default || m018, m019.default || m019, m020.default || m020, m021.default || m021, m022.default || m022, m023.default || m023, m024.default || m024, m025.default || m025, m026.default || m026, m027.default || m027, m028.default || m028, m029.default || m029, m030.default || m030].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
