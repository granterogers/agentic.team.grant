"""Transcribe an audio file locally. One path in, one JSON object out.

    python3 scripts/voice/transcribe.py /path/to/audio.oga ["vocabulary, hints"]

## Why locally, which was not the first choice

Grant asked for voice notes: *"when I send a voice note, it's automatically
understood, transcribed or whatever. I don't need to see the transcription, but
the receiving bots need to obviously be able to work on that."*

The obvious route was the inference provider we already pay nothing for. It is
closed, and measurably so — of the three audio-capable free models OpenRouter
offers, two are gated to their own agent harness (403) and the third is refused
by our own `data_collection: 'deny'` (404). That refusal is ADR-0009's privacy
posture working exactly as intended, and a voice note is the last thing to make
an exception for: it carries Grant's actual voice.

So the audio never leaves our own compute. `faster-whisper` runs on the same
GitHub Actions runner as the worker, the model is a ~140MB download cached
between runs, and a minute of speech transcribes in a few seconds on CPU.

## The vocabulary hint

Grant sent a voice note saying "a new NotebookLM project called Wellness Legacy
course" and Whisper heard **"a new Not-to-But project"**. The Chief of Staff
then answered a question nobody had asked, because the one noun that said what
the request was about had been destroyed before she saw it.

That is not a model-size problem, it is a prior-context problem: Whisper has no
idea this installation talks about NotebookLM, Notion, Supabase and eight people
with specific names. `initial_prompt` is exactly the mechanism for telling it —
the words are treated as preceding context, which biases the decoder towards
spelling them correctly when it hears something close.

The caller assembles the list from the database (staff names, project names,
connector names), so it is current rather than a constant that goes stale the
first time someone is hired.

## `small.en`, because `base.en` was measured and found wanting

This said `base.en`, on the reasoning that one person dictating English to a
phone does not need more, and that `small.en` costs four times the compute "for
a difference that does not change which job gets enqueued". It also said that
if a transcript ever routed wrongly, this constant is the first thing to raise.

A transcript routed wrongly. Re-running Grant's actual 36-second note through
every combination gives:

    base.en,  beam 1, no hint   "a new Not-to-But project"      (what shipped)
    base.en,  beam 5, no hint   "a new not-to-boot project"
    base.en,  beam 5, hinted    "a new Notebook project" — but the tail
                                degraded: "Wellness Legacy, of course... give
                                me your thoughts on that. Access on this
                                project and from the team members."
    small.en, beam 5, no hint   "a new not to boot project"
    small.en, beam 5, hinted    "a new Notebook project called Wellness Legacy,
                                of course. Open up this project and from that
                                create a new project in Notion based around
                                that and give me your thoughts on this project
                                and from the team members."

So it takes BOTH. The hint is what recovers the proper noun — no model size
finds "Notebook" in that audio without it — and the larger model is what keeps
the rest of the sentence intact while doing so. The original trade was a
reasonable guess and it was wrong; this one is measured.
"""

from __future__ import annotations

import json
import os
import sys

MODEL = os.environ.get("VOICE_MODEL", "small.en")


def emit(payload: object) -> None:
    json.dump(payload, sys.stdout, default=str)
    sys.stdout.write("\n")
    sys.stdout.flush()


def die(message: str) -> None:
    emit({"ok": False, "error": message})
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        die("usage: transcribe.py <audio file>")
    path = sys.argv[1]
    if not os.path.exists(path):
        die(f"no such file: {path}")
    # Optional, and deliberately positional rather than a flag: there is one
    # caller and a flag would be ceremony. Empty means no hint, which is the
    # behaviour this had before.
    vocabulary = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        # Named rather than swallowed: "not installed" and "it broke" need
        # different people to do different things, and the caller reports this
        # as a configuration problem rather than a failed transcription.
        die(f"faster-whisper is not installed ({exc}); run npm run setup:python")

    try:
        model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            path,
            # `vad_filter` drops the silence at either end of a phone
            # recording, which is most of a short voice note and most of
            # its runtime.
            vad_filter=True,
            # 5, not 1. Greedy decoding was picking the first plausible
            # word and "Not-to-But" is what that sounds like. A voice note
            # is seconds of audio and this is a few seconds of CPU on a
            # runner that is otherwise idle — the cheapest accuracy
            # available.
            beam_size=5,
            initial_prompt=vocabulary or None,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    except Exception as exc:  # noqa: BLE001 - the boundary reports, never crashes
        die(f"{type(exc).__name__}: {exc}")
        return

    emit({
        "ok": True,
        "text": text,
        "language": getattr(info, "language", None),
        "seconds": round(float(getattr(info, "duration", 0.0) or 0.0), 1),
        "model": MODEL,
        # Reported so a bad transcript can be diagnosed without guessing
        # whether the hint reached it.
        "hinted": bool(vocabulary),
    })


if __name__ == "__main__":
    main()
