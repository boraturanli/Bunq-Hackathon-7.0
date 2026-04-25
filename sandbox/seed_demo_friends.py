"""
seed_demo_friends.py  —  run ONCE before the live demo.

Creates sandbox personas with rich transaction history and writes demo_data.json,
which feeds all dashboard endpoints.

Usage:
  1. Start the API:
       cd sandbox && python -m uvicorn tinker.api_app:app --reload --port 8000
  2. Run this script (second terminal, same sandbox/ directory):
       python seed_demo_friends.py [--count N] [--payments N] [--incoming N]

  Takes ~90 s for 5 friends.
"""

import sys
import json
import argparse
import requests

API = "http://localhost:8000"

ICONS = {
    "food": "🍕", "groceries": "🛒", "entertainment": "🎬",
    "transport": "🚗", "health": "💊", "shopping": "🛍", "travel": "✈️",
}


def bar(value: float, total: float, width: int = 18) -> str:
    if total <= 0:
        return "░" * width
    filled = min(width, int(round(value / total * width)))
    return "█" * filled + "░" * (width - filled)


def sign(n: float) -> str:
    return f"+{n:.2f}" if n >= 0 else f"{n:.2f}"


def main():
    p = argparse.ArgumentParser(description="Seed bunqShare demo data")
    p.add_argument("--count",    type=int, default=5,  help="Number of friends (default 5)")
    p.add_argument("--payments", type=int, default=10, help="Outgoing payments per friend")
    p.add_argument("--incoming", type=int, default=2,  help="Incoming payments per friend")
    args = p.parse_args()

    est = args.count * (args.payments * 0.30 + args.incoming * 0.35 + 6)
    print(f"\n{'━'*60}")
    print(f"  bunqShare demo seed")
    print(f"  {args.count} friends  ·  {args.payments} outgoing  ·  {args.incoming} incoming each")
    print(f"  Estimated time: ~{est:.0f} s")
    print(f"{'━'*60}\n")

    try:
        resp = requests.post(
            f"{API}/api/sandbox/seed-friends",
            params={"count": args.count,
                    "payments_each": args.payments,
                    "incoming_each": args.incoming},
            timeout=600,
            stream=True,
        )
    except requests.ConnectionError:
        print(f"  ✗  Cannot connect to {API}")
        print("     Start the server first: python -m uvicorn tinker.api_app:app --port 8000")
        sys.exit(1)

    if resp.status_code == 409:
        print("  ✗  Seeding already in progress — wait for it to finish.")
        sys.exit(1)
    if not resp.ok:
        print(f"  ✗  Error {resp.status_code}: {resp.text}")
        sys.exit(1)

    # ── Stream progress lines ─────────────────────────────────────────────
    seed_data = None
    for raw_line in resp.iter_lines():
        if not raw_line:
            continue
        try:
            ev = json.loads(raw_line)
        except json.JSONDecodeError:
            print(f"  ?  {raw_line}")
            continue

        kind = ev.get("event", "")

        if kind == "start":
            print(f"  → Seeding {ev['count']} friend(s), "
                  f"{ev['payments_each']} outgoing, {ev['incoming_each']} incoming each\n")

        elif kind == "balance":
            print(f"  💰 Account balance: €{ev['eur']:.2f}")

        elif kind == "daily_limit":
            if ev.get("ok"):
                print(f"  🔓 Daily limit raised to €{ev['value']}")
            else:
                print(f"  ⚠  Daily limit unchanged (update failed — payments may hit €1 000 cap)")

        elif kind == "main_user":
            iban_str = f"  IBAN: …{ev['iban'][-10:]}" if ev.get("iban") else ""
            print(f"  👤 Main user: {ev['name']}{iban_str}\n")

        elif kind == "topup_start":
            print(f"  ⬆  Balance low — topping up {ev['rounds']}× €500 …")

        elif kind == "topup_round":
            print(f"     top-up {ev['round']}/{ev['of']} ✓")

        elif kind == "topup_warn":
            print(f"     top-up {ev['round']} skipped: {ev['error']}")

        elif kind == "topup_done":
            print(f"  ✓  Top-up complete\n")

        elif kind == "friend_start":
            print(f"  [{ev['index']}/{ev['of']}] Creating friend …")

        elif kind == "friend_created":
            iban_tail = (ev.get("iban") or "")[-10:]
            print(f"       {ev['name']}  …{iban_tail}")

        elif kind == "friend_skip":
            print(f"       ⚠  {ev['name']} skipped ({ev['reason']})")

        elif kind == "payment_out":
            bar_str = bar(ev["n"], ev["of"], 14)
            print(f"       → [{bar_str}] {ev['n']:>2}/{ev['of']}  "
                  f"€{ev['eur']:>6.2f}  {ev['desc'][:32]}")

        elif kind == "payment_in":
            print(f"       ← in  {ev['n']:>2}/{ev['of']}  €{ev['eur']:>6.2f}  {ev['desc'][:32]}")

        elif kind == "payment_in_fail":
            print(f"       ← in  {ev['n']:>2}/{ev['of']}  ✗ failed")

        elif kind == "friend_done":
            print(f"       ✓  sent €{ev['sent']:.2f}  received €{ev['received']:.2f}\n")

        elif kind == "building_demo_data":
            print(f"  📊 Building demo_data.json …")

        elif kind == "done":
            seed_data = ev
            seeded = ev["seeded"]
            print(f"  ✓  {seeded} friend{'s' if seeded != 1 else ''} seeded\n")

        elif kind == "error":
            print(f"\n  ✗  {ev['message']}")
            sys.exit(1)

    if not seed_data:
        print("  ✗  Stream ended without a done event.")
        sys.exit(1)

    # ── Summary table ─────────────────────────────────────────────────────
    print(f"  {'Name':<28} {'IBAN':>14}  {'Out':>4}  {'In':>3}  {'Sent':>8}  {'Recv':>8}  {'Bal':>9}")
    print(f"  {'─'*28} {'─'*14}  {'─'*4}  {'─'*3}  {'─'*8}  {'─'*8}  {'─'*9}")
    for f in seed_data.get("friends", []):
        if f["status"] != "ok":
            print(f"  ⚠  {f['name']:<26}  {f['status']}")
            continue
        iban_tail = (f.get("iban") or "")[-10:]
        out  = f.get("payments", 0)
        inc  = f.get("incoming", 0)
        sent = f.get("total_sent", 0)
        recv = f.get("total_received", 0)
        bal  = sent - recv
        print(f"  ✓  {f['name']:<26} …{iban_tail}  {out:>4}  {inc:>3}  "
              f"€{sent:>6.2f}  €{recv:>6.2f}  {sign(bal):>9}")

    # ── Pull demo_data summary ────────────────────────────────────────────
    demo_resp = requests.get(f"{API}/api/demo", timeout=15)
    if not demo_resp.ok:
        print("\n  ✗  Could not fetch demo_data.json for summary.")
        return

    demo = demo_resp.json()

    # Monthly history snapshot (last 3 months)
    history = demo.get("monthly_history", [])
    if history:
        print(f"\n  {'━'*60}")
        print(f"  Spending — last 3 months")
        print(f"  {'─'*60}")
        for m in history[-3:]:
            print(f"\n  {m['label']}   spent €{m['spent']:.2f}  received €{m['received']:.2f}  net {sign(m['net'])}")
            total = m["spent"] or 1
            for cat, amt in sorted(m["by_category"].items(), key=lambda x: -x[1]):
                icon = ICONS.get(cat, "·")
                pct  = amt / total
                b    = bar(amt, total, 16)
                print(f"    {icon} {cat:<14}  {b}  €{amt:>7.2f}  {pct*100:.0f}%")
            overruns = [(c, a, m["budgets"].get(c, 0))
                        for c, a in m["by_category"].items()
                        if a > m["budgets"].get(c, 0)]
            if overruns:
                print(f"    ⚠  Over budget: " +
                      ", ".join(f"{c} (+€{a-b:.0f})" for c, a, b in overruns))

    # Portfolio
    port_resp = requests.get(f"{API}/api/demo/portfolio", timeout=10)
    if port_resp.ok:
        port = port_resp.json()
        holdings = port.get("holdings", [])
        summary  = port.get("summary", {})
        if holdings:
            print(f"\n  {'━'*60}")
            print(f"  Portfolio   "
                  f"€{summary.get('total_value',0):.2f} total  "
                  f"gain {sign(summary.get('total_gain',0))} ({summary.get('total_gain_pct',0):+.1f}%)")
            print(f"  {'─'*60}")
            for h in sorted(holdings, key=lambda x: -x["value"]):
                arrow = "▲" if h["gain"] >= 0 else "▼"
                print(f"  {h['symbol']:<6}  {h['name']:<22}  "
                      f"{h['shares']:>3} sh  "
                      f"€{h['value']:>9.2f}  "
                      f"{arrow} {abs(h['gain_pct']):.1f}%  "
                      f"1d {h['change_1d_pct']:+.1f}%")
            sectors = summary.get("by_sector", {})
            if sectors:
                print(f"\n  By sector:")
                for sec, sv in sorted(sectors.items(), key=lambda x: -x[1]["value"]):
                    print(f"    {sec:<16}  €{sv['value']:.2f}  gain {sign(sv['gain'])}")

    # Insights
    ins_resp = requests.get(f"{API}/api/demo/insights", timeout=10)
    if ins_resp.ok:
        ins = ins_resp.json()
        print(f"\n  {'━'*60}")
        print(f"  Insights")
        print(f"  {'─'*60}")
        trend = "↑" if ins.get("spend_trend") == "up" else "↓"
        print(f"  Avg monthly spend:  €{ins.get('avg_monthly_spend',0):.2f}")
        print(f"  This month trend:   {trend} {abs(ins.get('spend_trend_pct',0)):.1f}% vs last month")
        print(f"  Savings rate:       {ins.get('savings_rate',0)*100:.0f}%")
        print(f"  Top category:       {ins.get('top_category_this_month','')}  €{ins.get('top_category_amount',0):.2f}")
        print(f"  Top merchants:")
        for m in ins.get("top_merchants", [])[:5]:
            print(f"    {m['name']:<24}  €{m['amount']:>8.2f}  ({m['visits']} visits)")

    # Friend profiles
    prof_resp = requests.get(f"{API}/api/demo/profiles", timeout=10)
    if prof_resp.ok:
        profiles = prof_resp.json()
        print(f"\n  {'━'*60}")
        print(f"  Friend profiles")
        print(f"  {'─'*60}")
        for pf in profiles:
            bal = pf.get("balance", 0)
            print(f"\n  {pf['name']}  [{pf['occupation']}]")
            print(f"    {pf['bio']}")
            print(f"    Sent €{pf['total_sent']:.2f}  Received €{pf['total_received']:.2f}  "
                  f"Balance {sign(bal)} {'(they owe you)' if bal > 0 else '(you owe them)' if bal < 0 else ''}")
            print(f"    Pattern: {pf['spending_pattern']}  "
                  f"Top: {', '.join(pf['top_categories'][:3])}")
            print(f"    Portfolio: {len(pf['portfolio'])} holdings  "
                  f"Total €{sum(h['value'] for h in pf['portfolio']):.2f}")
            for g in pf.get("savings_goals", []):
                b = bar(g["progress"], 1.0, 14)
                print(f"    💰 {g['name']:<22}  [{b}]  "
                      f"€{g['saved']:.0f}/€{g['target']}  ({g['progress']*100:.0f}%)")

    print(f"\n  {'━'*60}")
    print(f"  Endpoints ready:")
    endpoints = [
        "/api/demo                  — full data blob",
        "/api/demo/portfolio        — stocks, gains, sector breakdown",
        "/api/demo/monthly-history  — 12-month spending/category/merchant/budget",
        "/api/demo/balance-history  — weekly balance snapshots",
        "/api/demo/insights         — averages, trends, top merchants",
        "/api/demo/messages         — chat threads (filter: ?friend=<name>)",
        "/api/demo/profiles         — enriched friend profiles",
        "/api/demo/profiles/<name>  — single profile",
    ]
    for ep in endpoints:
        print(f"    GET {API}{ep}")
    print(f"\n  demo_data.json → {seed_data.get('demo_data', 'sandbox/tinker/demo_data.json')}")
    print(f"{'━'*60}\n")


if __name__ == "__main__":
    main()
