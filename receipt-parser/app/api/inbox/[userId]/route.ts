import { NextRequest, NextResponse } from "next/server";
import { findSessionsForUser } from "@/lib/sessions/store";
import { getUserById, placeholderUser } from "@/lib/users";

export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  const user = getUserById(params.userId) ?? placeholderUser(params.userId);

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

  const lifetimePaid = items
    .filter((i) => i.status === "paid" && i.amountPaid != null)
    .reduce((sum, i) => sum + (i.amountPaid ?? 0), 0);

  const pendingTotal = items
    .filter((i) => i.status === "pending")
    .reduce((sum, i) => sum + i.total, 0);

  // Fetch per-friend dashboard stats from the Python sandbox backend
  let stats: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`http://localhost:8000/api/demo/stats/${params.userId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) stats = await res.json();
  } catch {
    // sandbox not running or stats not seeded yet — proceed without stats
  }

  // Adjust static stats to reflect real payment activity
  if (stats) {
    const baseTotal  = (stats.balance_total as number) ?? 0;
    const liveTotal  = Math.max(0, baseTotal - lifetimePaid);
    stats.balance_total = liveTotal;
    stats.balance_whole = Math.floor(liveTotal).toLocaleString();
    stats.balance_cents = String(Math.round((liveTotal % 1) * 100)).padStart(2, "0");

    // Update last sparkline point to match live balance
    const sparkline = stats.sparkline as number[] | undefined;
    if (Array.isArray(sparkline) && sparkline.length > 0) {
      sparkline[sparkline.length - 1] = Math.round(liveTotal);
    }

    // Reflect paid amounts in cashflow
    const baseCfOut = (stats.cashflow_out as number) ?? 0;
    const liveCfOut = baseCfOut + lifetimePaid;
    const liveCfIn  = (stats.cashflow_in as number) ?? 0;
    stats.cashflow_out = liveCfOut;
    stats.cashflow_net = liveCfIn - liveCfOut;

    // Bump Splits category by lifetime_paid
    const cats = stats.categories as { label: string; value: number; color: string }[] | undefined;
    if (Array.isArray(cats)) {
      const splitsRow = cats.find((c) => c.label === "Splits");
      if (splitsRow) splitsRow.value = Math.round(lifetimePaid);
    }

    // Surface pending total so frontend can show exact "waiting on you" amount
    stats.pending_total = Math.round(pendingTotal * 100) / 100;
  }

  return NextResponse.json({ user, items, stats, lifetime_paid: lifetimePaid });
}
