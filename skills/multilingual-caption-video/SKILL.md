---
name: multilingual-caption-video
description: "Burn translated captions into a local video or video URL and deliver the finished MP4 as a file or shareable link. Use when a user asks to subtitle, caption, translate, or hardcode subtitles into a video in a specified language."
license: "GPL-3.0-or-Later"
compatibility: Requires ffmpeg and ffprobe with libass and H.264 support, uv, yt-dlp for URL inputs, and curl for URL delivery.
metadata:
  author: o-az
  version: "1.1.0"
---

# multilingual-caption-video

Transcribe the video's spoken language, translate the timestamped transcript into the requested language, burn readable subtitles into a new MP4, verify the result, and deliver either the file or a shareable URL.

## Requirements

- `ffmpeg` and `ffprobe` with libass and H.264 support
- `uv`
- `yt-dlp` for URL inputs
- `curl` for URL delivery
- Network access for the transcription model, URL downloads, and uploads

The transcription helper uses `faster-whisper==1.2.1` with the multilingual Whisper `base` model. The first run installs the pinned Python dependency and downloads the model into the normal `uv` and Hugging Face caches.

## Bundled scripts

- `scripts/transcribe.py` detects the spoken language, transcribes the video, and emits timestamped JSON.
- `scripts/make_ass.py` converts translated caption JSON into styled ASS subtitles.
- `scripts/preferences.py` reads and, only with explicit user consent, saves sparse JSON preferences.
- `scripts/cleanup.py` creates marked work directories and safely schedules or cancels their deletion.

Run any script with `uv run <script> --help` for its interface.

## Rules

- Accept either an explicit local video path or an explicit `http://` or `https://` video URL.
- Reject URL targets that resolve to loopback, private, link-local, or cloud-metadata addresses.
- Never overwrite or delete the source video.
- Do not attach cookies, credentials, or authentication headers when downloading a URL unless the user explicitly requests it.
- Preserve meaning and timing. Do not summarize, censor, embellish, or invent speech.
- Keep each caption concise, on screen long enough to read, and at no more than two lines.
- Default to font size 35 when neither the request nor saved preferences specify a size. Always honor an explicit user choice.
- Use a font that covers the target script. For Arabic, prefer `Noto Naskh Arabic UI`, then `Noto Sans Arabic`, then another installed Arabic-capable font.
- Deliver only the generated MP4. A request for a URL authorizes uploading that generated file, not unrelated local files.
- Write preferences only after explicit consent. An explicit request always overrides a saved preference for that job.
- Delete only marked working directories created by `scripts/cleanup.py`.

## Workflow

### 1. Resolve preferences and required inputs

Resolve the directory containing this `SKILL.md` as `SKILL_ROOT`, then inspect saved preferences:

```bash
uv run "$SKILL_ROOT/scripts/preferences.py" show
```

Preferences live at `${XDG_CONFIG_HOME:-~/.config}/multilingual-caption-video/preferences.json`. The file may contain `delivery`, `language`, `font`, and `font_size`.

Resolve each setting in this order: the current request, a saved preference, then the documented default. If neither the request nor saved preferences specify `delivery`, ask whether the user wants the finished video as a file or URL. If neither specifies the target language, ask for it. Do not infer either choice.

Ask whether the user wants the resolved choices saved for future jobs. Save only the fields the user explicitly consents to persist:

```bash
uv run "$SKILL_ROOT/scripts/preferences.py" set --delivery file --language Arabic --font-size 35
```

If the user declines, do not write the preferences file. Ask again on future jobs whenever a required choice is absent.

### 2. Create an isolated work directory

```bash
WORK_DIR="$(uv run "$SKILL_ROOT/scripts/cleanup.py" create)"
```

Keep all downloaded and generated assets inside this directory. Keep the source outside it when the user supplied a local file.

### 3. Resolve and inspect the source

For a local file, resolve its absolute path and verify it is a regular video file. For a URL, accept only an explicit user-provided HTTP(S) URL and download one video:

```bash
yt-dlp --no-playlist --merge-output-format mp4 -o "$WORK_DIR/source.%(ext)s" "<VIDEO_URL>"
```

Find the downloaded file, then probe the source:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of json "<SOURCE>"
```

Stop with a clear error when the source has no video stream or no audio stream.

### 4. Detect the source language and transcribe

```bash
uv run "$SKILL_ROOT/scripts/transcribe.py" "<SOURCE>" "$WORK_DIR/transcript.json"
```

Omit `--language` to detect the spoken language. When the source language is known, pass its ISO code, for example `--language es`. Stop with a clear error when transcription returns no speech cues.

The output schema is:

```json
{
  "language": "es",
  "language_probability": 0.97,
  "text": "Full source-language transcript",
  "cues": [{ "start": 0, "end": 2.4, "text": "Timestamped source text" }]
}
```

### 5. Translate the cues

Translate every cue into the requested language and write `$WORK_DIR/captions.json` using the same `cues` schema. Preserve each cue's numeric `start` and `end` values exactly unless adjacent cues must be merged for readability. When merging cues, use the first cue's start and the last cue's end.

Keep names, numbers, tone, and meaning accurate. When the source already uses the target language, edit only for caption readability instead of translating it through another language.

### 6. Generate ASS subtitles

Read the video width and height from `ffprobe`. Check an appropriate installed font with `fc-match` when available. For Arabic, start with:

```bash
fc-match "Noto Naskh Arabic UI"
```

Generate the subtitle file using the font size resolved in step 1:

```bash
uv run "$SKILL_ROOT/scripts/make_ass.py" "$WORK_DIR/captions.json" "$WORK_DIR/captions.ass" --width <WIDTH> --height <HEIGHT> --font "<FONT>" --font-size <FONT_SIZE>
```

### 7. Burn captions into a new MP4

Run `ffmpeg` from the work directory so the subtitle filter receives a simple path:

```bash
cd "$WORK_DIR"
ffmpeg -y -i "<SOURCE>" -vf "ass=captions.ass" -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k -movflags +faststart captioned.mp4
```

### 8. Verify visually and structurally

Probe the result and compare its duration and dimensions with the source:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of json "$WORK_DIR/captioned.mp4"
```

Extract at least one frame during speech and inspect it with an available image or vision tool:

```bash
ffmpeg -y -ss <SPEECH_TIMESTAMP> -i "$WORK_DIR/captioned.mp4" -frames:v 1 "$WORK_DIR/caption-preview.png"
```

Confirm that captions are present, correctly shaped, legible, inside the safe area, and no more than two lines; video and audio both play; duration and dimensions match the source; and the source remains unchanged. Fix the caption data or style and render again when verification fails.

### 9. Deliver the requested form

For `file`, use the current platform's file-delivery or attachment capability and do not upload. For `url`, upload the generated MP4 to the configured video-capable host. When no uploader is configured, use `pstbn.dev`:

```bash
curl --fail-with-body --silent --show-error --request POST --form "file=@$WORK_DIR/captioned.mp4" https://pstbn.dev
```

Validate that an upload response is an HTTP(S) URL. Return only the requested delivery form unless the user asks for both. Include the target language, and do not claim completion without a successful probe and visual inspection.

### 10. Announce and schedule cleanup

Only after successful delivery, tell the user: “I will clean up the working files and delete the local assets five minutes from now. Let me know before then if you want me to keep them.” Then schedule cleanup:

```bash
uv run "$SKILL_ROOT/scripts/cleanup.py" schedule "$WORK_DIR" --delay 300
```

If the user asks to retain the assets before deletion, cancel cleanup by creating the keep marker:

```bash
uv run "$SKILL_ROOT/scripts/cleanup.py" keep "$WORK_DIR"
```

On failure, retain the working directory only long enough to report or diagnose the error, then safely delete it with the cleanup helper. Never apply cleanup to the user's source file or an unmarked directory.
