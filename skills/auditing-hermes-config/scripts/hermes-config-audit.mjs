#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 4;
const SHA_RE = /^[0-9a-f]{40}$/;
const REQUIRED_SOURCE = [
  "hermes_cli/config_defaults.py",
  "hermes_cli/config.py",
  "hermes_cli/config_migrations.py",
  "hermes_cli/mcp_config.py",
  "nix/nixosModules.nix",
];
const CLASSES = [
  "current",
  "valid-dynamic-extension",
  "obsolete-or-wrong-shape",
  "ignored-or-nonexistent",
  "intentional-semantic-exception",
  "uncertain-needs-targeted-review",
];
const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};
const read = (p) => fs.readFileSync(p, "utf8");
const runRaw = (cmd, args, cwd, env = {}) =>
  cp.execFileSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const run = (cmd, args, cwd, env = {}) => runRaw(cmd, args, cwd, env).trim();
const lineAt = (s, at) => s.slice(0, Math.max(0, at)).split("\n").length;
const excerptAt = (s, at) => s.split("\n")[lineAt(s, at) - 1]?.trim() || "";
const canonical = (p) => fs.realpathSync(path.resolve(p));
const inside = (candidate, parent) =>
  candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

function argsOf(argv) {
  const out = { command: argv[0] || "help" };
  const flags = new Set(["latest", "no-nix", "refresh-index", "help"]);
  for (let i = 1; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) throw new Error(`unexpected argument: ${raw}`);
    const key = raw.slice(2);
    if (flags.has(key)) out[key] = true;
    else if (argv[i + 1] == null || argv[i + 1].startsWith("--"))
      throw new Error(`missing value for --${key}`);
    else out[key] = argv[++i];
  }
  const allowed = {
    discover: ["target-repo", "repo", "source", "cache", "latest", "refresh-index", "json"],
    index: ["target-repo", "repo", "source", "cache", "latest", "refresh-index", "json"],
    snapshot: ["target-repo", "repo", "host", "host-adapter", "no-nix", "json"],
    audit: [
      "target-repo",
      "repo",
      "source",
      "cache",
      "latest",
      "refresh-index",
      "host",
      "host-adapter",
      "no-nix",
      "json",
      "markdown",
    ],
    compare: ["base", "target", "output-root", "json"],
    help: ["help"],
  };
  if (!allowed[out.command]) throw new Error(`unknown command: ${out.command}`);
  for (const key of Object.keys(out).slice(1))
    if (!allowed[out.command].includes(key))
      throw new Error(`--${key} is not valid for ${out.command}`);
  if (["audit", "snapshot"].includes(out.command) && !out.host)
    throw new Error(`--host is required for ${out.command}`);
  if (out.command === "compare" && (!out.base || !out.target))
    throw new Error("compare requires --base and --target");
  if (out.command === "compare" && out.json && !out["output-root"])
    throw new Error("compare file output requires --output-root");
  return out;
}

function lockInfo(root) {
  let lock;
  try {
    lock = JSON.parse(read(path.join(root, "flake.lock")));
  } catch (e) {
    throw new Error(`invalid flake.lock: ${e.message}`);
  }
  const locked = lock?.nodes?.["hermes-agent"]?.locked;
  if (!SHA_RE.test(locked?.rev || ""))
    throw new Error("flake.lock hermes-agent rev must be a full 40-hex Git object ID");
  if (locked.type !== "github") throw new Error("hermes-agent lock identity must be GitHub");
  if (
    typeof locked.owner !== "string" ||
    !locked.owner.trim() ||
    typeof locked.repo !== "string" ||
    !locked.repo.trim()
  )
    throw new Error("hermes-agent lock requires explicit nonempty GitHub owner/repo");
  return { sha: locked.rev, owner: locked.owner, repo: locked.repo };
}

function discoverTarget(start = process.cwd()) {
  let dir = canonical(start);
  while (true) {
    if (exists(path.join(dir, "flake.lock"))) {
      try {
        if (tracked(dir).has("flake.lock")) {
          lockInfo(dir);
          return dir;
        }
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir)
      throw new Error("could not discover a flake.lock containing nodes.hermes-agent.locked.rev");
    dir = parent;
  }
}

function tracked(root) {
  return new Set(run("git", ["ls-files", "-z"], root).split("\0").filter(Boolean));
}

function resolveTarget(opt) {
  if (opt["target-repo"] && opt.repo && canonical(opt["target-repo"]) !== canonical(opt.repo))
    throw new Error("--target-repo and --repo conflict");
  const requested = opt["target-repo"] || opt.repo || process.env.HERMES_TARGET_REPO;
  const root = requested ? canonical(requested) : discoverTarget();
  if (!fs.statSync(root).isDirectory()) throw new Error("target repo must be a directory");
  const files = tracked(root);
  if (!files.has("flake.lock")) throw new Error("target flake.lock must be tracked");
  lockInfo(root);
  return { root, files };
}

function validateOutside(candidate, forbidden, label) {
  const absolute = path.resolve(candidate);
  let ancestor = absolute;
  while (!exists(ancestor)) ancestor = path.dirname(ancestor);
  const probe = canonical(ancestor) + absolute.slice(ancestor.length);
  for (const dir of forbidden.filter(Boolean))
    if (inside(probe, canonical(dir)))
      throw new Error(`${label} must be outside target, skills repository, and source worktree`);
  return absolute;
}

function defaultCache() {
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "hermes-config-options",
  );
}

function citation(src, rel, text, at) {
  const line = lineAt(text, at);
  return {
    source: rel,
    line,
    url: `https://github.com/${src.owner}/${src.repo}/blob/${src.sha}/${rel}#L${line}`,
    excerpt: excerptAt(text, at),
  };
}

function sourceFiles(src) {
  const files = new Set(
    run("git", ["ls-tree", "-r", "--name-only", "-z", src.sha], src.path)
      .split("\0")
      .filter(Boolean)
      .filter((rel) => !rel.split("/").includes("_")),
  );
  for (const rel of REQUIRED_SOURCE) {
    if (rel.split("/").includes("_")) throw new Error(`refusing path component _: ${rel}`);
    if (!files.has(rel)) throw new Error(`required source file is not tracked: ${rel}`);
  }
  return files;
}

function sourceRead(src, rel) {
  if (rel.split("/").includes("_") || !sourceFiles(src).has(rel))
    throw new Error(`refusing non-source path: ${rel}`);
  return runRaw("git", ["show", `${src.sha}:${rel}`], src.path);
}

function resolveSource(target, opt, forbidden) {
  const locked = lockInfo(target);
  const selection = opt.latest ? "latest" : "locked";
  const sha = opt.latest
    ? run(
        "gh",
        ["api", `repos/${locked.owner}/${locked.repo}/commits/HEAD`, "--jq", ".sha"],
        target,
      )
    : locked.sha;
  if (!SHA_RE.test(sha))
    throw new Error(`${selection} revision must be a full 40-hex Git object ID`);
  const cache = validateOutside(opt.cache || defaultCache(), forbidden, "cache root");
  let sourcePath = opt.source && canonical(opt.source);
  if (!sourcePath) {
    sourcePath = path.join(cache, "worktrees", `hermes-${sha.slice(0, 12)}`);
    if (!exists(sourcePath))
      throw new Error(`exact pinned worktree is not cached: ${sourcePath}; provide --source`);
    sourcePath = canonical(sourcePath);
  }
  const actual = run("git", ["rev-parse", "HEAD"], sourcePath);
  if (actual !== sha) throw new Error(`source revision ${actual} does not match requested ${sha}`);
  const src = {
    owner: locked.owner,
    repo: locked.repo,
    sha,
    resolvedSha: sha,
    lockedSha: locked.sha,
    selection,
    ...(opt.latest ? { resolvedAt: new Date().toISOString() } : {}),
    path: sourcePath,
    cache,
  };
  sourceFiles(src);
  validateOutside(cache, [...forbidden, sourcePath], "cache root");
  return src;
}

function pyTokens(text, start = 0) {
  const out = [];
  for (let i = start; i < text.length;) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if ("{}[]():,=+-*/".includes(c)) {
      out.push({ k: c, v: c, at: i++ });
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c,
        at = i++;
      let v = "";
      while (i < text.length && text[i] !== q) {
        if (text[i] === "\\") {
          i++;
          const escaped = text[i++];
          const escapes = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'" };
          if (!Object.hasOwn(escapes, escaped))
            throw new Error(`unsupported Python escape at line ${lineAt(text, i - 2)}`);
          v += escapes[escaped];
        } else v += text[i++];
      }
      if (text[i++] !== q) throw new Error(`unterminated string at line ${lineAt(text, at)}`);
      out.push({ k: "str", v, at });
      continue;
    }
    const m = text.slice(i).match(/^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[+-]?[\d_]+)?|^[A-Za-z_]\w*/i);
    if (!m) throw new Error(`unsupported Python token at line ${lineAt(text, i)}`);
    out.push({ k: /^\d|^\./.test(m[0]) ? "num" : "name", v: m[0], at: i });
    i += m[0].length;
  }
  return out;
}

function parser(tokens, text, base = 0) {
  let i = 0;
  const lines = {};
  function atom(parts = []) {
    const t = tokens[i++];
    if (!t) throw new Error("unexpected end of Python literal");
    if (parts.length) lines[parts.join(".")] = { at: base + t.at, line: lineAt(text, base + t.at) };
    if (t.k === "{") {
      if (tokens[i]?.k === "}") {
        i++;
        return {};
      }
      const first = atom();
      if (tokens[i]?.k !== ":") {
        const set = new Set([first]);
        while (tokens[i]?.k !== "}") {
          if (tokens[i++]?.k !== ",") throw new Error("set requires commas");
          if (tokens[i]?.k !== "}") set.add(expr(parts));
        }
        i++;
        return set;
      }
      const o = {};
      i++;
      o[first] = expr([...parts, first]);
      if (tokens[i]?.k === ",") i++;
      while (tokens[i]?.k !== "}") {
        const key = atom();
        if (typeof key !== "string" || tokens[i++]?.k !== ":")
          throw new Error("dict requires string keys");
        o[key] = expr([...parts, key]);
        if (tokens[i]?.k === ",") i++;
      }
      i++;
      return o;
    }
    if (t.k === "[") {
      const a = [];
      while (tokens[i]?.k !== "]") {
        a.push(expr(parts));
        if (tokens[i]?.k === ",") i++;
      }
      i++;
      return a;
    }
    if (t.k === "(") {
      const value = expr(parts);
      if (tokens[i++]?.k !== ")") throw new Error("unbalanced parentheses");
      return value;
    }
    if (t.k === "str") return t.v;
    if (t.k === "num") return Number(t.v.replaceAll("_", ""));
    if (t.k === "name" && ["True", "False", "None"].includes(t.v))
      return t.v === "True" ? true : t.v === "False" ? false : null;
    if (["+", "-"].includes(t.k)) {
      const n = atom(parts);
      if (typeof n !== "number") throw new Error("unary operator requires number");
      return t.k === "-" ? -n : n;
    }
    throw new Error(`non-literal Python token ${t.v}`);
  }
  function mul(p) {
    let x = atom(p);
    while (["*", "/"].includes(tokens[i]?.k)) {
      const op = tokens[i++].k,
        y = atom(p);
      x = op === "*" ? x * y : x / y;
    }
    return x;
  }
  function expr(p) {
    let x = mul(p);
    while (["+", "-"].includes(tokens[i]?.k)) {
      const op = tokens[i++].k,
        y = mul(p);
      x = op === "+" ? x + y : x - y;
    }
    return x;
  }
  const value = expr([]);
  if (i !== tokens.length)
    throw new Error(
      `unsupported trailing Python syntax at line ${lineAt(text, base + (tokens[i]?.at || 0))}`,
    );
  if (value && typeof value === "object")
    Object.defineProperty(value, "__sourceLines", { value: lines });
  return value;
}

function literalAfter(text, name) {
  let assignment = -1,
    quote = null,
    comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (!quote && c === "#") {
      comment = true;
      continue;
    }
    if (quote) {
      if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      } else if (quote.length === 1 && c === "\\") i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      i += quote.length - 1;
      continue;
    }
    if (
      text.startsWith(name, i) &&
      !/\w/.test(text[i - 1] || "") &&
      !/\w/.test(text[i + name.length] || "")
    ) {
      const equals = text.slice(i + name.length).match(/^\s*=\s*/);
      if (equals) {
        assignment = i + name.length + equals[0].length;
        break;
      }
    }
  }
  if (assignment < 0) throw new Error(`${name} not found`);
  const rest = text.slice(assignment);
  if (/^(?:[rubf]+)?(?:'''|""")/i.test(rest.trimStart()) || /^[rubf]+["']/i.test(rest.trimStart()))
    throw new Error(`${name} uses unsupported Python string syntax`);
  const openOffset = rest.search(/\S/),
    open = assignment + openOffset;
  if (openOffset < 0 || !"[{".includes(text[open]))
    throw new Error(`${name} must be assigned directly to a literal collection`);
  const close = scanBalanced(text, open, text[open], text[open] === "{" ? "}" : "]");
  const tail = text
    .slice(
      close + 1,
      text.indexOf("\n", close + 1) < 0 ? text.length : text.indexOf("\n", close + 1),
    )
    .replace(/#.*$/, "")
    .trim();
  if (tail) throw new Error(`${name} has unsupported trailing syntax`);
  return parser(pyTokens(text.slice(open, close + 1)), text, open);
}

function parsePyDefault(text) {
  return literalAfter(text, "DEFAULT_CONFIG");
}

function flatten(value, prefix = "", out = [], lines = value?.__sourceLines || {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (
      value.toolUnresolved === true &&
      typeof value.reason === "string" &&
      Object.keys(value).length === 2
    ) {
      out.push({ path: prefix, value, type: "unresolved", unresolved: true });
      return out;
    }
    if (!Object.keys(value).length && prefix)
      out.push({ path: prefix, value: {}, type: "object", ...lines[prefix] });
    for (const [key, child] of Object.entries(value))
      flatten(child, prefix ? `${prefix}.${key}` : key, out, lines);
  } else
    out.push({
      path: prefix,
      value,
      type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      ...lines[prefix],
    });
  return out;
}

function scanBalanced(text, open, left = "{", right = "}") {
  let depth = 0,
    quote = null,
    comment = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (!quote && c === "#") {
      comment = true;
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === left) depth++;
    else if (c === right && --depth === 0) return i;
  }
  throw new Error(`unbalanced block at line ${lineAt(text, open)}`);
}

function assignments(text, begin, end, valueText = text) {
  const out = [];
  let depth = 0,
    quote = null,
    comment = false;
  for (let i = begin; i <= end; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (!quote && c === "#") {
      comment = true;
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth !== 1) continue;
    const m = text.slice(i).match(/^([A-Za-z_][\w-]*)\s*=\s*/);
    if (m && !/[\w-]/.test(text[i - 1] || "")) {
      const original = valueText.slice(i).match(new RegExp(`^${m[1]}\\s*=\\s*`));
      out.push({ name: m[1], at: i, valueAt: i + original[0].length });
      i += m[0].length - 1;
    }
  }
  return out;
}

function nixMask(text) {
  const out = [...text];
  const blank = (i) => {
    if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "#") {
      while (i < text.length && text[i] !== "\n") blank(i++);
      i--;
    } else if (text.startsWith("/*", i)) {
      blank(i++);
      blank(i++);
      while (i < text.length && !text.startsWith("*/", i)) blank(i++);
      if (i >= text.length) throw new Error("unterminated Nix block comment");
      blank(i);
      blank(++i);
    } else if (text.startsWith("''", i)) {
      blank(i++);
      blank(i++);
      while (i < text.length && !text.startsWith("''", i)) blank(i++);
      if (i >= text.length) throw new Error("unterminated Nix indented string");
      blank(i);
      blank(++i);
    } else if (text[i] === '"') {
      blank(i++);
      while (i < text.length && text[i] !== '"') {
        blank(i);
        if (text[i] === "\\") blank(++i);
        i++;
      }
      if (i >= text.length) throw new Error("unterminated Nix string");
      blank(i);
    }
  }
  return out.join("");
}

function nixField(text, code, open, close, name) {
  const a = assignments(code, open, close, text).find((x) => x.name === name);
  if (!a) return null;
  let depth = 0;
  for (let i = a.valueAt; i <= close; i++) {
    const c = code[i];
    if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c)) depth--;
    else if (c === ";" && depth === 0) return text.slice(a.valueAt, i).trim();
  }
  return null;
}

function extractModule(src) {
  const rel = "nix/nixosModules.nix",
    text = sourceRead(src, rel),
    code = nixMask(text),
    diagnostics = [];
  const marker = code.indexOf("options.services.hermes-agent");
  if (marker < 0) throw new Error("native module option root not found");
  const root = code.indexOf("{", marker),
    end = scanBalanced(code, root);
  const options = [];
  function walk(open, close, prefix) {
    for (const a of assignments(code, open, close, text)) {
      const tail = code.slice(a.valueAt, close);
      const kind = /^(?:(?:lib\.)?)(mkOption|mkEnableOption)\b/.exec(tail)?.[1];
      if (kind) {
        const optionOpen = kind === "mkOption" ? code.indexOf("{", a.valueAt) : -1;
        const optionClose = kind === "mkOption" ? scanBalanced(code, optionOpen) : -1;
        options.push({
          path: ["services.hermes-agent", ...prefix, a.name].join("."),
          typeExpression:
            kind === "mkEnableOption"
              ? "types.bool"
              : nixField(text, code, optionOpen, optionClose, "type"),
          default:
            kind === "mkEnableOption"
              ? "false"
              : nixField(text, code, optionOpen, optionClose, "default"),
          example:
            kind === "mkOption" ? nixField(text, code, optionOpen, optionClose, "example") : null,
          description:
            kind === "mkOption"
              ? nixField(text, code, optionOpen, optionClose, "description")
              : text
                  .slice(a.valueAt, close)
                  .match(/^(?:lib\.)?mkEnableOption\s+("(?:\\[\s\S]|[^"\\])*")/)?.[1] || null,
          declaration: citation(src, rel, text, a.at),
          mappingEvidence: [],
        });
        if (kind === "mkOption") {
          const nestedAt = code.indexOf("options =", optionOpen);
          if (nestedAt > 0 && nestedAt < optionClose) {
            const nestedOpen = code.indexOf("{", nestedAt);
            walk(nestedOpen, scanBalanced(code, nestedOpen), [
              ...prefix,
              a.name,
              ...(a.name === "mcpServers" ? ["<name>"] : []),
            ]);
          }
        }
      } else if (tail.trimStart().startsWith("{")) {
        const child = code.indexOf("{", a.valueAt);
        walk(child, scanBalanced(code, child), [...prefix, a.name]);
      } else diagnostics.push(`dynamic or unsupported option expression at ${a.name}`);
    }
  }
  walk(root, end, []);
  return {
    source: rel,
    optionCount: options.length,
    options,
    completeness: "partial-candidate-inventory",
    diagnostics: [
      "The bounded structural scanner does not prove a complete Nix option interface.",
      ...diagnostics,
    ],
    generation: { configFilePrecedence: null, settingsRendered: null, evidence: [] },
  };
}

function provenLiteral(text, name) {
  try {
    const v = literalAfter(text, name);
    return { proven: true, value: v instanceof Set ? [...v] : v };
  } catch (e) {
    return { proven: false, diagnostic: `${name}: ${e.message}` };
  }
}

function codeMask(text) {
  return nixMask(text);
}

function extractContracts(src, defaults) {
  const rel = "hermes_cli/config.py",
    text = sourceRead(src, rel);
  const providerAt = text.indexOf("def _normalize_custom_provider_entry");
  const providerEnd =
    text.indexOf("\ndef ", providerAt + 5) < 0
      ? text.length
      : text.indexOf("\ndef ", providerAt + 5);
  const provider = providerAt < 0 ? "" : text.slice(providerAt, providerEnd),
    providerCode = codeMask(provider),
    knownResult = provenLiteral(provider, "_KNOWN_KEYS"),
    aliasResult = provenLiteral(provider, "_CAMEL_ALIASES"),
    knownConnected =
      knownResult.proven &&
      /entry[\s\S]*(?:_KNOWN_KEYS)|_KNOWN_KEYS[\s\S]*entry/.test(providerCode),
    knownFields = knownConnected ? knownResult.value : [],
    aliasMap =
      aliasResult.proven && providerCode.includes("_CAMEL_ALIASES") ? aliasResult.value : {},
    platformResult = provenLiteral(text, "_PLATFORM_CONTAINER_KEYS"),
    platformsConnected =
      platformResult.proven &&
      /(?:validate|load|normalize)[\s\S]*_PLATFORM_CONTAINER_KEYS|_PLATFORM_CONTAINER_KEYS[\s\S]*(?:validate|load|normalize)/i.test(
        codeMask(text),
      ),
    platforms = platformsConnected ? platformResult.value : [],
    diagnostics = [knownResult, aliasResult, platformResult]
      .filter((x) => !x.proven)
      .map((x) => x.diagnostic);
  const platformSchemas = {};
  for (const key of platforms) {
    const result = provenLiteral(text, `${key.toUpperCase()}_KNOWN_FIELDS`);
    const connected =
      result.proven &&
      new RegExp(
        `${key.toUpperCase()}_KNOWN_FIELDS[\\s\\S]*(?:validate|load|normalize)|(?:validate|load|normalize)[\\s\\S]*${key.toUpperCase()}_KNOWN_FIELDS`,
        "i",
      ).test(codeMask(text));
    if (connected && Array.isArray(result.value)) platformSchemas[key] = result.value;
    else
      diagnostics.push(
        result.proven
          ? `${key} schema constant is not proven connected to validation`
          : result.diagnostic,
      );
  }
  const migrationRel = "hermes_cli/config_migrations.py",
    migrationsText = sourceRead(src, migrationRel);
  const mcpRel = "hermes_cli/mcp_config.py",
    mcpText = sourceRead(src, mcpRel);
  const rootResult = provenLiteral(text, "_EXTRA_KNOWN_ROOT_KEYS"),
    openResult = provenLiteral(text, "_OPEN_DICT_TOP_LEVEL_KEYS"),
    mcpResult = provenLiteral(mcpText, "MCP_SERVER_KNOWN_FIELDS"),
    mcpConnected =
      mcpResult.proven &&
      /(?:validate|load|normalize)[\s\S]*MCP_SERVER_KNOWN_FIELDS|MCP_SERVER_KNOWN_FIELDS[\s\S]*(?:validate|load|normalize)/i.test(
        codeMask(mcpText),
      ),
    migrationAt = codeMask(migrationsText).indexOf("custom_providers"),
    deepAt = codeMask(text).indexOf("def _deep_merge"),
    deepBody =
      deepAt < 0
        ? ""
        : codeMask(text).slice(
            deepAt,
            text.indexOf("\ndef ", deepAt + 5) < 0
              ? text.length
              : text.indexOf("\ndef ", deepAt + 5),
          ),
    deepProven =
      /(?:if\s+[^\n]*None[^\n]*dict|is\s+None[\s\S]*return\s+[^\n]*(?:default|base|a\b))/.test(
        deepBody,
      );
  if (!mcpConnected)
    diagnostics.push(
      mcpResult.proven
        ? "MCP fields constant is not proven connected to loading/validation"
        : mcpResult.diagnostic,
    );
  if (migrationAt < 0) diagnostics.push("custom_providers migration not proven in executable code");
  if (!deepProven) diagnostics.push("None-over-dict deep merge behavior not proven");
  return {
    diagnostics,
    knownRootKeys: [
      ...new Set([...Object.keys(defaults), ...(rootResult.proven ? rootResult.value : [])]),
    ],
    openDictionaryRoots: openResult.proven ? openResult.value : [],
    provider: {
      root: "providers",
      knownFields,
      aliases: Object.entries(aliasMap).map(([from, to]) => ({ from, to })),
      rejectsUnknown:
        knownConnected &&
        /(?:not\s+in|difference\s*\()[\s\S]*_KNOWN_KEYS|_KNOWN_KEYS[\s\S]*(?:not\s+in|difference\s*\()/.test(
          providerCode,
        ),
      completeness: knownConnected ? "normalizer-extracted" : "unproven",
      evidence: citation(src, rel, text, Math.max(0, providerAt)),
    },
    mcp: {
      root: "mcp_servers",
      knownFields: mcpConnected ? mcpResult.value : [],
      nested: {},
      completeness: "partial-fail-closed",
      evidence: citation(src, mcpRel, mcpText, 0),
    },
    platforms: {
      root: "platforms",
      containerKeys: platforms,
      schemas: platformSchemas,
      completeness:
        Object.keys(platformSchemas).length === platforms.length && platforms.length
          ? "complete-for-container-keys"
          : "partial",
      evidence: citation(src, rel, text, Math.max(0, text.indexOf("_PLATFORM_CONTAINER_KEYS"))),
    },
    migrations:
      migrationAt < 0
        ? []
        : [
            {
              path: "custom_providers",
              targetPath: "providers.<name>",
              evidence: citation(src, migrationRel, migrationsText, migrationAt),
            },
          ],
    deprecations: [],
    semanticRules: deepProven
      ? [
          {
            id: "deep-merge-null-over-dict",
            behavior: "ignore-null-keep-default-dict",
            evidence: citation(src, rel, text, Math.max(0, text.indexOf("def _deep_merge"))),
          },
        ]
      : [],
  };
}

function indexSource(src) {
  sourceFiles(src);
  const rel = "hermes_cli/config_defaults.py",
    text = sourceRead(src, rel),
    defaults = parsePyDefault(text);
  const flatDefaults = flatten(defaults);
  for (const item of flatDefaults) item.evidence = citation(src, rel, text, item.at ?? 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    sha: src.sha,
    provenance: {
      selection: src.selection || "locked",
      lockedSha: src.lockedSha || src.sha,
      resolvedSha: src.resolvedSha || src.sha,
      owner: src.owner,
      repo: src.repo,
      ...(src.resolvedAt ? { resolvedAt: src.resolvedAt } : {}),
    },
    defaults,
    flatDefaults,
    contracts: extractContracts(src, defaults),
    module: extractModule(src),
    sourceFileCount: sourceFiles(src).size,
  };
}

function loadIndex(src, refresh, forbidden) {
  const file = validateOutside(
    path.join(src.cache, "indexes", `${src.sha}-schema-${SCHEMA_VERSION}.json`),
    [...forbidden, src.path],
    "index",
  );
  // Recompute from immutable Git objects. The cache is an inspectable copy, not
  // a trusted input: accepting mutable cached contracts could mislabel evidence.
  const index = indexSource(src);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(index)}\n`);
  return index;
}

function inspectedPath(target, rel, label = "inspected path") {
  if (
    typeof rel !== "string" ||
    path.isAbsolute(rel) ||
    path.posix.normalize(rel) !== rel ||
    rel.split("/").includes("_") ||
    !target.files.has(rel)
  )
    throw new Error(`${label} must be a normalized tracked relative path without an _ component`);
  return rel;
}

function staticHost(target, host, adapter, reason = "Nix evaluation disabled or unavailable") {
  const rel = adapter ? inspectedPath(target, adapter, "host adapter") : null;
  const text = rel ? run("git", ["show", `HEAD:${rel}`], target.root) : "";
  return {
    host,
    provenance: rel ? "static-source-adapter" : "unresolved-no-adapter",
    evaluated: false,
    runtimeDocument: {
      toolUnresolved: true,
      reason: rel ? `static Nix expression: ${rel}` : "no host adapter supplied",
    },
    moduleValues: { toolUnresolved: true, reason: "host module values require evaluation" },
    localAssignments: [],
    sourceEvidence: rel ? [{ source: rel, line: 1, excerpt: excerptAt(text, 0) }] : [],
    mode: "unresolved",
    settingsEmpty: null,
    configFileBypassesSettings: null,
    limits: [
      `${reason}; static parsing cannot establish host-effective values or realize configFile derivations.`,
      ...(rel ? ["The tracked adapter was read at HEAD; no local assignments were parsed."] : []),
    ],
  };
}

function snapshot(target, host, opt = {}) {
  if (opt["no-nix"]) return staticHost(target, host, opt["host-adapter"]);
  const expr = `cs: let c = (builtins.getAttr ${JSON.stringify(host)} cs).config.services.hermes-agent; safe = v: if builtins.isAttrs v && (v.type or null) == "derivation" then { toolUnresolved = true; reason = "derivation-backed value"; } else if builtins.isAttrs v then builtins.mapAttrs (_: safe) v else if builtins.isList v then map safe v else if builtins.isString v || builtins.isBool v || builtins.isInt v || builtins.isFloat v || v == null then v else { toolUnresolved = true; reason = "non-JSON value"; }; in { host = ${JSON.stringify(host)}; provenance = "single-host-flake-eval"; evaluated = true; runtimeDocument = if c.configFile != null then { toolUnresolved = true; reason = "configFile contents require realization"; } else safe c.settings; moduleValues = safe c; localAssignments = []; mode = if c.configFile != null then "configFile" else "settings"; settingsEmpty = c.settings == {}; configFileBypassesSettings = c.configFile != null; limits = if c.configFile != null then ["configFile runtime contents were not realized."] else []; }`;
  try {
    return JSON.parse(
      run(
        "nix",
        [
          "eval",
          "--json",
          "--offline",
          "--no-update-lock-file",
          "--option",
          "allow-import-from-derivation",
          "false",
          `${target.root}#nixosConfigurations`,
          "--apply",
          expr,
        ],
        target.root,
      ),
    );
  } catch {
    return staticHost(
      target,
      host,
      opt["host-adapter"],
      "The single offline Nix evaluation failed",
    );
  }
}

function classify(item, index) {
  if (item.unresolved)
    return {
      classification: "uncertain-needs-targeted-review",
      reason: `Unresolved value: ${item.value?.reason || "evaluation gap"}`,
    };
  const p = item.path,
    parts = p.split("."),
    root = parts[0],
    c = index.contracts;
  const current = index.flatDefaults.find((x) => x.path === p);
  if (current && current.type === item.type)
    return {
      classification: "current",
      reason: "Declared with the same shape by pinned DEFAULT_CONFIG.",
      evidence: current.evidence,
    };
  if (
    p === "secrets" &&
    item.value === null &&
    index.defaults.secrets &&
    typeof index.defaults.secrets === "object" &&
    c.semanticRules.some((x) => x.id === "deep-merge-null-over-dict")
  )
    return {
      classification: "uncertain-needs-targeted-review",
      reason:
        "A candidate deep-merge rule indicates None may keep the default dictionary; confirm against the targeted function before relying on this assignment.",
      evidence: c.semanticRules.find((x) => x.id === "deep-merge-null-over-dict").evidence,
    };
  if (root === c.provider.root) {
    if (parts.length < 2 || (parts.length === 1 && item.type !== "object"))
      return {
        classification: "obsolete-or-wrong-shape",
        reason: "providers must be a dictionary of named entries.",
      };
    if (parts.length === 2)
      return item.type === "object"
        ? {
            classification: "uncertain-needs-targeted-review",
            reason:
              "Object-shaped provider entry; acceptance and required fields need targeted review.",
          }
        : {
            classification: "obsolete-or-wrong-shape",
            reason: "Named provider entries must be objects.",
          };
    if (parts.length > 3)
      return {
        classification: "uncertain-needs-targeted-review",
        reason: "Nested provider shape is not proven.",
      };
    if (
      c.provider.knownFields.includes(parts[2]) ||
      c.provider.aliases.some((x) => x.from === parts[2])
    )
      return {
        classification: "uncertain-needs-targeted-review",
        reason:
          "Candidate provider field found; value semantics and loader connection need targeted review.",
        evidence: c.provider.evidence,
      };
    return {
      classification: "uncertain-needs-targeted-review",
      reason: "Provider unknown-field behavior was not structurally proven.",
      evidence: c.provider.evidence,
    };
  }
  if (root === c.mcp.root) {
    if (parts.length < 3)
      return {
        classification:
          item.type === "object" ? "uncertain-needs-targeted-review" : "obsolete-or-wrong-shape",
        reason: "MCP is a dictionary of object-valued named entries.",
      };
    if (parts.length === 3 && c.mcp.knownFields.includes(parts[2]))
      return {
        classification: "uncertain-needs-targeted-review",
        reason: "Candidate MCP field found; loader and value semantics need targeted review.",
        evidence: c.mcp.evidence,
      };
    if (parts.length === 4 && c.mcp.nested[parts[2]]?.includes(parts[3]))
      return {
        classification: "uncertain-needs-targeted-review",
        reason: "Candidate MCP nested leaf needs targeted review.",
        evidence: c.mcp.evidence,
      };
    return {
      classification: "uncertain-needs-targeted-review",
      reason: "MCP nesting or leaf is not proven; fail closed.",
      evidence: c.mcp.evidence,
    };
  }
  if (root === c.platforms.root) {
    if (parts.length < 2)
      return {
        classification: "obsolete-or-wrong-shape",
        reason: "platforms requires a container key.",
      };
    if (!c.platforms.containerKeys.includes(parts[1]))
      return {
        classification: "uncertain-needs-targeted-review",
        reason: "Unknown platform container; extractor cannot prove rejection.",
      };
    const schema = c.platforms.schemas[parts[1]];
    if (parts.length === 2)
      return item.type === "object"
        ? {
            classification: "uncertain-needs-targeted-review",
            reason:
              "Candidate platform container; loader and required fields need targeted review.",
          }
        : {
            classification: "obsolete-or-wrong-shape",
            reason: "Platform containers must be objects.",
          };
    return schema?.includes(parts[2]) && parts.length === 3
      ? {
          classification: "uncertain-needs-targeted-review",
          reason: "Candidate platform schema field needs targeted review.",
          evidence: c.platforms.evidence,
        }
      : {
          classification: "uncertain-needs-targeted-review",
          reason: "Platform schema extraction is incomplete or does not prove this field.",
          evidence: c.platforms.evidence,
        };
  }
  if (current)
    return {
      classification: "obsolete-or-wrong-shape",
      reason: "The path exists in pinned DEFAULT_CONFIG but its value shape differs.",
      evidence: current.evidence,
    };
  const migrated = c.migrations.find((x) => p === x.path || p.startsWith(`${x.path}.`));
  if (migrated)
    return {
      classification: "uncertain-needs-targeted-review",
      reason: "A candidate migration references this legacy path; behavior needs targeted review.",
      evidence: migrated.evidence,
    };
  return {
    classification: "uncertain-needs-targeted-review",
    reason: c.knownRootKeys.includes(root)
      ? "Known root but no extracted leaf contract."
      : "Unknown root; rejection or ignore behavior was not proven.",
  };
}

function audit(target, host, index, opt) {
  const snap = snapshot(target, host, opt),
    findings = [];
  if (!snap.evaluated)
    findings.push({
      path: "<host-evaluation>",
      classification: "uncertain-needs-targeted-review",
      reason: "Host evaluation did not succeed; host-effective conclusions are a gap.",
    });
  for (const item of flatten(snap.runtimeDocument))
    findings.push({
      path: item.path,
      type: item.type,
      ...(item.unresolved ? { unresolved: true } : {}),
      ...classify(item, index),
    });
  const moduleValues =
    snap.moduleValues && !snap.moduleValues.toolUnresolved ? Object.keys(snap.moduleValues) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    command: "audit",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    provenance: {
      ...index.provenance,
      targetRepo: target.root,
      targetDirty: run("git", ["status", "--porcelain"], target.root) !== "",
      host,
    },
    surfaces: {
      runtime: { contracts: index.contracts, defaultCount: index.flatDefaults.length },
      module: index.module,
      host: redactSnapshot(snap),
    },
    findings,
    moduleSummary: { effectiveTopLevelValues: moduleValues, optionCoverage: "unavailable" },
    limits: [
      ...snap.limits,
      ...index.contracts.diagnostics.map((x) => `Runtime contract extraction: ${x}`),
      ...index.module.diagnostics.map((x) => `Native module extraction: ${x}`),
    ],
    safety: {
      performed: [
        snap.evaluated ? "one read-only nix eval" : "tracked static source evidence",
        "immutable Git object source reads",
      ],
      forbidden: ["nix build", "rebuild", "deploy", "switch", "restart", "Python execution"],
    },
  };
}

function redactValue(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    if (
      value.toolUnresolved === true &&
      typeof value.reason === "string" &&
      Object.keys(value).length === 2
    )
      return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactValue(child)]),
    );
  }
  return { redacted: true, type: typeof value };
}

function redactSnapshot(snapshotDocument) {
  return {
    ...snapshotDocument,
    runtimeDocument: redactValue(snapshotDocument.runtimeDocument),
    moduleValues: redactValue(snapshotDocument.moduleValues),
  };
}

function markdown(doc) {
  const counts = Object.fromEntries(
    CLASSES.map((c) => [c, doc.findings.filter((x) => x.classification === c).length]),
  );
  const gaps = doc.findings.filter(
    (x) => !["current", "valid-dynamic-extension"].includes(x.classification),
  );
  const limited = !doc.surfaces.host.evaluated || doc.limits.length;
  return `# Hermes config audit: ${doc.provenance.host}\n\nHermes selection: **${doc.provenance.selection}**  \nLocked SHA: \`${doc.provenance.lockedSha}\`  \nResolved SHA: \`${doc.provenance.resolvedSha}\`${doc.provenance.resolvedAt ? `  \nResolved at: ${doc.provenance.resolvedAt}` : ""}  \nSource: ${doc.provenance.owner}/${doc.provenance.repo}  \nRead-only: **yes**  \nCompleteness: **${limited ? "limited—do not treat as a complete audit" : "evaluated with extracted-contract limits"}**\n\n## Proper\nRuntime contracts, native module options, and host wiring are separate evidence surfaces.\n\n## Repo today\nMode: **${doc.surfaces.host.mode}**; provenance: **${doc.surfaces.host.provenance}**.\n\n## Findings\n${Object.entries(
    counts,
  )
    .map(([k, v]) => `- ${k}: ${v}`)
    .join(
      "\n",
    )}\n\n## Gap\n${gaps.map((x) => `- \`${x.path}\`: **${x.classification}** — ${x.reason}${x.evidence ? ` ([${x.evidence.source}:${x.evidence.line}](${x.evidence.url}))` : ""}`).join("\n") || "- None recorded"}\n${doc.limits.map((x) => `- ${x}`).join("\n")}\n\n## Path\nResolve uncertainty using one successful host evaluation and exact immutable source evidence before changing production configuration.\n`;
}

function compare(base, target) {
  const changes = {};
  for (const key of ["defaults", "flatDefaults", "contracts", "module"])
    if (JSON.stringify(base[key]) !== JSON.stringify(target[key]))
      changes[key] = { base: base[key], target: target[key] };
  return {
    schemaVersion: SCHEMA_VERSION,
    command: "compare",
    readOnly: true,
    provenance: { baseSha: base.sha, targetSha: target.sha },
    changes,
  };
}

function write(doc, opt, forbidden) {
  if (opt.json) {
    const file = validateOutside(opt.json, forbidden, "JSON output");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  if (opt.markdown) {
    if (doc.command !== "audit") throw new Error("--markdown is supported only for audit");
    const file = validateOutside(opt.markdown, forbidden, "Markdown output");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, markdown(doc), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  if (!opt.json && !opt.markdown) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
}

function usage() {
  return "usage: hermes-config-audit.mjs <discover|index|snapshot|audit|compare> --target-repo <path> [--source <exact-worktree>] [--cache <outside-path>] [--host <name>] [--no-nix] [--json <outside-path>] [--markdown <outside-path>]\n--repo is a compatibility alias for --target-repo; conflicting values are rejected.\n";
}

function skillBoundary() {
  const dir = canonical(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  try {
    const top = canonical(run("git", ["rev-parse", "--show-toplevel"], dir));
    const rel = path
      .relative(top, fileURLToPath(import.meta.url))
      .split(path.sep)
      .join("/");
    return tracked(top).has(rel) ? top : dir;
  } catch {
    return dir;
  }
}

async function main() {
  const opt = argsOf(process.argv.slice(2));
  if (opt.command === "help" || opt.help) return process.stdout.write(usage());
  if (opt.command === "compare") {
    const base = JSON.parse(read(opt.base)),
      target = JSON.parse(read(opt.target));
    if (opt.json) {
      const root = canonical(opt["output-root"]);
      const output = path.resolve(opt.json);
      if (!inside(output, root)) throw new Error("--json must be within --output-root");
    }
    return write(compare(base.index || base, target.index || target), opt, [skillBoundary()]);
  }
  const target = resolveTarget(opt);
  const forbidden = [target.root, skillBoundary()];
  if (opt.command === "snapshot")
    return write(
      {
        schemaVersion: SCHEMA_VERSION,
        command: "snapshot",
        snapshot: redactSnapshot(snapshot(target, opt.host, opt)),
      },
      opt,
      forbidden,
    );
  const src = resolveSource(target.root, opt, forbidden);
  const allForbidden = [...forbidden, src.path];
  if (opt.command === "discover")
    return write(
      { schemaVersion: SCHEMA_VERSION, command: "discover", provenance: src },
      opt,
      allForbidden,
    );
  const index = loadIndex(src, opt["refresh-index"], forbidden);
  if (opt.command === "index")
    return write({ schemaVersion: SCHEMA_VERSION, command: "index", index }, opt, allForbidden);
  if (opt.command === "audit") return write(audit(target, opt.host, index, opt), opt, allForbidden);
  throw new Error(usage().trim());
}

export {
  SCHEMA_VERSION,
  argsOf,
  resolveTarget,
  resolveSource,
  parsePyDefault,
  literalAfter,
  flatten,
  extractModule,
  extractContracts,
  indexSource,
  tracked,
  sourceFiles,
  sourceRead,
  classify,
  snapshot,
  audit,
  markdown,
  compare,
  validateOutside,
};

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(`hermes-config-audit: ${e.message}`);
    process.exitCode = 1;
  });
