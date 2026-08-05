import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  argsOf,
  parsePyDefault,
  literalAfter,
  flatten,
  indexSource,
  classify,
  resolveTarget,
  resolveSource,
  sourceFiles,
  snapshot,
  audit,
  markdown,
  compare,
  validateOutside,
} from "../scripts/hermes-config-audit.mjs";

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(skill, "scripts/hermes-config-audit.mjs");
const git = (cwd, ...args) => cp.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (root, rel, body, mode) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, mode && { mode });
  return file;
};

function validateSchema(value, schema, root = schema, where = "$") {
  if (schema.$ref)
    return validateSchema(value, root.$defs[schema.$ref.split("/").at(-1)], root, where);
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, `${where} const`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${where} enum`);
  if (schema.type) {
    const actual =
      value === null
        ? "null"
        : Array.isArray(value)
          ? "array"
          : Number.isInteger(value)
            ? "integer"
            : typeof value;
    assert.ok(
      [schema.type].flat().includes(actual) || (schema.type === "number" && actual === "integer"),
      `${where} type ${actual}`,
    );
  }
  if (schema.pattern) assert.match(value, new RegExp(schema.pattern), where);
  for (const key of schema.required || [])
    assert.ok(Object.hasOwn(value, key), `${where}.${key} required`);
  for (const [key, child] of Object.entries(schema.properties || {}))
    if (Object.hasOwn(value, key)) validateSchema(value[key], child, root, `${where}.${key}`);
  if (schema.items)
    value.forEach((item, i) => validateSchema(item, schema.items, root, `${where}[${i}]`));
  for (const rule of schema.allOf || [])
    if (
      !rule.if?.properties ||
      Object.entries(rule.if.properties).every(([k, s]) => value[k] === s.const)
    )
      validateSchema(value, rule.then || rule, root, where);
}

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-fixture-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  for (const [name, body] of Object.entries(files)) write(root, name, body);
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}

const defaults = fs.readFileSync(path.join(skill, "tests/fixtures/config-defaults.py"), "utf8");
const config = `
# _EXTRA_KNOWN_ROOT_KEYS = {"comment_root"}
_EXTRA_KNOWN_ROOT_KEYS = {"extra"}
_OPEN_DICT_TOP_LEVEL_KEYS = {"open"}
_PLATFORM_CONTAINER_KEYS = {"discord"}
DISCORD_KNOWN_FIELDS = {"token", "tools"}
def validate_platform(name, entry):
  return name in _PLATFORM_CONTAINER_KEYS and set(entry).issubset(DISCORD_KNOWN_FIELDS)
def _deep_merge(a, b):
  if b is None and isinstance(a, dict): return a
  return b
def _normalize_custom_provider_entry(entry):
  # _KNOWN_KEYS = {"comment_field"}; _CAMEL_ALIASES = {"bad": "worse"}
  _KNOWN_KEYS = {"base_url", "api_key"}
  _CAMEL_ALIASES = {"baseUrl": "base_url"}
  unknown = set(entry).difference(_KNOWN_KEYS)
  return {k: v for k, v in entry.items() if k in _KNOWN_KEYS}
`;
const mcp = `# MCP_SERVER_KNOWN_FIELDS = {"comment_bad"}\nMCP_SERVER_KNOWN_FIELDS = {"command", "tools"}\ndef validate_server(value): return set(value).issubset(MCP_SERVER_KNOWN_FIELDS)\n`;
const moduleNix = `
{ lib, ... }: let inherit (lib) mkOption mkEnableOption types; in {
 options.services.hermes-agent = {
   enable = mkEnableOption "Hermes";
   package = mkOption { type = types.package; default = null; description = "Package"; };
   mcpServers = mkOption { type = types.attrsOf (types.submodule ({...}: { options = {
     command = mkOption { type = types.str; description = "Command"; };
     tools = { include = mkOption { type = types.listOf types.str; default = []; description = "Included"; }; };
   }; })); description = "Servers"; };
 };
 config = { generated = if cfg.configFile != null then null else builtins.toJSON cfg.settings; };
}
`;

function fixtures() {
  const source = repo({
    "hermes_cli/config_defaults.py": defaults,
    "hermes_cli/config.py": config,
    "hermes_cli/config_migrations.py":
      "def migrate(config):\n  if 'custom_providers' in config: return config['custom_providers']\n",
    "hermes_cli/mcp_config.py": mcp,
    "nix/nixosModules.nix": moduleNix,
    "_/secret.py": "do not read",
  });
  const sha = git(source, "rev-parse", "HEAD");
  const target = repo({
    "flake.lock": JSON.stringify({
      nodes: {
        "hermes-agent": {
          locked: { type: "github", rev: sha, owner: "Fixture", repo: "hermes" },
        },
      },
    }),
    "hosts/test/hermes/settings.nix": "{ settings = {}; }\n",
  });
  return {
    source,
    sha,
    target,
    src: {
      path: source,
      sha,
      owner: "Fixture",
      repo: "hermes",
      cache: fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cache-")),
    },
  };
}

test("literal lexer is comment/string safe and preserves arithmetic/null defaults", () => {
  const value = parsePyDefault(defaults);
  assert.equal(value.static_flag, true);
  assert.equal(value.comment_corruption, undefined);
  assert.deepEqual([...literalAfter(config, "_EXTRA_KNOWN_ROOT_KEYS")], ["extra"]);
});

test("synthetic pinned source extracts contracts, citations, and structural module options", (t) => {
  const f = fixtures();
  t.after(() => {
    fs.rmSync(f.source, { recursive: true });
    fs.rmSync(f.target, { recursive: true });
    fs.rmSync(f.src.cache, { recursive: true });
  });
  write(f.source, "ignored.py", "ignored");
  write(f.source, "untracked.py", "untracked");
  write(f.source, ".gitignore", "ignored.py\n");
  const index = indexSource(f.src);
  assert.deepEqual(index.contracts.provider.knownFields.sort(), ["api_key", "base_url"]);
  assert.deepEqual(index.contracts.provider.aliases, [{ from: "baseUrl", to: "base_url" }]);
  assert.ok(!index.contracts.knownRootKeys.includes("comment_root"));
  assert.deepEqual(index.contracts.platforms.schemas.discord.sort(), ["token", "tools"]);
  assert.equal(index.module.optionCount, 5);
  assert.ok(
    index.module.options.some(
      (x) => x.path === "services.hermes-agent.enable" && x.typeExpression === "types.bool",
    ),
  );
  assert.ok(
    index.module.options.some(
      (x) => x.path === "services.hermes-agent.mcpServers.<name>.tools.include",
    ),
  );
  const enable = index.module.options.find((x) => x.path === "services.hermes-agent.enable");
  const packageOption = index.module.options.find(
    (x) => x.path === "services.hermes-agent.package",
  );
  assert.equal(enable.description, '"Hermes"');
  assert.equal(packageOption.typeExpression, "types.package");
  assert.equal(packageOption.description, '"Package"');
  const escapedEnableSource = moduleNix.replace(
    'mkEnableOption "Hermes"',
    `mkEnableOption "${"\\!".repeat(10_000)}Hermes"`,
  );
  const escapedSource = repo({
    "hermes_cli/config_defaults.py": defaults,
    "hermes_cli/config.py": config,
    "hermes_cli/config_migrations.py":
      "def migrate(config):\n  if 'custom_providers' in config: return config['custom_providers']\n",
    "hermes_cli/mcp_config.py": mcp,
    "nix/nixosModules.nix": escapedEnableSource,
  });
  t.after(() => fs.rmSync(escapedSource, { recursive: true, force: true }));
  const escapedSha = git(escapedSource, "rev-parse", "HEAD");
  const escapedModule = indexSource({
    ...f.src,
    path: escapedSource,
    sha: escapedSha,
  }).module;
  assert.equal(
    escapedModule.options.find((x) => x.path === "services.hermes-agent.enable").description,
    `"${"\\!".repeat(10_000)}Hermes"`,
  );
  assert.match(index.module.options[0].declaration.url, new RegExp(f.sha));
  assert.ok(index.module.options[0].declaration.excerpt);
  const files = sourceFiles(f.src);
  assert.ok(!files.has("_/secret.py"));
  assert.ok(!files.has("ignored.py"));
  assert.ok(!files.has("untracked.py"));
});

test("classification preserves null semantics, unresolved sentinels, platform uncertainty and fail-closed MCP", (t) => {
  const f = fixtures();
  t.after(() => {
    fs.rmSync(f.source, { recursive: true });
    fs.rmSync(f.target, { recursive: true });
    fs.rmSync(f.src.cache, { recursive: true });
  });
  const index = indexSource(f.src),
    result = (path, value, type = typeof value) => classify({ path, value, type }, index);
  assert.equal(result("secrets", null, "null").classification, "uncertain-needs-targeted-review");
  assert.equal(
    result("platforms.discord.token", "x").classification,
    "uncertain-needs-targeted-review",
  );
  assert.equal(
    result("platforms.discord.unknown", true).classification,
    "uncertain-needs-targeted-review",
  );
  assert.equal(
    result("mcp_servers.a.tools.include.deep", true).classification,
    "uncertain-needs-targeted-review",
  );
  const flat = flatten({ outer: { value: { toolUnresolved: true, reason: "computed" } } });
  assert.deepEqual(
    flat.map((x) => x.path),
    ["outer.value"],
  );
  assert.equal(classify(flat[0], index).classification, "uncertain-needs-targeted-review");
  assert.deepEqual(
    flatten({ outer: { $unresolved: "user data" } }).map((x) => x.path),
    ["outer.$unresolved"],
  );
  assert.equal(result("providers.scalar", "x").classification, "obsolete-or-wrong-shape");
  assert.equal(result("mcp_servers.scalar", 1, "number").classification, "obsolete-or-wrong-shape");
  assert.equal(result("platforms.discord", "x").classification, "obsolete-or-wrong-shape");
  assert.equal(result("unknown_root", true).classification, "uncertain-needs-targeted-review");
});

test("target resolution, tracked discipline, exact revision, cache and output boundaries", (t) => {
  const f = fixtures(),
    cache = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ok-"));
  t.after(() => {
    for (const p of [f.source, f.target, f.src.cache, cache])
      fs.rmSync(p, { recursive: true, force: true });
  });
  assert.equal(resolveTarget({ "target-repo": f.target }).root, f.target);
  assert.throws(() => resolveTarget({ "target-repo": f.target, repo: f.source }), /conflict/);
  assert.equal(resolveSource(f.target, { source: f.source, cache }, [f.target, skill]).sha, f.sha);
  git(f.source, "commit", "--allow-empty", "-qm", "mismatch");
  assert.throws(
    () => resolveSource(f.target, { source: f.source, cache }, [f.target, skill]),
    /does not match/,
  );
  assert.throws(
    () => validateOutside(path.join(f.target, "report.json"), [f.target, skill], "JSON output"),
    /outside/,
  );
  assert.throws(
    () => validateOutside(path.join(f.target, "cache"), [f.target, skill], "cache root"),
    /outside/,
  );
});

test("snapshot invokes fake nix eval once and never build", (t) => {
  const f = fixtures(),
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-nix-")),
    log = path.join(bin, "calls");
  t.after(() => {
    for (const p of [f.source, f.target, f.src.cache, bin])
      fs.rmSync(p, { recursive: true, force: true });
  });
  write(
    bin,
    "nix",
    `#!/bin/sh\necho "$*" >> "${log}"\nprintf '%s' '{"host":"test","provenance":"single-host-flake-eval","evaluated":true,"runtimeDocument":{"model":"SECRET_DO_NOT_EMIT"},"moduleValues":{"enable":true,"environment":{"TOKEN":"SECRET_DO_NOT_EMIT"}},"localAssignments":[],"mode":"settings","settingsEmpty":false,"configFileBypassesSettings":false,"limits":[]}'\n`,
    0o755,
  );
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  try {
    const snap = snapshot(resolveTarget({ "target-repo": f.target }), "test");
    assert.equal(snap.evaluated, true);
  } finally {
    process.env.PATH = old;
  }
  const calls = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls.filter((x) => x.startsWith("eval ")).length, 1);
  assert.equal(calls.filter((x) => /build|switch/.test(x)).length, 0);
  assert.match(calls[0], /--option allow-import-from-derivation false/);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-redaction-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const report = path.join(out, "snapshot.json");
  process.env.PATH = `${bin}:${old}`;
  try {
    cp.execFileSync(process.execPath, [
      cli,
      "snapshot",
      "--target-repo",
      f.target,
      "--host",
      "test",
      "--json",
      report,
    ]);
  } finally {
    process.env.PATH = old;
  }
  assert.doesNotMatch(fs.readFileSync(report, "utf8"), /SECRET_DO_NOT_EMIT/);
  assert.equal(fs.statSync(report).mode & 0o777, 0o600);
});

test("static adapter and command surfaces fail closed", (t) => {
  const f = fixtures();
  t.after(() =>
    [f.source, f.target, f.src.cache].forEach((p) =>
      fs.rmSync(p, { recursive: true, force: true }),
    ),
  );
  const target = resolveTarget({ "target-repo": f.target });
  const noAdapter = snapshot(target, "test", { "no-nix": true });
  assert.equal(noAdapter.provenance, "unresolved-no-adapter");
  assert.equal(
    snapshot(target, "test", { "no-nix": true, "host-adapter": "hosts/test/hermes/settings.nix" })
      .provenance,
    "static-source-adapter",
  );
  write(f.target, "untracked.nix", "{}\n");
  write(f.target, "ignored.nix", "{}\n");
  write(f.target, ".gitignore", "ignored.nix\n");
  for (const rel of ["untracked.nix", "ignored.nix", "hosts/../flake.lock", "_/x.nix"])
    assert.throws(
      () => snapshot(target, "test", { "no-nix": true, "host-adapter": rel }),
      /normalized tracked|without an _/,
    );
  assert.throws(() => argsOf(["audit", "--hots", "x"]), /not valid/);
  assert.throws(() => argsOf(["audit", "--no-nix"]), /--host is required/);
  assert.throws(() => argsOf(["snapshot"]), /--host is required/);
});

test("self-contained CLI audit writes schema-safe JSON/Markdown outside repositories", (t) => {
  const f = fixtures(),
    out = fs.mkdtempSync(path.join(os.tmpdir(), "audit-out-")),
    cache = fs.mkdtempSync(path.join(os.tmpdir(), "audit-cache-"));
  t.after(() => {
    for (const p of [f.source, f.target, f.src.cache, out, cache])
      fs.rmSync(p, { recursive: true, force: true });
  });
  const json = path.join(out, "audit.json"),
    md = path.join(out, "audit.md");
  cp.execFileSync(process.execPath, [
    cli,
    "audit",
    "--target-repo",
    f.target,
    "--source",
    f.source,
    "--cache",
    cache,
    "--host",
    "test",
    "--no-nix",
    "--refresh-index",
    "--json",
    json,
    "--markdown",
    md,
  ]);
  const doc = JSON.parse(fs.readFileSync(json, "utf8"));
  validateSchema(
    doc,
    JSON.parse(fs.readFileSync(path.join(skill, "reference/audit.schema.json"), "utf8")),
  );
  assert.deepEqual(Object.keys(doc).sort(), [
    "command",
    "findings",
    "generatedAt",
    "limits",
    "moduleSummary",
    "provenance",
    "readOnly",
    "safety",
    "schemaVersion",
    "surfaces",
  ]);
  assert.equal(doc.provenance.resolvedSha, f.sha);
  assert.equal("hermesSha" in doc.provenance, false);
  assert.ok(doc.findings.some((x) => x.path === "<host-evaluation>"));
  assert.match(fs.readFileSync(md, "utf8"), /do not treat as a complete audit/);
  try {
    cp.execFileSync("jq", ["--version"], { stdio: "ignore" });
    for (const filter of [
      ".provenance.resolvedSha",
      '.findings[] | select(.classification == "uncertain-needs-targeted-review") | .path',
      ".surfaces.module.options[] | [.path, .typeExpression] | @tsv",
      ".limits[]",
    ])
      cp.execFileSync("jq", ["-r", filter, json]);
  } catch (error) {
    if (error.code === "ENOENT") t.diagnostic("jq unavailable");
    else throw error;
  }
  assert.throws(
    () =>
      cp.execFileSync(
        process.execPath,
        [
          cli,
          "audit",
          "--target-repo",
          f.target,
          "--source",
          f.source,
          "--cache",
          cache,
          "--host",
          "test",
          "--no-nix",
          "--json",
          path.join(f.target, "bad.json"),
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    /must be outside/,
  );
});

test("broader compare includes defaults, flattened values, contracts, and module metadata", () => {
  const a = { sha: "a", defaults: {}, flatDefaults: [], contracts: {}, module: {} },
    b = structuredClone(a);
  b.sha = "b";
  b.defaults.x = 1;
  b.flatDefaults.push({ path: "x" });
  b.contracts.x = true;
  b.module.x = true;
  assert.deepEqual(Object.keys(compare(a, b).changes).sort(), [
    "contracts",
    "defaults",
    "flatDefaults",
    "module",
  ]);
});

test("Python assignment scanner rejects poison and records exact container/value lines", () => {
  const source = `''' DEFAULT_CONFIG = {"bad": 1} '''\nDEFAULT_CONFIG = {\n # ] poison\n "n": 1,\n "b": True,\n "z": None,\n "a": [],\n "o": {},\n "s": "] not close"\n}\n`;
  assert.equal(parsePyDefault(source).n, 1);
  const clean = source.slice(source.lastIndexOf("DEFAULT_CONFIG"));
  const flat = flatten(parsePyDefault(clean));
  assert.deepEqual(Object.fromEntries(flat.map((x) => [x.path, x.line])), {
    n: 3,
    b: 4,
    z: 5,
    a: 6,
    o: 7,
    s: 8,
  });
  assert.throws(() => parsePyDefault('DEFAULT_CONFIG = {"x": 1} + other\n'), /trailing/);
  assert.throws(
    () => parsePyDefault('DEFAULT_CONFIG = {"x": "\\q"}\n'),
    /unsupported Python escape/,
  );
});

test("fake gh latest selects immutable HEAD and rejects a mismatch", (t) => {
  const f = fixtures(),
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-")),
    cache = fs.mkdtempSync(path.join(os.tmpdir(), "latest-cache-"));
  t.after(() =>
    [f.source, f.target, f.src.cache, bin, cache].forEach((p) =>
      fs.rmSync(p, { recursive: true, force: true }),
    ),
  );
  git(f.source, "commit", "--allow-empty", "-qm", "latest");
  const latest = git(f.source, "rev-parse", "HEAD");
  write(bin, "gh", `#!/bin/sh\nprintf '%s\\n' '${latest}'\n`, 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  try {
    const src = resolveSource(f.target, { source: f.source, cache, latest: true }, [
      f.target,
      skill,
    ]);
    assert.equal(src.selection, "latest");
    assert.equal(src.lockedSha, f.sha);
    assert.equal(src.resolvedSha, latest);
    assert.match(src.resolvedAt, /^\d{4}-/);
    write(bin, "gh", "#!/bin/sh\nprintf '%040d\\n' 0\n", 0o755);
    assert.throws(
      () => resolveSource(f.target, { source: f.source, cache, latest: true }, [f.target, skill]),
      /does not match/,
    );
  } finally {
    process.env.PATH = old;
  }
});

test("immutable reads ignore dirty tracked source and preserve exact citation", (t) => {
  const f = fixtures();
  t.after(() =>
    [f.source, f.target, f.src.cache].forEach((p) =>
      fs.rmSync(p, { recursive: true, force: true }),
    ),
  );
  write(f.source, "hermes_cli/config_defaults.py", 'DEFAULT_CONFIG = {"dirty": true}\n');
  const index = indexSource(f.src),
    model = index.flatDefaults.find((x) => x.path === "model");
  assert.equal(index.defaults.dirty, undefined);
  assert.equal(model.evidence.line, 3);
  assert.equal(model.evidence.excerpt, '"model": "",');
  assert.equal(
    model.evidence.url,
    `https://github.com/Fixture/hermes/blob/${f.sha}/hermes_cli/config_defaults.py#L3`,
  );
});

test("audit and markdown retain uncertainty and citations without completeness claims", (t) => {
  const f = fixtures();
  t.after(() => {
    fs.rmSync(f.source, { recursive: true });
    fs.rmSync(f.target, { recursive: true });
    fs.rmSync(f.src.cache, { recursive: true });
  });
  const target = resolveTarget({ "target-repo": f.target }),
    doc = audit(target, "test", indexSource(f.src), { "no-nix": true });
  assert.ok(doc.findings.every((x) => x.path !== "$unresolved"));
  assert.match(markdown(doc), /## Proper/);
  assert.match(markdown(doc), /## Repo today/);
  assert.match(markdown(doc), /## Gap/);
  assert.match(markdown(doc), /## Path/);
});
