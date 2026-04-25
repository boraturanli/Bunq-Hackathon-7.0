import { NextRequest, NextResponse } from "next/server";
import { findSessionsForUser } from "@/lib/sessions/store";
import { getUserById } from "@/lib/users";

export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  const user = getUserById(params.userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const items = findSessionsForUser(params.userId).map(({ session, invitee }) => ({
    sessionId: session.id,
    inviteeId: invitee.id,
    hostName: session.hostName,
    merchant: session.receipt.merchant,
    currency: session.receipt.currency,
    total: session.receipt.total,
    itemCount: session.receipt.items.length,
    createdAt: session.createdAt,
    status: invitee.status,
    amountPaid: invitee.amountPaid,
  }));

  return NextResponse.json({ user, items });
}
