# Amp plugins

## Ponytail

[Ponytail](https://github.com/dietrichgebert/ponytail) forces the smallest
solution that actually works. The Amp plugin applies Ponytail on every agent
turn, keeps intensity modes isolated per thread, and exposes native controls in
Amp's command palette.

Install it as a system plugin on macOS or Linux:

```sh
mkdir -p ~/.config/amp/plugins
curl -fsSL https://raw.githubusercontent.com/o-az/skills/main/plugins/ponytail.ts \
  -o ~/.config/amp/plugins/ponytail.ts
```

Then run `plugins: reload` from Amp's command palette or restart Amp.

The current Amp CLI only accepts Amp-hosted URLs in `amp plugins add`. Rerun
the command above to update this GitHub-hosted plugin.

### Use

Ponytail starts in `full` mode. Open the command palette and use:

- `ponytail: Change mode` — set `off`, `lite`, `full`, or `ultra` for the
  active thread.
- `ponytail: Show status` — show the active and default modes.
- `ponytail: Set default mode` — save the mode used by new threads.
- `ponytail: Open documentation` — open Ponytail's upstream documentation.

The equivalent prompt commands also work. The `/` prefix is optional; `@` and
`$` are accepted for compatibility with Ponytail's other adapters.

```text
/ponytail status
/ponytail lite
/ponytail full
/ponytail ultra
/ponytail off
/ponytail default full
stop ponytail
normal mode
```

`stop ponytail` and `normal mode` only deactivate Ponytail when the entire
prompt is the command, so ordinary requests containing either phrase do not
switch modes accidentally.

Thread modes last for the current Amp process and reset to the configured
default after Amp or the plugin restarts.

Set `PONYTAIL_DEFAULT_MODE=off|lite|full|ultra` to override the saved default.

Remove the plugin with:

```sh
rm ~/.config/amp/plugins/ponytail.ts
```

The Ponytail instructions embedded in the plugin are adapted from
`dietrichgebert/ponytail` and distributed under its MIT license; the complete
license notice is included in `ponytail.ts`.
