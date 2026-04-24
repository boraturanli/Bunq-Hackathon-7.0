# SnapSplit — CLAUDE.md

## Project Overview

SnapSplit is a hackathon project for bunq Hackathon 7.0 (24-hour build, April 2026).

Photograph a receipt → AI parses line items → assign items to people → fire bunq payment requests automatically.

Built as a mobile-responsive Next.js web app. No native mobile, no persistent DB, no multi-currency. Keep it tight.

---

## Tech Stack

- **Framework:** Next.js (App Router), TypeScript
- **Styling:** Tailwind CSS
- **State:** React `useReducer` for assignment logic, `useState` elsewhere
- **Vision model:** OpenAI GPT-4o via `/api/parse` server route
- **Image preprocessing:** Sharp (server-side sharpening + basic normalisation)
- **Payments:** bunq API via OAuth — `payment-request` endpoint only, never `payment`
- **Deployment:** Vercel (or local for demo)

---

## Architecture

```
[Camera / File Upload]
       ↓
[Client → POST /api/parse (multipart image)]
       ↓
[Server: Sharp preprocess → GPT-4o vision → validate schema → return JSON]
       ↓
[Client: render item assignment UI]
       ↓
[User assigns items → client computes per-person totals in real time]
       ↓
[User taps "Send Requests" → POST /api/pay]
       ↓
[Server: bunq OAuth → payment-request per person]
       ↓
[Client: confirmation screen with per-person amounts]
```

All vision API calls are server-side. Assignment logic is pure client state — no server round-trips.

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

### Assignment state (client-side)
```typescript
// Map of itemId → array of { userId, fraction }
// fractions must sum to 1.0 for each item
type AssignmentMap = Record<number, { userId: string; fraction: number }[]>;
```

### Person (from bunq contacts or manual entry)
```typescript
interface Person {
  id: string;
  name: string;
  bunqAlias?: string;     // bunq email/phone for payment-request
  avatarColor: string;    // for UI
}
```

---

## API Routes

### `POST /api/parse`
- Accepts: `multipart/form-data` with `image` field
- Preprocesses with Sharp, sends to GPT-4o with structured output
- Validates: `sum(line_totals) + tax + tip ≈ total` (±2% tolerance for rounding)
- Returns: `Receipt` JSON or `{ error: string }`
- On mismatch: still return data, include `{ warning: "totals_mismatch" }`

### `POST /api/pay`
- Accepts: `{ assignments: { person: Person, amount: number }[], receiptTotal: number }`
- Authenticates with bunq OAuth token from session
- Fires one `payment-request` per person
- Never touches `payment` endpoint — always request, never push
- Returns: `{ results: { personId, status, bunqRequestId }[] }`

### `GET /api/bunq/callback`
- OAuth redirect handler
- Stores token in httpOnly cookie

---

## Vision Prompt

The system prompt for GPT-4o must:
1. Request JSON only (use `response_format: { type: "json_object" }`)
2. Specify the exact schema (paste the `Receipt` interface as JSON Schema)
3. Instruct the model to handle bundled items by splitting into equal unit prices
4. Tell it to return `null` for fields it cannot read, not to guess

Keep the prompt in `/lib/prompts/parseReceipt.ts` as a named export so it can be iterated independently.

---

## UI Screens

1. **Capture** — camera button + file upload fallback. Show upload progress.
2. **Review** — parsed receipt items on left, people chips on right. Running totals per person update live. Two modes: item-level (default) and equal-split (toggle). Long-press item → "split among everyone."
3. **Confirm** — list of `{name, amount, bunqAlias}`. "Send All Requests" CTA. Shows bunq logo to signal what's happening.
4. **Done** — success state with per-person confirmation. Deep link to bunq app if available.

No authentication wall before step 3. Bunq OAuth only triggered at payment time.

---

## bunq Integration Notes

- Use **sandbox** environment during development (`https://public-api.sandbox.bunq.com/v1/`)
- Swap to production only for the live demo
- OAuth scopes needed: `payment_request` (read + write), `user` (read)
- Payment request body requires: `amount`, `currency`, `description`, `counterparty_alias`
- The `counterparty_alias` can be an email, phone, or IBAN — support all three
- bunq API is rate-limited; batch requests with a small delay if firing many at once

Relevant docs: https://doc.bunq.com/ — see `payment-request` and `oauth` sections.

---

## Edge Cases to Handle Gracefully

| Scenario | Behaviour |
|---|---|
| Receipt has no line items (just a total) | Fall back to equal-split mode automatically |
| Total mismatch after extraction | Show warning banner, let user proceed or adjust manually |
| Non-Latin receipt (Chinese, Arabic, etc.) | GPT-4o handles this — no special logic needed |
| Person not on bunq | Exclude from payment-request, show "copy amount" instead |
| Network error during `/api/pay` | Retry once, then show per-person success/fail status |
| Image too dark / blurry | Sharp preprocessing helps; if parse fails, prompt retake |

---

## What to Skip (hackathon scope)

- Persistent storage or user accounts
- Receipt history
- Expense categories / accounting export
- Multi-currency
- Native iOS/Android app
- Splitting by custom percentages (equal fractions only)

---

## Demo Script (for judges)

1. Open app on phone
2. Photograph a real restaurant receipt on the table
3. Show parsed line items populating in ~3 seconds
4. Assign pasta to Alice, wine to everyone, dessert to Bob
5. Tap "Send Requests" — show bunq notifications arriving on a second device
6. Total time target: under 60 seconds from photo to sent requests

Practise this flow. It needs to work offline-ish (cache the parse result so re-demos don't re-call the API).

---

## Environment Variables

```
OPENAI_API_KEY=
BUNQ_CLIENT_ID=
BUNQ_CLIENT_SECRET=
BUNQ_REDIRECT_URI=http://localhost:3000/api/bunq/callback
BUNQ_ENV=sandbox   # or "production"
```