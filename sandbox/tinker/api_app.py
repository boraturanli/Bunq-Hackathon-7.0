from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal, Generator
import datetime
import json
import os
import re
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


_SYSTEM_CONTACT_NAMES = {"sugar daddy", "sugardaddy"}

# bunq sandbox top-up account appears as IBAN NL32BUNQ... or email alias nl32bunq...@bunq.demo
_SYSTEM_IBAN_PREFIX = "nl32bunq"


def _is_system_contact(name: str, iban: str | None) -> bool:
    name_l = name.lower().strip()
    if name_l in _SYSTEM_CONTACT_NAMES:
        return True
    # Catch when display_name is the IBAN-email alias itself (e.g. nl32bunq2025313705@bunq.demo)
    if name_l.startswith(_SYSTEM_IBAN_PREFIX):
        return True
    if iban and iban.lower().replace(" ", "").startswith(_SYSTEM_IBAN_PREFIX):
        return True
    return False


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
        if _is_system_contact(name, iban):
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


def _is_system_pointer(pv: str) -> bool:
    pv_l = pv.lower().replace(" ", "")
    if "sugardaddy" in pv_l:
        return True
    if pv_l.startswith(_SYSTEM_IBAN_PREFIX):
        return True
    return False


@app.get("/api/contacts/top")
def get_top_contacts(n: int = 5, limit: int = 100):
    """Top N contacts by transaction frequency. Includes id/email/color for inbox navigation."""
    seen = _derive_contacts_from_history(limit)
    ranked = sorted(seen.values(), key=lambda c: c["transaction_count"], reverse=True)
    result = []
    for c in ranked:
        if len(result) >= n:
            break
        pv = c["pointer_value"] or ""
        if _is_system_pointer(pv):
            continue
        if _is_system_contact(c.get("name", ""), c.get("iban")):
            continue
        contact_id = _slugify(pv)
        if not contact_id:
            continue
        result.append({
            **c,
            "id":    contact_id,
            "email": pv,
            "color": _avatar_color(pv),
        })
    return result


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

DEMO_DATA_FILE = os.path.join(os.path.dirname(__file__), "demo_data.json")

_AVATAR_COLORS = ["#FF6B6B", "#4ECDC4", "#FFD93D", "#A8DADC", "#B388EB", "#F4845F", "#9DCD5A", "#5DB7DE"]

def _slugify(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def _avatar_color(key: str) -> str:
    h = 0
    for c in key:
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return _AVATAR_COLORS[h % len(_AVATAR_COLORS)]

_TX = [
    ("Dinner McDonalds",       8,  18, "food",          "McDonalds"),
    ("Sushi Umami",           22,  58, "food",          "Umami"),
    ("Café Cortado",           4,  12, "food",          "Café Cortado"),
    ("Pizza Napoli",          14,  32, "food",          "Pizza Napoli"),
    ("Broodje Ben",            6,  14, "food",          "Broodje Ben"),
    ("Albert Heijn",          18,  65, "groceries",     "Albert Heijn"),
    ("Jumbo Supermarket",     15,  55, "groceries",     "Jumbo"),
    ("Lidl",                  12,  40, "groceries",     "Lidl"),
    ("Netflix",               14,  18, "entertainment", "Netflix"),
    ("Spotify",                9,  12, "entertainment", "Spotify"),
    ("Cinema Pathé",          10,  22, "entertainment", "Pathé"),
    ("Steam Games",            8,  55, "entertainment", "Steam"),
    ("NS Trein",               6,  22, "transport",     "NS"),
    ("GVB OV-chipkaart",       5,  20, "transport",     "GVB"),
    ("Uber",                   8,  25, "transport",     "Uber"),
    ("Shell Tankstation",     40,  90, "transport",     "Shell"),
    ("Apotheek",               8,  35, "health",        "Apotheek"),
    ("Gym Basic-Fit",         20,  30, "health",        "Basic-Fit"),
    ("Huisarts eigen bijdrage",15, 30, "health",        "Huisarts"),
    ("Zara",                  25,  80, "shopping",      "Zara"),
    ("H&M",                   20,  65, "shopping",      "H&M"),
    ("Bol.com",               15,  90, "shopping",      "Bol.com"),
    ("IKEA",                  30, 120, "shopping",      "IKEA"),
    ("Booking.com hotel",     80, 220, "travel",        "Booking.com"),
    ("Ryanair vlucht",        45, 180, "travel",        "Ryanair"),
    ("Airbnb verblijf",       60, 200, "travel",        "Airbnb"),
    ("Baggage fees",          15,  45, "travel",        "Ryanair"),
]

_INCOMING_DESCS = [
    "Dinner reimbursement", "Drinks last night", "Shared Uber",
    "Groceries split", "Movie tickets", "Birthday gift back",
    "Concert tickets split", "Holiday share",
]

_MONTHS = [
    ("2025-05", "May 2025"), ("2025-06", "Jun 2025"), ("2025-07", "Jul 2025"),
    ("2025-08", "Aug 2025"), ("2025-09", "Sep 2025"), ("2025-10", "Oct 2025"),
    ("2025-11", "Nov 2025"), ("2025-12", "Dec 2025"), ("2026-01", "Jan 2026"),
    ("2026-02", "Feb 2026"), ("2026-03", "Mar 2026"), ("2026-04", "Apr 2026"),
]

_SEASONAL = [0.85, 0.90, 0.95, 0.88, 0.82, 0.93, 1.00, 1.35, 0.75, 0.80, 0.92, 1.05]
_CATEGORIES = ["food", "groceries", "entertainment", "transport", "health", "shopping", "travel"]
_BASE_BUDGETS = {
    "food": 280, "groceries": 200, "entertainment": 150,
    "transport": 100, "health": 80, "shopping": 150, "travel": 120,
}

_STOCKS = [
    {"symbol": "AAPL",  "name": "Apple Inc.",     "sector": "Technology",  "price": 175.20, "range": (3, 15),  "buy_factor": (0.75, 0.98)},
    {"symbol": "MSFT",  "name": "Microsoft",      "sector": "Technology",  "price": 378.50, "range": (1, 8),   "buy_factor": (0.70, 0.95)},
    {"symbol": "AMZN",  "name": "Amazon",         "sector": "E-commerce",  "price": 185.30, "range": (2, 12),  "buy_factor": (0.72, 0.97)},
    {"symbol": "GOOGL", "name": "Alphabet",       "sector": "Technology",  "price": 165.40, "range": (3, 10),  "buy_factor": (0.78, 0.96)},
    {"symbol": "NVDA",  "name": "NVIDIA",         "sector": "Technology",  "price": 875.00, "range": (1, 5),   "buy_factor": (0.45, 0.85)},
    {"symbol": "TSLA",  "name": "Tesla",          "sector": "Automotive",  "price": 185.60, "range": (5, 20),  "buy_factor": (0.60, 1.10)},
    {"symbol": "META",  "name": "Meta Platforms", "sector": "Social Media","price": 495.00, "range": (1, 8),   "buy_factor": (0.65, 0.90)},
    {"symbol": "ASML",  "name": "ASML Holding",   "sector": "Technology",  "price": 850.00, "range": (1, 4),   "buy_factor": (0.75, 0.95)},
    {"symbol": "ADYEN", "name": "Adyen N.V.",     "sector": "Fintech",     "price": 1420.00,"range": (1, 3),   "buy_factor": (0.80, 0.98)},
    {"symbol": "PHIA",  "name": "Philips",        "sector": "Healthcare",  "price": 22.50,  "range": (10, 50), "buy_factor": (0.85, 1.05)},
    {"symbol": "HEIA",  "name": "Heineken",       "sector": "Consumer",    "price": 82.00,  "range": (5, 20),  "buy_factor": (0.88, 1.02)},
    {"symbol": "ING",   "name": "ING Groep",      "sector": "Finance",     "price": 14.50,  "range": (20, 80), "buy_factor": (0.82, 1.00)},
]

_SAVINGS_POOL = [
    ("New MacBook Pro",    2499,  (0.55, 0.85)),
    ("Summer Vacation",    2000,  (0.40, 0.90)),
    ("Emergency fund",     5000,  (0.60, 0.95)),
    ("House deposit",     20000,  (0.20, 0.55)),
    ("New bike",            800,  (0.65, 0.95)),
    ("Wedding fund",       8000,  (0.30, 0.70)),
    ("Masters degree",    15000,  (0.15, 0.50)),
    ("Gaming setup",       1800,  (0.70, 0.95)),
    ("Car down payment",   4000,  (0.45, 0.80)),
    ("World trip",         6000,  (0.25, 0.65)),
    ("Music equipment",    1200,  (0.60, 0.90)),
    ("Home renovation",   10000,  (0.20, 0.60)),
]

_MESSAGE_THREADS = [
    [("friend", "Hey! I just sent the money for dinner 💸"),
     ("me", "Got it, thanks! That was a fun night"),
     ("friend", "Definitely! We should do it again soon"),
     ("me", "100% — how about next Friday?")],
    [("friend", "Did you get my bunq payment?"),
     ("me", "Yes! Just saw it, all good 👌"),
     ("friend", "Great. Worth every cent 😄"),
     ("me", "Haha agreed. The pizza was amazing")],
    [("me", "Hey, splitting the Uber from last night?"),
     ("friend", "Oh right! Sending now…"),
     ("me", "No rush 😊"),
     ("friend", "Done! Check your bunq ✅")],
    [("friend", "Can I owe you the concert tickets?"),
     ("me", "Of course, just bunq me next week"),
     ("friend", "Will do! Tonight was insane btw"),
     ("me", "Best gig in ages 🔥")],
    [("me", "Groceries came to €43 total"),
     ("friend", "Splitting evenly?"),
     ("me", "Yeah, €21.50 each"),
     ("friend", "On its way!")],
]

_OCCUPATIONS = [
    "UX Designer", "Software Engineer", "Marketing Lead", "Data Analyst",
    "Product Manager", "Freelance Consultant", "PhD Student", "Finance Analyst",
    "DevOps Engineer", "Graphic Designer",
]

_BIOS = [
    "Coffee addict & weekend hiker. Splits everything fairly.",
    "Tech nerd who loves sushi. Always early for payments.",
    "Foodie and amateur chef. Lives for concert weekends.",
    "Numbers person by day, DJ by night. Very punctual.",
    "Outdoor enthusiast. Venmo? No — bunq only.",
    "Minimalist. Pays instantly, asks questions later.",
    "Serial side-project launcher. Splits even snacks.",
    "Bookworm and board-game host. Fair-pay evangelist.",
    "Cyclist & flat-white connoisseur. 0 pending splits.",
    "Startup founder. Pays in rounds, always fair.",
]

_SPENDING_PATTERNS = [
    "Consistent spender", "Weekend splurger", "Frugal weekdays",
    "Subscription heavy", "Impulse buyer", "Planned saver",
]


def _restore_main_context():
    conf = bunq.determine_bunq_conf_filename()
    ctx = ApiContext.restore(conf)
    ctx.ensure_session_active()
    ctx.save(conf)
    BunqContext.load_api_context(ctx)


def _bump_daily_limit(account_id: int, limit: str = "10000.00") -> bool:
    """PUT daily_limit on the main monetary account. Cap is 10 000 EUR in sandbox."""
    try:
        MonetaryAccountBank.update(
            account_id,
            daily_limit=Amount(limit, "EUR"),
        )
        return True
    except Exception:
        return False


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
    tmp = f"tmp_pay_main_{index}.conf"
    try:
        ctx = ApiContext.create(ApiEnvironmentType.SANDBOX, api_key, f"pay-main-{index}")
        ctx.save(tmp)
        BunqContext.load_api_context(ctx)
        Payment.create(
            amount=Amount(amount, "EUR"),
            counterparty_alias=Pointer("IBAN", main_iban, main_name),
            description=description,
        )
        return True
    except Exception:
        return False
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _friend_dashboard_stats(f: dict, frng: random.Random) -> dict:
    """Compute HomeView dashboard stats for a single seeded friend."""
    monthly = f.get("monthly_history", [])
    by_cat = monthly[-1]["by_category"] if monthly else {}

    # Category mapping → frontend labels with fixed hex colours
    food   = round(by_cat.get("food", 0) + by_cat.get("groceries", 0), 2)
    transp = round(by_cat.get("transport", 0), 2)
    shop   = round(by_cat.get("shopping", 0) + by_cat.get("entertainment", 0) + by_cat.get("health", 0), 2)
    bills  = round(by_cat.get("travel", 0), 2)
    splits = round(f.get("total_received", 0), 2)
    categories = [
        {"label": "Food & drink", "value": int(food),   "color": "#F59E0B"},
        {"label": "Transport",    "value": int(transp),  "color": "#06B6D4"},
        {"label": "Shopping",     "value": int(shop),    "color": "#FB7185"},
        {"label": "Bills",        "value": int(bills),   "color": "#A78BFA"},
        {"label": "Splits",       "value": int(splits),  "color": "#00E5A0"},
    ]

    # Weekly (7 days), derived from current-month total
    month_total = monthly[-1]["spent"] if monthly else 500
    daily_avg   = month_total / 30
    day_labels  = ["M", "T", "W", "T", "F", "S", "S"]
    weekly      = [{"label": day_labels[i], "value": int(frng.uniform(0.3, 2.5) * daily_avg)} for i in range(7)]
    weekly_total = sum(w["value"] for w in weekly)

    # Savings goals
    goal_icons = ["🏝️", "🏠", "🚗", "💻", "✈️", "🎸", "🎓", "💰"]
    goal_colors = ["#14B8A6", "#A78BFA", "#F59E0B", "#FB7185"]
    goals_data = []
    for gi, g in enumerate((f.get("savings_goals") or [])[:2]):
        goals_data.append({
            "label": f"{goal_icons[gi % len(goal_icons)]} {g['name']}",
            "cur":   int(g["saved"]),
            "goal":  g["target"],
            "color": goal_colors[gi % len(goal_colors)],
        })
    goals_on_track = sum(1 for g in goals_data if g["goal"] > 0 and g["cur"] / g["goal"] >= 0.5)

    # Balance tiers
    savings_total  = sum(g["cur"] for g in goals_data)
    main_bal       = round(frng.uniform(400, 1500), 0)
    vacay_bal      = goals_data[0]["cur"] if goals_data else round(frng.uniform(200, 800), 0)
    total_balance  = main_bal + vacay_bal + savings_total
    balance_whole  = f"{int(total_balance):,}"
    balance_cents  = str(int(round((total_balance % 1) * 100))).zfill(2)

    # Month-over-month change
    if len(monthly) >= 2:
        prev = monthly[-2]["spent"]
        curr = monthly[-1]["spent"]
        change     = round(curr - prev, 2)
        change_pct = round((change / prev * 100) if prev else 0, 1)
    else:
        change     = round(frng.uniform(-200, 400), 2)
        change_pct = round(frng.uniform(-10, 25), 1)

    # Sparkline: 11 weekly balance snapshots ending at total_balance
    running  = total_balance - frng.uniform(300, 700)
    sparkline = []
    for _ in range(10):
        running = max(running + frng.uniform(-100, 150), 500)
        sparkline.append(int(round(running)))
    sparkline.append(int(round(total_balance)))

    accounts = [
        {"label": "Main",    "amt": f"€{int(main_bal):,}",    "bg": "linear-gradient(135deg,#B45309,#F59E0B)"},
        {"label": "Vacay",   "amt": f"€{int(vacay_bal):,}",   "bg": "linear-gradient(135deg,#0F766E,#14B8A6)"},
        {"label": "Savings", "amt": f"€{int(savings_total):,}","bg": "linear-gradient(135deg,#047857,#10B981)"},
    ]

    # Cashflow (current month)
    cashflow_out = round(monthly[-1]["spent"] if monthly else month_total, 2)
    cashflow_in  = round(cashflow_out + frng.uniform(0, 900), 2)
    cashflow_net = round(cashflow_in - cashflow_out, 2)
    cashflow_label = datetime.date.today().strftime("%B").upper()

    return {
        "balance_total":    round(total_balance, 2),
        "balance_whole":    balance_whole,
        "balance_cents":    balance_cents,
        "balance_change":   change,
        "balance_change_pct": change_pct,
        "sparkline":        sparkline,
        "accounts":         accounts,
        "categories":       categories,
        "weekly":           weekly,
        "weekly_total":     weekly_total,
        "cashflow_in":      cashflow_in,
        "cashflow_out":     cashflow_out,
        "cashflow_net":     cashflow_net,
        "cashflow_label":   cashflow_label,
        "goals":            goals_data,
        "goals_on_track":   goals_on_track,
        "goals_total":      len(goals_data),
    }


def _build_demo_data(friends: list) -> dict:
    ok = [f for f in friends if f.get("status") == "ok"]
    enriched = []
    for i, f in enumerate(ok):
        frng = random.Random(42 + i)

        # 12-month spending history
        monthly = []
        for idx, (month_key, month_label) in enumerate(_MONTHS):
            mult = _SEASONAL[idx] * frng.uniform(0.8, 1.2)
            by_cat = {cat: round(_BASE_BUDGETS.get(cat, 100) * mult * frng.uniform(0.5, 1.5), 2)
                      for cat in _CATEGORIES}
            spent    = round(sum(by_cat.values()), 2)
            received = round(frng.uniform(0, f.get("total_received", 0)), 2)
            merchants = {desc.split()[0]: round(frng.uniform(lo, hi), 2)
                         for desc, lo, hi, cat, _ in frng.choices(_TX, k=5)}
            monthly.append({
                "month": month_key, "label": month_label,
                "spent": spent, "received": received, "net": round(received - spent, 2),
                "by_category": by_cat,
                "budgets": _BASE_BUDGETS.copy(),
                "top_merchants": [{"name": m, "amount": a} for m, a in merchants.items()],
            })

        # Portfolio
        picked = frng.sample(_STOCKS, frng.randint(3, 5))
        portfolio = []
        for s in picked:
            shares     = frng.randint(*s["range"])
            buy_price  = round(s["price"] * frng.uniform(*s["buy_factor"]), 2)
            value      = round(shares * s["price"], 2)
            invested   = round(shares * buy_price, 2)
            gain       = round(value - invested, 2)
            portfolio.append({
                "symbol": s["symbol"], "name": s["name"], "sector": s["sector"],
                "shares": shares, "price": s["price"], "avg_buy_price": buy_price,
                "value": value, "gain": gain,
                "gain_pct":      round((gain / invested * 100) if invested else 0, 2),
                "change_1d_pct": round(frng.uniform(-3.5, 4.5), 2),
            })

        # Savings goals
        goal_pool = frng.sample(_SAVINGS_POOL, frng.randint(2, 3))
        savings_goals = []
        for goal_name, target, prog_range in goal_pool:
            progress = round(frng.uniform(*prog_range), 2)
            savings_goals.append({
                "name": goal_name, "target": target,
                "saved": round(target * progress, 2),
                "progress": progress,
                "monthly_contribution": round(frng.uniform(50, 300), 2),
            })

        # Messages
        thread = frng.choice(_MESSAGE_THREADS)
        messages = [{"from": s, "text": t,
                     "time": f"{frng.randint(9, 22)}:{frng.randint(0, 59):02d}",
                     "date": frng.choice(["Today", "Yesterday", "Mon", "Fri"])}
                    for s, t in thread]

        balance = round(f.get("total_sent", 0) - f.get("total_received", 0), 2)

        ef = {
            "id":               _slugify(f.get("iban") or f["name"]),
            "name":             f["name"],
            "iban":             f.get("iban"),
            "avatar_color":     _AVATAR_COLORS[i % len(_AVATAR_COLORS)],
            "occupation":       _OCCUPATIONS[i % len(_OCCUPATIONS)],
            "bio":              _BIOS[i % len(_BIOS)],
            "spending_pattern": _SPENDING_PATTERNS[i % len(_SPENDING_PATTERNS)],
            "top_categories":   [c for c, _ in sorted(monthly[-1]["by_category"].items(), key=lambda x: -x[1])[:3]],
            "transaction_count": f.get("payments", 0) + f.get("incoming", 0),
            "total_sent":       round(f.get("total_sent", 0), 2),
            "total_received":   round(f.get("total_received", 0), 2),
            "balance":          balance,
            "portfolio":        portfolio,
            "savings_goals":    savings_goals,
            "messages":         messages,
            "monthly_history":  monthly,
            "dashboard_stats":  _friend_dashboard_stats({**f, "monthly_history": monthly, "savings_goals": savings_goals}, frng),
        }
        enriched.append(ef)

    return {"friends": enriched, "generated_at": datetime.datetime.utcnow().isoformat()}


@app.post("/api/sandbox/seed-friends")
def seed_demo_friends(count: int = 5, payments_each: int = 10, incoming_each: int = 2):
    """Streaming seed — yields NDJSON progress lines, then writes demo_data.json."""
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
                yield _emit("error", message="No active account found."); return
            main_account_id = accounts[0].id_
            main_balance    = float(accounts[0].balance.value)
            yield _emit("balance", eur=main_balance)

            # Raise daily limit to 10 000 EUR so bulk payments don't hit the 1 000 EUR cap
            limit_ok = _bump_daily_limit(main_account_id)
            yield _emit("daily_limit", ok=limit_ok, value="10000" if limit_ok else "unchanged")

            main_iban = None; main_name = "Demo User"
            try:
                for alias in bunq.get_all_user_alias():
                    if getattr(alias, "type_", None) == "IBAN":
                        main_iban = alias.value; break
                main_name = bunq.get_current_user().display_name or main_name
            except Exception:
                pass
            yield _emit("main_user", name=main_name, iban=main_iban)

            # Top-up in 500 EUR rounds
            needed = count * payments_each * 60
            if main_balance < needed:
                rounds = max(1, int((needed - main_balance) // 500) + 2)
                yield _emit("topup_start", rounds=rounds)
                for r in range(rounds):
                    try:
                        bunq.make_request("500.00", "Seed top-up", "sugardaddy@bunq.com")
                        yield _emit("topup_round", round=r + 1, of=rounds)
                        time.sleep(2)
                    except Exception as e:
                        yield _emit("topup_warn", round=r + 1, error=str(e))
                        time.sleep(1)
                _restore_main_context(); time.sleep(1)
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
                    yield _emit("friend_skip", name=name); continue

                yield _emit("friend_created", name=name, iban=iban)

                # Outgoing
                total_sent = 0.0
                templates  = frng.choices(_TX, k=payments_each)
                for j, (desc, lo, hi, _cat, _merchant) in enumerate(templates):
                    amt = round(frng.uniform(lo, hi), 2)
                    Payment.create(
                        amount=Amount(f"{amt:.2f}", "EUR"),
                        counterparty_alias=Pointer("IBAN", iban, name),
                        description=desc, monetary_account_id=main_account_id,
                    )
                    total_sent += amt
                    yield _emit("payment_out", friend=name, n=j + 1, of=payments_each, desc=desc, eur=amt)
                    time.sleep(0.3)

                # Incoming
                total_received = 0.0; inc_count = 0
                if main_iban:
                    for k in range(incoming_each):
                        inc_desc = frng.choice(_INCOMING_DESCS)
                        inc_amt  = round(frng.uniform(5, 32), 2)
                        ok = _friend_pays_main(api_key, i, main_iban, main_name, f"{inc_amt:.2f}", inc_desc)
                        _restore_main_context()
                        if ok:
                            total_received += inc_amt; inc_count += 1
                            yield _emit("payment_in", friend=name, n=k + 1, eur=inc_amt)
                        else:
                            yield _emit("payment_in_fail", friend=name, n=k + 1)
                        time.sleep(0.35)

                created.append({
                    "name": name, "iban": iban, "status": "ok",
                    "payments": payments_each, "incoming": inc_count,
                    "total_sent": round(total_sent, 2), "total_received": round(total_received, 2),
                })
                yield _emit("friend_done", name=name, sent=round(total_sent, 2), received=round(total_received, 2))

            yield _emit("building_demo_data")
            demo = _build_demo_data(created)
            with open(DEMO_DATA_FILE, "w") as fh:
                json.dump(demo, fh, indent=2)

            ok_count = sum(1 for f in created if f.get("status") == "ok")
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
        return {"status": "success", "message": f"Requested {req.amount} EUR — funds arrive within seconds."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/sandbox/bump-daily-limit")
def bump_daily_limit():
    """Raise the main account's daily payment limit to 10 000 EUR (sandbox cap)."""
    _restore_main_context()
    accounts = bunq.get_all_monetary_account_active(1)
    if not accounts:
        raise HTTPException(status_code=400, detail="No active account found.")
    ok = _bump_daily_limit(accounts[0].id_)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update daily limit.")
    return {"status": "ok", "daily_limit": "10000.00 EUR"}


# ── Demo-data read endpoints ───────────────────────────────────────────────────

def _load_demo() -> dict:
    if not os.path.exists(DEMO_DATA_FILE):
        raise HTTPException(status_code=404, detail="demo_data.json not found — run seed first.")
    with open(DEMO_DATA_FILE) as fh:
        return json.load(fh)


@app.get("/api/demo")
def get_demo_data():
    return _load_demo()


@app.get("/api/demo/profiles")
def get_demo_profiles():
    return _load_demo()["friends"]


@app.get("/api/demo/profiles/{name}")
def get_demo_profile(name: str):
    friends = _load_demo()["friends"]
    match = next((f for f in friends if f["name"].lower() == name.lower()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found.")
    return match


@app.get("/api/demo/stats/{contact_id}")
def get_demo_stats(contact_id: str):
    """Dashboard stats for a contact. Strips bunq sandbox @bunq.demo suffix before matching."""
    friends = _load_demo()["friends"]
    # bunq sandbox uses IBAN@bunq.demo as email alias; slugify turns that into
    # nl66bunq2106258720-bunq-demo — strip the trailing -bunq-* to get the raw IBAN slug
    stripped = re.sub(r'-bunq-.*$', '', contact_id)
    match = next(
        (f for f in friends if f.get("id") in (contact_id, stripped)),
        None,
    )
    if not match:
        raise HTTPException(status_code=404, detail=f"No stats for contact '{contact_id}'.")
    return match.get("dashboard_stats", {})
