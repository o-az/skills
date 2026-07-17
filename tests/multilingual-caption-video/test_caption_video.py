#!/usr/bin/env -S uv run

import json
import sys
import tempfile
import time
from pathlib import Path

SCRIPTS = (
    Path(__file__).parents[2] / "skills" / "multilingual-caption-video" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
sys.dont_write_bytecode = True

from cleanup import create_workdir, keep_workdir, schedule_cleanup
from make_ass import build_ass
from preferences import load_preferences, save_preferences
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
assert payload["text"] == "Hello world"
assert payload["cues"][-1] == {"start": 1.25, "end": 2.5, "text": "world"}

try:
    transcript_payload([], language="en", language_probability=0.5)
except ValueError as error:
    assert str(error) == "No speech detected"
else:
    raise AssertionError("Empty transcription should fail")

ass = build_ass(
    [{"start": 1.25, "end": 3.5, "text": "مرحباً، يا عالم"}],
    width=1080,
    height=1920,
    font="Noto Naskh Arabic UI",
)
assert "PlayResX: 1080" in ass
assert "Style: Default,Noto Naskh Arabic UI,35," in ass
assert "Dialogue: 0,0:00:01.25,0:00:03.50" in ass

with tempfile.TemporaryDirectory() as temporary_directory:
    preferences_path = Path(temporary_directory) / "preferences.json"
    assert load_preferences(preferences_path) == {}
    saved = save_preferences(
        {"delivery": "url", "language": "Arabic", "font_size": 35},
        preferences_path,
    )
    assert saved == {"delivery": "url", "font_size": 35, "language": "Arabic"}
    assert json.loads(preferences_path.read_text()) == saved

    try:
        save_preferences({"delivery": "email"}, preferences_path)
    except ValueError as error:
        assert "delivery" in str(error)
    else:
        raise AssertionError("Unsupported delivery preference should fail")

    cleanup_root = Path(temporary_directory) / "cleanup"
    cleanup_root.mkdir()

    doomed = create_workdir(cleanup_root)
    (doomed / "asset.mp4").touch()
    schedule_cleanup(doomed, delay=0)
    for _ in range(100):
        if not doomed.exists():
            break
        time.sleep(0.01)
    assert not doomed.exists()

    kept = create_workdir(cleanup_root)
    keep_workdir(kept)
    schedule_cleanup(kept, delay=0)
    time.sleep(0.1)
    assert kept.exists()

print("multilingual-caption-video checks passed")
