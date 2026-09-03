"""Probe NotebookLM with the vaulted credential and report what actually works.

    npm run notebook:probe

Python rather than TypeScript because the adapter library is Python and §7's
rule is a strict `NotebookAdapter` boundary, not a strict language. Re-writing
NotebookLM's private RPC protocol in TypeScript to keep the stack uniform would
mean maintaining an undocumented wire format by hand - which is exactly the
risk §7 says to contain behind an adapter, not to take on.

Output is a single JSON object on stdout, which the TypeScript side records as
a capability probe. Nothing else is printed to stdout, so the caller can parse
it without pattern-matching log lines.

The state this reports is `available_unofficial` at best, never `available`.
§7 lists them as different states for a reason: the private RPC path working
today carries no stability promise, and calling that `available` would hide
the exact risk the adapter boundary exists to contain.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def emit(payload: dict[str, object]) -> None:
    """One JSON object on stdout, then stop."""
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(state: str, detail: str, **extra: object) -> None:
    emit({"state": state, "capabilities": [], "detail": detail, **extra})
    sys.exit(0)  # Not an error: reporting unavailability IS the job.


storage_raw = os.environ.get("NOTEBOOK_STORAGE_STATE", "")
if not storage_raw:
    fail("auth_required", "no credential was passed to the probe")

try:
    import notebooklm
    from notebooklm import auth as nl_auth
    from notebooklm import NotebookLMClient
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    fail("unavailable", f"notebooklm is not importable: {exc}")

version = getattr(notebooklm, "__version__", "unknown")

# The library reads a storage_state.json from disk. Written to a private
# temporary path rather than the default profile location so a probe never
# disturbs a real profile, and unlinked in the finally block below.
storage_path = Path(os.environ.get("NOTEBOOK_STORAGE_PATH", "/tmp/nlm-probe/storage_state.json"))
storage_path.parent.mkdir(parents=True, exist_ok=True)
storage_path.write_text(storage_raw)
storage_path.chmod(0o600)

started = time.monotonic()
capabilities: list[str] = []
tier: int | None = None
notebook_limit: int | None = None
source_limit: int | None = None

try:
    try:
        tokens = nl_auth.load_auth_from_storage(storage_path)
    except Exception as exc:
        fail(
            "auth_required",
            f"the credential did not load: {type(exc).__name__}: {exc}"[:300],
            adapter_version=version,
        )

    client = NotebookLMClient(tokens, storage_path=storage_path)

    # Capability 1: can we list at all? This is the cheapest real call and the
    # one that distinguishes "signed in" from "has a cookie file".
    try:
        notebooks = client.list_notebooks()
        capabilities.append("list_notebooks")
    except Exception as exc:
        name = type(exc).__name__
        # An auth failure and an outage need different responses, so they are
        # reported as different states rather than one generic failure.
        state = "auth_required" if "Auth" in name or "401" in str(exc) else "unavailable"
        fail(
            state,
            f"list_notebooks failed: {name}: {exc}"[:300],
            adapter_version=version,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    # Capability 2: the account's real limits. §11 is explicit that these are
    # read, never hard-coded - "Google changes them without updating its own
    # published tables". A failure here is DEGRADED, not fatal: we can work
    # without knowing the tier, we just cannot budget against it.
    try:
        limits = client.get_account_limits()
        tier = getattr(limits, "tier", None)
        notebook_limit = getattr(limits, "notebook_limit", None)
        source_limit = getattr(limits, "source_limit", None)
        capabilities.append("account_limits")
    except Exception:
        pass

    # Capability 3: reading a notebook's sources, which is what the whole
    # quota design depends on - pull each source's text once, cache it, and
    # reason over the cache at zero Notebook quota.
    first = notebooks[0] if notebooks else None
    if first is not None:
        try:
            client.list_sources(first.id)
            capabilities.append("list_sources")
        except Exception:
            pass

    latency_ms = int((time.monotonic() - started) * 1000)

    # DEGRADED when the basics work but something expected did not. Reporting
    # `available_unofficial` while a capability is missing would be the same
    # error as calling a stored credential a working one.
    state = "available_unofficial" if "list_notebooks" in capabilities else "degraded"
    if first is not None and "list_sources" not in capabilities:
        state = "degraded"

    emit(
        {
            "state": state,
            "capabilities": capabilities,
            "adapter_version": version,
            "detected_tier": tier,
            "notebook_limit": notebook_limit,
            "source_limit": source_limit,
            "notebook_count": len(notebooks),
            # The account, so it is obvious in the probe history if a personal
            # account was used by mistake. An email address, never a token.
            "account": getattr(tokens, "account_email", None),
            "detail": (
                f"{len(notebooks)} notebook(s); capabilities: {', '.join(capabilities)}"
            ),
            "latency_ms": latency_ms,
        }
    )
finally:
    # The credential does not stay on disk after the probe.
    try:
        storage_path.unlink(missing_ok=True)
    except OSError:
        pass
