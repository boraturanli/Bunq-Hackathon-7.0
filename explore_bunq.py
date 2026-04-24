"""
Usage:
  source .venv/bin/activate
  export BUNQ_API_KEY=sandbox_xxx
  python explore_bunq.py

Get a sandbox API key:
  curl -X POST https://public-api.sandbox.bunq.com/v1/sandbox-user-person
  # copy the "api_key" value
"""

import os, sys

from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.api_environment_type import ApiEnvironmentType
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated.endpoint import (
    MonetaryAccountBankApiObject,
    PaymentApiObject,
    RequestInquiryApiObject,
)
from bunq.sdk.model.generated.object_ import AmountObject, PointerObject

CONTEXT_FILE = "bunq_sandbox.conf"


def setup_context(api_key):
    ctx = ApiContext.create(
        environment_type=ApiEnvironmentType.SANDBOX,
        api_key=api_key,
        description="Smart Split Dev",
    )
    ctx.save(CONTEXT_FILE)
    return ctx


def load_context():
    ctx = ApiContext.restore(CONTEXT_FILE)
    ctx.ensure_session_active()
    return ctx


def main():
    api_key = os.environ.get("BUNQ_API_KEY", "")

    if not api_key and not os.path.exists(CONTEXT_FILE):
        print("Set your sandbox API key:\n  export BUNQ_API_KEY=sandbox_xxx")
        print("Get one with:\n  curl -X POST https://public-api.sandbox.bunq.com/v1/sandbox-user-person")
        sys.exit(1)

    ctx = setup_context(api_key) if (api_key and not os.path.exists(CONTEXT_FILE)) else load_context()
    BunqContext.load_api_context(ctx)

    user = BunqContext.user_context()
    print(f"\nLogged in — user ID: {user.user_id}")

    # List monetary accounts
    accounts = MonetaryAccountBankApiObject.list().value
    print(f"\nMonetary accounts ({len(accounts)}):")
    for acc in accounts:
        print(f"  [{acc.id_}] {acc.description}  balance={acc.balance.value} {acc.balance.currency}")

    account_id = accounts[0].id_

    # List recent payments — GET /v1/user/{id}/monetary-account/{id}/payment
    payments = PaymentApiObject.list(monetary_account_id=account_id).value
    print(f"\nRecent payments ({len(payments)}):")
    for p in payments[:5]:
        print(f"  [{p.id_}] {p.amount.value} {p.amount.currency}  '{p.description}'")

    if payments:
        # Fetch a single payment — GET /v1/user/{id}/monetary-account/{id}/payment/{id}
        p = PaymentApiObject.get(payments[0].id_, monetary_account_id=account_id).value
        print(f"\nFetched payment {p.id_}: amount={p.amount.value}, created={p.created}")

    # Fire a payment request — POST /v1/user/{id}/monetary-account/{id}/request-inquiry
    amount = AmountObject("5.00", "EUR")
    counterparty = PointerObject("EMAIL", "sugardaddy@bunq.com")
    req_id = RequestInquiryApiObject.create(
        amount_inquired=amount,
        counterparty_alias=counterparty,
        description="Pizza · Smart Split test",
        allow_bunqme=True,
        monetary_account_id=account_id,
    ).value
    print(f"\nCreated payment request ID: {req_id}")

    print("\nDone.")


if __name__ == "__main__":
    main()
