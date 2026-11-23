// Simplified Triangular Prism Optical Dispersion Scene (ThreeRT Offline Path Tracer)
// Clean textbook test: Collimated white light -> Equilateral Glass Prism -> Dispersed Rainbow on Rear Wall

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DensityGrid,
  MaterialFunction,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
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

export type CameraPreset = "studio" | "wall";

export interface PrismOpticsState {
  view: CameraPreset;
}

const WALL_Z = -0.64;
const WALL_X_MIN = -1.55;
const WALL_X_MAX = 1.85;
const WALL_Y_MIN = 0.0;
const WALL_Y_MAX = 1.68;

const FLOOR_X_MIN = -1.55;
const FLOOR_X_MAX = 1.85;
const FLOOR_Z_MIN = -0.64;
const FLOOR_Z_MAX = 1.56;

const PLINTH_POS: [number, number, number] = [-0.45, 0.085, 0.35];
const PLINTH_R_TOP = 0.11;
const PLINTH_R_BOT = 0.135;
const PLINTH_H = 0.17;

const PRISM_APOTHEM = 0.14;
const PRISM_HEIGHT = 0.34;
const PRISM_CENTER = new Vector3(-0.45, 0.34, 0.35);
const PRISM_YAW = (23 * Math.PI) / 180;

const BEAM_ORIGIN = new Vector3(-1.20, 0.34, 0.46);
const BEAM_DIR = new Vector3(1.0, 0.0, 0.0);
const BEAM_RADIUS = 0.072;
const SLIT_HALF_W = 0.009;

const HDR_MAX_NITS = 420.0;

const VOL_MIN = new Vector3(-1.24, 0.005, -0.64);
const VOL_MAX = new Vector3(1.68, 1.52, 1.02);
const GRID_NX = 144;
const GRID_NY = 76;
const GRID_NZ = 92;

interface BuiltPrism {
  geometry: BufferGeometry;
  worldPlanes: Float32Array;
}

function buildEquilateralPrism(): BuiltPrism {
  const hHalf = PRISM_HEIGHT * 0.5;
  const c = Math.cos(PRISM_YAW);
  const s = Math.sin(PRISM_YAW);

  const localPlanes: [number, number, number, number][] = [
    [-Math.sqrt(3) * 0.5, 0, 0.5, PRISM_APOTHEM],
    [Math.sqrt(3) * 0.5, 0, 0.5, PRISM_APOTHEM],
    [0, 0, -1, PRISM_APOTHEM],
    [0, 1, 0, hHalf],
    [0, -1, 0, hHalf],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < localPlanes.length; i++) {
    const [nx, ny, nz, d] = localPlanes[i];
    const n = new Vector3(nx, ny, nz);
    const upRef = Math.abs(ny) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const tAxis = new Vector3().crossVectors(upRef, n).normalize();
    const bAxis = new Vector3().crossVectors(n, tAxis).normalize();
    const origin = n.clone().multiplyScalar(d);

    const EXT = 1.0;
    let poly: Vector3[] = [
      origin.clone().addScaledVector(tAxis, -EXT).addScaledVector(bAxis, -EXT),
      origin.clone().addScaledVector(tAxis, EXT).addScaledVector(bAxis, -EXT),
      origin.clone().addScaledVector(tAxis, EXT).addScaledVector(bAxis, EXT),
      origin.clone().addScaledVector(tAxis, -EXT).addScaledVector(bAxis, EXT),
    ];

    for (let j = 0; j < localPlanes.length && poly.length >= 3; j++) {
      if (i === j) continue;
      const [pnx, pny, pnz, pd] = localPlanes[j];
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
    const ctr = new Vector3();
    for (const v of poly) ctr.add(v);
    ctr.multiplyScalar(1 / poly.length);

    for (let k = 0; k < poly.length; k++) {
      for (const lv of [ctr, poly[k], poly[(k + 1) % poly.length]]) {
        positions.push(lv.x, lv.y, lv.z);
        normals.push(nx, ny, nz);
        uvs.push(lv.dot(tAxis) * 0.5 + 0.5, lv.dot(bAxis) * 0.5 + 0.5);
      }
    }
  }

  const worldPlanes = new Float32Array(localPlanes.length * 4);
  for (let i = 0; i < localPlanes.length; i++) {
    const [lx, ly, lz, d] = localPlanes[i];
    const wx = c * lx + s * lz;
    const wy = ly;
    const wz = -s * lx + c * lz;
    const wd = d + wx * PRISM_CENTER.x + wy * PRISM_CENTER.y + wz * PRISM_CENTER.z;
    worldPlanes[i * 4] = wx;
    worldPlanes[i * 4 + 1] = wy;
    worldPlanes[i * 4 + 2] = wz;
    worldPlanes[i * 4 + 3] = wd;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));

  return { geometry, worldPlanes };
}

function buildVolumetricBeamGrid(worldPlanes: Float32Array): DensityGrid {
  const nPlanes = worldPlanes.length / 4;
  const data = new Float32Array(GRID_NX * GRID_NY * GRID_NZ * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 0.03;

  const beamDir = BEAM_DIR;
  const beamRight = new Vector3(0, 0, 1);
  const beamUp = new Vector3(0, 1, 0);

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

  const isInsidePrism = (px: number, py: number, pz: number) => {
    for (let p = 0; p < nPlanes; p++) {
      const i = p * 4;
      if (worldPlanes[i] * px + worldPlanes[i + 1] * py + worldPlanes[i + 2] * pz > worldPlanes[i + 3] + 0.002) {
        return false;
      }
    }
    return true;
  };

  // 1. Crisp White Incident Beam
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
        const uNorm = u / SLIT_HALF_W;
        const vNorm = v / BEAM_RADIUS;
        if (Math.abs(uNorm) > 1.3 || Math.abs(vNorm) > 1.1) continue;

        const ox = BEAM_ORIGIN.x + beamRight.x * u + beamUp.x * v;
        const oy = BEAM_ORIGIN.y + beamRight.y * u + beamUp.y * v;
        const oz = BEAM_ORIGIN.z + beamRight.z * u + beamUp.z * v;
        const hit = intersect(ox, oy, oz, beamDir.x, beamDir.y, beamDir.z);
        if (!hit || hit.tEnter <= 0 || s > hit.tEnter - 0.004) continue;

        const core = Math.exp(-2.2 * uNorm * uNorm) * Math.exp(-0.8 * vNorm * vNorm);
        const em = core * 680.0;
        const idx = ((iz * GRID_NY + iy) * GRID_NX + ix) * 4;
        data[idx] += em * 0.96;
        data[idx + 1] += em * 0.98;
        data[idx + 2] += em * 1.02;
        data[idx + 3] = Math.max(data[idx + 3], 0.85 * core);
      }
    }
  }

  // 2. Dispersed Rainbow Fans Exiting the Prism -> Rear Wall
  const fanAccum = new Float32Array(GRID_NX * GRID_NY * GRID_NZ * 3);
  const splatSegment = (
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    len: number,
    fluxR: number, fluxG: number, fluxB: number,
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
      const cell = (iz * GRID_NY + iy) * GRID_NX + ix;
      const c3 = cell * 3;
      fanAccum[c3] += fluxR * scale;
      fanAccum[c3 + 1] += fluxG * scale;
      fanAccum[c3 + 2] += fluxB * scale;
      const c4 = cell * 4;
      if (dens > data[c4 + 3]) data[c4 + 3] = dens;
    }
  };

  const bands: [number, number, number, number][] = [
    [1.705, 0.35, 0.10, 1.00], // Violet
    [1.655, 0.08, 0.65, 1.00], // Cyan-Blue
    [1.615, 0.14, 0.96, 0.45], // Green
    [1.588, 0.90, 0.96, 0.14], // Yellow
    [1.565, 1.00, 0.55, 0.08], // Orange
    [1.545, 1.00, 0.16, 0.05], // Red
  ];

  const FAN_N = 24;
  const cellArea = ((2 * SLIT_HALF_W) / (FAN_N - 1)) * ((2 * BEAM_RADIUS) / (FAN_N - 1));
  const SCATTER_GAIN = 140.0 / bands.length;

  for (const [ior, cr, cg, cb] of bands) {
    for (let iy = 0; iy < FAN_N; iy++) {
      const vNorm = (iy / (FAN_N - 1)) * 2 - 1;
      const v = vNorm * BEAM_RADIUS;
      for (let ix = 0; ix < FAN_N; ix++) {
        const uNorm = (ix / (FAN_N - 1)) * 2 - 1;
        const u = uNorm * SLIT_HALF_W;
        const prof = Math.exp(-2.2 * uNorm * uNorm) * Math.exp(-0.8 * vNorm * vNorm);
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

        const inside = intersect(curX, curY, curZ, idx, idy, idz);
        if (!inside || inside.tExit <= 1e-5 || inside.fExit < 0) continue;
        const ex = curX + idx * inside.tExit;
        const ey = curY + idy * inside.tExit;
        const ez = curZ + idz * inside.tExit;
        const fe = inside.fExit * 4;
        const onx = worldPlanes[fe], ony = worldPlanes[fe + 1], onz = worldPlanes[fe + 2];
        const inx = -onx, iny = -ony, inz = -onz;
        const cosI = -(idx * inx + idy * iny + idz * inz);
        if (cosI <= 1e-4) continue;

        const kOut = 1 - ior * ior * (1 - cosI * cosI);
        if (kOut > 0) {
          const sOut = ior * cosI - Math.sqrt(kOut);
          let odx = ior * idx + sOut * inx;
          let ody = ior * idy + sOut * iny;
          let odz = ior * idz + sOut * inz;
          const invO = 1 / Math.hypot(odx, ody, odz);
          odx *= invO; ody *= invO; odz *= invO;

          let segLen = 2.0;
          if (odz < -1e-4) segLen = Math.min(segLen, (WALL_Z - ez) / odz);
          if (ody < -1e-4) segLen = Math.min(segLen, -ey / ody);
          if (segLen > 0.04) {
            const rayFlux = prof * cellArea * SCATTER_GAIN;
            splatSegment(
              ex + onx * 2e-3, ey + ony * 2e-3, ez + onz * 2e-3,
              odx, ody, odz,
              segLen,
              rayFlux * cr, rayFlux * cg, rayFlux * cb,
              0.25,
            );
          }
        }
      }
    }
  }

  for (let iz = 0; iz < GRID_NZ; iz++) {
    const pz = VOL_MIN.z + (iz + 0.5) * dzVox;
    for (let iy = 0; iy < GRID_NY; iy++) {
      const py = VOL_MIN.y + (iy + 0.5) * dyVox;
      for (let ix = 0; ix < GRID_NX; ix++) {
        const px = VOL_MIN.x + (ix + 0.5) * dxVox;
        const cell = (iz * GRID_NY + iy) * GRID_NX + ix;
        if (isInsidePrism(px, py, pz)) {
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
          const mapped = (mx * 260.0) / (mx + 260.0);
          const s = mapped / mx;
          data[cell * 4] += fr * s;
          data[cell * 4 + 1] += fg * s;
          data[cell * 4 + 2] += fb * s;
        }
      }
    }
  }

  return new DensityGrid({
    size: [GRID_NX, GRID_NY, GRID_NZ],
    channels: 4,
    data,
  });
}

const CAUSTIC_WALL_FN = new MaterialFunction("prism_wall_receiver", {
  params: {
    Bounds: [WALL_X_MIN, WALL_X_MAX, WALL_Y_MIN, WALL_Y_MAX],
    MaxNits: HDR_MAX_NITS,
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
    o.base = base.base;
    o.roughness = 0.78;
    o.specular = 0.30;
    o.emissive = c * i.power;
  `,
});

const CAUSTIC_FLOOR_FN = new MaterialFunction("prism_floor_receiver", {
  params: {
    Bounds: [FLOOR_X_MIN, FLOOR_X_MAX, FLOOR_Z_MIN, FLOOR_Z_MAX],
    MaxNits: HDR_MAX_NITS,
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
    o.base = base.base;
    o.roughness = 0.18;
    o.specular = 0.65;
    o.emissive = c * i.power;
  `,
});

const BEAM_VOLUME_FN = new VolumeFunction("prism_tyndall_beams", {
  params: {
    BaseExt: 0.012,
    BeamExt: 0.18,
  },
  animated: false,
  code: `
    let g = vgrid(i, i.lp);
    o.extinction = $BaseExt + g.w * $BeamExt;
    o.albedo = vec3<f32>(0.92, 0.95, 1.0);
    o.emission = g.rgb;
  `,
});

function applyCameraPreset(camera: PerspectiveCamera, view: CameraPreset): void {
  if (view === "wall") {
    camera.fov = 42;
    camera.position.set(0.05, 0.56, 1.85);
    camera.lookAt(0.18, 0.36, -0.45);
    camera.setManualExposure(4.8);
    camera.dof = null;
  } else {
    camera.fov = 46;
    camera.position.set(-0.22, 0.96, 1.52);
    camera.lookAt(0.04, 0.34, -0.06);
    camera.setManualExposure(4.8);
    camera.dof = null;
  }
}

export default defineGame<PrismOpticsState>({
  state: { view: "studio" },
  keys: {},
  handlers: {
    setView(tx, ev: { view?: CameraPreset }) {
      if (ev?.view) tx.state.view = ev.view;
    },
  },
  setup() {
    const scene = new Scene();
    const sky = new SkyGradient({
      zenith: new Color(0x1b2438),
      horizon: new Color(0x283450),
      ground: new Color(0x111622),
      intensity: 16.0,
    });
    sky.skyLightIntensity = 1.0;
    scene.environment = sky;

    const camera = new PerspectiveCamera(46, 16 / 9, 0.05, 80);
    applyCameraPreset(camera, "studio");

    // 1. Sleek Optical Plinth + Brushed Silver Mounting Collar
    const plinthMesh = new Mesh(
      new CylinderGeometry(PLINTH_R_TOP, PLINTH_R_BOT, PLINTH_H, 32),
      new MeshStandardMaterial({ color: 0x262e40, roughness: 0.25, metalness: 0.45 }),
    );
    plinthMesh.position.set(PLINTH_POS[0], PLINTH_POS[1], PLINTH_POS[2]);
    scene.add(plinthMesh);

    const collarMesh = new Mesh(
      new CylinderGeometry(PLINTH_R_TOP * 1.04, PLINTH_R_TOP * 1.04, 0.014, 3),
      new MeshStandardMaterial({ color: 0x7e8ea8, roughness: 0.22, metalness: 0.88 }),
    );
    collarMesh.position.set(PLINTH_POS[0], PLINTH_H - 0.004, PLINTH_POS[2]);
    collarMesh.rotation.y = PRISM_YAW + Math.PI;
    scene.add(collarMesh);

    // 2. Equilateral Glass Prism
    const prism = buildEquilateralPrism();
    const prismMat = new MeshPhysicalMaterial({
      name: "OpticalFlintPrism",
      color: new Color(0xf8fbff),
      roughness: 0.006,
      metalness: 0.0,
      transmission: 1.0,
      ior: 1.60,
      specularIntensity: 1.0,
      flatShading: true,
      side: "double",
    });
    const prismMesh = new Mesh(prism.geometry, prismMat);
    prismMesh.position.copy(PRISM_CENTER);
    prismMesh.rotation.y = PRISM_YAW;
    prismMesh.castShadow = false;
    scene.add(prismMesh);

    // 3. Caustic Wall & Floor
    const wallCausticTex = new Texture("optics/prism/out/prism-caustics-wall.png", "linear");
    wallCausticTex.wrap = "clamp";
    const floorCausticTex = new Texture("optics/prism/out/prism-caustics-floor.png", "linear");
    floorCausticTex.wrap = "clamp";

    const wallW = WALL_X_MAX - WALL_X_MIN;
    const wallH = WALL_Y_MAX - WALL_Y_MIN;
    const wallMesh = new Mesh(
      new PlaneGeometry(wallW, wallH),
      new MeshStandardMaterial({
        name: "PrismWall",
        color: new Color(0x465268),
        roughness: 0.78,
        metalness: 0.0,
        shader: CAUSTIC_WALL_FN.with(
          { Bounds: [WALL_X_MIN, WALL_X_MAX, WALL_Y_MIN, WALL_Y_MAX], MaxNits: HDR_MAX_NITS },
          { CausticMap: wallCausticTex },
        ),
      }),
    );
    wallMesh.position.set((WALL_X_MIN + WALL_X_MAX) * 0.5, (WALL_Y_MIN + WALL_Y_MAX) * 0.5, WALL_Z);
    scene.add(wallMesh);

    const floorW = FLOOR_X_MAX - FLOOR_X_MIN;
    const floorD = FLOOR_Z_MAX - FLOOR_Z_MIN;
    const floorMesh = new Mesh(
      new PlaneGeometry(floorW, floorD),
      new MeshStandardMaterial({
        name: "PrismTable",
        color: new Color(0x283144),
        roughness: 0.22,
        metalness: 0.08,
        shader: CAUSTIC_FLOOR_FN.with(
          { Bounds: [FLOOR_X_MIN, FLOOR_X_MAX, FLOOR_Z_MIN, FLOOR_Z_MAX], MaxNits: HDR_MAX_NITS },
          { CausticMap: floorCausticTex },
        ),
      }),
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set((FLOOR_X_MIN + FLOOR_X_MAX) * 0.5, 0.0, (FLOOR_Z_MIN + FLOOR_Z_MAX) * 0.5);
    scene.add(floorMesh);

    // 4. Slit Collimator Barrel & Vertical Slit Aperture
    const barrelLen = 0.22;
    const barrelGeo = new CylinderGeometry(BEAM_RADIUS * 1.15, BEAM_RADIUS * 1.25, barrelLen, 24);
    barrelGeo.rotateZ(Math.PI / 2);
    const barrelMesh = new Mesh(
      barrelGeo,
      new MeshStandardMaterial({ color: 0x2d374d, roughness: 0.25, metalness: 0.88 }),
    );
    barrelMesh.position.copy(BEAM_ORIGIN).add(new Vector3(-barrelLen * 0.5 - 0.005, 0, 0));
    scene.add(barrelMesh);

    const capMesh = new Mesh(
      new CylinderGeometry(BEAM_RADIUS * 1.16, BEAM_RADIUS * 1.16, 0.008, 24),
      new MeshStandardMaterial({ color: 0x4b5a75, roughness: 0.22, metalness: 0.90 }),
    );
    capMesh.rotation.z = Math.PI / 2;
    capMesh.position.copy(BEAM_ORIGIN).add(new Vector3(-0.004, 0, 0));
    scene.add(capMesh);

    const slitMesh = new Mesh(
      new BoxGeometry(0.004, BEAM_RADIUS * 2.0, SLIT_HALF_W * 2.2),
      new MeshBasicMaterial({ color: new Color().setRGB(180, 195, 225) }),
    );
    slitMesh.position.copy(BEAM_ORIGIN).add(new Vector3(0.001, 0, 0));
    slitMesh.castShadow = false;
    scene.add(slitMesh);

    // 5. Studio Reflector Softboxes (give crisp Fresnel highlights on all prism faces & edges)
    const addPrismReflector = (
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
    const pTgt: [number, number, number] = [PRISM_CENTER.x, PRISM_CENTER.y, PRISM_CENTER.z];
    addPrismReflector([-0.45, 2.25, 0.35], pTgt, [1.4, 0.55], [160, 185, 230]);
    addPrismReflector([-1.75, 1.35, 1.95], pTgt, [0.75, 1.20], [145, 175, 220]);
    addPrismReflector([1.15, 1.45, 2.05], pTgt, [0.75, 1.20], [175, 165, 150]);
    addPrismReflector([-0.45, 1.55, -0.55], pTgt, [1.2, 0.35], [120, 145, 190]);

    // 6. Gallery Wash Lights
    const galleryWash = new PointLight(new Color(0xd8e4ff), 240.0, 9.0, 2.0);
    galleryWash.radius = 0.45;
    galleryWash.position.set(0.25, 1.85, 1.65);
    scene.add(galleryWash);

    const rimFill = new PointLight(new Color(0xc8dcff), 140.0, 7.0, 2.0);
    rimFill.radius = 0.35;
    rimFill.position.set(-1.35, 1.25, 1.35);
    scene.add(rimFill);

    // 7. Volumetric Beam & Dispersed Rainbow Fan
    const volGrid = buildVolumetricBeamGrid(prism.worldPlanes);
    const volSize = VOL_MAX.clone().sub(VOL_MIN);
    const volCenter = VOL_MIN.clone().addScaledVector(volSize, 0.5);
    const beamVolume = new VolumeMesh({
      shape: "box",
      volume: BEAM_VOLUME_FN.with({ BaseExt: 0.012, BeamExt: 0.18 }),
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
        name: "prism-optics",
        width: 1600,
        height: 900,
        preset: "cinematic" as const,
        overrides: {
          native: {
            spp: 256,
            maxBounces: 12,
            denoise: true,
            clampIndirect: 100000,
            russianRouletteDepth: 6,
            energyCompensation: 1.0,
          },
          post: {
            bloom: { intensity: 0.34, threshold: 0.88, sizeScale: 3.0 },
            vignette: 0.20,
          },
        },
      },
    };
  },
  frame(f: FrameContext<PrismOpticsState>) {
    const h = (f.scene as unknown as Record<string, { applyView: (v: CameraPreset) => void }>).__handles;
    if (h && f.state.view) h.applyView(f.state.view);
  },
});
