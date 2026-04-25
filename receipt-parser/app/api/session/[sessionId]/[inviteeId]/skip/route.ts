import { NextRequest, NextResponse } from "next/server";
import { getSession, recordSkip } from "@/lib/sessions/store";

export async function POST(
  _req: NextRequest,
  { params }: { params: { sessionId: string; inviteeId: string } }
) {
  const session = getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const invitee = session.invitees.find((i) => i.id === params.inviteeId);
  if (!invitee) return NextResponse.json({ error: "invitee not found" }, { status: 404 });

  if (invitee.status !== "pending") {
    return NextResponse.json({ error: `already ${invitee.status}` }, { status: 409 });
  }

  recordSkip(params.sessionId, params.inviteeId);
  return NextResponse.json({ success: true });
}
