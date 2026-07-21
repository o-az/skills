#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

import argparse
import json
import math
import subprocess
import tempfile
from pathlib import Path
from typing import BinaryIO, cast

from make_ass import CaptionCue, default_font_size, probe_display_dimensions

SAMPLE_FPS = 2
SAMPLE_WIDTH = 64
SAMPLE_HEIGHT = 32
WHITE_CONTRAST_MAX_LUMINANCE = 0.183
BLACK_TEXT_MIN_LUMINANCE = 0.35


def sample_frame_indices(start: float, end: float) -> tuple[int, ...]:
    if (
        not math.isfinite(start)
        or not math.isfinite(end)
        or start < 0
        or end <= start
    ):
        raise ValueError(
            "Caption interval must be non-negative, finite, and increasing"
        )
    inset = min(0.5, (end - start) * 0.2)
    times = (start + inset, (start + end) / 2, end - inset)
    return tuple(
        dict.fromkeys(max(0, round(value * SAMPLE_FPS)) for value in times)
    )


def relative_luminances(frame: bytes) -> list[float]:
    expected = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3
    if len(frame) != expected:
        raise ValueError("Unexpected RGB frame size")
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in (channel / 255 for channel in range(256))
    ]
    return [
        0.2126 * linear[frame[index]]
        + 0.7152 * linear[frame[index + 1]]
        + 0.0722 * linear[frame[index + 2]]
        for index in range(0, len(frame), 3)
    ]


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        raise ValueError("At least one luminance sample is required")
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def choose_style(luminances: list[float]) -> str:
    if percentile(luminances, 0.9) <= WHITE_CONTRAST_MAX_LUMINANCE:
        return "Default"
    if percentile(luminances, 0.1) >= BLACK_TEXT_MIN_LUMINANCE:
        return "DarkOnLight"
    return "Boxed"


def read_exact(stream: BinaryIO, size: int) -> bytes:
    chunks = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def sampled_luminances(
    video: Path,
    required_indices: set[int],
    *,
    width: int,
    height: int,
    font_size: int,
    margin_bottom: int,
) -> dict[int, list[float]]:
    band_top = max(0, height - margin_bottom - round(font_size * 2.8))
    band_bottom = min(height, height - margin_bottom + round(font_size * 0.35))
    band_height = max(1, band_bottom - band_top)
    video_filter = (
        f"crop={width}:{band_height}:0:{band_top},"
        f"scale={SAMPLE_WIDTH}:{SAMPLE_HEIGHT}:flags=area,"
        f"fps={SAMPLE_FPS}:start_time=0:round=near,format=rgb24"
    )
    with tempfile.TemporaryFile() as error_file:
        process = subprocess.Popen(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(video),
                "-vf",
                video_filter,
                "-an",
                "-sn",
                "-f",
                "rawvideo",
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=error_file,
        )
        if process.stdout is None:
            process.kill()
            process.wait()
            raise RuntimeError("Could not open ffmpeg output pipe")

        frame_size = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3
        samples: dict[int, list[float]] = {}
        frame_index = 0
        last_frame: bytes | None = None
        stdout = cast(BinaryIO, process.stdout)
        try:
            while frame := read_exact(stdout, frame_size):
                if len(frame) != frame_size:
                    raise RuntimeError(
                        "ffmpeg returned an incomplete RGB frame"
                    )
                last_frame = frame
                if frame_index in required_indices:
                    samples[frame_index] = relative_luminances(frame)
                frame_index += 1
        except BaseException:
            if process.poll() is None:
                process.kill()
            process.wait()
            raise

        return_code = process.wait()
        error_file.seek(0)
        error = error_file.read().decode(errors="replace").strip()
    if return_code != 0:
        raise RuntimeError(error or "ffmpeg caption-background analysis failed")
    if last_frame is None:
        raise RuntimeError("ffmpeg returned no RGB frames")
    missing = required_indices - samples.keys()
    if missing:
        last_frame_index = frame_index - 1
        if any(index < last_frame_index for index in missing):
            raise RuntimeError(
                "ffmpeg omitted a required caption-background frame"
            )
        last_luminances = relative_luminances(last_frame)
        for index in missing:
            samples[index] = last_luminances
    return samples


def style_cues(
    cues: list[CaptionCue],
    samples: dict[int, list[float]],
) -> list[CaptionCue]:
    styled = []
    for cue in cues:
        indices = sample_frame_indices(cue["start"], cue["end"])
        luminances = [value for index in indices for value in samples[index]]
        styled_cue: CaptionCue = {
            "start": cue["start"],
            "end": cue["end"],
            "text": cue["text"],
            "style": choose_style(luminances),
        }
        styled.append(styled_cue)
    return styled


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Choose readable ASS caption styles from the video background."
    )
    parser.add_argument("video", type=Path)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--font-size", type=int)
    parser.add_argument("--margin-bottom", type=int, default=105)
    args = parser.parse_args()

    video = args.video.resolve(strict=True)
    parsed = json.loads(args.input.read_text(encoding="utf-8"))
    cues = parsed if isinstance(parsed, list) else parsed["cues"]
    if not cues:
        raise ValueError("At least one caption cue is required")
    dimensions = probe_display_dimensions(video)
    font_size = (
        default_font_size(dimensions["width"], dimensions["height"])
        if args.font_size is None
        else args.font_size
    )
    if font_size <= 0 or args.margin_bottom <= 0:
        raise ValueError("Font size and bottom margin must be positive")
    indices = {
        index
        for cue in cues
        for index in sample_frame_indices(cue["start"], cue["end"])
    }
    samples = sampled_luminances(
        video,
        indices,
        width=dimensions["width"],
        height=dimensions["height"],
        font_size=font_size,
        margin_bottom=args.margin_bottom,
    )
    styled = style_cues(cues, samples)
    output = styled if isinstance(parsed, list) else {**parsed, "cues": styled}
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
