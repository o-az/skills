#!/usr/bin/env -S uv run

import argparse
import json
import math
from pathlib import Path
from typing import TypedDict


class CaptionCue(TypedDict):
    start: float
    end: float
    text: str


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
        if (
            not isinstance(start, (int, float))
            or isinstance(start, bool)
            or not isinstance(end, (int, float))
            or isinstance(end, bool)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or end <= start
        ):
            raise ValueError(f"Invalid caption interval: {cue!r}")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Caption text cannot be empty")
        dialogue.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{ass_text(text.strip())}"
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
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--font", default="Arial")
    parser.add_argument("--font-size", type=int)
    parser.add_argument("--margin-bottom", type=int, default=105)
    parser.add_argument("--margin-horizontal", type=int, default=12)
    args = parser.parse_args()

    parsed = json.loads(args.input.read_text(encoding="utf-8"))
    cues = parsed if isinstance(parsed, list) else parsed["cues"]
    args.output.write_text(
        build_ass(
            cues,
            width=args.width,
            height=args.height,
            font=args.font,
            font_size=args.font_size,
            margin_bottom=args.margin_bottom,
            margin_horizontal=args.margin_horizontal,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
