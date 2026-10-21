// POST /api/vault/rotate — re-wrap every stored DEK under a new master key.
//
// Ported from 9router-go `HandleRotateVault`. The ciphertext is never touched:
// rotating a KEK re-wraps only the small DEK columns. Rows whose DEK cannot be
// unwrapped are reported and skipped, never rewritten — a rotation must not
// destroy the rows it cannot read.
//
// The new key is NOT persisted by this route. The operator must export it as
// VELA_MASTER_KEY (and move the old key to VELA_MASTER_KEY_PREVIOUS) before the
// next restart, or this process's rotation dies with the process.
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { getVault, decodeMasterKey, VaultError, ERR_DISABLED } from "@/lib/vault.js";
import { rewrapConnectionDEKs } from "@/lib/db/repos/vaultRepo.js";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function POST(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const vault = getVault();
    if (!vault.enabled) {
      return NextResponse.json(
        { error: "Credential vault is disabled. Set VELA_MASTER_KEY before rotating." },
        { status: 400 }
      );
    }

    let newKey;
    try {
      newKey = decodeMasterKey(body.masterKey);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const { rewrapped, failures } = await rewrapConnectionDEKs(newKey);
    // Only after every readable row has been re-wrapped does the in-process
    // vault adopt the new key. The old key is retired, not discarded, so a row
    // that failed to re-wrap above remains readable.
    vault.rotate(newKey);

    return NextResponse.json({
      status: "ok",
      rewrapped,
      failures,
      note: "Export the new key as VELA_MASTER_KEY and keep the old one as VELA_MASTER_KEY_PREVIOUS before restarting.",
    });
  } catch (error) {
    if (error instanceof VaultError && error.code === ERR_DISABLED) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[Vault] Rotation failed:", error);
    return NextResponse.json({ error: "Vault rotation failed" }, { status: 500 });
  }
}
