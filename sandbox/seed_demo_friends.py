"""
seed_demo_friends.py — run ONCE before the live demo.

Creates 5 sandbox personas with rich transaction history and writes demo_data.json,
which populates all dashboard endpoints (portfolio, monthly history, messages, profiles).

Usage:
  1. Start the API server:
       python -m uvicorn tinker.api_app:app --reload --port 8000
  2. Then in a second terminal:
       python seed_demo_friends.py

Options (passed as query params to the API):
  --count N          Number of friends to seed  (default: 5)
  --payments N       Outgoing payments per friend (default: 10)
  --incoming N       Incoming payments per friend (default: 2)

Takes ~90 seconds for 5 friends.
"""

import sys
import argparse
import requests

API = "http://localhost:8000"

CATEGORY_ICONS = {
    "food":          "🍕",
    "entertainment": "🎬",
    "transport":     "🚗",
    "groceries":     "🛒",
    "shopping":      "🛍",
    "health":        "💊",
    "travel":        "✈️",
}


def bar(value: float, total: float, width: int = 20) -> str:
    filled = int(round(value / total * width)) if total else 0
    return "█" * filled + "░" * (width - filled)


def main():
    parser = argparse.ArgumentParser(description="Seed SnapSplit demo data")
    parser.add_argument("--count",    type=int, default=5,  help="Number of friends")
    parser.add_argument("--payments", type=int, default=10, help="Outgoing payments per friend")
    parser.add_argument("--incoming", type=int, default=2,  help="Incoming payments per friend")
    args = parser.parse_args()

    print(f"\n{'─'*56}")
    print(f"  SnapSplit — seeding demo data")
    print(f"  {args.count} friends · {args.payments} out · {args.incoming} in each")
    print(f"  ~{args.count * (args.payments * 0.3 + args.incoming * 0.35 + 5):.0f} s estimated")
    print(f"{'─'*56}\n")

    try:
        resp = requests.post(
            f"{API}/api/sandbox/seed-friends",
            params={
                "count":         args.count,
                "payments_each": args.payments,
                "incoming_each": args.incoming,
            },
            timeout=300,
        )
    except requests.ConnectionError:
        print(f"ERROR: Cannot connect to {API}")
        print("Make sure the API server is running.")
        sys.exit(1)

    if resp.status_code == 409:
        print("Seeding already in progress — wait for it to finish.")
        sys.exit(1)

    if not resp.ok:
        print(f"ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)

    data   = resp.json()
    seeded = data["seeded"]

    print(f"✓  {seeded} friend{'' if seeded == 1 else 's'} seeded\n")
    print(f"  {'Name':<28}  {'IBAN':<20}  {'Out':>4}  {'In':>3}")
    print(f"  {'─'*28}  {'─'*20}  {'─'*4}  {'─'*3}")
    for f in data["friends"]:
        if f["status"] != "ok":
            print(f"  ⚠  {f['name']:<26}  {f['status']}")
            continue
        iban_short = (f.get("iban") or "—")[-12:]
        out = f.get("payments", 0)
        inc = f.get("incoming", 0)
        print(f"  ✓  {f['name']:<26}  …{iban_short}  {out:>4}  {inc:>3}")

    # Pull demo_data summary
    print()
    demo_resp = requests.get(f"{API}/api/demo", timeout=10)
    if demo_resp.ok:
        demo = demo_resp.json()

        # Monthly history snapshot
        history = demo.get("monthly_history", [])
        if history:
            latest = history[-1]
            print(f"  Monthly snapshot  ({latest['label']})")
            print(f"  {'─'*48}")
            total_spent = latest["spent"]
            for cat, amt in sorted(latest["by_category"].items(), key=lambda x: -x[1]):
                icon  = CATEGORY_ICONS.get(cat, "·")
                pct   = amt / total_spent if total_spent else 0
                bbar  = bar(amt, total_spent, 14)
                print(f"  {icon} {cat:<14}  {bbar}  €{amt:>7.2f}  ({pct*100:.0f}%)")
            print(f"\n  Total spent: €{total_spent:.2f}  Received: €{latest['received']:.2f}  Net: €{latest['net']:.2f}")

        # Portfolio snapshot
        portfolio = demo.get("portfolio", [])
        if portfolio:
            print(f"\n  Portfolio  ({len(portfolio)} positions)")
            print(f"  {'─'*48}")
            total_val = sum(p["value"] for p in portfolio)
            for p in sorted(portfolio, key=lambda x: -x["value"]):
                chg    = p["change_pct"]
                arrow  = "▲" if chg >= 0 else "▼"
                print(f"  {p['symbol']:<6}  {p['shares']:>3} sh  €{p['value']:>9.2f}  {arrow} {abs(chg):.1f}%")
            print(f"\n  Total value: €{total_val:.2f}")

        # Friend profiles snapshot
        profiles = demo.get("friends", [])
        if profiles:
            print(f"\n  Friend profiles")
            print(f"  {'─'*48}")
            for p in profiles:
                goal    = p.get("savings", {})
                prog    = goal.get("progress", 0)
                bbar    = bar(prog, 1.0, 10)
                print(f"  {p['name']:<28}  {p['occupation']}")
                print(f"    Saving for: {goal.get('name','—'):<20}  [{bbar}] {prog*100:.0f}%")

        print(f"\n  demo_data.json written to: {data.get('demo_data', 'sandbox/tinker/demo_data.json')}")

    print(f"\n  API endpoints now available:")
    print(f"    GET {API}/api/demo")
    print(f"    GET {API}/api/demo/portfolio")
    print(f"    GET {API}/api/demo/monthly-history")
    print(f"    GET {API}/api/demo/messages")
    print(f"    GET {API}/api/demo/profiles")
    print(f"\n{'─'*56}\n")


if __name__ == "__main__":
    main()
