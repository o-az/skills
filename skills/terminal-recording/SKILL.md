---
name: terminal-recording
description: "Record, upload, and convert terminal sessions using asciinema and agg. Use when the user says 'record session', 'asciinema', 'terminal recording', 'record my terminal', or wants to capture a terminal session as a cast file or gif."
license: "GPL-3.0-or-Later"
metadata:
  author: o-az
  version: "1.0.0"
---

# terminal-recording

Record terminal sessions with [asciinema](https://asciinema.org), upload them, and convert to GIF with [agg](https://github.com/asciinema/agg).

## Requirements

- `asciinema` CLI installed
- `agg` CLI installed (for GIF conversion)
- `curl` and `jq` installed for the bundled helper scripts
- `kitty` optional for launching the recorder in a separate terminal window
- `IBB_API_KEY` only if using `scripts/finalize-recording.sh --upload-gif`

## When to Use

- User says "record session", "record my terminal", "start recording"
- User wants to capture a terminal session
- User asks to convert a `.cast` file to GIF
- User mentions "asciinema" or "terminal recording"

## Available commands

- `asciinema rec /tmp/<topic>/<topic>.cast` - Record an interactive terminal session to a cast file.
- `asciinema upload /path/to/recording.cast` - Upload a cast and print the share URL.
- `agg /path/to/recording.cast /path/to/output.gif` - Render a GIF from a cast file.

## Available scripts

- `scripts/finalize-recording.sh` - Uploads a `.cast`, renders a GIF, and prints JSON to stdout.
- `scripts/headless-record.sh` - Records a non-interactive command to a `.cast` and prints JSON to stdout.

## Instructions

### Interactive Recording Flow

When the user asks to record a session, follow this flow:

#### Phase 1 — Setup

1. Ask the user for a **topic** name (or infer one from context). This becomes the directory and file name.
2. Create the output directory:

   ```bash
   mkdir -p /tmp/<topic>
   ```

3. Tell the user:

   > Ready to record. Say **"start"** when you want to begin.

#### Phase 2 — Recording

When the user says **"start"**:

1. Start the recording in a kitty window (if available) or directly:

   ```bash
   asciinema rec /tmp/<topic>/<topic>.cast
   ```

   **Important:** This launches an interactive sub-shell. The user works inside it freely.

2. Tell the user:

   > Recording started. Do your thing — say **"done"** when finished.

#### Phase 3 — Wrap-up

When the user says **"done"**:

1. Send `exit` to the recording shell to stop it.
2. Finalize the recording:

   ```bash
   bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast
   ```

   This prints JSON with `cast_path`, `gif_path`, and `asciinema_url`.

3. If the user also wants the GIF hosted, run:

   ```bash
   bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast --upload-gif
   ```

   This prints the same JSON plus `gif_url`.

4. Present results:

   ```
   ✅ Recording complete: <topic>

     Asciinema URL:  https://asciinema.org/a/xxxxx
     Cast file:      /tmp/<topic>/<topic>.cast
     GIF file:       /tmp/<topic>/<topic>.gif
     GIF URL:        https://i.ibb.co/xxxx/topic.gif   ← only if uploaded
   ```

### Manual Usage (Non-Interactive)

If the user provides a `.cast` file directly or asks for individual steps:

#### Record

```bash
mkdir -p /tmp/<topic>
asciinema rec /tmp/<topic>/<name>.cast
```

For scripted or automated capture, prefer the bundled helper:

```bash
bash scripts/headless-record.sh /tmp/<topic>/<topic>.cast -- sh -lc 'echo hello; sleep 1; echo done'
```

#### Upload

```bash
asciinema upload /path/to/recording.cast
```

The command prints the asciinema.org URL to stdout.

#### Convert to GIF

```bash
agg /path/to/recording.cast /path/to/output.gif
```

Or use the bundled helper to do both upload and GIF rendering in one step:

```bash
bash scripts/finalize-recording.sh /path/to/recording.cast
```

#### Common `agg` options

| Flag          | Description               | Example           |
| ------------- | ------------------------- | ----------------- |
| `--cols`      | Override terminal width   | `--cols 80`       |
| `--rows`      | Override terminal height  | `--rows 24`       |
| `--font-size` | Font size in pixels       | `--font-size 16`  |
| `--speed`     | Playback speed multiplier | `--speed 2`       |
| `--theme`     | Color theme               | `--theme monokai` |
| `--fps-cap`   | Max frames per second     | `--fps-cap 30`    |
