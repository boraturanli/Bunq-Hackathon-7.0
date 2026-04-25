# SnapSplit — CLAUDE.md

## Project Overview

SnapSplit is a hackathon project for bunq Hackathon 7.0 (24-hour build, April 2026).

Photograph a receipt → AI parses line items → invite friends via link → each person selects what they had → everyone pays the host automatically through bunq.

Built as a mobile-responsive Next.js web app. No native mobile, no multi-currency. Needs minimal server-side session state (in-memory store is fine for demo).

---

## Core Flow

### Host flow
1. Photograph or upload a receipt
2. AI parses line items
3. Open side panel → select people to split with (top 5 bunq friends + manual add by name & email)
4. Tap "Send Links" → each person receives a unique invite link by email
5. Host sees a live tracking screen showing who has paid and who hasn't
6. Host receives a notification each time someone pays, with a summary of what they paid for

### Invitee flow (via unique link)
1. Open link → see the full parsed receipt
2. Tap items they had; tap again on a shared item to split it equally among everyone who also claimed it
3. Running total updates live at the bottom
4. Tap "Confirm & Pay" → bunq OAuth → payment transfers to host's account automatically
5. If they had nothing → tap "I had nothing" → skip payment, close screen

---

## Tech Stack

- **Framework:** Next.js (App Router), TypeScript
- **Styling:** Tailwind CSS
- **State:** React `useReducer` for item-claim logic, `useState` elsewhere
- **Session store:** In-memory Map on the server (keyed by session ID); no external DB needed for demo
- **Vision model:** OpenAI GPT-4o via `/api/parse` server route
- **Image preprocessing:** Sharp (server-side sharpening + basic normalisation)
- **Payments:** bunq API via OAuth — invitees pay host via `payment` endpoint (not payment-request)
- **Deployment:** Vercel (or local for demo)

---

## Architecture

```
[Host: Camera / File Upload]
         ↓
[POST /api/parse — Sharp → GPT-4o → Receipt JSON]
         ↓
[Host: side panel — select top-5 bunq friends + manual add by name/email]
         ↓
[POST /api/session — create session, store receipt + invitees, return sessionId]
         ↓
[Server: email unique links  →  /split/[sessionId]/[inviteeId]  to each person]
         ↓
[Invitee: opens link → GET /api/session/[sessionId] → see receipt]
         ↓
[Invitee: selects items + shared splits → local state]
         ↓
[Invitee: "Confirm & Pay" → bunq OAuth → POST /api/session/[sessionId]/pay]
         ↓
[Server: execute bunq payment from invitee to host → mark invitee as paid]
         ↓
[Host tracking screen polls GET /api/session/[sessionId]/status]
         ↓
[Host sees live payment confirmations + per-person summaries]
```

Vision API calls are server-side. Item-claim logic is pure client state while the invitee is selecting. Session state lives server-side so all participants share the same receipt.

---

## Key Data Structures

### Parsed receipt (output of `/api/parse`)
```typescript
interface Receipt {
  merchant: string;
  date: string;           // ISO 8601
  currency: string;       // "EUR"
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
```

### Session (server-side, in-memory)
```typescript
interface Session {
  id: string;                    // uuid
  receipt: Receipt;
  host: { bunqUserId: string; bunqIban: string; name: string };
  invitees: Invitee[];
  createdAt: number;             // Date.now()
}

interface Invitee {
  id: string;                    // uuid, used in invite link
  name: string;
  email: string;
  status: "pending" | "paid" | "skipped";
  claims: ItemClaim[];           // set when they submit
  amountPaid?: number;
  paidAt?: number;
}

interface ItemClaim {
  itemId: number;
  sharedWith: number;            // how many people claimed this item (including self); cost = line_total / sharedWith
}
```

### Person (side panel)
```typescript
interface Person {
  id: string;
  name: string;
  email: string;
  bunqUserId?: string;           // present for top-5 friends fetched from bunq
  avatarColor: string;
  isTopFriend: boolean;
}
```

---

## API Routes

### `POST /api/parse`
- Accepts: `multipart/form-data` with `image` field
- Preprocesses with Sharp, sends to GPT-4o with structured output
- Validates: `sum(line_totals) + tax + tip ≈ total` (±2% tolerance)
- Returns: `Receipt` JSON or `{ error: string }`
- On mismatch: still return data, include `{ warning: "totals_mismatch" }`

### `GET /api/friends`
- Requires: host bunq OAuth token in session cookie
- Fetches recent payment counterparties from bunq transaction history
- Returns: top 5 by transaction count as `Person[]`

### `POST /api/session`
- Accepts: `{ receipt: Receipt, invitees: { name: string, email: string }[], hostBunqToken: string }`
- Creates session in server-side store, generates unique invitee IDs
- Sends invite emails with links `/split/[sessionId]/[inviteeId]`
- Returns: `{ sessionId: string }`

### `GET /api/session/[sessionId]`
- Public (no auth) — used by invitees to load the receipt
- Returns: `{ receipt: Receipt, merchant: string, hostName: string }`

### `POST /api/session/[sessionId]/pay`
- Accepts: `{ inviteeId: string, claims: ItemClaim[], bunqToken: string }`
- Computes amount from claims, executes bunq `payment` from invitee → host IBAN
- Marks invitee as paid in session store
- Returns: `{ success: boolean, amountPaid: number }`

### `POST /api/session/[sessionId]/skip`
- Accepts: `{ inviteeId: string }`
- Marks invitee as skipped (had nothing, owes nothing)
- Returns: `{ success: boolean }`

### `GET /api/session/[sessionId]/status`
- Requires: host auth cookie
- Returns: `{ invitees: { id, name, status, amountPaid, claims }[] }`
- Polled by host tracking screen every 3 seconds

### `GET /api/bunq/callback`
- OAuth redirect handler for both host and invitee flows
- Stores token in httpOnly cookie, redirects back to the originating screen

---

## Vision Prompt

Keep the system prompt in `/lib/prompts/parseReceipt.ts` as a named export.

The prompt must:
1. Request JSON only (`response_format: { type: "json_object" }`)
2. Specify the exact `Receipt` schema as JSON Schema inline
3. Instruct the model to split bundled items into equal unit prices
4. Return `null` for unreadable fields — no guessing

---

## UI Screens — Host

1. **Capture** — camera button + file upload fallback. Show upload progress ring.
2. **Review** — parsed line items. "Add People" button opens side panel.
   - Side panel shows top-5 bunq friends with avatars; "Add someone" option prompts for name + email
   - Selected people shown as avatar chips at the bottom
   - "Send Links" CTA activates when ≥1 person selected
3. **Tracking** — live list of invitees with status chips (Pending / Paid / Skipped). Each paid card expands to show what they paid for and the amount. Polls `/api/session/[sessionId]/status` every 3 seconds.
4. **Done** — when all invitees have paid or skipped. Shows total collected vs receipt total.

## UI Screens — Invitee (via link)

1. **Receipt View** — full parsed receipt. Each item has a tap target.
   - Tap once → item highlighted in your colour (you're claiming it solo)
   - Tap again → "sharing" mode — enter how many people are sharing (or tap other sharers' names if that data is available)
   - Running "Your total" shown at bottom, updates live
2. **Confirm & Pay** — summary of claimed items + total. bunq OAuth button. Shows host name so invitee knows who they're paying.
3. **Nothing to pay** — "I had nothing" button skips to a thank-you screen with no payment.
4. **Done** — payment confirmed. Shows bunq transaction reference.

---

## bunq Integration Notes

- Use **sandbox** environment during development (`https://public-api.sandbox.bunq.com/v1/`)
- Swap to production only for the live demo
- **Host OAuth scopes:** `payment` (read), `user` (read) — to fetch friends and receive payment IBAN
- **Invitee OAuth scopes:** `payment` (write), `user` (read) — to execute the outbound payment
- Payment body requires: `amount`, `currency`, `description`, `counterparty_alias` (host IBAN)
- bunq rate-limit: add 200ms delay between payment calls if firing many at once

Relevant docs: https://doc.bunq.com/ — see `payment`, `oauth`, and `monetary-account` sections.

---

## Email Invite

- Send via a transactional email provider (Resend or SendGrid — pick one, add API key to env)
- Subject: `{hostName} wants to split a receipt with you`
- Body: one-line summary of merchant + total, CTA button linking to `/split/[sessionId]/[inviteeId]`
- Keep template minimal — this is a hackathon

---

## Edge Cases to Handle Gracefully

| Scenario | Behaviour |
|---|---|
| Receipt has no line items (just a total) | Show single line "Total: €X" — invitee can claim it or skip |
| Total mismatch after extraction | Show warning banner; host can proceed anyway |
| Non-Latin receipt (Chinese, Arabic, etc.) | GPT-4o handles it — no special logic |
| Invitee not on bunq | Show their computed amount + "Copy amount" button; skip bunq OAuth |
| Two invitees both claim the same item solo | Server recomputes shares server-side at pay time using final `sharedWith` count |
| Invitee opens link after session expires (>24h) | Show "This link has expired" screen |
| Network error during payment | Retry once, then show error with amount to pay manually |
| Image too dark / blurry | Sharp helps; if parse fails, prompt retake |

---

## What to Skip (hackathon scope)

- Persistent storage beyond in-memory (no DB, no Redis)
- Receipt history or user accounts
- Expense categories / accounting export
- Multi-currency
- Native iOS/Android app
- Real-time WebSockets (polling is fine)
- Push notifications (email is enough)

---

## Demo Script (for judges)

1. Open app on phone
2. Photograph a real restaurant receipt on the table
3. Show parsed line items populating in ~3 seconds
4. Open side panel — tap Alice and Bob from top-5 friends, tap "Send Links"
5. Switch to Alice's device (or a second browser tab with her link)
6. Alice taps her pasta, shares the wine with everyone, taps "Confirm & Pay"
7. Switch back to host — tracking screen shows Alice as Paid with her breakdown
8. Bob does the same on his device
9. Host Done screen shows full collection summary
10. Total time target: under 90 seconds from photo to both payments received

Cache the parse result client-side so re-demos don't re-call the API.

---

## Environment Variables

```
OPENAI_API_KEY=
BUNQ_CLIENT_ID=
BUNQ_CLIENT_SECRET=
BUNQ_REDIRECT_URI=http://localhost:3000/api/bunq/callback
BUNQ_ENV=sandbox                  # or "production"
RESEND_API_KEY=                   # or SENDGRID_API_KEY
EMAIL_FROM=noreply@snapsplit.app
SESSION_TTL_HOURS=24
```
