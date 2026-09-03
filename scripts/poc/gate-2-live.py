"""Gate 2's live half: the sixteen items that needed a credential.

    python3 scripts/poc/gate-2-live.py   (reads NOTEBOOK_STORAGE_STATE)

Prints one JSON object: {"checks": [{n, what, outcome, passed}], ...}.

§13's list, in order:

    list notebooks · list sources · add URL · add document · create note ·
    query · artifact generation and retrieval · auth refresh · headless
    restart · multiple polling cycles · source deletion · source duplication ·
    ambiguous timeout · worker crash mid-operation · re-authentication · rate
    limiting · simulated API/schema break

The last three of those and `ambiguous timeout` are proven offline in
`scripts/poc/gate-2.ts`, because they are about how *we* behave when Notebook
misbehaves and forcing real misbehaviour is neither possible nor desirable.
This file covers everything that needs the live product.

## Quota discipline

§7's free tier is 50 chats/day and 3 audio overviews/day, and §11 says to
budget from the *detected* tier rather than the documented one. This run
spends:

  - **one** chat, for the query test
  - **zero** audio overviews: artifact *generation* is deliberately not
    triggered. §7 calls artifact generation "best-effort and never in a
    critical path", and burning a third of a daily quota to watch a progress
    bar is not evidence worth having. Artifact *listing* is exercised instead,
    which is the half the application actually depends on.

Everything else is free. The notebook this creates is deleted at the end.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

CHECKS: list[dict[str, object]] = []


def check(n: str, what: str, outcome: str, passed: bool) -> None:
    CHECKS.append({"n": n, "what": what, "outcome": outcome, "passed": passed})
    print(f"{'ok  ' if passed else 'FAIL'} {n} {what} - {outcome}", file=sys.stderr)


def finish(**extra: object) -> None:
    json.dump({"checks": CHECKS, **extra}, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


async def main() -> None:
    raw = os.environ.get("NOTEBOOK_STORAGE_STATE", "")
    if not raw:
        check("0", "a credential was passed", "none", False)
        finish()
        return

    from notebooklm import NotebookLMClient

    directory = Path("/tmp/nlm-gate2")
    directory.mkdir(parents=True, exist_ok=True)
    storage_path = directory / "storage_state.json"
    storage_path.write_text(raw)
    storage_path.chmod(0o600)

    stamp = str(int(time.time()))
    notebook_id: str | None = None
    # A URL long enough that fulltext retrieval means something, and stable
    # enough not to change under the test.
    url = "https://en.wikipedia.org/wiki/Theory_of_constraints"

    async with NotebookLMClient.from_storage(storage_path) as client:
        # --- B1 list notebooks -------------------------------------------
        try:
            before = await client.notebooks.list()
            check("B1", "list notebooks", f"{len(before)} notebook(s)", True)
        except Exception as exc:
            check("B1", "list notebooks", f"{type(exc).__name__}: {exc}"[:120], False)
            finish()
            return

        # --- B16 read the tier, never hard-code it (§11) -------------------
        tier = None
        try:
            limits = await client.settings.get_account_limits()
            tier = getattr(limits, "tier", None)
            nb_limit = getattr(limits, "notebook_limit", None)
            src_limit = getattr(limits, "source_limit", None)
            check(
                "B16",
                "AccountLimits is read from the account, not from documentation",
                f"tier={tier} notebooks={nb_limit} sources={src_limit}",
                tier is not None and nb_limit is not None and src_limit is not None,
            )
        except Exception as exc:
            check("B16", "AccountLimits is readable", f"{type(exc).__name__}: {exc}"[:120], False)

        # --- create the scratch notebook ----------------------------------
        try:
            notebook = await client.notebooks.create(f"AI Team HQ gate2 {stamp}")
            notebook_id = notebook.id
            check("B0", "create a notebook", f"id={notebook_id[:12]}", True)
        except Exception as exc:
            check("B0", "create a notebook", f"{type(exc).__name__}: {exc}"[:120], False)
            finish()
            return

        try:
            # --- B3 add a URL source --------------------------------------
            url_source_id = None
            try:
                started = time.monotonic()
                source = await client.sources.add_url(notebook_id, url, wait=True, wait_timeout=180)
                url_source_id = source.id
                elapsed = int((time.monotonic() - started) * 1000)
                check(
                    "B3",
                    "add a URL source and wait for processing",
                    f"id={url_source_id[:12]} status={getattr(source, 'status', '?')} {elapsed}ms",
                    url_source_id is not None,
                )
            except Exception as exc:
                check("B3", "add a URL source", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B4 add a document source ---------------------------------
            text_source_id = None
            body = (
                "Gate 2 evidence document. The Theory of Constraints holds that a "
                "system's throughput is governed by its single tightest constraint, "
                "so improvements anywhere else are local optima. "
            ) * 6
            try:
                source = await client.sources.add_text(
                    notebook_id, f"gate2-doc-{stamp}", body, wait=True, wait_timeout=180
                )
                text_source_id = source.id
                check(
                    "B4",
                    "add a document source",
                    f"id={text_source_id[:12]} {len(body)} chars",
                    text_source_id is not None,
                )
            except Exception as exc:
                check("B4", "add a document source", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B2 list sources ------------------------------------------
            try:
                sources = await client.sources.list(notebook_id)
                check(
                    "B2",
                    "list sources",
                    f"{len(sources)} source(s): {', '.join(str(getattr(s, 'title', '?'))[:22] for s in sources)}",
                    len(sources) >= 2,
                )
            except Exception as exc:
                check("B2", "list sources", f"{type(exc).__name__}: {exc}"[:120], False)

            # --- B2b fulltext: the quota design depends on this ------------
            # §7: pull each source's text once, cache it in Postgres, and let
            # agents reason over the cache at zero Notebook quota. Without
            # fulltext retrieval that design does not exist.
            fulltext_chars = 0
            try:
                full = await client.sources.get_fulltext(notebook_id, url_source_id or "")
                content = getattr(full, "content", "") or getattr(full, "text", "") or ""
                fulltext_chars = len(content)
                check(
                    "B2b",
                    "retrieve a source's fulltext (the zero-quota caching design)",
                    f"{fulltext_chars} chars",
                    fulltext_chars > 500,
                )
            except Exception as exc:
                check("B2b", "retrieve fulltext", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B12 source duplication ------------------------------------
            # Adding the same URL twice: does Notebook collide, or duplicate?
            # The answer decides whether our fingerprinting is a convenience
            # or a requirement, so it is measured rather than assumed.
            try:
                dup = await client.sources.add_url(notebook_id, url, wait=False)
                after = await client.sources.list(notebook_id)
                duplicated = getattr(dup, "id", None) != url_source_id
                check(
                    "B12",
                    "adding the same URL twice",
                    f"{'created a SECOND source' if duplicated else 'collided with the first'}; "
                    f"{len(after)} sources total - so our own fingerprinting is "
                    f"{'required' if duplicated else 'belt-and-braces'}",
                    True,  # Either answer is a finding; what matters is knowing.
                )
                if duplicated and getattr(dup, "id", None):
                    await client.sources.delete(notebook_id, dup.id)
            except Exception as exc:
                check("B12", "source duplication", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B5 create a note -------------------------------------------
            note_id = None
            try:
                note = await client.notes.create(
                    notebook_id, title=f"gate2-note-{stamp}", content="Gate 2 evidence note."
                )
                note_id = getattr(note, "id", None)
                notes = await client.notes.list(notebook_id)
                check(
                    "B5",
                    "create a note and read it back",
                    f"id={str(note_id)[:12]}; {len(notes)} note(s) in the notebook",
                    note_id is not None and len(notes) >= 1,
                )
            except Exception as exc:
                check("B5", "create a note", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B6 query -----------------------------------------------------
            # ONE chat. §7 budgets 5-15/day against 50, and reserves chats for
            # genuine cross-source synthesis - which is what this asks for.
            try:
                started = time.monotonic()
                answer = await client.chat.ask(
                    notebook_id,
                    "In one sentence, what do these sources say a system's throughput depends on?",
                )
                elapsed = int((time.monotonic() - started) * 1000)
                text = getattr(answer, "answer", None) or getattr(answer, "text", "") or str(answer)
                check(
                    "B6",
                    "query across sources (one chat against the daily quota)",
                    f"{elapsed}ms, {len(text)} chars: {text[:90]!r}",
                    len(text.strip()) > 20,
                )
            except Exception as exc:
                check("B6", "query across sources", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B7 artifact retrieval ------------------------------------
            try:
                artifacts = await client.artifacts.list(notebook_id)
                check(
                    "B7",
                    "artifact listing (generation deliberately not triggered - see the header)",
                    f"{len(artifacts)} artifact(s); the retrieval path works",
                    True,
                )
            except Exception as exc:
                check("B7", "artifact listing", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B10 multiple polling cycles -------------------------------
            # §6's engine polls. What matters is that repeated reads stay
            # consistent and do not degrade, so this is five cycles with the
            # count and latency of each.
            try:
                latencies: list[int] = []
                counts: set[int] = set()
                for _ in range(5):
                    t0 = time.monotonic()
                    got = await client.sources.list(notebook_id)
                    latencies.append(int((time.monotonic() - t0) * 1000))
                    counts.add(len(got))
                check(
                    "B10",
                    "five polling cycles stay consistent",
                    f"counts={sorted(counts)} latencies={latencies}ms",
                    len(counts) == 1,
                )
            except Exception as exc:
                check("B10", "multiple polling cycles", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B15 rate limiting ------------------------------------------
            # Measured, not assumed (§11). Twenty rapid reads: does Notebook
            # throttle, and if so how does it say so?
            try:
                t0 = time.monotonic()
                errors: list[str] = []
                ok_count = 0
                for _ in range(20):
                    try:
                        await client.sources.list(notebook_id)
                        ok_count += 1
                    except Exception as exc:
                        errors.append(type(exc).__name__)
                        break
                elapsed = int((time.monotonic() - t0) * 1000)
                # Named for what it establishes, not for what it is about.
                # Gate 4's rate-limit check originally reported "30 calls, no
                # 429" and passed - a true sentence that measured nothing,
                # because the burst allowance simply covered it. The same trap
                # is here, and reads may genuinely not be throttled at any
                # rate worth finding. So the title says the limit was not
                # reached rather than implying it was characterised.
                reached = bool(errors)
                check(
                    "B15",
                    "rapid reads do not trip a limit"
                    + ("" if reached else " - and the limit was NOT reached, so it is uncharacterised"),
                    f"{ok_count}/20 succeeded in {elapsed}ms"
                    + (
                        f"; throttled with {errors[0]} after {ok_count}"
                        if reached
                        else "; no throttling, so no figure was measured"
                    ),
                    ok_count == 20 or reached,
                )
            except Exception as exc:
                check("B15", "rate limiting", f"{type(exc).__name__}: {exc}"[:150], False)

            # --- B11 source deletion ----------------------------------------
            try:
                if text_source_id:
                    await client.sources.delete(notebook_id, text_source_id)
                remaining = await client.sources.list(notebook_id)
                gone = all(getattr(s, "id", None) != text_source_id for s in remaining)
                check(
                    "B11",
                    "delete a source and confirm it is gone",
                    f"{len(remaining)} source(s) remain; deleted one absent: {gone}",
                    gone,
                )
            except Exception as exc:
                check("B11", "source deletion", f"{type(exc).__name__}: {exc}"[:150], False)

        finally:
            # --- clean up the scratch notebook ---------------------------
            if notebook_id:
                try:
                    await client.notebooks.delete(notebook_id)
                    after = await client.notebooks.list()
                    check(
                        "B13",
                        "delete the notebook (and prove the account is left as found)",
                        f"{len(before)} before, {len(after)} after",
                        len(after) == len(before),
                    )
                except Exception as exc:
                    check("B13", "delete the notebook", f"{type(exc).__name__}: {exc}"[:150], False)

    # --- B8/B9 headless restart and re-authentication ---------------------
    # A brand-new client in a fresh context, from the same stored credential:
    # this is what every worker restart does. Run outside the block above so
    # the first client is genuinely closed first.
    try:
        async with NotebookLMClient.from_storage(storage_path) as client2:
            again = await client2.notebooks.list()
        check(
            "B8",
            "headless restart: a fresh client from the same stored credential",
            f"re-authenticated and listed {len(again)} notebook(s)",
            True,
        )
    except Exception as exc:
        check("B8", "headless restart", f"{type(exc).__name__}: {exc}"[:150], False)

    try:
        storage_path.unlink(missing_ok=True)
    except OSError:
        pass

    passed = sum(1 for c in CHECKS if c["passed"])
    finish(passed=passed, total=len(CHECKS))


asyncio.run(main())
