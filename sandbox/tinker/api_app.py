from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
import datetime
import json
import os
import time
import threading
import uuid
import random
import requests as http_requests
from bunq import ApiEnvironmentType
from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated.endpoint import (
    PaymentApiObject as Payment,
    UserApiObject as User,
    MonetaryAccountBankApiObject as MonetaryAccountBank,
)
from bunq.sdk.model.generated.object_ import AmountObject as Amount, PointerObject as Pointer

from tinker.libs.bunq_lib import BunqLib

SANDBOX_BASE_URL = "https://public-api.sandbox.bunq.com/v1/"
CONTACTS_FILE   = os.path.join(os.path.dirname(__file__), "contacts.json")
DEMO_DATA_FILE  = os.path.join(os.path.dirname(__file__), "demo_data.json")

VALID_POINTER_TYPES = {"EMAIL", "PHONE_NUMBER", "IBAN"}

# ── Demo-data generation constants ───────────────────────────────────────────

# (description, min_eur, max_eur, category)
_TX_TEMPLATES = [
    ("Dinner McDonalds · SnapSplit",   8,  18, "food"),
    ("Sushi restaurant",               20,  55, "food"),
    ("Pizza night",                    10,  25, "food"),
    ("Neni Amsterdam",                 18,  40, "food"),
    ("Brunch Plein 1940",              14,  30, "food"),
    ("Coffee Lot 61",                   3,   8, "food"),
    ("Bar Proeflokaal Wynand",         12,  38, "entertainment"),
    ("Movie Pathé",                    11,  17, "entertainment"),
    ("Concert tickets",                30,  90, "entertainment"),
    ("Spotify family split",            4,   7, "entertainment"),
    ("Festival wristband",             40,  90, "entertainment"),
    ("Uber pool",                       6,  22, "transport"),
    ("NS Treinticket",                 12,  40, "transport"),
    ("OV-chipkaart top-up",            20,  40, "transport"),
    ("Albert Heijn groceries",         28,  72, "groceries"),
    ("Gym One Fitness",                25,  35, "health"),
    ("Etos pharmacy",                   8,  28, "health"),
    ("Online shopping",                20, 110, "shopping"),
    ("Zara",                           35, 115, "shopping"),
    ("Airbnb split",                   45, 120, "travel"),
]

_INCOMING_DESCS = [
    "Split from last time", "Reimbursement", "Taxi share",
    "My part of dinner", "Splitting groceries", "Coffee debt",
]

_STOCK_POOL = [
    {"symbol": "AAPL",  "name": "Apple Inc.",       "price": 175.20, "range": (1, 15)},
    {"symbol": "MSFT",  "name": "Microsoft Corp.",  "price": 415.80, "range": (1, 8)},
    {"symbol": "GOOGL", "name": "Alphabet Inc.",    "price": 168.50, "range": (1, 5)},
    {"symbol": "TSLA",  "name": "Tesla Inc.",       "price": 172.30, "range": (1, 20)},
    {"symbol": "NVDA",  "name": "Nvidia Corp.",     "price": 875.40, "range": (1, 8)},
    {"symbol": "ASML",  "name": "ASML Holding NV", "price": 768.00, "range": (1, 4)},
    {"symbol": "ADYEN", "name": "Adyen NV",         "price": 1180.00,"range": (1, 3)},
    {"symbol": "ING",   "name": "ING Groep NV",     "price": 15.80,  "range": (10, 60)},
    {"symbol": "PHIA",  "name": "Philips NV",       "price": 8.90,   "range": (5, 40)},
    {"symbol": "AMZN",  "name": "Amazon.com Inc.",  "price": 183.00, "range": (1, 8)},
]

_AVATAR_COLORS = [
    "#FF6B00", "#00E5A0", "#6366F1", "#EC4899",
    "#F59E0B", "#14B8A6", "#8B5CF6", "#EF4444",
    "#06B6D4", "#84CC16",
]

_OCCUPATIONS = [
    "UX Designer", "Software Engineer", "Product Manager",
    "Data Scientist", "Marketing Lead", "Startup Founder",
    "DevRel Engineer", "Financial Analyst", "Architect", "Journalist",
]

_BIOS = [
    "Coffee enthusiast & design nerd based in Amsterdam",
    "Building the future, one commit at a time",
    "Product thinking, shipped daily",
    "Turning data into decisions",
    "Stories that move people and products",
    "Making chaos look like strategy",
    "Helping developers be their best selves",
    "Numbers don't lie, but they do simplify",
    "Designing spaces that work for humans",
    "Words matter. Context more.",
]

_MESSAGE_THREADS = [
    [("them", "Hey! Thanks for covering last night 🙏"),
     ("me",   "Of course! Payment received 💪"),
     ("them", "Same spot next Friday?"),
     ("me",   "I'm in! 🎉")],
    [("them", "Did you get the Uber split?"),
     ("me",   "Yes! Thanks a lot"),
     ("them", "👍")],
    [("me",   "Movie tonight?"),
     ("them", "I'm in! 8pm?"),
     ("me",   "Perfect, sending the link"),
     ("them", "See you there 🎬")],
    [("them", "Coffee tomorrow morning?"),
     ("me",   "Lot 61 at 9?"),
     ("them", "Deal ☕"),
     ("me",   "See you there!")],
    [("me",   "Thanks for the concert ticket!"),
     ("them", "Best show ever right??"),
     ("me",   "Absolutely 🎵"),
     ("them", "Next time I'm buying 😄")],
]

_SAVINGS_GOALS = [
    ("New MacBook Pro",    2499,  0.72),
    ("Tokyo trip",         3500,  0.38),
    ("Emergency fund",     5000,  0.85),
    ("New bike",           1200,  0.55),
    ("Festival season",     800,  0.91),
    ("Camera gear",        1800,  0.22),
    ("Car fund",           8000,  0.15),
    ("Home down payment", 25000,  0.08),
    ("New phone",          1100,  0.66),
    ("Ski trip",           1600,  0.44),
]

_MONTHS = [
    ("2025-11", "Nov 2025"), ("2025-12", "Dec 2025"),
    ("2026-01", "Jan 2026"), ("2026-02", "Feb 2026"),
    ("2026-03", "Mar 2026"), ("2026-04", "Apr 2026"),
]

_CATEGORIES = ["food", "entertainment", "transport", "groceries", "shopping", "health", "travel"]


def _load_saved_contacts() -> list:
    if not os.path.exists(CONTACTS_FILE):
        return []
    with open(CONTACTS_FILE) as f:
        return json.load(f)


def _persist_contacts(contacts: list):
    with open(CONTACTS_FILE, "w") as f:
        json.dump(contacts, f, indent=2)

app = FastAPI(title="bunq Sandbox API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Initializing bunq environment...")
bunq = BunqLib(ApiEnvironmentType.SANDBOX)


class PaymentRequest(BaseModel):
    amount: str
    description: str
    recipient: str
    pointer_type: Optional[str] = "EMAIL"

class RequestMoneyRequest(BaseModel):
    amount: str
    description: str
    recipient: str
    pointer_type: Optional[str] = "EMAIL"

class AddContactRequest(BaseModel):
    name: str
    pointer_type: Literal["EMAIL", "PHONE_NUMBER", "IBAN"]
    pointer_value: str

class SavingsGoalRequest(BaseModel):
    name: str
    target_amount: str
    color: Optional[str] = "#00E5A0"

class SchedulePaymentRequest(BaseModel):
    amount: str
    description: str
    recipient: str
    scheduled_at: str
    pointer_type: Optional[str] = "IBAN"

class CardLimitRequest(BaseModel):
    limit_amount: str


@app.get("/api/user")
def get_user():
    user = bunq.get_current_user()
    return {"id": user.id_, "name": user.display_name}


@app.get("/api/aliases")
def get_aliases():
    """Your own identifiers — the email, IBAN, and phone others use to pay you."""
    aliases = bunq.get_all_user_alias()
    return [{"type": a.type_, "value": a.value} for a in aliases]


def _derive_contacts_from_history(limit: int) -> dict:
    """
    Build a {key: contact} dict from payment + request history.
    Key is IBAN when available, display_name otherwise.
    """
    payments  = bunq.get_all_payment(limit)
    requests_ = bunq.get_all_request(limit)
    seen: dict = {}

    def _absorb(alias, created):
        if not alias:
            return
        lma  = alias.label_monetary_account
        name = getattr(lma, "display_name", None) or "Unknown"
        iban = getattr(lma, "iban", None)
        key  = iban or name
        if key == "Unknown":
            return
        if key not in seen:
            seen[key] = {
                "name": name,
                "iban": iban,
                "pointer_type": "IBAN" if iban else "EMAIL",
                "pointer_value": iban or name,
                "transaction_count": 0,
                "last_seen": created or "",
                "saved": False,
            }
        entry = seen[key]
        entry["transaction_count"] += 1
        if created and created > entry["last_seen"]:
            entry["last_seen"] = created

    for p in payments:
        _absorb(p.counterparty_alias, p.created)
    for r in requests_:
        _absorb(r.counterparty_alias, r.created)

    return seen


@app.get("/api/contacts/top")
def get_top_contacts(n: int = 5, limit: int = 100):
    """Top N contacts by transaction frequency, derived from history."""
    seen = _derive_contacts_from_history(limit)
    ranked = sorted(seen.values(), key=lambda c: c["transaction_count"], reverse=True)
    return ranked[:n]


@app.get("/api/contacts")
def get_contacts(limit: int = 100):
    """
    All contacts: manually saved contacts merged with history-derived contacts.
    Saved contacts appear even with zero transactions. `saved: true` flags them.
    Sorted by transaction frequency descending.
    """
    seen = _derive_contacts_from_history(limit)

    for saved in _load_saved_contacts():
        key = saved["pointer_value"]
        if key in seen:
            seen[key]["saved"] = True
            # update name from saved record if user gave an explicit one
            seen[key]["name"] = saved["name"]
        else:
            seen[key] = {
                "name": saved["name"],
                "iban": saved["pointer_value"] if saved["pointer_type"] == "IBAN" else None,
                "pointer_type": saved["pointer_type"],
                "pointer_value": saved["pointer_value"],
                "transaction_count": 0,
                "last_seen": "",
                "saved": True,
            }

    return sorted(seen.values(), key=lambda c: c["transaction_count"], reverse=True)


@app.post("/api/contacts", status_code=201)
def add_contact(contact: AddContactRequest):
    """
    Manually save a contact by email, phone number, or IBAN.
    Stored locally in contacts.json — use pointer_type + pointer_value
    directly with POST /api/payment or POST /api/request.
    """
    saved = _load_saved_contacts()
    for existing in saved:
        if existing["pointer_value"] == contact.pointer_value:
            raise HTTPException(status_code=409, detail="Contact with this identifier already exists.")
    entry = {
        "name": contact.name,
        "pointer_type": contact.pointer_type,
        "pointer_value": contact.pointer_value,
    }
    saved.append(entry)
    _persist_contacts(saved)
    return {"status": "created", "contact": entry}


@app.delete("/api/contacts/{pointer_value}", status_code=200)
def delete_contact(pointer_value: str):
    """Remove a manually saved contact by their email, phone, or IBAN."""
    saved = _load_saved_contacts()
    updated = [c for c in saved if c["pointer_value"] != pointer_value]
    if len(updated) == len(saved):
        raise HTTPException(status_code=404, detail="Contact not found.")
    _persist_contacts(updated)
    return {"status": "deleted", "pointer_value": pointer_value}


@app.get("/api/accounts")
def get_accounts():
    accounts = bunq.get_all_monetary_account_active(10)
    return [
        {
            "id": acc.id_,
            "description": acc.description,
            "balance": acc.balance.value,
            "currency": acc.balance.currency,
        }
        for acc in accounts
    ]


@app.get("/api/balance")
def get_balance():
    accounts = bunq.get_all_monetary_account_active(1)
    if not accounts:
        raise HTTPException(status_code=404, detail="No active accounts found")
    main = accounts[0]
    return {
        "balance": main.balance.value,
        "currency": main.balance.currency,
        "account": main.description,
    }


@app.get("/api/transactions")
def list_transactions(count: int = 10):
    payments = bunq.get_all_payment(count)
    return [
        {
            "id": p.id_,
            "amount": p.amount.value,
            "currency": p.amount.currency,
            "direction": "IN" if float(p.amount.value) > 0 else "OUT",
            "description": p.description,
            "counterparty": (
                p.counterparty_alias.label_monetary_account.display_name
                if p.counterparty_alias else "Unknown"
            ),
            "created": p.created,
        }
        for p in payments
    ]


@app.post("/api/payment")
def make_payment(payment: PaymentRequest):
    try:
        bunq.make_payment(
            payment.amount, payment.description, payment.recipient, payment.pointer_type
        )
        bunq.update_context()
        return {"status": "success", "message": f"Paid {payment.amount} EUR to {payment.recipient}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/requests")
def list_requests(count: int = 10):
    requests = bunq.get_all_request(count)
    return [
        {
            "id": r.id_,
            "amount": r.amount_inquired.value,
            "currency": r.amount_inquired.currency,
            "description": r.description,
            "status": r.status,
            "counterparty": (
                r.counterparty_alias.label_monetary_account.display_name
                if r.counterparty_alias else "Unknown"
            ),
            "created": r.created,
        }
        for r in requests
    ]


@app.post("/api/request")
def request_money(req: RequestMoneyRequest):
    try:
        bunq.make_request(req.amount, req.description, req.recipient, req.pointer_type)
        return {"status": "success", "message": f"Requested {req.amount} EUR from {req.recipient}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/cards")
def list_cards(count: int = 10):
    cards = bunq.get_all_card(count)
    result = []
    for c in cards:
        entry = {"id": c.id_}
        if hasattr(c, "type_") and c.type_:
            entry["type"] = c.type_
        if hasattr(c, "status") and c.status:
            entry["status"] = c.status
        if hasattr(c, "label_monetary_account_ordered") and c.label_monetary_account_ordered:
            entry["account"] = c.label_monetary_account_ordered.label_monetary_account.display_name
        result.append(entry)
    return result


@app.get("/api/budget")
def get_budget():
    payments = bunq.get_all_payment(100)
    now = datetime.datetime.now()
    month_prefix = now.strftime("%Y-%m")

    spent = 0.0
    received = 0.0
    count = 0

    for p in payments:
        if p.created and p.created.startswith(month_prefix):
            count += 1
            val = float(p.amount.value)
            if val < 0:
                spent += abs(val)
            else:
                received += val

    return {
        "month": now.strftime("%B %Y"),
        "totalSpent": f"{spent:.2f}",
        "totalReceived": f"{received:.2f}",
        "net": f"{received - spent:.2f}",
        "transactionCount": count,
    }


@app.post("/api/savings-goal")
def create_savings_goal(goal: SavingsGoalRequest):
    return {
        "status": "success",
        "accountId": 9999,
        "message": f"Created savings goal '{goal.name}' targeting {goal.target_amount} EUR",
    }


@app.post("/api/schedule-payment")
def schedule_payment(payment: SchedulePaymentRequest):
    return {
        "status": "success",
        "scheduleId": 8888,
        "message": f"Payment of {payment.amount} EUR to {payment.recipient} scheduled for {payment.scheduled_at}",
    }


@app.put("/api/card-limit")
def set_card_limit(limit: CardLimitRequest):
    return {"status": "success", "newLimit": limit.limit_amount, "currency": "EUR"}


class TopupRequest(BaseModel):
    amount: Optional[str] = "500.00"


@app.post("/api/sandbox/user")
def create_sandbox_user():
    """
    Create a brand-new bunq sandbox user and return their API key.
    The returned api_key can be used to start a fresh bunq session
    (e.g. delete bunq-sandbox.conf and set BUNQ_API_KEY to this value).
    """
    resp = http_requests.post(
        SANDBOX_BASE_URL + "sandbox-user-person",
        headers={
            "x-bunq-client-request-id": str(uuid.uuid4()),
            "cache-control": "no-cache",
            "x-bunq-geolocation": "0 0 0 0 NL",
            "x-bunq-language": "en_US",
            "x-bunq-region": "en_US",
            "Content-Type": "application/json",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"bunq sandbox API error: {resp.text}")
    api_key = resp.json()["Response"][0]["ApiKey"]["api_key"]
    return {
        "api_key": api_key,
        "sandbox_url": SANDBOX_BASE_URL,
        "note": "Delete bunq-sandbox.conf and restart the server to use this new user.",
    }


_seed_lock = threading.Lock()


def _restore_main_context():
    conf = bunq.determine_bunq_conf_filename()
    ctx = ApiContext.restore(conf)
    ctx.ensure_session_active()
    ctx.save(conf)
    BunqContext.load_api_context(ctx)


def _get_friend_iban(api_key: str, index: int) -> tuple[str, str | None]:
    """Switch to friend context, grab name + IBAN, then return."""
    tmp = f"tmp_seed_friend_{index}.conf"
    try:
        ctx = ApiContext.create(ApiEnvironmentType.SANDBOX, api_key, f"seed-friend-{index}")
        ctx.save(tmp)
        BunqContext.load_api_context(ctx)

        user_obj = User.get().value.get_referenced_object()
        name = getattr(user_obj, "display_name", None) or f"Friend {index + 1}"

        iban = None
        for alias in getattr(user_obj, "alias", []) or []:
            if getattr(alias, "type_", None) == "IBAN":
                iban = alias.value
                break

        if not iban:
            accounts = MonetaryAccountBank.list().value
            for acc in accounts:
                for alias in getattr(acc, "alias", []) or []:
                    if getattr(alias, "type_", None) == "IBAN":
                        iban = alias.value
                        break
                if iban:
                    break
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    return name, iban


def _friend_pays_main(api_key: str, index: int, main_iban: str, main_name: str,
                      amount: str, description: str) -> bool:
    """Switch to friend context, send a payment to the main user, then clean up."""
    tmp = f"tmp_seed_pay_{index}.conf"
    try:
        ctx = ApiContext.create(ApiEnvironmentType.SANDBOX, api_key, f"seed-pay-{index}")
        ctx.save(tmp)
        BunqContext.load_api_context(ctx)

        accounts = MonetaryAccountBank.list().value
        if not accounts:
            return False
        acc_id = accounts[0].id_

        Payment.create(
            amount=Amount(amount, "EUR"),
            counterparty_alias=Pointer("IBAN", main_iban, main_name),
            description=description,
            monetary_account_id=acc_id,
        )
        return True
    except Exception:
        return False
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _build_demo_data(friends: list) -> dict:
    """
    Generate deterministic synthetic enrichment data keyed to the seeded friends.
    Covers: 6-month spending history, stock portfolios, savings goals, message threads.
    """
    rng = random.Random(42)

    # ── 6-month spending history ──────────────────────────────────────────
    monthly_history = []
    for month_key, month_label in _MONTHS:
        by_cat = {cat: round(rng.uniform(15, 160), 2) for cat in _CATEGORIES}
        total_spent = round(sum(by_cat.values()), 2)
        received    = round(rng.uniform(40, 230), 2)
        monthly_history.append({
            "month":    month_key,
            "label":    month_label,
            "spent":    total_spent,
            "received": received,
            "net":      round(received - total_spent, 2),
            "by_category": by_cat,
        })

    # ── Main user portfolio ───────────────────────────────────────────────
    chosen_stocks = rng.sample(_STOCK_POOL, 5)
    portfolio = []
    for s in chosen_stocks:
        shares = rng.randint(*s["range"])
        portfolio.append({
            "symbol":     s["symbol"],
            "name":       s["name"],
            "shares":     shares,
            "price":      s["price"],
            "change_pct": round(rng.uniform(-4.5, 7.5), 2),
            "value":      round(shares * s["price"], 2),
        })

    # ── Enriched friend profiles ──────────────────────────────────────────
    enriched_friends = []
    for i, f in enumerate(friends):
        if f.get("status") != "ok":
            continue

        # Portfolio
        friend_stocks = rng.sample(_STOCK_POOL, rng.randint(2, 4))
        friend_portfolio = []
        for s in friend_stocks:
            shares = rng.randint(*s["range"])
            friend_portfolio.append({
                "symbol":     s["symbol"],
                "name":       s["name"],
                "shares":     shares,
                "price":      s["price"],
                "change_pct": round(rng.uniform(-5, 8), 2),
                "value":      round(shares * s["price"], 2),
            })

        # Message thread
        thread = rng.choice(_MESSAGE_THREADS)
        messages = [
            {"from": sender, "text": text,
             "time": f"{rng.randint(9, 22)}:{rng.randint(0, 59):02d}"}
            for sender, text in thread
        ]

        # Savings goal
        goal_name, goal_target, goal_progress = _SAVINGS_GOALS[i % len(_SAVINGS_GOALS)]

        # Monthly spending breakdown for this friend
        friend_monthly = []
        for month_key, month_label in _MONTHS:
            by_cat = {cat: round(rng.uniform(10, 140), 2) for cat in _CATEGORIES}
            friend_monthly.append({
                "month": month_key,
                "label": month_label,
                "spent": round(sum(by_cat.values()), 2),
                "by_category": by_cat,
            })

        enriched_friends.append({
            "name":              f["name"],
            "iban":              f.get("iban"),
            "avatar_color":      _AVATAR_COLORS[i % len(_AVATAR_COLORS)],
            "occupation":        _OCCUPATIONS[i % len(_OCCUPATIONS)],
            "bio":               _BIOS[i % len(_BIOS)],
            "transaction_count": f.get("payments", 0) + f.get("incoming", 0),
            "payments_out":      f.get("payments", 0),
            "payments_in":       f.get("incoming", 0),
            "portfolio":         friend_portfolio,
            "messages":          messages,
            "monthly_spending":  friend_monthly,
            "savings": {
                "name":     goal_name,
                "target":   goal_target,
                "progress": goal_progress,
                "saved":    round(goal_target * goal_progress, 2),
            },
        })

    return {
        "generated_at":   datetime.datetime.now().isoformat(),
        "monthly_history": monthly_history,
        "portfolio":       portfolio,
        "friends":         enriched_friends,
    }


@app.post("/api/sandbox/seed-friends")
def seed_demo_friends(count: int = 5, payments_each: int = 10, incoming_each: int = 2):
    """
    One-time demo setup.

    For each of `count` new sandbox users:
      - Makes `payments_each` varied outgoing payments (food, transport, entertainment …)
      - Makes `incoming_each` payments back FROM the friend to the main account
    Then writes demo_data.json with synthetic portfolios, messages, savings goals,
    and 6-month spending history for every friend — ready for dashboard consumption.

    Takes ~90 s for 5 friends. Only call this once before the demo.
    """
    if not _seed_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Seeding already in progress.")
    try:
        _restore_main_context()

        # ── Resolve main account ──────────────────────────────────────────
        accounts = bunq.get_all_monetary_account_active(1)
        if not accounts:
            raise HTTPException(status_code=500, detail="No active account found.")
        main_account_id  = accounts[0].id_
        main_balance     = float(accounts[0].balance.value)

        # Resolve main IBAN (needed for incoming payments)
        main_iban = None
        main_name = "Demo User"
        try:
            for alias in bunq.get_all_user_alias():
                if getattr(alias, "type_", None) == "IBAN":
                    main_iban = alias.value
                    break
            main_name = bunq.get_current_user().display_name or main_name
        except Exception:
            pass

        # Top-up if balance is too low to cover all planned outgoing payments
        needed = count * payments_each * 35  # rough upper bound per tx
        if main_balance < needed:
            top_amt = max(500, needed - main_balance + 100)
            bunq.make_request(f"{top_amt:.2f}", "Seed top-up", "sugardaddy@bunq.com")
            time.sleep(3)
            _restore_main_context()

        created = []
        for i in range(count):
            rng = random.Random(2025 + i)        # deterministic per friend slot

            api_key = bunq.generate_new_sandbox_user()
            name, iban = _get_friend_iban(api_key, i)
            _restore_main_context()

            if not iban:
                created.append({"name": name, "iban": None, "status": "skipped — no IBAN"})
                continue

            # ── Outgoing: main → friend (varied categories) ───────────────
            templates = rng.choices(_TX_TEMPLATES, k=payments_each)
            for desc, lo, hi, _cat in templates:
                amount = f"{rng.uniform(lo, hi):.2f}"
                Payment.create(
                    amount=Amount(amount, "EUR"),
                    counterparty_alias=Pointer("IBAN", iban, name),
                    description=desc,
                    monetary_account_id=main_account_id,
                )
                time.sleep(0.3)

            # ── Incoming: friend → main (reimbursements) ──────────────────
            inc_count = 0
            if main_iban:
                for _ in range(incoming_each):
                    inc_desc = rng.choice(_INCOMING_DESCS)
                    inc_amt  = f"{rng.uniform(4, 28):.2f}"
                    ok = _friend_pays_main(api_key, i, main_iban, main_name, inc_amt, inc_desc)
                    _restore_main_context()
                    if ok:
                        inc_count += 1
                    time.sleep(0.35)

            created.append({
                "name":     name,
                "iban":     iban,
                "status":   "ok",
                "payments": payments_each,
                "incoming": inc_count,
            })

        # ── Generate and persist demo_data.json ──────────────────────────
        demo_data = _build_demo_data(created)
        with open(DEMO_DATA_FILE, "w") as fh:
            json.dump(demo_data, fh, indent=2)

        ok_friends = [f for f in created if f.get("status") == "ok"]
        return {
            "seeded":     len(ok_friends),
            "friends":    created,
            "demo_data":  DEMO_DATA_FILE,
        }
    finally:
        _seed_lock.release()


@app.post("/api/sandbox/topup")
def sandbox_topup(req: TopupRequest = None):
    """
    Request money from sugardaddy@bunq.com (bunq's sandbox faucet).
    The request is auto-approved within ~1 second.
    """
    if req is None:
        req = TopupRequest()
    try:
        bunq.make_request(req.amount, "Sandbox top-up", "sugardaddy@bunq.com")
        return {
            "status": "success",
            "message": f"Requested {req.amount} EUR from sugardaddy@bunq.com — funds arrive within seconds.",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Demo-data endpoints ───────────────────────────────────────────────────────

@app.get("/api/demo")
def get_demo_data():
    """
    Full demo_data.json: 6-month history, portfolios, savings goals, messages.
    Requires POST /api/sandbox/seed-friends to have been run first.
    """
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(
            status_code=404,
            detail="Demo data not found — run POST /api/sandbox/seed-friends first.",
        )
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh)


@app.get("/api/demo/portfolio")
def get_demo_portfolio():
    """Main user stock portfolio."""
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(status_code=404, detail="Run seed-friends first.")
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh).get("portfolio", [])


@app.get("/api/demo/monthly-history")
def get_monthly_history():
    """6-month spending/income with per-category breakdown."""
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(status_code=404, detail="Run seed-friends first.")
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh).get("monthly_history", [])


@app.get("/api/demo/messages")
def get_messages(friend: str | None = None):
    """
    All message threads. Pass ?friend=<name> to filter to one thread.
    """
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(status_code=404, detail="Run seed-friends first.")
    with open(DEMO_DATA_FILE) as fh:
        friends = json.load(fh).get("friends", [])
    threads = [
        {"with": f["name"], "avatar_color": f.get("avatar_color"), "messages": f["messages"]}
        for f in friends if f.get("messages")
    ]
    if friend:
        threads = [t for t in threads if friend.lower() in t["with"].lower()]
    return threads


@app.get("/api/demo/profiles")
def get_demo_profiles():
    """Enriched friend profiles: avatar, occupation, bio, savings goal, portfolio."""
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(status_code=404, detail="Run seed-friends first.")
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh).get("friends", [])
