---
name: multilingual-caption-video
description: "Burn translated captions into a local video or video URL and deliver the finished MP4 as a file or shareable link. Use when a user asks to subtitle, caption, translate, or hardcode subtitles into a video in a specified language."
license: "GPL-3.0-or-Later"
compatibility: Requires uv and FFmpeg with libass and libx264 support. URL delivery requires a platform uploader or curl.
metadata:
  author: o-az
  version: "1.1.1"
---

# multilingual-caption-video

Transcribe the video's spoken language, translate the timestamped transcript into the requested language, burn readable subtitles into a new MP4, verify the result, and deliver either the file or a shareable URL.

## Requirements

- `uv`
- FFmpeg with libass and libx264 support
- A platform upload capability or `curl` only when URL delivery is requested
- Network access for the transcription model, URL downloads, and uploads

The bundled Python scripts declare their own dependencies using inline script metadata. `uv run --script` resolves them automatically; no global `yt-dlp` or `faster-whisper` installation is required. The transcription helper uses `faster-whisper==1.2.1` with the multilingual Whisper `base` model and downloads the model into the normal Hugging Face cache on first use.

## Bundled scripts

- `scripts/check_requirements.sh` checks required commands, FFmpeg capabilities, and available package managers without installing anything.
- `scripts/download.py` downloads one public URL using its uv-managed `yt-dlp` Python dependency and prints the final local path.
- `scripts/transcribe.py` detects the spoken language, transcribes the video, and emits timestamped JSON.
- `scripts/style_captions.py` samples the future subtitle band and selects a readable, stable style for each cue.
- `scripts/make_ass.py` converts translated caption JSON into styled ASS subtitles.
- `scripts/deliver.py` copies a verified MP4 to the operating system's Downloads directory using a safe, collision-free filename.
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
- When neither the request nor saved preferences specify a size, let `scripts/make_ass.py` scale it from the video dimensions. Always honor an explicit user choice.
- Use an installed medium-weight sans-serif font that covers the target script. For Latin text, prefer Arial, Helvetica, Roboto, DejaVu Sans, or Liberation Sans. For Arabic, prefer Arial, Noto Sans Arabic, Geeza Pro, SF Arabic, or another installed Arabic-capable sans-serif.
- Deliver only the generated MP4. A request for a URL authorizes uploading that generated file, not unrelated local files.
- Write preferences only after explicit consent. An explicit request always overrides a saved preference for that job.
- Delete only marked working directories created by `scripts/cleanup.py`.
- Run bundled scripts as the current unprivileged user. Never invoke them through `sudo` or another privilege-elevation mechanism.
- Never download, install, activate globally, or modify package-manager configuration without the user's explicit approval.
- Once all required choices are resolved, tell the user: “I will start the process now end to end and ping you once I'm fully done. If you would like me to update you continuously after each step, let me know—otherwise I'll ping you once done or if I come across any issues.” Do not send routine progress updates unless the user opts in; always report failures, blockers, or required decisions promptly.

## Workflow

### 0. Check runtime requirements

Before resolving preferences or creating a work directory, run the dependency preflight directly with the system shell so it still works when `uv` is absent:

```bash
sh "$SKILL_ROOT/scripts/check_requirements.sh"
```

Proceed only when `uv`, `ffmpeg`, `libass`, and `libx264` are all `true`. Treat an unavailable bundled FFmpeg probe as an unavailable FFmpeg installation, but describe the requirement to the user simply as FFmpeg. Do not mention internal companion executables unless the user asks for diagnostics.

If anything is unavailable, stop before processing the video and clearly name the missing requirements. Use the preflight's `nix`, `mise`, and `homebrew` fields to offer only choices that are actually available:

- **Temporary for this job:** use `nix shell nixpkgs#uv nixpkgs#ffmpeg-full --command ...` or `mise exec uv@latest ffmpeg@latest -- ...`. This does not make the tools globally available, although downloaded packages may remain cached.
- **One-time persistent setup:** with explicit approval, use `nix profile install nixpkgs#uv nixpkgs#ffmpeg-full`, `mise use --global uv@latest ffmpeg@latest`, or Homebrew's `uv` and `ffmpeg-full` formulae. Homebrew's `ffmpeg-full` is keg-only, so expose `$(brew --prefix ffmpeg-full)/bin` when validating and running the workflow. Explain that a persistent setup is a one-time installation and future skill runs can reuse it, subject to the selected package manager being activated normally.

The ordinary Homebrew `ffmpeg` formula is not an acceptable substitute unless the post-install preflight proves that it includes both required capabilities. Regardless of provider or persistence, rerun the preflight inside the selected environment after provisioning. If it still fails, report the failed capability and do not continue or silently switch providers.

Ask for consent using natural wording based on the detected state, following this model:

> This skill requires uv and FFmpeg with libass and libx264 support. The following requirements are unavailable: <MISSING_REQUIREMENTS>.
>
> I can run them temporarily for this job using <AVAILABLE_TEMPORARY_PROVIDERS>, or set them up once using <AVAILABLE_PERSISTENT_PROVIDERS> so future runs can use them too. Either option may download packages. I need your approval before proceeding. Good to go, and which option would you prefer?
>
> If you would rather install them yourself, follow the official uv installation instructions at https://docs.astral.sh/uv/getting-started/installation/ and FFmpeg download instructions at https://ffmpeg.org/download.html, then let me know when they are ready.

Do not start installation or the caption workflow until the user explicitly selects and approves an option.

### 1. Resolve preferences and required inputs

Resolve the directory containing this `SKILL.md` as `SKILL_ROOT`, then inspect saved preferences:

```bash
uv run "$SKILL_ROOT/scripts/preferences.py" show
```

Preferences live at `$XDG_CONFIG_HOME/multilingual-caption-video/preferences.json` when `XDG_CONFIG_HOME` is an absolute path, or `~/.config/multilingual-caption-video/preferences.json` otherwise. The file may contain `delivery`, `language`, `font`, and `font_size`.

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
SOURCE="$(uv run --script "$SKILL_ROOT/scripts/download.py" "<VIDEO_URL>" "$WORK_DIR")"
```

The downloader rejects credentials and hosts resolving to non-public addresses, disables playlists, writes only inside the marked work directory, and reports the final path after yt-dlp post-processing. Its safe filename retains yt-dlp's title and media ID so file delivery can derive a meaningful original stem. Probe the source:

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

Read the video width and height from `ffprobe`. Select a font already installed on the system that covers the target language's script. Honor an explicit or saved font when it is installed and compatible; otherwise choose a suitable installed font without asking the user to install one or approve the fallback.

Inspect fonts using the operating system's available facilities instead of assuming `fc-match` exists:

- Linux and other Fontconfig systems: use `fc-match` or `fc-list` when available.
- macOS: inspect font families with CoreText-aware tools such as `system_profiler SPFontsDataType`, or inspect `/System/Library/Fonts`, `/Library/Fonts`, and `~/Library/Fonts`. Use the font family name rather than only its filename.
- Windows: inspect the Windows Fonts directory or installed-font registry entries with PowerShell.

Prefer a medium-weight sans-serif because it remains readable against moving imagery. Arial and Helvetica are common caption fonts; use the installed operating-system alternatives listed above rather than requiring one universal font. Confirm from the render logs or a preview frame that the renderer selected a font containing the required glyphs.

For example, on a Fontconfig system:

```bash
fc-match "Noto Naskh Arabic UI"
```

Before generating the subtitle file, analyze the original video behind the future subtitle band. The analyzer makes one low-resolution pass, samples the start, midpoint, and end of every cue, and assigns one stable style to the entire cue: white text with a black outline for consistently dark areas, near-black text with a white outline for consistently bright areas, or white text on a roughly 60%-opaque black box for mixed, mid-tone, or changing areas.

```bash
uv run "$SKILL_ROOT/scripts/style_captions.py" "<SOURCE>" "$WORK_DIR/captions.json" "$WORK_DIR/styled-captions.json"
uv run "$SKILL_ROOT/scripts/make_ass.py" "$WORK_DIR/styled-captions.json" "$WORK_DIR/captions.ass" --width <WIDTH> --height <HEIGHT> --font "<FONT>"
```

Unless the user requested or saved an explicit size, omit `--font-size` from both commands: the scripts use 7.5% of the shorter video edge, equivalent to about 7.5% of height for landscape video and 4.2% for 9:16 video. This follows BBC authoring guidance while keeping portrait captions from becoming oversized. When an explicit size is resolved, pass the same `--font-size <FONT_SIZE>` to both scripts so background sampling matches the rendered subtitle band.

The default ASS region uses 12 pixels of padding on each horizontal edge, so wrapping has up to `WIDTH - 24` pixels without stretching short captions. The default bottom margin is 105 pixels, placing captions 50% higher than the previous 70-pixel baseline. Override these with the same `--margin-bottom` value on both scripts, and use `--margin-horizontal` on `make_ass.py`, only when the request or visual inspection requires it.

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
ffmpeg -y -ss <SPEECH_TIMESTAMP> -i "$WORK_DIR/captioned.mp4" -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3 "$WORK_DIR/caption-preview.jpg"
```

Before sending each preview to an image or vision tool, check its byte size against that tool's upload limit. If the limit is unknown, keep the preview below 1 MiB. If it is too large, reduce the dimensions or JPEG quality, then check again; never invoke the inspection tool with a known-oversized image.

Confirm that captions are present, correctly shaped, legible, inside the safe area, and no more than two lines; adaptive text or background colors remain readable without flickering within a cue; video and audio both play; duration and dimensions match the source; and the source remains unchanged. Fix the caption data or style and render again when verification fails.

### 9. Deliver the requested form

For `file`, copy the verified MP4 to the operating system's Downloads directory, then deliver that permanent file without uploading it. Pass the local source's original path or the downloaded source's yt-dlp-derived path as `<ORIGINAL_NAME>`, and use the target language's lowercase ISO or BCP 47 code for `<LANGUAGE_CODE>`:

```bash
DELIVERED="$(uv run "$SKILL_ROOT/scripts/deliver.py" "$WORK_DIR/captioned.mp4" "<ORIGINAL_NAME>" "<LANGUAGE_CODE>")"
```

The resulting name is `YYYYMMDD-<original-stem>-<language-code>-subtitles.mp4`. The script sanitizes the original stem and uses `-2`, `-3`, and so on when a name already exists; it never overwrites another file. It uses the Windows Downloads known folder, the configured XDG Downloads directory on Linux when available, and `~/Downloads` otherwise. If that directory cannot be created or written, report the issue and fall back to the platform's normal file-delivery or attachment capability from the work directory.

For `url`, upload the generated MP4 to the configured video-capable host. When no uploader is configured, use `pstbn.dev`:

```bash
curl --fail-with-body --silent --show-error --request POST --form "file=@$WORK_DIR/captioned.mp4" https://pstbn.dev
```

Validate that an upload response is an HTTP(S) URL. Return only the requested delivery form unless the user asks for both. For file delivery, return the permanent path printed by `deliver.py`, not the temporary work-directory MP4. Include the target language, and do not claim completion without a successful probe and visual inspection.

In the successful result, tell the user: “I used font <FONT>, which was available on your system. If you'd like to use a different font or size, or another subtitle style, let me know.” Substitute the actual selected font name.

### 10. Announce and schedule cleanup

Only after successful delivery, tell the user: “I will clean up the working files and delete the temporary local assets five minutes from now. The delivered file in Downloads will remain. Let me know before then if you want me to keep the working files.” Then schedule cleanup:

```bash
uv run "$SKILL_ROOT/scripts/cleanup.py" schedule "$WORK_DIR" --delay 300
```

If the user asks to retain the assets before deletion, cancel cleanup by creating the keep marker:

```bash
uv run "$SKILL_ROOT/scripts/cleanup.py" keep "$WORK_DIR"
```

On failure, retain the working directory only long enough to report or diagnose the error, then safely delete it with the cleanup helper. Never apply cleanup to the user's source file or an unmarked directory.
