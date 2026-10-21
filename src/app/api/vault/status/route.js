// GET /api/vault/status — the credential vault's own gauge.
//
// Ported from 9router-go `HandleGetVaultStatus`. It answers the only questions
// an operator can act on: is sealing active, and how many connections are
// sealed versus still carrying a plaintext credential.
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { getVault } from "@/lib/vault.js";
import { getVaultCounts } from "@/lib/db/repos/vaultRepo.js";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const vault = getVault();
    const counts = await getVaultCounts();
    return NextResponse.json({
      enabled: vault.enabled,
      sealedCount: counts.sealed,
      plaintextCount: counts.plaintext,
      total: counts.total,
    });
  } catch (error) {
    console.error("[Vault] Failed to read status:", error);
    return NextResponse.json({ error: "Failed to read vault status" }, { status: 500 });
  }
}
