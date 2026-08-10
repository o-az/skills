#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

const SKILL = path.resolve(import.meta.dirname, "..");
const SKILLS_REPO = path.resolve(SKILL, "../..");
const SHA = /^[0-9a-f]{40}$/;
const ROLE_SPECS = [
  {
    role: "defaults",
    required: true,
    preferred: ["hermes_cli/config_defaults.py"],
    path: /(?:default|config).*\.py$/i,
    capabilities: { literal: /\bDEFAULT_CONFIG\s*=/ },
    unsupported: /\b(?:BaseModel|dataclass)\b.*(?:Config|Settings)/s,
  },
  {
    role: "config",
    required: true,
    preferred: ["hermes_cli/config.py"],
    path: /config.*\.py$/i,
    capabilities: {
      catalog:
        /(?:^|\n)\s*(?:_OPEN_DICT_TOP_LEVEL_KEYS|_SCHEMA_DEFINED_DICT_KEYS|_KNOWN_KEYS)(?:\s*:[^=\n]+)?\s*=/,
      deepMerge:
        /isinstance\([^\n]+dict\)[^\n]+value is None|value is None[^\n]+isinstance\([^\n]+dict\)/,
    },
    multiple: true,
    unsupported: /\b(?:BaseModel|dataclass)\b.*(?:Config|Settings)/s,
  },
  {
    role: "migrations",
    required: false,
    preferred: ["hermes_cli/config_migrations.py"],
    path: /migrat.*\.py$/i,
    capabilities: {
      customProviders:
        /config\.get\(\s*["']custom_providers["']\s*\)[\s\S]*config\[\s*["']providers["']\s*\]\s*=[\s\S]*config\.pop\(\s*["']custom_providers["']/,
      disabledPlugins: /plugins_cfg\.get\(\s*["']disabled["']\s*,\s*\[\]\s*\)/,
    },
    multiple: true,
  },
  {
    role: "mcp",
    required: false,
    preferred: ["hermes_cli/mcp_config.py"],
    path: /mcp.*\.py$/i,
    capabilities: { serverFields: /\bserver_config\s*(?:\[|\.get\()/ },
    multiple: true,
  },
  {
    role: "native-nix-module",
    required: true,
    preferred: ["nix/nixosModules.nix"],
    path: /(?:module|nixos).*\.nix$/i,
    capabilities: { options: /options\.services\.hermes-agent/ },
  },
  {
    role: "platform-loader",
    required: false,
    preferred: ["gateway/config.py"],
    path: /(?:gateway|platform|config).*\.py$/i,
    capabilities: {
      enabled: /plat_data\["enabled"\]\s*=\s*platform_cfg\["enabled"\]/,
      whatsappFields:
        /"require_mention" in platform_cfg:[\s\S]*"send_read_receipts" in platform_cfg:/,
    },
    multiple: true,
  },
  {
    role: "platform-adapter",
    required: false,
    preferred: ["plugins/platforms/whatsapp/adapter.py"],
    path: /(?:whatsapp|adapter|platform).*\.py$/i,
    capabilities: {
      whatsappBatching: /"text_batch_delay_seconds"[\s\S]*"text_batch_split_delay_seconds"/,
    },
    multiple: true,
  },
  {
    role: "skills",
    required: false,
    preferred: ["hermes_cli/skills_config.py"],
    path: /skills.*\.py$/i,
    capabilities: { disabled: /skills_cfg\.get\(\s*["']disabled["']/ },
    multiple: true,
  },
  {
    role: "model-docs",
    required: false,
    preferred: ["website/docs/user-guide/configuring-models.md"],
    path: /(?:model|config).*(?:\.md|\.mdx)$/i,
    capabilities: { provider: /written to `model\.provider`/ },
    multiple: true,
  },
  {
    role: "cli-config",
    required: false,
    preferred: ["hermes_cli/cli_commands_mixin.py"],
    path: /(?:cli|command).*\.py$/i,
    capabilities: { reasoning: /save_config_value\(["']agent\.reasoning_effort["']/ },
    multiple: true,
  },
  {
    role: "messaging-docs",
    required: false,
    preferred: ["website/docs/user-guide/messaging/index.md"],
    path: /(?:messag|platform).*(?:\.md|\.mdx)$/i,
    capabilities: { notifications: /`display\.background_process_notifications`/ },
    multiple: true,
  },
];
const BAD_PATH =
  /(?:^|\/)(?:tests?|fixtures?|generated|translations?|i18n|locales?|examples?|compat(?:ibility)?|legacy|snapshots?|third_party|vendor)(?:\/|$)/i;

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
  const read = (rel, optional = false) => {
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
  read.tree = () =>
    runRaw("git", ["-C", root, "ls-tree", "-r", "--name-only", sha])
      .trim()
      .split("\n")
      .filter(Boolean);
  read.stats = { api: 0, search: 0, trees: 1 };
  return read;
}

export function enumerateGitHubTree(api, sha, limit = 256) {
  const recursive = api(`git/trees/${sha}?recursive=1`);
  if (!recursive.truncated) {
    return (recursive.tree || []).filter((x) => x.type === "blob").map((x) => x.path);
  }
  const files = [],
    queue = [{ path: "", sha }];
  for (let visited = 0; queue.length && visited < limit; visited++) {
    const item = queue.shift(),
      subtree = api(`git/trees/${item.sha}`);
    if (subtree.truncated) {
      throw new Error(`GitHub returned a truncated non-recursive tree for ${item.path || "/"}`);
    }
    for (const child of subtree.tree || []) {
      const childPath = item.path ? `${item.path}/${child.path}` : child.path;
      if (child.type === "blob") files.push(childPath);
      else if (child.type === "tree") queue.push({ path: childPath, sha: child.sha });
    }
  }
  if (queue.length) throw new Error(`GitHub tree traversal exceeded the ${limit}-subtree bound`);
  return files;
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
  read.tree = () =>
    enumerateGitHubTree((endpoint) => {
      stats.api++;
      return JSON.parse(
        runRaw("gh", ["api", `repos/${owner}/${repo}/${endpoint}`], {
          maxBuffer: 16 * 1024 * 1024,
        }),
      );
    }, sha);
  return read;
}

export function resolveSourceRoles(read, tree = read.tree()) {
  const paths = [...new Set(tree)].sort(),
    results = [],
    files = {};
  for (const spec of ROLE_SPECS) {
    const preferredParts = new Set(
        spec.preferred.flatMap((value) => value.toLowerCase().split("/")),
      ),
      fallbackRank = (candidate) => {
        const parts = candidate.toLowerCase().split("/"),
          base = parts.at(-1),
          preferredBases = spec.preferred.map((value) => value.toLowerCase().split("/").at(-1)),
          overlap = parts.filter((part) => preferredParts.has(part)).length;
        return [preferredBases.includes(base) ? 0 : 1, -overlap, parts.length, candidate.length];
      },
      compareFallback = (a, b) => {
        const left = fallbackRank(a),
          right = fallbackRank(b);
        for (let index = 0; index < left.length; index++) {
          if (left[index] !== right[index]) return left[index] - right[index];
        }
        return a.localeCompare(b);
      };
    const plausible = paths.filter(
        (candidate) =>
          spec.preferred.includes(candidate) ||
          (!BAD_PATH.test(candidate) && spec.path.test(candidate)),
      ),
      preferred = plausible.filter((candidate) => spec.preferred.includes(candidate)),
      fallback = plausible
        .filter((candidate) => !spec.preferred.includes(candidate))
        .sort(compareFallback),
      candidateLimit = 12,
      inspected = [...preferred],
      validated = [],
      unsupported = [];
    const inspect = (candidate) => {
      const text = read(candidate, true);
      if (text == null) return;
      const capabilities = Object.entries(spec.capabilities)
        .filter(([, signature]) => signature.test(text))
        .map(([capability]) => capability);
      if (capabilities.length) validated.push({ path: candidate, text, capabilities });
      else if (spec.unsupported?.test(text)) unsupported.push(candidate);
    };
    for (const candidate of preferred) inspect(candidate);
    const preferredCapabilities = new Set(validated.flatMap((candidate) => candidate.capabilities));
    if (
      !Object.keys(spec.capabilities).every((capability) => preferredCapabilities.has(capability))
    ) {
      for (const candidate of fallback.slice(0, candidateLimit)) {
        inspected.push(candidate);
        inspect(candidate);
      }
    }
    const needed = Object.keys(spec.capabilities),
      supplied = new Set(validated.flatMap((candidate) => candidate.capabilities)),
      complete = needed.every((capability) => supplied.has(capability)),
      fallbackTruncated = inspected.length > preferred.length && fallback.length > candidateLimit;
    let status = plausible.length ? "candidates-found-none-validated" : "unresolved-no-candidate";
    let selected = [];
    if (fallbackTruncated) {
      status = "extractor-unsupported";
    } else if (complete) {
      const authorities = validated.filter((candidate) =>
        needed.every((capability) => candidate.capabilities.includes(capability)),
      );
      if (!spec.multiple && authorities.length > 1) {
        status = "ambiguous-multiple-authoritative";
      } else {
        status = "resolved";
        selected = spec.multiple
          ? validated.filter((candidate) => candidate.capabilities.length)
          : authorities.slice(0, 1);
      }
    } else if (unsupported.length) {
      status = "extractor-unsupported";
    }
    for (const source of selected) files[source.path] = source.text;
    results.push({
      role: spec.role,
      required: spec.required,
      status,
      candidateCount: plausible.length,
      inspectedCount: inspected.length,
      sources: selected.map((x) => ({
        path: x.path,
        capabilities: x.capabilities,
        reason: spec.preferred.includes(x.path)
          ? "preferred path validated by required semantic capabilities"
          : "exact-tree fallback validated by required semantic capabilities",
      })),
    });
  }
  return { files, sourceRoles: results };
}

export function sourceRoleCoverageGap(pinned, candidate) {
  return candidate.find((candidateRole) => {
    const pinnedRole = pinned.find((role) => role.role === candidateRole.role);
    return pinnedRole.status === "resolved" && candidateRole.status !== "resolved";
  });
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
    parsed = JSON.parse(
      runRaw("uv", ["run", "--no-project", "python", "-c", PY_LITERAL, name], {
        input: text,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
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

function applicationInventory(files, provenance, sourceRoles) {
  const roleSources = Object.fromEntries(
      sourceRoles.map((role) => [
        role.role,
        role.sources.map((source) => ({ ...source, text: files[source.path] })),
      ]),
    ),
    sources = (role) => roleSources[role] || [],
    sourceWith = (role, token) =>
      sources(role).find((source) =>
        typeof token === "string" ? source.text.includes(token) : token.test(source.text),
      ),
    defaultsSource = sources("defaults")[0],
    defaultsText = defaultsSource.text,
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
      defaultsSource.path,
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
  const addFields = (root, collection, condition, declaration, confidence) => {
    if (!Array.isArray(collection.value)) {
      return;
    }
    for (const field of collection.value) {
      const source = collection.members.get(field);
      entries.push({
        path: `${root}.${field}`,
        expected: "source-defined",
        condition,
        dynamic: true,
        confidence,
        migration: "not-indicated",
        evidence: memberEvidence(source.path, source.text, declaration, field),
      });
    }
  };
  const addContract = (pathName, role, needle, options = {}) => {
    const source = sourceWith(role, needle);
    if (!source) {
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
        source.path,
        source.text,
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
  const literalsFromRole = (role, name, object = false) => {
    const assignment = new RegExp(
        String.raw`(?:^|\n)\s*${name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(?:\s*:[^=\n]+)?\s*=`,
      ),
      members = new Map(),
      value = object ? {} : [];
    for (const source of sources(role)) {
      if (!assignment.test(source.text)) continue;
      const parsed = literal(source.text, name);
      if (object && parsed && !Array.isArray(parsed)) {
        for (const [key, child] of Object.entries(parsed)) {
          if (Object.hasOwn(value, key)) continue;
          value[key] = child;
          members.set(key, source);
        }
      } else if (!object && Array.isArray(parsed)) {
        for (const child of parsed) {
          if (members.has(child)) continue;
          value.push(child);
          members.set(child, source);
        }
      }
    }
    return { members, value: members.size ? value : null };
  };
  const providerFieldResult = literalsFromRole("config", "_KNOWN_KEYS"),
    providerAliasResult = literalsFromRole("config", "_CAMEL_ALIASES", true),
    providerAliases = providerAliasResult.value || {},
    declaredProviderAliases = new Set(Object.keys(providerAliases)),
    platformsResult = literalsFromRole("config", "_PLATFORM_CONTAINER_KEYS"),
    openRootsResult = literalsFromRole("config", "_OPEN_DICT_TOP_LEVEL_KEYS"),
    schemaRootsResult = literalsFromRole("config", "_SCHEMA_DEFINED_DICT_KEYS"),
    dynamicRootsResult = literalsFromRole("config", "_DYNAMIC_TOP_LEVEL_KEYS"),
    mcpFields = new Map();
  for (const source of sources("mcp")) {
    const fields = usedDictionaryFields(source.text);
    if (fields.size === 0 && source.text.includes("MCP_SERVER_KNOWN_FIELDS")) {
      const legacyFields = literal(source.text, "MCP_SERVER_KNOWN_FIELDS") || [];
      for (const field of legacyFields) fields.set(field, source.text.indexOf(field));
    }
    for (const [field, at] of fields) {
      if (!mcpFields.has(field)) mcpFields.set(field, { at, field, source });
    }
  }
  addFields(
    "providers.<name>",
    providerFieldResult,
    "when a named custom provider is configured",
    "_KNOWN_KEYS",
    "known-consumed-field",
  );
  const providerNormalization = sourceWith("config", '"api_key_env" in entry');
  if (providerNormalization && !Object.hasOwn(providerAliases, "api_key_env")) {
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
        ? (() => {
            const source = providerAliasResult.members.get(alias);
            return memberEvidence(source.path, source.text, "_CAMEL_ALIASES", alias);
          })()
        : evidence(
            provenance.owner,
            provenance.repo,
            provenance.resolvedSha,
            providerNormalization.path,
            providerNormalization.text,
            '"api_key_env" in entry',
          ),
    });
  }
  for (const { field, at, source } of mcpFields.values()) {
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
        source.path,
        source.text,
        at,
      ),
    });
  }
  addContract("mcp_servers.<name>.env.*", "mcp", 'server_config["env"] = explicit_env', {
    condition: "when a named stdio MCP server needs environment variables",
    expected: "string environment value",
  });
  for (const [roots, declaration, suffix] of [
    [openRootsResult, "_OPEN_DICT_TOP_LEVEL_KEYS", ".*"],
    [schemaRootsResult, "_SCHEMA_DEFINED_DICT_KEYS", ".*"],
    [dynamicRootsResult, "_DYNAMIC_TOP_LEVEL_KEYS", ".*"],
    [platformsResult, "_PLATFORM_CONTAINER_KEYS", ".<name>.*"],
  ]) {
    if (Array.isArray(roots.value))
      for (const root of roots.value) {
        const source = roots.members.get(root);
        entries.push({
          path: `${root}${suffix}`,
          expected: "open dictionary value",
          condition: `when ${root} contains an extension entry`,
          dynamic: true,
          confidence: "validation-open-dictionary",
          migration: "not-indicated",
          evidence: memberEvidence(source.path, source.text, declaration, root),
        });
      }
  }
  const customProviderMigration = sources("migrations").find(
    (source) =>
      /config\.get\(\s*["']custom_providers["']\s*\)/.test(source.text) &&
      /config\[\s*["']providers["']\s*\]\s*=/.test(source.text) &&
      /config\.pop\(\s*["']custom_providers["']/.test(source.text),
  );
  if (customProviderMigration) {
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
        customProviderMigration.path,
        customProviderMigration.text,
        'config.pop("custom_providers"',
      ),
    });
  }
  addContract("model.provider", "model-docs", "written to `model.provider`", {
    condition:
      "after the main model has been configured; the initial model value may be an empty string sentinel",
    expected: "provider name string",
  });
  addContract("model.default", "model-docs", "written to `model.provider`", {
    condition:
      "after the main model has been configured; the initial model value may be an empty string sentinel",
    expected: "model identifier string",
  });
  addContract("skills.disabled", "skills", 'skills_cfg.get("disabled")', {
    expected: "array of skill names (a scalar is also normalized as one name)",
  });
  addContract(
    "agent.reasoning_effort",
    "cli-config",
    'save_config_value("agent.reasoning_effort", arg)',
    {
      expected: "reasoning level string",
      condition: "when a persistent global reasoning level is configured",
    },
  );
  addContract(
    "display.background_process_notifications",
    "messaging-docs",
    "`display.background_process_notifications`",
    {
      expected: "all, result, error, off, or false",
      condition: "when gateway background-process notifications are configured",
    },
  );
  addContract("plugins.disabled", "migrations", 'plugins_cfg.get("disabled", [])', {
    expected: "array of plugin names",
    condition: "when plugins are explicitly denied",
  });
  addContract(
    "platforms.<name>.enabled",
    "platform-loader",
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
    addContract(`platforms.whatsapp.${field}`, "platform-loader", needle, {
      expected,
      condition: "when the WhatsApp platform is configured",
    });
  }
  for (const field of ["text_batch_delay_seconds", "text_batch_split_delay_seconds"]) {
    addContract(`platforms.whatsapp.extra.${field}`, "platform-adapter", `"${field}",`, {
      expected: "number of seconds",
      condition: "when WhatsApp text batching is configured",
    });
  }
  addContract("secrets", "config", "and value is None:", {
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

function moduleInventory(text, provenance, sourcePath) {
  const TARGETED = [null, null, null, null, sourcePath];
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
  const resolved = resolveSourceRoles(read),
    files = resolved.files;
  const foundationalGap = resolved.sourceRoles.find(
    (role) => role.required && role.status !== "resolved",
  );
  if (foundationalGap) {
    throw new Error(
      `cannot construct inventory: required source role ${foundationalGap.role} is ${foundationalGap.status} (${foundationalGap.candidateCount} candidates)`,
    );
  }
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
  const moduleSource = resolved.sourceRoles.find((role) => role.role === "native-nix-module")
      .sources[0].path,
    application = applicationInventory(files, provenance, resolved.sourceRoles),
    module = moduleInventory(files[moduleSource], provenance, moduleSource),
    local = evaluate(target, options.host, options["no-nix"]);
  let latestApiRequests = 0;
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
      latestResolved = resolveSourceRoles(latestRead),
      latestFiles = latestResolved.files,
      latestProvenance = { ...provenance, resolvedSha: latestSha };
    const latestGap = sourceRoleCoverageGap(resolved.sourceRoles, latestResolved.sourceRoles);
    if (latestGap) {
      throw new Error(
        `cannot compare latest inventory: source role ${latestGap.role} is ${latestGap.status}`,
      );
    }
    const latestModuleSource = latestResolved.sourceRoles.find(
        (role) => role.role === "native-nix-module",
      ).sources[0].path,
      latestApplication = applicationInventory(
        latestFiles,
        latestProvenance,
        latestResolved.sourceRoles,
      ),
      latestModule = moduleInventory(
        latestFiles[latestModuleSource],
        latestProvenance,
        latestModuleSource,
      );
    provenance.latestSha = latestSha;
    provenance.resolvedAt = new Date().toISOString();
    application.latestComparison = inventoryDiff(application, latestApplication, latestSha);
    module.latestComparison = inventoryDiff(module, latestModule, latestSha);
    latestApiRequests = 1 + (latestRead.stats?.api || 0);
  }
  const optionalGaps = resolved.sourceRoles.filter(
      (role) => !role.required && role.status !== "resolved",
    ),
    inventoryCompleteness = optionalGaps.some((role) => role.status === "extractor-unsupported")
      ? "partial-source-extractor-unsupported"
      : optionalGaps.length
        ? "partial-source-role-gaps"
        : "partial-dynamic-contracts-not-proven-complete";
  const doc = {
    applicationInventory: application,
    comparison: comparison(application, module, local),
    completeness: {
      inventory: inventoryCompleteness,
      localComparison: local.available ? "complete-for-evaluated-settings" : "unavailable",
      overall: local.available ? "partial" : "partial-local-evaluation-unavailable",
    },
    limits: [
      application.completeness,
      ...optionalGaps.map(
        (role) =>
          `Optional source role ${role.role}: ${role.status}; ${role.candidateCount} candidates. Inventory completeness is reduced.`,
      ),
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
      githubApi: (read.stats?.api || 0) + latestApiRequests,
      githubSearch: read.stats?.search || 0,
    },
    schemaVersion: 6,
    sourceRoles: resolved.sourceRoles,
  };
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
