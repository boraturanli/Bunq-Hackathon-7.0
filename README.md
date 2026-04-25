# SnapSplit — bunq Hackathon 7.0

Photograph a receipt → AI parses line items → share a link → each person taps what they had → everyone pays the host automatically through bunq.

---

## Architecture

Two independent services talk to each other over HTTP:

```
receipt-parser/   (Next.js 14, port 3000)
   app/api/parse          — Sharp → GPT-4o → Receipt JSON
   app/api/contacts/top   — proxies GET sandbox:8000/api/contacts/top
   app/api/session        — creates split session, emails invite links
   app/api/session/[id]/[inviteeId]/pay  — computes share, calls bunq payment
   app/api/session/[id]/[inviteeId]/skip — marks invitee as skipped
   app/api/inbox/[userId] — returns InboxItems + DashboardStats for home screen

sandbox/          (FastAPI + bunq Python SDK, port 8000)
   tinker/api_app.py      — all REST endpoints
   tinker/libs/bunq_lib.py— thin wrapper around bunq_sdk
   bunq-sandbox.conf      — SDK session state (gitignored)
   tinker/demo_data.json  — written by /api/sandbox/seed-friends
```

### Request flow — host scans a receipt

1. `POST /api/parse` (Next.js) receives `multipart/form-data` with the image.
2. Sharp sharpens and normalises the image server-side.
3. The image is base64-encoded and sent to GPT-4o (`gpt-4o-2024-08-06`) with a structured-output prompt that returns a `Receipt` JSON object.
4. The server validates `sum(line_totals) + tax + tip ≈ total` (±2%). On mismatch it still returns data with `{ warning: "totals_mismatch" }`.
5. The host sees parsed line items and opens the people panel.
6. `GET /api/contacts/top` (Next.js) → forwards to `sandbox:8000/api/contacts/top`, which reads the last 100 payments and requests, ranks counterparties by frequency, and strips the sugardaddy top-up account.
7. Host selects friends, taps **Send Links**.
8. `POST /api/session` creates an in-memory session (keyed by UUID), generates per-invitee UUIDs, sends invite emails, and returns `{ sessionId }`.

### Request flow — invitee opens their link

1. `GET /split/[sessionId]/[inviteeId]` renders the invitee page.
2. `GET /api/session/[sessionId]` returns the receipt + host name (public, no auth).
3. Invitee taps items (solo claim) or uses +/− to set shared count. `ItemClaim[]` is pure client state.
4. **Confirm & Pay** calls `POST /api/session/[sessionId]/[inviteeId]/pay` with the claims.
5. The server computes `sum(line_total / sharedWith)` for each claimed item, then calls `sandbox:8000/api/payment` to transfer that amount from the invitee's bunq account to the host's IBAN.
6. Invitee is marked `paid` in session store; host tracking screen polls `GET /api/session/[sessionId]/status` every 3 seconds.

### Sandbox seeding flow

`POST sandbox:8000/api/sandbox/seed-friends` streams NDJSON progress:

1. Bumps main account daily limit to €10 000 (`MonetaryAccountBank.update` with `daily_limit`).
2. Top-ups main account in €500 rounds via `RequestInquiry` to `sugardaddy@bunq.com` (auto-approved by bunq sandbox in ~1 s).
3. For each friend: generates a new sandbox user (`POST /v1/sandbox-user-person`), reads their IBAN, then sends N outgoing payments (€4–€220, drawn from `_TX` template table with `random.Random(2025 + i)`) and M incoming payments back.
4. Builds `demo_data.json` with 12-month spending history, portfolio holdings, savings goals, and message threads — all deterministically seeded per friend index so amounts vary across friends but are reproducible.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 9+ |
| bunq sandbox API key | see below |
| OpenAI API key | platform.openai.com |

---

## Quick start

### 1 — Clone and get a bunq sandbox key

```bash
git clone <repo-url>
cd Bunq-Hackathon-7.0

# Create a sandbox user (free, no signup needed)
curl -s -X POST https://public-api.sandbox.bunq.com/v1/sandbox-user-person \
  -H "x-bunq-client-request-id: setup-$(date +%s)" \
  -H "cache-control: no-cache" \
  -H "x-bunq-geolocation: 0 0 0 0 NL" \
  -H "x-bunq-language: en_US" \
  -H "x-bunq-region: en_US" \
  | python -c "import sys,json; print(json.load(sys.stdin)['Response'][0]['ApiKey']['api_key'])"
```

Copy the printed key — you'll need it in step 2.

### 2 — Python backend (sandbox)

```bash
cd sandbox

python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt

# First run: authenticates with bunq and writes bunq-sandbox.conf
BUNQ_API_KEY=sandbox_<your_key> python -m uvicorn tinker.api_app:app --reload --port 8000
```

Subsequent runs don't need `BUNQ_API_KEY` — the conf file is reused automatically.

### 3 — Next.js frontend

```bash
cd receipt-parser

npm install

cp .env.example .env.local
# Open .env.local and set OPENAI_API_KEY=sk-...
# Without this, the /api/parse route will fail — GPT-4o vision is called server-side
# and there is no fallback. Receipt scanning will not work.

npm run dev
```

App is at http://localhost:3000.

### 4 — Seed demo data (optional but recommended for the dashboard)

In a third terminal, with the API running:

```bash
cd sandbox
python seed_demo_friends.py --count 5 --payments 10 --incoming 2
```

Takes ~90 s. Writes `tinker/demo_data.json` and prints a full summary table. Afterwards all `/api/demo/*` endpoints are live.

---

## Environment variables

### receipt-parser/.env.local

> **Required before running the frontend.** Copy `.env.example` to `.env.local` and fill in your OpenAI key. Without it, every receipt scan will return a 500 error — GPT-4o vision is called server-side with no fallback.

```
OPENAI_API_KEY=sk-...           # REQUIRED — get one at platform.openai.com
VISION_MODEL=gpt-4o-2024-08-06  # optional — defaults to gpt-4o-2024-08-06
BUNQ_API_URL=http://localhost:8000  # optional — defaults to localhost:8000
```

### sandbox (shell exports, not a .env file)

```
BUNQ_API_KEY=sandbox_...        # Required on first run only; stored in bunq-sandbox.conf after that
```

---

## Python dependencies

```
# sandbox/requirements.txt
bunq_sdk==1.28.0
fastapi==0.136.1
uvicorn==0.46.0
requests==2.31.0
pydantic==2.13.3
```

---

## API reference — sandbox (port 8000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user` | Current user ID and display name |
| GET | `/api/aliases` | Your email, IBAN, phone aliases |
| GET | `/api/balance` | Primary account balance |
| GET | `/api/accounts` | All active monetary accounts |
| GET | `/api/transactions` | Recent payments (amount, direction, counterparty) |
| POST | `/api/payment` | Send a payment |
| GET | `/api/requests` | Pending payment requests |
| POST | `/api/request` | Request money |
| GET | `/api/contacts/top` | Top N contacts by transaction frequency |
| GET | `/api/contacts` | All contacts (saved + history-derived) |
| POST | `/api/contacts` | Save a contact manually |
| DELETE | `/api/contacts/{pointer_value}` | Remove a saved contact |
| GET | `/api/cards` | Card list |
| GET | `/api/budget` | Monthly spending summary |
| POST | `/api/sandbox/seed-friends` | Stream-seed demo friends + payments |
| POST | `/api/sandbox/topup` | Top up balance from sugardaddy |
| POST | `/api/sandbox/bump-daily-limit` | Raise daily limit to €10 000 |
| GET | `/api/demo` | Full demo_data.json blob |
| GET | `/api/demo/profiles` | Enriched friend profiles |
| GET | `/api/demo/profiles/{name}` | Single friend profile |
| GET | `/api/demo/stats/{contact_id}` | Dashboard stats for a contact |

---

## API reference — Next.js (port 3000)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/parse` | `multipart/form-data` image → `Receipt` JSON |
| GET | `/api/contacts/top` | Proxies sandbox `/api/contacts/top` |
| POST | `/api/session` | Create split session, send invite emails |
| GET | `/api/session/[sessionId]` | Public: receipt + host name for invitee |
| GET | `/api/session/[sessionId]/status` | Host: live invitee payment status |
| POST | `/api/session/[sessionId]/[inviteeId]/pay` | Execute bunq payment + mark paid |
| POST | `/api/session/[sessionId]/[inviteeId]/skip` | Mark invitee as skipped |
| GET | `/api/inbox/[userId]` | Inbox items + dashboard stats |

---

## Key data structures

```typescript
interface Receipt {
  merchant: string;
  date: string;        // ISO 8601
  currency: string;    // "EUR"
  items: LineItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

interface LineItem {
  id: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface ItemClaim {
  itemId: number;
  sharedWith: number;  // cost = line_total / sharedWith
}

interface Invitee {
  id: string;          // UUID used in invite URL
  name: string;
  email: string;
  status: 'pending' | 'paid' | 'skipped';
  claims: ItemClaim[];
  amountPaid?: number;
}
```

---

## File map

```
Bunq-Hackathon-7.0/
├── README.md                          ← you are here
├── requirements.txt                   ← root-level Python deps (bunq_sdk only)
├── explore_bunq.py                    ← quick bunq API explorer script
│
├── sandbox/
│   ├── requirements.txt               ← full backend deps (fastapi, uvicorn, etc.)
│   ├── seed_demo_friends.py           ← CLI demo seeder with live progress output
│   ├── bunq-sandbox.conf              ← SDK session state (gitignored)
│   └── tinker/
│       ├── api_app.py                 ← FastAPI app, all routes and seed logic
│       ├── demo_data.json             ← written by seed-friends (gitignored)
│       └── libs/
│           └── bunq_lib.py            ← BunqLib wrapper around bunq_sdk
│
└── receipt-parser/
    ├── .env.example                   ← copy to .env.local and fill in keys
    ├── package.json
    ├── tsconfig.json
    ├── app/
    │   ├── page.tsx                   ← host capture + people panel + send links
    │   ├── layout.tsx
    │   ├── inbox/[userId]/page.tsx    ← friend dashboard + inbox + home view
    │   ├── split/[sessionId]/[inviteeId]/page.tsx  ← invitee item selection + pay
    │   └── api/
    │       ├── parse/route.ts         ← Sharp + GPT-4o receipt extraction
    │       ├── contacts/top/route.ts  ← proxy to sandbox /api/contacts/top
    │       ├── session/route.ts       ← create session + send invite emails
    │       ├── session/[sessionId]/route.ts
    │       ├── session/[sessionId]/[inviteeId]/pay/route.ts
    │       ├── session/[sessionId]/[inviteeId]/skip/route.ts
    │       └── inbox/[userId]/route.ts
    └── lib/
        ├── design/
        │   ├── tokens.ts              ← colour tokens, font stacks
        │   ├── icons.ts               ← SVG icon helpers
        │   └── primitives.tsx         ← Avatar, Money, Sparkline, DonutChart, etc.
        └── prompts/
            └── parseReceipt.ts        ← GPT-4o system prompt + JSON schema
```

---

## Troubleshooting

**`BUNQ_API_KEY` not found on startup**
The conf file (`sandbox/bunq-sandbox.conf`) is missing or expired. Export the key and restart — the SDK will re-authenticate and write a fresh conf file.

**`bunq-sandbox.conf` session expired**
bunq sandbox sessions last 1 week. Re-export `BUNQ_API_KEY` and restart the server.

**`demo_data.json not found` on `/api/demo`**
Run `python seed_demo_friends.py` first.

**Payment hits €1 000 daily cap**
Call `POST sandbox:8000/api/sandbox/bump-daily-limit` or restart the seed (it bumps automatically at the start of each seed run).

**OpenAI parse returns empty items**
The image is too dark or blurry. Sharp helps, but extremely low-contrast receipts may fail. Prompt the user to retake with better lighting.
