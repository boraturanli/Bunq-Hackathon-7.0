# Bunq Hackathon 7.0 — Smart Split

AI-powered receipt splitting, native to bunq.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Sandbox API key

Each developer needs their own — they are personal and not committed to git.

```bash
curl -X POST https://public-api.sandbox.bunq.com/v1/sandbox-user-person
# copy the "api_key" value from the response
export BUNQ_API_KEY=sandbox_xxx
```

## Explore the bunq API

```bash
python explore_bunq.py
```

This authenticates you, lists your sandbox accounts, and shows recent payments. Auth state is saved to `bunq_sandbox.conf` (gitignored) so subsequent runs don't need `BUNQ_API_KEY` set again.
