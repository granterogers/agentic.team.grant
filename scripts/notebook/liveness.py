"""Is this cookie jar actually authenticated? One request, no side effects.

    python3 scripts/notebook/liveness.py   (reads NOTEBOOK_CANDIDATE_STATE)

Prints one JSON object: {"alive": bool, "detail": str}.

This exists because the first version of `notebook:import` validated the
*shape* of a cookie export - required names present, expiries parsed - and
vaulted it. The jar was dead: every Google surface redirected to
accounts.google.com. The import reported a confident success and the failure
surfaced one step later, in the probe.

That is the same error this build has now made five times, and the third time
in code I wrote myself while documenting the lesson elsewhere: **a check on the
shape of a credential cannot speak for whether it works.** So the import now
refuses to store a jar that does not authenticate, and this is the check.

Two Google surfaces are tried, not one. NotebookLM alone cannot distinguish
"these cookies are dead" from "this product is refusing us", and those need
different responses.
"""

from __future__ import annotations

import json
import os
import sys

import httpx

SURFACES = (
    ("notebooklm", "https://notebooklm.google.com/"),
    # An unrelated authenticated surface. If this refuses too, the jar is dead
    # rather than the one product being fussy.
    ("myaccount", "https://myaccount.google.com/"),
)


def main() -> None:
    raw = os.environ.get("NOTEBOOK_CANDIDATE_STATE", "")
    if not raw:
        json.dump({"alive": False, "detail": "no candidate was passed"}, sys.stdout)
        return

    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        json.dump({"alive": False, "detail": f"not valid JSON: {exc}"}, sys.stdout)
        return

    cookies = parsed.get("cookies", parsed) if isinstance(parsed, dict) else parsed
    jar = httpx.Cookies()
    for cookie in cookies:
        try:
            jar.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain", ".google.com"),
                path=cookie.get("path", "/"),
            )
        except Exception:  # noqa: BLE001 - a malformed entry is not fatal
            continue

    results: list[str] = []
    authenticated = 0
    with httpx.Client(cookies=jar, follow_redirects=False, timeout=30) as client:
        for label, url in SURFACES:
            try:
                response = client.get(url)
            except Exception as exc:  # noqa: BLE001
                results.append(f"{label}=error({type(exc).__name__})")
                continue
            location = response.headers.get("location", "")
            # A redirect to accounts.google.com is Google saying "sign in".
            # Only the redirect *host* is reported: a full location can carry
            # identifiers, and this string is stored and shown.
            if "accounts.google.com" in location:
                results.append(f"{label}=redirected to sign-in")
                continue
            if response.status_code < 400:
                results.append(f"{label}=ok({response.status_code})")
                authenticated += 1
            else:
                results.append(f"{label}=http{response.status_code}")

    json.dump(
        {
            "alive": authenticated > 0,
            "detail": "; ".join(results),
        },
        sys.stdout,
    )


main()
