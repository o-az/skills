#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

import io
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from http.client import HTTPMessage
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.request import Request

SCRIPTS = (
    Path(__file__).parents[2]
    / "skills"
    / "multilingual-caption-video"
    / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
sys.dont_write_bytecode = True

from cleanup import create_workdir, keep_workdir, schedule_cleanup
from deliver import (
    default_downloads_directory,
    deliver_video,
    normalized_language_code,
)
from download import (
    LiveStreamFilter,
    PublicRedirectHandler,
    direct_video_stem,
    direct_video_suffix,
    download_options,
    download_video,
    reject_live_video,
    validate_video_url,
)
from make_ass import build_ass, default_font_size, probe_display_dimensions
from preferences import (
    default_preferences_path,
    load_preferences,
    save_preferences,
)
from style_captions import (
    SAMPLE_HEIGHT,
    SAMPLE_WIDTH,
    choose_style,
    sample_frame_indices,
    sampled_luminances,
    style_cues,
)
from transcribe import transcript_payload


class Segment:
    def __init__(self, start: float, end: float, text: str) -> None:
        self.start = start
        self.end = end
        self.text = text


for script in SCRIPTS.glob("*.py"):
    source = script.read_text(encoding="utf-8")
    assert source.startswith("#!/usr/bin/env -S uv run --script\n")
    assert '# requires-python = ">=3.12"' in source
    assert "# dependencies = [" in source

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

try:
    transcript_payload(
        [Segment(-0.1, 0.5, "Invalid")],
        language="en",
        language_probability=1,
    )
except ValueError:
    pass
else:
    raise AssertionError("Negative transcription timestamps should fail")

ass = build_ass(
    [{"start": 1.25, "end": 3.5, "text": "مرحباً، يا عالم"}],
    width=1080,
    height=1920,
    font="Noto Naskh Arabic UI",
)
assert "PlayResX: 1080" in ass
assert default_font_size(1080, 1920) == 81
assert default_font_size(1920, 1080) == 81
assert "Style: Default,Noto Naskh Arabic UI,81," in ass
assert "Style: DarkOnLight,Noto Naskh Arabic UI,81," in ass
assert "Style: Boxed,Noto Naskh Arabic UI,81," in ass
assert ",2,12,12,105,1" in ass
assert "Dialogue: 0,0:00:01.25,0:00:03.50" in ass

adaptive_ass = build_ass(
    [
        {
            "start": 1.25,
            "end": 3.5,
            "text": "Adaptive style",
            "style": "DarkOnLight",
        }
    ]
)
assert "Dialogue: 0,0:00:01.25,0:00:03.50,DarkOnLight" in adaptive_ass

custom_ass = build_ass(
    [{"start": 1.25, "end": 3.5, "text": "Custom style"}],
    font_size=35,
    margin_bottom=70,
    margin_horizontal=40,
)
assert "Style: Default,Arial,35," in custom_ass
assert ",2,40,40,70,1" in custom_ass

try:
    build_ass([{"start": -0.1, "end": 1, "text": "Invalid"}])
except ValueError:
    pass
else:
    raise AssertionError("Negative ASS timestamps should fail")

assert choose_style([0.05, 0.1, 0.15]) == "Default"
assert choose_style([0.4, 0.7, 0.95]) == "DarkOnLight"
assert choose_style([0.02, 0.5, 0.95]) == "Boxed"
indices = sample_frame_indices(1.0, 3.0)
assert indices == (3, 4, 5)
styled = style_cues(
    [{"start": 1.0, "end": 3.0, "text": "Visible"}],
    {index: [0.5] for index in indices},
)
assert styled[0].get("style") == "DarkOnLight"

try:
    sample_frame_indices(-0.1, 1)
except ValueError:
    pass
else:
    raise AssertionError("Negative style-sampling timestamps should fail")

with tempfile.TemporaryDirectory() as temporary_directory:
    rotated_video = Path(temporary_directory) / "rotated.mp4"
    rotated_video.touch()
    probe_result = subprocess.CompletedProcess(
        args=[],
        returncode=0,
        stdout=json.dumps(
            {
                "streams": [
                    {
                        "width": 320,
                        "height": 180,
                        "side_data_list": [{"rotation": 90}],
                    }
                ]
            }
        ),
    )
    with patch("make_ass.subprocess.run", return_value=probe_result):
        assert probe_display_dimensions(rotated_video) == {
            "width": 180,
            "height": 320,
        }


class FakeFfmpegProcess:
    def __init__(self, frames: bytes) -> None:
        self.stdout = io.BytesIO(frames)
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode

    def wait(self) -> int:
        self.returncode = 0
        return self.returncode

    def kill(self) -> None:
        self.returncode = -9


frame_size = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3
fake_process = FakeFfmpegProcess(bytes([255]) * frame_size * 4)


def fake_popen(*args: object, **kwargs: object) -> FakeFfmpegProcess:
    del args
    assert kwargs["stderr"] != subprocess.PIPE
    return fake_process


with patch("style_captions.subprocess.Popen", side_effect=fake_popen):
    end_samples = sampled_luminances(
        Path("video.mp4"),
        {3, 4},
        width=320,
        height=180,
        font_size=16,
        margin_bottom=20,
    )
assert end_samples[4] == end_samples[3]

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
    "default": "/tmp/caption-video.test/%(title).120B [%(id)s].%(ext)s"
}
assert options["windowsfilenames"] is True

assert direct_video_suffix("https://example.com/Video.MP4?token=1") == ".mp4"
assert direct_video_suffix("https://example.com/watch/123") is None
assert direct_video_stem("https://example.com/My%20Video%3F.mp4") == "My-Video"

live_filter = LiveStreamFilter()
live_options = download_options(download_workdir, live_filter)
assert live_options["match_filter"] is live_filter
assert reject_live_video({"is_live": True}) == "Live streams are not supported"
assert reject_live_video({"live_status": "is_upcoming"}) == (
    "Live streams are not supported"
)
assert reject_live_video({"live_status": "was_live"}) is None

try:
    PublicRedirectHandler().redirect_request(
        Request("https://8.8.8.8/video.mp4"),
        io.BytesIO(),
        302,
        "Found",
        HTTPMessage(),
        "http://127.0.0.1/internal.mp4",
    )
except ValueError:
    pass
else:
    raise AssertionError(
        "A direct-video redirect to a private host should fail"
    )

with tempfile.TemporaryDirectory() as temporary_directory:
    dispatch_workdir = create_workdir(Path(temporary_directory))
    direct_result = dispatch_workdir / "video.mp4"
    with (
        patch("download.validate_video_url", side_effect=lambda url: url),
        patch(
            "download.download_direct_video", return_value=direct_result
        ) as direct_download,
        patch("download.download_platform_video") as platform_download,
    ):
        assert (
            download_video("https://example.com/video.mp4", dispatch_workdir)
            == direct_result
        )
        direct_download.assert_called_once()
        platform_download.assert_not_called()

    platform_result = dispatch_workdir / "platform.mp4"
    with (
        patch("download.validate_video_url", side_effect=lambda url: url),
        patch("download.download_direct_video") as direct_download,
        patch(
            "download.download_platform_video", return_value=platform_result
        ) as platform_download,
    ):
        assert (
            download_video("https://example.com/watch/123", dispatch_workdir)
            == platform_result
        )
        direct_download.assert_not_called()
        platform_download.assert_called_once()

assert normalized_language_code("EN_us") == "en-us"
try:
    normalized_language_code("English")
except ValueError:
    pass
else:
    raise AssertionError("A language name should not be accepted as a code")

fake_winreg = SimpleNamespace(
    HKEY_CURRENT_USER=object(),
    OpenKey=MagicMock(side_effect=OSError("Downloads folder unavailable")),
    QueryValueEx=MagicMock(),
)
with (
    patch("deliver.sys.platform", "win32"),
    patch.dict(sys.modules, {"winreg": fake_winreg}),
    patch("deliver.Path.home", return_value=Path("/Users/example")),
):
    assert default_downloads_directory() == Path("/Users/example/Desktop")

with tempfile.TemporaryDirectory() as temporary_directory:
    delivery_directory = Path(temporary_directory)
    rendered = delivery_directory / "rendered.mp4"
    rendered.write_bytes(b"video")
    downloads = delivery_directory / "Downloads"
    delivered = deliver_video(
        rendered,
        "AR",
        destination=downloads,
        timestamp=datetime(2026, 7, 31, 2, 52, 58, tzinfo=UTC),
    )
    assert delivered.name == "ar_2026-07-31_02.52.58.mp4"
    assert delivered.read_bytes() == b"video"
    duplicate = deliver_video(
        rendered,
        "ar",
        destination=downloads,
        timestamp=datetime(2026, 7, 31, 2, 52, 58, tzinfo=UTC),
    )
    assert duplicate.name == "ar_2026-07-31_02.52.59.mp4"
    assert delivered.read_bytes() == b"video"

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
    preferences_path.write_text('{"delivery": "url", "language": "Arabic"}\n')
    assert load_preferences(preferences_path) == {"language": "Arabic"}
    saved = save_preferences(
        {"language": "Arabic", "font_size": 35},
        preferences_path,
    )
    assert saved == {"font_size": 35, "language": "Arabic"}
    assert json.loads(preferences_path.read_text()) == saved

    try:
        save_preferences({"delivery": "url"}, preferences_path)
    except ValueError as error:
        assert "delivery" in str(error)
    else:
        raise AssertionError("Removed delivery preference should fail")

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
