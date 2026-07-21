#!/usr/bin/env -S uv run

import argparse
import json
import math
import subprocess
from pathlib import Path
from typing import BinaryIO, TypedDict, cast

from make_ass import CaptionCue, default_font_size

SAMPLE_FPS = 2
SAMPLE_WIDTH = 64
SAMPLE_HEIGHT = 32
WHITE_CONTRAST_MAX_LUMINANCE = 0.183
BLACK_TEXT_MIN_LUMINANCE = 0.35


class VideoDimensions(TypedDict):
    width: int
    height: int


def probe_dimensions(video: Path) -> VideoDimensions:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise ValueError("Video has no video stream")
    width, height = streams[0].get("width"), streams[0].get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        raise ValueError("Video dimensions are unavailable")
    if width <= 0 or height <= 0:
        raise ValueError("Video dimensions must be positive")
    return {"width": width, "height": height}


def sample_frame_indices(start: float, end: float) -> tuple[int, ...]:
    if not math.isfinite(start) or not math.isfinite(end) or end <= start:
        raise ValueError("Caption interval must be finite and increasing")
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
        stderr=subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        process.kill()
        raise RuntimeError("Could not open ffmpeg output pipes")

    frame_size = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3
    samples: dict[int, list[float]] = {}
    frame_index = 0
    stdout = cast(BinaryIO, process.stdout)
    while frame := read_exact(stdout, frame_size):
        if len(frame) != frame_size:
            process.kill()
            raise RuntimeError("ffmpeg returned an incomplete RGB frame")
        if frame_index in required_indices:
            samples[frame_index] = relative_luminances(frame)
        frame_index += 1

    error = process.stderr.read().decode(errors="replace").strip()
    if process.wait() != 0:
        raise RuntimeError(error or "ffmpeg caption-background analysis failed")
    missing = required_indices - samples.keys()
    if missing:
        raise RuntimeError(
            "Video ended before all caption backgrounds were sampled"
        )
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
    dimensions = probe_dimensions(video)
    font_size = args.font_size or default_font_size(
        dimensions["width"], dimensions["height"]
    )
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
