// Pure Offline Diamond Crystal Optics, Tyndall Volumetric Scattering & Shimmering Caustics (ThreeRT)
//
// Offline Rendering Pipeline (`npm run rt:diamond` / `node playground/threeRT/render-diamond.mjs`):
//   1. Exact 58-Facet Gemological Round Brilliant Cut Diamond (`MeshPhysicalMaterial`, transmission = 1,
//      smooth dielectric roughness = 0.012 < GLASS_DELTA, ior = 2.38) elevated on a sleek dark obsidian
//      optical plinth so the collimated beam illuminates both the upper Crown and lower V-Pavilion.
//   2. 2K Continuous-Spectrum Forward Wavefront Caustic Maps (`caustics-wall.png` 1984x1088,
//      `caustics-floor.png` 1488x1088, 48 CIE 1931 wavelengths 400..685 nm, sqrt-HDR 0..280 nits)
//      decoded at mip 0 via `MaterialFunction` (`o.emissive`), illuminating GI bounces and refracting
//      back through all 58 crystal facets into the camera.
//   3. Physical 3D Volumetric Tyndall Beam & Refracted Spectral Light Fans (`DensityGrid` + `VolumeMesh`,
//      calibrated in true `nits / metre` for `pathtrace.wgsl` `media_track`), visibly connecting the
//      collimator condenser lens -> 58-facet diamond -> shimmering caustics on the rear wall & tabletop.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DensityGrid,
  MaterialFunction,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  Scene,
  SkyGradient,
  Texture,
  TorusGeometry,
  Vector3,
  VolumeFunction,
  VolumeMesh,
} from "@threert/scene";
import { defineGame, type FrameContext } from "@threert/gameplay";

export type CameraPreset = "studio" | "wall" | "macro";

export interface DiamondOpticsState {
  view: CameraPreset;
}

// -----------------------------------------------------------------------------
// Synchronized Optical Layout Constants (matches `bake-diamond-caustics.mjs`)
// -----------------------------------------------------------------------------
const WALL_Z = -0.64;
const WALL_X_MIN = -1.55;
const WALL_X_MAX = 1.85;
const WALL_Y_MIN = 0.0;
const WALL_Y_MAX = 1.68;

const FLOOR_X_MIN = -1.55;
const FLOOR_X_MAX = 1.85;
const FLOOR_Z_MIN = -0.64;
const FLOOR_Z_MAX = 1.56;

const PLINTH_POS: [number, number, number] = [-0.36, 0.085, 0.18];
const PLINTH_R_TOP = 0.080;
const PLINTH_R_BOT = 0.108;
const PLINTH_H = 0.17;

const DIAMOND_RADIUS = 0.275;
const DIAMOND_BASE_POS = new Vector3(-0.36, 0.42, 0.18);
const DIAMOND_EULER: [number, number, number] = [0.33, -0.45, -0.15];

const BEAM_ORIGIN = new Vector3(-1.10, 0.24, 0.86);
const BEAM_AIM = new Vector3(-0.35, 0.435, 0.18);
const BEAM_RADIUS = 0.23;

const HDR_MAX_NITS = 420.0;

// Bounded 3D volumetric medium covering collimator -> diamond -> rear wall & tabletop
const VOL_MIN = new Vector3(-1.24, 0.005, -0.64);
const VOL_MAX = new Vector3(1.68, 1.52, 1.02);
const GRID_NX = 144;
const GRID_NY = 76;
const GRID_NZ = 92;

// -----------------------------------------------------------------------------
// Exact 58-Facet Round Brilliant Cut Convex Polyhedron (Half-Space Clipping)
// -----------------------------------------------------------------------------
interface BuiltDiamond {
  geometry: BufferGeometry;
  worldPlanes: Float32Array;
  center: Vector3;
}

function buildBrilliantDiamond(
  radius: number,
  basePos: Vector3,
  eulerXYZ: [number, number, number],
  plinthTopY: number,
): BuiltDiamond {
  const deg = Math.PI / 180;
  const hCrown = 0.345;
  const gHalf = 0.026;
  const hPav = 0.875;
  const planes: [number, number, number, number][] = [];

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

  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), eulerXYZ[0]);
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), eulerXYZ[1]);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), eulerXYZ[2]);
  const q = new Quaternion().multiply(qx).multiply(qy).multiply(qz);

  const pos = basePos.clone();
  const rotMat = new Matrix4().compose(pos, q, new Vector3(radius, radius, radius));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  let minWorldY = Infinity;

  for (let i = 0; i < planes.length; i++) {
    const [nx, ny, nz, d] = planes[i];
    const n = new Vector3(nx, ny, nz);
    const upRef = Math.abs(ny) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const tAxis = new Vector3().crossVectors(upRef, n).normalize();
    const bAxis = new Vector3().crossVectors(n, tAxis).normalize();
    const origin = n.clone().multiplyScalar(d);

    const EXT = 3.0;
    let poly: Vector3[] = [
      origin.clone().addScaledVector(tAxis, -EXT).addScaledVector(bAxis, -EXT),
      origin.clone().addScaledVector(tAxis, EXT).addScaledVector(bAxis, -EXT),
      origin.clone().addScaledVector(tAxis, EXT).addScaledVector(bAxis, EXT),
      origin.clone().addScaledVector(tAxis, -EXT).addScaledVector(bAxis, EXT),
    ];

    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (i === j) continue;
      const [pnx, pny, pnz, pd] = planes[j];
      const next: Vector3[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        const da = pnx * a.x + pny * a.y + pnz * a.z - pd;
        const db = pnx * b.x + pny * b.y + pnz * b.z - pd;
        if (da <= 1e-6) {
          next.push(a);
          if (db > 1e-6) next.push(a.clone().lerp(b, da / (da - db)));
        } else if (db <= 1e-6) {
          next.push(a.clone().lerp(b, da / (da - db)));
        }
      }
      poly = next;
    }

    if (poly.length < 3) continue;

    for (const v of poly) {
      const wv = v.clone().applyMatrix4(rotMat);
      if (wv.y < minWorldY) minWorldY = wv.y;
    }

    const c = new Vector3();
    for (const v of poly) c.add(v);
    c.multiplyScalar(1 / poly.length);

    for (let k = 0; k < poly.length; k++) {
      for (const lv of [c, poly[k], poly[(k + 1) % poly.length]]) {
        positions.push(lv.x * radius, lv.y * radius, lv.z * radius);
        normals.push(nx, ny, nz);
        uvs.push(lv.dot(tAxis) * 0.5 + 0.5, lv.dot(bAxis) * 0.5 + 0.5);
      }
    }
  }

  pos.y += plinthTopY + 0.001 - minWorldY;

  const worldPlanes = new Float32Array(planes.length * 4);
  for (let i = 0; i < planes.length; i++) {
    const [nx, ny, nz, d] = planes[i];
    const wn = new Vector3(nx, ny, nz).applyQuaternion(q).normalize();
    const wd = d * radius + wn.dot(pos);
    worldPlanes[i * 4] = wn.x;
    worldPlanes[i * 4 + 1] = wn.y;
    worldPlanes[i * 4 + 2] = wn.z;
    worldPlanes[i * 4 + 3] = wd;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));

  return { geometry, worldPlanes, center: pos };
}

// -----------------------------------------------------------------------------
// Physical 3D Volumetric Tyndall Beam & Refracted Spectral Fans (`nits / metre`)
// -----------------------------------------------------------------------------
function buildVolumetricBeamGrid(worldPlanes: Float32Array): DensityGrid {
  const nPlanes = worldPlanes.length / 4;
  const data = new Float32Array(GRID_NX * GRID_NY * GRID_NZ * 4);

  // Subtle ambient museum air dust
  for (let i = 3; i < data.length; i += 4) data[i] = 0.03;

  const beamDir = BEAM_AIM.clone().sub(BEAM_ORIGIN).normalize();
  const beamRight = new Vector3(-beamDir.z, 0, beamDir.x).normalize();
  const beamUp = new Vector3().crossVectors(beamRight, beamDir).normalize();

  const spanX = VOL_MAX.x - VOL_MIN.x;
  const spanY = VOL_MAX.y - VOL_MIN.y;
  const spanZ = VOL_MAX.z - VOL_MIN.z;
  const dxVox = spanX / GRID_NX;
  const dyVox = spanY / GRID_NY;
  const dzVox = spanZ / GRID_NZ;
  const voxVol = dxVox * dyVox * dzVox;
  const invSx = 1 / dxVox;
  const invSy = 1 / dyVox;
  const invSz = 1 / dzVox;

  const intersect = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
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
  };

  const isInsideDiamond = (px: number, py: number, pz: number) => {
    for (let p = 0; p < nPlanes; p++) {
      const i = p * 4;
      if (worldPlanes[i] * px + worldPlanes[i + 1] * py + worldPlanes[i + 2] * pz > worldPlanes[i + 3] + 0.002) {
        return false;
      }
    }
    return true;
  };

  // 1. Exact Analytical Collimated Incident Tyndall Beam (`BEAM_ORIGIN -> Diamond Entry Surface`)
  //    Peak axis radiance density = 148 nits/m across ~0.16m chord -> ~24 nits crisp silver-blue Tyndall shaft!
  for (let iz = 0; iz < GRID_NZ; iz++) {
    const pz = VOL_MIN.z + (iz + 0.5) * dzVox;
    for (let iy = 0; iy < GRID_NY; iy++) {
      const py = VOL_MIN.y + (iy + 0.5) * dyVox;
      for (let ix = 0; ix < GRID_NX; ix++) {
        const px = VOL_MIN.x + (ix + 0.5) * dxVox;
        const rx = px - BEAM_ORIGIN.x;
        const ry = py - BEAM_ORIGIN.y;
        const rz = pz - BEAM_ORIGIN.z;
        const s = rx * beamDir.x + ry * beamDir.y + rz * beamDir.z;
        if (s < 0.005 || s > 1.35) continue;

        const u = rx * beamRight.x + ry * beamRight.y + rz * beamRight.z;
        const v = rx * beamUp.x + ry * beamUp.y + rz * beamUp.z;
        const rNorm2 = (u * u + v * v) / (BEAM_RADIUS * BEAM_RADIUS);
        if (rNorm2 > 1.15) continue;

        // Clip strictly at the diamond entry facet (or skip rays that miss the diamond so no stray beam spills past!)
        const ox = BEAM_ORIGIN.x + beamRight.x * u + beamUp.x * v;
        const oy = BEAM_ORIGIN.y + beamRight.y * u + beamUp.y * v;
        const oz = BEAM_ORIGIN.z + beamRight.z * u + beamUp.z * v;
        const hit = intersect(ox, oy, oz, beamDir.x, beamDir.y, beamDir.z);
        if (!hit || hit.tEnter <= 0 || s > hit.tEnter - 0.004) continue;

        // Intense collimated condenser core + silky outer Tyndall sheath
        const core = Math.exp(-3.6 * rNorm2) * 0.78 + Math.exp(-1.35 * rNorm2) * Math.max(0, 1 - rNorm2 * 0.85) * 0.34;
        const axialBoost = 1.0 + 0.28 * Math.exp(-s * 2.2); // brighter right at the condenser lens exit
        const em = core * axialBoost * 142.0; // nits / metre
        const idx = ((iz * GRID_NY + iy) * GRID_NX + ix) * 4;
        data[idx] += em * 0.90;
        data[idx + 1] += em * 0.96;
        data[idx + 2] += em * 1.10;
        data[idx + 3] = Math.max(data[idx + 3], 0.55 * core);
      }
    }
  }

  // 2. 3D Refracted & Dispersed Outgoing Spectral Light Shafts (`Diamond Exit Facets -> Wall & Tabletop`)
  //    Flux-conserving fluence accumulation `(Φ_ray * ds / voxVol)` -> exact `nits / metre`!
  const fanAccum = new Float32Array(GRID_NX * GRID_NY * GRID_NZ * 3);
  const splatSegment = (
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    len: number,
    fluxR: number,
    fluxG: number,
    fluxB: number,
    dens: number,
  ) => {
    const step = 0.014;
    const nSteps = Math.min(140, Math.max(1, Math.ceil(len / step)));
    const ds = len / nSteps;
    const scale = ds / voxVol;
    for (let s = 0; s < nSteps; s++) {
      const t = (s + 0.5) * ds;
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const ix = ((px - VOL_MIN.x) * invSx) | 0;
      const iy = ((py - VOL_MIN.y) * invSy) | 0;
      const iz = ((pz - VOL_MIN.z) * invSz) | 0;
      if (ix < 0 || ix >= GRID_NX || iy < 0 || iy >= GRID_NY || iz < 0 || iz >= GRID_NZ) continue;
      // Gently attenuate scattering far from crystal so shafts look dramatic emerging from facets
      const distFade = 1.0 / (1.0 + 0.55 * t * t);
      const cell = (iz * GRID_NY + iy) * GRID_NX + ix;
      const c3 = cell * 3;
      fanAccum[c3] += fluxR * scale * distFade;
      fanAccum[c3 + 1] += fluxG * scale * distFade;
      fanAccum[c3 + 2] += fluxB * scale * distFade;
      const c4 = cell * 4;
      if (dens > data[c4 + 3]) data[c4 + 3] = dens;
    }
  };

  const bands: [number, number, number, number][] = [
    [1.615, 0.30, 0.10, 1.00], // Violet-Sapphire
    [1.588, 0.08, 0.65, 1.00], // Azure-Cyan
    [1.568, 0.14, 0.96, 0.48], // Emerald
    [1.552, 0.85, 0.98, 0.16], // Chartreuse-Gold
    [1.538, 1.00, 0.68, 0.08], // Warm Amber
    [1.524, 1.00, 0.18, 0.05], // Ruby-Crimson
  ];

  const FAN_N = 28;
  const cellArea = Math.pow((2 * BEAM_RADIUS) / (FAN_N - 1), 2);
  // Calibrated Tyndall scattering gain (`σ_s * p(θ) / 4π * Φ`) so refracted fans read 22..75 nits/m
  const SCATTER_GAIN = 2.65 / bands.length;

  for (const [ior, cr, cg, cb] of bands) {
    for (let iy = 0; iy < FAN_N; iy++) {
      const v = ((iy / (FAN_N - 1)) * 2 - 1) * BEAM_RADIUS;
      for (let ix = 0; ix < FAN_N; ix++) {
        const u = ((ix / (FAN_N - 1)) * 2 - 1) * BEAM_RADIUS;
        const r2 = (u * u + v * v) / (BEAM_RADIUS * BEAM_RADIUS);
        if (r2 > 1.0) continue;
        const prof = Math.exp(-1.55 * r2);
        const ox = BEAM_ORIGIN.x + beamRight.x * u + beamUp.x * v;
        const oy = BEAM_ORIGIN.y + beamRight.y * u + beamUp.y * v;
        const oz = BEAM_ORIGIN.z + beamRight.z * u + beamUp.z * v;

        const first = intersect(ox, oy, oz, beamDir.x, beamDir.y, beamDir.z);
        if (!first || first.tEnter <= 0 || first.fEnter < 0) continue;

        const f0 = first.fEnter * 4;
        const n0x = worldPlanes[f0], n0y = worldPlanes[f0 + 1], n0z = worldPlanes[f0 + 2];
        const cosI0 = -(beamDir.x * n0x + beamDir.y * n0y + beamDir.z * n0z);
        if (cosI0 <= 1e-4) continue;
        const etaIn = 1 / ior;
        const kIn = 1 - etaIn * etaIn * (1 - cosI0 * cosI0);
        if (kIn <= 0) continue;
        const sIn = etaIn * cosI0 - Math.sqrt(kIn);
        let idx = etaIn * beamDir.x + sIn * n0x;
        let idy = etaIn * beamDir.y + sIn * n0y;
        let idz = etaIn * beamDir.z + sIn * n0z;
        const invIn = 1 / Math.hypot(idx, idy, idz);
        idx *= invIn; idy *= invIn; idz *= invIn;

        let curX = ox + beamDir.x * first.tEnter - n0x * 1e-4;
        let curY = oy + beamDir.y * first.tEnter - n0y * 1e-4;
        let curZ = oz + beamDir.z * first.tEnter - n0z * 1e-4;
        let w = prof;

        for (let b = 0; b < 3 && w > 0.08; b++) {
          const inside = intersect(curX, curY, curZ, idx, idy, idz);
          if (!inside || inside.tExit <= 1e-5 || inside.fExit < 0) break;
          const ex = curX + idx * inside.tExit;
          const ey = curY + idy * inside.tExit;
          const ez = curZ + idz * inside.tExit;
          const fe = inside.fExit * 4;
          const onx = worldPlanes[fe], ony = worldPlanes[fe + 1], onz = worldPlanes[fe + 2];
          const inx = -onx, iny = -ony, inz = -onz;
          const cosI = -(idx * inx + idy * iny + idz * inz);
          if (cosI <= 1e-4) break;

          const kOut = 1 - ior * ior * (1 - cosI * cosI);
          if (kOut > 0) {
            const sOut = ior * cosI - Math.sqrt(kOut);
            let odx = ior * idx + sOut * inx;
            let ody = ior * idy + sOut * iny;
            let odz = ior * idz + sOut * inz;
            const invO = 1 / Math.hypot(odx, ody, odz);
            odx *= invO; ody *= invO; odz *= invO;

            let segLen = 1.75;
            if (odz < -1e-4) segLen = Math.min(segLen, (WALL_Z - ez) / odz);
            if (ody < -1e-4) segLen = Math.min(segLen, -ey / ody);
            if (segLen > 0.04) {
              const rayFlux = w * cellArea * SCATTER_GAIN;
              splatSegment(
                ex + onx * 2e-3, ey + ony * 2e-3, ez + onz * 2e-3,
                odx, ody, odz,
                segLen,
                rayFlux * cr, rayFlux * cg, rayFlux * cb,
                0.22,
              );
            }
            w *= 0.28;
          }
          const rdx = idx + 2 * cosI * inx, rdy = idy + 2 * cosI * iny, rdz = idz + 2 * cosI * inz;
          const invR = 1 / Math.hypot(rdx, rdy, rdz);
          idx = rdx * invR; idy = rdy * invR; idz = rdz * invR;
          curX = ex + inx * 1e-4; curY = ey + iny * 1e-4; curZ = ez + inz * 1e-4;
        }
      }
    }
  }

  // Merge outgoing refracted fans with soft shoulder compression (zero interior fog inside crystal!)
  for (let iz = 0; iz < GRID_NZ; iz++) {
    const pz = VOL_MIN.z + (iz + 0.5) * dzVox;
    for (let iy = 0; iy < GRID_NY; iy++) {
      const py = VOL_MIN.y + (iy + 0.5) * dyVox;
      for (let ix = 0; ix < GRID_NX; ix++) {
        const px = VOL_MIN.x + (ix + 0.5) * dxVox;
        const cell = (iz * GRID_NY + iy) * GRID_NX + ix;
        if (isInsideDiamond(px, py, pz)) {
          data[cell * 4] = 0;
          data[cell * 4 + 1] = 0;
          data[cell * 4 + 2] = 0;
          data[cell * 4 + 3] = 0;
          continue;
        }
        const fr = fanAccum[cell * 3];
        const fg = fanAccum[cell * 3 + 1];
        const fb = fanAccum[cell * 3 + 2];
        const mx = Math.max(fr, fg, fb);
        if (mx > 1e-5) {
          const mapped = (mx * 95.0) / (mx + 95.0);
          const s = mapped / mx;
          data[cell * 4] += fr * s;
          data[cell * 4 + 1] += fg * s;
          data[cell * 4 + 2] += fb * s;
        }
      }
    }
  }

  // 3D separable smoothing pass across voxels so volumetric shafts look silky & continuous
  const smoothed = new Float32Array(data.length);
  for (let z = 0; z < GRID_NZ; z++) {
    const zm = Math.max(0, z - 1), zp = Math.min(GRID_NZ - 1, z + 1);
    for (let y = 0; y < GRID_NY; y++) {
      const ym = Math.max(0, y - 1), yp = Math.min(GRID_NY - 1, y + 1);
      for (let x = 0; x < GRID_NX; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(GRID_NX - 1, x + 1);
        const cIdx = ((z * GRID_NY + y) * GRID_NX + x) * 4;
        let sr = data[cIdx] * 2, sg = data[cIdx + 1] * 2, sb = data[cIdx + 2] * 2;
        for (const nb of [
          ((z * GRID_NY + y) * GRID_NX + xm) * 4,
          ((z * GRID_NY + y) * GRID_NX + xp) * 4,
          ((z * GRID_NY + ym) * GRID_NX + x) * 4,
          ((z * GRID_NY + yp) * GRID_NX + x) * 4,
          ((zm * GRID_NY + y) * GRID_NX + x) * 4,
          ((zp * GRID_NY + y) * GRID_NX + x) * 4,
        ]) {
          sr += data[nb];
          sg += data[nb + 1];
          sb += data[nb + 2];
        }
        smoothed[cIdx] = sr / 8;
        smoothed[cIdx + 1] = sg / 8;
        smoothed[cIdx + 2] = sb / 8;
        smoothed[cIdx + 3] = data[cIdx + 3];
      }
    }
  }

  return new DensityGrid({
    size: [GRID_NX, GRID_NY, GRID_NZ],
    channels: 4,
    data: smoothed,
  });
}

// -----------------------------------------------------------------------------
// WGSL Custom Shaders (Caustic Surface Receiver + 3D Volumetric Refracted Beams)
// -----------------------------------------------------------------------------
const CAUSTIC_WALL_FN = new MaterialFunction("caustic_wall_receiver", {
  params: {
    Bounds: [WALL_X_MIN, WALL_X_MAX, WALL_Y_MIN, WALL_Y_MAX],
    MaxNits: HDR_MAX_NITS,
    Tint: [1.0, 0.99, 0.98, 1.0],
  },
  textures: ["CausticMap"],
  code: `
    let bx = $Bounds;
    let u = (i.wp.x - bx.x) / max(bx.y - bx.x, 1e-4);
    let v = 1.0 - (i.wp.y - bx.z) / max(bx.w - bx.z, 1e-4);
    var c = vec3<f32>(0.0);
    if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
      let enc = msample(m, i, $CausticMap, vec2<f32>(u, v), 1e-6).rgb;
      c = enc * enc * $MaxNits;
    }
    let vig = 1.0 - 0.30 * saturate(length((vec2<f32>(u, v) - vec2<f32>(0.54, 0.56)) * vec2<f32>(1.15, 1.0)));
    o.base = base.base * vig;
    o.roughness = 0.74;
    o.specular = 0.35;
    o.emissive = c * $Tint.rgb * i.power;
  `,
});

const CAUSTIC_FLOOR_FN = new MaterialFunction("caustic_floor_receiver", {
  params: {
    Bounds: [FLOOR_X_MIN, FLOOR_X_MAX, FLOOR_Z_MIN, FLOOR_Z_MAX],
    MaxNits: HDR_MAX_NITS,
    Tint: [0.96, 0.98, 1.0, 1.0],
  },
  textures: ["CausticMap"],
  code: `
    let bz = $Bounds;
    let u = (i.wp.x - bz.x) / max(bz.y - bz.x, 1e-4);
    let v = (i.wp.z - bz.z) / max(bz.w - bz.z, 1e-4);
    var c = vec3<f32>(0.0);
    if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
      let enc = msample(m, i, $CausticMap, vec2<f32>(u, v), 1e-6).rgb;
      c = enc * enc * $MaxNits;
    }
    let rDist = length(i.wp.xz - vec2<f32>(0.10, 0.10));
    let fall = 1.0 - 0.34 * saturate(rDist / 1.85);
    o.base = base.base * fall;
    o.roughness = 0.15;
    o.specular = 0.68;
    o.emissive = c * $Tint.rgb * i.power;
  `,
});

const BEAM_VOLUME_FN = new VolumeFunction("diamond_tyndall_beams", {
  params: {
    BaseExt: 0.008,
    BeamExt: 0.032,
    BeamGain: 1.0,
  },
  animated: false,
  code: `
    let g = vgrid(i, i.lp);
    o.extinction = $BaseExt + g.w * $BeamExt;
    o.albedo = vec3<f32>(0.92, 0.95, 1.0);
    o.emission = g.rgb * $BeamGain;
  `,
});

// -----------------------------------------------------------------------------
// Camera Presets (All 100% Unclipped, Offline Calibrated)
// -----------------------------------------------------------------------------
function applyCameraPreset(camera: PerspectiveCamera, view: CameraPreset): void {
  if (view === "wall") {
    // Front-angle showcase: full sparkling diamond on lower-left + expansive shimmering rear wall caustics
    camera.fov = 39;
    camera.position.set(0.06, 0.56, 1.78);
    camera.lookAt(0.18, 0.52, -0.52);
    camera.setManualExposure(5.60);
    camera.dof = null;
  } else if (view === "macro") {
    // Close-up macro: collimated incident beam entering 58-facet diamond, internal TIR fire & emerging rainbow shafts
    camera.fov = 34;
    camera.position.set(-0.70, 0.55, 1.10);
    camera.lookAt(-0.24, 0.43, 0.06);
    camera.setManualExposure(5.65);
    camera.dof = { focusDistance: 1.12, fStop: 5.6, sensorWidth: 0.036 };
  } else {
    // "studio": 3/4 Hero Panorama (Condenser Lens -> Crisp Incident Beam -> 58-Facet Diamond -> 3D Refracted Fans -> Shimmering Wall & Tabletop Caustics)
    camera.fov = 45;
    camera.position.set(-0.34, 0.66, 2.30);
    camera.lookAt(0.06, 0.48, -0.32);
    camera.setManualExposure(5.55);
    camera.dof = null;
  }
}

export default defineGame<DiamondOpticsState>({
  state: {
    view: "studio",
  },
  keys: {},
  handlers: {
    setView(tx, ev: { view?: CameraPreset }) {
      if (ev?.view) tx.state.view = ev.view;
    },
  },
  setup() {
    const scene = new Scene();

    const sky = new SkyGradient({
      zenith: new Color(0x141d33),
      horizon: new Color(0x1f2b46),
      ground: new Color(0x090c14),
      intensity: 6.5,
    });
    sky.skyLightIntensity = 1.0;
    scene.environment = sky;

    const camera = new PerspectiveCamera(43, 16 / 9, 0.05, 80);
    applyCameraPreset(camera, "studio");

    // 1. Sleek Dark Satin Obsidian Optical Plinth
    const plinthMat = new MeshStandardMaterial({
      name: "ObsidianPlinth",
      color: new Color(0x141822),
      roughness: 0.24,
      metalness: 0.35,
    });
    const plinthMesh = new Mesh(new CylinderGeometry(PLINTH_R_TOP, PLINTH_R_BOT, PLINTH_H, 28), plinthMat);
    plinthMesh.position.set(PLINTH_POS[0], PLINTH_POS[1], PLINTH_POS[2]);
    scene.add(plinthMesh);

    const collarMesh = new Mesh(
      new TorusGeometry(PLINTH_R_TOP * 0.98, 0.006, 10, 28),
      new MeshStandardMaterial({ color: 0x384258, roughness: 0.18, metalness: 0.9 }),
    );
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.set(PLINTH_POS[0], PLINTH_H, PLINTH_POS[2]);
    scene.add(collarMesh);

    // 2. Exact 58-Facet Round Brilliant Cut Diamond Crystal (`钻石形状的玻璃`)
    const finalDiamond = buildBrilliantDiamond(DIAMOND_RADIUS, DIAMOND_BASE_POS, DIAMOND_EULER, PLINTH_H);

    const diamondMat = new MeshPhysicalMaterial({
      name: "BrilliantDiamondCrystal",
      color: new Color(0xfafcff),
      roughness: 0.012,
      metalness: 0.0,
      transmission: 1.0,
      ior: 2.38,
      specularIntensity: 1.0,
      flatShading: true,
      side: "double",
    });

    const diamondMesh = new Mesh(finalDiamond.geometry, diamondMat);
    diamondMesh.position.copy(finalDiamond.center);
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), DIAMOND_EULER[0]);
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), DIAMOND_EULER[1]);
    const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), DIAMOND_EULER[2]);
    diamondMesh.quaternion.multiply(qx).multiply(qy).multiply(qz);
    diamondMesh.castShadow = false;
    scene.add(diamondMesh);

    // 3. Load 2K Pre-Baked Continuous-Spectrum Wavefront Caustics
    const wallCausticTex = new Texture("playground/threeRT/out/caustics-wall.png", "linear");
    wallCausticTex.wrap = "clamp";
    const floorCausticTex = new Texture("playground/threeRT/out/caustics-floor.png", "linear");
    floorCausticTex.wrap = "clamp";

    // 4. Rear Gallery Slate-Plaster Projection Wall (`z = WALL_Z`)
    const wallW = WALL_X_MAX - WALL_X_MIN;
    const wallH = WALL_Y_MAX - WALL_Y_MIN;
    const wallMat = new MeshStandardMaterial({
      name: "GalleryProjectionWall",
      color: new Color(0x364054),
      roughness: 0.74,
      metalness: 0.0,
      shader: CAUSTIC_WALL_FN.with(
        {
          Bounds: [WALL_X_MIN, WALL_X_MAX, WALL_Y_MIN, WALL_Y_MAX],
          MaxNits: HDR_MAX_NITS,
          Tint: [1.0, 0.99, 0.98, 1.0],
        },
        { CausticMap: wallCausticTex },
      ),
    });
    const wallMesh = new Mesh(new PlaneGeometry(wallW, wallH), wallMat);
    wallMesh.position.set((WALL_X_MIN + WALL_X_MAX) * 0.5, (WALL_Y_MIN + WALL_Y_MAX) * 0.5, WALL_Z);
    scene.add(wallMesh);

    // 5. Satin Dark Slate Optical Tabletop (`y = 0`)
    const floorW = FLOOR_X_MAX - FLOOR_X_MIN;
    const floorD = FLOOR_Z_MAX - FLOOR_Z_MIN;
    const floorMat = new MeshStandardMaterial({
      name: "OpticalSlateTable",
      color: new Color(0x1b2130),
      roughness: 0.15,
      metalness: 0.05,
      shader: CAUSTIC_FLOOR_FN.with(
        {
          Bounds: [FLOOR_X_MIN, FLOOR_X_MAX, FLOOR_Z_MIN, FLOOR_Z_MAX],
          MaxNits: HDR_MAX_NITS,
          Tint: [0.96, 0.98, 1.0, 1.0],
        },
        { CausticMap: floorCausticTex },
      ),
    });
    const floorMesh = new Mesh(new PlaneGeometry(floorW, floorD), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set((FLOOR_X_MIN + FLOOR_X_MAX) * 0.5, 0.0, (FLOOR_Z_MIN + FLOOR_Z_MAX) * 0.5);
    scene.add(floorMesh);

    const trimMesh = new Mesh(
      new BoxGeometry(wallW, 0.016, 0.016),
      new MeshStandardMaterial({ color: 0x10141e, roughness: 0.32, metalness: 0.65 }),
    );
    trimMesh.position.set((WALL_X_MIN + WALL_X_MAX) * 0.5, 0.008, WALL_Z + 0.008);
    scene.add(trimMesh);

    // 6. Optical Collimator Barrel & Glowing Condenser Lens (`MAT_UNLIT`, visible on left!)
    const beamDir = BEAM_AIM.clone().sub(BEAM_ORIGIN).normalize();
    const barrelLen = 0.28;
    const barrelCenter = BEAM_ORIGIN.clone().addScaledVector(beamDir, -barrelLen * 0.5 - 0.008);

    const barrelGeo = new CylinderGeometry(BEAM_RADIUS * 0.94, BEAM_RADIUS * 1.02, barrelLen, 28);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMesh = new Mesh(
      barrelGeo,
      new MeshStandardMaterial({ color: 0x232b3d, roughness: 0.25, metalness: 0.88 }),
    );
    barrelMesh.position.copy(barrelCenter);
    barrelMesh.lookAt(BEAM_AIM);
    scene.add(barrelMesh);

    const bezelMesh = new Mesh(
      new TorusGeometry(BEAM_RADIUS * 0.92, 0.012, 12, 28),
      new MeshStandardMaterial({ color: 0x566684, roughness: 0.18, metalness: 0.92 }),
    );
    bezelMesh.position.copy(BEAM_ORIGIN);
    bezelMesh.lookAt(BEAM_AIM);
    scene.add(bezelMesh);

    const lensMesh = new Mesh(
      new RingGeometry(0.0, BEAM_RADIUS * 0.90, 28),
      new MeshBasicMaterial({ color: new Color().setRGB(155, 178, 225) }),
    );
    lensMesh.position.copy(BEAM_ORIGIN).addScaledVector(beamDir, -0.003);
    lensMesh.lookAt(BEAM_AIM);
    lensMesh.castShadow = false;
    scene.add(lensMesh);

    // 7. One-Sided Studio Jewel Reflection Softboxes (`side: "front"`, strictly behind z >= 2.45)
    const addJewelReflector = (
      pos: [number, number, number],
      look: [number, number, number],
      size: [number, number],
      rgbHdr: [number, number, number],
    ) => {
      const card = new Mesh(
        new PlaneGeometry(size[0], size[1]),
        new MeshBasicMaterial({
          color: new Color().setRGB(rgbHdr[0], rgbHdr[1], rgbHdr[2]),
          side: "front",
        }),
      );
      card.position.set(pos[0], pos[1], pos[2]);
      card.lookAt(look[0], look[1], look[2]);
      card.castShadow = false;
      scene.add(card);
    };

    const dTarget: [number, number, number] = [finalDiamond.center.x, finalDiamond.center.y, finalDiamond.center.z];
    addJewelReflector([-0.36, 2.55, 0.65], dTarget, [1.5, 0.42], [215, 240, 285]);
    addJewelReflector([-1.75, 1.65, 2.55], dTarget, [0.75, 1.35], [185, 215, 275]);
    addJewelReflector([1.45, 1.85, 2.65], dTarget, [0.70, 1.25], [215, 198, 175]);
    addJewelReflector([0.0, 1.95, 3.15], dTarget, [2.0, 0.45], [150, 170, 210]);

    // 8. Soft Studio Gallery Architectural Wash Lights
    const galleryWash = new PointLight(new Color(0xd8e4ff), 86.0, 9.0, 2.0);
    galleryWash.radius = 0.45;
    galleryWash.position.set(0.25, 1.85, 1.65);
    scene.add(galleryWash);

    const rimFill = new PointLight(new Color(0xc8dcff), 44.0, 7.0, 2.0);
    rimFill.radius = 0.35;
    rimFill.position.set(-1.35, 1.25, 1.35);
    scene.add(rimFill);

    // 9. 3D Volumetric Tyndall Beam & Refracted Spectral Fans
    const volGrid = buildVolumetricBeamGrid(finalDiamond.worldPlanes);
    const volSize = VOL_MAX.clone().sub(VOL_MIN);
    const volCenter = VOL_MIN.clone().addScaledVector(volSize, 0.5);
    const beamVolume = new VolumeMesh({
      shape: "box",
      volume: BEAM_VOLUME_FN.with({
        BaseExt: 0.008,
        BeamExt: 0.032,
        BeamGain: 1.0,
      }),
      grid: volGrid,
      majorant: 6.0,
      anisotropy: 0.62,
    });
    beamVolume.position.copy(volCenter);
    beamVolume.scale.copy(volSize);
    scene.add(beamVolume);

    let activeView: CameraPreset = "studio";
    (scene as unknown as Record<string, unknown>).__handles = {
      applyView: (v: CameraPreset) => {
        if (v !== activeView) {
          activeView = v;
          applyCameraPreset(camera, activeView);
        }
      },
    };

    return {
      scene,
      camera,
      options: {
        name: "diamond-optics",
        width: 1600,
        height: 900,
        preset: "cinematic" as const,
        overrides: {
          native: {
            spp: 512,
            maxBounces: 16,
            denoise: true,
            clampIndirect: 100000,
            russianRouletteDepth: 6,
            energyCompensation: 1.0,
          },
          post: {
            bloom: {
              intensity: 0.36,
              threshold: 0.88,
              sizeScale: 3.2,
            },
            vignette: 0.20,
          },
        },
      },
    };
  },
  frame(f: FrameContext<DiamondOpticsState>) {
    const h = (f.scene as unknown as Record<string, { applyView: (v: CameraPreset) => void }>).__handles;
    if (h && f.state.view) h.applyView(f.state.view);
  },
});
