"""Write actions against NotebookLM, one JSON object in and one out.

    python3 scripts/notebook/act.py <action> '<json args>'

Read operations live in `read.py`; this is deliberately a separate file because
the two carry different risk. A read that fails costs a retry. A write that
half-succeeds leaves something in Grant's notebook that nothing in Postgres
knows about, and the notebook has no transactions to roll it back with.

## The actions, and why these

Grant: *"the Python binding is specifically there so that through Claude you can
tell it to generate an audio overview, a presentation, all the stuff that the
notebook does."* NotebookLM's value is that it GENERATES — audio overviews,
slide decks, video, mind maps, reports. Notion stores; the notebook produces.
So the actions are the productive ones plus what is needed to feed them.

    add_text / add_url   put a source in, so there is something to generate from
    create_note          write a conclusion back where Grant will read it
    generate             audio | slides | video | mindmap | report | infographic
    ask                  ask the notebook about its own sources

## Why generation does not wait

Every artifact here takes minutes. Blocking an MCP tool call for four minutes is
a tool call that times out in every client, so `generate` starts the work and
returns the artifact id; `poll` reports on it. That is a worse interface than
one call and it is the honest one — the alternative is an interface that appears
to work and fails on the first real audio overview.

## Errors say which action failed

Every failure carries the action name. A bare "SourceProcessingError" in an MCP
client's context is a model apologising without knowing what for.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path


def emit(payload: object) -> None:
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    sys.stdout.flush()


def die(action: str, message: str, **extra: object) -> None:
    emit({"ok": False, "action": action, "error": message, **extra})
    sys.exit(1)


# Phrases Google uses when the answer is "not now" rather than "no".
#
# Matched on the message because the library raises `RateLimitError` for some
# refusals and a generic `RPCError` carrying a USER_DISPLAYABLE_ERROR for
# others, and from our side both mean the same thing: stop asking, come back
# when the window turns over. Missing one costs a job that retries into a wall;
# a false positive costs a deferral, which is recoverable.
QUOTA_PHRASES = (
    "usage limit",
    "limit reached",
    "quota",
    "rate limit",
    "resource_exhausted",
    "too many requests",
    "try again later",
    "generate later",
)


def looks_like_quota(message: str) -> bool:
    lowered = message.lower()
    return any(phrase in lowered for phrase in QUOTA_PHRASES)


# Artifact kinds, mapped to the library's generator. Named here rather than
# accepted from the caller, so an MCP client cannot reach an arbitrary method.
GENERATORS = {
    "audio": "generate_audio",
    "slides": "generate_slide_deck",
    "video": "generate_video",
    "mindmap": "generate_mind_map",
    "report": "generate_report",
    "infographic": "generate_infographic",
    "quiz": "generate_quiz",
    "flashcards": "generate_flashcards",
    "study_guide": "generate_study_guide",
}


async def main() -> None:
    if len(sys.argv) < 2:
        die(
            "(none)",
            "usage: act.py <add_text|add_url|create_note|create_notebook|generate|"
            "poll|retry|artifacts|sources|ask|delete_source|delete_artifact> '<json>'",
        )
    action = sys.argv[1]

    # Arguments come from argv when they are small and from STDIN when they are
    # not. `add_text` carries whole documents, and argv has a hard ceiling —
    # a 180kb source produced
    #
    #     OSError: [Errno 7] Argument list too long: '/var/lang/bin/python'
    #
    # which looks like a Google failure and is the operating system refusing to
    # exec. stdin has no such limit. argv stays supported because every other
    # caller uses it and the payloads there are a few hundred bytes.
    raw_args = sys.argv[2] if len(sys.argv) > 2 else ""
    if raw_args == "-":
        raw_args = sys.stdin.read()
    try:
        args = json.loads(raw_args) if raw_args.strip() else {}
    except json.JSONDecodeError as exc:
        die(action, f"arguments are not valid JSON: {exc}")

    raw = os.environ.get("NOTEBOOK_STORAGE_STATE", "")
    if not raw:
        die(action, "NOTEBOOK_STORAGE_STATE is not set")

    from notebooklm import NotebookLMClient

    directory = Path(os.environ.get("NOTEBOOK_STORAGE_DIR", "/tmp/nlm-act"))
    directory.mkdir(parents=True, exist_ok=True)
    storage_path = directory / "storage_state.json"
    storage_path.write_text(raw)
    storage_path.chmod(0o600)

    notebook = args.get("notebook_id")
    if not notebook:
        die(action, "notebook_id is required")

    try:
        async with NotebookLMClient.from_storage(storage_path) as client:
            if action == "add_text":
                text = args.get("text") or ""
                if not text.strip():
                    die(action, "text is empty; refusing to add an empty source")
                # `add_text(notebook_id, title, content)` — title BEFORE
                # content, and both positional. Read from the signature rather
                # than guessed: the first version passed `title=` as a keyword
                # alongside a positional and got "multiple values for argument
                # 'title'", which is the same mistake probe.py's header already
                # records having made once.
                source = await client.sources.add_text(
                    notebook, args.get("title") or "Added by AI Team HQ", text
                )
                emit({
                    "ok": True,
                    "action": action,
                    "source_id": getattr(source, "id", None),
                    "title": getattr(source, "title", None),
                })
                return

            if action == "add_url":
                url = args.get("url") or ""
                if not url.startswith("http"):
                    die(action, "url must be http(s)")
                source = await client.sources.add_url(notebook, url)
                emit({
                    "ok": True,
                    "action": action,
                    "source_id": getattr(source, "id", None),
                    "title": getattr(source, "title", None),
                })
                return

            if action == "create_note":
                content = args.get("content") or ""
                if not content.strip():
                    die(action, "content is empty; refusing to create an empty note")
                # `create(notebook_id, title, content)`, same shape as add_text.
                note = await client.notes.create(
                    notebook, args.get("title") or "From AI Team HQ", content
                )
                emit({"ok": True, "action": action, "note_id": getattr(note, "id", None)})
                return

            if action == "generate":
                kind = args.get("kind") or ""
                method_name = GENERATORS.get(kind)
                if method_name is None:
                    die(action, f"unknown kind {kind!r}; one of {', '.join(sorted(GENERATORS))}")
                method = getattr(client.artifacts, method_name)
                kwargs = {}
                if args.get("instructions"):
                    # Every generator takes `instructions`; checked against the
                    # signatures rather than assumed, because the last thing
                    # assumed here cost two failed writes.
                    kwargs["instructions"] = args["instructions"]
                started = await method(notebook, **kwargs)
                # A generator returns `GenerationStatus`, whose fields are
                # `task_id`, `status`, `url`, `error` — NOT an Artifact with an
                # `id`. Reading `.id` returned None and the caller happily
                # reported "generation started" with nothing to poll: a
                # plausible success that could never be followed up.
                emit({
                    "ok": True,
                    "action": action,
                    "kind": kind,
                    "task_id": getattr(started, "task_id", None),
                    "url": getattr(started, "url", None),
                    "error": getattr(started, "error", None),
                    "state": str(getattr(started, "status", "") or "generating"),
                    # Said plainly: these take minutes, and a caller that waits
                    # in-band times out in every MCP client there is. Poll by
                    # LISTING the notebook's artifacts, which is why the reply
                    # carries no artifact id — there is not one yet.
                    "note": "generation started; list the notebook's artifacts to follow it",
                })
                return

            if action == "retry":
                # `retry_failed(notebook_id, artifact_id)`. Wired up because the
                # library has had it all along and nothing called it, so a failed
                # artifact was a dead end — the only recovery was generating a
                # new one, which costs the allowance twice and loses whatever
                # instructions the first carried.
                #
                # It IS a generation as far as the meter and 0083's approval gate
                # are concerned, and both sit upstream of this file.
                artifact_id = args.get("artifact_id")
                if not artifact_id:
                    die(action, "artifact_id is required")
                started = await client.artifacts.retry_failed(notebook, artifact_id)
                emit({
                    "ok": True,
                    "action": action,
                    "artifact_id": artifact_id,
                    "task_id": getattr(started, "task_id", None),
                    "state": str(getattr(started, "status", "") or "generating"),
                    "error": getattr(started, "error", None),
                })
                return

            if action == "poll":
                artifact_id = args.get("artifact_id")
                if not artifact_id:
                    die(action, "artifact_id is required")
                # `get(notebook_id, artifact_id)`: an artifact id alone is not
                # addressable, which is why poll needs the notebook too.
                artifact = await client.artifacts.get(notebook, artifact_id)
                # `status_str` and the `is_*` properties, never the raw integer.
                # The library says so in as many words — *"read via .status_str
                # / .is_*, not by integer"* — and it is right for a reason we
                # found the hard way: the wire codes for PENDING and PROCESSING
                # were transposed in an earlier release, and a caller with its
                # own code table would have read "generating" as "queued"
                # without noticing. Ours read 2 as finished and announced a
                # slide deck that did not exist.
                emit({
                    "ok": True,
                    "action": action,
                    "artifact_id": artifact_id,
                    "state": str(getattr(artifact, "status_str", "") or "unknown"),
                    "done": bool(getattr(artifact, "is_completed", False)),
                    "failed": bool(getattr(artifact, "is_failed", False)),
                    "title": getattr(artifact, "title", None),
                    "url": getattr(artifact, "url", None),
                })
                return

            if action == "notebooks":
                # Read before creating. Nothing looked, once, and Grant ended
                # up with two notebooks called the same thing.
                emit({
                    "ok": True,
                    "action": action,
                    "notebooks": [
                        {"notebook_id": getattr(n, "id", None), "title": getattr(n, "title", None)}
                        for n in await client.notebooks.list()
                    ],
                })
                return

            if action == "create_notebook":
                title = args.get("title") or ""
                if not title.strip():
                    die(action, "title is required")
                nb = await client.notebooks.create(title.strip())
                emit({
                    "ok": True,
                    "action": action,
                    "notebook_id": getattr(nb, "id", None),
                    "title": getattr(nb, "title", None),
                })
                return

            if action == "delete_source":
                # Destructive, and the only destructive action here. Guarded by
                # requiring the caller to name the exact source id: there is no
                # "delete by title" and no "delete all", because the failure
                # mode of a wildcard against Grant's own notebook is not
                # recoverable from our side.
                source_id = args.get("source_id")
                if not source_id:
                    die(action, "source_id is required")
                await client.sources.delete(notebook, source_id)
                emit({"ok": True, "action": action, "source_id": source_id})
                return

            if action == "delete_artifact":
                artifact_id = args.get("artifact_id")
                if not artifact_id:
                    die(action, "artifact_id is required")
                await client.artifacts.delete(notebook, artifact_id)
                emit({"ok": True, "action": action, "artifact_id": artifact_id})
                return

            if action == "sources":
                # Read, and here rather than in read.py because the tidy tool
                # needs to see a source and delete it in one session, and
                # splitting that across two processes means two logins.
                items = await client.sources.list(notebook)
                out = []
                for src in items:
                    entry = {
                        "source_id": getattr(src, "id", None),
                        "title": getattr(src, "title", None),
                        "status": str(getattr(src, "status", "") or ""),
                    }
                    if args.get("with_text"):
                        try:
                            full = await client.sources.get_fulltext(notebook, entry["source_id"])
                            body = getattr(full, "content", "") or ""
                            entry["chars"] = len(body)
                            entry["opening"] = body[:400]
                        except Exception as exc:  # noqa: BLE001
                            entry["opening"] = f"(could not read: {type(exc).__name__})"
                    out.append(entry)
                emit({"ok": True, "action": action, "sources": out})
                return

            if action == "artifacts":
                # What is in the notebook now, which is how a caller follows a
                # generation it started: the generator hands back a task, and
                # the artifact appears here when Google has made it.
                items = await client.artifacts.list(notebook)
                emit({
                    "ok": True,
                    "action": action,
                    "artifacts": [
                        {
                            "artifact_id": getattr(a, "id", None),
                            "title": getattr(a, "title", None),
                            # The library's own ArtifactType, not the wire
                            # integer behind it. Ours read "8" and "5" out of a
                            # table built by looking at Grant's notebook; the
                            # library maps the codes AND their variants, and
                            # knows that type 4 is a quiz, a flashcard set or an
                            # interactive mind map depending on the variant.
                            "kind": str(getattr(getattr(a, "kind", None), "value", "") or "unknown"),
                            "type": str(getattr(a, "_artifact_type", "") or ""),
                            # Named states and explicit booleans, for the reason
                            # `poll` gives above. `status` stays a WORD here.
                            "status": str(getattr(a, "status_str", "") or "unknown"),
                            "done": bool(getattr(a, "is_completed", False)),
                            "failed": bool(getattr(a, "is_failed", False)),
                            "created_at": getattr(a, "created_at", None),
                        }
                        for a in items
                    ],
                })
                return

            if action == "download":
                """
                The bytes of a finished artifact.

                Issue #66. Grant: *"maybe bring that audio file into the
                dashboard project, and just directly have the audio file sent
                to me on Telegram that I can play it directly rather than
                having to open notebook."* Everything up to "the notebook has
                an artifact" existed; nothing could get the artifact OUT.

                The library exposes this differently across versions and this
                is the one place that has to know. Each candidate is tried and
                the FIRST that yields bytes wins; if none does, the action says
                so by name rather than returning an empty file — a zero-byte
                audio overview sent to Telegram would look like a delivery
                that worked.
                """
                artifact_id = args.get("artifact_id") or ""
                if not artifact_id:
                    die(action, "artifact_id is required")

                items = await client.artifacts.list(notebook)
                target = next((a for a in items if str(getattr(a, "id", "")) == artifact_id), None)
                if target is None:
                    die(action, f"no artifact {artifact_id} in this notebook")
                if not bool(getattr(target, "is_completed", False)):
                    die(action, f"artifact is {getattr(target, 'status_str', 'not ready')}")

                blob = None
                tried = []
                for name in ("download", "fetch", "content", "bytes"):
                    fn = getattr(client.artifacts, name, None)
                    if fn is None:
                        continue
                    tried.append(name)
                    try:
                        got = fn(notebook, artifact_id)
                        blob = await got if hasattr(got, "__await__") else got
                        if blob:
                            break
                    except Exception as exc:  # noqa: BLE001 - the reason is the point
                        tried[-1] = f"{name}({type(exc).__name__})"
                        blob = None

                # A share URL is the other shape the library offers, and it is
                # enough: the caller can fetch it itself.
                url = None
                for attr in ("share_url", "url", "audio_url", "media_url"):
                    value = getattr(target, attr, None)
                    if isinstance(value, str) and value.startswith("http"):
                        url = value
                        break

                if blob is None and url is None:
                    die(action,
                        "this notebooklm-py exposes no way to fetch an artifact; "
                        f"tried {', '.join(tried) or 'nothing'} and found no share url")

                emit({
                    "ok": True,
                    "action": action,
                    "artifact_id": artifact_id,
                    "title": getattr(target, "title", None),
                    "kind": str(getattr(getattr(target, "kind", None), "value", "") or "unknown"),
                    "url": url,
                    # Base64 so it survives the JSON envelope every other action
                    # already uses. Only when there are bytes and no URL — a URL
                    # is smaller to pass and the caller can stream it.
                    "base64": (
                        __import__("base64").b64encode(blob).decode()
                        if blob is not None and url is None else None
                    ),
                    "byte_size": len(blob) if blob is not None else None,
                })
                return

            if action == "ask":
                question = args.get("question") or ""
                if not question.strip():
                    die(action, "question is empty")
                answer = await client.chat.ask(notebook, question)
                # `AskResult.answer`, not `.text`. Falling back to `str()`
                # returned the dataclass repr — "AskResult(answer='This
                # notebook…" — which is not wrong so much as embarrassing in a
                # model's context, and it would have shipped unnoticed because
                # a repr containing the answer still reads like an answer.
                text = getattr(answer, "answer", None) or getattr(answer, "text", None)
                emit({
                    "ok": True,
                    "action": action,
                    "answer": text if isinstance(text, str) else str(answer),
                    "citations": len(getattr(answer, "citations", None) or []),
                })
                return

            die(action, f"unknown action {action!r}")
    except Exception as exc:  # noqa: BLE001 - the boundary reports, never crashes
        # The action name travels with the error. A bare exception class in an
        # MCP client's context is a model apologising without knowing what for.
        #
        # And "you are out of quota" travels as a FLAG rather than as prose,
        # because the caller does something different about it: it defers the
        # work to the next window instead of retrying into the same wall, and
        # it records the refusal as a measurement of where the ceiling really
        # is. A quota refusal read as a generic failure is five wasted retries
        # and no lesson learned.
        text = f"{type(exc).__name__}: {exc}"
        try:
            from notebooklm import RateLimitError

            rate_limited = isinstance(exc, RateLimitError)
        except ImportError:
            rate_limited = False
        die(action, text, quota=bool(rate_limited or looks_like_quota(text)))


if __name__ == "__main__":
    asyncio.run(main())
