#!/usr/bin/env node
// Pure Offline ThreeRT Render Pipeline for `diamond-optics.ts`
//
// Usage (from /Users/raku/repos/blender-works):
//   npm run rt:diamond
//   npm run rt:diamond:render
//   node playground/threeRT/render-diamond.mjs [--spp 512] [--width 1600 --height 900]
//
// Pipeline:
//   1. Bakes 2K continuous-spectrum (64 CIE 1931 bands, 400..685 nm) forward wavefront caustics:
//        - playground/threeRT/out/caustics-wall.png  (1984x1088 linear sqrt-HDR)
//        - playground/threeRT/out/caustics-floor.png (1488x1088 linear sqrt-HDR)
//   2. Bundles `playground/threeRT/diamond-optics.ts` -> `playground/threeRT/out/diamond-optics.js`.
//   3. Runs ThreeRT's offline hardware path tracer (`threert-render serve`, Metal HWRT + OIDN + UE5 Filmic Post)
//      to render three 1600x900 offline frames:
//        - playground/threeRT/out/diamond-caustics-studio.png
//        - playground/threeRT/out/diamond-caustics-wall.png
//        - playground/threeRT/out/diamond-crystal-macro.png

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { bakeAllCaustics } from "./bake-diamond-caustics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLENDER_WORKS = path.resolve(__dirname, "../..");
const THREERT_ROOT = process.env.THREERT_ROOT || "/Users/raku/repos/others/ThreeRT";
const RENDER_BIN = path.join(THREERT_ROOT, "renderer/target/release/threert-render");
const PRESETS_DIR = path.join(THREERT_ROOT, "presets");
const BUNDLE_TOOL = path.join(THREERT_ROOT, "tools/bundle-game.ts");

const SCENE_SRC = path.join(__dirname, "diamond-optics.ts");
const OUT_DIR = path.join(__dirname, "out");
const BUNDLE_OUT = path.join(OUT_DIR, "diamond-optics.js");

const args = process.argv.slice(2);
const flagNum = (name, def) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : def;
};

const WIDTH = flagNum("--width", 1600);
const HEIGHT = flagNum("--height", 900);
const SPP = flagNum("--spp", 512);

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log("[1/3] Baking 64-wavelength continuous-spectrum forward wavefront caustics (2K)...");
bakeAllCaustics();

console.log(`[2/3] Bundling ${path.relative(BLENDER_WORKS, SCENE_SRC)}...`);
execFileSync(process.execPath, [BUNDLE_TOOL, SCENE_SRC, "-o", BUNDLE_OUT], {
  cwd: BLENDER_WORKS,
  stdio: "inherit",
});

const jobs = [
  {
    id: "diamond-caustics-studio",
    game: BUNDLE_OUT,
    assets: BLENDER_WORKS,
    state: { view: "studio" },
    seq: 1,
    spp: SPP,
    width: WIDTH,
    height: HEIGHT,
    out: path.join(OUT_DIR, "diamond-caustics-studio.png"),
  },
  {
    id: "diamond-caustics-wall",
    game: BUNDLE_OUT,
    assets: BLENDER_WORKS,
    state: { view: "wall" },
    seq: 2,
    spp: SPP,
    width: WIDTH,
    height: HEIGHT,
    out: path.join(OUT_DIR, "diamond-caustics-wall.png"),
  },
  {
    id: "diamond-crystal-macro",
    game: BUNDLE_OUT,
    assets: BLENDER_WORKS,
    state: { view: "macro" },
    seq: 3,
    spp: SPP,
    width: WIDTH,
    height: HEIGHT,
    out: path.join(OUT_DIR, "diamond-crystal-macro.png"),
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
    console.log(`  GPU Adapter: ${msg.adapter} (init ${msg.init_ms?.toFixed(0)} ms)`);
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
    console.log(
      `  [${done}/${jobs.length}] ${msg.id} -> ${path.relative(BLENDER_WORKS, jobs[done - 1].out)} (${st.timings_ms?.total_ms} ms, ${st.denoise})`,
    );
  }
});

proc.on("close", (code) => {
  if (code !== 0 && code !== null) {
    process.exit(code);
  }
  console.log(`Done! Offline renders saved to ${path.relative(BLENDER_WORKS, OUT_DIR)}/`);
});
