#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

import argparse
import json
import math
import subprocess
from pathlib import Path
from typing import NotRequired, TypedDict

CAPTION_STYLES = {"Default", "DarkOnLight", "Boxed"}


class CaptionCue(TypedDict):
    start: float
    end: float
    text: str
    style: NotRequired[str]


class VideoDimensions(TypedDict):
    width: int
    height: int


def probe_display_dimensions(video: Path) -> VideoDimensions:
    video = video.resolve(strict=True)
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:stream_side_data=rotation",
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
    stream = streams[0]
    width, height = stream.get("width"), stream.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        raise TypeError("Video dimensions are unavailable")
    if width <= 0 or height <= 0:
        raise ValueError("Video dimensions must be positive")

    rotation = 0
    for side_data in stream.get("side_data_list", []):
        candidate = side_data.get("rotation")
        if (
            isinstance(candidate, (int, float))
            and not isinstance(candidate, bool)
            and math.isfinite(candidate)
        ):
            rotation = round(candidate) % 360
            break
    if rotation not in {0, 90, 180, 270}:
        raise ValueError(f"Unsupported video rotation: {rotation} degrees")
    if rotation in {90, 270}:
        width, height = height, width
    return {"width": width, "height": height}


def ass_time(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02}:{whole_seconds:02}.{fraction:02}"


def ass_text(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\r\n", "\n")
        .replace("\n", "\\N")
    )


def default_font_size(width: int, height: int) -> int:
    return max(16, round(min(width, height) * 0.075))


def build_ass(
    cues: list[CaptionCue],
    *,
    width: int = 1920,
    height: int = 1080,
    font: str = "Arial",
    font_size: int | None = None,
    margin_bottom: int = 105,
    margin_horizontal: int = 12,
) -> str:
    if not cues:
        raise ValueError("At least one caption cue is required")
    if "," in font or "\n" in font or "\r" in font:
        raise ValueError("Font name contains invalid characters")
    resolved_font_size = (
        default_font_size(width, height) if font_size is None else font_size
    )
    if not all(
        isinstance(value, int) and not isinstance(value, bool) and value > 0
        for value in (
            width,
            height,
            resolved_font_size,
            margin_bottom,
            margin_horizontal,
        )
    ):
        raise ValueError(
            "ASS dimensions, font size, and margin must be positive integers"
        )

    dialogue = []
    for cue in cues:
        start, end, text = cue.get("start"), cue.get("end"), cue.get("text")
        style = cue.get("style", "Default")
        if (
            not isinstance(start, (int, float))
            or isinstance(start, bool)
            or not isinstance(end, (int, float))
            or isinstance(end, bool)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end <= start
        ):
            raise ValueError(f"Invalid caption interval: {cue!r}")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Caption text cannot be empty")
        if style not in CAPTION_STYLES:
            raise ValueError(f"Unsupported caption style: {style!r}")
        dialogue.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},{style},,0,0,0,,{ass_text(text.strip())}"
        )

    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{resolved_font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,{margin_horizontal},{margin_horizontal},{margin_bottom},1
Style: DarkOnLight,{font},{resolved_font_size},&H00000000,&H000000FF,&H00FFFFFF,&H80FFFFFF,-1,0,0,0,100,100,0,0,1,3,1,2,{margin_horizontal},{margin_horizontal},{margin_bottom},1
Style: Boxed,{font},{resolved_font_size},&H00FFFFFF,&H000000FF,&H60000000,&H60000000,-1,0,0,0,100,100,0,0,3,8,0,2,{margin_horizontal},{margin_horizontal},{margin_bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{"\n".join(dialogue)}
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create styled ASS subtitles from caption JSON."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--video", type=Path)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--font", default="Arial")
    parser.add_argument("--font-size", type=int)
    parser.add_argument("--margin-bottom", type=int, default=105)
    parser.add_argument("--margin-horizontal", type=int, default=12)
    args = parser.parse_args()

    if args.video is not None:
        if args.width is not None or args.height is not None:
            parser.error("--video cannot be combined with --width or --height")
        dimensions = probe_display_dimensions(args.video)
    elif (args.width is None) != (args.height is None):
        parser.error("--width and --height must be provided together")
    else:
        dimensions = {
            "width": 1920 if args.width is None else args.width,
            "height": 1080 if args.height is None else args.height,
        }

    parsed = json.loads(args.input.read_text(encoding="utf-8"))
    cues = parsed if isinstance(parsed, list) else parsed["cues"]
    args.output.write_text(
        build_ass(
            cues,
            width=dimensions["width"],
            height=dimensions["height"],
            font=args.font,
            font_size=args.font_size,
            margin_bottom=args.margin_bottom,
            margin_horizontal=args.margin_horizontal,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
