#!/usr/bin/env node
// Downloads real Tokyo Project PLATEAU 2025 LOD2 3D Tiles for Nishi-Shinjuku
// (13104 Shinjuku-ku: dense low-rise residential neighborhood in Nishi-Shinjuku
// 4/5-chome framed by the Shinjuku skyscraper cluster to the east), transforms
// ECEF + CESIUM_RTC coordinates to a local Three.js ENU frame (+X East, +Y Up,
// +Z South), excavates the central residential block by whole-building _BATCHID
// so any of the 5 blender-works buildings can be placed and switched inside it,
// normalizes building base heights to the excavated plot plane, and writes
// meshopt-compressed `plateau/web/tokyo_plateau.optimized.glb`.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE_DIR = path.join(ROOT, 'plateau/out/cache_b3dm');
const RAW_GLB = path.join(ROOT, 'plateau/out/tokyo_plateau.raw.glb');
const OPT_GLB = path.join(ROOT, 'plateau/web/tokyo_plateau.optimized.glb');

// Official Project PLATEAU 2025 Shinjuku-ku LOD2 textured 3D Tiles dataset
const TILESET_BASE =
  'https://assets.cms.plateau.reearth.io/assets/00/bed0bd-f882-4cde-b942-21d0f8d2ddc2/13104_shinjuku-ku_pref_2025_citygml_1_op_bldg_3dtiles_13104_shinjuku-ku_lod2/';

// Official Project PLATEAU 2025 Shinjuku-ku LOD3 Transportation (Roads) 3D Tiles
const TRAN_TILESET_BASE =
  'https://assets.cms.plateau.reearth.io/assets/5d/8e46a6-98de-4829-8e4f-656c7cc89348/13104_shinjuku-ku_pref_2025_citygml_1_op_tran_3dtiles_lod3/';

// Center of our excavated residential plot in Nishi-Shinjuku 5-chome
// (low-rise detached houses immediately west of Shinjuku Central Park & Tocho)
const ORIGIN_LON_DEG = 139.6852;
const ORIGIN_LAT_DEG = 35.6915;
const ORIGIN_H = 63.7; // reference ellipsoid height (m) at plot center

// District window in local metres (X = East, Z = South / -North):
// West: -340 m (Kumano Shrine / Nishi-Shinjuku 5-chome residential lanes)
// East: +960 m (Shinjuku Central Park + Tocho / Park Hyatt / Mode Gakuen skyscrapers)
// North/South: [-480 m, +480 m]
const BBOX_X = [-340, 960];
const BBOX_Z = [-480, 480];

// Central excavated residential plot bounds (in local scene metres).
// Every PLATEAU building whose 2D footprint intersects this box is cleanly
// removed as a complete building (by _BATCHID), leaving an open urban site
// surrounded on all four sides by real Tokyo LOD2 houses and towers.
export const EXCAVATED_PLOT = {
  x0: -136,
  x1: 136,
  z0: -110,
  z1: 120,
};

// WGS84 ellipsoid constants
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

function llaToEcef(lonRad, latRad, h) {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + h) * cosLat * cosLon,
    (N + h) * cosLat * sinLon,
    (N * (1 - WGS84_E2) + h) * sinLat,
  ];
}

const lon0 = (ORIGIN_LON_DEG * Math.PI) / 180;
const lat0 = (ORIGIN_LAT_DEG * Math.PI) / 180;
const originEcef = llaToEcef(lon0, lat0, ORIGIN_H);

const sinLat0 = Math.sin(lat0);
const cosLat0 = Math.cos(lat0);
const sinLon0 = Math.sin(lon0);
const cosLon0 = Math.cos(lon0);

// Local tangent ENU basis vectors at (lon0, lat0)
const EAST = [-sinLon0, cosLon0, 0];
const NORTH = [-sinLat0 * cosLon0, -sinLat0 * sinLon0, cosLat0];
const UP = [cosLat0 * cosLon0, cosLat0 * sinLon0, sinLat0];

/**
 * Converts an ECEF point to local Three.js coordinates (+X East, +Y Up, +Z South).
 */
function ecefToThree(ex, ey, ez) {
  const dx = ex - originEcef[0];
  const dy = ey - originEcef[1];
  const dz = ez - originEcef[2];
  const e = dx * EAST[0] + dy * EAST[1] + dz * EAST[2];
  const n = dx * NORTH[0] + dy * NORTH[1] + dz * NORTH[2];
  const u = dx * UP[0] + dy * UP[1] + dz * UP[2];
  return [e, u, -n];
}

/**
 * Converts a glTF normal vector from 3D Tiles Y-up (where glTF +Y = ECEF +Z,
 * glTF -Z = ECEF +Y) to local Three.js coordinates (+X East, +Y Up, +Z South).
 */
function gltfNormalToThree(nx, ny, nz) {
  const ex = nx;
  const ey = -nz;
  const ez = ny;
  const e = ex * EAST[0] + ey * EAST[1] + ez * EAST[2];
  const n = ex * NORTH[0] + ey * NORTH[1] + ez * NORTH[2];
  const u = ex * UP[0] + ey * UP[1] + ez * UP[2];
  const len = Math.hypot(e, u, n) || 1;
  return [e / len, u / len, -n / len];
}

async function fetchCached(relUri, baseUrl = TILESET_BASE, prefix = '') {
  const safeName = prefix + relUri.replace(/[\/\\]/g, '_');
  const localPath = path.join(CACHE_DIR, safeName);
  try {
    return await fs.readFile(localPath);
  } catch {
    const res = await fetch(baseUrl + relUri);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${baseUrl + relUri}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(localPath, buf);
    return buf;
  }
}

function unpackB3dmToCleanGlb(b3dmBuf) {
  const u8 = new Uint8Array(b3dmBuf.buffer, b3dmBuf.byteOffset, b3dmBuf.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ftJsonLen = dv.getUint32(12, true);
  const ftBinLen = dv.getUint32(16, true);
  const btJsonLen = dv.getUint32(20, true);
  const btBinLen = dv.getUint32(24, true);
  const glbOffset = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
  const glb = u8.subarray(glbOffset);
  const c0Len = dv.getUint32(glbOffset + 12, true);
  const gltfJson = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + c0Len)));
  const rtc = gltfJson.extensions?.CESIUM_RTC?.center ?? [0, 0, 0];

  gltfJson.extensionsUsed = (gltfJson.extensionsUsed || []).filter((e) => e !== 'CESIUM_RTC');
  gltfJson.extensionsRequired = (gltfJson.extensionsRequired || []).filter((e) => e !== 'CESIUM_RTC');
  if (gltfJson.extensions) delete gltfJson.extensions.CESIUM_RTC;

  let newJsonBytes = new TextEncoder().encode(JSON.stringify(gltfJson));
  const pad = (4 - (newJsonBytes.length % 4)) % 4;
  if (pad > 0) {
    const padded = new Uint8Array(newJsonBytes.length + pad);
    padded.set(newJsonBytes);
    padded.fill(0x20, newJsonBytes.length);
    newJsonBytes = padded;
  }
  const binChunk = glb.subarray(20 + c0Len);
  const newGlb = new Uint8Array(20 + newJsonBytes.length + binChunk.length);
  const ndv = new DataView(newGlb.buffer);
  ndv.setUint32(0, 0x46546c67, true);
  ndv.setUint32(4, 2, true);
  ndv.setUint32(8, newGlb.length, true);
  ndv.setUint32(12, newJsonBytes.length, true);
  ndv.setUint32(16, 0x4e4f534a, true);
  newGlb.set(newJsonBytes, 20);
  newGlb.set(binChunk, 20 + newJsonBytes.length);
  return { glb: newGlb, rtc };
}

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OPT_GLB), { recursive: true });

  console.log('[1/4] Fetching Shinjuku-ku LOD2 tileset.json...');
  const tsBuf = await fetchCached('tileset.json');
  const tileset = JSON.parse(tsBuf.toString('utf-8'));

  const leaves = [];
  function walk(node) {
    if (!node.children?.length && node.content?.uri) leaves.push(node);
    for (const c of node.children || []) walk(c);
  }
  walk(tileset.root);

  const selectedTiles = [];
  for (const n of leaves) {
    const reg = n.content.boundingVolume?.region || n.boundingVolume?.region;
    if (!reg) continue;
    const lon = (reg[0] + reg[2]) * 0.5;
    const lat = (reg[1] + reg[3]) * 0.5;
    const [tx, , tz] = ecefToThree(...llaToEcef(lon, lat, ORIGIN_H));
    if (tx >= BBOX_X[0] && tx <= BBOX_X[1] && tz >= BBOX_Z[0] && tz <= BBOX_Z[1]) {
      selectedTiles.push({ uri: n.content.uri, tx, tz, maxH: reg[5] });
    }
  }
  console.log(`      Selected ${selectedTiles.length} leaf tiles covering Nishi-Shinjuku residential & skyline.`);

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression, EXTTextureWebP])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
    });

  // Output combined document
  const outDoc = new Document();
  outDoc.createExtension(EXTTextureWebP);
  const outBuf = outDoc.createBuffer('plateau_tokyo');
  const outScene = outDoc.createScene('PlateauTokyo');
  const rootNode = outDoc.createNode('Plateau_Shinjuku_LOD2');
  outScene.addChild(rootNode);

  // Create 8 architectural material buckets for untextured PLATEAU residential &
  // mid-rise geometry (6 facade wall palettes + 2 roof palettes) with Box-projected
  // planar UVs (repeat every 8 m) so runtime canvas textures & night window
  // emissive maps work identically to streets/web!
  const WALL_PALETTE = [
    { name: 'Plateau_Res_Wall_0', color: [0.92, 0.90, 0.86, 1.0], rough: 0.85 },
    { name: 'Plateau_Res_Wall_1', color: [0.87, 0.84, 0.79, 1.0], rough: 0.85 },
    { name: 'Plateau_Res_Wall_2', color: [0.81, 0.78, 0.73, 1.0], rough: 0.84 },
    { name: 'Plateau_Res_Wall_3', color: [0.30, 0.33, 0.38, 1.0], rough: 0.78 },
    { name: 'Plateau_Res_Wall_4', color: [0.76, 0.67, 0.59, 1.0], rough: 0.82 },
    { name: 'Plateau_Comm_Wall_0', color: [0.84, 0.82, 0.78, 1.0], rough: 0.74 },
  ];
  const ROOF_PALETTE = [
    { name: 'Plateau_Res_Roof_0', color: [0.24, 0.27, 0.31, 1.0], rough: 0.62 },
    { name: 'Plateau_Res_Roof_1', color: [0.38, 0.28, 0.23, 1.0], rough: 0.66 },
  ];

  const wallBuckets = WALL_PALETTE.map((p) => ({
    mat: outDoc
      .createMaterial(p.name)
      .setBaseColorFactor(p.color)
      .setRoughnessFactor(p.rough)
      .setMetallicFactor(0.05),
    pos: [],
    norm: [],
    uv: [],
    idx: [],
  }));
  const roofBuckets = ROOF_PALETTE.map((p) => ({
    mat: outDoc
      .createMaterial(p.name)
      .setBaseColorFactor(p.color)
      .setRoughnessFactor(p.rough)
      .setMetallicFactor(0.12),
    pos: [],
    norm: [],
    uv: [],
    idx: [],
  }));

  let totalKeptBuildings = 0;
  let totalExcavatedBuildings = 0;
  let totalKeptTris = 0;

  console.log('[2/4] Downloading & excavating residential plot buildings...');
  for (let ti = 0; ti < selectedTiles.length; ti++) {
    const tileInfo = selectedTiles[ti];
    const rawB3dm = await fetchCached(tileInfo.uri);
    const { glb, rtc } = unpackB3dmToCleanGlb(rawB3dm);
    const tileDoc = await io.readBinary(glb);

    // First pass on this tile: compute 3D bounding box & centroid per _BATCHID in local ENU frame
    const bldgBounds = new Map();
    for (const mesh of tileDoc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const batch = prim.getAttribute('_BATCHID');
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i++) {
          const bid = batch ? batch.getScalar(i) : 0;
          const [vx, vy, vz] = pos.getElement(i, [0, 0, 0]);
          // 3D Tiles 1.0 glTF Y-up -> ECEF Z-up: ECEF = RTC + [vx, -vz, vy]
          const [x, y, z] = ecefToThree(rtc[0] + vx, rtc[1] - vz, rtc[2] + vy);
          let b = bldgBounds.get(bid);
          if (!b) {
            b = {
              minX: 1e9,
              maxX: -1e9,
              minY: 1e9,
              maxY: -1e9,
              minZ: 1e9,
              maxZ: -1e9,
              sumX: 0,
              sumY: 0,
              sumZ: 0,
              count: 0,
            };
            bldgBounds.set(bid, b);
          }
          if (x < b.minX) b.minX = x;
          if (x > b.maxX) b.maxX = x;
          if (y < b.minY) b.minY = y;
          if (y > b.maxY) b.maxY = y;
          if (z < b.minZ) b.minZ = z;
          if (z > b.maxZ) b.maxZ = z;
          b.sumX += x;
          b.sumY += y;
          b.sumZ += z;
          b.count += 1;
        }
      }
    }

    // Decide which buildings (_BATCHID) are excavated vs kept.
    const excavatedBids = new Set();
    for (const [bid, b] of bldgBounds.entries()) {
      const overlapsPlot =
        b.maxX >= EXCAVATED_PLOT.x0 &&
        b.minX <= EXCAVATED_PLOT.x1 &&
        b.maxZ >= EXCAVATED_PLOT.z0 &&
        b.minZ <= EXCAVATED_PLOT.z1;
      if (overlapsPlot) {
        excavatedBids.add(bid);
        totalExcavatedBuildings++;
      } else {
        totalKeptBuildings++;
      }
    }

    // Copy texture if this tile has textured primitives
    let tileMat = null;
    const srcTextures = tileDoc.getRoot().listTextures();
    if (srcTextures.length > 0) {
      const srcTex = srcTextures[0];
      const imgBytes = srcTex.getImage();
      if (imgBytes) {
        const outTex = outDoc
          .createTexture(`tex_${ti}`)
          .setMimeType(srcTex.getMimeType() || 'image/webp')
          .setImage(imgBytes);
        tileMat = outDoc
          .createMaterial(`Plateau_Tile_${ti}`)
          .setBaseColorTexture(outTex)
          .setRoughnessFactor(0.78)
          .setMetallicFactor(0.08);
      }
    }

    // Second pass: filter triangles & transform kept vertices
    for (const mesh of tileDoc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const norm = prim.getAttribute('NORMAL');
        const uv = prim.getAttribute('TEXCOORD_0');
        const batch = prim.getAttribute('_BATCHID');
        const indices = prim.getIndices();
        if (!pos || !indices) continue;

        const hasUv = Boolean(uv && tileMat);
        const newPos = [];
        const newNorm = [];
        const newUv = [];
        const newIdx = [];
        const remap = new Int32Array(pos.getCount()).fill(-1);

        const idxCount = indices.getCount();
        for (let t = 0; t < idxCount; t += 3) {
          const i0 = indices.getScalar(t);
          const i1 = indices.getScalar(t + 1);
          const i2 = indices.getScalar(t + 2);
          const bid0 = batch ? batch.getScalar(i0) : 0;
          if (excavatedBids.has(bid0)) continue;

          if (hasUv) {
            const b = bldgBounds.get(bid0);
            const triPts = [];
            const triUvs = [];
            for (const vi of [i0, i1, i2]) {
              const [vx, vy, vz] = pos.getElement(vi, [0, 0, 0]);
              const [tx, ty, tz] = ecefToThree(rtc[0] + vx, rtc[1] - vz, rtc[2] + vy);
              const groundedY = Math.max(0, ty - (b ? b.minY : 0));
              triPts.push([tx, groundedY, tz]);
              triUvs.push(uv.getElement(vi, [0, 0]));
            }
            // Compute geometric face normal from triangle edges
            const ux = triPts[1][0] - triPts[0][0];
            const uy = triPts[1][1] - triPts[0][1];
            const uz = triPts[1][2] - triPts[0][2];
            const vx = triPts[2][0] - triPts[0][0];
            const vy = triPts[2][1] - triPts[0][1];
            const vz = triPts[2][2] - triPts[0][2];
            let fnx = uy * vz - uz * vy;
            let fny = uz * vx - ux * vz;
            let fnz = ux * vy - uy * vx;
            const flen = Math.hypot(fnx, fny, fnz);
            if (flen < 1e-6) continue;
            fnx /= flen;
            fny /= flen;
            fnz /= flen;

            // Drop subterranean bottom floor caps (y < 0.35 m and horizontal)
            const avgY = (triPts[0][1] + triPts[1][1] + triPts[2][1]) / 3;
            if (avgY < 0.35 && Math.abs(fny) > 0.75) continue;

            // Fix inverted CityGML polygons: roofs (> 0.55 vertical normal) must face +Y;
            // walls must face outward from the building's 2D footprint center.
            let flip = false;
            if (Math.abs(fny) > 0.55) {
              if (fny < 0) flip = true;
            } else if (b && b.count > 0) {
              const cx = b.sumX / b.count;
              const cz = b.sumZ / b.count;
              const mx = (triPts[0][0] + triPts[1][0] + triPts[2][0]) / 3 - cx;
              const mz = (triPts[0][2] + triPts[1][2] + triPts[2][2]) / 3 - cz;
              if (fnx * mx + fnz * mz < 0) flip = true;
            }
            if (flip) {
              fnx = -fnx;
              fny = -fny;
              fnz = -fnz;
              const tmpP = triPts[1];
              triPts[1] = triPts[2];
              triPts[2] = tmpP;
              const tmpU = triUvs[1];
              triUvs[1] = triUvs[2];
              triUvs[2] = tmpU;
            }

            const baseV = newPos.length / 3;
            for (let k = 0; k < 3; k++) {
              newPos.push(triPts[k][0], triPts[k][1], triPts[k][2]);
              newNorm.push(fnx, fny, fnz);
              newUv.push(triUvs[k][0], triUvs[k][1]);
              newIdx.push(baseV + k);
            }
            totalKeptTris++;
          } else {
            // Untextured PLATEAU geometry: compute clean outward face normal,
            // classify into Roof vs Wall, assign deterministic palette bucket per
            // building (_BATCHID), and generate architectural Box-projected UVs.
            const b = bldgBounds.get(bid0);
            const bHeight = b ? b.maxY - b.minY : 7;
            const hash = Math.abs(Math.imul(bid0 + ti * 131, 0x45d9f3b));
            const triPts = [];
            for (const vi of [i0, i1, i2]) {
              const [vx, vy, vz] = pos.getElement(vi, [0, 0, 0]);
              const [tx, ty, tz] = ecefToThree(rtc[0] + vx, rtc[1] - vz, rtc[2] + vy);
              const groundedY = Math.max(0, ty - (b ? b.minY : 0));
              triPts.push([tx, groundedY, tz]);
            }

            const ux = triPts[1][0] - triPts[0][0];
            const uy = triPts[1][1] - triPts[0][1];
            const uz = triPts[1][2] - triPts[0][2];
            const vx = triPts[2][0] - triPts[0][0];
            const vy = triPts[2][1] - triPts[0][1];
            const vz = triPts[2][2] - triPts[0][2];
            let fnx = uy * vz - uz * vy;
            let fny = uz * vx - ux * vz;
            let fnz = ux * vy - uy * vx;
            const flen = Math.hypot(fnx, fny, fnz);
            if (flen < 1e-6) continue;
            fnx /= flen;
            fny /= flen;
            fnz /= flen;

            const avgY = (triPts[0][1] + triPts[1][1] + triPts[2][1]) / 3;
            if (avgY < 0.35 && Math.abs(fny) > 0.75) continue;

            let flip = false;
            if (Math.abs(fny) > 0.55) {
              if (fny < 0) flip = true;
            } else if (b && b.count > 0) {
              const cx = b.sumX / b.count;
              const cz = b.sumZ / b.count;
              const mx = (triPts[0][0] + triPts[1][0] + triPts[2][0]) / 3 - cx;
              const mz = (triPts[0][2] + triPts[1][2] + triPts[2][2]) / 3 - cz;
              if (fnx * mx + fnz * mz < 0) flip = true;
            }
            if (flip) {
              fnx = -fnx;
              fny = -fny;
              fnz = -fnz;
              const tmpP = triPts[1];
              triPts[1] = triPts[2];
              triPts[2] = tmpP;
            }

            const isRoof = fny > 0.52;

            let bucket;
            if (isRoof) {
              bucket = roofBuckets[hash % roofBuckets.length];
            } else if (bHeight > 14.5) {
              bucket = wallBuckets[5]; // Mid-rise commercial wall bucket
            } else {
              bucket = wallBuckets[hash % 5];
            }

            const baseV = bucket.pos.length / 3;
            const useX = Math.abs(fnz) >= Math.abs(fnx);
            for (let k = 0; k < 3; k++) {
              const [px, py, pz] = triPts[k];
              bucket.pos.push(px, py, pz);
              bucket.norm.push(fnx, fny, fnz);
              if (isRoof) {
                bucket.uv.push(px / 6.0, pz / 6.0);
              } else {
                const uCoord = (useX ? px : pz) / 8.4;
                const vCoord = py / 6.2;
                bucket.uv.push(uCoord, vCoord);
              }
              bucket.idx.push(baseV + k);
            }
            totalKeptTris++;
          }
        }

        if (hasUv && newIdx.length > 0) {
          const outMesh = outDoc.createMesh(`tile_mesh_${ti}`);
          const posAcc = outDoc
            .createAccessor(`pos_${ti}`)
            .setType('VEC3')
            .setArray(new Float32Array(newPos))
            .setBuffer(outBuf);
          const normAcc = outDoc
            .createAccessor(`norm_${ti}`)
            .setType('VEC3')
            .setArray(new Float32Array(newNorm))
            .setBuffer(outBuf);
          const uvAcc = outDoc
            .createAccessor(`uv_${ti}`)
            .setType('VEC2')
            .setArray(new Float32Array(newUv))
            .setBuffer(outBuf);
          const idxArray =
            newPos.length / 3 > 65535 ? new Uint32Array(newIdx) : new Uint16Array(newIdx);
          const idxAcc = outDoc
            .createAccessor(`idx_${ti}`)
            .setType('SCALAR')
            .setArray(idxArray)
            .setBuffer(outBuf);

          const outPrim = outDoc
            .createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setAttribute('NORMAL', normAcc)
            .setAttribute('TEXCOORD_0', uvAcc)
            .setIndices(idxAcc)
            .setMaterial(tileMat);
          outMesh.addPrimitive(outPrim);
          const node = outDoc.createNode(`Plateau_Textured_${ti}`).setMesh(outMesh);
          rootNode.addChild(node);
        }
      }
    }
  }

  // Emit merged wall & roof architectural buckets with box-projected UVs
  for (const b of [...wallBuckets, ...roofBuckets]) {
    if (b.idx.length === 0) continue;
    const name = b.mat.getName();
    // Emit dummy 1x1 texture on wall/roof buckets so gltf-transform prune() keeps TEXCOORD_0
    const dummyPng = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
      0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 255, 255, 63, 0, 5, 254,
      2, 254, 220, 204, 89, 231, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    const dummyTex = outDoc.createTexture('dummy_white').setMimeType('image/png').setImage(dummyPng);
    b.mat.setBaseColorTexture(dummyTex);
    const uMesh = outDoc.createMesh(`${name}_Mesh`);
    const posAcc = outDoc
      .createAccessor(`pos_${name}`)
      .setType('VEC3')
      .setArray(new Float32Array(b.pos))
      .setBuffer(outBuf);
    const normAcc = outDoc
      .createAccessor(`norm_${name}`)
      .setType('VEC3')
      .setArray(new Float32Array(b.norm))
      .setBuffer(outBuf);
    const uvAcc = outDoc
      .createAccessor(`uv_${name}`)
      .setType('VEC2')
      .setArray(new Float32Array(b.uv))
      .setBuffer(outBuf);
    const idxAcc = outDoc
      .createAccessor(`idx_${name}`)
      .setType('SCALAR')
      .setArray(new Uint32Array(b.idx))
      .setBuffer(outBuf);
    const uPrim = outDoc
      .createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setAttribute('TEXCOORD_0', uvAcc)
      .setIndices(idxAcc)
      .setMaterial(b.mat);
    uMesh.addPrimitive(uPrim);
    rootNode.addChild(outDoc.createNode(name).setMesh(uMesh));
  }

  console.log(
    `      Excavated ${totalExcavatedBuildings} houses in plot [${EXCAVATED_PLOT.x0}..${EXCAVATED_PLOT.x1}] x [${EXCAVATED_PLOT.z0}..${EXCAVATED_PLOT.z1}] m.`,
  );
  console.log(
    `      Kept ${totalKeptBuildings} surrounding Tokyo LOD2 buildings (${Math.round(totalKeptTris).toLocaleString()} triangles).`,
  );

  // 4. Download & merge PLATEAU 2025 Shinjuku-ku LOD3 Transportation (Roads & Sidewalks) 3D Tiles!
  console.log('[2b/4] Downloading PLATEAU Shinjuku-ku LOD3 Road Network (tran)...');
  const tranTsBuf = await fetchCached('tileset.json', TRAN_TILESET_BASE, 'tran_');
  const tranTileset = JSON.parse(tranTsBuf.toString('utf-8'));
  const tranLeaves = [];
  function walkTran(node) {
    if (!node.children?.length && node.content?.uri) tranLeaves.push(node);
    for (const c of node.children || []) walkTran(c);
  }
  walkTran(tranTileset.root);

  const selectedTranTiles = [];
  for (const n of tranLeaves) {
    const reg = n.content.boundingVolume?.region || n.boundingVolume?.region;
    if (!reg) continue;
    const lon = (reg[0] + reg[2]) * 0.5;
    const lat = (reg[1] + reg[3]) * 0.5;
    const [tx, , tz] = ecefToThree(...llaToEcef(lon, lat, ORIGIN_H));
    if (tx >= BBOX_X[0] - 80 && tx <= BBOX_X[1] + 80 && tz >= BBOX_Z[0] - 80 && tz <= BBOX_Z[1] + 80) {
      selectedTranTiles.push({ uri: n.content.uri });
    }
  }
  console.log(`      Selected ${selectedTranTiles.length} LOD3 road tiles.`);

  const roadBucket = {
    mat: outDoc
      .createMaterial('Plateau_Road_LOD3')
      .setBaseColorFactor([0.28, 0.30, 0.33, 1.0])
      .setRoughnessFactor(0.82)
      .setMetallicFactor(0.05),
    pos: [],
    norm: [],
    idx: [],
  };
  let roadTris = 0;

  for (let ti = 0; ti < selectedTranTiles.length; ti++) {
    const rawB3dm = await fetchCached(selectedTranTiles[ti].uri, TRAN_TILESET_BASE, 'tran_');
    const { glb, rtc } = unpackB3dmToCleanGlb(rawB3dm);
    const tileDoc = await io.readBinary(glb);
    for (const mesh of tileDoc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const indices = prim.getIndices();
        if (!pos || !indices) continue;
        const idxCount = indices.getCount();
        for (let t = 0; t < idxCount; t += 3) {
          const i0 = indices.getScalar(t);
          const i1 = indices.getScalar(t + 1);
          const i2 = indices.getScalar(t + 2);
          const pts = [];
          let inPlot = false;
          for (const vi of [i0, i1, i2]) {
            const [vx, vy, vz] = pos.getElement(vi, [0, 0, 0]);
            const [tx, , tz] = ecefToThree(rtc[0] + vx, rtc[1] - vz, rtc[2] + vy);
            if (
              tx >= EXCAVATED_PLOT.x0 - 14 &&
              tx <= EXCAVATED_PLOT.x1 + 14 &&
              tz >= EXCAVATED_PLOT.z0 - 14 &&
              tz <= EXCAVATED_PLOT.z1 + 14
            ) {
              inPlot = true;
            }
            pts.push([tx, 0.06, tz]);
          }
          if (inPlot) continue;
          // Also skip long road triangles whose centroid or edges cross the excavated plot + perimeter road
          const cxTri = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
          const czTri = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
          if (
            cxTri >= EXCAVATED_PLOT.x0 - 14 &&
            cxTri <= EXCAVATED_PLOT.x1 + 14 &&
            czTri >= EXCAVATED_PLOT.z0 - 14 &&
            czTri <= EXCAVATED_PLOT.z1 + 14
          ) {
            continue;
          }
          const minTx = Math.min(pts[0][0], pts[1][0], pts[2][0]);
          const maxTx = Math.max(pts[0][0], pts[1][0], pts[2][0]);
          const minTz = Math.min(pts[0][2], pts[1][2], pts[2][2]);
          const maxTz = Math.max(pts[0][2], pts[1][2], pts[2][2]);
          if (
            maxTx >= EXCAVATED_PLOT.x0 - 11 &&
            minTx <= EXCAVATED_PLOT.x1 + 11 &&
            maxTz >= EXCAVATED_PLOT.z0 - 11 &&
            minTz <= EXCAVATED_PLOT.z1 + 11
          ) {
            continue;
          }
          // Ensure upward normal for road triangles
          const ux = pts[1][0] - pts[0][0];
          const uz = pts[1][2] - pts[0][2];
          const vx = pts[2][0] - pts[0][0];
          const vz = pts[2][2] - pts[0][2];
          const fny = uz * vx - ux * vz;
          if (Math.abs(fny) < 1e-6) continue;
          if (fny < 0) {
            const tmp = pts[1];
            pts[1] = pts[2];
            pts[2] = tmp;
          }
          const baseV = roadBucket.pos.length / 3;
          for (let k = 0; k < 3; k++) {
            roadBucket.pos.push(pts[k][0], pts[k][1], pts[k][2]);
            roadBucket.norm.push(0, 1, 0);
            roadBucket.idx.push(baseV + k);
          }
          roadTris++;
        }
      }
    }
  }
  if (roadBucket.idx.length > 0) {
    const rMesh = outDoc.createMesh('Plateau_Road_LOD3_Mesh');
    const posAcc = outDoc
      .createAccessor('pos_road')
      .setType('VEC3')
      .setArray(new Float32Array(roadBucket.pos))
      .setBuffer(outBuf);
    const normAcc = outDoc
      .createAccessor('norm_road')
      .setType('VEC3')
      .setArray(new Float32Array(roadBucket.norm))
      .setBuffer(outBuf);
    const idxAcc = outDoc
      .createAccessor('idx_road')
      .setType('SCALAR')
      .setArray(new Uint32Array(roadBucket.idx))
      .setBuffer(outBuf);
    const rPrim = outDoc
      .createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setIndices(idxAcc)
      .setMaterial(roadBucket.mat);
    rMesh.addPrimitive(rPrim);
    rootNode.addChild(outDoc.createNode('Plateau_Road_LOD3').setMesh(rMesh));
    console.log(`      Added ${roadTris.toLocaleString()} LOD3 road surface triangles.`);
  }

  console.log('[3/4] Writing intermediate GLB...');
  await outDoc.transform(dedup(), prune());
  const outIo = new NodeIO().registerExtensions([EXTTextureWebP]);
  await outIo.write(RAW_GLB, outDoc);

  console.log('[4/4] Compressing with gltf-transform meshopt...');
  const cliBin = path.join(ROOT, 'node_modules/.bin/gltf-transform');
  await execFileAsync(cliBin, [
    'optimize',
    RAW_GLB,
    OPT_GLB,
    '--compress',
    'meshopt',
    '--palette',
    'false',
    '--join',
    'false',
  ]);

  const stat = await fs.stat(OPT_GLB);
  console.log(
    `Done! Wrote ${ path.relative(ROOT, OPT_GLB) } (${ (stat.size / 1048576).toFixed(2) } MB).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
