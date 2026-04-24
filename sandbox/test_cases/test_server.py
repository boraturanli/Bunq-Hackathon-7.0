"""
Comprehensive test suite for the bunq Sandbox FastAPI server.

Unit tests mock `tinker.api_app.bunq` so no sandbox connection is required.
Integration tests hit the real sandbox and verify live response shapes.

Run unit tests only (fast, no sandbox):
    pipenv run pytest tinker/test_server.py -m unit -v

Run integration tests (requires live sandbox):
    pipenv run pytest tinker/test_server.py -m integration -v

Run everything:
    pipenv run pytest tinker/test_server.py -v
"""

import datetime
import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from tinker.api_app import app

client = TestClient(app)


# ─── Mock object factories ─────────────────────────────────────────────────────

def _user(id_=1001, name="Test User"):
    u = MagicMock()
    u.id_ = id_
    u.display_name = name
    return u


def _account(id_=1, description="My Account", balance="1234.56", currency="EUR"):
    a = MagicMock()
    a.id_ = id_
    a.description = description
    a.balance.value = balance
    a.balance.currency = currency
    return a


def _payment(
    id_=1,
    amount="-42.50",
    currency="EUR",
    description="Coffee",
    counterparty_name="Jane",
    created="2026-04-25 10:00:00",
    has_counterparty=True,
):
    p = MagicMock()
    p.id_ = id_
    p.amount.value = amount
    p.amount.currency = currency
    p.description = description
    p.created = created
    if has_counterparty:
        p.counterparty_alias.label_monetary_account.display_name = counterparty_name
    else:
        p.counterparty_alias = None
    return p


def _request_inquiry(
    id_=10,
    amount="25.00",
    currency="EUR",
    description="Dinner split",
    status="PENDING",
    counterparty_name="Bob",
    created="2026-04-25 09:00:00",
    has_counterparty=True,
):
    r = MagicMock()
    r.id_ = id_
    r.amount_inquired.value = amount
    r.amount_inquired.currency = currency
    r.description = description
    r.status = status
    r.created = created
    if has_counterparty:
        r.counterparty_alias.label_monetary_account.display_name = counterparty_name
    else:
        r.counterparty_alias = None
    return r


def _card(id_=99, type_="MASTERCARD", status="ACTIVE", account_name="My Account"):
    c = MagicMock()
    c.id_ = id_
    c.type_ = type_
    c.status = status
    c.label_monetary_account_ordered.label_monetary_account.display_name = account_name
    return c


def _alias(type_="EMAIL", value="me@example.com"):
    a = MagicMock()
    a.type_ = type_
    a.value = value
    return a


def _fixed_datetime(fixed_now):
    """Returns a datetime.datetime subclass whose now() always returns fixed_now."""
    class _Fixed(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now
    return _Fixed


# ─── Core fixture ─────────────────────────────────────────────────────────────

@pytest.fixture
def bunq(monkeypatch):
    """Replace the module-level `bunq` singleton in api_app with a fresh MagicMock."""
    mock = MagicMock()
    monkeypatch.setattr("tinker.api_app.bunq", mock)
    return mock


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/user
# ══════════════════════════════════════════════════════════════════════════════

class TestGetUser:
    @pytest.mark.unit
    def test_returns_id_and_name(self, bunq):
        bunq.get_current_user.return_value = _user(id_=42, name="Alice")
        resp = client.get("/api/user")
        assert resp.status_code == 200
        assert resp.json() == {"id": 42, "name": "Alice"}

    @pytest.mark.unit
    def test_id_is_integer(self, bunq):
        bunq.get_current_user.return_value = _user(id_=999)
        assert isinstance(client.get("/api/user").json()["id"], int)

    @pytest.mark.unit
    def test_name_is_string(self, bunq):
        bunq.get_current_user.return_value = _user(name="Bob")
        assert isinstance(client.get("/api/user").json()["name"], str)

    @pytest.mark.unit
    def test_no_extra_fields(self, bunq):
        bunq.get_current_user.return_value = _user()
        assert set(client.get("/api/user").json().keys()) == {"id", "name"}


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/balance
# ══════════════════════════════════════════════════════════════════════════════

class TestGetBalance:
    @pytest.mark.unit
    def test_returns_correct_fields(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [
            _account(balance="500.00", currency="EUR", description="Checking")
        ]
        assert client.get("/api/balance").json() == {
            "balance": "500.00", "currency": "EUR", "account": "Checking"
        }

    @pytest.mark.unit
    def test_uses_first_account_only(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [
            _account(balance="100.00", description="Primary"),
            _account(balance="999.00", description="Secondary"),
        ]
        data = client.get("/api/balance").json()
        assert data["account"] == "Primary"
        assert data["balance"] == "100.00"

    @pytest.mark.unit
    def test_no_accounts_returns_404(self, bunq):
        bunq.get_all_monetary_account_active.return_value = []
        assert client.get("/api/balance").status_code == 404

    @pytest.mark.unit
    def test_requests_exactly_one_account(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [_account()]
        client.get("/api/balance")
        bunq.get_all_monetary_account_active.assert_called_once_with(1)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/accounts
# ══════════════════════════════════════════════════════════════════════════════

class TestGetAccounts:
    @pytest.mark.unit
    def test_empty_returns_empty_list(self, bunq):
        bunq.get_all_monetary_account_active.return_value = []
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.unit
    def test_account_shape(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [
            _account(id_=7, description="Savings", balance="2000.00", currency="EUR")
        ]
        data = client.get("/api/accounts").json()
        assert data == [{"id": 7, "description": "Savings", "balance": "2000.00", "currency": "EUR"}]

    @pytest.mark.unit
    def test_multiple_accounts_all_returned(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [
            _account(id_=1), _account(id_=2), _account(id_=3)
        ]
        data = client.get("/api/accounts").json()
        assert len(data) == 3
        assert [a["id"] for a in data] == [1, 2, 3]

    @pytest.mark.unit
    def test_no_extra_fields_in_account(self, bunq):
        bunq.get_all_monetary_account_active.return_value = [_account()]
        keys = set(client.get("/api/accounts").json()[0].keys())
        assert keys == {"id", "description", "balance", "currency"}


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/aliases  (own identifiers)
# ══════════════════════════════════════════════════════════════════════════════

class TestGetAliases:
    @pytest.mark.unit
    def test_empty(self, bunq):
        bunq.get_all_user_alias.return_value = []
        assert client.get("/api/aliases").json() == []

    @pytest.mark.unit
    def test_alias_shape(self, bunq):
        bunq.get_all_user_alias.return_value = [_alias("EMAIL", "me@example.com")]
        assert client.get("/api/aliases").json() == [{"type": "EMAIL", "value": "me@example.com"}]

    @pytest.mark.unit
    def test_all_alias_types_returned(self, bunq):
        bunq.get_all_user_alias.return_value = [
            _alias("EMAIL",        "me@example.com"),
            _alias("IBAN",         "NL12BUNQ0123456789"),
            _alias("PHONE_NUMBER", "+31612345678"),
        ]
        data = client.get("/api/aliases").json()
        assert len(data) == 3
        assert {d["type"] for d in data} == {"EMAIL", "IBAN", "PHONE_NUMBER"}


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/contacts  (derived from transaction history)
# ══════════════════════════════════════════════════════════════════════════════

def _payment_with_iban(iban="NL12BUNQ0123456789", name="Jane", amount="-10.00", created="2026-04-25 10:00:00"):
    """Payment mock where the counterparty has a known IBAN."""
    p = MagicMock()
    p.amount.value = amount
    p.counterparty_alias.label_monetary_account.display_name = name
    p.counterparty_alias.label_monetary_account.iban = iban
    p.created = created
    return p

def _payment_email_only(name="Ghost User", amount="-5.00", created="2026-04-20 08:00:00"):
    """Payment mock where the counterparty has no IBAN (email-only)."""
    p = MagicMock()
    p.amount.value = amount
    p.counterparty_alias.label_monetary_account.display_name = name
    p.counterparty_alias.label_monetary_account.iban = None
    p.created = created
    return p


class TestGetContacts:
    @pytest.mark.unit
    def test_empty_history_returns_empty(self, bunq):
        bunq.get_all_payment.return_value = []
        bunq.get_all_request.return_value = []
        assert client.get("/api/contacts").json() == []

    @pytest.mark.unit
    def test_contact_fields_with_iban(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL12BUNQ0123456789", name="Jane")
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        c = data[0]
        assert c["name"] == "Jane"
        assert c["iban"] == "NL12BUNQ0123456789"
        assert c["pointer_type"] == "IBAN"
        assert c["pointer_value"] == "NL12BUNQ0123456789"
        assert c["transaction_count"] == 1
        assert "last_seen" in c

    @pytest.mark.unit
    def test_email_only_contact_uses_email_pointer(self, bunq):
        bunq.get_all_payment.return_value = [_payment_email_only(name="Ghost")]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        c = data[0]
        assert c["pointer_type"] == "EMAIL"
        assert c["iban"] is None

    @pytest.mark.unit
    def test_deduplicates_same_iban(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL12BUNQ0001", name="Jane", created="2026-04-25 10:00:00"),
            _payment_with_iban(iban="NL12BUNQ0001", name="Jane", created="2026-04-20 08:00:00"),
            _payment_with_iban(iban="NL12BUNQ0001", name="Jane", created="2026-04-15 09:00:00"),
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        assert data[0]["transaction_count"] == 3

    @pytest.mark.unit
    def test_multiple_distinct_contacts(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL12BUNQ0001", name="Alice"),
            _payment_with_iban(iban="NL12BUNQ0002", name="Bob"),
            _payment_with_iban(iban="NL12BUNQ0003", name="Carol"),
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 3
        names = {c["name"] for c in data}
        assert names == {"Alice", "Bob", "Carol"}

    @pytest.mark.unit
    def test_sorted_by_frequency_descending(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL00001", name="Frequent"),
            _payment_with_iban(iban="NL00001", name="Frequent"),
            _payment_with_iban(iban="NL00001", name="Frequent"),
            _payment_with_iban(iban="NL00002", name="Rare"),
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert data[0]["name"] == "Frequent"
        assert data[0]["transaction_count"] == 3
        assert data[1]["name"] == "Rare"

    @pytest.mark.unit
    def test_merges_payments_and_requests(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL00001", name="Jane")
        ]
        req = MagicMock()
        req.counterparty_alias.label_monetary_account.display_name = "Jane"
        req.counterparty_alias.label_monetary_account.iban = "NL00001"
        req.created = "2026-04-22 09:00:00"
        bunq.get_all_request.return_value = [req]
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        assert data[0]["transaction_count"] == 2

    @pytest.mark.unit
    def test_last_seen_is_most_recent(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL00001", name="Jane", created="2026-04-25 10:00:00"),
            _payment_with_iban(iban="NL00001", name="Jane", created="2026-01-01 00:00:00"),
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert data[0]["last_seen"] == "2026-04-25 10:00:00"

    @pytest.mark.unit
    def test_skips_missing_counterparty(self, bunq):
        p = MagicMock()
        p.amount.value = "-10.00"
        p.counterparty_alias = None
        p.created = "2026-04-25 10:00:00"
        bunq.get_all_payment.return_value = [p]
        bunq.get_all_request.return_value = []
        assert client.get("/api/contacts").json() == []

    @pytest.mark.unit
    def test_limit_param_forwarded(self, bunq):
        bunq.get_all_payment.return_value = []
        bunq.get_all_request.return_value = []
        client.get("/api/contacts?limit=25")
        bunq.get_all_payment.assert_called_once_with(25)
        bunq.get_all_request.assert_called_once_with(25)

    @pytest.mark.unit
    def test_saved_flag_false_for_history_only(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        bunq.get_all_payment.return_value = [_payment_with_iban(iban="NL001", name="Jane")]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert data[0]["saved"] is False

    @pytest.mark.unit
    def test_saved_contact_merged_with_history(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([{"name": "Jane", "pointer_type": "IBAN", "pointer_value": "NL001"}]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        bunq.get_all_payment.return_value = [_payment_with_iban(iban="NL001", name="Jane")]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        assert data[0]["saved"] is True
        assert data[0]["transaction_count"] == 1

    @pytest.mark.unit
    def test_saved_contact_with_no_history_appears(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([{"name": "Bob", "pointer_type": "EMAIL", "pointer_value": "bob@example.com"}]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        bunq.get_all_payment.return_value = []
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts").json()
        assert len(data) == 1
        assert data[0]["name"] == "Bob"
        assert data[0]["saved"] is True
        assert data[0]["transaction_count"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/contacts/top
# ══════════════════════════════════════════════════════════════════════════════

class TestGetTopContacts:
    @pytest.mark.unit
    def test_returns_top_5_by_default(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban=f"NL00{i}", name=f"Person{i}") for i in range(8)
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts/top").json()
        assert len(data) == 5

    @pytest.mark.unit
    def test_n_param_controls_count(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban=f"NL00{i}", name=f"P{i}") for i in range(10)
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts/top?n=3").json()
        assert len(data) == 3

    @pytest.mark.unit
    def test_fewer_contacts_than_n_returns_all(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL001", name="Only One")
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts/top").json()
        assert len(data) == 1

    @pytest.mark.unit
    def test_ordered_by_frequency(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment_with_iban(iban="NL001", name="Frequent"),
            _payment_with_iban(iban="NL001", name="Frequent"),
            _payment_with_iban(iban="NL001", name="Frequent"),
            _payment_with_iban(iban="NL002", name="Rare"),
        ]
        bunq.get_all_request.return_value = []
        data = client.get("/api/contacts/top").json()
        assert data[0]["name"] == "Frequent"
        assert data[0]["transaction_count"] == 3
        assert data[1]["name"] == "Rare"

    @pytest.mark.unit
    def test_empty_history_returns_empty(self, bunq):
        bunq.get_all_payment.return_value = []
        bunq.get_all_request.return_value = []
        assert client.get("/api/contacts/top").json() == []

    @pytest.mark.unit
    def test_contact_has_required_fields(self, bunq):
        bunq.get_all_payment.return_value = [_payment_with_iban(iban="NL001", name="Jane")]
        bunq.get_all_request.return_value = []
        c = client.get("/api/contacts/top").json()[0]
        for field in ("name", "iban", "pointer_type", "pointer_value", "transaction_count", "last_seen"):
            assert field in c


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/contacts  (save a contact)
# ══════════════════════════════════════════════════════════════════════════════

class TestAddContact:
    @pytest.mark.unit
    def test_save_email_contact(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        resp = client.post("/api/contacts", json={
            "name": "Alice", "pointer_type": "EMAIL", "pointer_value": "alice@example.com"
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "created"
        assert data["contact"]["name"] == "Alice"
        assert data["contact"]["pointer_type"] == "EMAIL"
        assert data["contact"]["pointer_value"] == "alice@example.com"

    @pytest.mark.unit
    def test_save_iban_contact(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        resp = client.post("/api/contacts", json={
            "name": "Bob", "pointer_type": "IBAN", "pointer_value": "NL12BUNQ0123456789"
        })
        assert resp.status_code == 201
        assert resp.json()["contact"]["pointer_type"] == "IBAN"

    @pytest.mark.unit
    def test_save_phone_contact(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        resp = client.post("/api/contacts", json={
            "name": "Carol", "pointer_type": "PHONE_NUMBER", "pointer_value": "+31612345678"
        })
        assert resp.status_code == 201

    @pytest.mark.unit
    def test_persisted_to_file(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        client.post("/api/contacts", json={
            "name": "Dave", "pointer_type": "EMAIL", "pointer_value": "dave@example.com"
        })
        saved = json.loads(f.read_text())
        assert len(saved) == 1
        assert saved[0]["pointer_value"] == "dave@example.com"

    @pytest.mark.unit
    def test_duplicate_returns_409(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([{"name": "Eve", "pointer_type": "EMAIL", "pointer_value": "eve@example.com"}]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        resp = client.post("/api/contacts", json={
            "name": "Eve Again", "pointer_type": "EMAIL", "pointer_value": "eve@example.com"
        })
        assert resp.status_code == 409

    @pytest.mark.unit
    def test_invalid_pointer_type_returns_422(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        resp = client.post("/api/contacts", json={
            "name": "X", "pointer_type": "TWITTER", "pointer_value": "@x"
        })
        assert resp.status_code == 422

    @pytest.mark.unit
    def test_multiple_contacts_accumulated(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        client.post("/api/contacts", json={"name": "A", "pointer_type": "EMAIL", "pointer_value": "a@x.com"})
        client.post("/api/contacts", json={"name": "B", "pointer_type": "EMAIL", "pointer_value": "b@x.com"})
        saved = json.loads(f.read_text())
        assert len(saved) == 2

    @pytest.mark.unit
    def test_missing_name_returns_422(self, bunq, tmp_path, monkeypatch):
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(tmp_path / "contacts.json"))
        resp = client.post("/api/contacts", json={"pointer_type": "EMAIL", "pointer_value": "x@x.com"})
        assert resp.status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /api/contacts/{pointer_value}
# ══════════════════════════════════════════════════════════════════════════════

class TestDeleteContact:
    @pytest.mark.unit
    def test_delete_existing(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([{"name": "Alice", "pointer_type": "EMAIL", "pointer_value": "alice@example.com"}]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        resp = client.delete("/api/contacts/alice@example.com")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

    @pytest.mark.unit
    def test_delete_removes_from_file(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([{"name": "Alice", "pointer_type": "EMAIL", "pointer_value": "alice@example.com"}]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        client.delete("/api/contacts/alice@example.com")
        assert json.loads(f.read_text()) == []

    @pytest.mark.unit
    def test_delete_only_removes_target(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([
            {"name": "Alice", "pointer_type": "EMAIL", "pointer_value": "alice@example.com"},
            {"name": "Bob",   "pointer_type": "EMAIL", "pointer_value": "bob@example.com"},
        ]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        client.delete("/api/contacts/alice@example.com")
        remaining = json.loads(f.read_text())
        assert len(remaining) == 1
        assert remaining[0]["pointer_value"] == "bob@example.com"

    @pytest.mark.unit
    def test_delete_nonexistent_returns_404(self, bunq, tmp_path, monkeypatch):
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps([]))
        monkeypatch.setattr("tinker.api_app.CONTACTS_FILE", str(f))
        resp = client.delete("/api/contacts/nobody@example.com")
        assert resp.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/transactions
# ══════════════════════════════════════════════════════════════════════════════

class TestListTransactions:
    @pytest.mark.unit
    def test_empty_returns_empty_list(self, bunq):
        bunq.get_all_payment.return_value = []
        resp = client.get("/api/transactions")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.unit
    def test_outgoing_payment_direction(self, bunq):
        bunq.get_all_payment.return_value = [_payment(amount="-42.50")]
        assert client.get("/api/transactions").json()[0]["direction"] == "OUT"

    @pytest.mark.unit
    def test_incoming_payment_direction(self, bunq):
        bunq.get_all_payment.return_value = [_payment(amount="1500.00")]
        assert client.get("/api/transactions").json()[0]["direction"] == "IN"

    @pytest.mark.unit
    def test_all_fields_present(self, bunq):
        bunq.get_all_payment.return_value = [_payment()]
        tx = client.get("/api/transactions").json()[0]
        assert set(tx.keys()) == {"id", "amount", "currency", "direction", "description", "counterparty", "created"}

    @pytest.mark.unit
    def test_field_values_correct(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment(id_=5, amount="-99.00", currency="EUR", description="Rent",
                     counterparty_name="Landlord", created="2026-04-01 09:00:00")
        ]
        tx = client.get("/api/transactions").json()[0]
        assert tx["id"] == 5
        assert tx["amount"] == "-99.00"
        assert tx["currency"] == "EUR"
        assert tx["description"] == "Rent"
        assert tx["counterparty"] == "Landlord"
        assert tx["created"] == "2026-04-01 09:00:00"

    @pytest.mark.unit
    def test_missing_counterparty_shows_unknown(self, bunq):
        bunq.get_all_payment.return_value = [_payment(has_counterparty=False)]
        assert client.get("/api/transactions").json()[0]["counterparty"] == "Unknown"

    @pytest.mark.unit
    def test_count_param_forwarded(self, bunq):
        bunq.get_all_payment.return_value = []
        client.get("/api/transactions?count=25")
        bunq.get_all_payment.assert_called_once_with(25)

    @pytest.mark.unit
    def test_default_count_is_10(self, bunq):
        bunq.get_all_payment.return_value = []
        client.get("/api/transactions")
        bunq.get_all_payment.assert_called_once_with(10)

    @pytest.mark.unit
    def test_multiple_transactions_all_returned(self, bunq):
        bunq.get_all_payment.return_value = [
            _payment(id_=1), _payment(id_=2), _payment(id_=3)
        ]
        data = client.get("/api/transactions").json()
        assert len(data) == 3
        assert [t["id"] for t in data] == [1, 2, 3]


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/budget
# ══════════════════════════════════════════════════════════════════════════════

class TestGetBudget:
    @pytest.mark.unit
    def test_all_fields_present(self, bunq):
        bunq.get_all_payment.return_value = []
        data = client.get("/api/budget").json()
        assert set(data.keys()) == {"month", "totalSpent", "totalReceived", "net", "transactionCount"}

    @pytest.mark.unit
    def test_zero_activity(self, bunq):
        bunq.get_all_payment.return_value = []
        data = client.get("/api/budget").json()
        assert data["totalSpent"] == "0.00"
        assert data["totalReceived"] == "0.00"
        assert data["net"] == "0.00"
        assert data["transactionCount"] == 0

    @pytest.mark.unit
    def test_only_counts_current_month(self, bunq, monkeypatch):
        now = datetime.datetime(2026, 4, 25, 12, 0, 0)
        monkeypatch.setattr("tinker.api_app.datetime.datetime", _fixed_datetime(now))
        bunq.get_all_payment.return_value = [
            _payment(amount="-50.00", created="2026-04-10 08:00:00"),  # current month
            _payment(amount="-80.00", created="2026-03-15 10:00:00"),  # previous month — excluded
            _payment(amount="-20.00", created="2025-04-01 00:00:00"),  # last year — excluded
        ]
        data = client.get("/api/budget").json()
        assert data["totalSpent"] == "50.00"
        assert data["transactionCount"] == 1

    @pytest.mark.unit
    def test_separates_spent_and_received(self, bunq, monkeypatch):
        now = datetime.datetime(2026, 4, 25, 12, 0, 0)
        monkeypatch.setattr("tinker.api_app.datetime.datetime", _fixed_datetime(now))
        bunq.get_all_payment.return_value = [
            _payment(amount="-100.00", created="2026-04-01 00:00:00"),
            _payment(amount="-50.00",  created="2026-04-02 00:00:00"),
            _payment(amount="1500.00", created="2026-04-03 00:00:00"),
        ]
        data = client.get("/api/budget").json()
        assert data["totalSpent"]       == "150.00"
        assert data["totalReceived"]    == "1500.00"
        assert data["net"]              == "1350.00"
        assert data["transactionCount"] == 3

    @pytest.mark.unit
    def test_net_can_be_negative(self, bunq, monkeypatch):
        now = datetime.datetime(2026, 4, 25, 12, 0, 0)
        monkeypatch.setattr("tinker.api_app.datetime.datetime", _fixed_datetime(now))
        bunq.get_all_payment.return_value = [
            _payment(amount="-500.00", created="2026-04-01 00:00:00"),
            _payment(amount="100.00",  created="2026-04-02 00:00:00"),
        ]
        data = client.get("/api/budget").json()
        assert float(data["net"]) < 0

    @pytest.mark.unit
    def test_month_label_format(self, bunq, monkeypatch):
        now = datetime.datetime(2026, 4, 25, 12, 0, 0)
        monkeypatch.setattr("tinker.api_app.datetime.datetime", _fixed_datetime(now))
        bunq.get_all_payment.return_value = []
        data = client.get("/api/budget").json()
        assert data["month"] == "April 2026"

    @pytest.mark.unit
    def test_fetches_100_payments_for_accuracy(self, bunq):
        bunq.get_all_payment.return_value = []
        client.get("/api/budget")
        bunq.get_all_payment.assert_called_once_with(100)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/payment
# ══════════════════════════════════════════════════════════════════════════════

class TestMakePayment:
    @pytest.mark.unit
    def test_success_returns_status_and_message(self, bunq):
        bunq.make_payment.return_value = None
        resp = client.post("/api/payment", json={
            "amount": "42.50", "description": "Dinner", "recipient": "friend@example.com"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "42.50" in data["message"]
        assert "friend@example.com" in data["message"]

    @pytest.mark.unit
    def test_calls_lib_with_correct_args(self, bunq):
        bunq.make_payment.return_value = None
        client.post("/api/payment", json={
            "amount": "10.00", "description": "Test", "recipient": "a@b.com", "pointer_type": "EMAIL"
        })
        bunq.make_payment.assert_called_once_with("10.00", "Test", "a@b.com", "EMAIL")

    @pytest.mark.unit
    def test_default_pointer_type_is_email(self, bunq):
        bunq.make_payment.return_value = None
        client.post("/api/payment", json={
            "amount": "5.00", "description": "x", "recipient": "a@b.com"
        })
        args = bunq.make_payment.call_args[0]
        assert args[3] == "EMAIL"

    @pytest.mark.unit
    def test_iban_pointer_type_forwarded(self, bunq):
        bunq.make_payment.return_value = None
        client.post("/api/payment", json={
            "amount": "5.00", "description": "x",
            "recipient": "NL12BUNQ0123456789", "pointer_type": "IBAN"
        })
        assert bunq.make_payment.call_args[0][3] == "IBAN"

    @pytest.mark.unit
    def test_update_context_called_after_payment(self, bunq):
        bunq.make_payment.return_value = None
        client.post("/api/payment", json={
            "amount": "1.00", "description": "x", "recipient": "x@x.com"
        })
        bunq.update_context.assert_called_once()

    @pytest.mark.unit
    def test_bunq_exception_returns_400(self, bunq):
        bunq.make_payment.side_effect = Exception("Insufficient funds")
        resp = client.post("/api/payment", json={
            "amount": "99999.00", "description": "x", "recipient": "x@x.com"
        })
        assert resp.status_code == 400
        assert "Insufficient funds" in resp.json()["detail"]

    @pytest.mark.unit
    def test_missing_amount_returns_422(self, bunq):
        resp = client.post("/api/payment", json={"description": "x", "recipient": "a@b.com"})
        assert resp.status_code == 422

    @pytest.mark.unit
    def test_missing_recipient_returns_422(self, bunq):
        resp = client.post("/api/payment", json={"amount": "10.00", "description": "x"})
        assert resp.status_code == 422

    @pytest.mark.unit
    def test_missing_description_returns_422(self, bunq):
        resp = client.post("/api/payment", json={"amount": "10.00", "recipient": "a@b.com"})
        assert resp.status_code == 422

    @pytest.mark.unit
    def test_empty_body_returns_422(self, bunq):
        assert client.post("/api/payment", json={}).status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/requests
# ══════════════════════════════════════════════════════════════════════════════

class TestListRequests:
    @pytest.mark.unit
    def test_empty_returns_empty_list(self, bunq):
        bunq.get_all_request.return_value = []
        resp = client.get("/api/requests")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.unit
    def test_all_fields_present(self, bunq):
        bunq.get_all_request.return_value = [_request_inquiry()]
        keys = set(client.get("/api/requests").json()[0].keys())
        assert keys == {"id", "amount", "currency", "description", "status", "counterparty", "created"}

    @pytest.mark.unit
    def test_field_values_correct(self, bunq):
        bunq.get_all_request.return_value = [
            _request_inquiry(id_=10, amount="25.00", description="Dinner",
                             status="PENDING", counterparty_name="Bob",
                             created="2026-04-25 09:00:00")
        ]
        r = client.get("/api/requests").json()[0]
        assert r["id"] == 10
        assert r["amount"] == "25.00"
        assert r["currency"] == "EUR"
        assert r["description"] == "Dinner"
        assert r["status"] == "PENDING"
        assert r["counterparty"] == "Bob"
        assert r["created"] == "2026-04-25 09:00:00"

    @pytest.mark.unit
    def test_missing_counterparty_shows_unknown(self, bunq):
        bunq.get_all_request.return_value = [_request_inquiry(has_counterparty=False)]
        assert client.get("/api/requests").json()[0]["counterparty"] == "Unknown"

    @pytest.mark.unit
    def test_count_param_forwarded(self, bunq):
        bunq.get_all_request.return_value = []
        client.get("/api/requests?count=20")
        bunq.get_all_request.assert_called_once_with(20)

    @pytest.mark.unit
    def test_default_count_is_10(self, bunq):
        bunq.get_all_request.return_value = []
        client.get("/api/requests")
        bunq.get_all_request.assert_called_once_with(10)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/request
# ══════════════════════════════════════════════════════════════════════════════

class TestRequestMoney:
    @pytest.mark.unit
    def test_success_response(self, bunq):
        bunq.make_request.return_value = None
        resp = client.post("/api/request", json={
            "amount": "25.00", "description": "Groceries", "recipient": "friend@example.com"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "25.00" in data["message"]
        assert "friend@example.com" in data["message"]

    @pytest.mark.unit
    def test_calls_lib_with_correct_args(self, bunq):
        bunq.make_request.return_value = None
        client.post("/api/request", json={
            "amount": "30.00", "description": "Rent split", "recipient": "bob@example.com"
        })
        bunq.make_request.assert_called_once_with("30.00", "Rent split", "bob@example.com", "EMAIL")

    @pytest.mark.unit
    def test_iban_pointer_type_forwarded(self, bunq):
        bunq.make_request.return_value = None
        client.post("/api/request", json={
            "amount": "15.00", "description": "Drinks",
            "recipient": "NL12BUNQ0123456789", "pointer_type": "IBAN"
        })
        args = bunq.make_request.call_args[0]
        assert args[2] == "NL12BUNQ0123456789"
        assert args[3] == "IBAN"

    @pytest.mark.unit
    def test_default_pointer_type_is_email(self, bunq):
        bunq.make_request.return_value = None
        client.post("/api/request", json={
            "amount": "5.00", "description": "x", "recipient": "a@b.com"
        })
        assert bunq.make_request.call_args[0][3] == "EMAIL"

    @pytest.mark.unit
    def test_bunq_exception_returns_400(self, bunq):
        bunq.make_request.side_effect = Exception("Invalid recipient")
        resp = client.post("/api/request", json={
            "amount": "10.00", "description": "x", "recipient": "bad"
        })
        assert resp.status_code == 400
        assert "Invalid recipient" in resp.json()["detail"]

    @pytest.mark.unit
    def test_missing_amount_returns_422(self, bunq):
        assert client.post("/api/request", json={"description": "x", "recipient": "a@b.com"}).status_code == 422

    @pytest.mark.unit
    def test_missing_recipient_returns_422(self, bunq):
        assert client.post("/api/request", json={"amount": "10.00", "description": "x"}).status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/cards
# ══════════════════════════════════════════════════════════════════════════════

class TestListCards:
    @pytest.mark.unit
    def test_empty_returns_empty_list(self, bunq):
        bunq.get_all_card.return_value = []
        resp = client.get("/api/cards")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.unit
    def test_card_fields(self, bunq):
        bunq.get_all_card.return_value = [
            _card(id_=55, type_="MASTERCARD", status="ACTIVE", account_name="Checking")
        ]
        data = client.get("/api/cards").json()
        assert data[0]["id"] == 55
        assert data[0]["type"] == "MASTERCARD"
        assert data[0]["status"] == "ACTIVE"
        assert data[0]["account"] == "Checking"

    @pytest.mark.unit
    def test_multiple_cards(self, bunq):
        bunq.get_all_card.return_value = [_card(id_=1), _card(id_=2)]
        data = client.get("/api/cards").json()
        assert len(data) == 2
        assert {c["id"] for c in data} == {1, 2}

    @pytest.mark.unit
    def test_count_param_forwarded(self, bunq):
        bunq.get_all_card.return_value = []
        client.get("/api/cards?count=5")
        bunq.get_all_card.assert_called_once_with(5)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/savings-goal  (stub)
# ══════════════════════════════════════════════════════════════════════════════

class TestSavingsGoal:
    @pytest.mark.unit
    def test_success_response(self, bunq):
        resp = client.post("/api/savings-goal", json={
            "name": "Holiday", "target_amount": "1500.00"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "Holiday" in data["message"]
        assert "1500.00" in data["message"]

    @pytest.mark.unit
    def test_account_id_returned(self, bunq):
        resp = client.post("/api/savings-goal", json={
            "name": "Car", "target_amount": "5000.00"
        })
        assert "accountId" in resp.json()

    @pytest.mark.unit
    def test_missing_name_returns_422(self, bunq):
        assert client.post("/api/savings-goal", json={"target_amount": "100.00"}).status_code == 422

    @pytest.mark.unit
    def test_missing_target_returns_422(self, bunq):
        assert client.post("/api/savings-goal", json={"name": "Fund"}).status_code == 422

    @pytest.mark.unit
    def test_optional_color_accepted(self, bunq):
        resp = client.post("/api/savings-goal", json={
            "name": "Fund", "target_amount": "200.00", "color": "#FF0000"
        })
        assert resp.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/schedule-payment  (stub)
# ══════════════════════════════════════════════════════════════════════════════

class TestSchedulePayment:
    @pytest.mark.unit
    def test_success_response(self, bunq):
        resp = client.post("/api/schedule-payment", json={
            "amount": "100.00",
            "description": "Rent",
            "recipient": "NL12BUNQ0123456789",
            "scheduled_at": "2026-05-01T12:00:00Z",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "100.00" in data["message"]
        assert "NL12BUNQ0123456789" in data["message"]

    @pytest.mark.unit
    def test_schedule_id_returned(self, bunq):
        resp = client.post("/api/schedule-payment", json={
            "amount": "50.00", "description": "x",
            "recipient": "NL00TEST", "scheduled_at": "2026-06-01T00:00:00Z"
        })
        assert "scheduleId" in resp.json()

    @pytest.mark.unit
    def test_missing_scheduled_at_returns_422(self, bunq):
        resp = client.post("/api/schedule-payment", json={
            "amount": "10.00", "description": "x", "recipient": "NL00TEST"
        })
        assert resp.status_code == 422

    @pytest.mark.unit
    def test_missing_recipient_returns_422(self, bunq):
        resp = client.post("/api/schedule-payment", json={
            "amount": "10.00", "description": "x", "scheduled_at": "2026-05-01T00:00:00Z"
        })
        assert resp.status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# PUT /api/card-limit  (stub)
# ══════════════════════════════════════════════════════════════════════════════

class TestCardLimit:
    @pytest.mark.unit
    def test_success_response(self, bunq):
        resp = client.put("/api/card-limit", json={"limit_amount": "200.00"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["newLimit"] == "200.00"
        assert data["currency"] == "EUR"

    @pytest.mark.unit
    def test_limit_echoed_back(self, bunq):
        resp = client.put("/api/card-limit", json={"limit_amount": "999.99"})
        assert resp.json()["newLimit"] == "999.99"

    @pytest.mark.unit
    def test_missing_limit_returns_422(self, bunq):
        assert client.put("/api/card-limit", json={}).status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# Integration tests — require a live bunq sandbox
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.integration
class TestIntegration:
    def test_user_has_id_and_name(self):
        resp = client.get("/api/user")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["id"], int)
        assert isinstance(data["name"], str)
        assert data["name"]

    def test_balance_is_parseable_float(self):
        resp = client.get("/api/balance")
        assert resp.status_code == 200
        data = resp.json()
        float(data["balance"])
        assert data["currency"] == "EUR"
        assert data["account"]

    def test_accounts_not_empty_and_shaped(self):
        resp = client.get("/api/accounts")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        for acc in data:
            assert set(acc.keys()) == {"id", "description", "balance", "currency"}
            float(acc["balance"])

    def test_aliases_shaped(self):
        resp = client.get("/api/aliases")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        for alias in data:
            assert "type" in alias
            assert "value" in alias
            assert alias["type"] in ("EMAIL", "IBAN", "PHONE_NUMBER")

    def test_contacts_shaped(self):
        resp = client.get("/api/contacts")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        for c in data:
            for field in ("name", "pointer_type", "pointer_value", "transaction_count", "last_seen", "saved"):
                assert field in c
            assert c["pointer_type"] in ("EMAIL", "IBAN", "PHONE_NUMBER")
            assert isinstance(c["saved"], bool)

    def test_contacts_sorted_by_frequency(self):
        data = client.get("/api/contacts").json()
        counts = [c["transaction_count"] for c in data]
        assert counts == sorted(counts, reverse=True)

    def test_top_contacts_returns_at_most_5(self):
        data = client.get("/api/contacts/top").json()
        assert isinstance(data, list)
        assert len(data) <= 5

    def test_top_contacts_sorted_by_frequency(self):
        data = client.get("/api/contacts/top").json()
        counts = [c["transaction_count"] for c in data]
        assert counts == sorted(counts, reverse=True)

    def test_add_and_delete_contact(self):
        resp = client.post("/api/contacts", json={
            "name": "Integration Test User",
            "pointer_type": "EMAIL",
            "pointer_value": "integration-test-do-not-use@example.com",
        })
        assert resp.status_code == 201
        # appears in full list
        contacts = client.get("/api/contacts").json()
        values = [c["pointer_value"] for c in contacts]
        assert "integration-test-do-not-use@example.com" in values
        # clean up
        del_resp = client.delete("/api/contacts/integration-test-do-not-use@example.com")
        assert del_resp.status_code == 200

    def test_saved_contact_flagged_in_list(self):
        client.post("/api/contacts", json={
            "name": "Flagged Test",
            "pointer_type": "EMAIL",
            "pointer_value": "flagged-test@example.com",
        })
        contacts = client.get("/api/contacts").json()
        match = next((c for c in contacts if c["pointer_value"] == "flagged-test@example.com"), None)
        assert match is not None
        assert match["saved"] is True
        client.delete("/api/contacts/flagged-test@example.com")

    def test_contact_pointer_usable_for_payment(self):
        contacts = client.get("/api/contacts").json()
        if not contacts:
            pytest.skip("No contacts to test with")
        top = contacts[0]
        resp = client.post("/api/payment", json={
            "amount": "0.01",
            "description": "Contact pointer test",
            "recipient": top["pointer_value"],
            "pointer_type": top["pointer_type"],
        })
        assert resp.status_code == 200

    def test_transactions_shaped(self):
        resp = client.get("/api/transactions?count=5")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        for tx in data:
            assert set(tx.keys()) == {"id", "amount", "currency", "direction", "description", "counterparty", "created"}
            assert tx["direction"] in ("IN", "OUT")
            float(tx["amount"])

    def test_budget_values_are_numeric(self):
        resp = client.get("/api/budget")
        assert resp.status_code == 200
        data = resp.json()
        float(data["totalSpent"])
        float(data["totalReceived"])
        float(data["net"])
        assert isinstance(data["transactionCount"], int)
        assert data["transactionCount"] >= 0

    def test_budget_net_equals_received_minus_spent(self):
        data = client.get("/api/budget").json()
        expected_net = float(data["totalReceived"]) - float(data["totalSpent"])
        assert abs(float(data["net"]) - expected_net) < 0.01

    def test_requests_shaped(self):
        resp = client.get("/api/requests?count=5")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_cards_shaped(self):
        resp = client.get("/api/cards")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        for card in data:
            assert "id" in card

    def test_payment_to_sugardaddy(self):
        resp = client.post("/api/payment", json={
            "amount": "0.01",
            "description": "Integration test",
            "recipient": "sugardaddy@bunq.com",
            "pointer_type": "EMAIL",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

    def test_payment_appears_in_transactions_after(self):
        client.post("/api/payment", json={
            "amount": "0.01",
            "description": "tx-visibility-test",
            "recipient": "sugardaddy@bunq.com",
            "pointer_type": "EMAIL",
        })
        txns = client.get("/api/transactions?count=5").json()
        descriptions = [t["description"] for t in txns]
        assert any("tx-visibility-test" in d for d in descriptions)

    def test_balance_decreases_after_payment(self):
        before = float(client.get("/api/balance").json()["balance"])
        client.post("/api/payment", json={
            "amount": "0.01",
            "description": "balance-check-test",
            "recipient": "sugardaddy@bunq.com",
            "pointer_type": "EMAIL",
        })
        after = float(client.get("/api/balance").json()["balance"])
        assert after < before


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/sandbox/user
# ══════════════════════════════════════════════════════════════════════════════

class TestSandboxCreateUser:
    @pytest.mark.unit
    def test_returns_api_key_and_url(self, bunq, monkeypatch):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "Response": [{"ApiKey": {"api_key": "sandbox_testapikey123"}}]
        }
        monkeypatch.setattr("tinker.api_app.http_requests.post", lambda *a, **kw: mock_resp)
        resp = client.post("/api/sandbox/user")
        assert resp.status_code == 200
        data = resp.json()
        assert data["api_key"] == "sandbox_testapikey123"
        assert "sandbox_url" in data
        assert "note" in data

    @pytest.mark.unit
    def test_api_key_format(self, bunq, monkeypatch):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "Response": [{"ApiKey": {"api_key": "sandbox_abc123xyz"}}]
        }
        monkeypatch.setattr("tinker.api_app.http_requests.post", lambda *a, **kw: mock_resp)
        data = client.post("/api/sandbox/user").json()
        assert data["api_key"].startswith("sandbox_")

    @pytest.mark.unit
    def test_bunq_api_error_returns_502(self, bunq, monkeypatch):
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.text = "Rate limit exceeded"
        monkeypatch.setattr("tinker.api_app.http_requests.post", lambda *a, **kw: mock_resp)
        resp = client.post("/api/sandbox/user")
        assert resp.status_code == 502
        assert "bunq sandbox API error" in resp.json()["detail"]

    @pytest.mark.unit
    def test_hits_correct_bunq_endpoint(self, bunq, monkeypatch):
        calls = []
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "Response": [{"ApiKey": {"api_key": "sandbox_x"}}]
        }
        def capture(url, **kw):
            calls.append(url)
            return mock_resp
        monkeypatch.setattr("tinker.api_app.http_requests.post", capture)
        client.post("/api/sandbox/user")
        assert len(calls) == 1
        assert "sandbox-user-person" in calls[0]
        assert "sandbox.bunq.com" in calls[0]

    @pytest.mark.integration
    def test_integration_creates_real_sandbox_user(self):
        resp = client.post("/api/sandbox/user")
        assert resp.status_code == 200
        data = resp.json()
        assert data["api_key"].startswith("sandbox_")
        assert len(data["api_key"]) > 20


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/sandbox/topup
# ══════════════════════════════════════════════════════════════════════════════

class TestSandboxTopup:
    @pytest.mark.unit
    def test_success_response_default_amount(self, bunq):
        bunq.make_request.return_value = None
        resp = client.post("/api/sandbox/topup")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "sugardaddy@bunq.com" in data["message"]

    @pytest.mark.unit
    def test_custom_amount(self, bunq):
        bunq.make_request.return_value = None
        resp = client.post("/api/sandbox/topup", json={"amount": "250.00"})
        assert resp.status_code == 200
        assert "250.00" in resp.json()["message"]

    @pytest.mark.unit
    def test_calls_lib_with_sugardaddy(self, bunq):
        bunq.make_request.return_value = None
        client.post("/api/sandbox/topup", json={"amount": "100.00"})
        args = bunq.make_request.call_args[0]
        assert args[0] == "100.00"
        assert args[2] == "sugardaddy@bunq.com"

    @pytest.mark.unit
    def test_default_amount_is_500(self, bunq):
        bunq.make_request.return_value = None
        client.post("/api/sandbox/topup")
        args = bunq.make_request.call_args[0]
        assert args[0] == "500.00"

    @pytest.mark.unit
    def test_bunq_error_returns_400(self, bunq):
        bunq.make_request.side_effect = Exception("Request failed")
        resp = client.post("/api/sandbox/topup")
        assert resp.status_code == 400
        assert "Request failed" in resp.json()["detail"]

    @pytest.mark.integration
    def test_integration_topup_increases_balance(self):
        before = float(client.get("/api/balance").json()["balance"])
        resp = client.post("/api/sandbox/topup", json={"amount": "10.00"})
        assert resp.status_code == 200
        import time; time.sleep(2)  # sugardaddy takes ~1s to process
        after = float(client.get("/api/balance").json()["balance"])
        assert after > before
