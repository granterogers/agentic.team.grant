"""Exchange a single-use EmbeddedSetup oauth_token for a durable master token.

    NOTEBOOK_OAUTH_TOKEN=... NOTEBOOK_ACCOUNT_EMAIL=... \
      python3 scripts/notebook/bootstrap-master-token.py

Prints one JSON object: {"ok": bool, "detail": str, "master_token": str|null,
"android_id": str|null, "storage_state": str|null}.

## Why this and not cookies

The cookie-export path was tried first and is the wrong mechanism for a remote
worker. `__Secure-1PSIDTS` rotates on a cycle of minutes to hours, and once the
browser rotates it the exported copy is dead - which is exactly what happened:
a jar with a year of stated expiry authenticated to nothing an hour later.

`HUMAN_ONLY_PREREQUISITES.md` Phase 4 asked for the master token from the
start. Substituting cookies because they looked like less work for Grant cost a
round trip and produced a credential that could never have survived rotation.

The library documents the flow it implements:

    oauth_token (single-use, from one EmbeddedSetup browser sign-in)
      --exchange--> aas_et/ master token   (durable; months)
      --mint-->     SID/SAPISID/__Secure-1PSID/... cookie jar

and the master token re-mints the jar whenever it rotates, with no browser.
That is the property cookies lack and the reason this is worth the extra step.

## What Grant hands over, and what he does not

An `oauth_token`, not a password. It is single-use and short-lived, and it is
consumed by this exchange. His Google password never reaches this session.

SECURITY: the resulting master token is full-account and durable - the library's
own module header calls it "infostealer-grade" and says to use a dedicated
account only. Nothing here is printed except lengths and status; the caller
vaults the value without logging it.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path


def emit(payload: dict[str, object]) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


async def main() -> None:
    email = os.environ.get("NOTEBOOK_ACCOUNT_EMAIL", "").strip()
    oauth_token = os.environ.get("NOTEBOOK_OAUTH_TOKEN", "").strip()

    if not email or "@" not in email:
        emit({"ok": False, "detail": "NOTEBOOK_ACCOUNT_EMAIL is missing or not an address"})
        return
    if not oauth_token:
        emit({"ok": False, "detail": "NOTEBOOK_OAUTH_TOKEN is missing"})
        return
    # The EmbeddedSetup token is an `oauth2_4/...` value. Checked because the
    # likeliest mistake is pasting a different cookie from the same page, and
    # the resulting failure from Google is opaque.
    if not oauth_token.startswith("oauth2_4/"):
        emit(
            {
                "ok": False,
                "detail": (
                    "that does not look like an EmbeddedSetup oauth_token "
                    "(it should start with 'oauth2_4/'). Check you copied the "
                    "`oauth_token` cookie and not another one from the page."
                ),
            }
        )
        return

    try:
        from notebooklm import auth
    except ImportError as exc:
        emit({"ok": False, "detail": f"notebooklm is not importable: {exc}"})
        return

    # A private temp file: the library's bootstrap writes the session and the
    # token to disk, and neither should land in a real profile or survive this
    # process. Read back, returned to the caller for vaulting, then unlinked.
    tmpdir = Path(tempfile.mkdtemp(prefix="nlm-bootstrap-"))
    storage_path = tmpdir / "storage_state.json"
    token_path = tmpdir / "master_token.json"

    try:
        try:
            await auth.master_token_bootstrap(
                email=email,
                oauth_token=oauth_token,
                storage_path=storage_path,
                verify=True,
            )
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            # The single-use token being spent is the one failure worth naming
            # precisely, because the remedy is "get a fresh one", not "retry".
            if "used" in str(exc).lower() or "invalid_grant" in str(exc).lower():
                detail += (
                    " - the oauth_token is single-use and appears to be spent. "
                    "Sign in at accounts.google.com/EmbeddedSetup again for a fresh one."
                )
            emit({"ok": False, "detail": detail[:400]})
            return

        stored = auth.read_master_token(storage_path.parent) or auth.read_master_token(token_path)
        master_token = None
        android_id = None
        if isinstance(stored, dict):
            master_token = stored.get("master_token")
            android_id = stored.get("android_id")

        storage_state = storage_path.read_text() if storage_path.exists() else None

        emit(
            {
                "ok": storage_state is not None,
                "detail": (
                    f"minted a cookie jar ({len(storage_state)} chars)"
                    if storage_state
                    else "the bootstrap reported success but wrote no storage state"
                )
                + (
                    f"; master token persisted ({len(master_token)} chars)"
                    if isinstance(master_token, str)
                    else "; NO master token was persisted - the jar will not re-mint"
                ),
                "master_token": master_token,
                "android_id": android_id,
                "storage_state": storage_state,
                "account": email,
            }
        )
    finally:
        for path in (storage_path, token_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            for leftover in tmpdir.iterdir():
                leftover.unlink(missing_ok=True)
            tmpdir.rmdir()
        except OSError:
            pass


asyncio.run(main())
