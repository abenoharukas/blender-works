#!/usr/bin/env node
// High-Precision Continuous-Spectrum Wavefront Caustic Baker for `diamond-optics.ts`
//
// Physics & Catastrophe Optics Calibration:
//   - 48 continuous CIE 1931 spectral wavelengths (400..685 nm, ~6.0 nm spacing -> smooth zero-banding rainbow fire)
//   - 330x330 coherent wavefront grid per wavelength (< 1 mm ray spacing across the 58-facet diamond aperture)
//   - Multi-harmonic capillary crystal phase ripples (`k = 95..205 rad/m`, `λ ≈ 3.0..6.6 cm`, `slopeAmp = 0.028 rad`)
//     calibrated to catastrophe focal distance `z_focus ≈ 0.46 m` (wall distance `0.82 m ≈ 1.78 * z_focus`),
//     folding each refracted facet beam into fine, interwoven, water-like "波光粼粼" caustic ribbons & swallowtail cusps!
//   - Soft highlight shoulder before sqrt-HDR encoding (`hdrMaxNits = 280 nits`) preserves intricate internal filament
//     structure and saturated spectral fire without blown-out flat white blocks.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out");

export const SCENE_OPTICS = {
  wallZ: -0.64,
  wallXMin: -1.55,
  wallXMax: 1.85,
  wallYMin: 0.0,
  wallYMax: 1.68,

  floorXMin: -1.55,
  floorXMax: 1.85,
  floorZMin: -0.64,
  floorZMax: 1.56,

  plinthPos: [-0.36, 0.085, 0.18],
  plinthRadiusTop: 0.080,
  plinthRadiusBot: 0.108,
  plinthHeight: 0.17,

  diamondRadius: 0.275,
  diamondBasePos: [-0.36, 0.42, 0.18],
  diamondEuler: [0.33, -0.45, -0.15],

  beamOrigin: [-1.10, 0.24, 0.86],
  beamAim: [-0.35, 0.435, 0.18],
  beamRadius: 0.23,

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

function makeRotMatrix(rx, ry, rz) {
  const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
  const qxyX = sx * cy, qxyY = cx * sy, qxyZ = sx * sy, qxyW = cx * cy;
  const x = qxyX * cz + qxyY * sz;
  const y = qxyY * cz - qxyX * sz;
  const z = qxyW * sz + qxyZ * cz;
  const w = qxyW * cz - qxyZ * sz;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

function rotVec(m, vx, vy, vz) {
  return [
    m[0] * vx + m[1] * vy + m[2] * vz,
    m[3] * vx + m[4] * vy + m[5] * vz,
    m[6] * vx + m[7] * vy + m[8] * vz,
  ];
}

export function buildDiamondWorldPlanes() {
  const deg = Math.PI / 180;
  const hCrown = 0.345;
  const gHalf = 0.026;
  const hPav = 0.875;
  const planes = [];

  planes.push([0, 1, 0, hCrown]);
  const bBezel = 34.5 * deg;
  const dBezel = Math.sin(bBezel) + gHalf * Math.cos(bBezel);
  const rTable = (dBezel - hCrown * Math.cos(bBezel)) / Math.sin(bBezel);
  for (let m = 0; m < 8; m++) {
    const phi = (m * Math.PI) / 4;
    planes.push([Math.sin(bBezel) * Math.cos(phi), Math.cos(bBezel), Math.sin(bBezel) * Math.sin(phi), dBezel]);
  }
  const bStar = 20.5 * deg;
  const dStar = Math.sin(bStar) * (rTable / Math.cos(Math.PI / 8)) + hCrown * Math.cos(bStar);
  for (let m = 0; m < 8; m++) {
    const phi = ((m + 0.5) * Math.PI) / 4;
    planes.push([Math.sin(bStar) * Math.cos(phi), Math.cos(bStar), Math.sin(bStar) * Math.sin(phi), dStar]);
  }
  const bUG = 41.8 * deg;
  const dUG = Math.sin(bUG) * Math.cos(Math.PI / 16) * 1.004 + gHalf * Math.cos(bUG);
  for (let k = 0; k < 16; k++) {
    const th = ((k + 0.5) * Math.PI) / 8;
    planes.push([Math.sin(bUG) * Math.cos(th), Math.cos(bUG), Math.sin(bUG) * Math.sin(th), dUG]);
  }
  const dGirdle = Math.cos(Math.PI / 16) * 1.006;
  for (let k = 0; k < 16; k++) {
    const th = ((k + 0.5) * Math.PI) / 8;
    planes.push([Math.cos(th), 0, Math.sin(th), dGirdle]);
  }
  const aPav = 40.75 * deg;
  const dPav = Math.sin(aPav) + gHalf * Math.cos(aPav);
  for (let m = 0; m < 8; m++) {
    const phi = (m * Math.PI) / 4;
    planes.push([Math.sin(aPav) * Math.cos(phi), -Math.cos(aPav), Math.sin(aPav) * Math.sin(phi), dPav]);
  }
  const aLG = 42.3 * deg;
  const dLG = Math.sin(aLG) * Math.cos(Math.PI / 16) * 1.003 + gHalf * Math.cos(aLG);
  for (let k = 0; k < 16; k++) {
    const th = ((k + 0.5) * Math.PI) / 8;
    planes.push([Math.sin(aLG) * Math.cos(th), -Math.cos(aLG), Math.sin(aLG) * Math.sin(th), dLG]);
  }
  planes.push([0, -1, 0, hPav]);

  const R = SCENE_OPTICS.diamondRadius;
  const rot = makeRotMatrix(...SCENE_OPTICS.diamondEuler);
  const pos = [...SCENE_OPTICS.diamondBasePos];

  let minY = Infinity;
  let minPoint = [0, 0, 0];
  for (let i = 0; i < planes.length; i++) {
    const [nx, ny, nz, d] = planes[i];
    const ux = Math.abs(ny) > 0.9 ? 1 : 0, uy = Math.abs(ny) > 0.9 ? 0 : 1, uz = 0;
    let tx = uy * nz - uz * ny, ty = uz * nx - ux * nz, tz = ux * ny - uy * nx;
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = nx * d, oy = ny * d, oz = nz * d;
    const E = 3.0;
    let poly = [
      [ox - tx * E - bx * E, oy - ty * E - by * E, oz - tz * E - bz * E],
      [ox + tx * E - bx * E, oy + ty * E - by * E, oz + tz * E - bz * E],
      [ox + tx * E + bx * E, oy + ty * E + by * E, oz + tz * E + bz * E],
      [ox - tx * E + bx * E, oy - ty * E + by * E, oz - tz * E + bz * E],
    ];
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (i === j) continue;
      const [pnx, pny, pnz, pd] = planes[j];
      const next = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const da = pnx * a[0] + pny * a[1] + pnz * a[2] - pd;
        const db = pnx * b[0] + pny * b[1] + pnz * b[2] - pd;
        if (da <= 1e-6) {
          next.push(a);
          if (db > 1e-6) {
            const s = da / (da - db);
            next.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
          }
        } else if (db <= 1e-6) {
          const s = da / (da - db);
          next.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
        }
      }
      poly = next;
    }
    for (const v of poly) {
      const rv = rotVec(rot, v[0] * R, v[1] * R, v[2] * R);
      const wy = rv[1] + pos[1];
      if (wy < minY) {
        minY = wy;
        minPoint = [rv[0] + pos[0], wy, rv[2] + pos[2]];
      }
    }
  }

  const plinthTop = SCENE_OPTICS.plinthHeight;
  const dyLift = plinthTop + 0.001 - minY;
  pos[1] += dyLift;
  minPoint[1] += dyLift;

  const worldPlanes = new Float32Array(planes.length * 4);
  for (let i = 0; i < planes.length; i++) {
    const [nx, ny, nz, d] = planes[i];
    const [wnx, wny, wnz] = rotVec(rot, nx, ny, nz);
    const wd = d * R + wnx * pos[0] + wny * pos[1] + wnz * pos[2];
    worldPlanes[i * 4] = wnx;
    worldPlanes[i * 4 + 1] = wny;
    worldPlanes[i * 4 + 2] = wnz;
    worldPlanes[i * 4 + 3] = wd;
  }

  return { worldPlanes, center: pos, culetWorld: minPoint };
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

// Multi-harmonic optical crystal & capillary ripple phase gradient (`k = 95..205 rad/m`, `λ = 3.0..6.6 cm`,
// `z_focus ≈ 0.46 m` vs wall `0.82 m` -> weaves 3-5 shimmering "波光粼粼" caustic arcs & cusps inside EVERY facet!)
export function perturbCrystalNormal(px, py, pz, nx, ny, nz, facetIdx, slopeAmp) {
  const fp = facetIdx * 1.137;

  const w1 = 108.0 * (px * 0.76 + py * 0.52 - pz * 0.39) + fp;
  const s1 = slopeAmp * Math.cos(w1);

  const w2 = 138.0 * (-px * 0.48 + py * 0.78 + pz * 0.40) - fp * 0.7 + 1.1;
  const s2 = slopeAmp * 0.84 * Math.cos(w2);

  const w3 = 168.0 * (px * 0.34 - py * 0.62 + pz * 0.71) + 2.4;
  const s3 = slopeAmp * 0.68 * Math.cos(w3);

  const w4 = 92.0 * (px * 0.61 + py * 0.18 + pz * 0.77) - 0.8 + fp * 0.45;
  const s4 = slopeAmp * 0.76 * Math.sin(w4);

  const w5 = 198.0 * (-px * 0.68 - py * 0.43 + pz * 0.59) + fp * 1.3;
  const s5 = slopeAmp * 0.46 * Math.cos(w5);

  const w6 = 124.0 * (px * 0.19 + py * 0.87 - pz * 0.45) - 1.9;
  const s6 = slopeAmp * 0.58 * Math.sin(w6);

  let gx = s1 * 0.76 - s2 * 0.48 + s3 * 0.34 + s4 * 0.61 - s5 * 0.68 + s6 * 0.19;
  let gy = s1 * 0.52 + s2 * 0.78 - s3 * 0.62 + s4 * 0.18 - s5 * 0.43 + s6 * 0.87;
  let gz = -s1 * 0.39 + s2 * 0.40 + s3 * 0.71 + s4 * 0.77 + s5 * 0.59 - s6 * 0.45;

  const dot = gx * nx + gy * ny + gz * nz;
  gx -= dot * nx;
  gy -= dot * ny;
  gz -= dot * nz;

  const rx = nx + gx, ry = ny + gy, rz = nz + gz;
  const inv = 1 / Math.hypot(rx, ry, rz);
  return [rx * inv, ry * inv, rz * inv];
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
  if (maxX - minX > w * 0.14 || maxY - minY > h * 0.14) return;

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

function gaussianSmooth(src, w, h, sigma, mixSharp) {
  const rad = Math.ceil(sigma * 2.5);
  const ws = [];
  let wSum = 0;
  for (let k = -rad; k <= rad; k++) {
    const wgt = Math.exp(-(k * k) / (2 * sigma * sigma));
    ws.push([k, wgt]);
    wSum += wgt;
  }
  for (const p of ws) p[1] /= wSum;

  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (const [k, wgt] of ws) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        const j = (y * w + xx) * 3;
        sr += src[j] * wgt; sg += src[j + 1] * wgt; sb += src[j + 2] * wgt;
      }
      const o = (y * w + x) * 3;
      tmp[o] = sr; tmp[o + 1] = sg; tmp[o + 2] = sb;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (const [k, wgt] of ws) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        const j = (yy * w + x) * 3;
        sr += tmp[j] * wgt; sg += tmp[j + 1] * wgt; sb += tmp[j + 2] * wgt;
      }
      const o = (y * w + x) * 3;
      out[o] = src[o] * mixSharp + sr * (1 - mixSharp);
      out[o + 1] = src[o + 1] * mixSharp + sg * (1 - mixSharp);
      out[o + 2] = src[o + 2] * mixSharp + sb * (1 - mixSharp);
    }
  }
  return out;
}

export function bakeAllCaustics() {
  const t0 = performance.now();
  const { worldPlanes, center, culetWorld } = buildDiamondWorldPlanes();
  const nPlanes = worldPlanes.length / 4;

  const {
    wallZ, wallXMin, wallXMax, wallYMin, wallYMax,
    floorXMin, floorXMax, floorZMin, floorZMax,
    beamOrigin, beamAim, beamRadius,
    hdrMaxNits, wallTexW, wallTexH, floorTexW, floorTexH,
  } = SCENE_OPTICS;

  const wallHDR = new Float32Array(wallTexW * wallTexH * 3);
  const floorHDR = new Float32Array(floorTexW * floorTexH * 3);

  let bdx = beamAim[0] - beamOrigin[0];
  let bdy = beamAim[1] - beamOrigin[1];
  let bdz = beamAim[2] - beamOrigin[2];
  const bLen = Math.hypot(bdx, bdy, bdz);
  bdx /= bLen; bdy /= bLen; bdz /= bLen;

  let rrx = -bdz, rry = 0, rrz = bdx;
  const rLen = Math.hypot(rrx, rry, rrz);
  rrx /= rLen; rrz /= rLen;
  const upx = rry * bdz - rrz * bdy;
  const upy = rrz * bdx - rrx * bdz;
  const upz = rrx * bdy - rry * bdx;

  const nBase = 1.555;
  const dispStrength = 0.044;
  const slopeAmp = 0.029;

  const NUM_BANDS = 48;
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

  // Calibrated optical flux so delicate rainbow webs sit at 8..32 nits while focal caustic cusps gleam at 80..240 nits!
  const TOTAL_BEAM_WATTS = 115.0;
  const GRID_RES = 310;
  const cellSide = (2 * beamRadius) / (GRID_RES - 1);
  const cellArea = cellSide * cellSide;
  const beamIrradiance = TOTAL_BEAM_WATTS / (Math.PI * beamRadius * beamRadius);

  const wallSpanX = wallXMax - wallXMin;
  const wallSpanY = wallYMax - wallYMin;
  const wallPixArea = (wallSpanX / wallTexW) * (wallSpanY / wallTexH);

  const floorSpanX = floorXMax - floorXMin;
  const floorSpanZ = floorZMax - floorZMin;
  const floorPixArea = (floorSpanX / floorTexW) * (floorSpanZ / floorTexH);

  function intersectDiamond(ox, oy, oz, dx, dy, dz) {
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

  // Smooth polished-bevel margin weight near facet edges so boundaries taper gracefully without pixel stair-stepping
  function facetEdgeTaper(px, py, pz, activeFacet) {
    let minMargin = 1e30;
    for (let p = 0; p < nPlanes; p++) {
      if (p === activeFacet) continue;
      const i = p * 4;
      const margin = worldPlanes[i + 3] - (worldPlanes[i] * px + worldPlanes[i + 1] * py + worldPlanes[i + 2] * pz);
      if (margin < minMargin) minMargin = margin;
    }
    const t = Math.max(0, Math.min(1, minMargin / 0.0035));
    return t * t * (3 - 2 * t);
  }

  const nVerts = GRID_RES * GRID_RES;
  const BR_COUNT = 3;
  const hitKind = new Int8Array(nVerts * BR_COUNT);
  const hitSig = new Int32Array(nVerts * BR_COUNT);
  const hitU = new Float32Array(nVerts * BR_COUNT);
  const hitV = new Float32Array(nVerts * BR_COUNT);
  const hitWeight = new Float32Array(nVerts * BR_COUNT);

  let wallFluxSum = 0, floorFluxSum = 0;
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
      floorFluxSum += weight;
    }
  }

  for (let b = 0; b < NUM_BANDS; b++) {
    const ior = bandIOR[b];
    const [cr, cg, cb] = bandRGB[b];
    hitKind.fill(0);
    hitSig.fill(-1);
    hitWeight.fill(0);

    for (let iy = 0; iy < GRID_RES; iy++) {
      const v = ((iy / (GRID_RES - 1)) * 2 - 1) * beamRadius;
      for (let ix = 0; ix < GRID_RES; ix++) {
        const u = ((ix / (GRID_RES - 1)) * 2 - 1) * beamRadius;
        const rNorm2 = (u * u + v * v) / (beamRadius * beamRadius);
        if (rNorm2 > 1.0) continue;

        const vIdx = iy * GRID_RES + ix;
        const profile = Math.exp(-1.55 * rNorm2 * rNorm2) * (1 - rNorm2 * rNorm2 * 0.65) * 1.45;

        const ox = beamOrigin[0] + rrx * u + upx * v;
        const oy = beamOrigin[1] + rry * u + upy * v;
        const oz = beamOrigin[2] + rrz * u + upz * v;

        const first = intersectDiamond(ox, oy, oz, bdx, bdy, bdz);
        if (!first || first.tEnter <= 0 || first.fEnter < 0) continue;

        const hx = ox + bdx * first.tEnter;
        const hy = oy + bdy * first.tEnter;
        const hz = oz + bdz * first.tEnter;
        const f0 = first.fEnter;
        const bevel0 = facetEdgeTaper(hx, hy, hz, f0);
        if (bevel0 <= 1e-4) continue;

        const [n0x, n0y, n0z] = perturbCrystalNormal(
          hx, hy, hz,
          worldPlanes[f0 * 4], worldPlanes[f0 * 4 + 1], worldPlanes[f0 * 4 + 2],
          f0,
          slopeAmp * 0.9,
        );

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
        let curW = profile * bevel0 * (1 - F0);
        let sig = f0 + 1;
        let usedSlots = 0;

        for (let bounce = 0; bounce < 5 && curW > 0.006; bounce++) {
          const inside = intersectDiamond(curX, curY, curZ, idx, idy, idz);
          if (!inside || inside.tExit <= 1e-5 || inside.fExit < 0) break;

          const ex = curX + idx * inside.tExit;
          const ey = curY + idy * inside.tExit;
          const ez = curZ + idz * inside.tExit;
          const fe = inside.fExit;
          sig = (sig * 67 + fe + 1) | 0;

          const bevelE = facetEdgeTaper(ex, ey, ez, fe);
          const [onx, ony, onz] = perturbCrystalNormal(
            ex, ey, ez,
            worldPlanes[fe * 4], worldPlanes[fe * 4 + 1], worldPlanes[fe * 4 + 2],
            fe,
            slopeAmp,
          );
          const inx = -onx, iny = -ony, inz = -onz;
          const cosI = -(idx * inx + idy * iny + idz * inz);
          if (cosI <= 1e-4) break;

          curW *= Math.exp(-0.02 * inside.tExit);
          const F = fresnelUnpolarized(cosI, 1 / ior);
          const etaOut = ior;
          const kOut = 1 - etaOut * etaOut * (1 - cosI * cosI);

          if (kOut > 0 && F < 0.995 && bevelE > 1e-4 && usedSlots < BR_COUNT) {
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
              curW * bevelE * (1 - F),
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

  for (let i = 0; i < wallHDR.length; i++) wallHDR[i] *= 1.15;
  for (let i = 0; i < floorHDR.length; i++) floorHDR[i] *= 0.85;

  const wallClean = gaussianSmooth(wallHDR, wallTexW, wallTexH, 1.15, 0.80);
  const floorClean = gaussianSmooth(floorHDR, floorTexW, floorTexH, 1.15, 0.78);

  // Soft highlight knee preserves 100% of lacy internal caustic cusps & rainbow hues without flat white clipping!
  const mapShoulder = (v, knee) => {
    const x = Math.max(0, v);
    return (x * knee) / (x + knee * 0.92);
  };

  const encodeSqrt = (hdr, w, h) => {
    const rgba = Buffer.alloc(w * h * 4);
    const invMax = 1 / hdrMaxNits;
    let peakRaw = 0, peakMapped = 0;
    for (let i = 0, n = w * h; i < n; i++) {
      const r0 = Math.max(0, hdr[i * 3]);
      const g0 = Math.max(0, hdr[i * 3 + 1]);
      const b0 = Math.max(0, hdr[i * 3 + 2]);
      const mx0 = Math.max(r0, g0, b0);
      if (mx0 > peakRaw) peakRaw = mx0;

      // Preserve hue ratio while compressing extreme singular cusp spikes smoothly into [0..hdrMaxNits]
      let r = r0, g = g0, b = b0;
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
    return { rgba, peakRaw, peakMapped };
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wEnc = encodeSqrt(wallClean, wallTexW, wallTexH);
  const fEnc = encodeSqrt(floorClean, floorTexW, floorTexH);

  const wallPath = path.join(OUT_DIR, "caustics-wall.png");
  const floorPath = path.join(OUT_DIR, "caustics-floor.png");
  fs.writeFileSync(wallPath, encodePNG(wallTexW, wallTexH, wEnc.rgba));
  fs.writeFileSync(floorPath, encodePNG(floorTexW, floorTexH, fEnc.rgba));

  const tot = Math.max(wallFluxSum + floorFluxSum, 1e-6);
  console.log(
    `[CausticBake] ${(performance.now() - t0).toFixed(0)} ms | Wall share: ${((wallFluxSum / tot) * 100).toFixed(1)}% (mean=[${(wMeanX / Math.max(wWgtSum, 1e-6)).toFixed(2)}, ${(wMeanY / Math.max(wWgtSum, 1e-6)).toFixed(2)}], rawPeak=${wEnc.peakRaw.toFixed(0)} -> mapped=${wEnc.peakMapped.toFixed(0)} nits) | Floor share: ${((floorFluxSum / tot) * 100).toFixed(1)}% (mapped=${fEnc.peakMapped.toFixed(0)} nits)`,
  );
  return { wallPath, floorPath, center, culetWorld };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bakeAllCaustics();
}
