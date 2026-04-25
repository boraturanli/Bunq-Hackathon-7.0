import { NextRequest, NextResponse } from "next/server";
import { getSession, recordPayment, type ItemClaim } from "@/lib/sessions/store";
import { computeAmountOwed } from "@/lib/sessions/compute";

const BUNQ_API = process.env.BUNQ_API_URL ?? "http://localhost:8000";

async function fireBunqRequest(amount: number, description: string, recipient: string) {
  const pointer_type = recipient.includes("@") ? "EMAIL" : "PHONE_NUMBER";
  try {
    const res = await fetch(`${BUNQ_API}/api/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amount.toFixed(2),
        description,
        recipient,
        pointer_type,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `bunq returned ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "bunq unreachable" };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string; inviteeId: string } }
) {
  const session = getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const invitee = session.invitees.find((i) => i.id === params.inviteeId);
  if (!invitee) return NextResponse.json({ error: "invitee not found" }, { status: 404 });

  if (invitee.status !== "pending") {
    return NextResponse.json({ error: `already ${invitee.status}` }, { status: 409 });
  }

  let claims: ItemClaim[];
  try {
    const body = await req.json();
    claims = Array.isArray(body?.claims) ? body.claims : [];
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Check if any claimed items were already paid for by another invitee
  const conflicts: { itemId: number; itemName: string; paidBy: string }[] = [];
  for (const inv of session.invitees) {
    if (inv.id === params.inviteeId || inv.status !== "paid") continue;
    for (const paidClaim of inv.claims) {
      if (claims.some((c) => c.itemId === paidClaim.itemId)) {
        const item = session.receipt.items.find((i) => i.id === paidClaim.itemId);
        conflicts.push({ itemId: paidClaim.itemId, itemName: item?.description ?? "item", paidBy: inv.name });
      }
    }
  }
  if (conflicts.length > 0) {
    return NextResponse.json({ error: "conflict", conflicts }, { status: 409 });
  }

  const amount = computeAmountOwed(session.receipt, claims);
  if (amount <= 0) {
    return NextResponse.json({ error: "nothing to pay — use skip instead" }, { status: 400 });
  }

  const description = `${session.receipt.merchant ?? "Receipt"} · bunqShare`;
  const bunq = await fireBunqRequest(amount, description, invitee.alias);

  recordPayment(params.sessionId, params.inviteeId, claims, amount);

  return NextResponse.json({
    success: true,
    amountPaid: amount,
    currency: session.receipt.currency,
    bunq,
  });
}
