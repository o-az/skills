#!/usr/bin/env -S uv run

import sys

sys.dont_write_bytecode = True

from transcribe import transcript_payload


class Segment:
    def __init__(self, start: float, end: float, text: str) -> None:
        self.start = start
        self.end = end
        self.text = text


payload = transcript_payload(
    [Segment(0, 1.25, " Hello "), Segment(1.25, 2.5, " world ")],
    language="es",
    language_probability=0.97,
)

assert payload == {
    "language": "es",
    "language_probability": 0.97,
    "text": "Hello world",
    "cues": [
        {"start": 0, "end": 1.25, "text": "Hello"},
        {"start": 1.25, "end": 2.5, "text": "world"},
    ],
}

try:
    transcript_payload([], language="en", language_probability=0.5)
except ValueError as error:
    assert str(error) == "No speech detected"
else:
    raise AssertionError("Empty transcription should fail")

print("caption-video transcription checks passed")
