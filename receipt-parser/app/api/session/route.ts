import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/sessions/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { receipt, hostName, invitees } = body ?? {};

    if (!receipt || !Array.isArray(receipt.items)) {
      return NextResponse.json({ error: "receipt is required" }, { status: 400 });
    }
    if (!Array.isArray(invitees) || invitees.length === 0) {
      return NextResponse.json({ error: "at least one invitee is required" }, { status: 400 });
    }
    for (const inv of invitees) {
      if (!inv?.email || typeof inv.email !== "string") {
        return NextResponse.json({ error: "each invitee needs an email" }, { status: 400 });
      }
    }

    const session = createSession({
      receipt,
      hostName: hostName ?? "Host",
      hostAlias: "",
      invitees,
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
