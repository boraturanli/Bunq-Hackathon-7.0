import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/sessions/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { receipt, hostName, hostAlias, invitees } = body ?? {};

    if (!receipt || !Array.isArray(receipt.items)) {
      return NextResponse.json({ error: "receipt is required" }, { status: 400 });
    }
    if (!Array.isArray(invitees) || invitees.length === 0) {
      return NextResponse.json({ error: "at least one invitee is required" }, { status: 400 });
    }
    for (const i of invitees) {
      if (!i?.name || !i?.alias) {
        return NextResponse.json({ error: "each invitee needs name and alias" }, { status: 400 });
      }
    }

    const session = createSession({
      receipt,
      hostName: hostName ?? "Host",
      hostAlias: hostAlias ?? "",
      invitees,
    });

    return NextResponse.json({
      sessionId: session.id,
      invitees: session.invitees.map((i) => ({ id: i.id, name: i.name, alias: i.alias })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create session" },
      { status: 500 }
    );
  }
}
