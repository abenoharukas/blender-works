#!/usr/bin/env node
// Pure Offline ThreeRT Render Pipeline for `prism-optics.ts`

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { bakeAllPrismCaustics } from "./bake-prism-caustics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLENDER_WORKS = path.resolve(__dirname, "../..");
const THREERT_ROOT = process.env.THREERT_ROOT || "/Users/raku/repos/others/ThreeRT";
const RENDER_BIN = path.join(THREERT_ROOT, "renderer/target/release/threert-render");
const PRESETS_DIR = path.join(THREERT_ROOT, "presets");
const BUNDLE_TOOL = path.join(THREERT_ROOT, "tools/bundle-game.ts");

const SCENE_SRC = path.join(__dirname, "prism-optics.ts");
const OUT_DIR = path.join(__dirname, "out");
const BUNDLE_OUT = path.join(OUT_DIR, "prism-optics.js");

const WIDTH = 1600;
const HEIGHT = 900;
const SPP = 256;

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("[1/3] Baking 64-wavelength Snell's-law prism caustics...");
bakeAllPrismCaustics();

console.log(`[2/3] Bundling ${path.relative(BLENDER_WORKS, SCENE_SRC)}...`);
execFileSync(process.execPath, [BUNDLE_TOOL, SCENE_SRC, "-o", BUNDLE_OUT], {
  cwd: BLENDER_WORKS,
  stdio: "inherit",
});

const jobs = [
  {
    id: "prism-studio",
    game: BUNDLE_OUT,
    assets: BLENDER_WORKS,
    state: { view: "studio" },
    seq: 1,
    spp: SPP,
    width: WIDTH,
    height: HEIGHT,
    out: path.join(OUT_DIR, "prism-studio.png"),
  },
  {
    id: "prism-wall",
    game: BUNDLE_OUT,
    assets: BLENDER_WORKS,
    state: { view: "wall" },
    seq: 2,
    spp: SPP,
    width: WIDTH,
    height: HEIGHT,
    out: path.join(OUT_DIR, "prism-wall.png"),
  },
];

console.log(`[3/3] Offline path-tracing ${jobs.length} views via threert-render (${WIDTH}x${HEIGHT}, ${SPP} spp)...`);
const proc = spawn(RENDER_BIN, ["serve", "--presets", PRESETS_DIR], {
  stdio: ["pipe", "pipe", "inherit"],
});

const rl = readline.createInterface({ input: proc.stdout });
let done = 0;

rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.ready) {
    console.log(`  GPU Adapter: ${msg.adapter}`);
    for (const j of jobs) proc.stdin.write(JSON.stringify(j) + "\n");
    proc.stdin.end();
    return;
  }
  done++;
  if (!msg.ok) {
    console.error(`  [${done}/${jobs.length}] ${msg.id} FAILED: ${msg.error}`);
    process.exitCode = 1;
  } else {
    const st = msg.stats;
    console.log(`  [${done}/${jobs.length}] ${msg.id} -> ${path.relative(BLENDER_WORKS, jobs[done - 1].out)} (${st.timings_ms?.total_ms} ms)`);
  }
});

proc.on("close", (code) => {
  if (code !== 0 && code !== null) process.exit(code);
});
