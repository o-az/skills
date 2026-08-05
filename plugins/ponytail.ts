// Oxlint: This distributable plugin intentionally embeds Ponytail's instructions and uses Amp's async APIs.
// oxlint-disable eslint/max-lines, eslint/max-lines-per-function, eslint/max-statements, oxc/no-async-await
import type { PluginAPI, PluginCommandContext, ThreadID } from "@ampcode/plugin";

export const description =
  "Adds always-on Ponytail guidance, per-thread intensity modes, and native mode controls to Amp.";

export const PONYTAIL_MODES = ["off", "lite", "full", "ultra"] as const;
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export type PonytailCommand =
  | { type: "set-mode"; mode: PonytailMode }
  | { type: "set-default"; mode: PonytailMode }
  | { type: "status" }
  | { type: "invalid" };

const DEFAULT_MODE: PonytailMode = "full";
const DEFAULT_MODE_KEY = "ponytail.defaultMode";
const PONYTAIL_URL = "https://github.com/dietrichgebert/ponytail";
const PONYTAIL_COMMAND_PATTERN = /^(?:[/@$])?ponytail(?::ponytail)?(?:\s+(?<arguments>.*))?$/u;
const TABLE_MODE_PATTERN = /^\|\s*\*\*(?<mode>.+?)\*\*\s*\|/u;
const EXAMPLE_MODE_PATTERN = /^-\s*(?<mode>[^:]+):\s*"/u;

// Adapted from Ponytail's canonical skills/ponytail/SKILL.md.
// Keeping the complete body here makes the installed, single-file Amp plugin work offline.
const PONYTAIL_SKILL_BODY = `# Ponytail

You are a lazy senior developer. Lazy means efficient, not careless. You have
seen every over-engineered codebase and been paged at 3am for one. The best
code is the code never written.

## Persistence

ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if
unsure. Off only: "stop ponytail" / "normal mode". Default: **full**.
Switch: \`/ponytail lite|full|ultra\`.

## The ladder

Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need = skip it, say so in one line. (YAGNI)
2. **Already in this codebase?** A helper, util, type, or pattern that already lives here → reuse it. Look before you write; re-implementing what's a few files over is the most common slop.
3. **Stdlib does it?** Use it.
4. **Native platform feature covers it?** \`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code.
5. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

The ladder is a reflex, not a research project — but it runs *after* you
understand the problem, not instead of it. Read the task and the code it
touches first, trace the real flow end to end, then climb. Two rungs work →
take the higher one and move on. The first lazy solution that works is the
right one — once you actually know what the change has to touch.

**Bug fix = root cause, not symptom.** A report names a symptom. Before you
edit, grep every caller of the function you're about to touch. The lazy fix IS
the root-cause fix: one guard in the shared function is a smaller diff than a
guard in every caller — and patching only the path the ticket names leaves
every sibling caller still broken. Fix it once, where all callers route through.

## Rules

- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later", later can scaffold for itself.
- Deletion over addition. Boring over clever, clever is what someone decodes at 3am.
- Fewest files possible. Shortest working diff wins — but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Complex request? Ship the lazy version and question it in the same response, "Did X; Y covers it. Need full X? Say so." Never stall on an answer you can default.
- Two stdlib options, same size? Take the one that's correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a \`ponytail:\` comment naming the ceiling and upgrade path (\`# ponytail: global lock, per-account locks if throughput matters\`).

## Output

Code first. Then at most three short lines: what was skipped, when to add it.
No essays, no feature tours, no design notes. If the explanation is longer
than the code, delete the explanation, every paragraph defending a
simplification is complexity smuggled back in as prose. Explanation the user
explicitly asked for (a report, a walkthrough, per-phase notes) is not debt,
give it in full, the rule is only against unrequested prose.

Pattern: \`[code] → skipped: [X], add when [Y].\`

## Intensity

| Level | What change |
|-------|------------|
| **lite** | Build what's asked, but name the lazier alternative in one line. User picks. |
| **full** | The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default. |
| **ultra** | YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same breath. |

Example: "Add a cache for these API responses."
- lite: "Done, cache added. FYI: \`functools.lru_cache\` covers this in one line if you'd rather not own a cache class."
- full: "\`@lru_cache(maxsize=1000)\` on the fetch function. Skipped custom cache class, add when lru_cache measurably falls short."
- ultra: "No cache until a profiler says so. When it does: \`@lru_cache\`. A hand-rolled TTL cache class is a bug farm with a hit rate."

## When NOT to be lazy

Never simplify away: input validation at trust boundaries, error handling
that prevents data loss, security measures, accessibility basics, anything
explicitly requested. User insists on the full version → build it, no
re-arguing.

Never lazy about understanding the problem. The ladder shortens the
solution, never the reading. Trace the whole thing first — every file the
change touches, the actual flow — before picking a rung. Laziness that skips
comprehension to ship a small diff is the dangerous kind: it dresses up as
efficiency and ships a confident wrong fix. Read fully, then be lazy.

Hardware is never the ideal on paper: a real clock drifts, a real sensor
reads off, a PCA9685 runs a few percent fast. Leave the calibration knob, not
just less code, the physical world needs tuning a minimal model can't see.

Lazy code without its check is unfinished. Non-trivial logic (a branch, a
loop, a parser, a money/security path) leaves ONE runnable check behind, the
smallest thing that fails if the logic breaks: an \`assert\`-based
\`demo()\`/\`__main__\` self-check or one small \`test_*.py\`. No frameworks,
no fixtures, no per-function suites unless asked. Trivial one-liners need no
test, YAGNI applies to tests too.

## Boundaries

Ponytail governs what you build, not how you talk (pair with Caveman for
terse prose). "stop ponytail" / "normal mode": revert. Level persists until
changed or session end.

The shortest path to done is the right path.`;

export const normalizeMode = (value: unknown): PonytailMode | undefined => {
  if (typeof value !== "string") {
    return;
  }

  const normalized = value.trim().toLowerCase();
  if (!PONYTAIL_MODES.includes(normalized as PonytailMode)) {
    return;
  }

  return normalized as PonytailMode;
};

export const isDeactivationCommand = (value: unknown): boolean => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?\s]+$/u, "");

  return normalized === "stop ponytail" || normalized === "normal mode";
};

export const parsePonytailCommand = (value: unknown): PonytailCommand | undefined => {
  if (isDeactivationCommand(value)) {
    return { mode: "off", type: "set-mode" };
  }

  const command = String(value ?? "")
    .trim()
    .toLowerCase()
    .match(PONYTAIL_COMMAND_PATTERN);
  if (!command || !command.groups) {
    return;
  }

  const { arguments: argumentText } = command.groups;
  let argumentsValue = "";
  if (argumentText) {
    argumentsValue = argumentText.trim();
  }
  if (!argumentsValue || argumentsValue === "status") {
    return { type: "status" };
  }

  const [primary, secondary, extra] = argumentsValue.split(/\s+/u);
  if (primary === "default") {
    if (!extra) {
      const mode = normalizeMode(secondary);
      if (mode) {
        return { mode, type: "set-default" };
      }
    }

    return { type: "invalid" };
  }

  if (!secondary) {
    const mode = normalizeMode(primary);
    if (mode) {
      return { mode, type: "set-mode" };
    }
  }

  return { type: "invalid" };
};

const modeFromMatch = (match: RegExpMatchArray | null): PonytailMode | undefined => {
  if (!match || !match.groups) {
    return;
  }
  return normalizeMode(match.groups.mode);
};

export const filterSkillBodyForMode = (body: string, mode: PonytailMode): string =>
  body
    .split(/\r?\n/u)
    .filter((line) => {
      const tableMode = modeFromMatch(line.match(TABLE_MODE_PATTERN));
      if (tableMode && tableMode !== "off") {
        return tableMode === mode;
      }

      const exampleMode = modeFromMatch(line.match(EXAMPLE_MODE_PATTERN));
      if (exampleMode && exampleMode !== "off") {
        return exampleMode === mode;
      }

      return true;
    })
    .join("\n");

export const getPonytailInstructions = (mode: PonytailMode): string => {
  if (mode === "off") {
    return "";
  }

  return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${filterSkillBodyForMode(PONYTAIL_SKILL_BODY, mode)}`;
};

const effectiveDefaultMode = (config: Record<string, unknown>): PonytailMode =>
  normalizeMode(process.env.PONYTAIL_DEFAULT_MODE) ??
  normalizeMode(config[DEFAULT_MODE_KEY]) ??
  DEFAULT_MODE;

const requireThread = (
  ctx: PluginCommandContext,
): ctx is PluginCommandContext & {
  thread: NonNullable<PluginCommandContext["thread"]>;
} => Boolean(ctx.thread);

const ponytailPlugin = (amp: PluginAPI): void => {
  const threadModes = new Map<ThreadID, PonytailMode>();
  let configuredDefaultMode: PonytailMode =
    normalizeMode(process.env.PONYTAIL_DEFAULT_MODE) ?? DEFAULT_MODE;
  let receivedConfigurationUpdate = false;

  const applyConfiguration = (config: Record<string, unknown>): void => {
    configuredDefaultMode = effectiveDefaultMode(config);
  };

  const loadConfiguration = amp.configuration
    .get()
    .then((config) => {
      if (!receivedConfigurationUpdate) {
        applyConfiguration(config);
      }
    })
    .catch((error: unknown) => {
      amp.logger.log("Unable to read Ponytail configuration; using the fallback default.", error);
    });
  const configurationSubscription = amp.configuration.subscribe((config) => {
    receivedConfigurationUpdate = true;
    applyConfiguration(config);
  });

  amp.onDispose(() => {
    configurationSubscription.unsubscribe();
  });

  const getThreadMode = async (threadID: ThreadID): Promise<PonytailMode> => {
    await loadConfiguration;
    const currentMode = threadModes.get(threadID);
    if (currentMode) {
      return currentMode;
    }

    threadModes.set(threadID, configuredDefaultMode);
    return configuredDefaultMode;
  };

  const setThreadMode = (threadID: ThreadID, mode: PonytailMode): void => {
    threadModes.set(threadID, mode);
  };

  const setDefaultMode = async (mode: PonytailMode): Promise<void> => {
    await amp.configuration.update({ [DEFAULT_MODE_KEY]: mode }, "global");
    configuredDefaultMode = normalizeMode(process.env.PONYTAIL_DEFAULT_MODE) ?? mode;
  };

  const notify = async (message: string, ui: PluginCommandContext["ui"]): Promise<void> => {
    try {
      await ui.notify(message);
    } catch (error) {
      if (!(error instanceof Error) || !amp.helpers.isPluginUINotAvailableError(error)) {
        throw error;
      }
    }
  };

  amp.on("session.start", async (event) => {
    await getThreadMode(event.thread.id);
  });

  amp.on("agent.start", async (event, ctx) => {
    let currentMode = await getThreadMode(event.thread.id);
    const command = parsePonytailCommand(event.message);
    let commandResult = "";

    if (command) {
      if (command.type === "set-mode") {
        currentMode = command.mode;
        setThreadMode(event.thread.id, currentMode);
        commandResult = `Ponytail mode changed to ${currentMode} for this thread.`;
      } else if (command.type === "set-default") {
        await setDefaultMode(command.mode);
        commandResult = `Saved default ${command.mode}, but PONYTAIL_DEFAULT_MODE keeps the effective default at ${configuredDefaultMode}. The current thread remains ${currentMode}.`;
        if (configuredDefaultMode === command.mode) {
          commandResult = `Default Ponytail mode set to ${command.mode}. The current thread remains ${currentMode}.`;
        }
      } else if (command.type === "status") {
        commandResult = `Ponytail status: current ${currentMode}; default ${configuredDefaultMode}.`;
      } else {
        commandResult =
          "Unknown Ponytail mode. Use off, lite, full, ultra, status, or default <mode>.";
      }
    }

    if (commandResult) {
      await notify(commandResult, ctx.ui);
    }

    const instructions = getPonytailInstructions(currentMode);
    const content = [commandResult, instructions].filter(Boolean).join("\n\n");

    if (content) {
      return { message: { content } };
    }
    return {};
  });

  amp.registerCommand(
    "ponytail-mode",
    {
      category: "ponytail",
      description: "Set Ponytail intensity for the active thread.",
      title: "Change mode",
    },
    async (ctx) => {
      if (!requireThread(ctx)) {
        await ctx.ui.notify("Start or open a thread before changing its Ponytail mode.");
        return;
      }

      const currentMode = await getThreadMode(ctx.thread.id);
      const selected = await ctx.ui.select({
        initialValue: currentMode,
        message:
          "lite suggests the lazier option; full enforces the ladder; ultra challenges unnecessary work.",
        options: [...PONYTAIL_MODES],
        title: "Ponytail mode",
      });
      const mode = normalizeMode(selected);
      if (!mode) {
        return;
      }

      setThreadMode(ctx.thread.id, mode);
      await ctx.ui.notify(`Ponytail mode set to ${mode} for this thread.`);
    },
  );

  amp.registerCommand(
    "ponytail-status",
    {
      category: "ponytail",
      description: "Show the active thread mode and configured default.",
      title: "Show status",
    },
    async (ctx) => {
      await loadConfiguration;
      let current: PonytailMode | "(no active thread)" = "(no active thread)";
      if (ctx.thread) {
        current = await getThreadMode(ctx.thread.id);
      }
      await ctx.ui.notify(`Ponytail: current ${current}; default ${configuredDefaultMode}.`);
    },
  );

  amp.registerCommand(
    "ponytail-default-mode",
    {
      category: "ponytail",
      description: "Set the Ponytail mode used by new Amp threads.",
      title: "Set default mode",
    },
    async (ctx) => {
      await loadConfiguration;
      const selected = await ctx.ui.select({
        initialValue: configuredDefaultMode,
        message: "This applies to new threads and is saved in Amp settings.",
        options: [...PONYTAIL_MODES],
        title: "Default Ponytail mode",
      });
      const mode = normalizeMode(selected);
      if (!mode) {
        return;
      }

      await setDefaultMode(mode);
      const overridden = configuredDefaultMode !== mode;
      let message = `Default Ponytail mode set to ${mode}.`;
      if (overridden) {
        message = `Saved ${mode}, but PONYTAIL_DEFAULT_MODE keeps the effective default at ${configuredDefaultMode}.`;
      }
      await ctx.ui.notify(message);
    },
  );

  amp.registerCommand(
    "ponytail-help",
    {
      category: "ponytail",
      description: "Open the Ponytail documentation on GitHub.",
      title: "Open documentation",
    },
    async (ctx) => {
      await ctx.system.open(PONYTAIL_URL);
    },
  );
};

export default ponytailPlugin;

/*
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
