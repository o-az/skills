---
name: terminal-recording
description: "Record, upload, and convert terminal sessions using asciinema and agg. Use when the user says 'record session', 'asciinema', 'terminal recording', 'record my terminal', or wants to capture a terminal session as a cast file or gif."
metadata:
  author: o-az
  version: "1.0.0"
---

# asciinema

Record terminal sessions with [asciinema](https://asciinema.org), upload them, and convert to GIF with [agg](https://github.com/asciinema/agg).

## Requirements

- `asciinema` CLI installed
- `agg` CLI installed (for GIF conversion)

## When to Use

- User says "record session", "record my terminal", "start recording"
- User wants to capture a terminal session
- User asks to convert a `.cast` file to GIF
- User mentions "asciinema" or "terminal recording"

## Instructions

### Interactive Recording Flow

When the user asks to record a session, follow this **two-phase** conversational flow:

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
2. Upload the recording:

   ```bash
   asciinema upload /tmp/<topic>/<topic>.cast
   ```

   Capture the URL from stdout (it prints the asciinema.org link).

3. Convert to GIF:

   ```bash
   agg /tmp/<topic>/<topic>.cast /tmp/<topic>/<topic>.gif
   ```

4. **Optionally upload the GIF** — if the user asks to upload/host/share the GIF, use the **upload-image** skill to upload `/tmp/<topic>/<topic>.gif`. See `skills/upload-image/SKILL.md` for full instructions.

5. Present results:

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

#### Upload

```bash
asciinema upload /path/to/recording.cast
```

The command prints the asciinema.org URL to stdout.

#### Convert to GIF

```bash
agg /path/to/recording.cast /path/to/output.gif
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
