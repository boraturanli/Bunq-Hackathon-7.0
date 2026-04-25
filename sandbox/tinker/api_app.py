from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal, Generator
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
CONTACTS_FILE = os.path.join(os.path.dirname(__file__), "contacts.json")

VALID_POINTER_TYPES = {"EMAIL", "PHONE_NUMBER", "IBAN"}


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


_seed_lock   = threading.Lock()
DEMO_DATA_FILE = os.path.join(os.path.dirname(__file__), "demo_data.json")

# ── Seeding constants ─────────────────────────────────────────────────────────

# (description, min_eur, max_eur, category, merchant)
_TX = [
    ("Dinner McDonalds",         8,   18, "food",          "McDonalds"),
    ("Sushi Umami",             22,   58, "food",          "Umami"),
    ("Pizza Mama Napoli",       11,   27, "food",          "Mama Napoli"),
    ("Neni Amsterdam",          18,   42, "food",          "Neni"),
    ("Brunch Plein 1940",       14,   32, "food",          "Plein 1940"),
    ("Coffee Lot 61",            3,    8, "food",          "Lot 61"),
    ("Café restaurant De Tulp", 16,   38, "food",          "De Tulp"),
    ("Albert Heijn groceries",  28,   75, "groceries",     "Albert Heijn"),
    ("Lidl groceries",          16,   52, "groceries",     "Lidl"),
    ("Bar Proeflokaal Wynand",  12,   38, "entertainment", "Proeflokaal Wynand"),
    ("Movie Pathé",             11,   17, "entertainment", "Pathé"),
    ("Concert tickets",         32,   92, "entertainment", "Ticketmaster"),
    ("Spotify family split",     4,    7, "entertainment", "Spotify"),
    ("Netflix split",            4,    6, "entertainment", "Netflix"),
    ("Festival wristband",      42,   95, "entertainment", "MOJO Concerts"),
    ("Uber pool",                6,   22, "transport",     "Uber"),
    ("NS Treinticket",          12,   42, "transport",     "NS"),
    ("OV-chipkaart top-up",     20,   40, "transport",     "NS"),
    ("Parking",                  5,   18, "transport",     "Q-Park"),
    ("Gym One Fitness",         25,   35, "health",        "One Fitness"),
    ("Etos pharmacy",            8,   28, "health",        "Etos"),
    ("Rituals skincare",        20,   65, "health",        "Rituals"),
    ("Online shopping",         20,  115, "shopping",      "Bol.com"),
    ("Zara",                    38,  118, "shopping",      "Zara"),
    ("HEMA",                    12,   45, "shopping",      "HEMA"),
    ("Airbnb split",            48,  125, "travel",        "Airbnb"),
    ("KLM flight",              95,  280, "travel",        "KLM"),
    ("Hotel split",             55,  140, "travel",        "Booking.com"),
]

_INCOMING_DESCS = [
    "Split from last time", "Reimbursement", "Taxi share",
    "My part of dinner", "Splitting groceries", "Coffee debt",
    "My share of the hotel", "Back for concert ticket",
]

# 12 months leading up to April 2026
_MONTHS = [
    ("2025-05","May 2025"), ("2025-06","Jun 2025"), ("2025-07","Jul 2025"),
    ("2025-08","Aug 2025"), ("2025-09","Sep 2025"), ("2025-10","Oct 2025"),
    ("2025-11","Nov 2025"), ("2025-12","Dec 2025"), ("2026-01","Jan 2026"),
    ("2026-02","Feb 2026"), ("2026-03","Mar 2026"), ("2026-04","Apr 2026"),
]

_CATEGORIES = ["food", "groceries", "entertainment", "transport", "health", "shopping", "travel"]

# monthly multipliers — seasonal variation (Dec high, Jan low, summer moderate)
_SEASONAL = [0.85, 0.90, 0.95, 0.88, 0.82, 0.93, 1.00, 1.35, 0.75, 0.80, 0.92, 1.05]

_BASE_BUDGETS = {
    "food": 280, "groceries": 200, "entertainment": 150,
    "transport": 100, "health": 80, "shopping": 150, "travel": 120,
}

_STOCKS = [
    {"symbol":"AAPL",  "name":"Apple Inc.",       "sector":"Technology",   "price":175.20, "range":(3,15),  "buy_factor":(0.75,0.98)},
    {"symbol":"MSFT",  "name":"Microsoft Corp.",  "sector":"Technology",   "price":415.80, "range":(1,8),   "buy_factor":(0.70,0.95)},
    {"symbol":"GOOGL", "name":"Alphabet Inc.",    "sector":"Technology",   "price":168.50, "range":(1,6),   "buy_factor":(0.72,0.96)},
    {"symbol":"TSLA",  "name":"Tesla Inc.",       "sector":"Automotive",   "price":172.30, "range":(2,20),  "buy_factor":(0.55,1.10)},
    {"symbol":"NVDA",  "name":"Nvidia Corp.",     "sector":"Technology",   "price":875.40, "range":(1,8),   "buy_factor":(0.40,0.80)},
    {"symbol":"ASML",  "name":"ASML Holding NV", "sector":"Technology",   "price":768.00, "range":(1,4),   "buy_factor":(0.65,0.90)},
    {"symbol":"ADYEN", "name":"Adyen NV",         "sector":"Fintech",      "price":1180.00,"range":(1,3),   "buy_factor":(0.70,1.05)},
    {"symbol":"ING",   "name":"ING Groep NV",     "sector":"Finance",      "price":15.80,  "range":(20,80), "buy_factor":(0.80,0.98)},
    {"symbol":"PHIA",  "name":"Philips NV",       "sector":"Healthcare",   "price":8.90,   "range":(10,50), "buy_factor":(0.82,1.02)},
    {"symbol":"AMZN",  "name":"Amazon.com Inc.",  "sector":"E-Commerce",   "price":183.00, "range":(1,8),   "buy_factor":(0.65,0.92)},
    {"symbol":"SBUX",  "name":"Starbucks Corp.",  "sector":"Food & Bev",   "price":78.40,  "range":(2,15),  "buy_factor":(0.85,1.05)},
    {"symbol":"V",     "name":"Visa Inc.",        "sector":"Finance",      "price":278.60, "range":(1,6),   "buy_factor":(0.78,0.96)},
]

_AVATAR_COLORS = [
    "#FF6B00","#00E5A0","#6366F1","#EC4899",
    "#F59E0B","#14B8A6","#8B5CF6","#EF4444","#06B6D4","#84CC16",
]

_OCCUPATIONS = [
    "UX Designer","Software Engineer","Product Manager","Data Scientist",
    "Marketing Lead","Startup Founder","DevRel Engineer","Financial Analyst",
    "Architect","Journalist",
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

_SPENDING_PATTERNS = ["balanced","weekend-heavy","daily-coffee","binge-shopper","travel-focused"]

_MESSAGE_THREADS = [
    [("them","Hey! Thanks for covering last night 🙏"),("me","Of course! Payment received 💪"),
     ("them","Same spot next Friday?"),("me","I'm in! 🎉")],
    [("them","Did you get the Uber split?"),("me","Yes! Thanks a lot"),("them","👍")],
    [("me","Movie tonight?"),("them","I'm in! 8pm?"),("me","Perfect, sending the link"),
     ("them","See you there 🎬")],
    [("them","Coffee tomorrow morning?"),("me","Lot 61 at 9?"),("them","Deal ☕"),("me","See you there!")],
    [("me","Thanks for the concert ticket!"),("them","Best show ever right??"),
     ("me","Absolutely 🎵"),("them","Next time I'm buying 😄")],
    [("them","Splitting the Airbnb?"),("me","Yes! How much is my share?"),
     ("them","€85 all in"),("me","Sending now 🏠")],
    [("me","Groceries split?"),("them","€32.50 my half"),("me","Done ✓"),("them","You're the best 🙌")],
]

_SAVINGS_POOL = [
    ("New MacBook Pro",    2499,  (0.55, 0.85)),
    ("Tokyo trip",         3500,  (0.20, 0.65)),
    ("Emergency fund",     5000,  (0.60, 0.95)),
    ("New bike",           1200,  (0.30, 0.80)),
    ("Festival season",     800,  (0.70, 0.99)),
    ("Camera gear",        1800,  (0.10, 0.50)),
    ("Car fund",           8000,  (0.05, 0.30)),
    ("Home down payment", 25000,  (0.03, 0.20)),
    ("New phone",          1100,  (0.40, 0.85)),
    ("Ski trip",           1600,  (0.25, 0.70)),
    ("Study course",        600,  (0.50, 0.99)),
    ("Gym equipment",       900,  (0.35, 0.75)),
]


# ── Context helpers ────────────────────────────────────────────────────────────

def _restore_main_context():
    conf = bunq.determine_bunq_conf_filename()
    ctx  = ApiContext.restore(conf)
    ctx.ensure_session_active()
    ctx.save(conf)
    BunqContext.load_api_context(ctx)


def _get_friend_iban(api_key: str, index: int) -> tuple[str, str | None]:
    """Switch to friend context, return (display_name, iban)."""
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
                iban = alias.value; break
        if not iban:
            for acc in MonetaryAccountBank.list().value:
                for alias in getattr(acc, "alias", []) or []:
                    if getattr(alias, "type_", None) == "IBAN":
                        iban = alias.value; break
                if iban: break
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    return name, iban


def _friend_pays_main(api_key: str, index: int,
                      main_iban: str, main_name: str,
                      amount: str, description: str) -> bool:
    """Switch to friend context, send payment to main user."""
    tmp = f"tmp_seed_pay_{index}.conf"
    try:
        ctx = ApiContext.create(ApiEnvironmentType.SANDBOX, api_key, f"seed-pay-{index}")
        ctx.save(tmp)
        BunqContext.load_api_context(ctx)
        accounts = MonetaryAccountBank.list().value
        if not accounts: return False
        Payment.create(
            amount=Amount(amount, "EUR"),
            counterparty_alias=Pointer("IBAN", main_iban, main_name),
            description=description,
            monetary_account_id=accounts[0].id_,
        )
        return True
    except Exception:
        return False
    finally:
        if os.path.exists(tmp): os.remove(tmp)


# ── Demo data generator ────────────────────────────────────────────────────────

def _build_demo_data(friends: list) -> dict:
    """
    Generate a rich, deterministic dataset keyed to the seeded friends.
    Covers everything needed for dashboards:
      - 12-month spending history (by category, top merchants, budgets vs actuals)
      - Stock portfolio with buy prices, gains, sector breakdown
      - Weekly balance history (13 weeks)
      - Spending insights (trends, averages, top merchants overall)
      - Per-friend: profile, portfolio, savings goals, message thread, monthly spending
    """
    rng = random.Random(42)

    # ── 12-month spending history ─────────────────────────────────────────
    monthly_history = []
    running_balance = round(rng.uniform(1800, 3200), 2)

    for idx, (month_key, month_label) in enumerate(_MONTHS):
        mult = _SEASONAL[idx]
        by_cat = {}
        top_merchants = []
        tx_count = 0

        for cat in _CATEGORIES:
            base = _BASE_BUDGETS.get(cat, 100)
            spent = round(base * mult * rng.uniform(0.6, 1.4), 2)
            by_cat[cat] = spent

            # pick 2-4 representative merchants for this category
            cat_txs = [t for t in _TX if t[3] == cat]
            if cat_txs:
                n_merchants = rng.randint(2, min(4, len(cat_txs)))
                for tx in rng.sample(cat_txs, n_merchants):
                    visits = rng.randint(1, 4)
                    merchant_total = round(rng.uniform(tx[1], tx[2]) * visits, 2)
                    top_merchants.append({"name": tx[4], "category": cat,
                                          "amount": merchant_total, "visits": visits})
                    tx_count += visits

        total_spent = round(sum(by_cat.values()), 2)
        received    = round(rng.uniform(60, 280), 2)
        net         = round(received - total_spent, 2)
        running_balance = round(running_balance + net, 2)

        # budget comparison
        budgets = {cat: round(_BASE_BUDGETS.get(cat, 100) * mult, 2) for cat in _CATEGORIES}

        top_merchants.sort(key=lambda m: -m["amount"])

        monthly_history.append({
            "month":           month_key,
            "label":           month_label,
            "spent":           total_spent,
            "received":        received,
            "net":             net,
            "closing_balance": running_balance,
            "transaction_count": tx_count,
            "by_category":     by_cat,
            "budgets":         budgets,
            "top_merchants":   top_merchants[:6],
        })

    # ── Weekly balance history (last 13 weeks) ────────────────────────────
    balance_history = []
    bal = round(rng.uniform(1200, 2400), 2)
    today = datetime.date(2026, 4, 25)
    for w in range(12, -1, -1):
        d   = today - datetime.timedelta(weeks=w)
        bal = round(bal + rng.uniform(-180, 140), 2)
        bal = max(bal, 50)
        balance_history.append({"date": d.isoformat(), "balance": bal})

    # ── Stock portfolio (main user) ───────────────────────────────────────
    chosen = rng.sample(_STOCKS, 6)
    portfolio = []
    total_invested = 0
    total_value    = 0
    for s in chosen:
        shares        = rng.randint(*s["range"])
        buy_factor    = rng.uniform(*s["buy_factor"])
        avg_buy_price = round(s["price"] * buy_factor, 2)
        value         = round(shares * s["price"], 2)
        invested      = round(shares * avg_buy_price, 2)
        gain          = round(value - invested, 2)
        gain_pct      = round((gain / invested) * 100, 2) if invested else 0
        total_invested += invested
        total_value    += value
        portfolio.append({
            "symbol":        s["symbol"],
            "name":          s["name"],
            "sector":        s["sector"],
            "shares":        shares,
            "price":         s["price"],
            "avg_buy_price": avg_buy_price,
            "value":         value,
            "invested":      invested,
            "gain":          gain,
            "gain_pct":      gain_pct,
            "change_1d_pct": round(rng.uniform(-3.5, 4.5), 2),
            "change_1w_pct": round(rng.uniform(-7,   10),   2),
            "change_1m_pct": round(rng.uniform(-12,  22),   2),
        })

    portfolio_summary = {
        "total_value":    round(total_value, 2),
        "total_invested": round(total_invested, 2),
        "total_gain":     round(total_value - total_invested, 2),
        "total_gain_pct": round(((total_value - total_invested) / total_invested) * 100, 2) if total_invested else 0,
        "by_sector": {},
    }
    for p in portfolio:
        sec = p["sector"]
        portfolio_summary["by_sector"].setdefault(sec, {"value": 0, "gain": 0})
        portfolio_summary["by_sector"][sec]["value"] += p["value"]
        portfolio_summary["by_sector"][sec]["gain"]  += p["gain"]

    # ── Spending insights ─────────────────────────────────────────────────
    all_spent = [m["spent"] for m in monthly_history]
    prev_month = monthly_history[-2]["spent"] if len(monthly_history) >= 2 else 0
    curr_month = monthly_history[-1]["spent"]
    top_cat    = max(monthly_history[-1]["by_category"].items(), key=lambda x: x[1])
    all_merchants: dict = {}
    for m in monthly_history:
        for merchant in m["top_merchants"]:
            key = merchant["name"]
            all_merchants.setdefault(key, {"name": key, "category": merchant["category"],
                                           "amount": 0, "visits": 0})
            all_merchants[key]["amount"] += merchant["amount"]
            all_merchants[key]["visits"] += merchant["visits"]
    top_merchants_overall = sorted(all_merchants.values(), key=lambda x: -x["amount"])[:8]

    insights = {
        "avg_monthly_spend":    round(sum(all_spent) / len(all_spent), 2),
        "max_monthly_spend":    max(all_spent),
        "min_monthly_spend":    min(all_spent),
        "spend_trend_pct":      round(((curr_month - prev_month) / prev_month) * 100, 1) if prev_month else 0,
        "spend_trend":          "up" if curr_month > prev_month else "down",
        "top_category_this_month": top_cat[0],
        "top_category_amount":     top_cat[1],
        "top_merchants":        top_merchants_overall,
        "savings_rate":         round(rng.uniform(0.08, 0.28), 2),
    }

    # ── Friend profiles ───────────────────────────────────────────────────
    ok_friends = [f for f in friends if f.get("status") == "ok"]
    enriched_friends = []

    for i, f in enumerate(ok_friends):
        frng = random.Random(42 + i)  # deterministic per friend slot

        # Portfolio (3-5 holdings, different from main user's)
        friend_stocks = frng.sample(_STOCKS, frng.randint(3, 5))
        friend_portfolio = []
        for s in friend_stocks:
            shares        = frng.randint(*s["range"])
            buy_factor    = frng.uniform(*s["buy_factor"])
            avg_buy_price = round(s["price"] * buy_factor, 2)
            value         = round(shares * s["price"], 2)
            invested      = round(shares * avg_buy_price, 2)
            gain          = round(value - invested, 2)
            friend_portfolio.append({
                "symbol":        s["symbol"],
                "name":          s["name"],
                "sector":        s["sector"],
                "shares":        shares,
                "price":         s["price"],
                "avg_buy_price": avg_buy_price,
                "value":         value,
                "gain":          gain,
                "gain_pct":      round((gain / invested) * 100, 2) if invested else 0,
                "change_1d_pct": round(frng.uniform(-3.5, 4.5), 2),
            })

        # 2-3 savings goals
        goal_pool = frng.sample(_SAVINGS_POOL, frng.randint(2, 3))
        savings_goals = []
        for goal_name, goal_target, prog_range in goal_pool:
            progress = round(frng.uniform(*prog_range), 2)
            saved    = round(goal_target * progress, 2)
            savings_goals.append({
                "name":     goal_name,
                "target":   goal_target,
                "saved":    saved,
                "progress": progress,
                "monthly_contribution": round(frng.uniform(50, 300), 2),
            })

        # Message thread
        thread   = frng.choice(_MESSAGE_THREADS)
        messages = [
            {"from": sender, "text": text,
             "time": f"{frng.randint(9,22)}:{frng.randint(0,59):02d}",
             "date": frng.choice(["Today", "Yesterday", "Mon", "Fri"])}
            for sender, text in thread
        ]

        # 12-month spending history for this friend
        friend_monthly = []
        for idx2, (month_key, month_label) in enumerate(_MONTHS):
            mult2   = _SEASONAL[idx2] * frng.uniform(0.7, 1.3)
            by_cat2 = {cat: round(_BASE_BUDGETS.get(cat, 100) * mult2 * frng.uniform(0.5, 1.5), 2)
                       for cat in _CATEGORIES}
            friend_monthly.append({
                "month":      month_key,
                "label":      month_label,
                "spent":      round(sum(by_cat2.values()), 2),
                "by_category": by_cat2,
            })

        # Balance tracking (how much they owe you / you owe them)
        total_sent     = round(f.get("total_sent", 0), 2)
        total_received = round(f.get("total_received", 0), 2)
        balance        = round(total_sent - total_received, 2)  # +ve = they owe you

        spending_pattern = _SPENDING_PATTERNS[i % len(_SPENDING_PATTERNS)]
        top_cats = sorted(friend_monthly[-1]["by_category"].items(), key=lambda x: -x[1])[:3]

        enriched_friends.append({
            "name":             f["name"],
            "iban":             f.get("iban"),
            "avatar_color":     _AVATAR_COLORS[i % len(_AVATAR_COLORS)],
            "occupation":       _OCCUPATIONS[i % len(_OCCUPATIONS)],
            "bio":              _BIOS[i % len(_BIOS)],
            "spending_pattern": spending_pattern,
            "top_categories":   [c for c, _ in top_cats],
            "transaction_count": f.get("payments", 0) + f.get("incoming", 0),
            "payments_out":     f.get("payments", 0),
            "payments_in":      f.get("incoming", 0),
            "total_sent":       total_sent,
            "total_received":   total_received,
            "balance":          balance,   # positive = they owe you
            "portfolio":        friend_portfolio,
            "savings_goals":    savings_goals,
            "messages":         messages,
            "monthly_spending": friend_monthly,
        })

    return {
        "generated_at":    datetime.datetime.now().isoformat(),
        "monthly_history": monthly_history,
        "balance_history": balance_history,
        "portfolio":       portfolio,
        "portfolio_summary": portfolio_summary,
        "insights":        insights,
        "friends":         enriched_friends,
    }


# ── Seeding endpoint ───────────────────────────────────────────────────────────

@app.post("/api/sandbox/seed-friends")
def seed_demo_friends(count: int = 5, payments_each: int = 10, incoming_each: int = 2):
    """Streaming seed — yields JSON-lines progress then a final DONE line."""
    if not _seed_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Seeding already in progress.")

    def _emit(event: str, **kw) -> str:
        return json.dumps({"event": event, **kw}) + "\n"

    def _stream() -> Generator[str, None, None]:
        try:
            yield _emit("start", count=count, payments_each=payments_each, incoming_each=incoming_each)
            _restore_main_context()

            accounts = bunq.get_all_monetary_account_active(1)
            if not accounts:
                yield _emit("error", message="No active account found.")
                return
            main_account_id = accounts[0].id_
            main_balance    = float(accounts[0].balance.value)
            yield _emit("balance", eur=main_balance)

            # Resolve main IBAN
            main_iban = None
            main_name = "Demo User"
            try:
                for alias in bunq.get_all_user_alias():
                    if getattr(alias, "type_", None) == "IBAN":
                        main_iban = alias.value; break
                main_name = bunq.get_current_user().display_name or main_name
            except Exception:
                pass
            yield _emit("main_user", name=main_name, iban=main_iban)

            # Auto top-up in 500 EUR rounds
            needed = count * payments_each * 60
            if main_balance < needed:
                rounds = max(1, int((needed - main_balance) // 500) + 2)
                yield _emit("topup_start", rounds=rounds, needed=needed, have=main_balance)
                for r in range(rounds):
                    try:
                        bunq.make_request("500.00", "Seed top-up", "sugardaddy@bunq.com")
                        yield _emit("topup_round", round=r + 1, of=rounds)
                        time.sleep(2)
                    except Exception as e:
                        yield _emit("topup_warn", round=r + 1, error=str(e))
                        time.sleep(1)
                _restore_main_context()
                time.sleep(1)
                yield _emit("topup_done")

            created = []
            for i in range(count):
                frng = random.Random(2025 + i)

                yield _emit("friend_start", index=i + 1, of=count)
                api_key    = bunq.generate_new_sandbox_user()
                name, iban = _get_friend_iban(api_key, i)
                _restore_main_context()

                if not iban:
                    created.append({"name": name, "iban": None, "status": "skipped — no IBAN"})
                    yield _emit("friend_skip", name=name, reason="no IBAN")
                    continue

                yield _emit("friend_created", name=name, iban=iban)

                # Outgoing payments
                total_sent = 0.0
                templates  = frng.choices(_TX, k=payments_each)
                for j, (desc, lo, hi, _cat, _merchant) in enumerate(templates):
                    amt = round(frng.uniform(lo, hi), 2)
                    Payment.create(
                        amount=Amount(f"{amt:.2f}", "EUR"),
                        counterparty_alias=Pointer("IBAN", iban, name),
                        description=desc,
                        monetary_account_id=main_account_id,
                    )
                    total_sent += amt
                    yield _emit("payment_out", friend=name, n=j + 1, of=payments_each,
                                desc=desc, eur=amt, total=round(total_sent, 2))
                    time.sleep(0.3)

                # Incoming payments
                total_received = 0.0
                inc_count = 0
                if main_iban:
                    for k in range(incoming_each):
                        inc_desc = frng.choice(_INCOMING_DESCS)
                        inc_amt  = round(frng.uniform(5, 32), 2)
                        ok = _friend_pays_main(api_key, i, main_iban, main_name,
                                               f"{inc_amt:.2f}", inc_desc)
                        _restore_main_context()
                        if ok:
                            total_received += inc_amt
                            inc_count += 1
                            yield _emit("payment_in", friend=name, n=k + 1, of=incoming_each,
                                        desc=inc_desc, eur=inc_amt)
                        else:
                            yield _emit("payment_in_fail", friend=name, n=k + 1)
                        time.sleep(0.35)

                created.append({
                    "name":           name,
                    "iban":           iban,
                    "status":         "ok",
                    "payments":       payments_each,
                    "incoming":       inc_count,
                    "total_sent":     round(total_sent, 2),
                    "total_received": round(total_received, 2),
                })
                yield _emit("friend_done", name=name,
                            sent=round(total_sent, 2), received=round(total_received, 2))

            # Write demo_data.json
            yield _emit("building_demo_data")
            demo = _build_demo_data(created)
            with open(DEMO_DATA_FILE, "w") as fh:
                json.dump(demo, fh, indent=2)

            ok_count = len([f for f in created if f.get("status") == "ok"])
            yield _emit("done", seeded=ok_count, friends=created, demo_data=DEMO_DATA_FILE)

        except Exception as e:
            yield _emit("error", message=str(e))
        finally:
            _seed_lock.release()

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@app.post("/api/sandbox/topup")
def sandbox_topup(req: TopupRequest = None):
    """Request money from sugardaddy@bunq.com (auto-approved within ~1 s)."""
    if req is None:
        req = TopupRequest()
    try:
        bunq.make_request(req.amount, "Sandbox top-up", "sugardaddy@bunq.com")
        return {"status": "success",
                "message": f"Requested {req.amount} EUR — funds arrive within seconds."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Demo-data read endpoints ───────────────────────────────────────────────────

def _load_demo() -> dict:
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(
            status_code=404,
            detail="Demo data not found — run POST /api/sandbox/seed-friends first.",
        )
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh)


@app.get("/api/demo")
def get_demo_data():
    """Full demo_data.json — all dashboard data in one payload."""
    return _load_demo()


@app.get("/api/demo/portfolio")
def get_demo_portfolio():
    """Main user stock portfolio with buy prices, gains, sector info."""
    d = _load_demo()
    return {"holdings": d["portfolio"], "summary": d["portfolio_summary"]}


@app.get("/api/demo/monthly-history")
def get_monthly_history():
    """12-month spending/income with per-category breakdown, budgets, top merchants."""
    return _load_demo()["monthly_history"]


@app.get("/api/demo/balance-history")
def get_balance_history():
    """Weekly balance snapshots for the last 13 weeks."""
    return _load_demo()["balance_history"]


@app.get("/api/demo/insights")
def get_insights():
    """Spending insights: averages, trends, top merchants, savings rate."""
    return _load_demo()["insights"]


@app.get("/api/demo/messages")
def get_messages(friend: str | None = None):
    """Message threads. ?friend=<name> filters to one thread."""
    friends = _load_demo()["friends"]
    threads = [
        {"with": f["name"], "avatar_color": f["avatar_color"], "messages": f["messages"]}
        for f in friends if f.get("messages")
    ]
    if friend:
        threads = [t for t in threads if friend.lower() in t["with"].lower()]
    return threads


@app.get("/api/demo/profiles")
def get_demo_profiles():
    """Enriched friend profiles: portfolio, savings goals, spending history, messages."""
    return _load_demo()["friends"]


@app.get("/api/demo/profiles/{name}")
def get_demo_profile(name: str):
    """Single friend profile by name (case-insensitive partial match)."""
    friends = _load_demo()["friends"]
    matches = [f for f in friends if name.lower() in f["name"].lower()]
    if not matches:
        raise HTTPException(status_code=404, detail=f"No friend matching '{name}'")
    return matches[0]
