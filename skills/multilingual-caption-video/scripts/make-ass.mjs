#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function assText(text) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/\r?\n/g, "\\N");
}

export function buildAss(cues, options = {}) {
  const {
    width = 1920,
    height = 1080,
    font = "Noto Sans",
    fontSize = 26,
    marginBottom = 70,
  } = options;

  if (!Array.isArray(cues) || cues.length === 0)
    throw new Error("At least one caption cue is required");
  if (font.includes(",") || /[\r\n]/.test(font))
    throw new Error("Font name contains invalid characters");
  if (
    ![width, height, fontSize, marginBottom].every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error("ASS dimensions, font size, and margin must be positive numbers");
  }

  const dialogue = cues.map((cue) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) {
      throw new Error(`Invalid caption interval: ${JSON.stringify(cue)}`);
    }
    if (typeof cue.text !== "string" || !cue.text.trim())
      throw new Error("Caption text cannot be empty");
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${assText(cue.text.trim())}`;
  });

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,${marginBottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogue.join("\n")}
`;
}

function parseArguments(args) {
  const [input, output, ...flags] = args;
  if (!input || !output) {
    throw new Error(
      "Usage: node make-ass.mjs captions.json output.ass [--width N] [--height N] [--font NAME] [--font-size N] [--margin-bottom N]",
    );
  }

  const options = {};
  const names = {
    "--width": "width",
    "--height": "height",
    "--font": "font",
    "--font-size": "fontSize",
    "--margin-bottom": "marginBottom",
  };

  for (let index = 0; index < flags.length; index += 2) {
    const name = names[flags[index]];
    const value = flags[index + 1];
    if (!name || value === undefined)
      throw new Error(`Unknown or incomplete option: ${flags[index]}`);
    options[name] = name === "font" ? value : Number(value);
  }

  return { input, output, options };
}

function main() {
  const { input, output, options } = parseArguments(process.argv.slice(2));
  const parsed = JSON.parse(fs.readFileSync(input, "utf8"));
  fs.writeFileSync(output, buildAss(Array.isArray(parsed) ? parsed : parsed.cues, options));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
