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


_seed_lock = threading.Lock()

_SEED_AMOUNTS = ["8.50", "14.00", "6.75", "11.20", "9.30",
                 "13.00", "7.40", "10.50", "5.80", "12.60",
                 "8.90", "16.00", "6.40", "9.80", "11.50"]


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


@app.post("/api/sandbox/seed-friends")
def seed_demo_friends(count: int = 5, payments_each: int = 3):
    """
    One-time demo setup: creates `count` sandbox personas and makes
    `payments_each` payments to each so they appear as top contacts.
    Takes ~30 s for 5 friends. Only call this once before the demo.
    """
    if not _seed_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Seeding already in progress.")
    try:
        _restore_main_context()
        accounts = bunq.get_all_monetary_account_active(1)
        if not accounts:
            raise HTTPException(status_code=500, detail="No active account found.")
        main_account_id = accounts[0].id_

        # Auto top-up if balance is low
        if float(accounts[0].balance.value) < 50:
            bunq.make_request("500.00", "Seed top-up", "sugardaddy@bunq.com")
            time.sleep(2)
            _restore_main_context()

        created = []
        for i in range(count):
            api_key = bunq.generate_new_sandbox_user()
            name, iban = _get_friend_iban(api_key, i)
            _restore_main_context()

            if not iban:
                created.append({"name": name, "iban": None, "status": "skipped — no IBAN"})
                continue

            for j in range(payments_each):
                amount = _SEED_AMOUNTS[(i * payments_each + j) % len(_SEED_AMOUNTS)]
                Payment.create(
                    amount=Amount(amount, "EUR"),
                    counterparty_alias=Pointer("IBAN", iban, name),
                    description="Dinner · Smart Split demo",
                    monetary_account_id=main_account_id,
                )
                time.sleep(0.4)

            created.append({"name": name, "iban": iban, "status": "ok", "payments": payments_each})

        return {"seeded": len([f for f in created if f["status"] == "ok"]), "friends": created}
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
