import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";

import { bridgeError } from "../errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "admin");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query")?.trim();
    if (query) {
      const users = await clients.registry.searchDirectoryUsers(query, context, Number(searchParams.get("limit") ?? 20));
      return NextResponse.json({ users });
    }
    const members = await clients.registry.listRoleMappings(context, searchParams.get("include_removed") === "true");
    return NextResponse.json({ members });
  } catch (error) {
    return bridgeError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "admin");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "import_user") {
      const profile = await clients.registry.importDirectoryUser(String(body.subject ?? ""), context);
      return NextResponse.json({ profile });
    }

    if (action === "assign_role") {
      const member = await clients.registry.upsertRoleMapping(
        {
          subject_type: body.subject_type ?? "user",
          subject_id: String(body.subject_id ?? ""),
          role: String(body.role ?? ""),
          status: body.status ?? "active"
        },
        context
      );
      return NextResponse.json({ member });
    }

    if (action === "set_role_status") {
      const member = await clients.registry.updateRoleMappingStatus(
        String(body.role_mapping_id ?? ""),
        body.status ?? "removed",
        context
      );
      return NextResponse.json({ member });
    }

    return NextResponse.json({ error: "Unsupported access action." }, { status: 400 });
  } catch (error) {
    return bridgeError(error);
  }
}
