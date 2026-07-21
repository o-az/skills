#!/usr/bin/env -S uv run

# /// script
# requires-python = ">=3.11"
# dependencies = ["faster-whisper==1.2.1"]
# ///

import argparse
import json
import math
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol, TypedDict


class TranscriptSegment(Protocol):
    start: float
    end: float
    text: str


class TranscriptCue(TypedDict):
    start: float
    end: float
    text: str


class TranscriptPayload(TypedDict):
    language: str
    language_probability: float
    text: str
    cues: list[TranscriptCue]


def transcript_payload(
    segments: Iterable[TranscriptSegment],
    language: str,
    language_probability: float,
) -> TranscriptPayload:
    cues: list[TranscriptCue] = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        if (
            not all(
                math.isfinite(value) for value in (segment.start, segment.end)
            )
            or segment.end <= segment.start
        ):
            raise ValueError(
                f"Invalid transcript interval: {segment.start} -> {segment.end}"
            )
        cues.append({"start": segment.start, "end": segment.end, "text": text})

    if not cues:
        raise ValueError("No speech detected")

    return {
        "language": language,
        "language_probability": language_probability,
        "text": " ".join(cue["text"] for cue in cues),
        "cues": cues,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transcribe audio with language detection and timestamps."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="base")
    parser.add_argument(
        "--language",
        help="Optional ISO language code; omit to detect automatically",
    )
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(args.input),
        language=args.language,
        task="transcribe",
        beam_size=5,
        vad_filter=True,
    )
    payload = transcript_payload(
        list(segments), info.language, info.language_probability
    )
    args.output.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
