import { describe, expect, test } from "bun:test";

import ponytailPlugin, {
  filterSkillBodyForMode,
  getPonytailInstructions,
  isDeactivationCommand,
  parsePonytailCommand,
} from "../plugins/ponytail";

type Handler = (event: any, context?: any) => any;

function createAmp(defaultMode?: string) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const notifications: string[] = [];
  const updates: Array<[Record<string, unknown>, string | undefined]> = [];
  let configurationObserver: Handler | undefined;

  const amp = {
    configuration: {
      get: async () => (defaultMode ? { "ponytail.defaultMode": defaultMode } : {}),
      update: async (value: Record<string, unknown>, target?: string) => {
        updates.push([value, target]);
      },
      subscribe(observer: Handler) {
        configurationObserver = observer;
        return { unsubscribe() {} };
      },
    },
    logger: { log() {} },
    helpers: { isPluginUINotAvailableError: () => false },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return { unsubscribe() {} };
    },
    onDispose() {
      return { unsubscribe() {} };
    },
    registerCommand(id: string, _options: unknown, handler: Handler) {
      commands.set(id, handler);
      return { unsubscribe() {}, setAvailability() {} };
    },
  };

  ponytailPlugin(amp as any);

  return {
    handlers,
    commands,
    notifications,
    updates,
    updateConfiguration(config: Record<string, unknown>) {
      configurationObserver?.(config);
    },
  };
}

function commandContext(notifications: string[], selected?: string, threadID = "T-test") {
  return {
    thread: { id: threadID },
    ui: {
      notify: async (message: string) => {
        notifications.push(message);
      },
      select: async () => selected,
    },
    system: { open: async () => {} },
  };
}

function eventContext(notifications: string[]) {
  return {
    ui: {
      notify: async (message: string) => {
        notifications.push(message);
      },
    },
  };
}

describe("Ponytail command parsing", () => {
  test("accepts Amp and upstream command forms", () => {
    expect(parsePonytailCommand("/ponytail lite")).toEqual({
      type: "set-mode",
      mode: "lite",
    });
    expect(parsePonytailCommand("@ponytail default ultra")).toEqual({
      type: "set-default",
      mode: "ultra",
    });
    expect(parsePonytailCommand("/ponytail:ponytail status")).toEqual({
      type: "status",
    });
    expect(parsePonytailCommand("please use ponytail")).toBeNull();
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
    const agentStart = handlers.get("agent.start")!;

    const result = await agentStart(
      {
        thread: { id: "T-one" },
        message: "Fix the bug",
      },
      eventContext(notifications),
    );

    expect(result.message.content).toContain("PONYTAIL MODE ACTIVE — level: lite");
    expect(result.message.content).not.toContain("| **full** |");
  });

  test("keeps mode changes isolated per thread", async () => {
    const { handlers, notifications } = createAmp();
    const agentStart = handlers.get("agent.start")!;
    const context = eventContext(notifications);

    await agentStart(
      {
        thread: { id: "T-one" },
        message: "/ponytail ultra",
      },
      context,
    );
    const first = await agentStart(
      {
        thread: { id: "T-one" },
        message: "Implement it",
      },
      context,
    );
    const second = await agentStart(
      {
        thread: { id: "T-two" },
        message: "Implement it",
      },
      context,
    );

    expect(first.message.content).toContain("level: ultra");
    expect(second.message.content).toContain("level: full");
    expect(notifications).toContain("Ponytail mode changed to ultra for this thread.");
  });

  test("uses live default changes for new threads", async () => {
    const { handlers, notifications, updateConfiguration } = createAmp();
    const agentStart = handlers.get("agent.start")!;

    updateConfiguration({ "ponytail.defaultMode": "lite" });
    const result = await agentStart(
      {
        thread: { id: "T-new" },
        message: "Implement it",
      },
      eventContext(notifications),
    );

    expect(result.message.content).toContain("level: lite");
  });

  test("stops injecting after exact deactivation", async () => {
    const { handlers, notifications } = createAmp();
    const agentStart = handlers.get("agent.start")!;
    const context = eventContext(notifications);

    const stopped = await agentStart(
      {
        thread: { id: "T-one" },
        message: "stop ponytail",
      },
      context,
    );
    const next = await agentStart(
      {
        thread: { id: "T-one" },
        message: "Keep working",
      },
      context,
    );

    expect(stopped.message.content).toBe("Ponytail mode changed to off for this thread.");
    expect(notifications).toContain("Ponytail mode changed to off for this thread.");
    expect(next).toBeUndefined();
  });

  test("registers native mode and default controls", async () => {
    const { commands, notifications, updates } = createAmp();

    await commands.get("ponytail-mode")!(commandContext(notifications, "ultra"));
    await commands.get("ponytail-default-mode")!(commandContext(notifications, "lite"));

    expect(notifications).toContain("Ponytail mode set to ultra for this thread.");
    expect(updates).toEqual([[{ "ponytail.defaultMode": "lite" }, "global"]]);
  });
});
