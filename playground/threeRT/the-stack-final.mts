// Build the ThreeRT-ready GLB for The Stack from blender-works' own web export:
//   node playground/threeRT/the-stack-final.ts
//
// Reads:  web/assets/the_stack.glb
// Writes: the_stack/out/the_stack_final.glb
//         (and copies to $THREERT_ASSET_STORE/the_stack_final.glb when accessible)
//
// Three adjustments over the raw browser export so the path-traced dusk tower stays crisp and noise-free:
// 1. Restore physical dielectric glass (KHR_materials_transmission = 1, IOR = 1.52) instead of WebGL alpha blending.
// 2. Add 1.25 m vertical curtain-wall mullions + floor-line transoms across the office diagrid glass (matching
//    the_stack2's office curtain wall) so OIDN gets sharp first-hit normal/albedo edges instead of blurring across
//    empty 5 m diamonds, and darken upper-floor concrete slabs (`y > 52 m`) so they stop scattering noisy 1-sample
//    indirect grey smoke behind the glass (mall atrium slabs `y <= 52 m` stay bright).
// 3. Keep the 3D 1.4 m ceiling light panels at warm dusk luminance (3400 / 3100 nits) in smooth 3D tenant clusters,
//    paired with a subtle 75-nit warm ceiling halo tile right under the slab so lit rooms glow golden with zero noise.
import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const source = process.argv[2] ?? join(repoRoot, "web/assets/the_stack.glb");
const localOut = process.argv[3] ?? join(repoRoot, "the_stack/out/the_stack_final.glb");
const assetStore = process.env.THREERT_ASSET_STORE ?? resolve(repoRoot, "../others/threert-assets");
const storeOut = join(assetStore, "the_stack_final.glb");

type Mat = {
  name: string;
  alphaMode?: string;
  doubleSided?: boolean;
  emissiveFactor?: number[];
  pbrMetallicRoughness?: Record<string, any>;
  extensions?: Record<string, any>;
};
type Prim = { attributes: Record<string, number>; indices?: number; material?: number; mode?: number };
type Acc = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] };
type View = { buffer: number; byteOffset?: number; byteLength: number; target?: number };
type Gltf = {
  materials: Mat[];
  meshes: { name?: string; primitives: Prim[] }[];
  nodes: { mesh?: number; name?: string; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  accessors: Acc[];
  bufferViews: View[];
  buffers: { byteLength: number }[];
  scene?: number;
};

function readGlb(path: string) {
  const b = fs.readFileSync(path);
  const jsonLen = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + jsonLen).toString("utf8")) as Gltf, bin: b.subarray(20 + jsonLen + 8) };
}

function encodeGlb(json: unknown, bin: Buffer): Buffer {
  let j = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (j.length % 4)) % 4;
  if (pad) j = Buffer.concat([j, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(j.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, bin]);
}

const { json, bin: sourceBin } = readGlb(source);
let bin = sourceBin;
const byName = (n: string) => {
  const m = json.materials.find((x) => x.name === n);
  if (!m) throw new Error(`no material ${n} in ${source}`);
  return m;
};

// -------------------------------------------------------------------------------------------------------------- glass
const glass = byName("Stack_Glass_Cool_Web");
delete glass.alphaMode;
glass.extensions = { ...(glass.extensions ?? {}), KHR_materials_transmission: { transmissionFactor: 1 }, KHR_materials_ior: { ior: 1.52 } };
glass.pbrMetallicRoughness = { ...(glass.pbrMetallicRoughness ?? {}), baseColorFactor: [0.78, 0.84, 0.88, 1], metallicFactor: 0, roughnessFactor: 0.03 };

const glassDark = byName("Stack_Glass_Dark_Web");
delete glassDark.alphaMode;
glassDark.extensions = { ...(glassDark.extensions ?? {}), KHR_materials_transmission: { transmissionFactor: 1 }, KHR_materials_ior: { ior: 1.52 } };
glassDark.pbrMetallicRoughness = { ...(glassDark.pbrMetallicRoughness ?? {}), baseColorFactor: [0.55, 0.60, 0.66, 1], metallicFactor: 0, roughnessFactor: 0.03 };

const frost = byName("Stack_Glass_Frost_Web");
frost.pbrMetallicRoughness = { ...(frost.pbrMetallicRoughness ?? {}), baseColorFactor: [0.60, 0.65, 0.68, 0.18], metallicFactor: 0, roughnessFactor: 0.32 };

const coreMat = byName("Stack_Core");
if (coreMat.pbrMetallicRoughness) coreMat.pbrMetallicRoughness.baseColorFactor = [0.08, 0.08, 0.09, 1];

// ----------------------------------------------------------------------------------------------------------- emission
const strengths: Record<string, number> = {
  Stack_Light_Warm: 3400,
  Stack_Light_Daylight: 3100,
  Stack_Mall_Glow: 480,
  Stack_Light_Off: 18,
};
for (const [name, nits] of Object.entries(strengths)) {
  const m = byName(name);
  m.extensions = { ...(m.extensions ?? {}), KHR_materials_emissive_strength: { emissiveStrength: nits } };
}
const daylight = byName("Stack_Light_Daylight");
daylight.emissiveFactor = [1.0, 0.84, 0.62];
if (daylight.pbrMetallicRoughness) daylight.pbrMetallicRoughness.baseColorFactor = [1.0, 0.84, 0.62, 1];
const warm = byName("Stack_Light_Warm");
warm.emissiveFactor = [1.0, 0.70, 0.40];
if (warm.pbrMetallicRoughness) warm.pbrMetallicRoughness.baseColorFactor = [1.0, 0.70, 0.40, 1];

// ------------------------------------------------------------------------------------------------------ binary helpers
const CTYPE: Record<number, [string, number]> = {
  5120: ["getInt8", 1],
  5121: ["getUint8", 1],
  5122: ["getInt16", 2],
  5123: ["getUint16", 2],
  5125: ["getUint32", 4],
  5126: ["getFloat32", 4],
};
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

function readAccessor(i: number): Float64Array {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const [get, size] = CTYPE[a.componentType];
  const nc = NCOMP[a.type];
  const stride = (bv as any).byteStride ?? size * nc;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * nc);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < nc; c++) out[k * nc + c] = (dv as any)[get](base + k * stride + c * size, true);
  return out;
}

if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
const BASE = bin.length;
const extra: Buffer[] = [];
let extraBytes = 0;

function addAccessor(data: Float32Array | Uint32Array, type: "VEC3" | "SCALAR", target: number) {
  let buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length % 4) buf = Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);
  json.bufferViews.push({ buffer: 0, byteOffset: BASE + extraBytes, byteLength: buf.length, target });
  extra.push(buf);
  extraBytes += buf.length;
  const view = json.bufferViews.length - 1;
  const acc: Acc = {
    bufferView: view,
    componentType: data instanceof Float32Array ? 5126 : 5125,
    count: data.length / NCOMP[type],
    type,
  };
  if (type === "VEC3") {
    const n = NCOMP[type];
    const min = new Array(n).fill(Infinity);
    const max = new Array(n).fill(-Infinity);
    for (let i = 0; i < data.length; i += n) {
      for (let c = 0; c < n; c++) {
        const v = data[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    acc.min = min;
    acc.max = max;
  }
  json.accessors.push(acc);
  return json.accessors.length - 1;
}

// ----------------------------------------------------------------------- split Stack_Slabs (bright mall vs dark tower)
const slabMatIdx = json.materials.findIndex((m) => m.name === "Stack_Slabs");
const slabMeshIdx = json.meshes.findIndex((m) => m.primitives[0]?.material === slabMatIdx);
const dropNodes: number[] = [];

if (slabMeshIdx >= 0) {
  const slabNodeIdx = json.nodes.findIndex((n) => n.mesh === slabMeshIdx);
  const slabNode = json.nodes[slabNodeIdx];
  const tx = slabNode.translation?.[0] ?? 0;
  const ty = slabNode.translation?.[1] ?? 0;
  const tz = slabNode.translation?.[2] ?? 0;
  const pr = json.meshes[slabMeshIdx].primitives[0];
  const pos = readAccessor(pr.attributes.POSITION);
  const nor = readAccessor(pr.attributes.NORMAL);
  const idx = readAccessor(pr.indices!);

  const towerSlabMat: Mat = {
    name: "Stack_Slabs_Tower_Dark",
    doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [0.045, 0.038, 0.032, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  };
  json.materials.push(towerSlabMat);
  const towerSlabMatIdx = json.materials.length - 1;

  const mallTris: number[] = [];
  const towerTris: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const cy = (pos[idx[t * 3] * 3 + 1] + pos[idx[t * 3 + 1] * 3 + 1] + pos[idx[t * 3 + 2] * 3 + 1]) / 3 + ty;
    if (cy <= 52) mallTris.push(t);
    else towerTris.push(t);
  }

  for (const [label, tris, matId] of [
    ["Web_Stack_Slabs_Mall", mallTris, slabMatIdx],
    ["Web_Stack_Slabs_Tower", towerTris, towerSlabMatIdx],
  ] as const) {
    if (!tris.length) continue;
    const seen = new Map<string, number>();
    const pOut: number[] = [], nOut: number[] = [], iOut: number[] = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        const px = pos[v * 3] + tx, py = pos[v * 3 + 1] + ty, pz = pos[v * 3 + 2] + tz;
        const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
        const key = `${px},${py},${pz},${nx},${ny},${nz}`;
        let vi = seen.get(key);
        if (vi === undefined) {
          vi = pOut.length / 3;
          pOut.push(px, py, pz);
          nOut.push(nx, ny, nz);
          seen.set(key, vi);
        }
        iOut.push(vi);
      }
    }
    const pAcc = addAccessor(new Float32Array(pOut), "VEC3", 34962);
    const nAcc = addAccessor(new Float32Array(nOut), "VEC3", 34962);
    const iAcc = addAccessor(new Uint32Array(iOut), "SCALAR", 34963);
    json.meshes.push({ name: label, primitives: [{ attributes: { POSITION: pAcc, NORMAL: nAcc }, indices: iAcc, material: matId, mode: 4 }] });
    json.nodes.push({ mesh: json.meshes.length - 1, name: label });
    json.scenes[json.scene ?? 0].nodes.push(json.nodes.length - 1);
  }
  dropNodes.push(slabNodeIdx);
}

// ----------------------------------------------------------------------- add fine curtain-wall mullions like stack2
const frameMatIdx = json.materials.findIndex((m) => m.name === "Stack_Frame");
{
  const mPos: number[] = [], mNor: number[] = [], mInd: number[] = [];
  const addBox = (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => {
    const hx = dx / 2, hy = dy / 2, hz = dz / 2;
    const faces: [number[], number[][]][] = [
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    ];
    for (const [n, vs] of faces) {
      const base = mPos.length / 3;
      for (const v of vs) {
        mPos.push(cx + v[0], cy + v[1], cz + v[2]);
        mNor.push(n[0], n[1], n[2]);
      }
      mInd.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  const zFront = 20.28;
  const xFront = 57.78;
  const MULLION_STEP = 1.25;
  for (const s of [-1, 1]) {
    const nU = Math.round(115 / MULLION_STEP);
    for (let i = 0; i <= nU; i++) {
      const x = -57.5 + (i * 115) / nU;
      addBox(x, (55 + 115) / 2, s * (zFront - 0.12), 0.12, 60 - 0.04, 0.24);
    }
    for (let y = 55; y <= 115; y += 5) {
      addBox(0, y, s * (zFront - 0.11), 115, 0.18, 0.22);
    }
    for (let y = 120; y <= 170; y += 5) {
      addBox(0, y, s * (zFront - 0.11), 115, 0.18, 0.22);
    }
    const nV = Math.round(40 / MULLION_STEP);
    for (let i = 0; i <= nV; i++) {
      const z = -20 + (i * 40) / nV;
      addBox(s * (xFront - 0.12), (55 + 115) / 2, z, 0.24, 60 - 0.04, 0.12);
    }
    for (let y = 55; y <= 115; y += 5) {
      addBox(s * (xFront - 0.11), y, 0, 0.22, 0.18, 40);
    }
  }
  const pAcc = addAccessor(new Float32Array(mPos), "VEC3", 34962);
  const nAcc = addAccessor(new Float32Array(mNor), "VEC3", 34962);
  const iAcc = addAccessor(new Uint32Array(mInd), "SCALAR", 34963);
  json.meshes.push({ name: "Web_Diagrid_Curtain_Grid", primitives: [{ attributes: { POSITION: pAcc, NORMAL: nAcc }, indices: iAcc, material: frameMatIdx, mode: 4 }] });
  json.nodes.push({ mesh: json.meshes.length - 1, name: "Web_Diagrid_Curtain_Grid" });
  json.scenes[json.scene ?? 0].nodes.push(json.nodes.length - 1);
}

// ------------------------------------------------------------------------------------------------------ window pattern
function hash(i: number, j: number, k: number) {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number, z: number) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = smooth(x - i), fy = smooth(y - j), fz = smooth(z - k);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (di: number, dj: number, dk: number) => hash(i + di, j + dj, k + dk);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
const field = (x: number, y: number, z: number) =>
  0.55 * noise(x / 36, y / 15, z / 36) +
  0.30 * noise(x / 15 + 31, y / 6 + 11, z / 15 + 7) +
  0.15 * noise(x / 6 + 71, y / 3 + 41, z / 6 + 13);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20241116);

type Room = { tris: number[]; c: [number, number, number] };

function roomsOf(pr: Prim) {
  const pos = readAccessor(pr.attributes.POSITION);
  const nor = readAccessor(pr.attributes.NORMAL);
  const idx = readAccessor(pr.indices!);
  const nt = idx.length / 3;
  const cx = new Float64Array(nt), cy = new Float64Array(nt), cz = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      cx[t] += pos[v * 3] / 3;
      cy[t] += pos[v * 3 + 1] / 3;
      cz[t] += pos[v * 3 + 2] / 3;
    }
  }
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const CELL = 1;
  const grid = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) {
    const key = `${Math.floor(cx[t] / CELL)},${Math.floor(cy[t] / CELL)},${Math.floor(cz[t] / CELL)}`;
    const list = grid.get(key);
    if (list) list.push(t);
    else grid.set(key, [t]);
  }
  for (const [key, list] of grid) {
    const [ix, iy, iz] = key.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const other = grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!other) continue;
          for (const a of list)
            for (const b of other)
              if (a < b) {
                const ex = cx[a] - cx[b], ey = cy[a] - cy[b], ez = cz[a] - cz[b];
                if (ex * ex + ey * ey + ez * ez < 0.49) unite(a, b);
              }
        }
  }
  const groups = new Map<number, Room>();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let g = groups.get(r);
    if (!g) {
      g = { tris: [], c: [0, 0, 0] };
      groups.set(r, g);
    }
    g.tris.push(t);
    g.c[0] += cx[t];
    g.c[1] += cy[t];
    g.c[2] += cz[t];
  }
  for (const g of groups.values()) {
    const n = g.tris.length;
    g.c = [g.c[0] / n, g.c[1] / n, g.c[2] / n];
  }
  return { pos, nor, idx, rooms: [...groups.values()] };
}

const LEVELS = [
  { mul: 0.55, share: 0.25 },
  { mul: 1.00, share: 0.60 },
  { mul: 1.45, share: 0.15 },
];
const BASE_NITS: Record<string, number> = {
  Stack_Light_Warm: strengths.Stack_Light_Warm,
  Stack_Light_Daylight: strengths.Stack_Light_Daylight,
};
const matFor = new Map<string, number>();

function litMaterial(base: string, level: number) {
  const name = `${base}_L${level + 1}`;
  const seen = matFor.get(name);
  if (seen !== undefined) return seen;
  const m = JSON.parse(JSON.stringify(byName(base))) as Mat;
  m.name = name;
  m.extensions = { ...(m.extensions ?? {}), KHR_materials_emissive_strength: { emissiveStrength: Math.round(BASE_NITS[base] * LEVELS[level].mul) } };
  json.materials.push(m);
  matFor.set(name, json.materials.length - 1);
  return json.materials.length - 1;
}

const haloMat: Mat = {
  name: "Stack_Ceiling_Halo_Warm",
  doubleSided: true,
  emissiveFactor: [1.0, 0.68, 0.36],
  pbrMetallicRoughness: { baseColorFactor: [0.12, 0.09, 0.06, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  extensions: { KHR_materials_emissive_strength: { emissiveStrength: 75 } },
};
json.materials.push(haloMat);
const haloMatIdx = json.materials.length - 1;
const haloPos: number[] = [], haloNor: number[] = [], haloInd: number[] = [];

const buckets = new Map<string, { material: number; parts: { m: number; tris: number[] }[] }>();
const sources = new Map<number, ReturnType<typeof roomsOf>>();
type RoomRef = { m: number; room: Room; f: number; src: string };
const rooms: RoomRef[] = [];

for (const name of ["Stack_Light_Warm", "Stack_Light_Daylight", "Stack_Light_Off"]) {
  const meshIndex = json.meshes.findIndex((m) => json.materials[m.primitives[0].material!]?.name === name);
  if (meshIndex < 0) throw new Error(`no mesh for ${name}`);
  const nodeIndex = json.nodes.findIndex((n) => n.mesh === meshIndex);
  const node = json.nodes[nodeIndex];
  if (node.translation || node.rotation || node.scale) throw new Error(`${name} node has a transform; the pattern assumes panel-local = world space`);
  dropNodes.push(nodeIndex);

  const geo = roomsOf(json.meshes[meshIndex].primitives[0]);
  sources.set(meshIndex, geo);
  for (const room of geo.rooms) rooms.push({ m: meshIndex, room, f: field(room.c[0], room.c[1], room.c[2]), src: name });
}

rooms.sort((a, b) => a.f - b.f);
const offMaterial = json.materials.findIndex((m) => m.name === "Stack_Light_Off");
let litCount = 0;
for (let i = 0; i < rooms.length; i++) {
  const { m, room, src } = rooms[i];
  const rank = (i + 0.5) / rooms.length;
  const share = Math.min(0.97, Math.max(0.03, 0.5 + 1.6 * (rank - 0.5)));
  const on = rng() < share;
  let key: string;
  let material: number;
  if (!on) {
    key = "Stack_Light_Off";
    material = offMaterial;
  } else {
    litCount++;
    const base = src === "Stack_Light_Off" ? (rng() < 0.65 ? "Stack_Light_Warm" : "Stack_Light_Daylight") : src;
    const r = rng();
    let level = 0;
    let acc = LEVELS[0].share;
    while (level < LEVELS.length - 1 && r >= acc) {
      level++;
      acc += LEVELS[level].share;
    }
    key = `${base}_L${level + 1}`;
    material = litMaterial(base, level);

    const [cx, cy, cz] = room.c;
    const hy = cy + 0.04; // panel is [cy-0.05, cy+0.05] (59.75..59.85), slab bottom is cy+0.06 (59.86)
    const hw = 1.72;
    const b = haloPos.length / 3;
    for (const [px, pz] of [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]]) {
      haloPos.push(px, hy, pz);
      haloNor.push(0, -1, 0);
    }
    haloInd.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { material, parts: [] };
    buckets.set(key, bucket);
  }
  bucket.parts.push({ m, tris: room.tris });
}
console.log(`  ${rooms.length} panels, ${litCount} lit (${((litCount / rooms.length) * 100).toFixed(0)}%)`);

if (haloInd.length > 0) {
  const pAcc = addAccessor(new Float32Array(haloPos), "VEC3", 34962);
  const nAcc = addAccessor(new Float32Array(haloNor), "VEC3", 34962);
  const iAcc = addAccessor(new Uint32Array(haloInd), "SCALAR", 34963);
  json.meshes.push({ name: "Web_Stack_Ceiling_Halo", primitives: [{ attributes: { POSITION: pAcc, NORMAL: nAcc }, indices: iAcc, material: haloMatIdx, mode: 4 }] });
  json.nodes.push({ mesh: json.meshes.length - 1, name: "Web_Stack_Ceiling_Halo" });
  json.scenes[json.scene ?? 0].nodes.push(json.nodes.length - 1);
}

for (const [name, bucket] of buckets) {
  const seen = new Map<string, number>();
  const pos: number[] = [], nor: number[] = [], ind: number[] = [];
  for (const part of bucket.parts) {
    const g = sources.get(part.m)!;
    for (const t of part.tris) {
      for (let k = 0; k < 3; k++) {
        const v = g.idx[t * 3 + k];
        const px = g.pos[v * 3], py = g.pos[v * 3 + 1], pz = g.pos[v * 3 + 2];
        const nx = g.nor[v * 3], ny = g.nor[v * 3 + 1], nz = g.nor[v * 3 + 2];
        const key = `${px},${py},${pz},${nx},${ny},${nz}`;
        let i = seen.get(key);
        if (i === undefined) {
          i = pos.length / 3;
          pos.push(px, py, pz);
          nor.push(nx, ny, nz);
          seen.set(key, i);
        }
        ind.push(i);
      }
    }
  }
  const posAcc = addAccessor(new Float32Array(pos), "VEC3", 34962);
  const norAcc = addAccessor(new Float32Array(nor), "VEC3", 34962);
  const idxAcc = addAccessor(new Uint32Array(ind), "SCALAR", 34963);
  json.meshes.push({
    name: `Web_${name}`,
    primitives: [{ attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: idxAcc, material: bucket.material, mode: 4 }],
  });
  json.nodes.push({ mesh: json.meshes.length - 1, name: `Web_${name}` });
  json.scenes[json.scene ?? 0].nodes.push(json.nodes.length - 1);
}

json.scenes[json.scene ?? 0].nodes = json.scenes[json.scene ?? 0].nodes.filter((n) => !dropNodes.includes(n));
json.buffers[0].byteLength = BASE + extraBytes;
bin = Buffer.concat([bin, ...extra]);

const glbBytes = encodeGlb(json, bin);
fs.mkdirSync(dirname(localOut), { recursive: true });
fs.writeFileSync(localOut, glbBytes);
console.log(`wrote ${localOut} (${(glbBytes.length / 1048576).toFixed(1)} MB)`);

if (!process.argv[3]) {
  try {
    fs.copyFileSync(localOut, storeOut);
    console.log(`synced -> ${storeOut}`);
  } catch {
    console.log(`(skipped syncing to ${storeOut}; copy manually or grant access if needed)`);
  }
}
