---
name: ghostty-remote-control
description: "Controls Ghostty on macOS through a kitty-inspired wrapper and AppleScript helper for terminal introspection, focusing, sending input, and screen capture. Use when asked to inspect, track, drive, or capture a Ghostty window, tab, split, or terminal session, especially as a `kitty @`-style workflow."
license: MIT
compatibility: macOS only. Requires Ghostty 1.3.0 or newer with AppleScript enabled and Automation permission allowing the caller to control Ghostty.
metadata:
  author: github.com/o-az
  version: 1.0.0
---

# Ghostty Remote Control

Uses the bundled scripts at `scripts/ghostty-kitty` and `scripts/ghostty-remote.applescript`.

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

9. Know the important limitations:

- Ghostty does not currently expose a direct AppleScript API to read terminal text buffers.
- The kitty-style wrapper intentionally supports only a small, explicit subset of `kitty @`.
- Supported match syntax is limited to `state:focused`, `id:<terminal-id>`, and `terminal_id:<terminal-id>`.
- `launch --type window` maps to a Ghostty split rather than a kitty layout-managed window.
- `launch` accepts `--keep-focus`, `--keep-focus=true`, and `--keep-focus=false`.
- On the wrapper, `launch --keep-focus` also best-effort restores the previously frontmost macOS app after launch.
- `snapshot` is a project-specific convenience command, not a native kitty command.
- The helper captures text through Ghostty actions, so `capture-scrollback` is best-effort.
- Some alternate-screen or TUI terminals may fail scrollback capture; if that happens, fall back to `capture-screen`.
- The helper temporarily uses the clipboard during capture and restores it on a best-effort basis.

10. When the user asks to act on “the current terminal,” use `state:focused` or `focused`. When they ask about another Ghostty window or tab, do not guess: fetch `ls` or `tree`, identify the terminal ID, and target it explicitly.

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
