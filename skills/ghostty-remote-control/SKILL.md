---
name: ghostty-remote-control
description: "Controls Ghostty on macOS through a kitty-inspired wrapper and AppleScript helper for terminal introspection, focusing, sending input, and screen capture. Use when asked to inspect, track, drive, or capture a Ghostty window, tab, split, or terminal session, especially as a `kitty @`-style workflow."
license: MIT
compatibility: macOS only. Requires Ghostty 1.3.0 or newer with AppleScript enabled and Automation permission allowing the caller to control Ghostty.
metadata:
  author: github.com/o-az
  version: 1.1.0
---

# Ghostty Remote Control

Uses the bundled scripts at `scripts/ghostty-kitty` and `scripts/ghostty-remote.applescript`.

> **Path resolution:** The examples below use relative paths (`scripts/...`) for brevity. These only resolve when your cwd is the skill directory. In practice, resolve the absolute path to the skill directory first (e.g. `/Users/o/.pi/agent/skills/ghostty-remote-control/scripts/ghostty-kitty`) and use that, or run from the skill directory.

## When to use

- Use when the user wants an agent to inspect or control Ghostty on macOS.
- Use when the user asks to track a Ghostty session, read terminal output, send commands, change focus, or target a specific Ghostty window, tab, or split.
- Use when the user wants kitty-style remote control behavior or a `kitty @`-like API but is running Ghostty.
- Do not use for non-Ghostty terminals.
- Do not use for browser automation or local shell execution that does not involve Ghostty.

## Instructions

1. Verify Ghostty is reachable before doing anything else:

```bash
osascript -e 'tell application "Ghostty" to get version'
```

2. Prefer the kitty-style wrapper first:

```bash
scripts/ghostty-kitty @ ls
```

Use the lower-level helper when you need the raw transport:

```text
scripts/ghostty-remote.applescript
```

3. Prefer `ls` or `tree` when the user may have multiple Ghostty windows, multiple tabs, or splits. Only use `focused` or `state:focused` when the user clearly means the current frontmost Ghostty terminal.

4. Remember the targeting model:

- `state:focused` and `focused` mean the focused terminal of the selected tab of the frontmost Ghostty window.
- `ls` and `tree` return every Ghostty window, tab, and terminal, including which window is frontmost, which tab is selected, and which terminal is focused within each tab.
- To target anything other than the current frontmost terminal, fetch `tree`, extract the terminal `id`, and use that terminal ID in later commands.

5. Use these kitty-style commands as the default control surface:

```bash
scripts/ghostty-kitty @ ls
scripts/ghostty-kitty @ snapshot --match state:focused --extent screen
scripts/ghostty-kitty @ send-text --match state:focused "text"
scripts/ghostty-kitty @ send-text --match id:<terminal-id> --stdin
scripts/ghostty-kitty @ get-text --match state:focused --extent screen
scripts/ghostty-kitty @ get-text --match id:<terminal-id> --extent scrollback
scripts/ghostty-kitty @ launch --type tab --keep-focus -- /bin/sh -lc 'echo hello'
scripts/ghostty-kitty @ focus-window --match id:<terminal-id>
```

6. Use these lower-level commands when needed:

```bash
osascript scripts/ghostty-remote.applescript ls
osascript scripts/ghostty-remote.applescript focused
osascript scripts/ghostty-remote.applescript tree
osascript scripts/ghostty-remote.applescript snapshot <focused|terminal-id> <screen|scrollback>
osascript scripts/ghostty-remote.applescript launch kind=<window|tab|split:right|split:down> [target=<focused|terminal-id>] [cwd=/path] [keep_focus=true|false] [command=<command>]
osascript scripts/ghostty-remote.applescript focus <terminal-id>
osascript scripts/ghostty-remote.applescript send <focused|terminal-id> "text"
osascript scripts/ghostty-remote.applescript send-line <focused|terminal-id> "command"
osascript scripts/ghostty-remote.applescript capture-screen <focused|terminal-id>
osascript scripts/ghostty-remote.applescript capture-scrollback <focused|terminal-id>
```

7. Interpret outputs correctly:

- `ghostty-kitty @ ls` returns the JSON tree from the lower-level helper.
- `ghostty-kitty @ snapshot` returns JSON with terminal metadata plus captured text.
- `ghostty-kitty @ launch` returns JSON describing the created terminal.
- `ghostty-kitty @ send-text` and `ghostty-kitty @ focus-window` return JSON.
- `ghostty-kitty @ get-text` returns raw terminal text.
- `ls`, `focused`, `tree`, `snapshot`, `launch`, `focus`, `send`, and `send-line` return JSON.
- `capture-screen` and `capture-scrollback` return raw terminal text.

8. Prefer this workflow for agent-style tracking:

```bash
scripts/ghostty-kitty @ ls
scripts/ghostty-kitty @ get-text --match id:<terminal-id> --extent screen
```

If the user wants continuous tracking, poll `ls` plus `get-text --extent screen` from the caller rather than assuming Ghostty streams updates on its own.

## Sending commands safely

### Check terminal state before sending

Always `snapshot` the target terminal before sending input. If the terminal already has partial text (e.g. from a failed command or incomplete input), `send-line` will **append** to it, creating garbage like `dbun tauri dev`.

**Safe pattern — verify a clean prompt:**

```bash
output=$(osascript scripts/ghostty-remote.applescript snapshot <terminal-id> screen | jq -r '.text')
# Check if the last line ends with a prompt character
if ! echo "$output" | tail -1 | grep -qE '(❯|\$|%|#)\s*$'; then
  # Not a clean prompt — force a fresh one
  osascript scripts/ghostty-remote.applescript send-line <terminal-id> ""
  sleep 0.3
fi
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'your command'
```

**Defensive pattern — empty line above and below:**
If you are unsure of terminal state, send a blank line before your command to force a new prompt, and another after to ensure clean execution:

```bash
osascript scripts/ghostty-remote.applescript send-line <terminal-id> ""   # force fresh prompt
osascript scripts/ghostty-remote.applescript send-line <terminal-id> "your command"
osascript scripts/ghostty-remote.applescript send-line <terminal-id> ""   # ensure clean exit
```

**Limitation:** This pattern does **not** work when the shell is in multi-line input mode (e.g. fish waiting for `end`, bash waiting for `done`). In that case, the blank line is consumed as part of the block. See [Terminal recovery](#terminal-recovery).

**Never mix `send` and `send-line` without a clean prompt:**
`send` types text without pressing Enter. If you then use `send-line ""` to press Enter, the text may concatenate with whatever is already on the current line. Always use `send-line` with the **complete** command string, or use `send` only when you intend to type multi-part input interactively.

### `send` does NOT interpret escape sequences

The `send` command passes text through AppleScript's `keystroke` literally. It does **not** interpret `\x03`, `\e`, `\n`, or other backslash escapes.

- To send **Enter/Return**, use `send-line` instead of `send`.
- To send **Ctrl+C** or other control characters, you cannot use `send` reliably. Instead, send a shell command that achieves the same result (e.g. `pkill -f "process-name"`, `kill -9 <pid>`, or `clear`).
- For shell-agnostic command execution, use `sh -lc 'your command'` via `send-line`:
  ```bash
  osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'sh -lc "bun tauri dev"'
  ```

### Shell detection

Don't assume bash/zsh. Detect the active shell before sending complex commands:

```bash
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'echo $SHELL'
sleep 0.5
output=$(osascript scripts/ghostty-remote.applescript snapshot <terminal-id> screen | jq -r '.text')
echo "$output" | tail -3
# Look for: /bin/bash, /bin/zsh, /opt/homebrew/bin/fish, /usr/local/bin/fish, etc.
```

**Shell syntax differences:**

| Shell | Chain commands | Conditionals | Notes |
| -------- | ---------------- | --------------------- | --------------------- | --- | ---------------------- |
| bash/zsh | `cmd1 && cmd2` | `[[ -f file ]]` | POSIX standard |
| fish | `cmd1; and cmd2` | `test -f file` | No `&&`/`            |     |`; uses `; and`/`; or` |
| nushell | `cmd1 \| cmd2` | `($env.FOO == "bar")` | Pipes for composition |

**Rule of thumb:**

- Use `sh -lc '...'` for **all** complex or chained commands. This runs in a POSIX subshell regardless of the user's default shell.
- Only use native fish/nushell syntax if you have explicitly detected that shell and the user requires it.

## Terminal recovery

When a command fails or leaves the shell in a broken state (unclosed quotes, unfinished `for` loop, etc.), every subsequent `send-line` will **append** to the mess rather than execute:

```
❯ for i in 1 2 3 4 5; do echo "step $i"; slesh -lc "..."
      ep 1; done
      ps aux | grep sleep
      pkill -f "sleep 1"
```

**Signs a terminal is broken:**

- `snapshot` shows no prompt character (`❯`, `$`, `%`) at the end of the last line
- Multiple commands appear concatenated on one line or scattered across lines
- New `send-line` commands just add more text without executing

**Recovery options (in order of preference):**

1. **Abandon and launch fresh** — easiest and most reliable:

   ```bash
   osascript scripts/ghostty-remote.applescript launch kind=tab target=state:focused cwd=/path
   # Use the new terminal; old one can be closed manually
   ```

2. **Close fish's unclosed block** — if fish is waiting for `end`:

   ```bash
   osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'end'
   sleep 0.5
   # Fish will try to execute the accumulated mess, fail, and return to prompt
   ```

3. **Reset the terminal** — clears screen and resets tty:

   ```bash
   osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'reset'
   sleep 1
   ```

4. **Restart the shell** — forces a clean prompt:

   ```bash
   osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'exec fish'
   # or: exec bash, exec zsh
   sleep 0.5
   ```

5. **Kill and respawn** — nuclear option, shell will respawn:
   ```bash
   # bash/zsh
   osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'kill -9 $$'
   # fish (uses $fish_pid, not $$)
   osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'kill -9 $fish_pid'
   sleep 1
   ```

**Fish-specific note:** Fish's multi-line input mode is particularly sticky. Once fish enters an unclosed block (unmatched `for`, unclosed `"`, etc.), it will keep accumulating input until the block is closed. `clear`, `reset`, and even `exec fish` may be appended as part of the block rather than executed. The safest recovery is:

- Try `end` first (closes the unclosed block)
- If that fails, launch a fresh terminal

## Launching terminals for interactive work

When using `launch` with `command=<command>`, the terminal may close immediately if the command exits quickly or fails. For interactive shells where you want to send multiple commands over time:

1. Launch **without** a `command` argument:
   ```bash
   osascript scripts/ghostty-remote.applescript launch kind=split:right target=<terminal-id> cwd=/path
   ```
2. Wait briefly for the terminal to be ready:
   ```bash
   sleep 0.5
   ```
3. Then use `send-line` to run commands interactively:
   ```bash
   osascript scripts/ghostty-remote.applescript send-line <new-terminal-id> 'bun tauri dev'
   ```

This ensures the shell stays alive even if the first command fails. **Note:** The new terminal ID may not be immediately resolvable. Always `sleep 0.5` after `launch` before sending the first command.

## Polling long-running commands

For builds, dev servers, or any command that takes unknown time, do not guess a single `sleep` duration. Instead, poll the terminal snapshot in a loop until you see a stable prompt or expected output.

**Important:** `snapshot screen` only captures the **visible viewport**. If a command produces output that scrolls off-screen, polling may show stale text. Poll more frequently (every 1–2 seconds) for verbose commands, or use `capture-scrollback` for full history.

**Performance note:** `snapshot` returns JSON with terminal metadata. For terminals with large buffers, the JSON can be very large (hundreds of KB). If you only need the raw text without metadata, use `capture-screen` or `capture-scrollback` instead:

```bash
# Lightweight — raw text only
osascript scripts/ghostty-remote.applescript capture-screen <terminal-id>

# Heavy — JSON with metadata + text
osascript scripts/ghostty-remote.applescript snapshot <terminal-id> screen | jq -r '.text'
```

```bash
# poll every 2 seconds until prompt returns
for i in {1..60}; do
  output=$(osascript scripts/ghostty-remote.applescript snapshot <terminal-id> screen | jq -r '.text')
  if echo "$output" | grep -qE '(❯|\$|%|#)\s*$'; then
    echo "Command finished"
    break
  fi
  sleep 2
done
```

Look for the shell prompt character (`❯` for fish, `$` for bash/zsh, `%` for zsh, `#` for root) to detect when a command has completed.

## Process management inside terminals

You can manage processes inside a terminal by sending standard Unix commands through `send-line`:

```bash
# List processes
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'ps aux | grep bun'

# Kill a process by pattern
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'pkill -f "bun dev"'

# Kill a specific PID
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'kill -9 12345'

# Check what is listening on a port
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'lsof -i :1420'
```

## Terminal ID lifecycle

Terminal IDs are **not persistent**. They become invalid immediately when:

- The terminal tab or split is closed (`exit`, `kill -9 $$`, manual close)
- The containing Ghostty window is closed
- Ghostty is quit and restarted

**If you get:**

```
No Ghostty terminal found with id 6B02BF48-...
```

**Fix:** Re-run `tree` or `ls` to get the current valid IDs. Never cache terminal IDs across long-running sessions without re-validating.

## Command availability

Don't assume common CLI tools exist. Before sending optional commands (`fastfetch`, `neofetch`, `cowsay`, `htop`, etc.), validate they are installed:

```bash
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'which fastfetch || echo "not installed"'
sleep 0.5
output=$(osascript scripts/ghostty-remote.applescript snapshot <terminal-id> screen | jq -r '.text')
if echo "$output" | grep -q "not installed"; then
  # fall back or skip
fi
```

Or use `command -v` (POSIX-safe):

```bash
osascript scripts/ghostty-remote.applescript send-line <terminal-id> 'command -v fastfetch >/dev/null 2>&1 && fastfetch || echo "fastfetch not found"'
```

## Know the important limitations

- Ghostty does not currently expose a direct AppleScript API to read terminal text buffers.
- The kitty-style wrapper intentionally supports only a small, explicit subset of `kitty @`.
- Supported match syntax is limited to `state:focused`, `id:<terminal-id>`, and `terminal_id:<terminal-id>`.
- `launch --type window` maps to a Ghostty split rather than a kitty layout-managed window.
- `launch` accepts `--keep-focus`, `--keep-focus=true`, and `--keep-focus=false`. Use the `=` form for explicit falsey values; a separated token like `--keep-focus false` is treated as a positional command.
- On the wrapper, `launch --keep-focus` also best-effort restores the previously frontmost macOS app after launch.
- `snapshot` is a project-specific convenience command, not a native kitty command.
- The helper captures text through Ghostty actions, so `capture-scrollback` is best-effort.
- Some alternate-screen or TUI terminals may fail scrollback capture; if that happens, fall back to `capture-screen`.
- The helper temporarily uses the clipboard during capture and restores it on a best-effort basis.
- `state:focused` can return empty output when Ghostty is not the frontmost macOS app or when called from non-interactive contexts. Prefer explicit `id:` targeting.
- `focus` changes both the focused terminal **and** activates its containing tab. The user will see the focused terminal come to the foreground.
- Commands sent to the currently focused terminal (`state:focused`) will appear live in the user's active Ghostty window. Be mindful when sending long-running or destructive commands to the terminal the user is actively viewing.

## Examples

Inspect the current active Ghostty terminal:

```bash
scripts/ghostty-kitty @ get-text --match state:focused --extent screen
```

List every Ghostty window, tab, and terminal:

```bash
scripts/ghostty-kitty @ ls
```

Get a one-shot JSON snapshot of the current terminal and visible text:

```bash
scripts/ghostty-kitty @ snapshot --match state:focused --extent screen
```

Send a command to the current terminal:

```bash
scripts/ghostty-kitty @ send-text --match state:focused "pwd"
```

Launch a new tab but keep focus on the current terminal:

```bash
scripts/ghostty-kitty @ launch --type tab --keep-focus -- /bin/sh -lc 'echo hello'
```

Capture the current visible terminal screen:

```bash
scripts/ghostty-kitty @ get-text --match state:focused --extent screen
```

Target a specific terminal in a non-frontmost window:

```bash
scripts/ghostty-kitty @ ls
scripts/ghostty-kitty @ send-text --match id:6C0DB8FC-EE70-4104-AB63-3A9BA322E4BA "git status -sb"
```

Launch a split for interactive commands (shell-agnostic):

```bash
osascript scripts/ghostty-remote.applescript launch kind=split:right target=state:focused cwd=/Users/o/project
# extract the new terminal-id from the JSON response, then:
osascript scripts/ghostty-remote.applescript send-line <new-terminal-id> 'sh -lc "bun tauri dev"'
```
