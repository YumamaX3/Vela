// Shared auth for the database maintenance sub-routes.
// Same contract as the sibling export/import surface: CLI token or dashboard
// password. Kept in one place so four doors cannot drift into four dialects.
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const PASSWORD_HEADER = "x-9r-password";

export async function authorizeMaintenance(request, passwordFromBody) {
  if (request.headers.get(CLI_TOKEN_HEADER)) return null;
  const password = passwordFromBody ?? request.headers.get(PASSWORD_HEADER);
  if (await verifyDashboardPassword(password)) return null;
  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
