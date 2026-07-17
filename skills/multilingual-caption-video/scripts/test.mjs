#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildAss } from "./make-ass.mjs";

const ass = buildAss([{ start: 1.25, end: 3.5, text: "مرحباً، يا عالم" }], {
  width: 1080,
  height: 1920,
  font: "Noto Naskh Arabic UI",
  fontSize: 26,
});

assert.match(ass, /PlayResX: 1080/);
assert.match(ass, /PlayResY: 1920/);
assert.match(ass, /Style: Default,Noto Naskh Arabic UI,26,/);
assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:03\.50,Default,,0,0,0,,مرحباً، يا عالم/);
assert.throws(() => buildAss([{ start: 2, end: 1, text: "bad" }]));

console.log("caption-video script checks passed");
