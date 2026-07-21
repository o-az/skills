#!/usr/bin/env -S uv run

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

SCRIPTS = (
    Path(__file__).parents[2]
    / "skills"
    / "multilingual-caption-video"
    / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
sys.dont_write_bytecode = True

from cleanup import create_workdir, keep_workdir, schedule_cleanup
from download import download_options, validate_video_url
from make_ass import build_ass
from preferences import (
    default_preferences_path,
    load_preferences,
    save_preferences,
)
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

assert validate_video_url("https://8.8.8.8/video.mp4") == (
    "https://8.8.8.8/video.mp4"
)
for unsafe_url in (
    "file:///tmp/video.mp4",
    "https://user:password@example.com/video.mp4",
    "http://127.0.0.1/video.mp4",
    "http://169.254.169.254/latest/meta-data/",
):
    try:
        validate_video_url(unsafe_url)
    except ValueError:
        pass
    else:
        raise AssertionError(f"Unsafe video URL should fail: {unsafe_url}")

download_workdir = Path("/tmp/caption-video.test")
options = download_options(download_workdir)
assert options["noplaylist"] is True
assert options["merge_output_format"] == "mp4"
assert options["outtmpl"] == {
    "default": "/tmp/caption-video.test/source.%(ext)s"
}

cleanup_script = SCRIPTS / "cleanup.py"
with tempfile.TemporaryDirectory() as temporary_directory:
    unsupported_parent = subprocess.run(
        [
            sys.executable,
            str(cleanup_script),
            "create",
            "--parent",
            temporary_directory,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert unsupported_parent.returncode != 0
    assert "unrecognized arguments: --parent" in unsupported_parent.stderr

original_xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
try:
    with tempfile.TemporaryDirectory() as temporary_directory:
        absolute_config_home = Path(temporary_directory)
        os.environ["XDG_CONFIG_HOME"] = str(absolute_config_home)
        assert default_preferences_path() == (
            absolute_config_home
            / "multilingual-caption-video"
            / "preferences.json"
        )

    for invalid_config_home in ("", "relative/config"):
        os.environ["XDG_CONFIG_HOME"] = invalid_config_home
        assert default_preferences_path() == (
            Path.home()
            / ".config"
            / "multilingual-caption-video"
            / "preferences.json"
        )
finally:
    if original_xdg_config_home is None:
        os.environ.pop("XDG_CONFIG_HOME", None)
    else:
        os.environ["XDG_CONFIG_HOME"] = original_xdg_config_home

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

    victim_path = Path(temporary_directory) / "victim.txt"
    victim_path.write_text("unchanged\n")
    predictable_temporary_path = preferences_path.with_suffix(".tmp")
    predictable_temporary_path.symlink_to(victim_path)
    save_preferences({"language": "Spanish"}, preferences_path)
    assert victim_path.read_text() == "unchanged\n"
    assert predictable_temporary_path.is_symlink()

    destination_target = Path(temporary_directory) / "destination-target.json"
    destination_target.write_text('{"language": "English"}\n')
    preferences_path.unlink()
    preferences_path.symlink_to(destination_target)
    save_preferences({"language": "Arabic"}, preferences_path)
    assert not preferences_path.is_symlink()
    assert destination_target.read_text() == '{"language": "English"}\n'

    failed_preferences_path = (
        Path(temporary_directory) / "failed" / "preferences.json"
    )
    with patch("preferences.os.replace", side_effect=OSError("replace failed")):
        try:
            save_preferences({"language": "French"}, failed_preferences_path)
        except OSError as error:
            assert str(error) == "replace failed"
        else:
            raise AssertionError("A failed preferences replacement should fail")
    assert list(failed_preferences_path.parent.glob("*.tmp")) == []

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
