---
name: multilingual-caption-video
description: Burn translated captions into a local video or video URL and return a shareable MP4 link. Use when a user asks to subtitle, caption, translate, or hardcode subtitles into a video in a specified language.
---

# multilingual-caption-video

Transcribe the video's spoken language, translate the transcript into the requested language while preserving timestamps, render readable subtitles into a new MP4, verify the result, and upload only the generated video.

## Requirements

- `ffmpeg` and `ffprobe` with libass and H.264 support
- `uv` and `node`
- `yt-dlp` for URL inputs
- `curl` for uploading
- Network access for the transcription model, URL downloads, and upload

The transcription helper uses `faster-whisper==1.2.1` with the multilingual Whisper `base` model. The first run installs the pinned Python dependency and downloads the model into the normal `uv` and Hugging Face caches.

## Bundled scripts

- `scripts/transcribe.py` — Detect the spoken language, transcribe the video, and emit timestamped JSON. Run `uv run scripts/transcribe.py --help` for its interface.
- `scripts/make-ass.mjs` — Convert translated caption JSON into styled ASS subtitles. The default font size is 26.
- `scripts/test_transcribe.py` and `scripts/test.mjs` — Run the deterministic helper checks with `uv run scripts/test_transcribe.py` and `node scripts/test.mjs`.

## Rules

- Accept either an explicit local video path or an explicit `http://` or `https://` video URL plus a target language.
- Reject URL targets that resolve to loopback, private, link-local, or cloud-metadata addresses.
- Never overwrite the source video.
- Do not attach cookies, credentials, or authentication headers when downloading a URL unless the user explicitly requests it.
- Preserve meaning and timing. Do not summarize, censor, embellish, or invent speech.
- Keep each caption concise, on screen long enough to read, and at no more than two lines.
- Default to font size 26. Change it only when the user requests another size or a sample frame proves it unreadable.
- Use a font that covers the target script. For Arabic, prefer `Noto Naskh Arabic UI`, then `Noto Sans Arabic`, then another installed Arabic-capable font.
- Upload only the generated MP4. A request for a returned link authorizes uploading that generated file, not unrelated local files.

## Workflow

### 1. Create an isolated work directory

Resolve the directory containing this `SKILL.md` as `SKILL_ROOT`, then create a working directory:

```bash
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/caption-video.XXXXXX")"
```

Keep the directory until the user has received and checked the result.

### 2. Resolve and inspect the source

For a local file, resolve its absolute path and verify it is a regular video file. For a URL, accept only an explicit user-provided HTTP(S) URL and download one video:

```bash
yt-dlp --no-playlist --merge-output-format mp4 -o "$WORK_DIR/source.%(ext)s" "<VIDEO_URL>"
```

Find the downloaded file, then probe the source:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of json "<SOURCE>"
```

Stop with a clear error when the source has no video stream or no audio stream.

### 3. Detect the source language and transcribe

```bash
uv run "$SKILL_ROOT/scripts/transcribe.py" "<SOURCE>" "$WORK_DIR/transcript.json"
```

Omit `--language` to detect the spoken language. When the source language is known, pass its ISO code, for example `--language es`.
Stop with a clear error when transcription returns no speech cues.

The output schema is:

```json
{
  "language": "es",
  "language_probability": 0.97,
  "text": "Full source-language transcript",
  "cues": [{ "start": 0, "end": 2.4, "text": "Timestamped source text" }]
}
```

### 4. Translate the cues

Translate every cue into the requested language and write `$WORK_DIR/captions.json` using the same `cues` schema. Preserve each cue's numeric `start` and `end` values exactly unless adjacent cues must be merged for readability. When merging cues, use the first cue's start and the last cue's end.

Keep names, numbers, tone, and meaning accurate. When the source already uses the target language, edit only for caption readability instead of translating it through another language.

### 5. Generate ASS subtitles

Read the video width and height from `ffprobe`. Check an appropriate installed font with `fc-match` when available. For Arabic, start with:

```bash
fc-match "Noto Naskh Arabic UI"
```

Generate the subtitle file:

```bash
node "$SKILL_ROOT/scripts/make-ass.mjs" "$WORK_DIR/captions.json" "$WORK_DIR/captions.ass" --width <WIDTH> --height <HEIGHT> --font "<FONT>" --font-size 26
```

### 6. Burn captions into a new MP4

Run `ffmpeg` from the work directory so the subtitle filter receives a simple path:

```bash
cd "$WORK_DIR"
ffmpeg -y -i "<SOURCE>" -vf "ass=captions.ass" -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k -movflags +faststart captioned.mp4
```

### 7. Verify visually and structurally

Probe the result and compare its duration and dimensions with the source:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of json "$WORK_DIR/captioned.mp4"
```

Extract at least one frame during speech and inspect it with an available image or vision tool:

```bash
ffmpeg -y -ss <SPEECH_TIMESTAMP> -i "$WORK_DIR/captioned.mp4" -frames:v 1 "$WORK_DIR/caption-preview.png"
```

Confirm that:

- captions are present, correctly shaped, legible, and inside the safe area;
- no caption exceeds two lines;
- video and audio both play;
- duration and dimensions match the source;
- the source file remains unchanged.

Fix the caption data or style and render again when verification fails.

### 8. Upload and return the link

Upload the generated MP4 to the configured video-capable host. When no uploader is configured, use `pstbn.dev`:

```bash
curl --fail-with-body --silent --show-error --request POST --form "file=@$WORK_DIR/captioned.mp4" https://pstbn.dev
```

Validate that the response is an HTTP(S) URL. Return the shareable URL, target language, and local output path. Do not claim completion without a successful probe and visual inspection.
