---
name: terminal-recording
description: "Record, upload, and convert terminal sessions using asciinema and agg. Use when the user says 'record session', 'asciinema', 'terminal recording', 'record my terminal', or wants to capture a terminal session as a cast file or gif."
license: "GPL-3.0-or-Later"
compatibility: Requires asciinema v3+, agg, curl, and jq
metadata:
  author: o-az
  version: "1.0.0"
---

# terminal-recording

Record terminal sessions with [asciinema](https://asciinema.org), upload them, and convert to GIF with [agg](https://github.com/asciinema/agg).

## Requirements

- `asciinema` CLI installed (**v3+** for `--headless` in `scripts/headless-record.sh`)
- `agg` CLI installed (for GIF conversion)
- `curl` and `jq` installed for the bundled helper scripts
- `IBB_API_KEY` required when hosting GIFs with `scripts/finalize-recording.sh --upload-gif`

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

Choose the recording flow based on whether the environment supports a true interactive terminal.

### Preferred Flow — Non-Interactive / Agent-Driven

Use this flow by default when working through an agent shell, CI, automation, or any environment where you cannot reliably enter and exit an interactive recording shell.

#### Record a command headlessly

```bash
bash scripts/headless-record.sh /tmp/<topic>/<topic>.cast -- sh -lc 'echo hello; sleep 1; echo done'
```

This prints JSON with:

- `cast_path`

#### Finalize the recording

```bash
bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast
```

This prints JSON with:

- `cast_path`
- `gif_path`
- `asciinema_url`

If the user wants the GIF hosted:

```bash
bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast --upload-gif
```

This also returns:

- `gif_url`

Present the result as:

```text
Recording complete: <topic>

  Asciinema URL:  https://asciinema.org/a/xxxxx
  Cast file:      /tmp/<topic>/<topic>.cast
  GIF file:       /tmp/<topic>/<topic>.gif
  GIF URL:        https://i.ibb.co/xxxx/topic.gif   (only if uploaded)
```

### Interactive Flow — Only When a Real PTY Is Available

Use this flow only when the environment supports a true interactive terminal session and you can start and stop `asciinema rec` directly.

#### Phase 1 — Setup

1. Ask the user for a **topic** name, or infer one from context.
2. Create the output directory:

   ```bash
   mkdir -p /tmp/<topic>
   ```

3. Tell the user:

   > Ready to record. Say **"start"** when you want to begin.

#### Phase 2 — Recording

When the user says **"start"**, run:

```bash
asciinema rec /tmp/<topic>/<topic>.cast
```

This launches an interactive sub-shell for the recorded session.

#### Phase 3 — Wrap-up

When the user is finished, exit the recording shell and run:

```bash
bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast
```

If the user also wants the GIF hosted, run:

```bash
bash scripts/finalize-recording.sh /tmp/<topic>/<topic>.cast --upload-gif
```

### Manual Commands

If the user asks for individual commands instead of the guided flow:

#### Interactive record

```bash
mkdir -p /tmp/<topic>
asciinema rec /tmp/<topic>/<name>.cast
```

#### Upload a cast

```bash
asciinema upload /path/to/recording.cast
```

#### Convert a cast to GIF

```bash
agg /path/to/recording.cast /path/to/output.gif
```

#### Finalize in one step

```bash
bash scripts/finalize-recording.sh /path/to/recording.cast
```

#### Finalize and host the GIF

```bash
bash scripts/finalize-recording.sh /path/to/recording.cast --upload-gif
```

Do not switch to a different hosting provider unless the user explicitly requests one.

#### Common `agg` options

| Flag          | Description               | Example           |
| ------------- | ------------------------- | ----------------- |
| `--cols`      | Override terminal width   | `--cols 80`       |
| `--rows`      | Override terminal height  | `--rows 24`       |
| `--font-size` | Font size in pixels       | `--font-size 16`  |
| `--speed`     | Playback speed multiplier | `--speed 2`       |
| `--theme`     | Color theme               | `--theme monokai` |
| `--fps-cap`   | Max frames per second     | `--fps-cap 30`    |
