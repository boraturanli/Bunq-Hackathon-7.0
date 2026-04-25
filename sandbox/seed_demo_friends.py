"""
seed_demo_friends.py — run ONCE before the live demo.

Tells the running FastAPI server to create 5 sandbox personas
and make payments to each, so they appear in GET /api/contacts/top.

Usage:
  1. Start the API server first:
       python -m uvicorn tinker.api_app:app --reload --port 8000
  2. Then in a second terminal:
       python seed_demo_friends.py

Takes about 30 seconds.
"""

import sys
import requests

API = "http://localhost:8000"


def main():
    print("Seeding demo friends via FastAPI… (this takes ~30 s)\n")

    try:
        resp = requests.post(f"{API}/api/sandbox/seed-friends", timeout=120)
    except requests.ConnectionError:
        print("ERROR: Could not connect to the API server.")
        print(f"Make sure it is running at {API}")
        sys.exit(1)

    if resp.status_code == 409:
        print("Seeding already in progress — wait for it to finish.")
        sys.exit(1)

    if not resp.ok:
        print(f"ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)

    data = resp.json()
    print(f"Done! {data['seeded']} friends seeded.\n")
    for f in data["friends"]:
        status = "✓" if f["status"] == "ok" else "⚠"
        print(f"  {status}  {f['name']:<30}  {f.get('iban', '—')}")

    print("\nTop contacts are now available at GET /api/contacts/top")


if __name__ == "__main__":
    main()
