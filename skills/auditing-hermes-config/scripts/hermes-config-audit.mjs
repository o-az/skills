#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

const SKILL = path.resolve(import.meta.dirname, "..");
const SKILLS_REPO = path.resolve(SKILL, "../..");
const SHA = /^[0-9a-f]{40}$/;
const TARGETED = [
  "hermes_cli/config_defaults.py",
  "hermes_cli/config.py",
  "hermes_cli/config_migrations.py",
  "hermes_cli/mcp_config.py",
  "nix/nixosModules.nix",
  "gateway/config.py",
  "plugins/platforms/whatsapp/adapter.py",
  "hermes_cli/skills_config.py",
  "website/docs/user-guide/configuring-models.md",
  "hermes_cli/cli_commands_mixin.py",
  "website/docs/user-guide/messaging/index.md",
];

const runRaw = (cmd, args, options = {}) =>
  cp.execFileSync(cmd, args, { encoding: "utf8", ...options });
const run = (cmd, args, options = {}) => runRaw(cmd, args, options).trim();
const lineAt = (text, at) => text.slice(0, at).split("\n").length;
const canonical = (p) => fs.realpathSync.native(path.resolve(p));
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
const safePath = (p) => {
  if (p.split("/").includes("_")) {
    throw new Error(`refusing path with an _ component: ${p}`);
  }
  return p;
};

export function argsOf(argv) {
  if (argv[0] !== "audit") {
    throw new Error("the only command is audit");
  }
  const out = {};
  const flags = new Set(["latest", "no-nix"]);
  const allowed = new Set(["target-repo", "host", "source", "output-dir", ...flags]);
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      throw new Error(`unexpected argument: ${argv[i]}`);
    }
    const key = argv[i].slice(2);
    if (!allowed.has(key)) {
      throw new Error(`--${key} is not valid`);
    }
    out[key] = flags.has(key) ? true : argv[++i];
    if (out[key] === undefined) {
      throw new Error(`--${key} needs a value`);
    }
  }
  if (!out["target-repo"] || !out.host) {
    throw new Error("--target-repo and --host are required");
  }
  return out;
}

function lock(target) {
  const file = path.join(target, "flake.lock");
  if (!fs.statSync(file).isFile()) {
    throw new Error("target must contain a readable flake.lock");
  }
  const nodes = JSON.parse(fs.readFileSync(file, "utf8")).nodes || {};
  const node =
    nodes["hermes-agent"] || Object.values(nodes).find((x) => x?.locked?.repo === "hermes-agent");
  const x = node?.locked;
  if (x?.type !== "github" || !x.owner || !x.repo || !SHA.test(x.rev || "")) {
    throw new Error("flake.lock has no exact GitHub hermes-agent revision");
  }
  return { lockedSha: x.rev, owner: x.owner, repo: x.repo };
}

function sourceReader(source, sha) {
  const root = canonical(source);
  run("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`]);
  const memo = new Map();
  return (rel, optional = false) => {
    safePath(rel);
    if (memo.has(rel)) {
      return memo.get(rel);
    }
    try {
      const value = runRaw("git", ["-C", root, "show", `${sha}:${rel}`]);
      memo.set(rel, value);
      return value;
    } catch (error) {
      if (optional) return null;
      throw error;
    }
  };
}

function ghReader(owner, repo, sha) {
  try {
    run("gh", ["--version"]);
    run("gh", ["auth", "status"]);
  } catch {
    throw new Error(
      "authenticated GitHub CLI is required; install gh and run `gh auth login`, or use --source for offline reads",
    );
  }
  const memo = new Map(),
    stats = { api: 0, search: 0 };
  const read = (rel, optional = false) => {
    safePath(rel);
    if (memo.has(rel)) {
      return memo.get(rel);
    }
    try {
      const encoded = rel.split("/").map(encodeURIComponent).join("/");
      stats.api++;
      const body = run("gh", [
        "api",
        `repos/${owner}/${repo}/contents/${encoded}?ref=${sha}`,
        "--jq",
        ".content",
      ]);
      const value = Buffer.from(body.replaceAll(/\s/g, ""), "base64").toString("utf8");
      memo.set(rel, value);
      return value;
    } catch (error) {
      if (optional) return null;
      throw error;
    }
  };
  read.stats = stats;
  return read;
}

function evidence(owner, repo, sha, source, text, needle = "") {
  const lines = text.split("\n"),
    index = lines.findIndex((x) => x.includes(needle));
  if (index === -1) {
    throw new Error(`evidence token not found in ${source}: ${needle}`);
  }
  return {
    excerpt: lines[index].trim().slice(0, 300),
    line: index + 1,
    source,
    url: `https://github.com/${owner}/${repo}/blob/${sha}/${source}#L${index + 1}`,
  };
}

function evidenceAt(owner, repo, sha, source, text, at) {
  const line = lineAt(text, at);
  return {
    excerpt: text.split("\n")[line - 1]?.trim().slice(0, 300) || "",
    line,
    source,
    url: `https://github.com/${owner}/${repo}/blob/${sha}/${source}#L${line}`,
  };
}

const PY_LITERAL = String.raw`
import ast, json, operator, sys
name = sys.argv[1]
tree = ast.parse(sys.stdin.read())
node = None
for statement in sorted(ast.walk(tree), key=lambda n: getattr(n, "lineno", 0)):
    if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in statement.targets):
        node = statement.value
        break
    if isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name) and statement.target.id == name:
        node = statement.value
        break
if node is None:
    raise ValueError(f"{name} literal not found")
if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset" and len(node.args) == 1:
    node = node.args[0]
offsets = {}
binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
unary = {ast.UAdd: operator.pos, ast.USub: operator.neg}
def read(n, parts=()):
    if parts:
        offsets[".".join(parts)] = n.lineno
    if isinstance(n, ast.Constant):
        return n.value
    if isinstance(n, ast.Dict):
        out = {}
        for key_node, value_node in zip(n.keys, n.values):
            key = read(key_node)
            if not isinstance(key, str):
                raise ValueError("dict keys must be strings")
            out[key] = read(value_node, parts + (key,))
        return out
    if isinstance(n, (ast.List, ast.Tuple)):
        return [read(x, parts) for x in n.elts]
    if isinstance(n, ast.Set):
        return {"__hermes_audit_set__": [read(x) for x in n.elts]}
    if isinstance(n, ast.UnaryOp) and type(n.op) in unary:
        return unary[type(n.op)](read(n.operand, parts))
    if isinstance(n, ast.BinOp) and type(n.op) in binary:
        return binary[type(n.op)](read(n.left, parts), read(n.right, parts))
    raise ValueError(f"non-literal Python expression {type(n).__name__} at line {n.lineno}")
print(json.dumps({"value": read(node), "offsets": offsets}))
`;

export function parsePyDefault(text, name = "DEFAULT_CONFIG") {
  let parsed;
  try {
    parsed = JSON.parse(runRaw("python3", ["-c", PY_LITERAL, name], { input: text }));
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim(), { cause: error });
  }
  const revive = (value) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "__hermes_audit_set__")) {
      return new Set(value.__hermes_audit_set__.map(revive));
    }
    if (Array.isArray(value)) {
      return value.map(revive);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
    }
    return value;
  };
  const value = revive(parsed.value),
    starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  if (value && typeof value === "object" && !(value instanceof Set)) {
    Object.defineProperty(value, "__sourceOffsets", {
      value: Object.fromEntries(
        Object.entries(parsed.offsets).map(([key, line]) => [key, starts[line - 1]]),
      ),
    });
  }
  return value;
}

export function flatten(value, prefix = "", offsets = value?.__sourceOffsets || {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      return entries.flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k, offsets));
    }
  }
  return [
    {
      at: offsets[prefix],
      path: prefix,
      type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      value,
    },
  ];
}

function applicationInventory(files, provenance) {
  const defaultsText = files[TARGETED[0]],
    configText = files[TARGETED[1]] || "",
    migrationsText = files[TARGETED[2]] || "",
    mcpText = files[TARGETED[3]] || "",
    defaults = parsePyDefault(defaultsText),
    diagnostics = [];
  const entries = flatten(defaults).map((entry) => ({
    condition: "available in the base configuration",
    confidence: "base-default",
    default: entry.value,
    defaultShape: entry.type,
    dynamic: false,
    evidence: evidenceAt(
      provenance.owner,
      provenance.repo,
      provenance.resolvedSha,
      TARGETED[0],
      defaultsText,
      entry.at || 0,
    ),
    expected: "accepted shape not proven by a default",
    migration: "not-indicated",
    path: entry.path,
  }));
  const literal = (text, name) => {
    try {
      const value = parsePyDefault(text, name);
      return value instanceof Set ? [...value] : value;
    } catch (error) {
      diagnostics.push(`${name}: ${error.message} (${text.length} source bytes)`);
      return null;
    }
  };
  const memberEvidence = (source, text, declaration, field) => {
    const declarationAt = text.indexOf(declaration);
    if (declarationAt === -1) {
      throw new Error(`${declaration} not found in ${source}`);
    }
    const quoted = new RegExp(
      `["']${field.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}["']`,
      "g",
    );
    quoted.lastIndex = declarationAt;
    const match = quoted.exec(text);
    if (!match) {
      throw new Error(`${field} not found in ${declaration}`);
    }
    return evidenceAt(
      provenance.owner,
      provenance.repo,
      provenance.resolvedSha,
      source,
      text,
      match.index,
    );
  };
  const addFields = (root, fields, condition, source, text, declaration, confidence) => {
    if (!Array.isArray(fields)) {
      return;
    }
    for (const field of fields) {
      entries.push({
        path: `${root}.${field}`,
        expected: "source-defined",
        condition,
        dynamic: true,
        confidence,
        migration: "not-indicated",
        evidence: memberEvidence(source, text, declaration, field),
      });
    }
  };
  const addContract = (pathName, source, needle, options = {}) => {
    if (!files[source]?.includes(needle)) {
      return;
    }
    entries.push({
      condition: options.condition || "when the containing feature is configured",
      confidence: options.confidence || "known-consumed-field",
      dynamic: options.dynamic ?? true,
      evidence: evidence(
        provenance.owner,
        provenance.repo,
        provenance.resolvedSha,
        source,
        files[source],
        needle,
      ),
      expected: options.expected || "source-defined",
      migration: options.migration || "not-indicated",
      path: pathName,
    });
  };
  const usedDictionaryFields = (text) => {
    const fields = new Map();
    for (const match of text.matchAll(
      /\b(?:server_config|config)\s*(?:\[\s*["']([^"']+)["']\s*\]|\.get\(\s*["']([^"']+)["'])/g,
    )) {
      const field = match[1] || match[2];
      if (field !== "mcp_servers" && !fields.has(field)) {
        fields.set(field, match.index);
      }
    }
    return fields;
  };
  const providerFields = literal(configText, "_KNOWN_KEYS"),
    providerAliases = literal(configText, "_CAMEL_ALIASES") || {},
    declaredProviderAliases = new Set(Object.keys(providerAliases)),
    platforms = literal(configText, "_PLATFORM_CONTAINER_KEYS"),
    openRoots = literal(configText, "_OPEN_DICT_TOP_LEVEL_KEYS"),
    schemaRoots = literal(configText, "_SCHEMA_DEFINED_DICT_KEYS"),
    dynamicRoots = literal(configText, "_DYNAMIC_TOP_LEVEL_KEYS"),
    mcpFields = usedDictionaryFields(mcpText);
  if (mcpFields.size === 0 && mcpText.includes("MCP_SERVER_KNOWN_FIELDS")) {
    const legacyFields = literal(mcpText, "MCP_SERVER_KNOWN_FIELDS") || [];
    for (const field of legacyFields) {
      mcpFields.set(field, mcpText.indexOf(field));
    }
  }
  addFields(
    "providers.<name>",
    providerFields,
    "when a named custom provider is configured",
    TARGETED[1],
    configText,
    "_KNOWN_KEYS",
    "known-consumed-field",
  );
  if (
    configText.includes('"api_key_env" in entry') &&
    !Object.hasOwn(providerAliases, "api_key_env")
  ) {
    providerAliases.api_key_env = "key_env";
  }
  for (const [alias, target] of Object.entries(providerAliases)) {
    entries.push({
      path: `providers.<name>.${alias}`,
      expected: "source-defined",
      condition: `alias normalized to providers.<name>.${target}`,
      dynamic: true,
      confidence: "known-consumed-field",
      migration: "renamed-alias",
      evidence: declaredProviderAliases.has(alias)
        ? memberEvidence(TARGETED[1], configText, "_CAMEL_ALIASES", alias)
        : evidence(
            provenance.owner,
            provenance.repo,
            provenance.resolvedSha,
            TARGETED[1],
            configText,
            '"api_key_env" in entry',
          ),
    });
  }
  for (const [field, at] of mcpFields) {
    entries.push({
      path: `mcp_servers.<name>.${field}`,
      expected: "source-defined",
      condition: "when a named MCP server is configured",
      dynamic: true,
      confidence: "known-consumed-field",
      migration: "not-indicated",
      evidence: evidenceAt(
        provenance.owner,
        provenance.repo,
        provenance.resolvedSha,
        TARGETED[3],
        mcpText,
        at,
      ),
    });
  }
  addContract("mcp_servers.<name>.env.*", TARGETED[3], 'server_config["env"] = explicit_env', {
    condition: "when a named stdio MCP server needs environment variables",
    expected: "string environment value",
  });
  for (const [roots, declaration, suffix] of [
    [openRoots, "_OPEN_DICT_TOP_LEVEL_KEYS", ".*"],
    [schemaRoots, "_SCHEMA_DEFINED_DICT_KEYS", ".*"],
    [dynamicRoots, "_DYNAMIC_TOP_LEVEL_KEYS", ".*"],
    [platforms, "_PLATFORM_CONTAINER_KEYS", ".<name>.*"],
  ]) {
    if (Array.isArray(roots))
      for (const root of roots)
        entries.push({
          path: `${root}${suffix}`,
          expected: "open dictionary value",
          condition: `when ${root} contains an extension entry`,
          dynamic: true,
          confidence: "validation-open-dictionary",
          migration: "not-indicated",
          evidence: memberEvidence(TARGETED[1], configText, declaration, root),
        });
  }
  if (
    /config\.get\(\s*["']custom_providers["']\s*\)/.test(migrationsText) &&
    /config\[\s*["']providers["']\s*\]\s*=/.test(migrationsText) &&
    /config\.pop\(\s*["']custom_providers["']/.test(migrationsText)
  ) {
    entries.push({
      path: "custom_providers",
      expected: "array",
      condition: "legacy configuration only",
      dynamic: true,
      confidence: "explicit-migration",
      migration: "deprecated-or-migrated-to-providers",
      evidence: evidence(
        provenance.owner,
        provenance.repo,
        provenance.resolvedSha,
        TARGETED[2],
        migrationsText,
        'config.pop("custom_providers"',
      ),
    });
  }
  addContract("model.provider", TARGETED[8], "written to `model.provider`", {
    condition:
      "after the main model has been configured; the initial model value may be an empty string sentinel",
    expected: "provider name string",
  });
  addContract("model.default", TARGETED[8], "written to `model.provider`", {
    condition:
      "after the main model has been configured; the initial model value may be an empty string sentinel",
    expected: "model identifier string",
  });
  addContract("skills.disabled", TARGETED[7], 'skills_cfg.get("disabled")', {
    expected: "array of skill names (a scalar is also normalized as one name)",
  });
  addContract(
    "agent.reasoning_effort",
    TARGETED[9],
    'save_config_value("agent.reasoning_effort", arg)',
    {
      expected: "reasoning level string",
      condition: "when a persistent global reasoning level is configured",
    },
  );
  addContract(
    "display.background_process_notifications",
    TARGETED[10],
    "`display.background_process_notifications`",
    {
      expected: "all, result, error, off, or false",
      condition: "when gateway background-process notifications are configured",
    },
  );
  addContract("plugins.disabled", TARGETED[2], 'plugins_cfg.get("disabled", [])', {
    expected: "array of plugin names",
    condition: "when plugins are explicitly denied",
  });
  addContract(
    "platforms.<name>.enabled",
    TARGETED[5],
    'plat_data["enabled"] = platform_cfg["enabled"]',
    {
      condition: "for a recognized built-in or registered plugin platform",
      expected: "boolean",
    },
  );
  for (const [field, needle, expected = "source-defined"] of [
    ["require_mention", 'if "require_mention" in platform_cfg:', "boolean"],
    ["send_read_receipts", 'if "send_read_receipts" in platform_cfg:', "boolean"],
    ["group_policy", 'if "group_policy" in platform_cfg:', "string policy"],
    [
      "group_allow_from",
      'if "group_allow_from" in platform_cfg:',
      "array or comma-separated string of group identifiers",
    ],
  ]) {
    addContract(`platforms.whatsapp.${field}`, TARGETED[5], needle, {
      expected,
      condition: "when the WhatsApp platform is configured",
    });
  }
  for (const field of ["text_batch_delay_seconds", "text_batch_split_delay_seconds"]) {
    addContract(`platforms.whatsapp.extra.${field}`, TARGETED[6], `"${field}",`, {
      expected: "number of seconds",
      condition: "when WhatsApp text batching is configured",
    });
  }
  addContract("secrets", TARGETED[1], "and value is None:", {
    confidence: "explicit-invalid-shape",
    dynamic: false,
    expected: "mapping; null does not replace the default mapping",
    migration: "obsolete-or-wrong-shape",
  });
  return {
    completeness:
      "Defaults plus targeted provider, MCP, platform, open-dictionary, and migration evidence; generated plugin contracts are not proven complete.",
    diagnostics,
    entries,
  };
}

function nixMask(text) {
  const out = [...text];
  for (let i = 0; i < text.length; i++) {
    const blank = () => {
      if (out[i] !== "\n") {
        out[i] = " ";
      }
    };
    if (text[i] === "#") {
      while (i < text.length && text[i] !== "\n") {
        blank();
        i++;
      }
      i--;
    } else if (text.startsWith("/*", i)) {
      blank();
      i++;
      blank();
      while (++i < text.length && !text.startsWith("*/", i)) {
        blank();
      }
      blank();
      i++;
      blank();
    } else if (text[i] === '"') {
      blank();
      while (++i < text.length && text[i] !== '"') {
        blank();
        if (text[i] === "\\") {
          i++;
          blank();
        }
      }
      blank();
    } else if (text.startsWith("''", i)) {
      blank();
      i++;
      blank();
      while (++i < text.length) {
        if (text.startsWith("''", i) && !["$", "'"].includes(text[i + 2])) {
          break;
        }
        blank();
      }
      if (i < text.length) {
        blank();
        i++;
        blank();
      }
    }
  }
  return out.join("");
}

function scanBalanced(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") {
      depth++;
    } else if (code[i] === "}" && --depth === 0) {
      return i;
    }
  }
  throw new Error("unbalanced Nix attribute set");
}

function assignments(code, open, close) {
  const result = [];
  let depth = 0;
  for (let i = open; i <= close; i++) {
    if (code[i] === "{") {
      depth++;
    } else if (code[i] === "}") {
      depth--;
    }
    if (depth !== 1) {
      continue;
    }
    const m = code.slice(i).match(/^([A-Za-z_][\w-]*)\s*=/);
    if (m) {
      result.push({ at: i, name: m[1], valueAt: i + m[0].length });
      i += m[0].length - 1;
    }
  }
  return result;
}

function expressionEnd(code, start, limit) {
  const depths = { "(": 0, "[": 0, "{": 0 };
  const closes = { ")": "(", "]": "[", "}": "{" };
  for (let i = start; i < limit; i++) {
    if (Object.hasOwn(depths, code[i])) {
      depths[code[i]]++;
    } else if (Object.hasOwn(closes, code[i])) {
      depths[closes[code[i]]]--;
    } else if (code[i] === ";" && Object.values(depths).every((depth) => depth === 0)) {
      return i;
    }
  }
  throw new Error("unterminated Nix option metadata expression");
}

function moduleInventory(text, provenance) {
  const entries = [];
  const code = nixMask(text),
    marker = code.indexOf("options.services.hermes-agent");
  if (marker === -1) {
    throw new Error("native module option root not found");
  }
  const root = code.indexOf("{", marker),
    end = scanBalanced(code, root);
  const walk = (open, close, prefix) => {
    for (const a of assignments(code, open, close)) {
      const tail = code.slice(a.valueAt, close),
        kind = /^(?:lib\.)?(mkEnableOption|mkOption)\b/.exec(tail.trimStart())?.[1];
      if (!kind && tail.trimStart().startsWith("{")) {
        const child = code.indexOf("{", a.valueAt);
        walk(child, scanBalanced(code, child), [...prefix, a.name]);
        continue;
      }
      if (!kind) {
        throw new Error(
          `unsupported direct native option declaration at line ${lineAt(text, a.at)}: ${a.name}`,
        );
      }
      const optionOpen = kind === "mkOption" ? code.indexOf("{", a.valueAt) : -1;
      const optionClose = kind === "mkOption" ? scanBalanced(code, optionOpen) : -1;
      const optionAssignments =
        kind === "mkOption"
          ? new Map(assignments(code, optionOpen, optionClose).map((item) => [item.name, item]))
          : new Map();
      const line = lineAt(text, a.at);
      const take = (key) => {
        const item = optionAssignments.get(key);
        return item
          ? text.slice(item.valueAt, expressionEnd(code, item.valueAt, optionClose)).trim()
          : null;
      };
      const local = text.split("\n")[line - 1] || "";
      const fullPath = ["services.hermes-agent", ...prefix, a.name].join(".");
      entries.push({
        default: kind === "mkEnableOption" ? false : take("default"),
        description:
          kind === "mkEnableOption"
            ? text
                .slice(a.valueAt, expressionEnd(code, a.valueAt, close))
                .replace(/^(?:lib\.)?mkEnableOption\s*/, "")
                .trim()
            : take("description"),
        evidence: {
          excerpt: local.trim(),
          line,
          source: TARGETED[4],
          url: `https://github.com/${provenance.owner}/${provenance.repo}/blob/${provenance.resolvedSha}/${TARGETED[4]}#L${line}`,
        },
        example: take("example"),
        mapping: /^services\.hermes-agent\.(?:settings|mcpServers)(?:\.|$)/.test(fullPath)
          ? "generates-application-config"
          : fullPath === "services.hermes-agent.configFile"
            ? "selects-application-config"
            : "service-behavior",
        path: fullPath,
        type: kind === "mkEnableOption" ? "types.bool" : take("type"),
      });
      if (kind === "mkOption") {
        const nested = code.indexOf("options =", optionOpen);
        if (nested > optionOpen && nested < optionClose) {
          const child = code.indexOf("{", nested);
          walk(child, scanBalanced(code, child), [
            ...prefix,
            a.name,
            ...(a.name === "mcpServers" ? ["<name>"] : []),
          ]);
        }
      }
    }
  };
  walk(root, end, []);
  return {
    completeness:
      "Bounded structural scan of services.hermes-agent options; complex generated options may require review.",
    entries,
  };
}

function evaluate(target, host, disabled) {
  if (disabled) {
    return {
      available: false,
      reason: "--no-nix: effective comparison is unavailable",
    };
  }
  // Redaction happens in Nix, before JSON serialization crosses the process boundary.
  const expr = `cs: let
    c = (builtins.getAttr ${JSON.stringify(host)} cs).config.services.hermes-agent;
    recursiveUpdate = lhs: rhs: lhs // builtins.mapAttrs (name: value:
      if builtins.isAttrs value && builtins.isAttrs (lhs.\${name} or null)
      then recursiveUpdate lhs.\${name} value else value) rhs;
    marker = v: if builtins.isAttrs v && (v.type or null) == "derivation" then "<derivation>"
      else if builtins.isAttrs v then builtins.mapAttrs (_: marker) v
      else if builtins.isList v then "<array>"
      else if builtins.isBool v then "<boolean>"
      else if builtins.isInt v || builtins.isFloat v then "<number>"
      else if builtins.isString v then "<string>"
      else if builtins.isPath v then "<path>"
      else if builtins.isFunction v then "<function>"
      else if v == null then "<null>" else "<unknown>";
    set = c.configFile or null;
    generated = recursiveUpdate { terminal.cwd = "<redacted>"; } (c.settings or {});
  in { available = true; enabled = c.enable; mode = if !c.enable then "disabled"
    else if set == null then "generated" else "configFile";
    configFileSet = set != null; nativeShape = marker c;
    applicationShape = if c.enable && set == null then marker generated else null; }`;
  try {
    const x = JSON.parse(
      run("nix", [
        "eval",
        "--extra-experimental-features",
        "nix-command flakes",
        "--json",
        "--offline",
        "--no-write-lock-file",
        "--option",
        "allow-import-from-derivation",
        "false",
        `${target}#nixosConfigurations`,
        "--apply",
        expr,
      ]),
    );
    return {
      applicationShape: x.applicationShape,
      available: true,
      configFileSet: x.configFileSet,
      enabled: x.enabled,
      mode: x.mode,
      nativeShape: x.nativeShape || {},
    };
  } catch (error) {
    return {
      available: false,
      reason: `nix eval failed: ${String(error.message).split("\n")[0]}`,
    };
  }
}

const matches = (pathName, pattern) => {
  const actual = pathName.split("."),
    expected = pattern.split(".");
  if (expected.at(-1) === "*") {
    if (actual.length < expected.length) {
      return false;
    }
  } else if (actual.length !== expected.length) {
    return false;
  }
  return expected.every((p, i) =>
    p === "*" || p === "<name>" ? actual[i] !== undefined : p === actual[i],
  );
};

function flattenShape(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      return entries.flatMap(([key, child]) =>
        flattenShape(child, prefix ? `${prefix}.${key}` : key),
      );
    }
    return [{ path: prefix, type: "object" }];
  }
  const marker = typeof value === "string" && /^<([^>]+)>$/.exec(value);
  return [{ path: prefix, type: marker ? marker[1] : typeof value }];
}

const moduleOwns = (entry, candidate) => {
  if (matches(candidate, entry.path)) {
    return true;
  }
  if (!candidate.startsWith(`${entry.path}.`)) {
    return false;
  }
  return (
    /attrs|submodule|anything/i.test(entry.type || "") ||
    /\.(settings|environment|mcpServers)$/.test(entry.path)
  );
};

function comparison(app, mod, local) {
  if (!local.available) {
    return { available: false, reason: local.reason };
  }
  const appValues = local.applicationShape
      ? flattenShape(local.applicationShape || {}).filter((x) => x.path)
      : [],
    nativeValues = flattenShape(local.nativeShape || {})
      .filter((x) => x.path)
      .map((x) => ({ ...x, path: `services.hermes-agent.${x.path}` }));
  const classifyApplication = (value) => {
    const candidates = app.entries.filter((entry) => matches(value.path, entry.path));
    if (candidates.length === 0) {
      return { ...value, classification: "uncertain-needs-targeted-review" };
    }
    const entry =
      candidates.find((candidate) => candidate.confidence === "explicit-invalid-shape") ||
      candidates.find((candidate) => candidate.confidence === "known-consumed-field") ||
      candidates.find((candidate) => !candidate.dynamic) ||
      candidates[0];
    if (entry.migration !== "not-indicated") {
      return {
        ...value,
        classification: entry.migration.startsWith("deprecated-or-migrated")
          ? "deprecated-or-migrated"
          : entry.migration,
        evidence: entry.evidence,
      };
    }
    if (entry.dynamic && entry.confidence !== "known-consumed-field") {
      return {
        ...value,
        classification: "uncertain-needs-targeted-review",
        evidence: entry.evidence,
      };
    }
    return {
      ...value,
      classification: entry.dynamic ? "valid-dynamic-extension" : "current",
      evidence: entry.evidence,
    };
  };
  const applicationResults = appValues.map(classifyApplication),
    nativeMismatches = nativeValues
      .filter((value) => !mod.entries.some((entry) => moduleOwns(entry, value.path)))
      .map((value) => ({
        ...value,
        classification: "uncertain-needs-targeted-review",
      }));
  return {
    available: true,
    applicationAvailable: Boolean(local.applicationShape),
    ...(local.applicationShape
      ? {}
      : {
          applicationReason: local.enabled
            ? "configFile selects unresolved application configuration"
            : "Hermes service is disabled",
        }),
    presentInGeneratedOverride: applicationResults
      .filter((result) => ["current", "valid-dynamic-extension"].includes(result.classification))
      .map((result) => result.path),
    applicationResults,
    catalogPathsAbsentFromGeneratedOverride: local.applicationShape
      ? app.entries
          .map((x) => x.path)
          .filter(
            (pathName) =>
              !pathName.includes("*") &&
              !pathName.includes("<name>") &&
              !appValues.some((value) => matches(value.path, pathName)),
          )
      : [],
    applicationMismatches: applicationResults.filter(
      (result) => !["current", "valid-dynamic-extension"].includes(result.classification),
    ),
    presentInEvaluatedNativeShape: mod.entries
      .filter((entry) => nativeValues.some((value) => moduleOwns(entry, value.path)))
      .map((entry) => entry.path),
    catalogPathsAbsentFromEvaluatedNativeShape: mod.entries
      .filter((entry) => !nativeValues.some((value) => moduleOwns(entry, value.path)))
      .map((entry) => entry.path),
    moduleMismatches: nativeMismatches,
  };
}

function inventoryDiff(pinned, latest, sha) {
  const pinnedByPath = new Map(pinned.entries.map((entry) => [entry.path, entry])),
    latestByPath = new Map(latest.entries.map((entry) => [entry.path, entry])),
    comparable = ({ evidence: _evidence, ...entry }) => entry;
  return {
    addedPaths: [...latestByPath.keys()].filter((pathName) => !pinnedByPath.has(pathName)),
    changedPaths: [...pinnedByPath.keys()].filter(
      (pathName) =>
        latestByPath.has(pathName) &&
        JSON.stringify(comparable(pinnedByPath.get(pathName))) !==
          JSON.stringify(comparable(latestByPath.get(pathName))),
    ),
    removedPaths: [...pinnedByPath.keys()].filter((pathName) => !latestByPath.has(pathName)),
    sha,
  };
}

function outputs(dir, target, source) {
  const absolute = path.resolve(dir),
    forbiddenRoots = [target, canonical(SKILLS_REPO), source && canonical(source)].filter(Boolean);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    ancestor = path.dirname(ancestor);
  }
  const prospective = path.join(canonical(ancestor), path.relative(ancestor, absolute));
  for (const forbidden of forbiddenRoots) {
    if (inside(prospective, forbidden))
      throw new Error("outputs must be outside target and skills repositories");
  }
  fs.mkdirSync(absolute, { recursive: true });
  const base = canonical(absolute);
  for (const forbidden of forbiddenRoots) {
    if (inside(base, forbidden))
      throw new Error("outputs must be outside target and skills repositories");
  }
  const reports = [path.join(base, "audit.json"), path.join(base, "audit.md")];
  for (const report of reports) {
    if (fs.existsSync(report) && fs.lstatSync(report).isSymbolicLink())
      throw new Error(`refusing report symlink: ${report}`);
  }
  return reports;
}

export function markdown(doc) {
  const native = doc.comparison.available ? doc.comparison.moduleMismatches : [],
    application =
      doc.comparison.available && doc.comparison.applicationAvailable
        ? doc.comparison.applicationMismatches
        : null,
    render = (items) =>
      items.length > 0
        ? items
            .map(
              (x) =>
                `- \`${x.path}\`: ${x.classification}${x.evidence ? ` — ${x.evidence.url}` : ""}`,
            )
            .join("\n")
        : "None.";
  const results = application ? doc.comparison.applicationResults : [],
    group = (classification) => results.filter((x) => classification.includes(x.classification)),
    renderGroup = (classification) =>
      application ? render(group(classification)) : "Not evaluated.",
    completeness = doc.completeness || {
      inventory: "partial-dynamic-contracts-not-proven-complete",
      localComparison: application ? "complete-for-evaluated-settings" : "unavailable",
      overall: "partial",
    },
    requests = doc.requests || { githubApi: 0, githubSearch: 0 };
  return `# Hermes configuration audit\n\nPinned revision: \`${doc.provenance.resolvedSha}\`\n\n- Overall status: **${completeness.overall}**\n- Local comparison: **${completeness.localComparison}** (${results.length} application leaves; one host evaluation)\n- Application comparison: ${application ? "available" : `unavailable (${doc.comparison.applicationReason || doc.comparison.reason})`}\n- Upstream inventory: **${completeness.inventory}** (${doc.applicationInventory.entries.length} application entries; ${doc.moduleInventory.entries.length} native module entries)\n- GitHub requests: ${requests.githubApi} API, ${requests.githubSearch} search\n\n## Configured and current\n${renderGroup(["current"])}\n\n## Valid dynamic or conditional\n${renderGroup(["valid-dynamic-extension"])}\n\n## Deprecated, migrated, or wrong shape\n${renderGroup(["deprecated-or-migrated", "obsolete-or-wrong-shape"])}\n\n## Invalid or ignored\n${renderGroup(["ignored-or-nonexistent"])}\n\n## Genuinely uncertain\n${renderGroup(["uncertain-needs-targeted-review"])}\n\n## Native mismatches\n${doc.comparison.available ? render(native) : "Not evaluated."}\n\n## Limits\n${doc.limits.map((x) => `- ${x}`).join("\n")}\n`;
}

export function audit(options) {
  const target = canonical(options["target-repo"]),
    locked = lock(target);
  const resolvedSha = locked.lockedSha;
  if (!SHA.test(resolvedSha)) {
    throw new Error("GitHub did not return an exact SHA");
  }
  const read = options.source
    ? sourceReader(options.source, resolvedSha)
    : ghReader(locked.owner, locked.repo, resolvedSha);
  const files = Object.fromEntries(
    TARGETED.map((sourcePath, index) => [sourcePath, read(sourcePath, index >= 5)]),
  );
  const provenance = {
    selection: "locked",
    ...locked,
    resolvedSha,
    owner: locked.owner,
    repo: locked.repo,
    targetRepo: target,
    host: options.host,
    backend: options.source ? "git-object" : "gh-api",
  };
  const application = applicationInventory(files, provenance),
    module = moduleInventory(files[TARGETED[4]], provenance),
    local = evaluate(target, options.host, options["no-nix"]);
  if (options.latest) {
    const latestReadForSha = ghReader(locked.owner, locked.repo, resolvedSha),
      latestSha = run("gh", [
        "api",
        `repos/${locked.owner}/${locked.repo}/commits/HEAD`,
        "--jq",
        ".sha",
      ]);
    if (!SHA.test(latestSha)) {
      throw new Error("GitHub did not return an exact latest SHA");
    }
    const latestRead =
        latestSha === resolvedSha
          ? latestReadForSha
          : ghReader(locked.owner, locked.repo, latestSha),
      latestFiles = Object.fromEntries(
        TARGETED.map((sourcePath, index) => [sourcePath, latestRead(sourcePath, index >= 5)]),
      ),
      latestProvenance = { ...provenance, resolvedSha: latestSha },
      latestApplication = applicationInventory(latestFiles, latestProvenance),
      latestModule = moduleInventory(latestFiles[TARGETED[4]], latestProvenance);
    provenance.latestSha = latestSha;
    provenance.resolvedAt = new Date().toISOString();
    application.latestComparison = inventoryDiff(application, latestApplication, latestSha);
    module.latestComparison = inventoryDiff(module, latestModule, latestSha);
  }
  const doc = {
    applicationInventory: application,
    comparison: comparison(application, module, local),
    completeness: {
      inventory: "partial-dynamic-contracts-not-proven-complete",
      localComparison: local.available ? "complete-for-evaluated-settings" : "unavailable",
      overall: local.available ? "partial" : "partial-local-evaluation-unavailable",
    },
    limits: [
      application.completeness,
      ...application.diagnostics.map(
        (diagnostic) => `Application contract extraction: ${diagnostic}`,
      ),
      module.completeness,
      ...(local.available
        ? [
            ...(local.applicationShape
              ? [
                  "The local application surface is the Nix-generated override shape, not the final mutable config.yaml.",
                ]
              : []),
            ...(local.configFileSet
              ? ["configFile contents are unresolved without realization."]
              : []),
          ]
        : [local.reason]),
    ],
    local,
    moduleInventory: module,
    provenance,
    requests: {
      githubApi: read.stats?.api || 0,
      githubSearch: read.stats?.search || 0,
    },
    schemaVersion: 5,
  };
  doc.requests.githubApi = read.stats?.api || 0;
  return doc;
}

function main() {
  const options = argsOf(process.argv.slice(2));
  const target = canonical(options["target-repo"]);
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const dir =
    options["output-dir"] ||
    path.join(state, "hermes-config-audit", `${options.host}-${Date.now()}`);
  const [json, md] = outputs(dir, target, options.source),
    doc = audit(options);
  fs.writeFileSync(json, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(json, 0o600);
  fs.writeFileSync(md, markdown(doc), { mode: 0o600 });
  fs.chmodSync(md, 0o600);
  console.log(json);
  console.log(md);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
