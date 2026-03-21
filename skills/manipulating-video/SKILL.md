---
name: manipulating-video
description: "Manipulates video files with ffmpeg — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. Use when asked to edit, convert, compress, speed up, slow down, resize, trim, merge, or transform a video file."
license: "GPL-3.0-or-Later"
metadata:
  author: o-az
  version: "1.0.0"
---

# manipulating-video

Uses `ffmpeg` to perform common video manipulations. All commands use absolute paths and capture stderr for diagnostics.

## Requirements

- **ffmpeg** (with libx264, libx265, libvpx, or equivalent codecs)
- **ffprobe** (bundled with ffmpeg)

## When to Use

- User says "speed up this video", "slow down", "make it 2x"
- User says "compress", "reduce file size", "make it smaller"
- User says "convert to gif", "make a gif", "gif from video"
- User says "convert to mp4/webm/mov", "change format"
- User says "trim", "cut", "clip", "extract segment"
- User says "resize", "scale down", "change resolution"
- User says "extract audio", "get the audio", "rip audio"
- User says "merge videos", "concatenate", "join clips"
- User says "remove audio", "mute", "strip sound"
- User says "loop", "reverse", "rotate", "stabilize"

## Rules

- Always run `ffprobe` first to inspect the input file (duration, codecs, resolution, audio presence).
- Use absolute paths for all input and output files.
- Append `2>&1` to all ffmpeg/ffprobe commands to capture diagnostics.
- If a file has no audio stream, use `-an` and avoid audio filters/mappings.
- Never overwrite the original file. Output to a new file (append suffix or use a different name).
- Use `-y` to auto-overwrite output files without prompting.
- Use hardware acceleration when available (`-hwaccel auto`).

## Instructions

### Step 0 — Inspect the input

Always start by probing the file:

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,bit_rate -of json "<INPUT>" 2>&1
```

Note whether audio streams exist — this determines whether to include audio filters/mappings.

### Speed up / slow down

Change playback speed by factor `N` (e.g., 1.5 = 50% faster, 0.5 = half speed).

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -filter_complex "[0:v]setpts=PTS/<N>[v];[0:a]atempo=<N>[a]" -map "[v]" -map "[a]" "<OUTPUT>" 2>&1
```

Note: `atempo` only accepts values between 0.5 and 100.0. For extreme slowdowns, chain multiple atempo filters: `atempo=0.5,atempo=0.5` for 0.25x.

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -filter:v "setpts=PTS/<N>" -an "<OUTPUT>" 2>&1
```

### Reduce file size / compress

Use CRF (Constant Rate Factor) — higher = smaller file, lower quality. Good defaults: 23 (balanced), 28 (smaller), 18 (higher quality).

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k "<OUTPUT>" 2>&1
```

For aggressive compression, also scale down:

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 30 -preset slow -vf "scale=iw/2:ih/2" -c:a aac -b:a 96k "<OUTPUT>" 2>&1
```

### Convert format

```bash
ffmpeg -y -i "<INPUT>" "<OUTPUT.ext>" 2>&1
```

ffmpeg infers codecs from the output extension. For specific codecs:

| Target | Flags                          |
| ------ | ------------------------------ |
| MP4    | `-c:v libx264 -c:a aac`        |
| WebM   | `-c:v libvpx-vp9 -c:a libopus` |
| MOV    | `-c:v libx264 -c:a aac`        |
| MKV    | `-c:v libx264 -c:a aac`        |

### Convert to GIF

Two-pass approach for good quality with small file size:

```bash
# Pass 1 — generate palette
ffmpeg -y -i "<INPUT>" -vf "fps=<FPS>,scale=<WIDTH>:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/palette.png 2>&1
```

```bash
# Pass 2 — render GIF using palette
ffmpeg -y -i "<INPUT>" -i /tmp/palette.png -lavfi "fps=<FPS>,scale=<WIDTH>:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" "<OUTPUT.gif>" 2>&1
```

Good defaults: `FPS=12`, `WIDTH=480`. Increase for higher quality (and larger file).

For a quick single-pass GIF (lower quality):

```bash
ffmpeg -y -i "<INPUT>" -vf "fps=10,scale=320:-1" "<OUTPUT.gif>" 2>&1
```

### Trim / extract segment

```bash
ffmpeg -y -ss <START> -to <END> -i "<INPUT>" -c copy "<OUTPUT>" 2>&1
```

`-ss` and `-to` accept `HH:MM:SS.ms` or seconds. Place `-ss` before `-i` for fast seeking.

### Resize / scale

```bash
ffmpeg -y -i "<INPUT>" -vf "scale=<WIDTH>:<HEIGHT>" -c:a copy "<OUTPUT>" 2>&1
```

Use `-1` for auto-calculated dimension: `scale=1280:-1` (width 1280, height auto). Use `-2` instead of `-1` if you get "not divisible by 2" errors.

### Extract audio

```bash
ffmpeg -y -i "<INPUT>" -vn -c:a copy "<OUTPUT.m4a>" 2>&1
```

Or re-encode: `-c:a libmp3lame -q:a 2` for MP3, `-c:a libopus -b:a 128k` for Opus.

### Remove audio

```bash
ffmpeg -y -i "<INPUT>" -an -c:v copy "<OUTPUT>" 2>&1
```

### Merge / concatenate

Create a file list:

```bash
printf "file '%s'\n" "<FILE1>" "<FILE2>" "<FILE3>" > /tmp/concat_list.txt
```

Then merge:

```bash
ffmpeg -y -f concat -safe 0 -i /tmp/concat_list.txt -c copy "<OUTPUT>" 2>&1
```

### Reverse

```bash
ffmpeg -y -i "<INPUT>" -vf reverse -af areverse "<OUTPUT>" 2>&1
```

Note: loads entire video into memory. For long videos, trim first, then reverse.

### Loop

Repeat the video N times:

```bash
ffmpeg -y -stream_loop <N-1> -i "<INPUT>" -c copy "<OUTPUT>" 2>&1
```

### Rotate

| Rotation | Flag                            |
| -------- | ------------------------------- |
| 90° CW   | `-vf "transpose=1"`             |
| 90° CCW  | `-vf "transpose=2"`             |
| 180°     | `-vf "transpose=1,transpose=1"` |

```bash
ffmpeg -y -i "<INPUT>" -vf "transpose=1" -c:a copy "<OUTPUT>" 2>&1
```

### Add subtitles (burn in)

```bash
ffmpeg -y -i "<INPUT>" -vf "subtitles='<SUBTITLE.srt>'" -c:a copy "<OUTPUT>" 2>&1
```

## Troubleshooting

- **"Stream specifier ':a' matches no streams"** — input has no audio. Use `-an` and remove audio filters/mappings.
- **"not divisible by 2"** — use `scale=W:-2` instead of `scale=W:-1`.
- **Slow encoding** — try `-preset ultrafast` for testing, then switch to `medium` or `slow` for final output.
- **Output too large** — increase CRF, reduce resolution, or lower bitrate.
