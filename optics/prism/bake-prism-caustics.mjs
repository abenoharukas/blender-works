#!/usr/bin/env node
// Pure Snell's-Law Continuous-Spectrum Caustic Baker for a Triangular Prism (`prism-optics.ts`)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out");

export const PRISM_OPTICS = {
  wallZ: -0.64,
  wallXMin: -1.55,
  wallXMax: 1.85,
  wallYMin: 0.0,
  wallYMax: 1.68,

  floorXMin: -1.55,
  floorXMax: 1.85,
  floorZMin: -0.64,
  floorZMax: 1.56,

  plinthPos: [-0.45, 0.085, 0.35],
  plinthRadiusTop: 0.11,
  plinthRadiusBot: 0.135,
  plinthHeight: 0.17,

  // Equilateral triangular prism: apothem = 0.14 m, height = 0.34 m
  prismApothem: 0.14,
  prismHeight: 0.34,
  prismCenter: [-0.45, 0.34, 0.35], // bottom at y = 0.17 (plinthTop), top at y = 0.51
  prismYawRad: (23 * Math.PI) / 180,

  // Narrow vertical optical slit (1.4 cm wide x 14 cm tall) hitting entry face near minimum deviation
  beamOrigin: [-1.20, 0.34, 0.46],
  beamDir: [1.0, 0.0, 0.0],
  beamRadius: 0.072, // vertical half-height
  slitHalfW: 0.009,  // narrow horizontal slit half-width (in Z)

  hdrMaxNits: 420.0,
  wallTexW: 1984,
  wallTexH: 1088,
  floorTexW: 1488,
  floorTexH: 1088,
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
  return Buffer.concat([len, tBuf, data, crcBuf]);
}
export function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4);
    raw[rowOff] = 0;
    rgba.copy(raw, rowOff + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function wavelengthToLinearRGB(lambdaNm) {
  const g = (x, mu, s1, s2) => {
    const t = (x - mu) * (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  const x =
    1.056 * g(lambdaNm, 599.8, 0.0264, 0.0323) +
    0.362 * g(lambdaNm, 442.0, 0.0624, 0.0374) -
    0.065 * g(lambdaNm, 501.1, 0.049, 0.0382);
  const y =
    0.821 * g(lambdaNm, 568.8, 0.0213, 0.0247) +
    0.286 * g(lambdaNm, 530.9, 0.0613, 0.0322);
  const z =
    1.217 * g(lambdaNm, 437.0, 0.0845, 0.0278) +
    0.681 * g(lambdaNm, 459.0, 0.0385, 0.0725);
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}

export function buildPrismWorldPlanes() {
  const { prismApothem, prismHeight, prismCenter, prismYawRad } = PRISM_OPTICS;
  const hHalf = prismHeight * 0.5;
  const c = Math.cos(prismYawRad);
  const s = Math.sin(prismYawRad);

  // 3 side faces at 120 deg intervals: base faces -Z, left-front faces (-0.866, 0, +0.5), right-front faces (+0.866, 0, +0.5)
  const localNormals = [
    [-Math.sqrt(3) * 0.5, 0, 0.5, prismApothem],
    [Math.sqrt(3) * 0.5, 0, 0.5, prismApothem],
    [0, 0, -1, prismApothem],
    [0, 1, 0, hHalf],
    [0, -1, 0, hHalf],
  ];

  const worldPlanes = new Float32Array(localNormals.length * 4);
  for (let i = 0; i < localNormals.length; i++) {
    const [lx, ly, lz, d] = localNormals[i];
    // Rotate around Y by prismYawRad
    const wx = c * lx + s * lz;
    const wy = ly;
    const wz = -s * lx + c * lz;
    const wd = d + wx * prismCenter[0] + wy * prismCenter[1] + wz * prismCenter[2];
    worldPlanes[i * 4] = wx;
    worldPlanes[i * 4 + 1] = wy;
    worldPlanes[i * 4 + 2] = wz;
    worldPlanes[i * 4 + 3] = wd;
  }
  return worldPlanes;
}

function fresnelUnpolarized(cosI, eta) {
  const c = Math.abs(cosI);
  const g2 = eta * eta - 1 + c * c;
  if (g2 <= 0) return 1.0;
  const g = Math.sqrt(g2);
  const a = (g - c) / (g + c);
  const b = (c * (g + c) - 1) / (c * (g - c) + 1);
  return 0.5 * a * a * (1 + b * b);
}

function splatBilinearRGB(buf, w, h, fx, fy, r, g, b) {
  if (fx < 0 || fx >= w - 1 || fy < 0 || fy >= h - 1) return;
  const x0 = fx | 0, y0 = fy | 0;
  const tx = fx - x0, ty = fy - y0;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty, w11 = tx * ty;
  let i = (y0 * w + x0) * 3;
  buf[i] += r * w00; buf[i + 1] += g * w00; buf[i + 2] += b * w00;
  i += 3;
  buf[i] += r * w10; buf[i + 1] += g * w10; buf[i + 2] += b * w10;
  i = ((y0 + 1) * w + x0) * 3;
  buf[i] += r * w01; buf[i + 1] += g * w01; buf[i + 2] += b * w01;
  i += 3;
  buf[i] += r * w11; buf[i + 1] += g * w11; buf[i + 2] += b * w11;
}

function rasterizeWavefrontTri(buf, w, h, x0, y0, x1, y1, x2, y2, fluxR, fluxG, fluxB, pixAreaM2) {
  const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
  if (maxX < 0 || minX >= w || maxY < 0 || minY >= h) return;
  if (maxX - minX > w * 0.25 || maxY - minY > h * 0.25) return;

  const signed2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const areaPix = 0.5 * Math.abs(signed2);

  if (areaPix < 0.95) {
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
    const effArea = Math.max(areaPix, 0.42) * pixAreaM2;
    splatBilinearRGB(buf, w, h, cx, cy, fluxR / effArea, fluxG / effArea, fluxB / effArea);
    return;
  }

  const areaM2 = areaPix * pixAreaM2;
  const irR = fluxR / areaM2, irG = fluxG / areaM2, irB = fluxB / areaM2;
  const ix0 = Math.max(0, Math.floor(minX)), ix1 = Math.min(w - 1, Math.ceil(maxX));
  const iy0 = Math.max(0, Math.floor(minY)), iy1 = Math.min(h - 1, Math.ceil(maxY));
  const inv2 = 1 / signed2;

  for (let py = iy0; py <= iy1; py++) {
    const sy = py + 0.5;
    for (let px = ix0; px <= ix1; px++) {
      const sx = px + 0.5;
      const u = ((sx - x0) * (y2 - y0) - (x2 - x0) * (sy - y0)) * inv2;
      if (u < -0.02) continue;
      const v = ((x1 - x0) * (sy - y0) - (sx - x0) * (y1 - y0)) * inv2;
      if (v < -0.02 || u + v > 1.02) continue;
      const idx = (py * w + px) * 3;
      buf[idx] += irR;
      buf[idx + 1] += irG;
      buf[idx + 2] += irB;
    }
  }
}

export function bakeAllPrismCaustics() {
  const t0 = performance.now();
  const worldPlanes = buildPrismWorldPlanes();
  const nPlanes = worldPlanes.length / 4;

  const {
    wallZ, wallXMin, wallXMax, wallYMin, wallYMax,
    floorXMin, floorXMax, floorZMin, floorZMax,
    beamOrigin, beamDir, beamRadius, slitHalfW,
    hdrMaxNits, wallTexW, wallTexH, floorTexW, floorTexH,
  } = PRISM_OPTICS;

  const wallHDR = new Float32Array(wallTexW * wallTexH * 3);
  const floorHDR = new Float32Array(floorTexW * floorTexH * 3);

  const [bdx, bdy, bdz] = beamDir;
  // Orthonormal basis for beam cross-section
  const rrx = 0, rry = 0, rrz = 1; // beam is +X, so right in XZ is +Z, up is +Y
  const upx = 0, upy = 1, upz = 0;

  // High-dispersion flint glass (SF10-like): nBase = 1.60, strong dispersion so rainbow on wall is wide & clear
  const nBase = 1.60;
  const dispStrength = 0.068;

  const NUM_BANDS = 480;
  const bandRGB = [];
  const bandIOR = [];
  let sumR = 0, sumG = 0, sumB = 0;
  for (let b = 0; b < NUM_BANDS; b++) {
    const lam = 400 + (b / (NUM_BANDS - 1)) * 285;
    const rgb = wavelengthToLinearRGB(lam);
    bandRGB.push(rgb);
    sumR += rgb[0]; sumG += rgb[1]; sumB += rgb[2];
    const um = lam * 1e-3;
    bandIOR.push(nBase + dispStrength * (1 / (um * um) - 1 / (0.55 * 0.55)));
  }
  for (let b = 0; b < NUM_BANDS; b++) {
    bandRGB[b][0] /= sumR;
    bandRGB[b][1] /= sumG;
    bandRGB[b][2] /= sumB;
  }

  const TOTAL_BEAM_WATTS = 36.0;
  const GRID_RES = 180;
  const cellW = (2 * slitHalfW) / (GRID_RES - 1);
  const cellH = (2 * beamRadius) / (GRID_RES - 1);
  const cellArea = cellW * cellH;
  const beamIrradiance = TOTAL_BEAM_WATTS / (4 * slitHalfW * beamRadius);

  const wallSpanX = wallXMax - wallXMin;
  const wallSpanY = wallYMax - wallYMin;
  const wallPixArea = (wallSpanX / wallTexW) * (wallSpanY / wallTexH);

  const floorSpanX = floorXMax - floorXMin;
  const floorSpanZ = floorZMax - floorZMin;
  const floorPixArea = (floorSpanX / floorTexW) * (floorSpanZ / floorTexH);

  function intersectPrism(ox, oy, oz, dx, dy, dz) {
    let tNear = -1e30, tFar = 1e30, fNear = -1, fFar = -1;
    for (let p = 0; p < nPlanes; p++) {
      const i = p * 4;
      const nx = worldPlanes[i], ny = worldPlanes[i + 1], nz = worldPlanes[i + 2], d = worldPlanes[i + 3];
      const dist = nx * ox + ny * oy + nz * oz - d;
      const den = nx * dx + ny * dy + nz * dz;
      if (Math.abs(den) < 1e-9) {
        if (dist > 0) return null;
      } else {
        const t = -dist / den;
        if (den < 0) {
          if (t > tNear) { tNear = t; fNear = p; }
        } else {
          if (t < tFar) { tFar = t; fFar = p; }
        }
        if (tNear > tFar) return null;
      }
    }
    if (tFar <= 1e-5) return null;
    return { tEnter: tNear, fEnter: fNear, tExit: tFar, fExit: fFar };
  }

  const nVerts = GRID_RES * GRID_RES;
  const BR_COUNT = 2;
  const hitKind = new Int8Array(nVerts * BR_COUNT);
  const hitSig = new Int32Array(nVerts * BR_COUNT);
  const hitU = new Float32Array(nVerts * BR_COUNT);
  const hitV = new Float32Array(nVerts * BR_COUNT);
  const hitWeight = new Float32Array(nVerts * BR_COUNT);

  let wallFluxSum = 0;
  let wMeanX = 0, wMeanY = 0, wWgtSum = 0;

  function recordExit(ox, oy, oz, dx, dy, dz, slot, sig, weight) {
    let tBest = 1e30, surf = 0;
    if (dz < -1e-5) {
      const tw = (wallZ - oz) / dz;
      if (tw > 1e-4 && tw < tBest) {
        const wx = ox + dx * tw, wy = oy + dy * tw;
        if (wx >= wallXMin && wx <= wallXMax && wy >= wallYMin && wy <= wallYMax) {
          tBest = tw; surf = 1;
        }
      }
    }
    if (dy < -1e-5) {
      const tf = -oy / dy;
      if (tf > 1e-4 && tf < tBest) {
        const fx = ox + dx * tf, fz = oz + dz * tf;
        if (fx >= floorXMin && fx <= floorXMax && fz >= floorZMin && fz <= floorZMax) {
          tBest = tf; surf = 2;
        }
      }
    }
    if (surf === 1) {
      const wx = ox + dx * tBest, wy = oy + dy * tBest;
      hitKind[slot] = 1;
      hitSig[slot] = sig;
      hitU[slot] = ((wx - wallXMin) / wallSpanX) * (wallTexW - 1);
      hitV[slot] = (1 - (wy - wallYMin) / wallSpanY) * (wallTexH - 1);
      hitWeight[slot] = weight;
      wallFluxSum += weight;
      wMeanX += wx * weight;
      wMeanY += wy * weight;
      wWgtSum += weight;
    } else if (surf === 2) {
      const fx = ox + dx * tBest, fz = oz + dz * tBest;
      hitKind[slot] = 2;
      hitSig[slot] = sig;
      hitU[slot] = ((fx - floorXMin) / floorSpanX) * (floorTexW - 1);
      hitV[slot] = ((fz - floorZMin) / floorSpanZ) * (floorTexH - 1);
      hitWeight[slot] = weight;
    }
  }

  for (let b = 0; b < NUM_BANDS; b++) {
    const ior = bandIOR[b];
    const [cr, cg, cb] = bandRGB[b];
    hitKind.fill(0);
    hitSig.fill(-1);
    hitWeight.fill(0);

    for (let iy = 0; iy < GRID_RES; iy++) {
      const vNorm = (iy / (GRID_RES - 1)) * 2 - 1;
      const v = vNorm * beamRadius;
      for (let ix = 0; ix < GRID_RES; ix++) {
        const uNorm = (ix / (GRID_RES - 1)) * 2 - 1;
        const u = uNorm * slitHalfW;

        const vIdx = iy * GRID_RES + ix;
        const profile = Math.exp(-0.85 * uNorm * uNorm - 0.55 * vNorm * vNorm) * 1.4;

        const ox = beamOrigin[0] + rrx * u + upx * v;
        const oy = beamOrigin[1] + rry * u + upy * v;
        const oz = beamOrigin[2] + rrz * u + upz * v;

        const first = intersectPrism(ox, oy, oz, bdx, bdy, bdz);
        if (!first || first.tEnter <= 0 || first.fEnter < 0) continue;

        const hx = ox + bdx * first.tEnter;
        const hy = oy + bdy * first.tEnter;
        const hz = oz + bdz * first.tEnter;
        const f0 = first.fEnter;

        const n0x = worldPlanes[f0 * 4], n0y = worldPlanes[f0 * 4 + 1], n0z = worldPlanes[f0 * 4 + 2];
        const cosI0 = -(bdx * n0x + bdy * n0y + bdz * n0z);
        if (cosI0 <= 1e-4) continue;
        const F0 = fresnelUnpolarized(cosI0, ior);

        const etaIn = 1 / ior;
        const kIn = 1 - etaIn * etaIn * (1 - cosI0 * cosI0);
        if (kIn <= 0) continue;
        const sIn = etaIn * cosI0 - Math.sqrt(kIn);
        let idx = etaIn * bdx + sIn * n0x;
        let idy = etaIn * bdy + sIn * n0y;
        let idz = etaIn * bdz + sIn * n0z;
        const invIn = 1 / Math.hypot(idx, idy, idz);
        idx *= invIn; idy *= invIn; idz *= invIn;

        let curX = hx - n0x * 1e-4, curY = hy - n0y * 1e-4, curZ = hz - n0z * 1e-4;
        let curW = profile * (1 - F0);
        let sig = f0 + 1;
        let usedSlots = 0;

        for (let bounce = 0; bounce < 4 && curW > 0.01; bounce++) {
          const inside = intersectPrism(curX, curY, curZ, idx, idy, idz);
          if (!inside || inside.tExit <= 1e-5 || inside.fExit < 0) break;

          const ex = curX + idx * inside.tExit;
          const ey = curY + idy * inside.tExit;
          const ez = curZ + idz * inside.tExit;
          const fe = inside.fExit;
          sig = (sig * 17 + fe + 1) | 0;

          const onx = worldPlanes[fe * 4], ony = worldPlanes[fe * 4 + 1], onz = worldPlanes[fe * 4 + 2];
          const inx = -onx, iny = -ony, inz = -onz;
          const cosI = -(idx * inx + idy * iny + idz * inz);
          if (cosI <= 1e-4) break;

          const F = fresnelUnpolarized(cosI, 1 / ior);
          const etaOut = ior;
          const kOut = 1 - etaOut * etaOut * (1 - cosI * cosI);

          if (kOut > 0 && F < 0.995 && usedSlots < BR_COUNT) {
            const sOut = etaOut * cosI - Math.sqrt(kOut);
            let odx = etaOut * idx + sOut * inx;
            let ody = etaOut * idy + sOut * iny;
            let odz = etaOut * idz + sOut * inz;
            const invO = 1 / Math.hypot(odx, ody, odz);
            odx *= invO; ody *= invO; odz *= invO;

            recordExit(
              ex + onx * 1e-4, ey + ony * 1e-4, ez + onz * 1e-4,
              odx, ody, odz,
              vIdx * BR_COUNT + usedSlots,
              sig,
              curW * (1 - F),
            );
            usedSlots++;
          }

          curW *= F;
          const rdx = idx + 2 * cosI * inx;
          const rdy = idy + 2 * cosI * iny;
          const rdz = idz + 2 * cosI * inz;
          const invR = 1 / Math.hypot(rdx, rdy, rdz);
          idx = rdx * invR; idy = rdy * invR; idz = rdz * invR;
          curX = ex + inx * 1e-4; curY = ey + iny * 1e-4; curZ = ez + inz * 1e-4;
        }
      }
    }

    const baseCellFlux = beamIrradiance * cellArea;
    for (let br = 0; br < BR_COUNT; br++) {
      for (let iy = 0; iy < GRID_RES - 1; iy++) {
        for (let ix = 0; ix < GRID_RES - 1; ix++) {
          const i00 = (iy * GRID_RES + ix) * BR_COUNT + br;
          const i10 = (iy * GRID_RES + ix + 1) * BR_COUNT + br;
          const i01 = ((iy + 1) * GRID_RES + ix) * BR_COUNT + br;
          const i11 = ((iy + 1) * GRID_RES + ix + 1) * BR_COUNT + br;

          for (const [a, c1, c2] of [[i00, i10, i11], [i00, i11, i01]]) {
            const kA = hitKind[a];
            if (kA === 0) continue;
            if (hitKind[c1] === kA && hitKind[c2] === kA && hitSig[a] === hitSig[c1] && hitSig[a] === hitSig[c2]) {
              const triFlux = 0.5 * baseCellFlux * ((hitWeight[a] + hitWeight[c1] + hitWeight[c2]) / 3);
              if (kA === 1) {
                rasterizeWavefrontTri(
                  wallHDR, wallTexW, wallTexH,
                  hitU[a], hitV[a], hitU[c1], hitV[c1], hitU[c2], hitV[c2],
                  triFlux * cr, triFlux * cg, triFlux * cb, wallPixArea,
                );
              } else {
                rasterizeWavefrontTri(
                  floorHDR, floorTexW, floorTexH,
                  hitU[a], hitV[a], hitU[c1], hitV[c1], hitU[c2], hitV[c2],
                  triFlux * cr, triFlux * cg, triFlux * cb, floorPixArea,
                );
              }
            }
          }
        }
      }
    }
  }

  const mapShoulder = (v, knee) => {
    const x = Math.max(0, v);
    return (x * knee) / (x + knee * 0.92);
  };

  const encodeSqrt = (hdr, w, h) => {
    const rgba = Buffer.alloc(w * h * 4);
    const invMax = 1 / hdrMaxNits;
    let peakMapped = 0;
    for (let i = 0, n = w * h; i < n; i++) {
      let r = Math.max(0, hdr[i * 3]);
      let g = Math.max(0, hdr[i * 3 + 1]);
      let b = Math.max(0, hdr[i * 3 + 2]);
      const mx0 = Math.max(r, g, b);
      if (mx0 > 1e-6) {
        const m1 = mapShoulder(mx0, hdrMaxNits);
        const s = m1 / mx0;
        r *= s; g *= s; b *= s;
        if (m1 > peakMapped) peakMapped = m1;
      }
      rgba[i * 4] = Math.min(255, Math.round(Math.sqrt(Math.min(1, r * invMax)) * 255));
      rgba[i * 4 + 1] = Math.min(255, Math.round(Math.sqrt(Math.min(1, g * invMax)) * 255));
      rgba[i * 4 + 2] = Math.min(255, Math.round(Math.sqrt(Math.min(1, b * invMax)) * 255));
      rgba[i * 4 + 3] = 255;
    }
    return { rgba, peakMapped };
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wEnc = encodeSqrt(wallHDR, wallTexW, wallTexH);
  const fEnc = encodeSqrt(floorHDR, floorTexW, floorTexH);

  const wallPath = path.join(OUT_DIR, "prism-caustics-wall.png");
  const floorPath = path.join(OUT_DIR, "prism-caustics-floor.png");
  fs.writeFileSync(wallPath, encodePNG(wallTexW, wallTexH, wEnc.rgba));
  fs.writeFileSync(floorPath, encodePNG(floorTexW, floorTexH, fEnc.rgba));

  console.log(
    `[PrismBake] ${(performance.now() - t0).toFixed(0)} ms | Wall flux=${wallFluxSum.toFixed(1)} (mean=[${(wMeanX / Math.max(wWgtSum, 1e-6)).toFixed(2)}, ${(wMeanY / Math.max(wWgtSum, 1e-6)).toFixed(2)}], peak=${wEnc.peakMapped.toFixed(0)} nits)`,
  );
  return { wallPath, floorPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bakeAllPrismCaustics();
}
