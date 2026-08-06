import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enumerateGitHubTree,
  markdown,
  parsePyDefault,
  resolveSourceRoles,
  sourceRoleCoverageGap,
} from "../../skills/auditing-hermes-config/scripts/hermes-config-audit.mjs";

const here = import.meta.dirname;
const cli = path.resolve(
  here,
  "../../skills/auditing-hermes-config/scripts/hermes-config-audit.mjs",
);
const defaults = fs.readFileSync(path.join(here, "fixtures/config-defaults.py"), "utf8");
const temporaryRoots = new Set();
const temporaryDirectory = (prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
};
afterEach(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  temporaryRoots.clear();
});
const run = (cmd, args, cwd, env) => {
  const result = Bun.spawnSync([cmd, ...args], { cwd, env, stderr: "pipe", stdout: "pipe" });
  if (!result.success) {
    throw new Error(result.stderr.toString().trim() || `${cmd} exited ${result.exitCode}`);
  }
  return result.stdout.toString().trim();
};
const write = (root, rel, body, mode) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, mode ? { mode } : undefined);
  return p;
};

function validateSchema(value, schema, root = schema, where = "$") {
  if (schema.$ref) {
    return validateSchema(value, root.$defs[schema.$ref.split("/").at(-1)], root, where);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      try {
        validateSchema(value, candidate, root, where);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) {
      throw new Error(`${where} oneOf`);
    }
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    throw new Error(`${where} const`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${where} enum`);
  }
  if (schema.type) {
    const actual =
      value === null
        ? "null"
        : Array.isArray(value)
          ? "array"
          : Number.isInteger(value)
            ? "integer"
            : typeof value;
    if (![schema.type].flat().includes(actual)) {
      throw new Error(`${where} type ${actual}`);
    }
  }
  if (schema.pattern) {
    if (schema.pattern !== "^[0-9a-f]{40}$") {
      throw new Error(`${where} unsupported pattern`);
    }
    if (!/^[0-9a-f]{40}$/.test(value)) {
      throw new Error(`${where} pattern`);
    }
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`${where} minimum`);
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    throw new Error(`${where} minLength`);
  }
  if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
    throw new Error(`${where} format`);
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(value, key)) throw new Error(`${where}.${key} required`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties || {}, key))
        throw new Error(`${where}.${key} additional`);
  }
  for (const [key, child] of Object.entries(schema.properties || {})) {
    if (Object.hasOwn(value, key)) validateSchema(value[key], child, root, `${where}.${key}`);
  }
  if (schema.items) {
    value.forEach((item, index) => validateSchema(item, schema.items, root, `${where}[${index}]`));
  }
}

function repo(files) {
  const root = temporaryDirectory("audit-");
  run("git", ["init", "-q"], root);
  run("git", ["config", "user.email", "x@y.invalid"], root);
  run("git", ["config", "user.name", "x"], root);
  for (const [p, x] of Object.entries(files)) {
    write(root, p, typeof x === "string" ? x.replaceAll("\\n", "\n") : x);
  }
  run("git", ["add", "."], root);
  run("git", ["commit", "-qm", "fixture"], root);
  return root;
}
const moduleNix = `{ lib, ... }: { options.services.hermes-agent = {
  enable = lib.mkEnableOption "Hermes";
  settings = lib.mkOption {
    type = lib.types.attrs; default = {};
    example = { terminal = { cwd = "/tmp"; }; };
    description = ''Settings with a ; and interpolation.'';
  };
  configFile = lib.mkOption {
    type = lib.types.nullOr lib.types.path; default = null; description = "File";
  };
  environment = lib.mkOption {
    type = lib.types.attrsOf lib.types.str; default = {}; description = "Environment";
  };
  container = { enable = lib.mkEnableOption "Container"; };
  mcpServers = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule ({ ... }: { options = {
      command = lib.mkOption { type = lib.types.str; default = null; description = "Command"; };
      tools = lib.mkOption { type = lib.types.submodule ({ ... }: { options = {
        include = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
      }; }); };
    }; }));
    default = {}; description = "MCP servers";
  };
}; }`;
function fixture({ migration = true } = {}) {
  const source = repo({
    "_/never": "secret",
    "hermes_cli/config.py": `_OPEN_DICT_TOP_LEVEL_KEYS = {"extensions"}\n_PLATFORM_CONTAINER_KEYS = {"discord"}\nDISCORD_KNOWN_FIELDS = {"token", "tools"}\ndef _normalize_custom_provider_entry(entry):\n  _KNOWN_KEYS = {"base_url", "api_key"}\n  _CAMEL_ALIASES = {"baseUrl": "base_url"}\n  return {key: value for key, value in entry.items() if key in _KNOWN_KEYS}\n`,
    "hermes_cli/config_defaults.py": defaults,
    "hermes_cli/config_migrations.py": "# deprecated custom_providers are migrated to providers\n",
    "hermes_cli/legacy.py": "# deprecated mystery was renamed\n",
    "hermes_cli/mcp_config.py": 'MCP_SERVER_KN_FIELDS = {"command", "tools"}\n',
    "nix/nixosModules.nix": moduleNix,
  });
  write(
    source,
    "hermes_cli/config.py",
    `_OPEN_DICT_TOP_LEVEL_KEYS = frozenset({"extensions", "mcp_servers"})
_SCHEMA_DEFINED_DICT_KEYS = frozenset({"discord"})
_DYNAMIC_TOP_LEVEL_KEYS = frozenset({"custom_providers"})
_PLATFORM_CONTAINER_KEYS = frozenset({"platforms"})
def _normalize_custom_provider_entry(entry):
  _KNOWN_KEYS = {"base_url", "api_key"}
  _CAMEL_ALIASES: Dict[str, str] = {"baseUrl": "base_url"}
  if "api_key_env" in entry and "key_env" not in entry:
    entry["key_env"] = entry["api_key_env"]
  return {key: value for key, value in entry.items() if key in _KNOWN_KEYS}
def _deep_merge(result, key, value):
  if isinstance(result[key], dict) and value is None:
    return result
`,
  );
  write(
    source,
    "hermes_cli/mcp_config.py",
    `def save(server_config, config):
  server_config["command"] = "x"
  server_config["args"] = []
  return config.get("connect_timeout", 30), config.get("tools")
`,
  );
  if (migration) {
    write(
      source,
      "hermes_cli/config_migrations.py",
      `custom_list = config.get("custom_providers")
config["providers"] = providers_dict
config.pop("custom_providers", None)
disabled = plugins_cfg.get("disabled", [])
`,
    );
  }
  run("git", ["add", "."], source);
  run("git", ["commit", "-qm", "realistic forms"], source);
  const sha = run("git", ["rev-parse", "HEAD"], source);
  const target = repo({
    "flake.lock": JSON.stringify({
      nodes: {
        "hermes-agent": { locked: { owner: "acme", repo: "hermes", rev: sha, type: "github" } },
      },
    }),
  });
  return { sha, source, target };
}

function repin(f) {
  f.sha = run("git", ["rev-parse", "HEAD"], f.source);
  fs.writeFileSync(
    path.join(f.target, "flake.lock"),
    JSON.stringify({
      nodes: {
        "hermes-agent": {
          locked: { owner: "acme", repo: "hermes", rev: f.sha, type: "github" },
        },
      },
    }),
  );
  run("git", ["add", "flake.lock"], f.target);
  run("git", ["commit", "-qm", "repin"], f.target);
}

test("safe literal parser does not execute Python", () => {
  expect(parsePyDefault(defaults).static_flag).toBe(true);
  const parsed = parsePyDefault(
    "DEFAULT_CONFIG = {\n # note\n 'x': 2 * (3 + 1), # inline\n 's': 'a\\n',\n}",
  );
  expect(parsed.x).toBe(8);
  expect(parsed.s).toBe("a\n");
  expect(parsePyDefault('X: set[str] = frozenset({"a", "b"})\n', "X")).toEqual(new Set(["a", "b"]));
  expect(parsePyDefault(String.raw`DEFAULT_CONFIG = {"x": "\u2589", "y": "\x41"}`)).toEqual({
    x: "▉",
    y: "A",
  });
  expect(() => parsePyDefault("DEFAULT_CONFIG = call()")).toThrow();
  expect(() => parsePyDefault("DEFAULT_CONFIG = {'x': call()}")).toThrow(/non-literal/);
});

test("offline exact object audit catalogs, compares, evaluates once, and writes safely", () => {
  const f = fixture(),
    bin = temporaryDirectory("bin-"),
    out = temporaryDirectory("out-"),
    calls = path.join(bin, "calls"),
    nixArgs = path.join(bin, "args");
  write(
    bin,
    "nix",
    `#!/bin/sh\necho CALL >> '${calls}'\nprintf '%s' "$*" > '${nixArgs}'\nprintf '%s' '{"available":true,"enabled":true,"mode":"generated","configFileSet":false,"nativeShape":{"enable":"<boolean>","settings":{"model":"<string>"},"environment":{"TOKEN":"<string>"}},"applicationShape":{"model":"<string>","optional_count":"<number>","stop_sequences":"<array>","terminal":{"cwd":"<string>"},"providers":{"custom":{"base_url":"<string>"}},"custom_providers":"<array>","extensions":{"x":"<string>"},"mystery":"<number>"}}'\n`,
    0o755,
  );
  run("git", ["commit", "--allow-empty", "-qm", "HEAD may differ"], f.source);
  const stdout = run(
    "node",
    [
      cli,
      "audit",
      "--target-repo",
      f.target,
      "--host",
      "test",
      "--source",
      f.source,
      "--output-dir",
      out,
    ],
    f.target,
    { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  );
  const [json, md] = stdout.split("\n"),
    doc = JSON.parse(fs.readFileSync(json));
  validateSchema(
    doc,
    JSON.parse(
      fs.readFileSync(
        path.resolve(here, "../../skills/auditing-hermes-config/reference/audit.schema.json"),
      ),
    ),
  );
  expect(doc.provenance.resolvedSha).toBe(f.sha);
  expect(doc.local.available).toBe(true);
  expect(
    doc.applicationInventory.entries.some(
      (x) => x.path === "providers.<name>.base_url" && x.dynamic,
    ),
  ).toBe(true);
  expect(doc.applicationInventory.entries.map((x) => x.path)).toContain("platforms.<name>.*");
  expect(doc.applicationInventory.entries.map((x) => x.path)).toContain("discord.*");
  expect(doc.applicationInventory.diagnostics).toEqual([]);
  expect(doc.completeness.inventory).toBe("partial-source-role-gaps");
  expect(doc.sourceRoles.some((role) => !role.required && role.status !== "resolved")).toBe(true);
  expect(doc.applicationInventory.entries.map((x) => x.path)).toContain(
    "mcp_servers.<name>.command",
  );
  expect(doc.moduleInventory.entries).toHaveLength(9);
  expect(
    doc.moduleInventory.entries.some(
      (x) => x.path === "services.hermes-agent.mcpServers.<name>.command",
    ),
  ).toBe(true);
  expect(
    doc.moduleInventory.entries.some((x) => x.path === "services.hermes-agent.container.enable"),
  ).toBe(true);
  const mcp = doc.moduleInventory.entries.find(
    (x) => x.path === "services.hermes-agent.mcpServers",
  );
  expect(mcp.default).toBe("{}");
  expect(mcp.description).toBe('"MCP servers"');
  expect(mcp.type).toContain("lib.types.submodule");
  expect(
    doc.moduleInventory.entries.find(
      (x) => x.path === "services.hermes-agent.mcpServers.<name>.tools.include",
    ).mapping,
  ).toBe("generates-application-config");
  expect(doc.moduleInventory.entries.find((x) => x.path.endsWith("settings")).example).toContain(
    'cwd = "/tmp"',
  );
  expect(doc.moduleInventory.entries.every((x) => x.evidence.url.includes(f.sha))).toBe(true);
  expect(doc.comparison.presentInGeneratedOverride).toContain("providers.custom.base_url");
  expect(doc.comparison.presentInGeneratedOverride).toContain("optional_count");
  expect(doc.comparison.presentInGeneratedOverride).toContain("stop_sequences");
  expect(doc.comparison.applicationMismatches.map((x) => x.path)).toContain("extensions.x");
  expect(doc.comparison.moduleMismatches).toHaveLength(0);
  expect(doc.comparison.applicationMismatches.map((x) => x.path)).toContain("mystery");
  expect(
    doc.comparison.applicationMismatches.find((x) => x.path === "custom_providers").classification,
  ).toBe("deprecated-or-migrated");
  expect(fs.readFileSync(calls, "utf8").trim()).toBe("CALL");
  const invocation = fs.readFileSync(nixArgs, "utf8");
  expect(invocation).toMatch(/--offline --no-write-lock-file/);
  expect(invocation).toMatch(/allow-import-from-derivation false/);
  expect(invocation).toMatch(/builtins\.getAttr "test"/);
  expect(fs.statSync(json).mode & 0o777).toBe(0o600);
  expect(fs.statSync(md).mode & 0o777).toBe(0o600);
  expect(Object.keys(doc).sort()).toEqual([
    "applicationInventory",
    "comparison",
    "completeness",
    "limits",
    "local",
    "moduleInventory",
    "provenance",
    "requests",
    "schemaVersion",
    "sourceRoles",
  ]);
  for (const forbidden of [f.target, f.source]) {
    expect(() =>
      run(
        "node",
        [
          cli,
          "audit",
          "--target-repo",
          f.target,
          "--host",
          "x",
          "--source",
          f.source,
          "--no-nix",
          "--output-dir",
          forbidden,
        ],
        f.target,
      ),
    ).toThrow(/outputs must be outside/);
  }
  for (const forbidden of [f.target, f.source]) {
    const child = path.join(forbidden, "new", "reports");
    expect(() =>
      run(
        "node",
        [
          cli,
          "audit",
          "--target-repo",
          f.target,
          "--host",
          "x",
          "--source",
          f.source,
          "--no-nix",
          "--output-dir",
          child,
        ],
        f.target,
      ),
    ).toThrow(/outputs must be outside/);
    expect(fs.existsSync(child)).toBe(false);
  }
});

test("normal backend authenticates and uses exact-ref contents API", () => {
  const f = fixture(),
    bin = temporaryDirectory("gh-"),
    state = temporaryDirectory("state-"),
    log = path.join(bin, "log"),
    treeResponse = path.join(bin, "tree.json");
  run("git", ["commit", "--allow-empty", "-qm", "latest"], f.source);
  const latestSha = run("git", ["rev-parse", "HEAD"], f.source);
  write(
    bin,
    "tree.json",
    JSON.stringify({
      tree: run("git", ["ls-tree", "-r", "--name-only", f.sha], f.source)
        .split("\n")
        .map((pathName) => ({ path: pathName, type: "blob" })),
      truncated: false,
    }),
  );
  write(
    bin,
    "gh",
    `#!/bin/sh\necho "$*" >> '${log}'\n[ "$1 $2" = "auth status" ] && exit 0\n[ "$1" = "--version" ] && exit 0\n[ "$1 $2" = "search code" ] && { printf '%s' '[{"path":"hermes_cli/legacy.py"}]'; exit 0; }\ncase "$2" in *commits/HEAD*) printf '%s' '${latestSha}';; *git/trees*) cat '${treeResponse}';; *contents*) p="${f.source}/${"$"}(printf '%s' "$2" | sed -e 's|.*contents/||' -e 's|?ref=.*||')"; base64 < "$p";; *) printf '[]';; esac\n`,
    0o755,
  );
  run("node", [cli, "audit", "--target-repo", f.target, "--host", "test", "--no-nix"], f.target, {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    XDG_STATE_HOME: state,
  });
  const lines = fs.readFileSync(log, "utf8");
  expect(lines).toMatch(/auth status/);
  expect(lines).toContain(`contents/hermes_cli/config_defaults.py?ref=${f.sha}`);
  expect(lines).not.toMatch(/_\/never/);
  expect(lines).not.toMatch(/search code/);
  write(
    bin,
    "nix",
    `#!/bin/sh\nprintf '%s' '{"available":true,"enabled":true,"mode":"generated","configFileSet":false,"nativeShape":{"enable":"<boolean>"},"applicationShape":{"model":"<string>","mystery":"<number>"}}'\n`,
    0o755,
  );
  const reviewed = run(
    "node",
    [cli, "audit", "--target-repo", f.target, "--host", "review"],
    f.target,
    { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: state },
  );
  const reviewedDoc = JSON.parse(fs.readFileSync(reviewed.split("\n")[0]));
  expect(reviewedDoc.comparison.applicationMismatches[0].classification).toBe(
    "uncertain-needs-targeted-review",
  );
  const reviewedLog = fs.readFileSync(log, "utf8");
  expect(reviewedLog).not.toMatch(/search code/);
  expect(reviewedLog).toContain(`git/trees/${f.sha}?recursive=1`);
  const latest = run(
    "node",
    [cli, "audit", "--target-repo", f.target, "--host", "latest", "--no-nix", "--latest"],
    f.target,
    { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: state },
  );
  const latestDoc = JSON.parse(fs.readFileSync(latest.split("\n")[0]));
  expect(latestDoc.provenance.resolvedSha).toBe(f.sha);
  expect(latestDoc.provenance.latestSha).toBe(latestSha);
  expect(latestDoc.applicationInventory.latestComparison).toEqual({
    addedPaths: [],
    changedPaths: [],
    removedPaths: [],
    sha: latestSha,
  });
  expect(latestDoc.requests.githubApi).toBe(15);
  write(bin, "gh", '#!/bin/sh\n[ "$1" = --version ] && exit 0\nexit 1\n', 0o755);
  expect(() =>
    run("node", [cli, "audit", "--target-repo", f.target, "--host", "test", "--no-nix"], f.target, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_STATE_HOME: state,
    }),
  ).toThrow();
});

test("schema top-level agrees with reports", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(here, "../../skills/auditing-hermes-config/reference/audit.schema.json"),
    ),
  );
  expect(schema.required.sort()).toEqual([
    "applicationInventory",
    "comparison",
    "completeness",
    "limits",
    "local",
    "moduleInventory",
    "provenance",
    "requests",
    "schemaVersion",
    "sourceRoles",
  ]);
});

test("semantic roles resolve moved and split sources and reject invalid preferred files", () => {
  const contents = {
    "hermes_cli/config_defaults.py": "# stale preferred path",
    "src/settings/default_values.py": "DEFAULT_CONFIG = {'x': 1}",
    "src/configuration.py": "_OPEN_DICT_TOP_LEVEL_KEYS = {'x'}",
    "src/config_merge.py":
      "def merge(result, key, value):\n  if isinstance(result[key], dict) and value is None: return result",
    "nix/hermes-module.nix": "options.services.hermes-agent = {};",
    "src/platform_adapter.py":
      'x = value.get("text_batch_delay_seconds", 0)\ny = value.get("text_batch_split_delay_seconds", 0)',
  };
  const read = (pathName) => contents[pathName] ?? null;
  const result = resolveSourceRoles(read, Object.keys(contents));
  expect(result.sourceRoles.find((x) => x.role === "defaults").sources[0].path).toBe(
    "src/settings/default_values.py",
  );
  expect(result.sourceRoles.find((x) => x.role === "config").sources).toHaveLength(2);
  expect(result.sourceRoles.find((x) => x.role === "platform-adapter").sources).toHaveLength(1);
  expect(result.sourceRoles.find((x) => x.role === "migrations").status).toBe(
    "unresolved-no-candidate",
  );
});

test("audit follows renamed, moved, and split authoritative sources", () => {
  const f = fixture(),
    out = temporaryDirectory("moved-audit-"),
    oldConfig = fs.readFileSync(path.join(f.source, "hermes_cli/config.py"), "utf8"),
    splitAt = oldConfig.indexOf("def _deep_merge");
  fs.renameSync(
    path.join(f.source, "hermes_cli/config_defaults.py"),
    path.join(f.source, "hermes_cli/default_values.py"),
  );
  fs.writeFileSync(
    path.join(f.source, "hermes_cli/config_catalog.py"),
    oldConfig.slice(0, splitAt),
  );
  fs.writeFileSync(
    path.join(f.source, "hermes_cli/config_merge.py"),
    `print(_KNOWN_KEYS)\n${oldConfig.slice(splitAt)}`,
  );
  fs.writeFileSync(path.join(f.source, "hermes_cli/config_extra.py"), '_KNOWN_KEYS = {"region"}\n');
  fs.rmSync(path.join(f.source, "hermes_cli/config.py"));
  fs.renameSync(path.join(f.source, "nix/nixosModules.nix"), path.join(f.source, "nix/module.nix"));
  run("git", ["add", "-A"], f.source);
  run("git", ["commit", "-qm", "move sources"], f.source);
  repin(f);
  const stdout = run(
      "node",
      [
        cli,
        "audit",
        "--target-repo",
        f.target,
        "--host",
        "moved",
        "--source",
        f.source,
        "--no-nix",
        "--output-dir",
        out,
      ],
      f.target,
    ),
    doc = JSON.parse(fs.readFileSync(stdout.split("\n")[0]));
  expect(doc.sourceRoles.find((role) => role.role === "config").sources).toHaveLength(3);
  expect(
    doc.applicationInventory.entries.find((entry) => entry.path === "static_flag").evidence.source,
  ).toBe("hermes_cli/default_values.py");
  expect(
    doc.applicationInventory.entries.find((entry) => entry.path === "secrets").evidence.source,
  ).toBe("hermes_cli/config_merge.py");
  expect(
    doc.applicationInventory.entries.find((entry) => entry.path === "providers.<name>.region")
      .evidence.source,
  ).toBe("hermes_cli/config_extra.py");
  expect(doc.moduleInventory.entries[0].evidence.source).toBe("nix/module.nix");
});

test("audit fails clearly when a foundational role is missing", () => {
  const f = fixture();
  fs.rmSync(path.join(f.source, "hermes_cli/config_defaults.py"));
  run("git", ["add", "-A"], f.source);
  run("git", ["commit", "-qm", "remove defaults"], f.source);
  repin(f);
  expect(() =>
    run(
      "node",
      [
        cli,
        "audit",
        "--target-repo",
        f.target,
        "--host",
        "missing",
        "--source",
        f.source,
        "--no-nix",
      ],
      f.target,
    ),
  ).toThrow(/required source role defaults is/);
});

test("semantic roles distinguish required missing and ambiguous authoritative candidates", () => {
  const contents = {
    "a/config.py":
      "_OPEN_DICT_TOP_LEVEL_KEYS = set()\nif isinstance(result[key], dict) and value is None: pass",
    "b/config.py":
      "_OPEN_DICT_TOP_LEVEL_KEYS = set()\nif isinstance(result[key], dict) and value is None: pass",
  };
  const result = resolveSourceRoles((p) => contents[p], Object.keys(contents));
  expect(result.sourceRoles.find((x) => x.role === "defaults").required).toBe(true);
  expect(result.sourceRoles.find((x) => x.role === "defaults").status).toBe(
    "candidates-found-none-validated",
  );
  expect(result.sourceRoles.find((x) => x.role === "config").status).toBe("resolved");
  expect(result.sourceRoles.find((x) => x.role === "config").sources).toHaveLength(2);
});

test("single-source roles reject ambiguous authorities", () => {
  const contents = {
    "a/defaults.py": "DEFAULT_CONFIG = {'a': 1}",
    "b/defaults.py": "DEFAULT_CONFIG = {'b': 2}",
  };
  const role = resolveSourceRoles((p) => contents[p], Object.keys(contents)).sourceRoles.find(
    (x) => x.role === "defaults",
  );
  expect(role.status).toBe("ambiguous-multiple-authoritative");
  expect(role.sources).toEqual([]);
});

test("bounded fallback never claims completeness with uninspected candidates", () => {
  const contents = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [
        `moved/defaults-${String(index).padStart(2, "0")}.py`,
        `DEFAULT_CONFIG = {'value': ${index}}`,
      ]),
    ),
    role = resolveSourceRoles(
      (pathName) => contents[pathName],
      Object.keys(contents),
    ).sourceRoles.find((entry) => entry.role === "defaults");
  expect(role.status).toBe("extractor-unsupported");
  expect(role.candidateCount).toBe(13);
  expect(role.inspectedCount).toBe(12);
  expect(role.sources).toEqual([]);
});

test("latest comparison rejects loss of required or optional pinned coverage", () => {
  const pinned = [
    { role: "defaults", required: true, status: "resolved" },
    { role: "skills", required: false, status: "resolved" },
  ];
  expect(
    sourceRoleCoverageGap(pinned, [
      { role: "defaults", required: true, status: "unresolved-no-candidate" },
      { role: "skills", required: false, status: "resolved" },
    ]).role,
  ).toBe("defaults");
  expect(
    sourceRoleCoverageGap(pinned, [
      { role: "defaults", required: true, status: "resolved" },
      { role: "skills", required: false, status: "extractor-unsupported" },
    ]).role,
  ).toBe("skills");
});

test("truncated recursive trees use bounded exact subtree traversal", () => {
  const calls = [];
  const tree = enumerateGitHubTree((endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes("recursive=1")) return { truncated: true, tree: [] };
    if (endpoint === `git/trees/${"a".repeat(40)}`)
      return {
        truncated: false,
        tree: [
          { path: "root.py", type: "blob" },
          { path: "src", sha: "b".repeat(40), type: "tree" },
        ],
      };
    return { truncated: false, tree: [{ path: "config.py", type: "blob" }] };
  }, "a".repeat(40));
  expect(tree).toEqual(["root.py", "src/config.py"]);
  expect(calls).toEqual([
    `git/trees/${"a".repeat(40)}?recursive=1`,
    `git/trees/${"a".repeat(40)}`,
    `git/trees/${"b".repeat(40)}`,
  ]);
  expect(() =>
    enumerateGitHubTree(
      (endpoint) =>
        endpoint.includes("recursive=1")
          ? { truncated: true, tree: [] }
          : { truncated: false, tree: [{ path: "src", sha: "b".repeat(40), type: "tree" }] },
      "a".repeat(40),
      1,
    ),
  ).toThrow(/exceeded the 1-subtree bound/);
  expect(() => enumerateGitHubTree(() => ({ truncated: true, tree: [] }), "a".repeat(40))).toThrow(
    /truncated non-recursive tree/,
  );
});

test("comment-only migration mention is not migration evidence", () => {
  const f = fixture({ migration: false }),
    out = temporaryDirectory("comment-migration-");
  const stdout = run(
    "node",
    [
      cli,
      "audit",
      "--target-repo",
      f.target,
      "--host",
      "test",
      "--source",
      f.source,
      "--no-nix",
      "--output-dir",
      out,
    ],
    f.target,
  );
  const doc = JSON.parse(fs.readFileSync(stdout.split("\n")[0]));
  expect(
    doc.applicationInventory.entries.some(
      (entry) => entry.path === "custom_providers" && entry.confidence === "explicit-migration",
    ),
  ).toBe(false);
});

test("markdown distinguishes unavailable application comparison", () => {
  const text = markdown({
    applicationInventory: { entries: [] },
    comparison: {
      applicationAvailable: false,
      applicationMismatches: [],
      applicationReason: "Hermes service is disabled",
      available: true,
      moduleMismatches: [],
    },
    limits: [],
    moduleInventory: { entries: [] },
    provenance: { resolvedSha: "a".repeat(40) },
  });
  expect(text).toContain("Application comparison: unavailable (Hermes service is disabled)");
  expect(text).toContain("## Genuinely uncertain\nNot evaluated.");
  expect(text).toContain("## Native mismatches\nNone.");
});
