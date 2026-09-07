"""Transcribe an audio file locally. One path in, one JSON object out.

    python3 scripts/voice/transcribe.py /path/to/audio.oga

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

## `base.en` rather than something larger

A measured trade, not a guess about quality: the input is one person dictating
an instruction in English, to a phone. `base.en` handles that, and `small.en`
costs four times the compute for a difference that does not change which job
gets enqueued. If a transcript ever routes wrongly, this constant is the first
thing to raise — which is why it is a constant and why it reads from the
environment.
"""

from __future__ import annotations

import json
import os
import sys

MODEL = os.environ.get("VOICE_MODEL", "base.en")


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

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        # Named rather than swallowed: "not installed" and "it broke" need
        # different people to do different things, and the caller reports this
        # as a configuration problem rather than a failed transcription.
        die(f"faster-whisper is not installed ({exc}); run npm run setup:python")

    try:
        model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        # `vad_filter` drops the silence at either end of a phone recording,
        # which is most of a short voice note and most of its runtime.
        segments, info = model.transcribe(path, vad_filter=True, beam_size=1)
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
    })


if __name__ == "__main__":
    main()
