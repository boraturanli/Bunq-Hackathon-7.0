import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/sessions/store";

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = getSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: session.id,
    receipt: session.receipt,
    hostName: session.hostName,
    hostAlias: session.hostAlias,
    createdAt: session.createdAt,
    invitees: session.invitees.map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      claims: i.claims,
      amountPaid: i.amountPaid,
      paidAt: i.paidAt,
    })),
  });
}
