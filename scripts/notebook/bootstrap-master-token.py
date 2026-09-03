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

## The rule this file is built around: NEVER DESTROY A SPENT CREDENTIAL

The first version of this script burned Grant's token. The exchange succeeded
and wrote `master_token.json` and `storage_state.json`; the next line called
`read_master_token()` with a *directory* instead of the file and raised; and a
`finally:` block then deleted both files on the way out. The oauth_token is
single-use, so the credential it had just bought was destroyed and Grant had to
go and get another one.

The lesson is not "be careful with paths". It is that **cleanup of a
single-use credential must never run on an error path**, because the error path
is exactly when you still need what you just paid for. So:

  - Files are read into memory and emitted BEFORE anything is unlinked.
  - Cleanup happens only after a successful emit, never in `finally`.
  - If anything goes wrong after the exchange, the paths are reported so the
    credential can be recovered by hand rather than silently lost.

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


def scrub(paths: list[Path], directory: Path) -> None:
    """Remove the minted files. Called ONLY after a successful emit."""
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    try:
        for leftover in directory.iterdir():
            leftover.unlink(missing_ok=True)
        directory.rmdir()
    except OSError:
        pass


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
    # the resulting failure from Google is opaque. Checked BEFORE the exchange,
    # because a wrong value that reaches Google may still spend the real one.
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

    # A private temp dir: the library's bootstrap writes the session and the
    # token to disk. Both are read back and returned to the caller for
    # vaulting, and only then removed.
    directory = Path(tempfile.mkdtemp(prefix="nlm-bootstrap-"))
    storage_path = directory / "storage_state.json"
    # `master_token.json`, beside `storage_state.json` - the library's own
    # convention, and the path `read_master_token` expects. Passing the
    # directory instead is what burned the first token.
    token_path = directory / "master_token.json"

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
        lowered = str(exc).lower()
        if "used" in lowered or "invalid_grant" in lowered or "expired" in lowered:
            detail += (
                " - the oauth_token is single-use and appears to be spent. "
                "Sign in at accounts.google.com/EmbeddedSetup again for a fresh one."
            )
        emit({"ok": False, "detail": detail[:400], "spent": True})
        # Nothing was minted, so there is nothing to preserve.
        scrub([storage_path, token_path], directory)
        return

    # --- from here the token IS spent, so nothing may be destroyed on error ---
    # Everything is read into memory first. Any failure below reports the paths
    # instead of cleaning up, so a credential that has been paid for can always
    # be recovered by hand.
    master_token: str | None = None
    android_id: str | None = None
    storage_state: str | None = None
    problems: list[str] = []

    try:
        if storage_path.exists():
            storage_state = storage_path.read_text()
        else:
            problems.append("no storage_state.json was written")
    except OSError as exc:
        problems.append(f"could not read storage_state.json: {exc}")

    try:
        record = auth.read_master_token(token_path)
        if isinstance(record, dict):
            value = record.get("master_token")
            device = record.get("android_id")
            master_token = value if isinstance(value, str) else None
            android_id = device if isinstance(device, str) else None
        else:
            problems.append("no master_token.json was written")
    except Exception as exc:  # noqa: BLE001 - a bad read must not lose the jar
        problems.append(f"could not read master_token.json: {type(exc).__name__}: {exc}")

    ok = storage_state is not None
    detail_parts: list[str] = []
    if storage_state is not None:
        detail_parts.append(f"minted a cookie jar ({len(storage_state)} chars)")
    if master_token is not None:
        detail_parts.append(f"master token persisted ({len(master_token)} chars)")
    else:
        detail_parts.append("NO master token - the jar will not be able to re-mint")
    detail_parts.extend(problems)

    emit(
        {
            "ok": ok,
            "detail": "; ".join(detail_parts),
            "master_token": master_token,
            "android_id": android_id,
            "storage_state": storage_state,
            "account": email,
            # Reported so a partial failure is recoverable rather than lost.
            # Only populated when something went wrong; the files are gone
            # otherwise.
            "recovery_dir": str(directory) if problems else None,
        }
    )

    # Cleanup only after a clean emit. If anything went wrong the files stay on
    # disk, because the token that bought them cannot be spent twice.
    if not problems:
        scrub([storage_path, token_path], directory)


asyncio.run(main())
