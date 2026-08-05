#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_REPO = path.resolve(SKILL, "../..");
const SHA = /^[0-9a-f]{40}$/;
const TARGETED = [
  "hermes_cli/config_defaults.py",
  "hermes_cli/config.py",
  "hermes_cli/config_migrations.py",
  "hermes_cli/mcp_config.py",
  "nix/nixosModules.nix",
];

const runRaw = (cmd, args, options = {}) =>
  cp.execFileSync(cmd, args, { encoding: "utf8", ...options });
const run = (cmd, args, options = {}) => runRaw(cmd, args, options).trim();
const lineAt = (text, at) => text.slice(0, at).split("\n").length;
const canonical = (p) => fs.realpathSync.native(path.resolve(p));
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
const safePath = (p) => {
  if (p.split("/").includes("_")) throw new Error(`refusing path with an _ component: ${p}`);
  return p;
};

export function argsOf(argv) {
  if (argv[0] !== "audit") throw new Error("the only command is audit");
  const out = {};
  const flags = new Set(["latest", "no-nix"]);
  const allowed = new Set(["target-repo", "host", "source", "output-dir", ...flags]);
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (!allowed.has(key)) throw new Error(`--${key} is not valid`);
    out[key] = flags.has(key) ? true : argv[++i];
    if (out[key] === undefined) throw new Error(`--${key} needs a value`);
  }
  if (!out["target-repo"] || !out.host) throw new Error("--target-repo and --host are required");
  return out;
}

function lock(target) {
  const file = path.join(target, "flake.lock");
  const tracked = run("git", ["-C", target, "ls-files", "--error-unmatch", "flake.lock"]);
  if (!tracked) throw new Error("flake.lock must be tracked");
  const nodes = JSON.parse(fs.readFileSync(file, "utf8")).nodes || {};
  const node =
    nodes["hermes-agent"] || Object.values(nodes).find((x) => x?.locked?.repo === "hermes-agent");
  const x = node?.locked;
  if (x?.type !== "github" || !x.owner || !x.repo || !SHA.test(x.rev || ""))
    throw new Error("tracked flake.lock has no exact GitHub hermes-agent revision");
  return { owner: x.owner, repo: x.repo, lockedSha: x.rev };
}

function sourceReader(source, sha) {
  const root = canonical(source);
  run("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`]);
  const memo = new Map();
  return (rel, optional = false) => {
    safePath(rel);
    if (memo.has(rel)) return memo.get(rel);
    try {
      const value = runRaw("git", ["-C", root, "show", `${sha}:${rel}`]);
      memo.set(rel, value);
      return value;
    } catch (e) {
      if (optional) return null;
      throw e;
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
  const memo = new Map();
  return (rel, optional = false) => {
    safePath(rel);
    if (memo.has(rel)) return memo.get(rel);
    try {
      const encoded = rel.split("/").map(encodeURIComponent).join("/");
      const body = run("gh", [
        "api",
        `repos/${owner}/${repo}/contents/${encoded}?ref=${sha}`,
        "--jq",
        ".content",
      ]);
      const value = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
      memo.set(rel, value);
      return value;
    } catch (e) {
      if (optional) return null;
      throw e;
    }
  };
}

function evidence(owner, repo, sha, source, text, needle = "") {
  const lines = text.split("\n"),
    index = lines.findIndex((x) => x.includes(needle));
  if (index < 0) throw new Error(`evidence token not found in ${source}: ${needle}`);
  return {
    source,
    line: index + 1,
    url: `https://github.com/${owner}/${repo}/blob/${sha}/${source}#L${index + 1}`,
    excerpt: lines[index].trim().slice(0, 300),
  };
}

function evidenceAt(owner, repo, sha, source, text, at) {
  const line = lineAt(text, at);
  return {
    source,
    line,
    url: `https://github.com/${owner}/${repo}/blob/${sha}/${source}#L${line}`,
    excerpt: text.split("\n")[line - 1]?.trim().slice(0, 300) || "",
  };
}

function pyTokens(text, base = 0) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if ("{}[]():,+-*/".includes(c)) {
      out.push({ k: c, v: c, at: base + i++ });
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c,
        at = base + i++;
      let v = "";
      while (i < text.length && text[i] !== q) {
        if (text[i] === "\\") {
          const esc = text[++i],
            map = {
              a: "\x07",
              b: "\b",
              f: "\f",
              n: "\n",
              r: "\r",
              t: "\t",
              v: "\v",
              "\\": "\\",
              "'": "'",
              '"': '"',
            };
          if (Object.hasOwn(map, esc)) {
            v += map[esc];
            i++;
          } else {
            const widths = { x: 2, u: 4, U: 8 };
            if (widths[esc]) {
              const hex = text.slice(i + 1, i + 1 + widths[esc]);
              if (!new RegExp(`^[0-9a-fA-F]{${widths[esc]}}$`).test(hex))
                throw new Error(`invalid escape at line ${lineAt(text, i)}`);
              v += String.fromCodePoint(Number.parseInt(hex, 16));
              i += widths[esc] + 1;
            } else if (/[0-7]/.test(esc)) {
              const octal = text.slice(i, i + 3).match(/^[0-7]{1,3}/)[0];
              v += String.fromCodePoint(Number.parseInt(octal, 8));
              i += octal.length;
            } else throw new Error(`unsupported escape at line ${lineAt(text, i)}`);
          }
        } else v += text[i++];
      }
      if (text[i++] !== q) throw new Error("unterminated Python string");
      out.push({ k: "str", v, at });
      continue;
    }
    const m = text.slice(i).match(/^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[+-]?[\d_]+)?|^[A-Za-z_]\w*/i);
    if (!m) throw new Error(`unsupported Python token at line ${lineAt(text, i)}`);
    out.push({ k: /^\d|^\./.test(m[0]) ? "num" : "name", v: m[0], at: base + i });
    i += m[0].length;
  }
  return out;
}

function parseLiteral(tokens) {
  let i = 0;
  const offsets = {};
  const atom = (parts = []) => {
    const t = tokens[i++];
    if (!t) throw new Error("unexpected end of literal");
    if (parts.length) offsets[parts.join(".")] = t.at;
    if (t.k === "{") {
      if (tokens[i]?.k === "}") {
        i++;
        return {};
      }
      const first = expression();
      if (tokens[i]?.k !== ":") {
        const set = new Set([first]);
        while (tokens[i]?.k !== "}") {
          if (tokens[i++]?.k !== ",") throw new Error("invalid set");
          if (tokens[i]?.k !== "}") set.add(expression());
        }
        i++;
        return set;
      }
      if (typeof first !== "string") throw new Error("dict keys must be strings");
      const value = {};
      i++;
      value[first] = expression([...parts, first]);
      while (tokens[i]?.k !== "}") {
        if (tokens[i++]?.k !== ",") throw new Error("invalid dict");
        if (tokens[i]?.k === "}") break;
        const key = atom();
        if (typeof key !== "string" || tokens[i++]?.k !== ":")
          throw new Error("dict keys must be strings");
        value[key] = expression([...parts, key]);
      }
      i++;
      return value;
    }
    if (t.k === "[") {
      const a = [];
      while (tokens[i]?.k !== "]") {
        a.push(expression(parts));
        if (tokens[i]?.k === ",") i++;
        else if (tokens[i]?.k !== "]") throw new Error("invalid list");
      }
      i++;
      return a;
    }
    if (t.k === "(") {
      const x = expression(parts);
      if (tokens[i++]?.k !== ")") throw new Error("unbalanced parentheses");
      return x;
    }
    if (t.k === "str") return t.v;
    if (t.k === "num") return Number(t.v.replaceAll("_", ""));
    if (t.k === "name" && ["True", "False", "None"].includes(t.v))
      return t.v === "True" ? true : t.v === "False" ? false : null;
    if (["+", "-"].includes(t.k)) {
      const x = atom(parts);
      if (typeof x !== "number") throw new Error("numeric unary operator required");
      return t.k === "-" ? -x : x;
    }
    throw new Error(`non-literal Python token ${t.v}`);
  };
  const product = (p) => {
    let x = atom(p);
    while (["*", "/"].includes(tokens[i]?.k)) {
      const op = tokens[i++].k,
        y = atom(p);
      x = op === "*" ? x * y : x / y;
    }
    return x;
  };
  const expression = (p) => {
    let x = product(p);
    while (["+", "-"].includes(tokens[i]?.k)) {
      const op = tokens[i++].k,
        y = product(p);
      x = op === "+" ? x + y : x - y;
    }
    return x;
  };
  const value = expression([]);
  if (i !== tokens.length) throw new Error("unsupported trailing Python syntax");
  if (value && typeof value === "object")
    Object.defineProperty(value, "__sourceOffsets", { value: offsets });
  return value;
}

export function parsePyDefault(text, name = "DEFAULT_CONFIG") {
  let assignment = -1;
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + name.length)) {
    if (/\w/.test(text[at - 1] || "") || /\w/.test(text[at + name.length] || "")) continue;
    const equals = /^(?:\s*:[^=\n]+)?\s*=\s*/.exec(text.slice(at + name.length));
    if (equals) {
      assignment = at + name.length + equals[0].length;
      break;
    }
  }
  if (assignment < 0) throw new Error(`${name} literal not found`);
  const wrapper = /^frozenset\s*\(\s*/.exec(text.slice(assignment)),
    start = assignment + (wrapper?.[0].length || 0),
    open = text[start];
  if (!"[{".includes(open)) throw new Error(`${name} must be a literal collection`);
  let depth = 0,
    q = null,
    comment = false,
    end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (!q && c === "#") {
      comment = true;
      continue;
    }
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === open) depth++;
    else if ((open === "{" ? c === "}" : c === "]") && --depth === 0) {
      end = i;
      break;
    }
  }
  const lineEnd = text.indexOf("\n", end + 1) < 0 ? text.length : text.indexOf("\n", end + 1),
    suffix = text
      .slice(end + 1, lineEnd)
      .replace(/#.*$/, "")
      .trim();
  if (end < 0 || suffix !== (wrapper ? ")" : "")) throw new Error(`unsafe ${name} expression`);
  return parseLiteral(pyTokens(text.slice(start, end + 1), start));
}

export function flatten(value, prefix = "", offsets = value?.__sourceOffsets || {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length)
      return entries.flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k, offsets));
  }
  return [
    {
      path: prefix,
      value,
      type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      at: offsets[prefix],
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
    path: entry.path,
    default: entry.value,
    defaultShape: entry.type,
    expected: "accepted shape not proven by a default",
    condition: "available in the base configuration",
    dynamic: false,
    confidence: "base-default",
    migration: "not-indicated",
    evidence: evidenceAt(
      provenance.owner,
      provenance.repo,
      provenance.resolvedSha,
      TARGETED[0],
      defaultsText,
      entry.at || 0,
    ),
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
    if (declarationAt < 0) throw new Error(`${declaration} not found in ${source}`);
    const quoted = new RegExp(`["']${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g");
    quoted.lastIndex = declarationAt;
    const match = quoted.exec(text);
    if (!match) throw new Error(`${field} not found in ${declaration}`);
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
    if (!Array.isArray(fields)) return;
    for (const field of fields)
      entries.push({
        path: `${root}.${field}`,
        expected: "source-defined",
        condition,
        dynamic: true,
        confidence,
        migration: "not-indicated",
        evidence: memberEvidence(source, text, declaration, field),
      });
  };
  const usedDictionaryFields = (text) => {
    const fields = new Map();
    for (const match of text.matchAll(
      /\b(?:server_config|config)\s*(?:\[\s*["']([^"']+)["']\s*\]|\.get\(\s*["']([^"']+)["'])/g,
    )) {
      const field = match[1] || match[2];
      if (field !== "mcp_servers" && !fields.has(field)) fields.set(field, match.index);
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
    for (const field of legacyFields) mcpFields.set(field, mcpText.indexOf(field));
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
  )
    providerAliases.api_key_env = "key_env";
  for (const [alias, target] of Object.entries(providerAliases))
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
  for (const [field, at] of mcpFields)
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
  for (const [roots, declaration, suffix] of [
    [openRoots, "_OPEN_DICT_TOP_LEVEL_KEYS", ".*"],
    [schemaRoots, "_SCHEMA_DEFINED_DICT_KEYS", ".*"],
    [dynamicRoots, "_DYNAMIC_TOP_LEVEL_KEYS", ".*"],
    [platforms, "_PLATFORM_CONTAINER_KEYS", ".<name>.*"],
  ])
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
  if (
    /config\.get\(\s*["']custom_providers["']\s*\)/.test(migrationsText) &&
    /config\[\s*["']providers["']\s*\]\s*=/.test(migrationsText) &&
    /config\.pop\(\s*["']custom_providers["']/.test(migrationsText)
  )
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
  return {
    entries,
    diagnostics,
    completeness:
      "Defaults plus targeted provider, MCP, platform, open-dictionary, and migration evidence; generated plugin contracts are not proven complete.",
  };
}

function nixMask(text) {
  const out = [...text];
  for (let i = 0; i < text.length; i++) {
    const blank = () => {
      if (out[i] !== "\n") out[i] = " ";
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
      while (++i < text.length && !text.startsWith("*/", i)) blank();
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
        if (text.startsWith("''", i) && !["$", "'"].includes(text[i + 2])) break;
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
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced Nix attribute set");
}

function assignments(code, open, close) {
  const result = [];
  let depth = 0;
  for (let i = open; i <= close; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    if (depth !== 1) continue;
    const m = code.slice(i).match(/^([A-Za-z_][\w-]*)\s*=/);
    if (m) {
      result.push({ name: m[1], at: i, valueAt: i + m[0].length });
      i += m[0].length - 1;
    }
  }
  return result;
}

function expressionEnd(code, start, limit) {
  const depths = { "{": 0, "[": 0, "(": 0 };
  const closes = { "}": "{", "]": "[", ")": "(" };
  for (let i = start; i < limit; i++) {
    if (Object.hasOwn(depths, code[i])) depths[code[i]]++;
    else if (Object.hasOwn(closes, code[i])) depths[closes[code[i]]]--;
    else if (code[i] === ";" && Object.values(depths).every((depth) => depth === 0)) return i;
  }
  throw new Error("unterminated Nix option metadata expression");
}

function moduleInventory(text, provenance) {
  const entries = [];
  const code = nixMask(text),
    marker = code.indexOf("options.services.hermes-agent");
  if (marker < 0) throw new Error("native module option root not found");
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
      if (!kind)
        throw new Error(
          `unsupported direct native option declaration at line ${lineAt(text, a.at)}: ${a.name}`,
        );
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
        path: fullPath,
        type: kind === "mkEnableOption" ? "types.bool" : take("type"),
        default: kind === "mkEnableOption" ? false : take("default"),
        example: take("example"),
        description:
          kind === "mkEnableOption"
            ? text
                .slice(a.valueAt, expressionEnd(code, a.valueAt, close))
                .replace(/^(?:lib\.)?mkEnableOption\s*/, "")
                .trim()
            : take("description"),
        mapping: /^services\.hermes-agent\.(?:settings|mcpServers)(?:\.|$)/.test(fullPath)
          ? "generates-application-config"
          : fullPath === "services.hermes-agent.configFile"
            ? "selects-application-config"
            : "service-behavior",
        evidence: {
          source: TARGETED[4],
          line,
          url: `https://github.com/${provenance.owner}/${provenance.repo}/blob/${provenance.resolvedSha}/${TARGETED[4]}#L${line}`,
          excerpt: local.trim(),
        },
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
    entries,
    completeness:
      "Bounded structural scan of services.hermes-agent options; complex generated options may require review.",
  };
}

function evaluate(target, host, disabled) {
  if (disabled)
    return {
      available: false,
      reason: "--no-nix: effective comparison is unavailable",
    };
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
        "--json",
        "--offline",
        "--no-update-lock-file",
        "--option",
        "allow-import-from-derivation",
        "false",
        `${target}#nixosConfigurations`,
        "--apply",
        expr,
      ]),
    );
    return {
      available: true,
      enabled: x.enabled,
      mode: x.mode,
      configFileSet: x.configFileSet,
      nativeShape: x.nativeShape || {},
      applicationShape: x.applicationShape,
    };
  } catch (e) {
    return {
      available: false,
      reason: `nix eval failed: ${String(e.message).split("\n")[0]}`,
    };
  }
}

const matches = (pathName, pattern) => {
  const actual = pathName.split("."),
    expected = pattern.split(".");
  if (expected.at(-1) === "*") {
    if (actual.length < expected.length) return false;
  } else if (actual.length !== expected.length) return false;
  return expected.every((p, i) =>
    p === "*" || p === "<name>" ? actual[i] !== undefined : p === actual[i],
  );
};

function flattenShape(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length)
      return entries.flatMap(([key, child]) =>
        flattenShape(child, prefix ? `${prefix}.${key}` : key),
      );
    return [{ path: prefix, type: "object" }];
  }
  const marker = typeof value === "string" && /^<([^>]+)>$/.exec(value);
  return [{ path: prefix, type: marker ? marker[1] : typeof value }];
}

const moduleOwns = (entry, candidate) => {
  if (matches(candidate, entry.path)) return true;
  if (!candidate.startsWith(`${entry.path}.`)) return false;
  return (
    /attrs|submodule|anything/i.test(entry.type || "") ||
    /\.(settings|environment|mcpServers)$/.test(entry.path)
  );
};

function comparison(app, mod, local) {
  if (!local.available) return { available: false, reason: local.reason };
  const appValues = !local.applicationShape
      ? []
      : flattenShape(local.applicationShape || {}).filter((x) => x.path),
    nativeValues = flattenShape(local.nativeShape || {})
      .filter((x) => x.path)
      .map((x) => ({ ...x, path: `services.hermes-agent.${x.path}` }));
  const classifyApplication = (value) => {
    const candidates = app.entries.filter((entry) => matches(value.path, entry.path));
    if (!candidates.length) return { ...value, classification: "uncertain-needs-targeted-review" };
    const entry = candidates.find((candidate) => !candidate.dynamic) || candidates[0];
    if (entry.migration !== "not-indicated")
      return { ...value, classification: "deprecated-or-migrated", evidence: entry.evidence };
    if (entry.dynamic && entry.confidence !== "known-consumed-field")
      return {
        ...value,
        classification: "uncertain-needs-targeted-review",
        evidence: entry.evidence,
      };
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
    ...(!local.applicationShape
      ? {
          applicationReason: local.enabled
            ? "configFile selects unresolved application configuration"
            : "Hermes service is disabled",
        }
      : {}),
    presentInGeneratedOverride: applicationResults
      .filter((result) => ["current", "valid-dynamic-extension"].includes(result.classification))
      .map((result) => result.path),
    catalogPathsAbsentFromGeneratedOverride: !local.applicationShape
      ? []
      : app.entries
          .map((x) => x.path)
          .filter(
            (pathName) =>
              !pathName.includes("*") &&
              !pathName.includes("<name>") &&
              !appValues.some((value) => matches(value.path, pathName)),
          ),
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

function targetedLookup(mismatch, sourceRead, provenance) {
  const term = mismatch.path.split(".").at(-1);
  const discovered = JSON.parse(
    run("gh", [
      "search",
      "code",
      "--repo",
      `${provenance.owner}/${provenance.repo}`,
      term,
      "--json",
      "path",
      "--limit",
      "10",
    ]),
  );
  const candidates = [];
  for (const candidate of discovered.slice(0, 5)) {
    try {
      safePath(candidate.path);
      const text = sourceRead(candidate.path, true);
      if (!text || !text.includes(term)) continue;
      candidates.push(
        evidence(
          provenance.owner,
          provenance.repo,
          provenance.resolvedSha,
          candidate.path,
          text,
          term,
        ),
      );
    } catch {}
  }
  if (candidates.length) mismatch.evidence = candidates[0];
  mismatch.candidates = candidates;
}

function inventoryDiff(pinned, latest, sha) {
  const pinnedByPath = new Map(pinned.entries.map((entry) => [entry.path, entry])),
    latestByPath = new Map(latest.entries.map((entry) => [entry.path, entry])),
    comparable = ({ evidence: _evidence, ...entry }) => entry;
  return {
    sha,
    addedPaths: [...latestByPath.keys()].filter((pathName) => !pinnedByPath.has(pathName)),
    removedPaths: [...pinnedByPath.keys()].filter((pathName) => !latestByPath.has(pathName)),
    changedPaths: [...pinnedByPath.keys()].filter(
      (pathName) =>
        latestByPath.has(pathName) &&
        JSON.stringify(comparable(pinnedByPath.get(pathName))) !==
          JSON.stringify(comparable(latestByPath.get(pathName))),
    ),
  };
}

function outputs(dir, target, source) {
  const absolute = path.resolve(dir),
    forbiddenRoots = [target, canonical(SKILLS_REPO), source && canonical(source)].filter(Boolean);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const prospective = path.join(canonical(ancestor), path.relative(ancestor, absolute));
  for (const forbidden of forbiddenRoots)
    if (inside(prospective, forbidden))
      throw new Error("outputs must be outside target and skills repositories");
  fs.mkdirSync(absolute, { recursive: true });
  const base = canonical(absolute);
  for (const forbidden of forbiddenRoots)
    if (inside(base, forbidden))
      throw new Error("outputs must be outside target and skills repositories");
  const reports = [path.join(base, "audit.json"), path.join(base, "audit.md")];
  for (const report of reports)
    if (fs.existsSync(report) && fs.lstatSync(report).isSymbolicLink())
      throw new Error(`refusing report symlink: ${report}`);
  return reports;
}

export function markdown(doc) {
  const native = doc.comparison.available ? doc.comparison.moduleMismatches : [],
    application =
      doc.comparison.available && doc.comparison.applicationAvailable
        ? doc.comparison.applicationMismatches
        : null,
    render = (items) =>
      items.length
        ? items
            .map(
              (x) =>
                `- \`${x.path}\`: ${x.classification}${x.evidence ? ` — ${x.evidence.url}` : ""}`,
            )
            .join("\n")
        : "None.";
  return `# Hermes configuration audit\n\nPinned revision: \`${doc.provenance.resolvedSha}\`\n\n- Native comparison: ${doc.comparison.available ? "available" : `unavailable (${doc.comparison.reason})`}\n- Application comparison: ${application ? "available" : `unavailable (${doc.comparison.applicationReason || doc.comparison.reason})`}\n- Application catalog: ${doc.applicationInventory.entries.length}\n- Native module catalog: ${doc.moduleInventory.entries.length}\n\n## Native mismatches\n${doc.comparison.available ? render(native) : "Not evaluated."}\n\n## Application mismatches\n${application ? render(application) : "Not evaluated."}\n\n## Limits\n${doc.limits.map((x) => `- ${x}`).join("\n")}\n`;
}

export function audit(options) {
  const target = canonical(options["target-repo"]),
    locked = lock(target);
  const resolvedSha = locked.lockedSha;
  if (!SHA.test(resolvedSha)) throw new Error("GitHub did not return an exact SHA");
  const read = options.source
    ? sourceReader(options.source, resolvedSha)
    : ghReader(locked.owner, locked.repo, resolvedSha);
  const files = Object.fromEntries(TARGETED.map((sourcePath) => [sourcePath, read(sourcePath)]));
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
    if (!SHA.test(latestSha)) throw new Error("GitHub did not return an exact latest SHA");
    const latestRead =
        latestSha === resolvedSha
          ? latestReadForSha
          : ghReader(locked.owner, locked.repo, latestSha),
      latestFiles = Object.fromEntries(
        TARGETED.map((sourcePath) => [sourcePath, latestRead(sourcePath)]),
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
    schemaVersion: 5,
    provenance,
    applicationInventory: application,
    moduleInventory: module,
    local,
    comparison: comparison(application, module, local),
    limits: [
      application.completeness,
      ...application.diagnostics.map(
        (diagnostic) => `Application contract extraction: ${diagnostic}`,
      ),
      module.completeness,
      ...(local.available
        ? [
            "The local application surface is the Nix-generated override shape, not the final mutable config.yaml.",
            "configFile contents are unresolved without realization.",
          ]
        : [local.reason]),
    ],
  };
  if (!options.source && doc.comparison.available)
    for (const mismatch of [
      ...doc.comparison.applicationMismatches,
      ...doc.comparison.moduleMismatches,
    ]) {
      try {
        targetedLookup(mismatch, read, provenance);
      } catch {
        mismatch.candidates = [];
      }
    }
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
