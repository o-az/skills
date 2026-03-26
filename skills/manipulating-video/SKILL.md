---
name: manipulating-video
description: "Manipulates video files with ffmpeg — speed up/slow down, resize, compress, convert formats, extract audio, convert to GIF, trim, merge, and more. Use when asked to edit, convert, compress, speed up, slow down, resize, trim, merge, or transform a video file."
license: "GPL-3.0-or-Later"
compatibility: Requires ffmpeg (with libx264, libx265, libvpx, or equivalent codecs) and ffprobe
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
- User says "loop", "reverse", or "rotate"

## Rules

- Always run `ffprobe` first to inspect the input file.
- Use absolute paths for all input and output files.
- Append `2>&1` to all `ffmpeg` and `ffprobe` commands to capture diagnostics.
- Never overwrite the original file. Write to a new file.
- Use `-y` to avoid interactive overwrite prompts.
- Only use audio filters, mappings, or codecs when the file actually has an audio stream.
- Prefer safe generic defaults over container- or codec-dependent shortcuts.
- If you use a faster but less accurate method, tell the user.

## Agent Checklist

Use this order every time:

1. Probe the input with `ffprobe`.
2. Determine whether the file has audio.
3. Choose a new output path.
4. Decide whether the user needs a fast copy-based transform or an accurate re-encoded transform.
5. Run the command with `2>&1`.
6. Tell the user exactly which file you wrote.

## Output Naming

Prefer predictable suffixes so the user can find the result:

| Request       | Suggested output        |
| ------------- | ----------------------- |
| Compress      | `<name>_compressed.mp4` |
| GIF           | `<name>.gif`            |
| Remove audio  | `<name>_muted.mp4`      |
| Extract audio | `<name>.m4a`            |
| Trim clip     | `<name>_trimmed.mp4`    |
| Resize        | `<name>_resized.mp4`    |

## Instructions

### Step 0 — Inspect the input

Always start here:

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,bit_rate -of json "<INPUT>" 2>&1
```

Record whether the input has an audio stream before choosing a command.

### Speed up / slow down

Change playback speed by factor `N` such as `2.0` or `0.5`.

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -filter_complex "[0:v]setpts=PTS/<N>[v];[0:a]atempo=<N>[a]" -map "[v]" -map "[a]" "<OUTPUT>" 2>&1
```

If `N` falls outside what a single `atempo` supports, chain multiple `atempo` filters.

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -filter:v "setpts=PTS/<N>" -an "<OUTPUT>" 2>&1
```

### Reduce file size / compress

Safe generic default.

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k "<OUTPUT>" 2>&1
```

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 28 -preset medium -an "<OUTPUT>" 2>&1
```

For aggressive compression, also scale down:

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 30 -preset slow -vf "scale=iw/2:ih/2" -c:a aac -b:a 96k "<OUTPUT>" 2>&1
```

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -c:v libx264 -crf 30 -preset slow -vf "scale=iw/2:ih/2" -an "<OUTPUT>" 2>&1
```

### Convert format

```bash
ffmpeg -y -i "<INPUT>" "<OUTPUT.ext>" 2>&1
```

Use explicit codecs when the user requests a specific target format or broad compatibility.

ffmpeg infers codecs from the output extension. For specific codecs:

| Target | Flags                          |
| ------ | ------------------------------ |
| MP4    | `-c:v libx264 -c:a aac`        |
| WebM   | `-c:v libvpx-vp9 -c:a libopus` |
| MOV    | `-c:v libx264 -c:a aac`        |
| MKV    | `-c:v libx264 -c:a aac`        |

### Convert to GIF

Use the two-pass palette workflow for the default high-quality path.

```bash
# Pass 1 — generate palette
ffmpeg -y -i "<INPUT>" -vf "fps=<FPS>,scale=<WIDTH>:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/palette.png 2>&1
```

```bash
# Pass 2 — render GIF using palette
ffmpeg -y -i "<INPUT>" -i /tmp/palette.png -lavfi "fps=<FPS>,scale=<WIDTH>:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" "<OUTPUT.gif>" 2>&1
```

Good defaults: `FPS=12`, `WIDTH=480`.

### Trim / extract segment

Use one of these two modes depending on the user's need.

**Fast trim, not frame-accurate:**

```bash
ffmpeg -y -ss <START> -to <END> -i "<INPUT>" -c copy "<OUTPUT>" 2>&1
```

**Accurate trim with audio, re-encodes output:**

```bash
ffmpeg -y -ss <START> -to <END> -i "<INPUT>" -c:v libx264 -c:a aac "<OUTPUT>" 2>&1
```

**Accurate trim without audio, re-encodes output:**

```bash
ffmpeg -y -ss <START> -to <END> -i "<INPUT>" -c:v libx264 -an "<OUTPUT>" 2>&1
```

Use the accurate version when the user cares about exact cut points.

### Resize / scale

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -vf "scale=<WIDTH>:<HEIGHT>" -c:a copy "<OUTPUT>" 2>&1
```

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -vf "scale=<WIDTH>:<HEIGHT>" -an "<OUTPUT>" 2>&1
```

Use `-2` instead of `-1` when you need ffmpeg to keep dimensions even.

### Extract audio

Choose the method based on whether container/codec compatibility matters.

**Most reliable default: re-encode audio**

```bash
ffmpeg -y -i "<INPUT>" -vn -c:a aac -b:a 192k "<OUTPUT.m4a>" 2>&1
```

**Only when the source codec is already compatible with the destination container: stream copy**

```bash
ffmpeg -y -i "<INPUT>" -vn -c:a copy "<OUTPUT>" 2>&1
```

If the user wants MP3 instead, use:

```bash
ffmpeg -y -i "<INPUT>" -vn -c:a libmp3lame -q:a 2 "<OUTPUT.mp3>" 2>&1
```

### Remove audio

Check Step 0 first. If the input already has no audio stream, tell the user no mute transform is needed and avoid running a redundant command.

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

**With audio:**

```bash
ffmpeg -y -i "<INPUT>" -vf reverse -af areverse "<OUTPUT>" 2>&1
```

**Without audio:**

```bash
ffmpeg -y -i "<INPUT>" -vf reverse -an "<OUTPUT>" 2>&1
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
