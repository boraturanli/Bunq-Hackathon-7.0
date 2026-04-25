import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/sessions/store";
import { getUserById } from "@/lib/users";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { receipt, hostName, inviteeUserIds } = body ?? {};

    if (!receipt || !Array.isArray(receipt.items)) {
      return NextResponse.json({ error: "receipt is required" }, { status: 400 });
    }
    if (!Array.isArray(inviteeUserIds) || inviteeUserIds.length === 0) {
      return NextResponse.json({ error: "pick at least one user" }, { status: 400 });
    }
    for (const id of inviteeUserIds) {
      if (!getUserById(id)) {
        return NextResponse.json({ error: `unknown user: ${id}` }, { status: 400 });
      }
    }

    const session = createSession({
      receipt,
      hostName: hostName ?? "Host",
      hostAlias: "",
      inviteeUserIds,
    });

    return NextResponse.json({
      sessionId: session.id,
      invitees: session.invitees.map((i) => ({
        id: i.id,
        userId: i.userId,
        name: i.name,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create session" },
      { status: 500 }
    );
  }
}
