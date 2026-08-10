#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

const requiredCommands = [
  {
    description: "recording terminal sessions",
    installInstructions: "https://docs.asciinema.org/manual/cli/installation/",
    tool: "asciinema",
  },
  {
    description: "rendering GIFs from .cast files",
    installInstructions: "https://docs.asciinema.org/manual/agg/installation/",
    tool: "agg",
  },
  {
    description: "uploading casts and optional GIF hosting",
    installInstructions: "https://curl.se/download.html",
    tool: "curl",
  },
  {
    description: "printing structured JSON results from helper scripts",
    installInstructions: "https://jqlang.org/download/",
    tool: "jq",
  },
];

const optionalKeys = [
  {
    description: "needed only when hosting GIFs with `scripts/finalize-recording.sh --upload-gif`",
    installInstructions: "https://api.imgbb.com/#api-upload",
    key: "IBB_API_KEY",
  },
];

/** @type {(command: string) => string} */
function findCommand(command) {
  const pathValue = process.env.PATH ?? "";
  for (const dir of pathValue.split(NodePath.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = NodePath.join(dir, command);
    try {
      NodeFS.accessSync(candidate, NodeFS.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH
    }
  }

  return "";
}

/** @type {(command: string) => string} */
function readCommandVersion(command) {
  const attempts = {
    agg: [["--version"]],
    asciinema: [["--version"]],
    curl: [["--version"]],
    jq: [["--version"]],
  }[command] ?? [["--version"], ["-V"], ["version"]];

  for (const args of attempts) {
    try {
      const output = NodeChildProcess.execFileSync(command, args, { encoding: "utf8" }).trim();
      const line = output.split("\n")[0]?.trim();
      if (line) {
        return line;
      }
    } catch {
      // Try next variant
    }
  }

  return "version unknown";
}

/** @type {(key: string) => boolean} */
function hasEnvVar(key) {
  return typeof process.env[key] === "string" && process.env[key] !== "";
}

/** @type {(versionLine: string) => number | null} */
function parseMajorVersion(versionLine) {
  const match = versionLine.match(/(\d+)\./);
  // @ts-expect-error --
  return match ? Number.parseInt(match[1], 10) : null;
}

/** @type {(kind: string, name: string, message: string) => void} */
function printStatus(kind, name, message) {
  console.log(`${kind.padEnd(12)} ${name.padEnd(12)} ${message}`);
}

let ok = true;

console.log("terminal-recording requirements\n");

for (const { tool, description, installInstructions } of requiredCommands) {
  const path = findCommand(tool);
  if (!path) {
    printStatus("MISSING", tool, `${description}. Install: ${installInstructions}`);
    ok = false;
    continue;
  }

  const version = readCommandVersion(tool);

  if (tool === "asciinema") {
    const major = parseMajorVersion(version);
    if (major === null || major < 3) {
      printStatus(
        "UNSUPPORTED",
        tool,
        `${version} (${path}) — asciinema v3+ is required for headless recording. Install: ${installInstructions}`,
      );
      ok = false;
      continue;
    }
  }

  printStatus("OK", tool, `${version} (${path})`);
}

console.log("");

for (const { key, description, installInstructions } of optionalKeys) {
  if (hasEnvVar(key)) {
    printStatus("OPTIONAL", key, "set");
  } else {
    printStatus("OPTIONAL", key, `not set — ${description}. Get/set: ${installInstructions}`);
  }
}

console.log("");

if (!ok) {
  console.error("Result: missing required dependencies.");
  process.exit(1);
}

console.log("Result: all required dependencies are available.");
