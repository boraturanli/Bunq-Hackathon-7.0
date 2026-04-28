Demo Video: https://www.youtube.com/watch?v=CX4Yl_2-ClI

# bunqShare

bunqShare is an add-on platform for bunq that makes splitting a bill as smooth as possible — especially for the person picking up the tab.

Take a photo of the receipt. Computer vision reads every line item in seconds, across any language or receipt format. bunqShare pulls your most frequent bunq contacts automatically, so you pick people from a list rather than typing names and IBANs. Each friend gets a unique link by email. They tap the items they had, confirm, and the money moves directly into your bunq account. No chasing, no manual transfers, no rounding arguments.

> **Built for bunq Hackathon 7.0.** The backend runs against the bunq sandbox environment — all payments, accounts, and contacts are simulated. Switching to production requires changing a single environment flag and swapping in a live API key.

---

## How it works

### The host scans and sends

1. Open the app and photograph a restaurant receipt (or upload from the gallery).
2. GPT-4o vision processes the image server-side — every line item, quantity, and price is extracted into structured JSON within a few seconds. The image is sharpened first using Sharp to improve accuracy on dark or blurry photos.
3. A side panel opens showing your top bunq contacts, ranked by how often you've transacted with them. Select who was at dinner, or add someone manually by name and email.
4. Tap **Send Links**. A session is created server-side and each person receives their own unique invite link by email.
5. A live tracking screen shows who has paid and who hasn't, updating every three seconds.

### The friend pays

1. The friend opens their link — no app download, no account creation needed, just a browser.
2. They see the full receipt. Tapping an item claims it solo. Tapping again enters sharing mode, where +/− sets how many people are splitting that item. The running total at the bottom updates live.
3. Tapping **Confirm & Pay** triggers a bunq payment from their account directly to the host's IBAN. The exact amount is calculated server-side from their selections.
4. The host's tracking screen flips the friend's status to Paid, with a breakdown of what they covered.

### From photo to everyone paid: under 90 seconds.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Image processing | Sharp — sharpening and normalisation before OCR |
| Receipt parsing | OpenAI GPT-4o vision with structured JSON output |
| Backend API | FastAPI (Python 3.11), bunq Python SDK v1.28 |
| Payments | bunq sandbox API (production-ready with one config change) |
| Session state | In-memory server store keyed by UUID — no database needed |

---

## Sandbox vs production

All payment flows are currently wired to the **bunq sandbox** (`public-api.sandbox.bunq.com`). In sandbox mode, accounts are synthetic, money is not real, and a special `sugardaddy@bunq.com` address automatically approves any incoming fund request.

To point bunqShare at live bunq accounts, two things change:

1. In `sandbox/tinker/libs/bunq_lib.py`, replace `ApiEnvironmentType.SANDBOX` with `ApiEnvironmentType.PRODUCTION`.
2. Supply a production bunq API key instead of a sandbox one.

Everything else — the payment logic, contact ranking, session handling, OAuth flow — is identical between environments. The SDK abstracts the difference entirely.

---

## Running it locally

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Python | 3.11 |
| Node.js | 18 |
| npm | 9 |
| OpenAI API key | [platform.openai.com](https://platform.openai.com) |
| bunq sandbox API key | free, see step 1 |

### Step 1 — Get a bunq sandbox key

No bunq account needed. This creates a free sandbox user in seconds:

```bash
curl -s -X POST https://public-api.sandbox.bunq.com/v1/sandbox-user-person \
  -H "x-bunq-client-request-id: setup-$(date +%s)" \
  -H "cache-control: no-cache" \
  -H "x-bunq-geolocation: 0 0 0 0 NL" \
  -H "x-bunq-language: en_US" \
  -H "x-bunq-region: en_US" \
  | python -c "import sys,json; print(json.load(sys.stdin)['Response'][0]['ApiKey']['api_key'])"
```

Copy the printed `sandbox_...` key.

### Step 2 — Start the Python backend

```bash
cd sandbox

python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # macOS / Linux

pip install -r requirements.txt

# Authenticates with bunq and writes bunq-sandbox.conf
BUNQ_API_KEY=sandbox_<your_key> python -m uvicorn tinker.api_app:app --reload --port 8000
```

Subsequent restarts do not need `BUNQ_API_KEY` — the conf file is reused automatically. bunq sandbox sessions last one week; re-export the key if the session expires.

### Step 3 — Start the Next.js frontend

```bash
cd receipt-parser

npm install

cp .env.example .env.local
```

Open `.env.local` and set your OpenAI key:

```
OPENAI_API_KEY=sk-...
```

**This is required.** Without it the `/api/parse` route fails immediately — GPT-4o vision is called server-side and there is no fallback. Receipt scanning will not work.

```bash
npm run dev
```

App is at **http://localhost:3000**.

### Step 4 — Seed demo data (recommended)

With the backend running, open a third terminal:

```bash
cd sandbox
python seed_demo_friends.py --count 5 --payments 10 --incoming 2
```

This takes around 90 seconds and populates the app with five realistic friend profiles, 12 months of spending history, portfolio holdings, and savings goals. The dashboard and inbox screens are thin without it.

---

## Environment variables

### `receipt-parser/.env.local`

```
OPENAI_API_KEY=sk-...            # required — receipt parsing via GPT-4o vision
VISION_MODEL=gpt-4o-2024-08-06   # optional — defaults to gpt-4o-2024-08-06
BUNQ_API_URL=http://localhost:8000  # optional — defaults to localhost:8000
```

### `sandbox/` (exported in shell, not a file)

```
BUNQ_API_KEY=sandbox_...         # required on first run; persisted to bunq-sandbox.conf after that
```

---

## Project structure

```
Bunq-Hackathon-7.0/
│
├── sandbox/                          Python backend
│   ├── requirements.txt
│   ├── seed_demo_friends.py          CLI seeder — run before demoing the dashboard
│   ├── bunq-sandbox.conf             SDK session state (gitignored)
│   └── tinker/
│       ├── api_app.py                all FastAPI routes + seeding logic
│       ├── demo_data.json            written by seed-friends (gitignored)
│       └── libs/
│           └── bunq_lib.py           thin wrapper around bunq_sdk
│
└── receipt-parser/                   Next.js frontend
    ├── .env.example
    ├── app/
    │   ├── page.tsx                  host: capture screen + people panel + send links
    │   ├── inbox/[userId]/page.tsx   home dashboard + inbox + friend stats
    │   ├── split/[sessionId]/
    │   │   └── [inviteeId]/page.tsx  invitee: item selection + confirm & pay
    │   └── api/
    │       ├── parse/route.ts        Sharp → GPT-4o → Receipt JSON
    │       ├── contacts/top/route.ts proxies sandbox /api/contacts/top
    │       ├── session/route.ts      create session, send invite emails
    │       ├── session/[sessionId]/[inviteeId]/pay/route.ts
    │       └── session/[sessionId]/[inviteeId]/skip/route.ts
    └── lib/
        ├── design/tokens.ts          colour palette, font stacks
        ├── design/primitives.tsx     Avatar, Money, Sparkline, DonutChart, BarChart
        └── prompts/parseReceipt.ts   GPT-4o system prompt + Receipt JSON schema
```

---

## Troubleshooting

**Backend fails to start — `BUNQ_API_KEY` not found**
`bunq-sandbox.conf` is missing or corrupted. Export `BUNQ_API_KEY` and restart; the SDK will re-authenticate and write a fresh file.

**Session expired after a few days**
bunq sandbox sessions last one week. Re-export `BUNQ_API_KEY` and restart the server.

**Dashboard shows no data**
Run `seed_demo_friends.py` — the demo endpoints return 404 until `demo_data.json` exists.

**Payments fail with a daily limit error**
The sandbox default cap is €1 000/day. The seeder bumps this to €10 000 automatically at startup, but you can also call `POST localhost:8000/api/sandbox/bump-daily-limit` manually.

**Receipt parsing returns empty or wrong items**
The photo is likely too dark or low-contrast. Sharp preprocessing helps significantly, but extremely poor lighting can still produce bad results. Prompt the user to retake the photo in better light.
