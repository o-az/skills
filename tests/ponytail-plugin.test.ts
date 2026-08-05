// Oxlint: Async callbacks and intentionally minimal no-op methods model Amp's Plugin API.
// oxlint-disable eslint/max-lines-per-function, eslint/no-empty-function, eslint/require-await, oxc/no-async-await, typescript/explicit-function-return-type
import { describe, expect, test } from "bun:test";
import ponytailPlugin, {
  filterSkillBodyForMode,
  getPonytailInstructions,
  isDeactivationCommand,
  parsePonytailCommand,
} from "../plugins/ponytail";
import type { PluginAPI } from "@ampcode/plugin";

type Handler = (...arguments_: unknown[]) => unknown;

interface Harness {
  commands: Map<string, Handler>;
  handlers: Map<string, Handler>;
  notifications: string[];
  updateConfiguration: (config: Record<string, unknown>) => void;
  updates: [Record<string, unknown>, string | undefined][];
}

const createAmp = (defaultMode?: string): Harness => {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const notifications: string[] = [];
  const updates: [Record<string, unknown>, string | undefined][] = [];
  let configurationObserver: Handler | false = false;

  const amp = {
    configuration: {
      get: async () => {
        if (defaultMode) {
          return { "ponytail.defaultMode": defaultMode };
        }
        return {};
      },
      subscribe(observer: Handler) {
        configurationObserver = observer;
        return { unsubscribe() {} };
      },
      update: async (value: Record<string, unknown>, target?: string) => {
        updates.push([value, target]);
      },
    },
    helpers: { isPluginUINotAvailableError: () => false },
    logger: { log() {} },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return { unsubscribe() {} };
    },
    onDispose() {
      return { unsubscribe() {} };
    },
    registerCommand(id: string, _options: unknown, handler: Handler) {
      commands.set(id, handler);
      return { setAvailability() {}, unsubscribe() {} };
    },
  };

  ponytailPlugin(amp as unknown as PluginAPI);

  return {
    commands,
    handlers,
    notifications,
    updateConfiguration(config: Record<string, unknown>) {
      if (configurationObserver) {
        configurationObserver(config);
      }
    },
    updates,
  };
};

const commandContext = (notifications: string[], selected?: string, threadID = "T-test") => ({
  system: { open: async () => {} },
  thread: { id: threadID },
  ui: {
    notify: async (message: string) => {
      notifications.push(message);
    },
    select: async () => selected,
  },
});

const eventContext = (notifications: string[]) => ({
  ui: {
    notify: async (message: string) => {
      notifications.push(message);
    },
  },
});

const getHandler = (handlers: Map<string, Handler>, name: string): Handler => {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(`Missing ${name} handler`);
  }
  return handler;
};

const messageContent = (result: unknown): string => {
  const candidate = result as { message?: { content?: unknown } };
  const content = candidate.message && candidate.message.content;
  if (typeof content !== "string") {
    throw new TypeError("Expected an agent-start message result");
  }
  return content;
};

describe("Ponytail command parsing", () => {
  test("accepts Amp and upstream command forms", () => {
    expect(parsePonytailCommand("/ponytail lite")).toEqual({
      mode: "lite",
      type: "set-mode",
    });
    expect(parsePonytailCommand("@ponytail default ultra")).toEqual({
      mode: "ultra",
      type: "set-default",
    });
    expect(parsePonytailCommand("/ponytail:ponytail status")).toEqual({
      type: "status",
    });
    expect(parsePonytailCommand("please use ponytail")).toBeUndefined();
    expect(parsePonytailCommand("ponytail seems too strict")).toEqual({ type: "invalid" });
  });

  test("only deactivates for standalone commands", () => {
    expect(isDeactivationCommand("Stop ponytail!")).toBeTrue();
    expect(isDeactivationCommand("normal mode.")).toBeTrue();
    expect(isDeactivationCommand("add a normal mode toggle")).toBeFalse();
  });
});

describe("Ponytail instructions", () => {
  test("keeps only the selected intensity row and example", () => {
    const body = [
      "| **lite** | lite row |",
      "| **full** | full row |",
      '- lite: "lite example"',
      '- full: "full example"',
      "- Full: ordinary rule without a quote",
    ].join("\n");

    expect(filterSkillBodyForMode(body, "lite")).toBe(
      [
        "| **lite** | lite row |",
        '- lite: "lite example"',
        "- Full: ordinary rule without a quote",
      ].join("\n"),
    );
  });

  test("returns no instructions when disabled", () => {
    expect(getPonytailInstructions("off")).toBe("");
    expect(getPonytailInstructions("ultra")).toContain("PONYTAIL MODE ACTIVE — level: ultra");
  });
});

describe("Amp integration", () => {
  test("injects the configured default on every turn", async () => {
    const { handlers, notifications } = createAmp("lite");
    const agentStart = getHandler(handlers, "agent.start");

    const result = await agentStart(
      {
        message: "Fix the bug",
        thread: { id: "T-one" },
      },
      eventContext(notifications),
    );

    expect(messageContent(result)).toContain("PONYTAIL MODE ACTIVE — level: lite");
    expect(messageContent(result)).not.toContain("| **full** |");
  });

  test("keeps mode changes isolated per thread", async () => {
    const { handlers, notifications } = createAmp();
    const agentStart = getHandler(handlers, "agent.start");
    const context = eventContext(notifications);

    await agentStart(
      {
        message: "/ponytail ultra",
        thread: { id: "T-one" },
      },
      context,
    );
    const first = await agentStart(
      {
        message: "Implement it",
        thread: { id: "T-one" },
      },
      context,
    );
    const second = await agentStart(
      {
        message: "Implement it",
        thread: { id: "T-two" },
      },
      context,
    );

    expect(messageContent(first)).toContain("level: ultra");
    expect(messageContent(second)).toContain("level: full");
    expect(notifications).toContain("Ponytail mode changed to ultra for this thread.");
  });

  test("uses live default changes for new threads", async () => {
    const { handlers, notifications, updateConfiguration } = createAmp();
    const agentStart = getHandler(handlers, "agent.start");

    updateConfiguration({ "ponytail.defaultMode": "lite" });
    const result = await agentStart(
      {
        message: "Implement it",
        thread: { id: "T-new" },
      },
      eventContext(notifications),
    );

    expect(messageContent(result)).toContain("level: lite");
  });

  test("stops injecting after exact deactivation", async () => {
    const { handlers, notifications } = createAmp();
    const agentStart = getHandler(handlers, "agent.start");
    const context = eventContext(notifications);

    const stopped = await agentStart(
      {
        message: "stop ponytail",
        thread: { id: "T-one" },
      },
      context,
    );
    const next = await agentStart(
      {
        message: "Keep working",
        thread: { id: "T-one" },
      },
      context,
    );

    expect(messageContent(stopped)).toBe("Ponytail mode changed to off for this thread.");
    expect(notifications).toContain("Ponytail mode changed to off for this thread.");
    expect(next).toEqual({});
  });

  test("registers native mode and default controls", async () => {
    const { commands, notifications, updates } = createAmp();

    await getHandler(commands, "ponytail-mode")(commandContext(notifications, "ultra"));
    await getHandler(commands, "ponytail-default-mode")(commandContext(notifications, "lite"));

    expect(notifications).toContain("Ponytail mode set to ultra for this thread.");
    expect(updates).toEqual([[{ "ponytail.defaultMode": "lite" }, "global"]]);
  });
});
