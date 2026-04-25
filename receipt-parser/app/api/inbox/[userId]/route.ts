import { NextRequest, NextResponse } from "next/server";
import { findSessionsForUser } from "@/lib/sessions/store";
import { getUserById, placeholderUser } from "@/lib/users";

function seededStats(userId: string): Record<string, unknown> {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  let s = Math.abs(h) || 1;
  function rng() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }
  function between(lo: number, hi: number) { return lo + rng() * (hi - lo); }
  function ibet(lo: number, hi: number) { return Math.round(between(lo, hi)); }

  const baseBalance = ibet(900, 4200);
  const sparkline: number[] = [];
  let running = baseBalance - ibet(300, 700);
  for (let i = 0; i < 10; i++) { running = Math.max(running + ibet(-120, 180), 500); sparkline.push(running); }
  sparkline.push(baseBalance);

  const mainBal    = ibet(400, 1500);
  const vacayBal   = ibet(200, 800);
  const savingsBal = Math.max(0, baseBalance - mainBal - vacayBal);

  const monthTotal = ibet(800, 2000);
  const cfIn  = Math.round(monthTotal + between(0, 900));
  const prevMonth = Math.round(monthTotal * between(0.7, 1.3));
  const change = monthTotal - prevMonth;

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const daily = monthTotal / 30;
  const weekly = dayLabels.map(label => ({ label, value: Math.round(between(0.3, 2.5) * daily) }));

  const goalCur1 = ibet(200, 1500); const goalGoal1 = goalCur1 + ibet(500, 2000);
  const goalCur2 = ibet(1000, 6000); const goalGoal2 = goalCur2 + ibet(2000, 8000);
  const goals = [
    { label: '🏝️ Summer Vacay',  cur: goalCur1, goal: goalGoal1, color: '#14B8A6' },
    { label: '🏠 House deposit', cur: goalCur2, goal: goalGoal2, color: '#A78BFA' },
  ];

  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  return {
    balance_total:      baseBalance,
    balance_whole:      Math.floor(baseBalance).toLocaleString(),
    balance_cents:      '00',
    balance_change:     change,
    balance_change_pct: prevMonth > 0 ? Math.round(change / prevMonth * 100) : 0,
    sparkline,
    accounts: [
      { label: 'Main',    amt: `€${mainBal.toLocaleString()}`,    bg: 'linear-gradient(135deg,#B45309,#F59E0B)' },
      { label: 'Vacay',   amt: `€${vacayBal.toLocaleString()}`,   bg: 'linear-gradient(135deg,#0F766E,#14B8A6)' },
      { label: 'Savings', amt: `€${savingsBal.toLocaleString()}`, bg: 'linear-gradient(135deg,#047857,#10B981)' },
    ],
    categories: [
      { label: 'Food & drink', value: ibet(100, 500), color: '#F59E0B' },
      { label: 'Transport',    value: ibet(50,  250), color: '#06B6D4' },
      { label: 'Shopping',     value: ibet(80,  350), color: '#FB7185' },
      { label: 'Bills',        value: ibet(100, 400), color: '#A78BFA' },
      { label: 'Splits',       value: 0,              color: '#00E5A0' },
    ],
    weekly,
    weekly_total:    weekly.reduce((a, w) => a + w.value, 0),
    cashflow_in:     cfIn,
    cashflow_out:    monthTotal,
    cashflow_net:    cfIn - monthTotal,
    cashflow_label:  months[new Date().getMonth()],
    goals,
    goals_on_track:  goals.filter(g => g.cur / g.goal >= 0.5).length,
    goals_total:     goals.length,
  };
}

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

  // Fetch per-friend dashboard stats from the Python sandbox backend; fall back to
  // deterministic seeded stats so every user always gets a unique non-default balance.
  let stats: Record<string, unknown> = seededStats(params.userId);
  try {
    const res = await fetch(`http://localhost:8000/api/demo/stats/${params.userId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) stats = await res.json();
  } catch {
    // sandbox not running — seeded fallback above is used
  }

  // Adjust static stats to reflect real payment activity
  {
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

  return NextResponse.json({ user, items, stats: stats as Record<string, unknown>, lifetime_paid: lifetimePaid });
}
