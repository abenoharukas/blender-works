// Architectural building & street-prop generators for a photorealistic Japanese townscape:
// - 6 distinct Japanese detached house archetypes (一戸建て: Kirizuma, Katanagare,
//   Yosemune, 3F Kyosho-jutaku, Traditional Machiya/Washiki, Courtyard L-house)
//   with concrete foundation plinths (基礎巾木), true 3D recessed window assemblies
//   (サッシ枠・水切り・シャッターボックス・木格子), bargeboards (破風板), clay ridge tiles (棟瓦),
//   half-round eaves gutters & vertical corner downspouts (軒樋・竪樋), and AC units with slim-ducts.
// - 5 distinct Japanese neighborhood commercial archetypes (小商圈・商店街) with 32cm recessed
//   ground-floor storefront alcoves, clamped 3D fascia signboards, 4-panel fluttering Noren,
//   framed Konbini pylon signs, A-frame menu stands, beer crates, and upper-storey 3D windows.
// - Authentic street infrastructure: curved non-emissive enameled utility pole plaques + straps +
//   insulators, non-emissive woven Shotengai street flags under Suzuran bell lamps, and open-truss
//   Shotengai entrance arches with brushed-gold sign bezels and gooseneck floodlights.
import * as THREE from 'three';
import { KEI_VEHICLE_PROTOS } from './kei-vehicles.js?v=20261127e';

const _mat4 = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _one = new THREE.Vector3(1, 1, 1);

function ensureIndexedClean(geom) {
  if (!geom.attributes.normal) geom.computeVertexNormals();
  if (!geom.attributes.uv) {
    const count = geom.attributes.position.count;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!geom.index) {
    const count = geom.attributes.position.count;
    const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geom;
}

const PROTO_BOX = ensureIndexedClean(new THREE.BoxGeometry(1, 1, 1));
const PROTO_CYL6 = ensureIndexedClean(new THREE.CylinderGeometry(1, 1, 1, 6));
const PROTO_CYL8 = ensureIndexedClean(new THREE.CylinderGeometry(1, 1, 1, 8));
const PROTO_CYL12 = ensureIndexedClean(new THREE.CylinderGeometry(1, 1, 1, 12));
const PROTO_CONE10 = ensureIndexedClean(new THREE.ConeGeometry(1, 1, 10));
const PROTO_TAPER_POLE = ensureIndexedClean(new THREE.CylinderGeometry(0.65, 1.0, 1, 12));
const PROTO_TAPER_TRUNK = ensureIndexedClean(new THREE.CylinderGeometry(0.58, 1.0, 1, 10));
const PROTO_TAPER_LIMB = ensureIndexedClean(new THREE.CylinderGeometry(0.46, 1.0, 1, 7));
const PROTO_POT_BODY = ensureIndexedClean(new THREE.CylinderGeometry(1.0, 0.74, 1, 14));
const PROTO_SPHERE = ensureIndexedClean(new THREE.SphereGeometry(1, 16, 12));
const PROTO_BULB_CORE = ensureIndexedClean(new THREE.SphereGeometry(1, 10, 7));
const PROTO_BELL_CAP = ensureIndexedClean(new THREE.CylinderGeometry(0.28, 1.0, 1, 12));
const PROTO_WHEEL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14);
  g.rotateZ(Math.PI / 2);
  return ensureIndexedClean(g);
})();

/**
 * Smooth rotational chamfered tire + recessed alloy rim geometries oriented along ±X axle.
 */
function buildChamferedTireGeometry(segs = 20) {
  // Profile in (r, x) rotated around X axis: inner sidewall -> tread shoulder -> flat tread -> outer shoulder -> rim lip
  const profile = [
    [0.56, -0.46],
    [0.88, -0.50],
    [0.98, -0.40],
    [1.00, -0.22],
    [1.00, 0.22],
    [0.98, 0.40],
    [0.88, 0.50],
    [0.56, 0.46],
  ];
  const pos = [];
  const uv = [];
  const idx = [];
  const ringLen = profile.length;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = u * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j < ringLen; j++) {
      const [r, x] = profile[j];
      pos.push(x, r * ca, r * sa);
      uv.push(u, j / (ringLen - 1));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ringLen - 1; j++) {
      const a = i * ringLen + j;
      const b = (i + 1) * ringLen + j;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildAlloyRimGeometry(segs = 14) {
  // Recessed dish profile facing +X (mirror via negative/rotated placement on -X side)
  const profile = [
    [0.00, 0.34],
    [0.20, 0.38],
    [0.24, 0.28],
    [0.48, 0.32],
    [0.58, 0.44],
    [0.62, 0.42],
  ];
  const pos = [];
  const uv = [];
  const idx = [];
  const ringLen = profile.length;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = u * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j < ringLen; j++) {
      const [r, x] = profile[j];
      pos.push(x, r * ca, r * sa);
      uv.push(u, j / (ringLen - 1));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ringLen - 1; j++) {
      const a = i * ringLen + j;
      const b = (i + 1) * ringLen + j;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const PROTO_TIRE = buildChamferedTireGeometry(14);
const PROTO_ALLOY_RIM = buildAlloyRimGeometry(10);

/**
 * Botanical bouquet of curved 2x2-quad branchlet cards with outward-spherized normals.
 * Eliminates faceted Dodecahedron rock-balls while keeping triangle counts very low.
 */
function buildBotanicalCrownGeometry({
  cards = 24,
  radius = 1.0,
  heightScale = 0.92,
  cardSize = 0.88,
  pineMode = false,
  rosetteMode = false,
} = {}) {
  const pos = [];
  const norm = [];
  const uv = [];
  const idx = [];
  const golden = 2.39996323;
  const _uAxis = new THREE.Vector3();
  const _vAxis = new THREE.Vector3();
  const _nCard = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _pt = new THREE.Vector3();
  const _sph = new THREE.Vector3();

  for (let c = 0; c < cards; c++) {
    const frac = (c + 0.5) / cards;
    const az = c * golden;
    let polar;
    if (rosetteMode) {
      polar = 0.30 + frac * 1.05;
    } else if (pineMode) {
      polar = 0.42 + frac * 0.88;
    } else {
      polar = 0.22 + Math.pow(frac, 0.82) * 1.24;
    }

    const dirX = Math.sin(polar) * Math.cos(az);
    const dirY = Math.cos(polar);
    const dirZ = Math.sin(polar) * Math.sin(az);
    _vAxis.set(dirX, pineMode ? dirY * 0.45 + 0.18 : dirY * 0.85 + 0.24, dirZ).normalize();

    _uAxis.crossVectors(_up, _vAxis);
    if (_uAxis.lengthSq() < 1e-4) _uAxis.set(1, 0, 0);
    _uAxis.normalize();

    // Twist each branchlet card slightly around its growth axis so no cards align edge-on
    const twist = ((c % 5) - 2) * 0.21;
    const ct = Math.cos(twist);
    const st = Math.sin(twist);
    _nCard.crossVectors(_uAxis, _vAxis).normalize();
    const uTwisted = _uAxis.clone().multiplyScalar(ct).addScaledVector(_nCard, st).normalize();
    const nTwisted = _nCard.clone().multiplyScalar(ct).addScaledVector(_uAxis, -st).normalize();
    if (nTwisted.y < 0) nTwisted.negate();

    const anchorR = rosetteMode ? radius * 0.06 : radius * (pineMode ? 0.22 : 0.20);
    const ax = dirX * anchorR;
    const ay = (dirY * anchorR) * heightScale - (rosetteMode ? radius * 0.15 : 0);
    const azPos = dirZ * anchorR;

    const cW = cardSize * radius * (0.86 + ((c * 7) % 5) * 0.07);
    const cH = cardSize * radius * (pineMode ? 0.82 : 0.96);
    const baseVert = pos.length / 3;

    // 3x2 V-cambered vertex grid (2 quads = 4 tris/card) for 3D leaf-arch volume at half the triangle cost
    for (let iv = 0; iv <= 1; iv++) {
      const tv = iv; // 0 = twig base, 1 = outer leaf tip
      const droop = tv * (pineMode ? 0.10 : 0.15) * radius;
      for (let iu = 0; iu <= 2; iu++) {
        const tu = iu / 2;
        const su = (tu - 0.5) * cW;
        const camber = (1.0 - (tu - 0.5) * (tu - 0.5) * 4.0) * 0.13 * radius;
        _pt.set(ax, ay - droop, azPos)
          .addScaledVector(uTwisted, su)
          .addScaledVector(_vAxis, tv * cH)
          .addScaledVector(nTwisted, camber);

        pos.push(_pt.x, _pt.y, _pt.z);
        _sph.set(_pt.x, _pt.y + 0.18 * radius, _pt.z).normalize();
        _sph.lerp(nTwisted, 0.24).normalize();
        norm.push(_sph.x, _sph.y, _sph.z);
        uv.push(tu, tv);
      }
    }
    for (let iu = 0; iu < 2; iu++) {
      const a = baseVert + iu;
      const b = a + 1;
      const cVert = a + 4;
      const d = a + 3;
      idx.push(a, b, cVert, a, cVert, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const PROTO_LEAF_CROWN_RICH = buildBotanicalCrownGeometry({ cards: 20, radius: 1.0, cardSize: 0.94 });
const PROTO_LEAF_CROWN_LITE = buildBotanicalCrownGeometry({ cards: 8, radius: 1.0, cardSize: 1.06 });
const PROTO_PINE_CROWN_RICH = buildBotanicalCrownGeometry({ cards: 14, radius: 1.0, heightScale: 0.52, cardSize: 0.92, pineMode: true });
const PROTO_PINE_CROWN_LITE = buildBotanicalCrownGeometry({ cards: 7, radius: 1.0, heightScale: 0.52, cardSize: 1.04, pineMode: true });
const PROTO_SHRUB_ROSETTE = buildBotanicalCrownGeometry({ cards: 11, radius: 1.0, heightScale: 0.85, cardSize: 0.98, rosetteMode: true });
const PROTO_HEDGE_FRINGE = buildBotanicalCrownGeometry({ cards: 5, radius: 1.0, heightScale: 0.55, cardSize: 0.95, rosetteMode: true });

/**
 * Smooth corrugated Washi paper lantern shell (提灯火袋) with welded seam normals & 14 bamboo rib pleats.
 */
function buildChochinShellGeometry(segsU = 18, segsV = 14, ribs = 14) {
  const pos = [];
  const norm = [];
  const uv = [];
  const idx = [];

  const radiusAt = (v) => {
    const env = 0.42 + 0.58 * Math.pow(Math.sin(Math.PI * v), 0.68);
    const rib = 1.0 + 0.024 * Math.abs(Math.sin(v * ribs * Math.PI));
    return env * rib;
  };

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    const y = (v - 0.5) * 2.0; // [-1..+1]
    const r = radiusAt(v);
    const eps = 0.004;
    const drdv = (radiusAt(Math.min(1, v + eps)) - radiusAt(Math.max(0, v - eps))) / (2 * eps);
    // Tangent along v is (drdv*sin, 2.0, drdv*cos); outward normal radial/y ratio is (2.0, -drdv)
    const nrLen = Math.hypot(2.0, drdv);
    const nRad = 2.0 / nrLen;
    const nY = -drdv / nrLen;

    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      const a = -Math.PI + u * Math.PI * 2;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      pos.push(r * sa, y, r * ca);
      norm.push(nRad * sa, nY, nRad * ca);
      uv.push(u, v);
    }
  }

  const stride = segsU + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const p00 = iv * stride + iu;
      const p10 = p00 + 1;
      const p01 = p00 + stride;
      const p11 = p01 + 1;
      idx.push(p00, p10, p11, p00, p11, p01);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const PROTO_CHOCHIN_RICH = buildChochinShellGeometry(20, 28, 14);
const PROTO_CHOCHIN_LITE = buildChochinShellGeometry(12, 14, 7);

// Cleaned real 3D Japanese Kei-Car assets (`suzuki_alto_kei.glb` & `kei_tall_wagon.glb`)
// are loaded synchronously via `KEI_VEHICLE_PROTOS` from `./kei-vehicles.js`.

export function cloneTransformed(proto, matrix) {
  const g = proto.clone();
  g.applyMatrix4(matrix);
  return g;
}

export function tileBoxUV(geometry, w, h, d, tileW, tileH) {
  const uv = geometry.attributes.uv;
  const faces = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    const [fw, fh] = faces[face];
    for (let corner = 0; corner < 4; corner++) {
      const i = face * 4 + corner;
      uv.setXY(i, (uv.getX(i) * fw) / tileW, (uv.getY(i) * fh) / tileH);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

export function box(w, h, d, tileW = 0, tileH = 0) {
  if (tileW > 0 && tileH > 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    tileBoxUV(g, w, h, d, tileW, tileH);
    return ensureIndexedClean(g);
  }
  const g = PROTO_BOX.clone();
  g.scale(w, h, d);
  return g;
}

/**
 * Signboard box whose front (+Z) and back (-Z) broad faces map [0..1] UV un-mirrored,
 * while the 4 narrow edge faces (+X, -X, +Y, -Y) sample the solid border pixel [edgeU, edgeV].
 */
export function signBox(w, h, d, edgeU = 0.005, edgeV = 0.005) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let face = 0; face < 4; face++) {
    for (let corner = 0; corner < 4; corner++) {
      uv.setXY(face * 4 + corner, edgeU, edgeV);
    }
  }
  uv.needsUpdate = true;
  return ensureIndexedClean(g);
}

/**
 * Single-face signboard box where ONLY front (+Z) maps [0..1] UV (e.g. AC front grille, wall plaques),
 * while back and all 4 side edges sample the solid corner pixel [edgeU, edgeV].
 */
export function frontFaceBox(w, h, d, edgeU = 0.01, edgeV = 0.01) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z (front), 5:-Z (back)
  for (const face of [0, 1, 2, 3, 5]) {
    for (let corner = 0; corner < 4; corner++) {
      uv.setXY(face * 4 + corner, edgeU, edgeV);
    }
  }
  uv.needsUpdate = true;
  return ensureIndexedClean(g);
}

/**
 * Window glass pane box for single-quad 3D parallax Interior Mapping:
 * - Front (+Z) face encodes integer cell offsets [cellX, cellY] + inset [0.002..0.998] local UV
 *   so merged Bucket meshes retain a deterministic per-window room seed and exact aspect ratio,
 *   while avoiding floor()/fract() wrap seams at UV boundaries (and tiling cleanly with RepeatWrapping in GLB).
 * - Side/back rim faces sample the cell center and stay tucked behind the 3D window jambs.
 */
export function windowPaneBox(w, h, d, cellX = 0, cellY = 12) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z (front), 5:-Z (back)
  for (const face of [0, 1, 2, 3, 5]) {
    for (let corner = 0; corner < 4; corner++) {
      uv.setXY(face * 4 + corner, cellX + 0.5, cellY + 0.5);
    }
  }
  const base = 4 * 4;
  for (let corner = 0; corner < 4; corner++) {
    const u = uv.getX(base + corner);
    const v = uv.getY(base + corner);
    uv.setXY(
      base + corner,
      cellX + 0.002 + u * 0.996,
      cellY + 0.002 + v * 0.996,
    );
  }
  uv.needsUpdate = true;
  return ensureIndexedClean(g);
}

/**
 * Watertight curved cylindrical sheet-metal sleeve for utility pole plaques & safety wraps.
 * Centered at y = 0, spanning theta in [-arcAngle/2, +arcAngle/2] around +Z with thickness `thick`.
 */
export function curvedSleeveGeometry(rBot, rTop, height, arcAngle = 1.85, segs = 10, thick = 0.004) {
  const pos = [];
  const uv = [];
  const halfH = height * 0.5;
  const startA = -arcAngle * 0.5;

  const pushQuad = (p00, p10, p11, p01, u0, v0, u1, v1) => {
    pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  };

  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const a0 = startA + u0 * arcAngle;
    const a1 = startA + u1 * arcAngle;
    const s0 = Math.sin(a0), c0 = Math.cos(a0);
    const s1 = Math.sin(a1), c1 = Math.cos(a1);

    const ob0 = [(rBot + thick) * s0, -halfH, (rBot + thick) * c0];
    const ob1 = [(rBot + thick) * s1, -halfH, (rBot + thick) * c1];
    const ot1 = [(rTop + thick) * s1, halfH, (rTop + thick) * c1];
    const ot0 = [(rTop + thick) * s0, halfH, (rTop + thick) * c0];

    const ib0 = [rBot * s0, -halfH, rBot * c0];
    const ib1 = [rBot * s1, -halfH, rBot * c1];
    const it1 = [rTop * s1, halfH, rTop * c1];
    const it0 = [rTop * s0, halfH, rTop * c0];

    // Outer face (+radial normal): maps [0..1] cleanly left-to-right, bottom-to-top
    pushQuad(ob0, ob1, ot1, ot0, u0, 0, u1, 1);
    // Inner face (-radial normal): solid corner UV
    pushQuad(ib1, ib0, it0, it1, 0.01, 0.01, 0.01, 0.01);
    // Top & bottom thin rims
    pushQuad(ot0, ot1, it1, it0, 0.01, 0.01, 0.01, 0.01);
    pushQuad(ib0, ib1, ob1, ob0, 0.01, 0.01, 0.01, 0.01);

    if (i === 0) pushQuad(ib0, ob0, ot0, it0, 0.01, 0.01, 0.01, 0.01);
    if (i === segs - 1) pushQuad(ob1, ib1, it1, ot1, 0.01, 0.01, 0.01, 0.01);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Hanging Shotengai streetlamp cloth banner with subtle angled bottom trim & double-sided readable UVs.
 */
export function streetFlagGeometry(w = 0.46, h = 1.08, d = 0.014, slant = 0.07) {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;
  // Slight diagonal tail cut on bottom edge
  const yBL = -hh;
  const yBR = -hh + slant;
  const yTL = hh;
  const yTR = hh;

  const pos = [];
  const uv = [];
  const pushQuad = (a, b, c, dPt, u0, v0, u1, v1) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...dPt);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  };

  const fBL = [-hw, yBL, hd], fBR = [hw, yBR, hd], fTR = [hw, yTR, hd], fTL = [-hw, yTL, hd];
  const bBL = [-hw, yBL, -hd], bBR = [hw, yBR, -hd], bTR = [hw, yTR, -hd], bTL = [-hw, yTL, -hd];

  // Front (+Z) & Back (-Z) both map [0..1] un-mirrored from their own viewing side!
  pushQuad(fBL, fBR, fTR, fTL, 0, 0, 1, 1);
  pushQuad(bBR, bBL, bTL, bTR, 0, 0, 1, 1);
  // Thin fabric edges
  pushQuad(bBL, fBL, fTL, bTL, 0.02, 0.02, 0.02, 0.02);
  pushQuad(fBR, bBR, bTR, fTR, 0.02, 0.02, 0.02, 0.02);
  pushQuad(fTL, fTR, bTR, bTL, 0.02, 0.98, 0.02, 0.98);
  pushQuad(bBL, bBR, fBR, fBL, 0.02, 0.02, 0.02, 0.02);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Watertight triangular gable wall prism (妻壁):
 * Base x in [-w/2, +w/2] at y = 0, apex at (0, rise), extruded z in [-d/2, +d/2].
 */
export function gableWallGeometry(w, rise, d, tileW = 3.2, tileH = 2.9) {
  const hw = w / 2;
  const hd = d / 2;
  const pos = [];
  const uv = [];

  const pushTri = (a, b, c, uva, uvb, uvc) => {
    pos.push(...a, ...b, ...c);
    uv.push(...uva, ...uvb, ...uvc);
  };
  const pushQuad = (a, b, c, dPt, tw, th) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...dPt);
    uv.push(0, 0, tw, 0, tw, th, 0, 0, tw, th, 0, th);
  };

  pushTri(
    [-hw, 0, hd], [hw, 0, hd], [0, rise, hd],
    [0, 0], [w / tileW, 0], [hw / tileW, rise / tileH],
  );
  pushTri(
    [hw, 0, -hd], [-hw, 0, -hd], [0, rise, -hd],
    [0, 0], [w / tileW, 0], [hw / tileW, rise / tileH],
  );
  const slope = Math.hypot(hw, rise);
  pushQuad(
    [-hw, 0, -hd], [-hw, 0, hd], [0, rise, hd], [0, rise, -hd],
    d / tileW, slope / tileH,
  );
  pushQuad(
    [hw, 0, hd], [hw, 0, -hd], [0, rise, -hd], [0, rise, hd],
    d / tileW, slope / tileH,
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Watertight monoslope wedge wall prism (片流れ妻壁):
 * Rises linearly from y = 0 at x = -w/2 up to y = rise at x = +w/2, z in [-d/2, +d/2].
 */
export function wedgeWallGeometry(w, rise, d, tileW = 3.2, tileH = 2.9) {
  const hw = w / 2;
  const hd = d / 2;
  const pos = [];
  const uv = [];

  const pushTri = (a, b, c, uva, uvb, uvc) => {
    pos.push(...a, ...b, ...c);
    uv.push(...uva, ...uvb, ...uvc);
  };
  const pushQuad = (a, b, c, dPt, tw, th) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...dPt);
    uv.push(0, 0, tw, 0, tw, th, 0, 0, tw, th, 0, th);
  };

  pushTri(
    [-hw, 0, hd], [hw, 0, hd], [hw, rise, hd],
    [0, 0], [w / tileW, 0], [w / tileW, rise / tileH],
  );
  pushTri(
    [hw, 0, -hd], [-hw, 0, -hd], [hw, rise, -hd],
    [0, 0], [w / tileW, 0], [0, rise / tileH],
  );
  pushQuad(
    [hw, 0, hd], [hw, 0, -hd], [hw, rise, -hd], [hw, rise, hd],
    d / tileW, rise / tileH,
  );
  const slope = Math.hypot(w, rise);
  pushQuad(
    [-hw, 0, -hd], [-hw, 0, hd], [hw, rise, hd], [hw, rise, -hd],
    d / tileW, slope / tileH,
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Watertight Japanese hipped roof (寄棟屋根) with soffit & perimeter fascia skirt.
 */
export function hippedRoofGeometry(W, rise, D, fasciaH = 0.16, tileW = 2.2, tileH = 2.2) {
  const hw = W / 2;
  const hd = D / 2;
  const alongX = W >= D;
  const rx = alongX ? Math.max(0.25, (W - D) * 0.5) : 0;
  const rz = alongX ? 0 : Math.max(0.25, (D - W) * 0.5);

  const FL = [-hw, 0, hd];
  const FR = [hw, 0, hd];
  const BR = [hw, 0, -hd];
  const BL = [-hw, 0, -hd];

  const pos = [];
  const uv = [];

  const pushSlopeTri = (a, b, c) => {
    pos.push(...a, ...b, ...c);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const sl = Math.hypot(rise, Math.min(hw, hd));
    uv.push(0, 0, len / tileW, 0, (len * 0.5) / tileW, sl / tileH);
  };
  const pushSlopeTrap = (a, b, c, dPt, baseW, topW) => {
    const sl = Math.hypot(rise, Math.min(hw, hd));
    const inset = ((baseW - topW) * 0.5) / tileW;
    const uBase = baseW / tileW;
    const vTop = sl / tileH;
    pos.push(...a, ...b, ...c, ...a, ...c, ...dPt);
    uv.push(
      0, 0, uBase, 0, uBase - inset, vTop,
      0, 0, uBase - inset, vTop, inset, vTop,
    );
  };
  const pushQuad = (a, b, c, dPt, uSpan, vSpan) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...dPt);
    uv.push(0, 0, uSpan, 0, uSpan, vSpan, 0, 0, uSpan, vSpan, 0, vSpan);
  };

  if (alongX) {
    const R0 = [-rx, rise, 0];
    const R1 = [rx, rise, 0];
    pushSlopeTrap(FL, FR, R1, R0, W, rx * 2);
    pushSlopeTrap(BR, BL, R0, R1, W, rx * 2);
    pushSlopeTri(BL, FL, R0);
    pushSlopeTri(FR, BR, R1);
  } else {
    const R0 = [0, rise, rz];
    const R1 = [0, rise, -rz];
    pushSlopeTrap(BL, FL, R0, R1, D, rz * 2);
    pushSlopeTrap(FR, BR, R1, R0, D, rz * 2);
    pushSlopeTri(FL, FR, R0);
    pushSlopeTri(BR, BL, R1);
  }

  const FLb = [-hw, -fasciaH, hd];
  const FRb = [hw, -fasciaH, hd];
  const BRb = [hw, -fasciaH, -hd];
  const BLb = [-hw, -fasciaH, -hd];
  pushQuad(FLb, FRb, FR, FL, W / tileW, fasciaH / tileH);
  pushQuad(BRb, BLb, BL, BR, W / tileW, fasciaH / tileH);
  pushQuad(BLb, FLb, FL, BL, D / tileW, fasciaH / tileH);
  pushQuad(FRb, BRb, BR, FR, D / tileW, fasciaH / tileH);
  pushQuad(BLb, BRb, FRb, FLb, W / tileW, D / tileH);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Local coordinate helper for placing building parts on a rotated lot.
 * Local +Z always faces the fronting street; y = 0 is lot ground.
 */
export class LotContext {
  constructor(cx, cz, yaw = 0, baseY = 0) {
    this.cx = cx;
    this.cz = cz;
    this.yaw = yaw;
    this.baseY = baseY;
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _pos.set(cx, baseY, cz);
    this.worldMatrix = new THREE.Matrix4().compose(_pos, _quat, _one);
  }

  subContext(lx, lz, relYaw = 0, relY = 0) {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    return new LotContext(
      this.cx + lx * cos + lz * sin,
      this.cz - lx * sin + lz * cos,
      this.yaw + relYaw,
      this.baseY + relY,
    );
  }

  add(bucket, geometry, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0) {
    _euler.set(rx, ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _pos.set(lx, ly, lz);
    _localMat.compose(_pos, _quat, _one);
    _mat4.multiplyMatrices(this.worldMatrix, _localMat);
    geometry.applyMatrix4(_mat4);
    bucket.geometries.push(geometry);
  }

  addProto(bucket, proto, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _euler.set(rx, ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _pos.set(lx, ly, lz);
    _scale.set(sx, sy, sz);
    _localMat.compose(_pos, _quat, _scale);
    _mat4.multiplyMatrices(this.worldMatrix, _localMat);
    const g = proto.clone();
    g.applyMatrix4(_mat4);
    if (sx !== sy || sy !== sz || sx !== sz) g.computeVertexNormals();
    bucket.geometries.push(g);
  }

  addBox(bucket, w, h, d, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0) {
    _euler.set(rx, ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _pos.set(lx, ly, lz);
    _scale.set(w, h, d);
    _localMat.compose(_pos, _quat, _scale);
    _mat4.multiplyMatrices(this.worldMatrix, _localMat);
    const g = PROTO_BOX.clone();
    g.applyMatrix4(_mat4);
    if (rx !== 0 || ry !== 0 || rz !== 0 || w !== h || h !== d) g.computeVertexNormals();
    bucket.geometries.push(g);
  }

  /** Connects two 3D local points [x0,y0,z0] -> [x1,y1,z1] with a square bar of thickness `t`. */
  addStrut(bucket, a, b, t = 0.07) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const mz = (a[2] + b[2]) * 0.5;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    _quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    _pos.set(mx, my, mz);
    _scale.set(t, len, t);
    _localMat.compose(_pos, _quat, _scale);
    _mat4.multiplyMatrices(this.worldMatrix, _localMat);
    const g = PROTO_BOX.clone();
    g.applyMatrix4(_mat4);
    g.computeVertexNormals();
    bucket.geometries.push(g);
  }

  /** Connects two 3D local points [x0,y0,z0] -> [x1,y1,z1] with a smooth tapered cylindrical tree limb. */
  addLimb(bucket, a, b, rBase = 0.07) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const mz = (a[2] + b[2]) * 0.5;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    _quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    _pos.set(mx, my, mz);
    _scale.set(rBase, len, rBase);
    _localMat.compose(_pos, _quat, _scale);
    _mat4.multiplyMatrices(this.worldMatrix, _localMat);
    const g = PROTO_TAPER_LIMB.clone();
    g.applyMatrix4(_mat4);
    g.computeVertexNormals();
    bucket.geometries.push(g);
  }
}

// ------------------------------------------------------------------ ARCHITECTURAL MICRO-DETAILS (基礎巾木・雨樋・破風・窓・室外機)

/** Concrete foundation plinth (基礎巾木) + crawlspace vent slots around house perimeter. */
function addFoundationPlinth(lot, mats, { x = 0, z = 0, w, d, h = 0.24, y0 = 0.06, tier = 2 }) {
  lot.addBox(mats.concrete, w + 0.07, h, d + 0.07, x, y0 + h * 0.5, z);
  if (tier >= 2) {
    // Dark crawlspace vent grilles (基礎換気口) along front plinth
    const zFront = z + (d + 0.07) * 0.5 + 0.01;
    for (const dx of [-w * 0.28, w * 0.28]) {
      lot.addBox(mats.darkMetal, 0.38, 0.11, 0.02, x + dx, y0 + h * 0.52, zFront);
    }
  }
}

/**
 * Half-round eaves gutters (軒樋) + corner vertical PVC downspouts (竪樋) with wall brackets & elbow.
 */
function addEavesGutterAndDownspout(lot, mats, {
  x = 0, yEave, z = 0, w, d, overhang = 0.45, ridgeAxis = 'x', tier = 2,
  gutterMat = null,
}) {
  if (tier < 1) return;
  const gMat = gutterMat ?? mats.gutterMetal;
  const pipeR = 0.032;

  if (ridgeAxis === 'x') {
    const len = w + overhang * 2.02;
    for (const s of [-1, 1]) {
      const gz = z + s * (d * 0.5 + overhang + 0.03);
      // Horizontal eaves gutter trough
      lot.addBox(gMat, len, 0.075, 0.085, x, yEave - 0.04, gz);
    }
    if (tier >= 2) {
      // Corner vertical downspouts on street-facing (+Z) corners
      for (const sx of [-1, 1]) {
        const px = x + sx * (w * 0.5 - 0.08);
        const pzWall = z + d * 0.5 + 0.055;
        const pzGutter = z + d * 0.5 + overhang + 0.03;
        const dropTop = Math.max(0.6, yEave - 0.34);
        // Angled swan-neck elbow from eave gutter back to corner wall
        lot.addStrut(gMat, [px, yEave - 0.06, pzGutter], [px, dropTop, pzWall], 0.052);
        // Vertical downspout pipe down to ground plinth
        lot.addProto(gMat, PROTO_CYL8, px, dropTop * 0.5 + 0.06, pzWall, pipeR, dropTop - 0.04, pipeR);
        // Wall mounting clamp rings (竪樋控え金具)
        for (let by = 0.9; by < dropTop - 0.3; by += 1.45) {
          lot.addBox(mats.darkMetal, 0.08, 0.025, 0.07, px, by, pzWall - 0.02);
        }
      }
    }
  } else {
    const len = d + overhang * 2.02;
    for (const s of [-1, 1]) {
      const gx = x + s * (w * 0.5 + overhang + 0.03);
      lot.addBox(gMat, 0.085, 0.075, len, gx, yEave - 0.04, z);
    }
    if (tier >= 2) {
      const pz = z + d * 0.5 - 0.12;
      for (const sx of [-1, 1]) {
        const pxWall = x + sx * (w * 0.5 + 0.055);
        const pxGutter = x + sx * (w * 0.5 + overhang + 0.03);
        const dropTop = Math.max(0.6, yEave - 0.34);
        lot.addStrut(gMat, [pxGutter, yEave - 0.06, pz], [pxWall, dropTop, pz], 0.052);
        lot.addProto(gMat, PROTO_CYL8, pxWall, dropTop * 0.5 + 0.06, pz, pipeR, dropTop - 0.04, pipeR);
        for (let by = 0.9; by < dropTop - 0.3; by += 1.45) {
          lot.addBox(mats.darkMetal, 0.07, 0.025, 0.08, pxWall - sx * 0.02, by, pz);
        }
      }
    }
  }
}

/**
 * True 3D recessed architectural window assembly:
 * - Outer frame jambs (+6.5 cm proud of wall) cast real contact shadows across the glass
 * - Recessed glass/interior pane (+1.2 cm off wall so zero z-fighting at 500 m, recessed 5.3 cm behind jamb!)
 * - Protruding bottom drip sill (水切り +9.5 cm) & optional top roll-up shutter box (シャッターボックス +11.5 cm)
 * - Optional 3D wooden lattice cage (出格子) or multi-panel commercial mullions
 */
function addWindowAssembly(lot, mats, rnd, {
  x, y, z, w, h, rotY = 0,
  frameMat = null,
  style = 'sliding', // 'sliding' | 'commercial' | 'koshido' | 'slit'
  hasShutter = false,
  litProb = 0.52,
  preferOffice = false,
  rich = true,
}) {
  const sub = lot.subContext(x, z, rotY, y);
  const fMat = frameMat ?? mats.darkMetal;
  const ft = style === 'slit' ? 0.045 : 0.058;
  const jambDepth = 0.068;

  // Choose unlit reflective glass vs warm/cool lit room interior per window!
  let paneMat;
  if (rnd() < litProb) {
    if (preferOffice) {
      paneMat = rnd() < 0.52 ? mats.windowLitOffice : (rnd() < 0.65 ? mats.windowLitModern : mats.windowLitWarm);
    } else if (style === 'koshido') {
      paneMat = rnd() < 0.68 ? mats.windowLitAmber : mats.windowLitWarm;
    } else {
      const r = rnd();
      paneMat = r < 0.48 ? mats.windowLitWarm : (r < 0.78 ? mats.windowLitModern : (r < 0.92 ? mats.windowLitAmber : mats.windowLitOffice));
    }
  } else {
    paneMat = preferOffice ? mats.windowUnlitBlinds : mats.windowUnlit;
  }

  const paneW = w - ft * (rich ? 1.4 : 1.8);
  const paneH = h - ft * (rich ? 1.4 : 1.8);
  const cellX = Math.abs(Math.imul(Math.round(sub.cx * 19), 73856093) ^ Math.imul(Math.round(sub.cz * 23 + sub.baseY * 37), 19349663)) & 127;
  const cellY = Math.round(Math.min(Math.max(paneW / Math.max(paneH, 0.25), 0.4), 3.6) * 10);

  if (!rich) {
    sub.addBox(fMat, w, h, 0.032, 0, 0, 0.016);
    sub.add(paneMat, windowPaneBox(paneW, paneH, 0.016, cellX, cellY), 0, 0, 0.028);
    return;
  }

  // 1. Recessed glass pane (1.2 cm ahead of main wall box, 5.6 cm recessed inside outer jamb!)
  sub.add(paneMat, windowPaneBox(paneW, paneH, 0.016, cellX, cellY), 0, 0, 0.012);

  // 2. 4-sided protruding window casing / reveal jambs (サッシ枠)
  sub.addBox(fMat, w, ft, jambDepth, 0, h * 0.5 - ft * 0.5, jambDepth * 0.5);
  sub.addBox(fMat, w, ft, jambDepth, 0, -h * 0.5 + ft * 0.5, jambDepth * 0.5);
  sub.addBox(fMat, ft, h - ft * 2, jambDepth, -w * 0.5 + ft * 0.5, 0, jambDepth * 0.5);
  sub.addBox(fMat, ft, h - ft * 2, jambDepth, w * 0.5 - ft * 0.5, 0, jambDepth * 0.5);

  // 3. Bottom protruding drip sill (水切り)
  sub.addBox(mats.silverMetal, w + 0.08, 0.042, 0.095, 0, -h * 0.5 - 0.016, 0.048);

  // 4. Sash mullions / lattice bars
  if (style === 'commercial') {
    const bays = w >= 1.9 ? 3 : 2;
    for (let i = 1; i < bays; i++) {
      const mx = -w * 0.5 + (w * i) / bays;
      sub.addBox(fMat, 0.04, h - ft * 1.8, 0.038, mx, 0, 0.028);
    }
    sub.addBox(fMat, w - ft * 1.8, 0.038, 0.038, 0, h * 0.22, 0.028);
  } else if (style === 'koshido') {
    // Traditional protruding cedar wooden lattice (木製出格子)
    const bars = Math.max(5, Math.round(w / 0.16));
    const latticeMat = mats.woodWarm;
    sub.addBox(latticeMat, w + 0.04, 0.04, 0.085, 0, h * 0.5 - 0.02, 0.055);
    sub.addBox(latticeMat, w + 0.04, 0.04, 0.085, 0, -h * 0.5 + 0.02, 0.055);
    sub.addBox(latticeMat, w, 0.032, 0.075, 0, 0, 0.052);
    for (let i = 0; i <= bars; i++) {
      const bx = -w * 0.48 + (w * 0.96 * i) / bars;
      sub.addBox(latticeMat, 0.028, h - 0.04, 0.035, bx, 0, 0.082);
    }
  } else if (style === 'sliding') {
    // Center meeting stile + inner sash step
    sub.addBox(fMat, 0.042, h - ft * 1.8, 0.038, 0, 0, 0.03);
    if (w >= 1.55 && h >= 1.5) {
      // Lower balcony/garden safety rail bar across tall 1F/2F window
      sub.addBox(mats.silverMetal, w - 0.06, 0.03, 0.03, 0, -h * 0.18, 0.062);
    }
  }

  // 5. Overhead roll-up storm shutter box (シャッターボックス)
  if (hasShutter) {
    sub.addBox(fMat, w + 0.06, 0.165, 0.115, 0, h * 0.5 + 0.085, 0.058);
  }
}

/**
 * Complete Japanese AC outdoor unit + mounting bracket + vertical ivory refrigerant slim-duct + exhaust vent hood!
 */
function addAcWithDuct(lot, mats, {
  x, y, z, rotY = 0, wallMount = false, ductH = 1.65, ductSide = 1, withVentHood = true,
}) {
  const sub = lot.subContext(x, z, rotY, y);
  // Textured AC unit body (front +Z has fan grille, edges/top stay clean ivory!)
  sub.add(mats.acBody, frontFaceBox(0.80, 0.56, 0.30, 0.02, 0.02), 0, 0.28, 0.20);

  if (wallMount) {
    // L-shaped galvanized wall brackets underneath AC
    for (const bx of [-0.28, 0.28]) {
      sub.addBox(mats.darkMetal, 0.045, 0.34, 0.04, bx, 0.12, 0.02);
      sub.addBox(mats.darkMetal, 0.045, 0.04, 0.36, bx, -0.02, 0.19);
    }
  } else {
    // Concrete ground pad blocks (プラロック架台)
    for (const bx of [-0.26, 0.26]) {
      sub.addBox(mats.concrete, 0.12, 0.08, 0.34, bx, -0.04, 0.20);
    }
  }

  // Vertical ivory refrigerant pipe slim-duct (スリムダクト配管カバー) + wall-entry elbow cap
  const dx = ductSide * 0.46;
  sub.addBox(mats.acUnit, 0.072, ductH, 0.058, dx, 0.25 + ductH * 0.5, 0.032);
  sub.addBox(mats.acUnit, 0.11, 0.14, 0.088, dx, 0.25 + ductH + 0.04, 0.042);
  // Horizontal pipe run into AC valve port
  sub.addBox(mats.acUnit, 0.14, 0.06, 0.14, dx - ductSide * 0.05, 0.24, 0.09);

  // Stainless circular wall exhaust vent hood (ベントキャップ) nearby
  if (withVentHood) {
    sub.addProto(mats.silverMetal, PROTO_CYL12, -ductSide * 0.25, 0.35 + ductH * 0.82, 0.04, 0.095, 0.08, 0.095, Math.PI * 0.5, 0, 0);
  }
}

/** Wall-mounted residential gas meter + grey vertical supply pipes (ガスメーター). */
function addGasMeterAssembly(lot, mats, { x, z, rotY = 0 }) {
  const sub = lot.subContext(x, z, rotY, 0);
  sub.addBox(mats.acUnit, 0.26, 0.32, 0.18, 0, 1.32, 0.11);
  sub.addBox(mats.darkMetal, 0.16, 0.08, 0.04, 0, 1.38, 0.21);
  sub.addProto(mats.silverMetal, PROTO_CYL6, -0.07, 0.66, 0.08, 0.02, 1.24, 0.02);
  sub.addProto(mats.silverMetal, PROTO_CYL6, 0.07, 0.66, 0.08, 0.02, 1.24, 0.02);
}

// ------------------------------------------------------------------ ROOF ASSEMBLIES (WITH BARGEBOARDS, RIDGE TILES & GUTTERS)

function buildGabledRoof(lot, mats, {
  x = 0, y, z = 0, w, d, rise = 1.3, overhang = 0.48, ridgeAxis = 'x',
  roofBucket, wallBlankBucket, trimBucket, isKawara = true, tier = 2,
}) {
  const span = ridgeAxis === 'x' ? d : w;
  const length = ridgeAxis === 'x' ? w : d;
  const rotY = ridgeAxis === 'x' ? Math.PI / 2 : 0;

  lot.add(wallBlankBucket, gableWallGeometry(span, rise, length), x, y, z, 0, rotY, 0);

  const angle = Math.atan2(rise, span / 2);
  const halfOut = span / 2 + overhang;
  const slopeLen = halfOut / Math.cos(angle);
  const dropEave = overhang * Math.tan(angle);
  const dropCenter = (halfOut * 0.5) * Math.tan(angle);
  const cy = y + rise - dropCenter + 0.07;
  const lenOut = length + overhang * 2;

  if (ridgeAxis === 'z') {
    lot.add(roofBucket, box(slopeLen + 0.06, 0.13, lenOut, 1.8, 1.8), x - halfOut * 0.5, cy, z, 0, 0, angle);
    lot.add(roofBucket, box(slopeLen + 0.06, 0.13, lenOut, 1.8, 1.8), x + halfOut * 0.5, cy, z, 0, 0, -angle);
    // Tiered ridge cap (棟瓦) + end-cap鬼瓦 blocks
    const ridgeH = isKawara ? 0.22 : 0.13;
    lot.addBox(trimBucket, 0.28, ridgeH, lenOut + 0.06, x, y + rise + ridgeH * 0.5 + 0.06, z);
    if (isKawara && tier >= 1) {
      for (const sz of [-1, 1]) {
        lot.addBox(trimBucket, 0.34, 0.30, 0.16, x, y + rise + 0.16, z + sz * (lenOut * 0.5 + 0.04));
      }
    }
    // Sloped gable bargeboards (破風板) on front & back gable rakes
    if (tier >= 1) {
      for (const sz of [-1, 1]) {
        const rakeZ = z + sz * (lenOut * 0.5 - 0.04);
        lot.addBox(trimBucket, slopeLen + 0.08, 0.19, 0.08, x - halfOut * 0.5, cy - 0.02, rakeZ, 0, 0, angle);
        lot.addBox(trimBucket, slopeLen + 0.08, 0.19, 0.08, x + halfOut * 0.5, cy - 0.02, rakeZ, 0, 0, -angle);
      }
    }
  } else {
    lot.add(roofBucket, box(lenOut, 0.13, slopeLen + 0.06, 1.8, 1.8), x, cy, z + halfOut * 0.5, angle, 0, 0);
    lot.add(roofBucket, box(lenOut, 0.13, slopeLen + 0.06, 1.8, 1.8), x, cy, z - halfOut * 0.5, -angle, 0, 0);
    const ridgeH = isKawara ? 0.22 : 0.13;
    lot.addBox(trimBucket, lenOut + 0.06, ridgeH, 0.28, x, y + rise + ridgeH * 0.5 + 0.06, z);
    if (isKawara && tier >= 1) {
      for (const sx of [-1, 1]) {
        lot.addBox(trimBucket, 0.16, 0.30, 0.34, x + sx * (lenOut * 0.5 + 0.04), y + rise + 0.16, z);
      }
    }
    if (tier >= 1) {
      for (const sx of [-1, 1]) {
        const rakeX = x + sx * (lenOut * 0.5 - 0.04);
        lot.addBox(trimBucket, 0.08, 0.19, slopeLen + 0.08, rakeX, cy - 0.02, z + halfOut * 0.5, angle, 0, 0);
        lot.addBox(trimBucket, 0.08, 0.19, slopeLen + 0.08, rakeX, cy - 0.02, z - halfOut * 0.5, -angle, 0, 0);
      }
    }
  }

  addEavesGutterAndDownspout(lot, mats, {
    x, yEave: y - dropEave + 0.05, z, w, d, overhang, ridgeAxis, tier,
  });
}

function buildMonoslopeRoof(lot, mats, {
  x = 0, y, z = 0, w, d, rise = 1.15, overhang = 0.42, highSide = '+x',
  roofBucket, wallBlankBucket, solarBucket = null, tier = 2,
}) {
  const rotMap = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 };
  const rotY = rotMap[highSide] ?? 0;
  const alongX = highSide === '+x' || highSide === '-x';
  const span = alongX ? w : d;
  const length = alongX ? d : w;

  lot.add(wallBlankBucket, wedgeWallGeometry(span, rise, length), x, y, z, 0, rotY, 0);

  const angle = Math.atan2(rise, span);
  const totalSpan = span + overhang * 2;
  const slopeLen = totalSpan / Math.cos(angle);
  const lenOut = length + overhang * 1.8;
  const cy = y + rise * 0.5 + 0.08;

  if (highSide === '+x' || highSide === '-x') {
    const sgn = highSide === '+x' ? 1 : -1;
    lot.add(roofBucket, box(slopeLen, 0.14, lenOut, 1.6, 1.6), x, cy, z, 0, 0, sgn * angle);
    // Crisp dark metal fascia flashing trim around monoslope perimeter
    if (tier >= 1) {
      lot.addBox(mats.darkMetal, slopeLen + 0.04, 0.17, 0.07, x, cy, z + lenOut * 0.5, 0, 0, sgn * angle);
      lot.addBox(mats.darkMetal, slopeLen + 0.04, 0.17, 0.07, x, cy, z - lenOut * 0.5, 0, 0, sgn * angle);
      // Low-side eaves gutter + corner downspout
      const gx = x - sgn * (w * 0.5 + overhang + 0.03);
      const gy = y - overhang * Math.tan(angle);
      lot.addBox(mats.gutterMetal, 0.085, 0.075, lenOut, gx, gy, z);
      if (tier >= 2) {
        const pxWall = x - sgn * (w * 0.5 + 0.055);
        const pz = z + d * 0.5 - 0.14;
        lot.addStrut(mats.gutterMetal, [gx, gy - 0.02, pz], [pxWall, Math.max(0.6, gy - 0.3), pz], 0.05);
        lot.addProto(mats.gutterMetal, PROTO_CYL8, pxWall, Math.max(0.6, gy - 0.3) * 0.5 + 0.05, pz, 0.032, Math.max(0.5, gy - 0.34), 0.032);
      }
    }
    if (solarBucket) {
      lot.add(solarBucket, box(slopeLen * 0.68, 0.05, lenOut * 0.72, 1.6, 1.6), x + sgn * 0.1, cy + 0.1, z, 0, 0, sgn * angle);
    }
  } else {
    const sgn = highSide === '-z' ? 1 : -1;
    lot.add(roofBucket, box(lenOut, 0.14, slopeLen, 1.6, 1.6), x, cy, z, sgn * angle, 0, 0);
    if (tier >= 1) {
      lot.addBox(mats.darkMetal, 0.07, 0.17, slopeLen + 0.04, x + lenOut * 0.5, cy, z, sgn * angle, 0, 0);
      lot.addBox(mats.darkMetal, 0.07, 0.17, slopeLen + 0.04, x - lenOut * 0.5, cy, z, sgn * angle, 0, 0);
      const gz = z + sgn * (d * 0.5 + overhang + 0.03);
      const gy = y - overhang * Math.tan(angle);
      lot.addBox(mats.gutterMetal, lenOut, 0.075, 0.085, x, gy, gz);
    }
    if (solarBucket) {
      lot.add(solarBucket, box(lenOut * 0.72, 0.05, slopeLen * 0.68, 1.6, 1.6), x, cy + 0.1, z - sgn * 0.1, sgn * angle, 0, 0);
    }
  }
}

function buildLeanToEave(lot, mats, { x, y, z, w, depth = 1.15, drop = 0.28, roofBucket, withBrackets = true }) {
  const angle = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  lot.add(roofBucket, box(w, 0.09, len, 1.5, 1.5), x, y - drop * 0.5, z + depth * 0.5, angle, 0, 0);
  // Front fascia trim & rain gutter along lean-to eave (霧除け庇)
  lot.addBox(mats.woodDark, w + 0.04, 0.11, 0.06, x, y - drop - 0.01, z + depth);
  if (withBrackets) {
    for (const bx of [-w * 0.38, 0, w * 0.38]) {
      lot.addStrut(mats.woodDark, [x + bx, y - 0.42, z + 0.03], [x + bx, y - drop * 0.72, z + depth * 0.68], 0.055);
    }
  }
}

// ------------------------------------------------------------------ YARD, CARPORT, VEHICLES & BOTANICAL TREES

/**
 * Botanical Japanese garden & street tree (ケヤキ・モミジ・黒松):
 * - Root-flared tapered fissured-bark trunk + upward-sweeping forked limbs
 * - Overlapping alpha-cutout botanical leaf-cluster crowns with outward-spherized normals (zero faceted polyhedra!)
 */
export function addGardenTree(lot, mats, lx, lz, scale = 1.0, style = 'leafy', rich = true) {
  const foliage = style === 'autumn' ? mats.foliageWarm : (style === 'pine' ? mats.foliagePine : mats.foliageFresh);
  const yawSpin = ((Math.abs(Math.round(lx * 13 + lz * 29)) % 12) / 12) * Math.PI * 2;
  const sub = lot.subContext(lx, lz, yawSpin, 0);

  const forkY = (style === 'pine' ? 1.18 : 1.35) * scale;
  // Root-flared primary trunk with slight natural lean
  sub.addProto(mats.trunk, PROTO_TAPER_TRUNK, 0.02 * scale, forkY * 0.5, 0, 0.145 * scale, forkY + 0.08 * scale, 0.145 * scale, 0.035, 0, -0.03);

  if (style === 'pine') {
    // Sculpted Japanese garden Black Pine (庭木黒松: 玉散らし仕立 cloud-pruned pads on gnarled limbs)
    const crownProto = rich ? PROTO_PINE_CROWN_RICH : PROTO_PINE_CROWN_LITE;
    const pads = rich
      ? [
          { p: [-0.36 * scale, forkY + 0.42 * scale, 0.18 * scale], r: 0.72 * scale, ry: 0.4 },  // Lower-left cloud pad
          { p: [0.38 * scale, forkY + 0.66 * scale, -0.16 * scale], r: 0.66 * scale, ry: 2.1 },  // Mid-right cloud pad
          { p: [-0.08 * scale, forkY + 1.08 * scale, 0.04 * scale], r: 0.62 * scale, ry: 4.0 },  // Upper apex pad
        ]
      : [
          { p: [0, forkY + 0.58 * scale, 0], r: 0.92 * scale, ry: 0.8 },
        ];
    const forkOrigin = [0.02 * scale, forkY * 0.92, 0];
    for (const pad of pads) {
      sub.addLimb(mats.trunk, forkOrigin, [pad.p[0] * 0.92, pad.p[1] + 0.04 * scale, pad.p[2] * 0.92], 0.078 * scale);
      sub.addProto(foliage, crownProto, pad.p[0], pad.p[1], pad.p[2], pad.r, pad.r, pad.r, 0, pad.ry, 0);
    }
  } else {
    // Spreading Zelkova (ケヤキ) or Japanese Maple (イロハモミジ) with 4 forked limbs & layered botanical crowns
    const crownProto = rich ? PROTO_LEAF_CROWN_RICH : PROTO_LEAF_CROWN_LITE;
    const forkOrigin = [0.03 * scale, forkY * 0.92, 0];
    const clusters = rich
      ? [
          { p: [0.02 * scale, forkY + 1.12 * scale, 0.02 * scale], r: 0.82 * scale, ry: 0.2 },
          { p: [0.46 * scale, forkY + 0.64 * scale, 0.24 * scale], r: 0.68 * scale, ry: 1.9 },
          { p: [-0.44 * scale, forkY + 0.72 * scale, 0.18 * scale], r: 0.66 * scale, ry: 3.6 },
          { p: [-0.08 * scale, forkY + 0.68 * scale, -0.42 * scale], r: 0.64 * scale, ry: 5.1 },
        ]
      : [
          { p: [0, forkY + 0.82 * scale, 0], r: 1.02 * scale, ry: 0.5 },
        ];
    for (const cl of clusters) {
      sub.addLimb(mats.trunk, forkOrigin, [cl.p[0] * 0.88, cl.p[1] + 0.08 * scale, cl.p[2] * 0.88], 0.072 * scale);
      sub.addProto(foliage, crownProto, cl.p[0], cl.p[1], cl.p[2], cl.r, cl.r * 0.92, cl.r, 0, cl.ry, 0);
    }
  }
}

/**
 * Storefront Shigaraki/terracotta ceramic pot + soil + lush evergreen botanical shrub rosette (鉢植え).
 */
export function addPottedPlant(lot, mats, { x, z, scale = 1.0, yaw = 0 }) {
  const sub = lot.subContext(x, z, yaw, 0);
  const potH = 0.36 * scale;
  const potR = 0.20 * scale;
  // Tapered ceramic pot body + rolled lip rim + dark soil bed
  sub.addProto(mats.ceramicPot ?? mats.woodDark, PROTO_POT_BODY, 0, potH * 0.5, 0, potR, potH, potR);
  sub.addProto(mats.ceramicPot ?? mats.woodDark, PROTO_CYL12, 0, potH - 0.02 * scale, 0, potR * 1.08, 0.045 * scale, potR * 1.08);
  sub.addProto(mats.trunk, PROTO_CYL12, 0, potH - 0.03 * scale, 0, potR * 0.90, 0.025 * scale, potR * 0.90);
  // Multi-layered evergreen Nandina/Aralia botanical rosette
  const shrubMat = mats.foliageShrub ?? mats.foliageFresh;
  sub.addProto(shrubMat, PROTO_SHRUB_ROSETTE, 0, potH + 0.14 * scale, 0, 0.38 * scale, 0.42 * scale, 0.38 * scale, 0, 0.4, 0);
  sub.addProto(shrubMat, PROTO_HEDGE_FRINGE, 0, potH + 0.26 * scale, 0, 0.28 * scale, 0.30 * scale, 0.28 * scale, 0, 2.2, 0);
}

/**
 * Authentic Japanese Kei-Car (`軽自動車`: Suzuki Alto HA36S `3.395 x 1.475 x 1.495 m` & Tall Kei-Wagon
 * `3.395 x 1.475 x 1.725 m`) with Clearcoat coachwork, hollow RHD cabin, physical transmissive
 * safety glass, multi-layer faceted reflector headlamps + clear lenses, and yellow/black Kei plates.
 */
export function addKeiCar(lot, mats, lx, lz, yaw = 0, bodyBucket = null, isVan = false, withWheels = true, isDriving = false) {
  const carBody = bodyBucket ?? mats.carWhite;
  const proto = isVan ? KEI_VEHICLE_PROTOS.van : KEI_VEHICLE_PROTOS.alto;
  const sub = lot.subContext(lx, lz, yaw, 0);

  const headMat = isDriving ? (mats.carHeadlampOn ?? mats.warmLamp) : (mats.carHeadlampOff ?? mats.silverMetal);
  const tailMat = isDriving ? (mats.carTaillampOn ?? mats.accentRed) : (mats.carTaillampOff ?? mats.accentRed);

  sub.add(carBody, proto.body.clone(), 0, 0, 0);
  sub.add(mats.carGlass ?? mats.shopGlass, proto.glass.clone(), 0, 0, 0);
  sub.add(mats.carTrimBlack ?? mats.darkMetal, proto.trimBlack.clone(), 0, 0, 0);
  sub.add(mats.carUndercarriage ?? mats.darkMetal, proto.undercarriage.clone(), 0, 0, 0);
  sub.add(headMat, proto.headlamp.clone(), 0, 0, 0);
  sub.add(tailMat, proto.taillamp.clone(), 0, 0, 0);
  sub.add(mats.carTire ?? mats.darkMetal, proto.wheelTire.clone(), 0, 0, 0);

  if (withWheels) {
    sub.add(mats.carClearLens ?? mats.shopGlass, proto.clearLens.clone(), 0, 0, 0);
    sub.add(mats.silverMetal, proto.silver.clone(), 0, 0, 0);
    sub.add(mats.carAmber ?? mats.tactileYellow, proto.amber.clone(), 0, 0, 0);
    sub.add(mats.silverMetal, proto.wheelRim.clone(), 0, 0, 0);

    // Japanese Kei-Car (`軽自動車` 330 x 165 mm) yellow passenger / black commercial license plates
    const plateMat = (isVan && isDriving)
      ? (mats.keiPlateBlack ?? mats.vendWhite)
      : (mats.keiPlateYellow ?? mats.vendWhite);
    sub.addBox(mats.carTrimBlack ?? mats.darkMetal, 0.346, 0.178, 0.014, 0, 0.39, 1.694);
    sub.add(plateMat, frontFaceBox(0.33, 0.165, 0.016, 0.01, 0.01), 0, 0.39, 1.698);
    sub.addBox(mats.carTrimBlack ?? mats.darkMetal, 0.346, 0.178, 0.014, 0, 0.43, -1.698);
    sub.add(plateMat, frontFaceBox(0.33, 0.165, 0.016, 0.01, 0.01), 0, 0.43, -1.702, 0, Math.PI, 0);
  }
}

export function addBicycleCluster(lot, mats, lx, lz, count = 2, rotY = 0) {
  for (let i = 0; i < count; i++) {
    const sub = lot.subContext(lx + i * 0.64, lz, rotY + (i % 2 ? -0.08 : 0.06), 0);
    const rW = 0.31;
    // Slim pneumatic tires + silver alloy rims (no chunky solid blocks!)
    for (const wz of [-0.48, 0.48]) {
      sub.addProto(mats.carTire ?? mats.darkMetal, PROTO_TIRE, 0, rW, wz, 0.045, rW, rW);
      sub.addProto(mats.silverMetal, PROTO_CYL12, 0, rW, wz, 0.03, rW * 1.48, rW * 1.48, 0, 0, Math.PI * 0.5);
    }
    // Delicate step-through tubular mamachari steel frame
    sub.addStrut(mats.silverMetal, [0, rW, -0.48], [0, 0.68, -0.14], 0.026);
    sub.addStrut(mats.silverMetal, [0, 0.30, -0.05], [0, 0.78, -0.16], 0.028);
    sub.addStrut(mats.silverMetal, [0, 0.30, -0.05], [0, 0.74, 0.34], 0.030);
    sub.addStrut(mats.silverMetal, [0, rW, 0.48], [0, 0.90, 0.32], 0.026);
    // Saddle, front handlebars & compact wire basket
    sub.addBox(mats.darkMetal, 0.14, 0.05, 0.22, 0, 0.80, -0.18);
    sub.addBox(mats.silverMetal, 0.44, 0.026, 0.026, 0, 0.92, 0.31);
    sub.addBox(mats.darkMetal, 0.24, 0.18, 0.20, 0, 0.76, 0.43);
  }
}

function buildLotExterior(lot, mats, rnd, {
  lotW, lotD, drivewaySide = -1, hasCarport = false, hasCar = false,
  wallStyle = 'block', tier = 2,
}) {
  lot.addBox(mats.lotPad, lotW - 0.25, 0.06, lotD - 0.25, 0, 0.03, 0);

  const isHedge = wallStyle === 'hedge';
  const wallH = isHedge ? 1.04 : 1.18;
  const wallThick = isHedge ? 0.42 : 0.15;
  const perimBucket = isHedge ? mats.hedge : (wallStyle === 'wood' ? mats.woodDark : mats.blockWall);

  const wallBox = (w, h, d) => {
    if (wallStyle === 'block' && tier >= 1) return box(w, h, d, 1.6, 0.8);
    if (isHedge) return box(w, h, d, 1.15, 1.15);
    return box(w, h, d);
  };

  lot.add(perimBucket, wallBox(lotW - 0.3, wallH, wallThick), 0, wallH * 0.5, -lotD * 0.5 + 0.2);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), -lotW * 0.5 + 0.2, wallH * 0.5, 0);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), lotW * 0.5 - 0.2, wallH * 0.5, 0);

  const openW = hasCarport || hasCar ? 4.2 : 2.1;
  const wallLen = Math.max(1.0, lotW - openW - 0.55);
  const wallX = -drivewaySide * ((lotW - wallLen) * 0.5 - 0.2);
  const frontH = wallH * 0.88;
  const frontZ = lotD * 0.5 - 0.22;
  lot.add(perimBucket, wallBox(wallLen, frontH, wallThick), wallX, frontH * 0.5, frontZ);

  // Concrete coping cap (笠木) on block walls, or chamfered crown + organic leafy shoots on boxwood hedges!
  if (wallStyle === 'block' && tier >= 1) {
    lot.addBox(mats.concrete, wallLen + 0.04, 0.055, wallThick + 0.05, wallX, frontH + 0.025, frontZ);
  } else if (isHedge && tier >= 1) {
    lot.add(perimBucket, wallBox(wallLen - 0.08, 0.08, wallThick * 0.74), wallX, frontH + 0.03, frontZ);
    lot.add(perimBucket, wallBox(wallThick * 0.74, 0.08, lotD - 0.52), -lotW * 0.5 + 0.2, wallH + 0.03, 0);
    lot.add(perimBucket, wallBox(wallThick * 0.74, 0.08, lotD - 0.52), lotW * 0.5 - 0.2, wallH + 0.03, 0);
    if (tier >= 2 && mats.foliageShrub) {
      const shootCount = Math.max(2, Math.floor(wallLen / 1.15));
      for (let si = 0; si < shootCount; si++) {
        const sx = wallX - wallLen * 0.42 + (wallLen * 0.84 * si) / Math.max(1, shootCount - 1);
        lot.addProto(mats.foliageShrub, PROTO_HEDGE_FRINGE, sx, frontH + 0.02, frontZ, 0.30, 0.24, 0.30, 0, si * 1.7, 0);
      }
    }
  }

  if (tier === 0) return;

  if (tier >= 2) {
    // Japanese functional gatepost (機能門柱: intercom + nameplate + red/silver postbox + porch lamp)
    const gateX = drivewaySide * (lotW * 0.5 - openW - 0.15);
    const gateZ = lotD * 0.5 - 0.35;
    lot.addBox(mats.darkMetal, 0.24, 1.52, 0.11, gateX, 0.76, gateZ);
    lot.addBox(rnd() < 0.45 ? mats.accentRed : mats.silverMetal, 0.30, 0.26, 0.20, gateX, 1.12, gateZ + 0.07);
    lot.addBox(mats.warmLamp, 0.16, 0.07, 0.12, gateX, 1.54, gateZ + 0.02);
  }

  const carX = drivewaySide * (lotW * 0.5 - 1.62);
  const carZ = lotD * 0.5 - 2.68;
  if (hasCarport) {
    const sideEdge = drivewaySide * (lotW * 0.5 - 0.34);
    lot.addBox(mats.darkMetal, 0.11, 2.32, 0.11, sideEdge, 1.16, carZ - 1.45);
    lot.addBox(mats.darkMetal, 0.11, 2.32, 0.11, sideEdge, 1.16, carZ + 1.45);
    lot.addBox(mats.darkMetal, 2.68, 0.09, 0.09, carX, 2.28, carZ - 1.45, 0, 0, -drivewaySide * 0.05);
    lot.addBox(mats.darkMetal, 2.68, 0.09, 0.09, carX, 2.28, carZ + 1.45, 0, 0, -drivewaySide * 0.05);
    lot.addBox(mats.carportRoof, 2.68, 0.05, 4.65, carX, 2.35, carZ, 0, 0, -drivewaySide * 0.05);
  }
  if (hasCar) {
    const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
    addKeiCar(lot, mats, carX, carZ, 0, carMat, rnd() < 0.28, tier >= 2, false);
  }
}

function addGenkanAndBalcony(lot, mats, {
  gx, gz, balconyX, balconyY, balconyW, balconyZ, balconyStyle = 'louver', tier = 2,
}) {
  if (tier >= 1) {
    // Two-step tiled Genkan porch + recessed-frame insulated wooden front door + cantilever canopy
    lot.addBox(mats.concrete, 1.62, 0.16, 1.22, gx, 0.08, gz + 0.52);
    lot.addBox(mats.concrete, 1.42, 0.14, 0.85, gx, 0.22, gz + 0.36);
    lot.addBox(mats.darkMetal, 1.12, 2.22, 0.10, gx, 1.36, gz + 0.04);
    lot.addBox(mats.woodWarm, 0.96, 2.12, 0.08, gx, 1.34, gz + 0.07);
    // Vertical frosted glass vision slit in modern Japanese Genkan door
    lot.addBox(mats.frostedPanel, 0.11, 1.45, 0.09, gx + 0.22, 1.38, gz + 0.075);
    lot.addBox(mats.darkMetal, 1.74, 0.09, 1.05, gx, 2.58, gz + 0.48);
  }
  if (tier >= 2) {
    lot.addBox(mats.silverMetal, 0.05, 0.48, 0.06, gx + 0.36, 1.24, gz + 0.13);
    lot.addBox(mats.warmLamp, 0.14, 0.20, 0.12, gx + 0.68, 2.08, gz + 0.07);
    addAcWithDuct(lot, mats, {
      x: gx - 1.52, y: 0.14, z: gz + 0.02, rotY: 0, wallMount: false, ductH: 1.85,
    });
  }

  if (balconyW > 0) {
    const bd = 1.04;
    lot.addBox(mats.concrete, balconyW, 0.16, bd, balconyX, balconyY, balconyZ + bd * 0.5);
    const screenBucket = balconyStyle === 'wood' ? mats.woodWarm : (balconyStyle === 'frosted' ? mats.frostedPanel : mats.balconyWall);
    lot.addBox(screenBucket, balconyW, 1.08, 0.09, balconyX, balconyY + 0.59, balconyZ + bd - 0.045);
    if (tier >= 1) {
      lot.addBox(screenBucket, 0.09, 1.08, bd, balconyX - balconyW * 0.5 + 0.045, balconyY + 0.59, balconyZ + bd * 0.5);
      lot.addBox(screenBucket, 0.09, 1.08, bd, balconyX + balconyW * 0.5 - 0.045, balconyY + 0.59, balconyZ + bd * 0.5);
      // Aluminum top handrail coping (笠木手摺) + laundry pole brackets (物干し金具)!
      lot.addBox(mats.silverMetal, balconyW + 0.04, 0.055, 0.13, balconyX, balconyY + 1.15, balconyZ + bd - 0.045);
      if (tier >= 2) {
        lot.addProto(mats.silverMetal, PROTO_CYL6, balconyX, balconyY + 1.32, balconyZ + 0.62, 0.018, balconyW * 0.78, 0.018, 0, 0, Math.PI * 0.5);
      }
    }
  }
}

/** Populates authentic 3D recessed residential windows across front, back & side walls of an Ikkodate. */
function addIkkodateWindows(lot, mats, rnd, {
  x, z, w, d, twoStorey = true, woodFrame = false, style = 'sliding', gx = null, tier = 2,
}) {
  if (tier < 1) return;
  const rich = tier >= 2;
  const fMat = woodFrame ? mats.woodDark : mats.darkMetal;
  const zFront = z + d * 0.5;
  const zBack = z - d * 0.5;

  // 1F street-facing living room window (positioned away from Genkan door `gx`)
  const win1X = gx !== null ? (gx > x ? x - w * 0.24 : x + w * 0.24) : x - w * 0.2;
  if (w >= 3.2) {
    addWindowAssembly(lot, mats, rnd, {
      x: win1X, y: 1.56, z: zFront, w: Math.min(1.86, w * 0.42), h: 1.38,
      frameMat: fMat, style, hasShutter: style === 'sliding', litProb: 0.58, rich,
    });
  }

  if (twoStorey) {
    const offsets = w >= 4.6 ? [-w * 0.25, w * 0.25] : [0];
    for (const dx of offsets) {
      addWindowAssembly(lot, mats, rnd, {
        x: x + dx, y: 4.38, z: zFront, w: Math.min(1.56, w * 0.36), h: 1.18,
        frameMat: fMat, style, hasShutter: style === 'sliding' && rnd() < 0.65, litProb: 0.52, rich,
      });
    }
  }

  // Side & rear elevation 3D windows so side lanes and backyards read with full architectural depth!
  if (tier >= 2 && d >= 4.5) {
    for (const sx of [-1, 1]) {
      const sideX = x + sx * w * 0.5;
      const sideRot = sx * Math.PI * 0.5;
      addWindowAssembly(lot, mats, rnd, {
        x: sideX, y: 1.62, z: z + d * 0.14, w: 1.18, h: 0.92, rotY: sideRot,
        frameMat: fMat, style: style === 'koshido' ? 'koshido' : 'sliding', hasShutter: false, litProb: 0.45,
      });
      if (twoStorey) {
        addWindowAssembly(lot, mats, rnd, {
          x: sideX, y: 4.38, z: z - d * 0.16, w: 1.24, h: 1.04, rotY: sideRot,
          frameMat: fMat, style: 'sliding', hasShutter: false, litProb: 0.48,
        });
      }
    }
    if (twoStorey && w >= 4.4) {
      addWindowAssembly(lot, mats, rnd, {
        x: x - w * 0.2, y: 4.35, z: zBack, w: 1.38, h: 1.05, rotY: Math.PI,
        frameMat: fMat, style: 'sliding', hasShutter: false, litProb: 0.42,
      });
    }
  }
}

// ------------------------------------------------------------------ 6 IKKODATE ARCHETYPES (一戸建て)

export function buildKirizumaHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  buildLotExterior(lot, mats, rnd, {
    lotW, lotD, drivewaySide: driveSide,
    hasCarport: tier >= 1 && rnd() < 0.42, hasCar: tier >= 1 && rnd() < 0.5,
    wallStyle: rnd() < 0.55 ? 'block' : 'hedge', tier,
  });

  const paletteIdx = Math.floor(rnd() * mats.houseLightWalls.length);
  const wallMain = mats.houseLightWalls[paletteIdx];
  const wallBlank = mats.houseLightBlanks[paletteIdx];
  const roof = rnd() < 0.65 ? mats.kawaraDark : mats.kawaraBrown;

  const w = Math.min(lotW - 2.6, 6.4 + rnd() * 1.4);
  const d = Math.min(lotD - 4.2, 6.6 + rnd() * 1.4);
  const h = 5.75 + rnd() * 0.35;
  const hx = -driveSide * 0.65;
  const hz = -0.55;

  addFoundationPlinth(lot, mats, { x: hx, z: hz, w, d, tier });
  lot.add(wallMain, box(w, h, d, 3.2, 2.9), hx, 0.24 + h * 0.5, hz);
  // Subtle horizontal inter-storey belt trim (幕板)
  if (tier >= 1) {
    lot.addBox(mats.darkMetal, w + 0.06, 0.08, d + 0.06, hx, 3.12, hz);
  }
  buildGabledRoof(lot, mats, {
    x: hx, y: 0.24 + h, z: hz, w, d, rise: 1.38, overhang: 0.48,
    ridgeAxis: rnd() < 0.65 ? 'x' : 'z',
    roofBucket: roof, wallBlankBucket: wallBlank, trimBucket: mats.darkMetal, isKawara: true, tier,
  });

  const wingW = w * 0.58;
  const wingD = 1.65;
  const wingH = 2.95;
  const wingX = hx - driveSide * (w * 0.16);
  const wingZ = hz + d * 0.5 + wingD * 0.5 - 0.1;
  addFoundationPlinth(lot, mats, { x: wingX, z: wingZ, w: wingW, d: wingD, tier });
  lot.add(mats.woodAccentWall, box(wingW, wingH, wingD, 3.2, 2.9), wingX, 0.24 + wingH * 0.5, wingZ);
  buildLeanToEave(lot, mats, {
    x: wingX, y: 0.24 + wingH + 0.16, z: hz + d * 0.5 - 0.1,
    w: wingW + 0.5, depth: wingD + 0.45, drop: 0.40, roofBucket: roof,
  });

  const gx = hx + driveSide * (w * 0.26);
  addIkkodateWindows(lot, mats, rnd, { x: hx, z: hz, w, d, twoStorey: true, gx, tier });
  addWindowAssembly(lot, mats, rnd, {
    x: wingX, y: 1.62, z: wingZ + wingD * 0.5, w: Math.min(1.9, wingW * 0.62), h: 1.36,
    frameMat: mats.woodDark, style: 'sliding', hasShutter: true, litProb: 0.62,
  });

  addGenkanAndBalcony(lot, mats, {
    gx,
    gz: hz + d * 0.5,
    balconyX: wingX,
    balconyY: 3.32,
    balconyW: wingW * 0.92,
    balconyZ: hz + d * 0.5,
    balconyStyle: 'wood',
    tier,
  });

  if (tier >= 2) {
    addGasMeterAssembly(lot, mats, { x: hx + w * 0.5, z: hz - 0.8, rotY: Math.PI * 0.5 });
  }
  if (tier >= 1 || rnd() < 0.45) {
    addGardenTree(lot, mats, hx - driveSide * (w * 0.42), hz + d * 0.5 + 2.05, 0.85 + rnd() * 0.25, rnd() < 0.35 ? 'pine' : 'leafy', tier >= 2);
  }
}

export function buildKatanagareHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  buildLotExterior(lot, mats, rnd, {
    lotW, lotD, drivewaySide: driveSide,
    hasCarport: tier >= 1 && rnd() < 0.55, hasCar: tier >= 1 && rnd() < 0.58,
    wallStyle: 'block', tier,
  });

  const darkPrimary = rnd() < 0.58;
  const idx = Math.floor(rnd() * (darkPrimary ? mats.houseDarkWalls.length : mats.houseLightWalls.length));
  const wallMain = darkPrimary ? mats.houseDarkWalls[idx] : mats.houseLightWalls[idx];
  const wallBlank = darkPrimary ? mats.houseDarkBlanks[idx] : mats.houseLightBlanks[idx];
  const secondaryWall = darkPrimary ? mats.houseLightWalls[0] : mats.houseDarkWalls[0];
  const roof = rnd() < 0.55 ? mats.galvaCharcoal : mats.galvaNavy;

  const w = Math.min(lotW - 2.4, 6.2 + rnd() * 1.5);
  const d = Math.min(lotD - 4.0, 6.8 + rnd() * 1.4);
  const h = 5.85 + rnd() * 0.35;
  const hx = -driveSide * 0.55;
  const hz = -0.5;

  const wA = w * 0.62;
  const xA = hx - driveSide * (w * 0.18);
  addFoundationPlinth(lot, mats, { x: xA, z: hz, w: wA, d, tier });
  lot.add(wallMain, box(wA, h, d, 3.2, 2.95), xA, 0.24 + h * 0.5, hz);
  buildMonoslopeRoof(lot, mats, {
    x: xA, y: 0.24 + h, z: hz, w: wA, d, rise: 1.25, overhang: 0.4,
    highSide: driveSide > 0 ? '-x' : '+x',
    roofBucket: roof, wallBlankBucket: wallBlank,
    solarBucket: rnd() < 0.72 ? mats.solarRoof : null, tier,
  });
  addIkkodateWindows(lot, mats, rnd, { x: xA, z: hz, w: wA, d, twoStorey: true, tier });

  const wB = w * 0.48;
  const hB = h - 0.75;
  const xB = hx + driveSide * (w * 0.25);
  addFoundationPlinth(lot, mats, { x: xB, z: hz - 0.15, w: wB, d: d * 0.88, tier });
  lot.add(secondaryWall, box(wB, hB, d * 0.88, 3.2, 2.85), xB, 0.24 + hB * 0.5, hz - 0.15);
  lot.add(roof, box(wB + 0.4, 0.16, d * 0.88 + 0.4, 1.8, 1.8), xB, 0.24 + hB + 0.08, hz - 0.15);
  // Modern vertical slit window triplets on secondary wing!
  if (tier >= 1) {
    for (const dy of [4.1, 4.65]) {
      addWindowAssembly(lot, mats, rnd, {
        x: xB, y: dy, z: hz - 0.15 + d * 0.44, w: Math.min(1.5, wB * 0.65), h: 0.36,
        frameMat: mats.silverMetal, style: 'slit', hasShutter: false, litProb: 0.55,
      });
    }
  }
  lot.addBox(mats.woodWarm, 1.85, 2.75, 0.26, xB, 1.54, hz + d * 0.44 - 0.12);

  addGenkanAndBalcony(lot, mats, {
    gx: xB,
    gz: hz + d * 0.44,
    balconyX: xA,
    balconyY: 3.28,
    balconyW: wA * 0.82,
    balconyZ: hz + d * 0.5,
    balconyStyle: 'frosted',
    tier,
  });

  if (tier >= 1 && rnd() < 0.6) {
    addGardenTree(lot, mats, xA - driveSide * 1.1, hz + d * 0.5 + 1.65, 0.8, rnd() < 0.3 ? 'autumn' : 'leafy', tier >= 2);
  }
}

export function buildYosemuneHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  buildLotExterior(lot, mats, rnd, {
    lotW, lotD, drivewaySide: driveSide,
    hasCarport: tier >= 1 && rnd() < 0.48, hasCar: tier >= 1 && rnd() < 0.55,
    wallStyle: 'hedge', tier,
  });

  const w = Math.min(lotW - 2.5, 6.8 + rnd() * 1.6);
  const d = Math.min(lotD - 4.0, 6.6 + rnd() * 1.4);
  const h1 = 2.95;
  const h2 = 2.85;
  const hx = -driveSide * 0.45;
  const hz = -0.55;

  const lowerMat = mats.houseTileWalls[Math.floor(rnd() * mats.houseTileWalls.length)];
  const upperMat = mats.houseLightWalls[Math.floor(rnd() * mats.houseLightWalls.length)];
  const roof = rnd() < 0.5 ? mats.slateRoof : mats.kawaraBrown;

  addFoundationPlinth(lot, mats, { x: hx, z: hz, w, d, tier });
  lot.add(lowerMat, box(w, h1, d, 3.2, 2.95), hx, 0.24 + h1 * 0.5, hz);
  lot.addBox(mats.concrete, w + 0.14, 0.14, d + 0.14, hx, 0.24 + h1 + 0.02, hz);
  lot.add(upperMat, box(w - 0.12, h2, d - 0.12, 3.2, 2.85), hx, 0.24 + h1 + h2 * 0.5, hz);
  const roofY = 0.24 + h1 + h2 + 0.08;
  lot.add(roof, hippedRoofGeometry(w + 0.96, 1.45, d + 0.96, 0.16), hx, roofY, hz);
  addEavesGutterAndDownspout(lot, mats, {
    x: hx, yEave: roofY - 0.14, z: hz, w: w - 0.12, d: d - 0.12, overhang: 0.54, ridgeAxis: 'x', tier,
  });

  const gx = hx + driveSide * (w * 0.22);
  addIkkodateWindows(lot, mats, rnd, { x: hx, z: hz, w: w - 0.12, d: d - 0.12, twoStorey: true, gx, tier });

  addGenkanAndBalcony(lot, mats, {
    gx,
    gz: hz + d * 0.5,
    balconyX: hx - driveSide * 0.3,
    balconyY: 0.24 + h1 + 0.12,
    balconyW: w * 0.68,
    balconyZ: hz + d * 0.5 - 0.06,
    balconyStyle: 'louver',
    tier,
  });

  if (tier >= 1 || rnd() < 0.5) {
    addGardenTree(lot, mats, hx - driveSide * (w * 0.36), hz + d * 0.5 + 1.8, 0.9, 'leafy', tier >= 2);
  }
}

export function buildKyoshoHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  lot.addBox(mats.lotPad, lotW - 0.25, 0.06, lotD - 0.25, 0, 0.03, 0);

  const w = Math.min(lotW - 1.6, 5.2 + rnd() * 1.1);
  const d = Math.min(lotD - 2.6, 7.6 + rnd() * 1.4);
  const h1 = 2.85;
  const hUpper = 5.85;
  const hz = -0.2;

  const isDark = rnd() < 0.42;
  const wallList = isDark ? mats.houseDarkWalls : mats.houseLightWalls;
  const blankList = isDark ? mats.houseDarkBlanks : mats.houseLightBlanks;
  const p = Math.floor(rnd() * wallList.length);
  const wall = wallList[p];
  const wallBlank = blankList[p];
  const roof = rnd() < 0.5 ? mats.galvaCharcoal : mats.slateRoof;

  const w1 = w * 0.48;
  lot.add(wall, box(w1, h1, d, 3.0, 2.85), -driveSide * (w - w1) * 0.5, h1 * 0.5, hz);
  lot.add(wall, box(w, h1, d * 0.36, 3.0, 2.85), 0, h1 * 0.5, hz - d * 0.32);
  lot.addBox(mats.darkMetal, 0.24, h1, 0.24, driveSide * (w * 0.5 - 0.18), h1 * 0.5, hz + d * 0.5 - 0.2);

  if (tier >= 1 && rnd() < 0.72) {
    const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
    addKeiCar(lot, mats, driveSide * (w * 0.23), hz + d * 0.15, 0, carMat, false, tier >= 2);
  }

  lot.add(wall, box(w, hUpper, d, 3.0, 2.92), 0, h1 + hUpper * 0.5, hz);

  if (tier >= 1) {
    const zFront = hz + d * 0.5;
    for (const wy of [h1 + 1.45, h1 + 4.35]) {
      addWindowAssembly(lot, mats, rnd, {
        x: -w * 0.22, y: wy, z: zFront, w: 1.42, h: 1.24,
        frameMat: mats.darkMetal, style: 'sliding', hasShutter: wy < h1 + 2.5, litProb: 0.56,
      });
      addWindowAssembly(lot, mats, rnd, {
        x: w * 0.26, y: wy + 0.18, z: zFront, w: 0.72, h: 0.92,
        frameMat: mats.silverMetal, style: 'slit', hasShutter: false, litProb: 0.48,
      });
    }
  }

  if (rnd() < 0.55) {
    buildGabledRoof(lot, mats, {
      x: 0, y: h1 + hUpper, z: hz, w, d, rise: 1.25, overhang: 0.34,
      ridgeAxis: 'z', roofBucket: roof, wallBlankBucket: wallBlank, trimBucket: mats.darkMetal, isKawara: false, tier,
    });
  } else {
    buildMonoslopeRoof(lot, mats, {
      x: 0, y: h1 + hUpper, z: hz, w, d, rise: 1.05, overhang: 0.32,
      highSide: '-z', roofBucket: roof, wallBlankBucket: wallBlank, solarBucket: mats.solarRoof, tier,
    });
  }

  addGenkanAndBalcony(lot, mats, {
    gx: -driveSide * (w * 0.24),
    gz: hz + d * 0.5,
    balconyX: 0,
    balconyY: h1 + 0.1,
    balconyW: w * 0.82,
    balconyZ: hz + d * 0.5,
    balconyStyle: 'frosted',
    tier,
  });
  lot.addBox(mats.concrete, w * 0.82, 0.14, 0.88, 0, h1 + 2.95, hz + d * 0.5 + 0.44);
  lot.addBox(mats.frostedPanel, w * 0.82, 1.0, 0.08, 0, h1 + 3.48, hz + d * 0.5 + 0.84);
  lot.addBox(mats.silverMetal, w * 0.84, 0.05, 0.12, 0, h1 + 4.01, hz + d * 0.5 + 0.84);
  if (tier >= 2) {
    addBicycleCluster(lot, mats, -driveSide * (w * 0.42), hz + d * 0.5 + 0.9, 1, 0.3);
  }
}

export function buildMachiyaHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  buildLotExterior(lot, mats, rnd, {
    lotW, lotD, drivewaySide: driveSide,
    hasCarport: false, hasCar: tier >= 1 && rnd() < 0.3,
    wallStyle: 'wood', tier,
  });

  // Tile-capped courtyard wooden fence (塀瓦)
  lot.add(mats.kawaraDark, box(lotW * 0.52, 0.12, 0.42, 1.4, 1.4), -driveSide * (lotW * 0.22), 1.12, lotD * 0.5 - 0.22);

  const w = Math.min(lotW - 2.6, 7.2 + rnd() * 1.6);
  const d = Math.min(lotD - 4.4, 6.4 + rnd() * 1.2);
  const h1 = 2.85;
  const h2 = 2.65;
  const hz = -0.65;

  addFoundationPlinth(lot, mats, { x: 0, z: hz, w, d, h: 0.22, tier });
  lot.add(mats.washikiLower, box(w, h1, d, 3.2, 2.85), 0, 0.22 + h1 * 0.5, hz);
  lot.add(mats.shikkuiWall, box(w - 0.3, h2, d - 0.5, 3.2, 2.65), 0, 0.22 + h1 + h2 * 0.5, hz - 0.12);

  // Traditional wooden lattice windows (木製出格子・虫籠窓) on 1F & 2F!
  if (tier >= 1) {
    addWindowAssembly(lot, mats, rnd, {
      x: -driveSide * (w * 0.22), y: 1.56, z: hz + d * 0.5, w: 2.05, h: 1.38,
      frameMat: mats.woodDark, style: 'koshido', hasShutter: false, litProb: 0.62,
    });
    // Sliding hikido timber entrance door
    lot.addBox(mats.woodDark, 1.48, 2.15, 0.08, driveSide * (w * 0.24), 1.29, hz + d * 0.5 + 0.03);
    const doorSeed = Math.abs(Math.imul(Math.round(lot.cx * 17), 73856093) ^ Math.imul(Math.round(lot.cz * 29), 19349663)) & 127;
    lot.add(mats.windowLitAmber, windowPaneBox(1.26, 1.88, 0.04, doorSeed, 7), driveSide * (w * 0.24), 1.32, hz + d * 0.5 + 0.05);
    for (let kx = -0.52; kx <= 0.52; kx += 0.17) {
      lot.addBox(mats.woodWarm, 0.025, 1.9, 0.04, driveSide * (w * 0.24) + kx, 1.32, hz + d * 0.5 + 0.075);
    }
    // 2F Koshido shoji windows
    for (const dx of [-w * 0.24, w * 0.24]) {
      addWindowAssembly(lot, mats, rnd, {
        x: dx, y: 0.22 + h1 + 1.28, z: hz - 0.12 + (d - 0.5) * 0.5, w: 1.58, h: 1.05,
        frameMat: mats.woodDark, style: 'koshido', hasShutter: false, litProb: 0.52,
      });
    }
  }

  buildLeanToEave(lot, mats, {
    x: 0, y: 0.22 + h1 + 0.14, z: hz + d * 0.5 - 0.15,
    w: w + 0.75, depth: 1.18, drop: 0.34, roofBucket: mats.kawaraDark,
  });
  // Engawa veranda timber deck (縁側)
  lot.addBox(mats.woodWarm, w * 0.55, 0.32, 0.72, -driveSide * (w * 0.15), 0.18, hz + d * 0.5 + 0.36);

  buildGabledRoof(lot, mats, {
    x: 0, y: 0.22 + h1 + h2, z: hz - 0.12, w: w - 0.3, d: d - 0.5, rise: 1.52, overhang: 0.62,
    ridgeAxis: 'x',
    roofBucket: mats.kawaraDark, wallBlankBucket: mats.shikkuiBlank, trimBucket: mats.woodDark, isKawara: true, tier,
  });

  addGardenTree(lot, mats, -driveSide * (w * 0.28), hz + d * 0.5 + 1.75, 1.0, 'pine', tier >= 1);
  if (tier >= 2 && rnd() < 0.55) {
    addGardenTree(lot, mats, driveSide * (w * 0.34), hz + d * 0.5 + 1.85, 0.78, 'autumn', true);
  }
}

export function buildCourtyardHouse(lot, mats, rnd, { lotW, lotD, tier = 2 }) {
  const driveSide = rnd() < 0.5 ? -1 : 1;
  buildLotExterior(lot, mats, rnd, {
    lotW, lotD, drivewaySide: driveSide,
    hasCarport: tier >= 1 && rnd() < 0.42, hasCar: tier >= 1 && rnd() < 0.48,
    wallStyle: 'block', tier,
  });

  const w = Math.min(lotW - 2.4, 7.2 + rnd() * 1.4);
  const d = Math.min(lotD - 3.8, 7.0 + rnd() * 1.3);
  const h = 5.8;
  const hz = -0.4;

  const wallMain = mats.houseSlitWalls[Math.floor(rnd() * mats.houseSlitWalls.length)];
  const roof = rnd() < 0.5 ? mats.galvaCharcoal : mats.slateRoof;

  const backD = d * 0.54;
  const backZ = hz - d * 0.5 + backD * 0.5;
  addFoundationPlinth(lot, mats, { x: 0, z: backZ, w, d: backD, tier });
  lot.add(wallMain, box(w, h, backD, 3.2, 2.9), 0, 0.24 + h * 0.5, backZ);
  lot.add(roof, hippedRoofGeometry(w + 0.65, 1.15, backD + 0.65, 0.14), 0, 0.24 + h + 0.06, backZ);
  addEavesGutterAndDownspout(lot, mats, {
    x: 0, yEave: 0.24 + h - 0.08, z: backZ, w, d: backD, overhang: 0.36, ridgeAxis: 'x', tier,
  });

  const legW = w * 0.44;
  const legD = d * 0.48;
  const legH = 3.15;
  const legX = -driveSide * (w * 0.5 - legW * 0.5);
  const legZ = hz + d * 0.5 - legD * 0.5;
  addFoundationPlinth(lot, mats, { x: legX, z: legZ, w: legW, d: legD, tier });
  lot.add(mats.woodAccentWall, box(legW, legH, legD, 3.2, 3.15), legX, 0.24 + legH * 0.5, legZ);
  lot.add(roof, box(legW + 0.36, 0.16, legD + 0.36, 1.8, 1.8), legX, 0.24 + legH + 0.08, legZ);

  if (tier >= 1) {
    // Architectural slit windows on front wing + wide courtyard terrace glazing on main block!
    addWindowAssembly(lot, mats, rnd, {
      x: legX, y: 2.15, z: legZ + legD * 0.5, w: Math.min(2.1, legW * 0.72), h: 0.48,
      frameMat: mats.darkMetal, style: 'slit', hasShutter: false, litProb: 0.58,
    });
    const deckX = driveSide * (w * 0.18);
    addWindowAssembly(lot, mats, rnd, {
      x: deckX, y: 1.58, z: backZ + backD * 0.5, w: Math.min(2.2, w * 0.36), h: 1.85,
      frameMat: mats.darkMetal, style: 'sliding', hasShutter: true, litProb: 0.65,
    });
    for (const dx of [-w * 0.25, w * 0.25]) {
      addWindowAssembly(lot, mats, rnd, {
        x: dx, y: 4.42, z: backZ + backD * 0.5, w: 1.54, h: 1.12,
        frameMat: mats.darkMetal, style: 'sliding', hasShutter: false, litProb: 0.5,
      });
    }
  }

  const deckX = driveSide * (w * 0.14);
  lot.addBox(mats.woodWarm, w * 0.48, 0.24, legD * 0.82, deckX, 0.12, legZ - 0.1);
  addGardenTree(lot, mats, deckX + driveSide * 0.4, legZ + 0.4, 0.92, rnd() < 0.45 ? 'autumn' : 'leafy', tier >= 1);

  addGenkanAndBalcony(lot, mats, {
    gx: deckX - driveSide * 0.4,
    gz: backZ + backD * 0.5,
    balconyX: deckX,
    balconyY: 3.24,
    balconyW: w * 0.48,
    balconyZ: backZ + backD * 0.5,
    balconyStyle: 'wood',
    tier,
  });
}

const IKKODATE_BUILDERS = [
  buildKirizumaHouse,
  buildKatanagareHouse,
  buildYosemuneHouse,
  buildKyoshoHouse,
  buildMachiyaHouse,
  buildCourtyardHouse,
];

export function buildRandomIkkodate(lot, mats, rnd, opts) {
  const roll = rnd();
  let idx = 0;
  if (roll < 0.24) idx = 0;
  else if (roll < 0.48) idx = 1;
  else if (roll < 0.68) idx = 2;
  else if (roll < 0.80) idx = 3;
  else if (roll < 0.90) idx = 4;
  else idx = 5;
  IKKODATE_BUILDERS[idx](lot, mats, rnd, opts);
}

// ------------------------------------------------------------------ 5 COMMERCIAL / SHOTENGAI ARCHETYPES (小商圈・商店街)

/** Projecting vertical shop sleeve sign (袖看板) with 3D metallic perimeter bezel & bracket arms. */
export function addSleeveSign(lot, mats, signIdx, { x, y, z }) {
  const signBucket = mats.sleeveSigns[((signIdx % mats.sleeveSigns.length) + mats.sleeveSigns.length) % mats.sleeveSigns.length];
  const sw = 0.68;
  const sh = 2.18;
  const thick = 0.16;
  const sz = z + 0.24 + sw * 0.5;

  // Steel wall mounting brackets
  lot.addBox(mats.darkMetal, 0.06, 0.06, 0.36, x, y + sh * 0.35, z + 0.16);
  lot.addBox(mats.darkMetal, 0.06, 0.06, 0.36, x, y - sh * 0.35, z + 0.16);
  // 3D outer metal frame bezel around acrylic lightbox (prevents glowing edges!)
  lot.addBox(mats.darkMetal, thick + 0.03, 0.055, sw + 0.05, x, y + sh * 0.5 + 0.02, sz);
  lot.addBox(mats.darkMetal, thick + 0.03, 0.055, sw + 0.05, x, y - sh * 0.5 - 0.02, sz);
  lot.addBox(mats.darkMetal, thick + 0.03, sh, 0.05, x, y, sz - sw * 0.5 - 0.02);
  lot.addBox(mats.darkMetal, thick + 0.03, sh, 0.05, x, y, sz + sw * 0.5 + 0.02);
  lot.add(signBucket, signBox(sw, sh, thick), x, y, sz, 0, Math.PI / 2, 0);
}

/**
 * Dual-Layer Physical Japanese Paper Lantern Row (和紙提灯):
 * 1) Inner compact bright warm incandescent filament bulb (`chochinCore`) suspended at center
 * 2) Outer rough-transmissive corrugated Washi paper shell (`PROTO_CHOCHIN_*`) with bamboo ribs & sumi calligraphy
 * 3) Top & bottom black-lacquered wooden collars (`口輪`), gold trim rings, and iron hanging wire bail (`ツル`)
 */
export function addChochinRow(lot, mats, {
  x0, x1, y, z, count = 3, red = true, rich = true, seed = 0, tall = false,
}) {
  const pool = red ? (mats.lanternReds ?? [mats.lanternRed]) : (mats.lanternWarms ?? [mats.lanternWarm]);
  const useHeroShell = rich && Math.abs(lot.cx) < 96;
  const shellProto = useHeroShell ? PROTO_CHOCHIN_RICH : PROTO_CHOCHIN_LITE;
  const rx = tall ? 0.165 : 0.19;
  const ry = tall ? 0.285 : 0.245;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const lx = x0 + (x1 - x0) * t;
    const shellMat = pool[(seed + i) % pool.length];
    const slightYaw = ((i % 2 === 0 ? 1 : -1) * 0.18);

    // Hanging hook rod from wooden eave + top wire bail
    lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y + ry + 0.10, z, 0.009, 0.18, 0.009);
    if (rich) {
      lot.addBox(mats.darkMetal, rx * 0.92, 0.012, 0.012, lx, y + ry + 0.032, z, 0, slightYaw, 0);
    }

    // Inner hanging bulb socket stem + compact incandescent filament bulb core at lantern center!
    if (mats.chochinCore) {
      lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y + ry * 0.56, z, 0.014, ry * 0.52, 0.014);
      lot.addProto(mats.chochinCore, PROTO_BULB_CORE, lx, y + 0.015, z, 0.056, 0.082, 0.056);
    }

    // Outer corrugated translucent Washi paper shell
    lot.addProto(shellMat, shellProto, lx, y, z, rx, ry, rx, 0, slightYaw, 0);

    // Top & bottom black-lacquered wooden collars (口輪・重化) + thin gold trim bands
    const rimRTop = rx * 0.48;
    const rimRBot = rx * 0.45;
    lot.addProto(mats.darkMetal, PROTO_CYL12, lx, y + ry + 0.012, z, rimRTop, 0.042, rimRTop);
    lot.addProto(mats.darkMetal, PROTO_CYL12, lx, y - ry - 0.012, z, rimRBot, 0.042, rimRBot);
    if (rich) {
      lot.addProto(mats.archGoldTrim, PROTO_CYL12, lx, y + ry - 0.008, z, rimRTop * 1.03, 0.012, rimRTop * 1.03);
      lot.addProto(mats.archGoldTrim, PROTO_CYL12, lx, y - ry + 0.008, z, rimRBot * 1.03, 0.012, rimRBot * 1.03);
      lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y - ry - 0.046, z, 0.022, 0.036, 0.022);
    }
  }
}

/** 4-panel fluttering fabric Noren curtain (暖簾) hung on a cedar bamboo rod (のれん棒). */
function addMultiPanelNoren(lot, mats, norenSet, { x, y, z, totalW = 2.6, panelH = 0.76 }) {
  const panels = norenSet.length;
  const rodW = totalW + 0.22;
  // Cedar hanging rod + metal hooks
  lot.addProto(mats.woodWarm, PROTO_CYL6, x, y + panelH * 0.5 + 0.02, z, 0.022, rodW, 0.022, 0, 0, Math.PI * 0.5);
  const gap = 0.04;
  const pw = (totalW - gap * (panels - 1)) / panels;
  const angles = [-0.075, 0.045, -0.035, 0.085];
  for (let i = 0; i < panels; i++) {
    const px = x - totalW * 0.5 + pw * 0.5 + i * (pw + gap);
    const tilt = angles[i % angles.length];
    const dz = Math.sin(tilt) * panelH * 0.5;
    lot.add(norenSet[i], signBox(pw, panelH, 0.016), px, y, z + dz, tilt, 0, 0);
  }
}

/** Sidewalk A-frame hinged wooden chalkboard menu stand (A型立看板). */
function addMenuBoardStand(lot, mats, { x, z, yaw = -0.2 }) {
  const sub = lot.subContext(x, z, yaw, 0);
  sub.addBox(mats.woodWarm, 0.52, 0.88, 0.04, 0, 0.44, 0.13, -0.18, 0, 0);
  sub.addBox(mats.woodWarm, 0.52, 0.88, 0.04, 0, 0.44, -0.13, 0.18, 0, 0);
  sub.addBox(mats.darkMetal, 0.42, 0.64, 0.02, 0, 0.48, 0.155, -0.18, 0, 0);
  sub.addBox(mats.darkMetal, 0.42, 0.64, 0.02, 0, 0.48, -0.155, 0.18, 0, 0);
}

/** Stacked Japanese plastic beverage/beer crates (ビールケース) beside Izakaya/Ramen storefronts. */
function addBeerCrateStack(lot, mats, { x, z, count = 2, blue = true }) {
  const crateMat = blue ? mats.vendBlue : mats.vendRed;
  for (let i = 0; i < count; i++) {
    const rot = (i % 2) * 0.08;
    lot.addBox(crateMat, 0.44, 0.30, 0.36, x, 0.15 + i * 0.305, z, 0, rot, 0);
    lot.addBox(mats.darkMetal, 0.36, 0.03, 0.28, x, 0.29 + i * 0.305, z, 0, rot, 0);
  }
}

/**
 * Builds crisp 3D storefront mullions, wainscoting, wooden koushi lattice, and a single
 * outward-facing clear architectural glass plane (zero double-glass backfaces!).
 */
function addShop3DFacade(lot, mats, {
  w, h, x = 0, yBot = 0.14, z = 0, rotY = 0, shopKind = 'kissaten',
}) {
  const sub = lot.subContext(x, z, rotY, yBot);
  const bayCount = Math.max(1, Math.round(w / (shopKind === 'konbini' ? 3.2 : 3.1)));
  const bayW = w / bayCount;

  // Single outward-facing (+Z) clear glass pane sitting cleanly inside the 3D framing
  sub.add(mats.shopGlass, new THREE.PlaneGeometry(Math.max(0.4, w - 0.06), Math.max(0.4, h - 0.06)), 0, h * 0.5, 0);

  if (shopKind === 'konbini') {
    const frame = mats.silverMetal;
    const kickH = 0.18;
    sub.addBox(mats.darkMetal, w, kickH, 0.08, 0, kickH * 0.5, 0.01);
    sub.addBox(frame, w, 0.10, 0.09, 0, h - 0.05, 0.01);
    sub.addBox(frame, w, 0.055, 0.08, 0, h - 0.52, 0.01);
    for (let i = 0; i <= bayCount; i++) {
      const mx = -w * 0.5 + i * bayW;
      sub.addBox(frame, i === 0 || i === bayCount ? 0.09 : 0.07, h, 0.09, mx, h * 0.5, 0.01);
      if (i < bayCount) {
        sub.addBox(frame, 0.055, h - kickH - 0.10, 0.08, mx + bayW * 0.5, kickH + (h - kickH - 0.10) * 0.5, 0.01);
      }
    }
    return;
  }

  if (shopKind === 'izakaya' || shopKind === 'ramen') {
    const wood = mats.woodDark;
    const wainscot = mats.shop3dWoodDark;
    const baseH = 0.12;
    const wainH = Math.min(0.96, h * 0.34);
    sub.addBox(mats.concrete, w, baseH, 0.10, 0, baseH * 0.5, 0.01);
    sub.addBox(wood, w, 0.11, 0.10, 0, h - 0.055, 0.01);

    for (let i = 0; i < bayCount; i++) {
      const x0 = -w * 0.5 + i * bayW;
      const x1 = x0 + bayW;
      const splitX = x0 + bayW * 0.46;
      sub.addBox(wood, 0.09, h, 0.10, x0 + 0.045, h * 0.5, 0.01);
      if (i === bayCount - 1) sub.addBox(wood, 0.09, h, 0.10, x1 - 0.045, h * 0.5, 0.01);
      sub.addBox(wood, 0.08, h, 0.10, splitX, h * 0.5, 0.01);

      // Left sliding hikido door with 3D wooden koushi lattice (木格子)
      const doorW = Math.max(0.4, splitX - x0 - 0.10);
      const doorCx = (x0 + splitX) * 0.5;
      const doorH = h - baseH - 0.11;
      const doorCy = baseH + doorH * 0.5;
      const vSlats = Math.max(3, Math.round(doorW / 0.24));
      for (let s = 1; s < vSlats; s++) {
        const sx = x0 + 0.05 + (doorW * s) / vSlats;
        sub.addBox(wood, 0.030, doorH, 0.04, sx, doorCy, 0.025);
      }
      const hRails = 5;
      for (let r = 1; r < hRails; r++) {
        const ry = baseH + (doorH * r) / hRails;
        sub.addBox(wood, doorW, 0.028, 0.04, doorCx, ry, 0.025);
      }

      // Right counter window above cedar wainscoting (腰壁)
      const winW = Math.max(0.4, x1 - splitX - 0.10);
      const winCx = (splitX + x1) * 0.5;
      sub.addBox(wainscot, winW + 0.04, wainH, 0.09, winCx, baseH + wainH * 0.5, 0.01);
      sub.addBox(wood, winW + 0.06, 0.05, 0.11, winCx, baseH + wainH, 0.015);
      const upperH = Math.max(0.4, h - baseH - wainH - 0.11);
      const upperCy = baseH + wainH + upperH * 0.5;
      const wSlats = Math.max(3, Math.round(winW / 0.28));
      for (let s = 1; s < wSlats; s++) {
        const sx = splitX + 0.04 + (winW * s) / wSlats;
        sub.addBox(wood, 0.030, upperH, 0.04, sx, upperCy, 0.025);
      }
      sub.addBox(wood, winW, 0.030, 0.04, winCx, upperCy, 0.025);
    }
    return;
  }

  // Kissaten / Bookstore / Pharmacy architectural framed display window + glazed door
  const frame = shopKind === 'pharmacy' ? mats.silverMetal : mats.woodDark;
  const wainscot = shopKind === 'pharmacy'
    ? mats.concrete
    : (shopKind === 'bookstore' ? mats.shop3dWoodWarm : mats.shop3dWoodDark);
  const kickH = 0.12;
  const wainH = Math.min(0.72, h * 0.25);
  sub.addBox(mats.darkMetal, w, kickH, 0.09, 0, kickH * 0.5, 0.01);
  sub.addBox(frame, w, 0.10, 0.09, 0, h - 0.05, 0.01);
  sub.addBox(frame, w, 0.055, 0.08, 0, h - 0.48, 0.01);

  for (let i = 0; i < bayCount; i++) {
    const x0 = -w * 0.5 + i * bayW;
    const x1 = x0 + bayW;
    const splitX = x0 + bayW * 0.64;
    sub.addBox(frame, 0.085, h, 0.09, x0 + 0.042, h * 0.5, 0.01);
    if (i === bayCount - 1) sub.addBox(frame, 0.085, h, 0.09, x1 - 0.042, h * 0.5, 0.01);
    sub.addBox(frame, 0.075, h, 0.09, splitX, h * 0.5, 0.01);

    // Display window wainscoting + central mullion
    const dispW = Math.max(0.4, splitX - x0 - 0.08);
    const dispCx = (x0 + splitX) * 0.5;
    sub.addBox(wainscot, dispW + 0.04, wainH, 0.085, dispCx, kickH + wainH * 0.5, 0.01);
    sub.addBox(frame, dispW + 0.06, 0.045, 0.10, dispCx, kickH + wainH, 0.015);
    sub.addBox(frame, 0.048, h - kickH - wainH - 0.10, 0.075, dispCx, kickH + wainH + (h - kickH - wainH - 0.10) * 0.5, 0.01);

    // Glazed entrance door mid-rail & vertical handle
    const doorW = Math.max(0.35, x1 - splitX - 0.08);
    const doorCx = (splitX + x1) * 0.5;
    sub.addBox(frame, doorW, 0.055, 0.08, doorCx, 1.02, 0.01);
    sub.addBox(mats.archGoldTrim, 0.03, 0.28, 0.04, splitX + 0.12, 1.05, 0.06);
  }
}

/**
 * Builds a true 3D recessed ground-floor shop room (walls, ceiling, floor, counters/booths/shelves,
 * colorful goods, and physical 3D light fixtures) directly inside the shared street geometry so Web,
 * ThreeRT, and Blender Cycles all render the exact same 3D interiors!
 */
function addShop3DInterior(lot, mats, rnd, {
  w, h, depth, maxHalfW, x = 0, yBot = 0.14, zFront = 0, shopKind = 'kissaten', openRightSide = false,
}) {
  const hw = Math.min(w * 0.5 + 0.14, maxHalfW);
  const yTop = yBot + h;
  const dStart = 0.04;
  const wallT = 0.08;

  // Helper placing a box in local room coordinates: u in [-hw, hw], v in [0, h], d in [0, depth] into -Z
  const roomBox = (bucket, u0, u1, v0, v1, d0, d1) => {
    const bx = Math.abs(u1 - u0);
    const by = Math.abs(v1 - v0);
    const bz = Math.abs(d1 - d0);
    if (bx < 1e-4 || by < 1e-4 || bz < 1e-4) return;
    lot.addBox(
      bucket,
      bx, by, bz,
      x + (u0 + u1) * 0.5,
      yBot + (v0 + v1) * 0.5,
      zFront - (d0 + d1) * 0.5,
    );
  };

  let wallM, ceilM, floorM, lampM, woodM, accentM;
  if (shopKind === 'kissaten') {
    wallM = mats.shop3dPlasterWarm;
    ceilM = mats.shop3dCeilWood;
    floorM = mats.shop3dFloorDark;
    lampM = mats.shop3dLampWarm;
    woodM = mats.shop3dWoodDark;
    accentM = mats.shop3dWoodWarm;
  } else if (shopKind === 'bookstore') {
    wallM = mats.shop3dPlasterCream;
    ceilM = mats.shop3dCeilWhite;
    floorM = mats.shop3dWoodWarm;
    lampM = mats.shop3dLampWarm;
    woodM = mats.shop3dWoodDark;
    accentM = mats.shop3dWoodWarm;
  } else if (shopKind === 'konbini' || shopKind === 'pharmacy') {
    wallM = mats.shop3dPlasterCool;
    ceilM = mats.shop3dCeilWhite;
    floorM = mats.shop3dFloorLight;
    lampM = mats.shop3dLampCool;
    woodM = mats.shop3dPlasterCool;
    accentM = mats.shop3dCoolerGlow;
  } else {
    wallM = mats.shop3dPlasterWarm;
    ceilM = mats.shop3dCeilWood;
    floorM = mats.shop3dFloorDark;
    lampM = mats.shop3dLampAmber;
    woodM = mats.shop3dWoodDark;
    accentM = mats.shop3dWoodWarm;
  }

  // 1. Enclosed room interior shell (thin manifold slabs tucked inside building exterior walls)
  roomBox(wallM, -hw, hw, 0, h, depth, depth + wallT); // back wall
  roomBox(wallM, -hw - wallT, -hw, 0, h, dStart, depth + wallT); // left wall
  if (!openRightSide) {
    roomBox(wallM, hw, hw + wallT, 0, h, dStart, depth + wallT); // right wall
  }
  roomBox(ceilM, -hw - wallT, hw + wallT, h, h + wallT, dStart, depth + wallT); // ceiling
  roomBox(floorM, -hw - wallT, hw + wallT, -wallT, 0, dStart, depth + wallT); // floor

  const goodsMats = [mats.shop3dGoodsRed, mats.shop3dGoodsBlue, mats.shop3dGoodsOchre, mats.shop3dGoodsGreen];
  const nBays = Math.max(1, Math.round(w / 2.5));

  // 2. Shop-specific 3D furniture, merchandise & hanging physical light fixtures
  if (shopKind === 'kissaten') {
    roomBox(woodM, -hw + 0.02, hw - 0.02, 0, 1.08, depth - 0.75, depth - 0.04);
    roomBox(accentM, -hw + 0.02, hw - 0.02, 1.08, 1.15, depth - 0.82, depth - 0.04);
    roomBox(woodM, -hw, -hw + 0.08, 0, 1.25, dStart, depth);
    if (!openRightSide) roomBox(woodM, hw - 0.08, hw, 0, 1.25, dStart, depth);
    // Warm backbar light strip + bottle shelves
    if (h > 2.65) {
      roomBox(lampM, -hw * 0.78, hw * 0.78, 2.38, 2.46, depth - 0.28, depth - 0.14);
    }
    for (const sy of [1.30, 1.68, 2.04]) {
      if (sy < h - 0.28) {
        roomBox(woodM, -hw * 0.82, hw * 0.82, sy, sy + 0.05, depth - 0.34, depth - 0.04);
        for (let gx = 0; gx < 7; gx++) {
          const uG = -hw * 0.74 + (hw * 1.48) * (gx + 0.5) / 7;
          const gm = goodsMats[(gx + Math.round(sy * 10)) % goodsMats.length];
          roomBox(gm, uG - 0.11, uG + 0.11, sy + 0.05, sy + 0.30, depth - 0.28, depth - 0.08);
        }
      }
    }
    // Hanging 3D spherical glass pendant globes (visible below exterior awnings!) + tall café booths
    const lampDrop = Math.min(1.18, h * 0.38);
    for (let i = 0; i < nBays; i++) {
      const ux = -w * 0.5 + (i + 0.5) * (w / nBays);
      for (const ld of [0.92, depth * 0.62]) {
        roomBox(mats.shop3dMetalDark, ux - 0.022, ux + 0.022, h - lampDrop + 0.12, h, ld - 0.022, ld + 0.022);
        lot.addProto(lampM, PROTO_BULB_CORE, x + ux, yTop - lampDrop, zFront - ld, 0.145, 0.145, 0.145);
      }
      roomBox(accentM, ux - 0.48, ux + 0.48, 0.78, 0.85, 0.78, 1.55);
      roomBox(mats.shop3dMetalDark, ux - 0.08, ux + 0.08, 0, 0.78, 1.08, 1.24);
      roomBox(woodM, ux - 0.72, ux - 0.52, 0, 1.36, 0.82, 1.50);
      roomBox(woodM, ux + 0.52, ux + 0.72, 0, 1.36, 0.82, 1.50);
    }
  } else if (shopKind === 'bookstore') {
    for (const sy of [0.45, 0.90, 1.35, 1.80, 2.25]) {
      if (sy < h - 0.28) {
        roomBox(woodM, -hw + 0.06, hw - 0.06, sy, sy + 0.04, depth - 0.36, depth - 0.04);
        for (let gx = 0; gx < 7; gx++) {
          const uG = -hw * 0.82 + (hw * 1.64) * (gx + 0.5) / 7;
          const gm = goodsMats[(gx + Math.round(sy * 7)) % goodsMats.length];
          roomBox(gm, uG - 0.17, uG + 0.17, sy + 0.04, sy + 0.36, depth - 0.30, depth - 0.06);
        }
      }
    }
    roomBox(accentM, -w * 0.36, w * 0.36, 0, 1.05, 0.92, 1.85);
    roomBox(mats.shop3dMenuPlaque, -w * 0.32, w * 0.32, 1.05, 1.24, 0.98, 1.78);
    for (let i = 0; i < nBays; i++) {
      const ux = -w * 0.5 + (i + 0.5) * (w / nBays);
      roomBox(lampM, ux - 0.14, ux + 0.14, h - 0.95, h - 0.85, 0.65, depth - 0.45);
    }
  } else if (shopKind === 'konbini' || shopKind === 'pharmacy') {
    const nStrips = Math.max(2, nBays + 1);
    for (let i = 0; i < nStrips; i++) {
      const ux = -w * 0.44 + (w * 0.88) * i / Math.max(1, nStrips - 1);
      roomBox(lampM, ux - 0.12, ux + 0.12, h - 0.09, h - 0.01, 0.35, depth - 0.35);
    }
    roomBox(accentM, -hw * 0.86, hw * 0.86, 0.25, Math.max(1.2, h - 0.38), depth - 0.28, depth - 0.05);
    for (let i = 0; i < nBays; i++) {
      const ux = -w * 0.5 + (i + 0.5) * (w / nBays);
      roomBox(woodM, ux - 0.48, ux + 0.48, 0, 1.52, 0.95, 1.65);
      const shelfYs = [0.55, 0.98, 1.40];
      for (let sIdx = 0; sIdx < shelfYs.length; sIdx++) {
        const sy = shelfYs[sIdx];
        const gm = goodsMats[(i + sIdx) % goodsMats.length];
        roomBox(gm, ux - 0.44, ux + 0.44, sy, sy + 0.28, 0.88, 1.72);
      }
    }
  } else {
    // Izakaya / Ramen: warm wooden counter, bar stools, hanging amber lanterns & tanzaku menu plaques
    roomBox(accentM, -hw + 0.06, hw - 0.06, 0, 1.10, depth - 1.18, depth - 0.55);
    const nPlq = Math.max(5, Math.floor(w * 2.4));
    for (let k = 0; k < nPlq; k++) {
      const ux = -hw * 0.84 + (hw * 1.68) * (k + 0.5) / nPlq;
      roomBox(mats.shop3dMenuPlaque, ux - 0.075, ux + 0.075, h - 1.25, h - 0.58, depth - 0.09, depth - 0.04);
    }
    const nStools = Math.max(2, nBays * 2);
    for (let i = 0; i < nStools; i++) {
      const ux = -w * 0.42 + (w * 0.84) * (i + 0.5) / nStools;
      roomBox(woodM, ux - 0.16, ux + 0.16, 0, 0.88, depth - 1.68, depth - 1.36);
    }
    for (let i = 0; i < nBays; i++) {
      const ux = -w * 0.5 + (i + 0.5) * (w / nBays);
      for (const ld of [0.85, depth - 0.95]) {
        roomBox(mats.shop3dMetalDark, ux - 0.016, ux + 0.016, h - 1.02, h, ld - 0.016, ld + 0.016);
        roomBox(lampM, ux - 0.13, ux + 0.13, h - 1.32, h - 1.00, ld - 0.13, ld + 0.13);
      }
    }
  }
}

/**
 * Builds a hollow 1F exterior shell (back, left, right walls, and top lintel/slab) so the ground floor
 * encloses a real 3D shop interior cleanly from every street/alley angle with zero solid-wall occlusion.
 */
function addHollow1FShell(lot, wallBucket, {
  bw, h1, bd, bz = 0, wallT = 0.20, openRightWindow = null,
}) {
  const frontZ = bz + bd * 0.5;
  const backZ = bz - bd * 0.5;
  // Back wall
  lot.add(wallBucket, box(bw, h1, wallT, 3.0, h1), 0, h1 * 0.5, backZ + wallT * 0.5);
  // Left exterior wall
  lot.add(wallBucket, box(wallT, h1, bd, 3.0, h1), -bw * 0.5 + wallT * 0.5, h1 * 0.5, bz);
  // Right exterior wall (optionally split around a corner return storefront window!)
  if (!openRightWindow) {
    lot.add(wallBucket, box(wallT, h1, bd, 3.0, h1), bw * 0.5 - wallT * 0.5, h1 * 0.5, bz);
  } else {
    const { zCenter, width, yBot, yTop } = openRightWindow;
    const zMin = zCenter - width * 0.5;
    const zMax = zCenter + width * 0.5;
    const rearLen = zMin - backZ;
    const frontLen = frontZ - zMax;
    if (rearLen > 0.08) {
      lot.add(wallBucket, box(wallT, h1, rearLen, 3.0, h1), bw * 0.5 - wallT * 0.5, h1 * 0.5, backZ + rearLen * 0.5);
    }
    if (frontLen > 0.08) {
      lot.add(wallBucket, box(wallT, h1, frontLen, 3.0, h1), bw * 0.5 - wallT * 0.5, h1 * 0.5, zMax + frontLen * 0.5);
    }
    if (yTop < h1 - 0.05) {
      const topH = h1 - yTop;
      lot.add(wallBucket, box(wallT, topH, width, 3.0, topH), bw * 0.5 - wallT * 0.5, yTop + topH * 0.5, zCenter);
    }
    if (yBot > 0.05) {
      lot.add(wallBucket, box(wallT, yBot, width, 3.0, yBot), bw * 0.5 - wallT * 0.5, yBot * 0.5, zCenter);
    }
  }
  // Upper front lintel header & floor-separator ceiling slab at top of 1F
  lot.add(wallBucket, box(bw, 0.48, 0.36, 3.0, 0.48), 0, h1 - 0.24, frontZ - 0.18);
  lot.add(wallBucket, box(bw - wallT, 0.16, bd - wallT, 3.0, 3.0), 0, h1 - 0.08, bz);
}

/**
 * Builds a recessed ground-floor commercial shopfront bay (`recess = 0.32 m`) with corner pilasters,
 * 3D mullions/koushi lattice + clear architectural glass, real 3D furnished shop interior behind it,
 * granite threshold, overhead roll-up shutter box, soffit downlights, and clamped 3D fascia signboard!
 */
function addRecessedStorefront(lot, mats, rnd, {
  bw, h1, frontZ, pierMat, shopKind = 'kissaten', fasciaBucket, shutterMat = null, withFascia = true,
  roomDepth = 3.4, openRightSide = false,
}) {
  const pierW = 0.38;
  const recess = 0.32;
  const innerW = Math.max(1.8, bw - pierW * 2);
  const bayCount = Math.max(1, Math.round(innerW / 3.1));
  const bayTileW = innerW / bayCount;
  const bayH = h1 - 0.62;
  const zGlass = frontZ - recess;

  // Left & right structural facade pilasters (柱)
  lot.add(pierMat, box(pierW, h1, recess + 0.18, 1.2, 2.8), -bw * 0.5 + pierW * 0.5, h1 * 0.5, frontZ - recess * 0.5);
  lot.add(pierMat, box(pierW, h1, recess + 0.18, 1.2, 2.8), bw * 0.5 - pierW * 0.5, h1 * 0.5, frontZ - recess * 0.5);

  // Real 3D storefront framing + clear architectural glass + furnished 3D shop interior
  addShop3DFacade(lot, mats, { w: innerW, h: bayH, x: 0, yBot: 0.14, z: zGlass, shopKind });
  addShop3DInterior(lot, mats, rnd, {
    w: innerW, h: bayH, depth: roomDepth, maxHalfW: bw * 0.5 - 0.22,
    x: 0, yBot: 0.14, zFront: zGlass, shopKind, openRightSide,
  });

  // Granite threshold step (沓石) & overhead alcove soffit ceiling + warm entrance downlights
  lot.addBox(mats.concrete, innerW + 0.08, 0.14, recess + 0.16, 0, 0.07, frontZ - recess * 0.5 + 0.04);
  lot.addBox(mats.concrete, innerW, 0.16, recess + 0.12, 0, h1 - 0.42, frontZ - recess * 0.5);
  for (let i = 0; i < bayCount; i++) {
    const lx = -innerW * 0.5 + (i + 0.5) * bayTileW;
    lot.addProto(mats.warmLamp, PROTO_CYL8, lx, h1 - 0.51, frontZ - recess * 0.45, 0.07, 0.025, 0.07);
  }

  // Roll-up steel shutter box (シャッターボックス) tucked under the lintel
  lot.addBox(shutterMat ?? mats.silverMetal, innerW, 0.22, 0.18, 0, h1 - 0.52, frontZ - 0.08);

  // Protruding 3D framed horizontal fascia signboard (看板) with clamped [0..1] shop title!
  if (withFascia && fasciaBucket) {
    const signW = Math.min(bw - 0.36, 5.4);
    const signH = 0.78;
    const signY = h1 - 0.06;
    lot.addBox(mats.darkMetal, signW + 0.08, signH + 0.08, 0.16, 0, signY, frontZ + 0.08);
    lot.add(fasciaBucket, signBox(signW, signH, 0.18), 0, signY, frontZ + 0.10);
  }
}

export function buildKonbini(lot, mats, rnd, { w = 13.5, d = 11.5, twoStorey = false, detail = true }) {
  lot.addBox(mats.asphaltApron, w + 1.4, 0.08, d + 2.0, 0, 0.04, 0.4);

  const isLawson = rnd() < 0.5;
  const bw = w - 1.8;
  const bd = d - 4.4;
  const bz = -1.65;
  const h1 = 3.95;
  const frontZ = bz + bd * 0.5;
  const bayW = bw - 0.9;
  const bayH = 2.95;
  const sideW = bd * 0.58;
  const sideZ = bz + bd * 0.12;

  // Hollow 1F exterior shell opening to BOTH front plate-glass bay & +X corner return window!
  addHollow1FShell(lot, mats.commUpperLight, {
    bw, h1, bd, bz, wallT: 0.20,
    openRightWindow: { zCenter: sideZ, width: sideW, yBot: 0.12, yTop: 0.12 + bayH },
  });
  // Front corner piers + upper fascia wall above the 2.95 m glass band
  lot.add(mats.commUpperLight, box(0.45, h1, 0.36, 1.0, h1), -bw * 0.5 + 0.225, h1 * 0.5, frontZ - 0.18);
  lot.add(mats.commUpperLight, box(0.45, h1, 0.36, 1.0, h1), bw * 0.5 - 0.225, h1 * 0.5, frontZ - 0.18);
  lot.add(mats.commUpperLight, box(bayW, h1 - (0.12 + bayH), 0.36, 3.0, 1.0), 0, (0.12 + bayH + h1) * 0.5, frontZ - 0.18);

  // Real 3D Konbini plate-glass front & corner return window + bright 3D interior room!
  addShop3DFacade(lot, mats, { w: bayW, h: bayH, x: 0, yBot: 0.12, z: frontZ - 0.16, shopKind: 'konbini' });
  addShop3DFacade(lot, mats, { w: sideW, h: bayH, x: bw * 0.5 - 0.10, yBot: 0.12, z: sideZ, rotY: Math.PI * 0.5, shopKind: 'konbini' });
  addShop3DInterior(lot, mats, rnd, {
    w: bayW, h: bayH, depth: Math.min(bd - 0.65, 4.2), maxHalfW: bw * 0.5 - 0.22,
    x: 0, yBot: 0.12, zFront: frontZ - 0.16, shopKind: 'konbini', openRightSide: true,
  });
  lot.addBox(mats.concrete, bw + 0.12, 0.14, 0.45, 0, 0.07, frontZ);

  // Iconic overhanging multi-stripe Konbini fascia canopy with silver aluminum trim!
  const fasciaMat = isLawson ? mats.konbiniFasciaLawson : mats.konbiniFasciaFamima;
  lot.addBox(mats.silverMetal, bw + 0.52, 0.98, bd + 0.46, 0, h1 - 0.46, bz + 0.06);
  lot.add(fasciaMat, box(bw + 0.56, 0.86, 0.16, 4.2, 0.86), 0, h1 - 0.46, frontZ + 0.22);
  lot.add(fasciaMat, box(0.16, 0.86, bd * 0.76, 4.2, 0.86), bw * 0.5 + 0.22, h1 - 0.46, bz + bd * 0.12);

  let topY = h1;
  if (twoStorey) {
    const h2 = 3.25;
    lot.add(mats.commUpperLight, box(bw, h2, bd, 3.0, 3.25), 0, h1 + h2 * 0.5, bz);
    const cols = Math.max(2, Math.floor((bw - 1.2) / 2.8));
    for (let c = 0; c < cols; c++) {
      const wx = -((cols - 1) * 2.75) * 0.5 + c * 2.75;
      addWindowAssembly(lot, mats, rnd, {
        x: wx, y: h1 + 1.68, z: frontZ, w: 2.1, h: 1.42,
        frameMat: mats.darkMetal, style: 'commercial', preferOffice: true, litProb: 0.62,
      });
    }
    topY += h2;
  }

  lot.addBox(mats.roofConcrete, bw + 0.3, 0.28, bd + 0.3, 0, topY + 0.14, bz);
  addAcWithDuct(lot, mats, { x: -bw * 0.25, y: topY + 0.28, z: bz - 0.8, ductH: 0.4, withVentHood: false });

  // Framed roadside Konbini pylon sign (ポール看板)
  const poleX = bw * 0.5 + 0.38;
  const poleZ = d * 0.5 - 0.58;
  lot.addProto(mats.concrete, PROTO_CYL8, poleX, 0.22, poleZ, 0.28, 0.44, 0.28);
  lot.addProto(mats.silverMetal, PROTO_CYL12, poleX, 3.35, poleZ, 0.14, 6.7, 0.14);
  const pylonBucket = isLawson ? mats.konbiniPylonLawson : mats.konbiniPylonFamima;
  const pyW = 1.28;
  const pyH = 1.62;
  lot.addBox(mats.silverMetal, pyW + 0.10, 0.08, 0.30, poleX - 0.72, 6.0 + pyH * 0.5 + 0.03, poleZ);
  lot.addBox(mats.silverMetal, pyW + 0.10, 0.08, 0.30, poleX - 0.72, 6.0 - pyH * 0.5 - 0.03, poleZ);
  lot.addBox(mats.silverMetal, 0.24, 0.10, 0.10, poleX - 0.1, 6.45, poleZ);
  lot.addBox(mats.silverMetal, 0.24, 0.10, 0.10, poleX - 0.1, 5.55, poleZ);
  lot.add(pylonBucket, signBox(pyW, pyH, 0.24), poleX - 0.72, 6.0, poleZ);

  if (detail) {
    // Stainless steel parking bollards + recycle bins + painted parking stalls + backed-in Kei-car/van
    for (let bx = -bw * 0.38; bx <= bw * 0.08; bx += 1.65) {
      lot.addProto(mats.silverMetal, PROTO_CYL8, bx, 0.39, frontZ + 0.58, 0.06, 0.78, 0.06);
    }
    for (let gi = 0; gi < 3; gi++) {
      lot.addBox(mats.acUnit, 0.38, 0.76, 0.36, -bw * 0.38 + gi * 0.42, 0.38, frontZ + 0.08);
      lot.addBox(gi === 0 ? mats.vendBlue : mats.darkMetal, 0.36, 0.12, 0.34, -bw * 0.38 + gi * 0.42, 0.80, frontZ + 0.08);
    }
    // Painted white parking stall lines (白線駐車枠) & concrete wheel stops (車止め)
    const stallW = 2.35;
    const stallBaseX = -bw * 0.34;
    for (let si = 0; si <= 2; si++) {
      lot.addBox(mats.roadPaint, 0.10, 0.015, 3.45, stallBaseX + si * stallW, 0.088, frontZ + 2.45);
      if (si < 2) {
        lot.addBox(mats.concrete, 1.45, 0.10, 0.16, stallBaseX + (si + 0.5) * stallW, 0.13, frontZ + 1.05);
      }
    }
    addBicycleCluster(lot, mats, bw * 0.27, frontZ + 1.10, 3, 0.15);
    if (rnd() < 0.7) {
      const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
      const slot = Math.round(Math.abs(bw * 7)) % 2;
      const isVan = (Math.round(Math.abs(bw * 13)) % 3) === 0;
      addKeiCar(lot, mats, stallBaseX + (slot + 0.5) * stallW, frontZ + 2.72, 0, carMat, isVan, true, false);
    }
  }
}

export function buildMachiyaShop(lot, mats, rnd, { w = 7.4, d = 10.5, detail = true, signSeed = 0 }) {
  const isRamen = rnd() < 0.45;
  const shopKind = isRamen ? 'ramen' : 'izakaya';
  const fasciaPool = isRamen ? mats.fasciasRamen : mats.fasciasIzakaya;
  const fasciaBucket = fasciaPool[Math.floor(rnd() * fasciaPool.length)];

  const h1 = 3.68;
  const h2 = 2.95;
  const bw = w - 0.35;
  const bd = d - 0.8;
  const bz = -0.2;
  const frontZ = bz + bd * 0.5;

  addHollow1FShell(lot, mats.woodDark, { bw, h1, bd, bz, wallT: 0.20 });
  addRecessedStorefront(lot, mats, rnd, {
    bw, h1, frontZ, pierMat: mats.woodDark, shopKind,
    fasciaBucket: null, shutterMat: mats.woodDark, withFascia: false,
    roomDepth: Math.min(bd - 0.9, 3.4),
  });

  // 2F traditional Machiya plaster/timber facade + 3D Koshido lattice windows!
  const wall2F = rnd() < 0.55 ? mats.washikiLower : mats.shikkuiWall;
  lot.add(wall2F, box(bw - 0.2, h2, bd - 0.4, 3.0, 2.95), 0, h1 + h2 * 0.5, bz - 0.15);
  const cols2F = bw >= 6.8 ? 2 : 1;
  for (let c = 0; c < cols2F; c++) {
    const wx = cols2F === 1 ? 0 : (c === 0 ? -bw * 0.24 : bw * 0.24);
    addWindowAssembly(lot, mats, rnd, {
      x: wx, y: h1 + 1.48, z: bz - 0.15 + (bd - 0.4) * 0.5, w: 1.72, h: 1.18,
      frameMat: mats.woodDark, style: 'koshido', hasShutter: false, litProb: 0.58,
    });
  }

  // Clay kawara lean-to eave (一文字瓦庇) + carved/framed wooden fascia signboard above eave!
  buildLeanToEave(lot, mats, {
    x: 0, y: h1 + 0.12, z: frontZ - 0.05,
    w: bw + 0.32, depth: 1.02, drop: 0.30, roofBucket: mats.kawaraDark,
  });
  const signW = Math.min(bw * 0.68, 4.2);
  lot.addBox(mats.woodDark, signW + 0.12, 0.82, 0.14, 0, h1 + 0.48, frontZ + 0.18);
  lot.add(fasciaBucket, signBox(signW, 0.72, 0.16), 0, h1 + 0.48, frontZ + 0.20);

  // 4-panel fluttering Noren curtain (暖簾)
  const norenSet = mats.norenSets[Math.floor(rnd() * mats.norenSets.length)];
  addMultiPanelNoren(lot, mats, norenSet, {
    x: -bw * 0.06, y: 2.38, z: frontZ + 0.26, totalW: Math.min(bw * 0.56, 2.85), panelH: 0.74,
  });

  if (detail) {
    addChochinRow(lot, mats, {
      x0: -bw * 0.34, x1: bw * 0.34, y: 2.56, z: frontZ + 0.68,
      count: bw > 7.5 ? 3 : 2, red: isRamen || rnd() < 0.5,
      rich: true, seed: signSeed, tall: !isRamen && (signSeed % 3 === 0),
    });
    addMenuBoardStand(lot, mats, { x: bw * 0.34, z: frontZ + 0.56, yaw: -0.24 });
    addBeerCrateStack(lot, mats, { x: -bw * 0.40, z: frontZ + 0.16, count: rnd() < 0.5 ? 2 : 3, blue: !isRamen });
    addPottedPlant(lot, mats, { x: bw * 0.41, z: frontZ + 0.22, scale: 1.0, yaw: signSeed * 0.7 });
  }

  if (rnd() < 0.75) {
    addSleeveSign(lot, mats, signSeed, { x: bw * 0.45, y: h1 + 1.55, z: frontZ + 0.04 });
  }

  buildGabledRoof(lot, mats, {
    x: 0, y: h1 + h2, z: bz - 0.15, w: bw - 0.2, d: bd - 0.4, rise: 1.45, overhang: 0.48,
    ridgeAxis: 'x',
    roofBucket: mats.kawaraDark, wallBlankBucket: mats.shikkuiBlank, trimBucket: mats.woodDark, isKawara: true, tier: detail ? 2 : 1,
  });
}

export function buildShotengaiBuilding(lot, mats, rnd, { w = 8.2, d = 11.5, storeys = 3, detail = true, signSeed = 0 }) {
  const bw = w - 0.45;
  const bd = d - 0.9;
  const bz = -0.15;
  const frontZ = bz + bd * 0.5;
  const h1 = 3.85;
  const upperStoreys = Math.max(1, storeys - 1);
  const floorH = 3.15;
  const hUpper = upperStoreys * floorH;
  const totalH = h1 + hUpper;

  const upperMat = mats.commUppers[Math.floor(rnd() * mats.commUppers.length)];
  const shopIdx = Math.floor(rnd() * mats.shopRetails.length);
  const shopEntry = mats.shopRetails[shopIdx];
  const awningMat = mats.awnings[Math.floor(rnd() * mats.awnings.length)];

  // Pure porcelain-tile upper massing + crisp concrete inter-storey cornice bands (胴差し)
  lot.add(upperMat, box(bw, hUpper, bd, 3.0, floorH), 0, h1 + hUpper * 0.5, bz);
  for (let f = 0; f <= upperStoreys; f++) {
    lot.addBox(mats.concrete, bw + 0.12, 0.14, bd + 0.12, 0, h1 + f * floorH, bz);
  }

  // Hollow 1F exterior shell + recessed ground-floor 3D storefront & furnished interior!
  addHollow1FShell(lot, upperMat, { bw, h1, bd, bz, wallT: 0.20 });
  const fasciaBucket = shopEntry.fascias[Math.floor(rnd() * shopEntry.fascias.length)];
  const roomDepth = (shopEntry.kind === 'pharmacy' ? 3.8 : 3.4) + (rnd() - 0.5) * 0.6;
  addRecessedStorefront(lot, mats, rnd, {
    bw, h1, frontZ, pierMat: upperMat, shopKind: shopEntry.kind, fasciaBucket, withFascia: true,
    roomDepth: Math.min(bd - 0.9, roomDepth),
  });

  // Canvas awning with steel support arms (テント庇)
  lot.addBox(awningMat, bw - 0.24, 0.07, 1.22, 0, 2.86, frontZ + 0.58, 0.25, 0, 0);
  lot.addBox(awningMat, bw - 0.24, 0.22, 0.05, 0, 2.63, frontZ + 1.16);
  for (const ax of [-bw * 0.42, bw * 0.42]) {
    lot.addStrut(mats.darkMetal, [ax, 2.28, frontZ + 0.02], [ax, 2.68, frontZ + 1.08], 0.035);
  }

  // Upper-storey 3D recessed commercial windows (front + side return bays -> zero sliced windows!)
  const cols = Math.max(2, Math.min(3, Math.floor((bw - 0.7) / 2.55)));
  const baySpan = (bw - 1.1) / cols;
  const winW = Math.min(2.15, baySpan - 0.42);
  for (let f = 0; f < upperStoreys; f++) {
    const wy = h1 + 1.62 + f * floorH;
    for (let c = 0; c < cols; c++) {
      const wx = -((cols - 1) * baySpan) * 0.5 + c * baySpan;
      addWindowAssembly(lot, mats, rnd, {
        x: wx, y: wy, z: frontZ, w: winW, h: 1.52,
        frameMat: mats.darkMetal, style: 'commercial', preferOffice: true, litProb: 0.56,
      });
    }
    if (detail) {
      // Side corner windows visible along cross-streets & building gaps
      for (const sx of [-1, 1]) {
        addWindowAssembly(lot, mats, rnd, {
          x: sx * bw * 0.5, y: wy, z: bz + bd * 0.24, w: 1.68, h: 1.48, rotY: sx * Math.PI * 0.5,
          frameMat: mats.darkMetal, style: 'commercial', preferOffice: true, litProb: 0.48,
        });
      }
    }
  }

  // Parapet coping + rooftop elevator/stair penthouse & HVAC
  const pt = 0.24;
  lot.addBox(mats.roofConcrete, bw + 0.16, 0.22, bd + 0.16, 0, totalH + 0.11, bz);
  lot.addBox(mats.concrete, bw + pt, 0.58, pt, 0, totalH + 0.42, frontZ);
  lot.addBox(mats.concrete, bw + pt, 0.48, pt, 0, totalH + 0.36, bz - bd * 0.5);
  lot.addBox(mats.concrete, pt, 0.48, bd, -bw * 0.5, totalH + 0.36, bz);
  lot.addBox(mats.concrete, pt, 0.48, bd, bw * 0.5, totalH + 0.36, bz);
  // Metal coping rail on front parapet
  lot.addBox(mats.silverMetal, bw + pt + 0.06, 0.06, pt + 0.08, 0, totalH + 0.73, frontZ);

  const signSide = rnd() < 0.5 ? -1 : 1;
  addSleeveSign(lot, mats, signSeed, {
    x: signSide * (bw * 0.45),
    y: h1 + 1.55,
    z: frontZ + 0.05,
  });
  if (upperStoreys >= 2 && rnd() < 0.65) {
    addSleeveSign(lot, mats, signSeed + 7, {
      x: -signSide * (bw * 0.45),
      y: h1 + floorH + 1.45,
      z: frontZ + 0.05,
    });
  }

  if (detail) {
    // Corner vertical stormwater downspout on commercial facade
    lot.addProto(mats.gutterMetal, PROTO_CYL8, -signSide * (bw * 0.48), totalH * 0.5, frontZ + 0.05, 0.036, totalH, 0.036);
    for (let f = 0; f < upperStoreys; f++) {
      const fy = h1 + 0.36 + f * floorH;
      if (rnd() < 0.62) {
        addAcWithDuct(lot, mats, {
          x: -signSide * (bw * 0.34), y: fy, z: frontZ + 0.02, wallMount: true, ductH: 1.15, withVentHood: f === 0,
        });
      }
    }
    if (rnd() < 0.45) {
      addMenuBoardStand(lot, mats, { x: signSide * (bw * 0.32), z: frontZ + 0.58, yaw: 0.22 });
    }
    if (rnd() < 0.4) {
      addBicycleCluster(lot, mats, -signSide * (bw * 0.28), frontZ + 0.85, 2, 0.12);
    }
  }

  if (storeys >= 3 && rnd() < 0.55) {
    lot.add(upperMat, box(2.3, 2.2, 2.4, 3.0, 2.4), -bw * 0.22, totalH + 1.1, bz - bd * 0.2);
    lot.addBox(mats.roofConcrete, 2.5, 0.16, 2.6, -bw * 0.22, totalH + 2.26, bz - bd * 0.2);
  } else {
    lot.addBox(mats.acUnit, 1.5, 0.85, 1.1, bw * 0.2, totalH + 0.62, bz - 0.6);
  }
}

export function buildKissatenCorner(lot, mats, rnd, { w = 9.2, d = 10.2, detail = true }) {
  const bw = w - 0.8;
  const bd = d - 0.9;
  const h1 = 3.78;
  const h2 = 3.05;
  const frontZ = bd * 0.5;
  const sideW = bd * 0.58;
  const sideH = h1 - 0.65;
  const sideZ = bd * 0.08;

  const wall2F = mats.houseLightWalls[Math.floor(rnd() * mats.houseLightWalls.length)];
  const awning = rnd() < 0.5 ? mats.awningGreen : mats.awningBurgundy;
  const fasciaBucket = mats.fasciasKissaten[Math.floor(rnd() * mats.fasciasKissaten.length)];

  // Hollow 1F corner shell opening to BOTH front Kissaten bay and +X side corner window!
  addHollow1FShell(lot, mats.houseTileWalls[1], {
    bw, h1, bd, bz: 0, wallT: 0.20,
    openRightWindow: { zCenter: sideZ, width: sideW, yBot: 0.14, yTop: 0.14 + sideH },
  });
  addRecessedStorefront(lot, mats, rnd, {
    bw, h1, frontZ, pierMat: mats.houseTileWalls[1], shopKind: 'kissaten', fasciaBucket, withFascia: true,
    roomDepth: Math.min(bd - 0.9, 4.4), openRightSide: true,
  });
  // Side street corner return 3D display window opening into the same 3D Kissaten room!
  addShop3DFacade(lot, mats, {
    w: sideW, h: sideH, x: bw * 0.5 - 0.08, yBot: 0.14, z: sideZ, rotY: Math.PI * 0.5, shopKind: 'kissaten',
  });

  lot.addBox(awning, bw - 0.2, 0.08, 1.15, 0, 2.82, frontZ + 0.56, 0.25, 0, 0);
  lot.addBox(awning, 1.15, 0.08, sideW + 0.2, bw * 0.5 + 0.54, 2.82, bd * 0.08, 0, 0, -0.25);

  // 2F residential/cafe upper floor with real 3D casement windows & clay hipped roof + gutters!
  lot.addBox(mats.concrete, bw + 0.1, 0.14, bd + 0.1, 0, h1 + 0.02, 0);
  lot.add(wall2F, box(bw - 0.25, h2, bd - 0.25, 3.2, 3.05), 0, h1 + h2 * 0.5, 0);
  for (const dx of [-bw * 0.24, bw * 0.24]) {
    addWindowAssembly(lot, mats, rnd, {
      x: dx, y: h1 + 1.52, z: (bd - 0.25) * 0.5, w: 1.62, h: 1.25,
      frameMat: mats.woodDark, style: 'sliding', hasShutter: false, litProb: 0.64,
    });
  }
  for (const dz of [-bd * 0.22, bd * 0.22]) {
    addWindowAssembly(lot, mats, rnd, {
      x: (bw - 0.25) * 0.5, y: h1 + 1.52, z: dz, w: 1.48, h: 1.22, rotY: Math.PI * 0.5,
      frameMat: mats.woodDark, style: 'sliding', hasShutter: false, litProb: 0.58,
    });
  }

  const roofY = h1 + h2 + 0.06;
  lot.add(mats.kawaraBrown, hippedRoofGeometry(bw + 0.65, 1.35, bd + 0.65, 0.16), 0, roofY, 0);
  addEavesGutterAndDownspout(lot, mats, {
    x: 0, yEave: roofY - 0.14, z: 0, w: bw - 0.25, d: bd - 0.25, overhang: 0.45, ridgeAxis: 'x', tier: detail ? 2 : 1,
  });

  if (detail) {
    for (const px of [-bw * 0.34, bw * 0.34]) {
      lot.addBox(mats.woodWarm, 0.78, 0.36, 0.34, px, 0.18, frontZ + 0.38);
      lot.add(mats.hedge, box(0.70, 0.28, 0.28, 0.9, 0.9), px, 0.45, frontZ + 0.38);
      if (mats.foliageShrub) {
        lot.addProto(mats.foliageShrub, PROTO_HEDGE_FRINGE, px - 0.18, 0.56, frontZ + 0.38, 0.24, 0.22, 0.24, 0, 0.5, 0);
        lot.addProto(mats.foliageShrub, PROTO_HEDGE_FRINGE, px + 0.18, 0.56, frontZ + 0.38, 0.24, 0.22, 0.24, 0, 2.4, 0);
      }
    }
    addMenuBoardStand(lot, mats, { x: bw * 0.12, z: frontZ + 0.62, yaw: -0.18 });
    // Bracketed brass globe sconce at corner
    lot.addBox(mats.darkMetal, 0.06, 0.06, 0.28, bw * 0.46, 2.86, frontZ + 0.14);
    lot.addProto(mats.warmLamp, PROTO_SPHERE, bw * 0.46, 2.75, frontZ + 0.26, 0.14, 0.14, 0.14);
  }
}

export function buildNeighborhoodSuper(lot, mats, rnd, { w = 16.5, d = 13.5, detail = true }) {
  lot.addBox(mats.asphaltApron, w + 1.2, 0.08, d + 2.0, 0, 0.04, 0.5);

  const bw = w - 1.6;
  const bd = d - 3.2;
  const bz = -1.0;
  const frontZ = bz + bd * 0.5;
  const h1 = 3.9;
  const h = 5.4;

  // Hollow 1F exterior shell + upper parapet/header volume (`3.9..5.4 m`)
  addHollow1FShell(lot, mats.commUpperLight, { bw, h1, bd, bz, wallT: 0.22 });
  lot.add(mats.commUpperLight, box(bw, h - h1, bd, 3.2, h - h1), 0, h1 + (h - h1) * 0.5, bz);
  // Left/right exterior cheek trims outside the slightly inset `bw - 0.4` storefront
  lot.add(mats.commUpperLight, box(0.24, h1, 0.42, 0.5, h1), -bw * 0.5 + 0.12, h1 * 0.5, frontZ - 0.21);
  lot.add(mats.commUpperLight, box(0.24, h1, 0.42, 0.5, h1), bw * 0.5 - 0.12, h1 * 0.5, frontZ - 0.21);

  const fasciaBucket = mats.fasciasPharmacy[Math.floor(rnd() * mats.fasciasPharmacy.length)];
  addRecessedStorefront(lot, mats, rnd, {
    bw: bw - 0.4, h1, frontZ, pierMat: mats.commUpperLight,
    shopKind: 'pharmacy', fasciaBucket, withFascia: false,
    roomDepth: Math.min(bd - 0.9, 4.4),
  });

  const headerMat = rnd() < 0.5 ? mats.konbiniFasciaFamima : mats.konbiniFasciaLawson;
  lot.addBox(mats.silverMetal, bw + 0.32, 1.24, bd * 0.36, 0, h - 0.5, bz + bd * 0.34);
  lot.add(fasciaBucket, signBox(Math.min(bw * 0.68, 7.6), 0.96, 0.22), 0, h - 0.48, frontZ + 0.22);
  lot.add(headerMat, box(bw + 0.36, 0.22, 0.18, 4.0, 0.22), 0, h - 1.06, frontZ + 0.18);
  lot.addBox(mats.roofConcrete, bw + 0.3, 0.25, bd + 0.3, 0, h + 0.12, bz);

  lot.addBox(mats.darkMetal, bw * 0.88, 0.14, 1.85, 0, 3.45, frontZ + 0.92);
  for (const cx of [-bw * 0.38, 0, bw * 0.38]) {
    lot.addProto(mats.darkMetal, PROTO_CYL8, cx, 1.72, frontZ + 1.7, 0.08, 3.45, 0.08);
  }

  lot.addBox(mats.acUnit, 2.4, 1.05, 1.6, -bw * 0.22, h + 0.75, bz - 1.2);
  lot.addBox(mats.acUnit, 1.8, 0.9, 1.3, bw * 0.24, h + 0.68, bz - 1.2);

  if (detail) {
    addBicycleCluster(lot, mats, -bw * 0.34, frontZ + 1.25, 4, 0.1);
    lot.addBox(mats.vendRed, 0.95, 1.92, 0.74, bw * 0.36, 0.96, frontZ + 0.52);
    lot.addBox(mats.vendFace, 0.82, 1.28, 0.06, bw * 0.36, 1.18, frontZ + 0.9);
    lot.addBox(mats.vendBlue, 0.95, 1.92, 0.74, bw * 0.36 - 1.04, 0.96, frontZ + 0.52);
    lot.addBox(mats.vendFace, 0.82, 1.28, 0.06, bw * 0.36 - 1.04, 1.18, frontZ + 0.9);
  }
}

// ------------------------------------------------------------------ JAPANESE STREET INFRASTRUCTURE (RED-CIRCLE HERO FIXES!)

/**
 * Fix #1: Concrete utility pole (電柱) with flush curved non-emissive enameled chome plaque +
 * stainless steel straps + yellow/black reflective safety wrap + step bolts + porcelain insulators!
 */
export function addUtilityPole(mats, x, z, hasTransformer = false, guyDirZ = 0, side = 1, plaqueIdx = 0) {
  const lot = new LotContext(x, z, 0, 0);
  const poleH = 9.6;
  const rBase = 0.21;
  const rTop = 0.21 * 0.65;
  const rAt = (y) => rBase + (rTop - rBase) * (y / poleH);

  // Smooth 12-sided tapered spun-concrete pole
  lot.addProto(mats.poleConcrete, PROTO_TAPER_POLE, 0, poleH * 0.5, 0, rBase, poleH, rBase);

  // Curved enameled Prussian-blue chome/address plaque at y = 2.62 m (zero emissive, zero clipping!)
  const py = 2.62;
  const ph = 0.74;
  const rPlaqueBot = rAt(py - ph * 0.5) + 0.004;
  const rPlaqueTop = rAt(py + ph * 0.5) + 0.004;
  const plaqueBucket = mats.polePlaques[plaqueIdx % mats.polePlaques.length];
  // Angle toward pedestrian sidewalk & approaching street sightline
  const faceYaw = -side * 0.58;
  lot.add(plaqueBucket, curvedSleeveGeometry(rPlaqueBot, rPlaqueTop, ph, 1.92, 10, 0.004), 0, py, 0, 0, faceYaw, 0);
  // Top & bottom stainless-steel pole clamping bands (ステンレス締付バンド)
  lot.addProto(mats.silverMetal, PROTO_CYL12, 0, py + ph * 0.5 - 0.02, 0, rPlaqueTop + 0.006, 0.022, rPlaqueTop + 0.006);
  lot.addProto(mats.silverMetal, PROTO_CYL12, 0, py - ph * 0.5 + 0.02, 0, rPlaqueBot + 0.006, 0.022, rPlaqueBot + 0.006);

  // Lower yellow/black reflective safety wrap + utility ID plate at y = 1.44 m
  const ry = 1.44;
  const rh = 0.52;
  lot.add(
    mats.poleReflector,
    curvedSleeveGeometry(rAt(ry - rh * 0.5) + 0.003, rAt(ry + rh * 0.5) + 0.003, rh, 4.6, 12, 0.003),
    0, ry, 0, 0, faceYaw, 0,
  );

  // Alternating galvanized climbing step bolts (足場ボルト) above 3.2 m
  for (let i = 0; i < 10; i++) {
    const sy = 3.25 + i * 0.52;
    const sgn = i % 2 === 0 ? 1 : -1;
    const sr = rAt(sy);
    lot.addBox(mats.silverMetal, 0.13, 0.022, 0.022, sgn * (sr + 0.055), sy, 0);
  }

  // Galvanized steel crossarms (腕金) + diagonal V-braces (アームタイ) + white porcelain insulators (碍子)!
  for (const [armW, ay, pins] of [[1.96, 8.95, [-0.75, 0, 0.75]], [1.56, 8.15, [-0.52, 0.52]], [1.16, 6.85, [-0.35, 0.35]]]) {
    const zOff = rAt(ay) + 0.045;
    lot.addBox(mats.darkMetal, armW, 0.085, 0.075, 0, ay, zOff);
    lot.addProto(mats.silverMetal, PROTO_CYL12, 0, ay, 0, rAt(ay) + 0.012, 0.07, rAt(ay) + 0.012);
    lot.addStrut(mats.darkMetal, [-armW * 0.36, ay - 0.03, zOff], [0, ay - 0.42, rAt(ay - 0.42)], 0.03);
    lot.addStrut(mats.darkMetal, [armW * 0.36, ay - 0.03, zOff], [0, ay - 0.42, rAt(ay - 0.42)], 0.03);
    for (const px of pins) {
      lot.addProto(mats.acUnit, PROTO_CYL8, px, ay + 0.09, zOff, 0.042, 0.11, 0.042);
    }
  }

  // Pole-mounted cylindrical oil-cooled transformer (柱上変圧器) with bushings & hanger bracket
  if (hasTransformer) {
    const ty = 7.35;
    lot.addProto(mats.silverMetal, PROTO_CYL12, -0.38, ty, 0.18, 0.25, 0.90, 0.25);
    lot.addProto(mats.darkMetal, PROTO_CYL12, -0.38, ty + 0.46, 0.18, 0.265, 0.05, 0.265);
    // Porcelain high-voltage bushings on transformer lid
    for (const bx of [-0.46, -0.30]) {
      lot.addProto(mats.acUnit, PROTO_CYL6, bx, ty + 0.56, 0.18, 0.032, 0.16, 0.032);
    }
    lot.addBox(mats.darkMetal, 0.38, 0.08, 0.24, -0.18, ty + 0.22, 0.09);
    lot.addBox(mats.darkMetal, 0.38, 0.08, 0.24, -0.18, ty - 0.24, 0.09);
  }

  if (guyDirZ !== 0) {
    lot.addProto(mats.tactileYellow, PROTO_CYL8, 0, 1.15, guyDirZ * 0.45, 0.035, 2.4, 0.035, guyDirZ * 0.36, 0, 0);
  }
}

/**
 * Fix #2: Suzuran decorative Shotengai streetlamp (すずらん灯) with cast-iron plinth, scroll brackets,
 * bell shades over smooth glowing globes, and non-emissive woven Shotengai association street flag!
 */
export function addShotengaiLamp(mats, x, z, side = 1, flagBucket = null, breezeAngle = 0) {
  const lot = new LotContext(x, z, 0, 0);

  // Decorative stepped cast-iron pedestal base + main tapered post
  lot.addProto(mats.darkMetal, PROTO_CYL8, 0, 0.16, 0, 0.19, 0.32, 0.19);
  lot.addProto(mats.darkMetal, PROTO_CYL8, 0, 0.48, 0, 0.145, 0.38, 0.145);
  lot.addProto(mats.archGoldTrim, PROTO_CYL12, 0, 0.69, 0, 0.155, 0.05, 0.155);
  lot.addProto(mats.darkMetal, PROTO_CYL12, 0, 2.65, 0, 0.092, 4.65, 0.092);
  // Ornamental finial spire at post top
  lot.addProto(mats.archGoldTrim, PROTO_CONE10, 0, 5.06, 0, 0.075, 0.22, 0.075);

  // Graceful dual-arm Suzuran scroll brackets + drooping bronze bell caps + smooth milky globes!
  // Roadway-side main arm
  lot.addStrut(mats.darkMetal, [0, 4.55, 0], [-side * 0.52, 4.82, 0], 0.048);
  lot.addStrut(mats.darkMetal, [-side * 0.52, 4.82, 0], [-side * 0.90, 4.66, 0], 0.042);
  lot.addStrut(mats.archGoldTrim, [0, 4.26, 0], [-side * 0.56, 4.74, 0], 0.026);
  lot.addProto(mats.darkMetal, PROTO_CYL8, -side * 0.90, 4.58, 0, 0.024, 0.16, 0.024);
  lot.addProto(mats.darkMetal, PROTO_BELL_CAP, -side * 0.90, 4.46, 0, 0.23, 0.14, 0.23);
  lot.addProto(mats.warmLamp, PROTO_SPHERE, -side * 0.90, 4.29, 0, 0.185, 0.21, 0.185);

  // Sidewalk-side secondary higher bell globe
  lot.addStrut(mats.darkMetal, [0, 4.62, 0], [side * 0.38, 4.80, 0], 0.04);
  lot.addProto(mats.darkMetal, PROTO_CYL8, side * 0.38, 4.72, 0, 0.022, 0.14, 0.022);
  lot.addProto(mats.darkMetal, PROTO_BELL_CAP, side * 0.38, 4.62, 0, 0.18, 0.12, 0.18);
  lot.addProto(mats.warmLamp, PROTO_SPHERE, side * 0.38, 4.48, 0, 0.145, 0.165, 0.145);

  // Non-emissive woven Shotengai street flag (フラッグ) with top/bottom rods, collars & finials
  if (flagBucket) {
    const fx = -side * 0.32;
    lot.addProto(mats.silverMetal, PROTO_CYL8, 0, 3.72, 0, 0.105, 0.045, 0.105);
    lot.addProto(mats.silverMetal, PROTO_CYL8, 0, 2.56, 0, 0.105, 0.045, 0.105);
    lot.addBox(mats.silverMetal, 0.58, 0.032, 0.032, -side * 0.29, 3.72, 0);
    lot.addBox(mats.silverMetal, 0.56, 0.028, 0.028, -side * 0.29, 2.56, 0);
    lot.addProto(mats.archGoldTrim, PROTO_SPHERE, -side * 0.59, 3.72, 0, 0.035, 0.035, 0.035);
    lot.add(flagBucket, streetFlagGeometry(0.45, 1.10, 0.014, 0.07), fx, 3.14, 0, breezeAngle, 0, 0);
  }
}

/**
 * Fix #3: Authentic Japanese Shotengai Entrance Archway (商店街アーチ):
 * - Twin laced steel portal piers (ラチス柱) on granite/concrete pedestals
 * - Open 3D Warren space-frame steel truss girder (立体トラス梁) + knee braces
 * - Brushed champagne-gold 3D sign bezel + recessed vermilion plaque + 5 gooseneck floodlights!
 * - Properly stem-mounted Suzuran bell lamps below the lower truss chord (zero floating spheres!)
 */
export function addShotengaiArch(mats, z, halfSpan = 6.15, bannerBucket = null, cx = 0, rotY = 0) {
  const lot = new LotContext(cx, z, rotY, 0);
  const banner = bannerBucket ?? mats.shotengaiBanner;
  const colZ = 0.26;
  const yLow = 6.02;
  const yHigh = 6.92;
  const pierH = 6.98;
  const totalSpan = halfSpan * 2 + 0.72;

  // 1. Twin Laced Steel Lattice Piers (ラチス柱) on molded concrete & cast-iron bases
  for (const s of [-1, 1]) {
    const px = s * halfSpan;
    // Molded concrete pier base + dark-metal anchor collar
    lot.addBox(mats.concrete, 0.56, 0.62, 0.86, px, 0.31, 0);
    lot.addBox(mats.darkMetal, 0.48, 0.12, 0.76, px, 0.66, 0);
    for (const sz of [-1, 1]) {
      lot.addProto(mats.accentRed, PROTO_CYL12, px, pierH * 0.5 + 0.3, sz * colZ, 0.135, pierH - 0.6, 0.135);
      // Decorative spherical finial cap atop each column
      lot.addProto(mats.archGoldTrim, PROTO_SPHERE, px, pierH + 0.12, sz * colZ, 0.14, 0.14, 0.14);
    }
    // Horizontal & diagonal X-lacing between front and back steel tubes
    for (let ly = 1.1; ly < yLow - 0.2; ly += 0.95) {
      lot.addBox(mats.accentRed, 0.07, 0.07, colZ * 2, px, ly, 0);
      lot.addStrut(mats.darkMetal, [px, ly, -colZ], [px, Math.min(yLow, ly + 0.95), colZ], 0.048);
      lot.addStrut(mats.darkMetal, [px, ly, colZ], [px, Math.min(yLow, ly + 0.95), -colZ], 0.048);
    }
    // Curved/angled knee-brace gussets (隅肉ブレース) into overhead girder
    for (const sz of [-1, 1]) {
      lot.addStrut(mats.accentRed, [px, 4.95, sz * colZ], [px - s * 1.28, yLow, sz * colZ], 0.095);
      lot.addStrut(mats.archGoldTrim, [px, 5.38, sz * colZ], [px - s * 0.82, yLow, sz * colZ], 0.055);
    }
  }

  // 2. Open 3D Overhead Space-Frame Truss Girder (立体トラス梁)
  for (const ty of [yLow, yHigh]) {
    for (const sz of [-1, 1]) {
      lot.addBox(mats.accentRed, totalSpan, 0.13, 0.13, 0, ty, sz * colZ);
    }
  }
  const trussBays = Math.max(8, Math.round(totalSpan / 1.15));
  const bayW = totalSpan / trussBays;
  for (let i = 0; i <= trussBays; i++) {
    const bx = -totalSpan * 0.5 + i * bayW;
    lot.addBox(mats.darkMetal, 0.065, 0.065, colZ * 2, bx, yLow, 0);
    lot.addBox(mats.darkMetal, 0.065, 0.065, colZ * 2, bx, yHigh, 0);
    for (const sz of [-1, 1]) {
      lot.addBox(mats.accentRed, 0.07, yHigh - yLow, 0.07, bx, (yLow + yHigh) * 0.5, sz * colZ);
      if (i < trussBays) {
        const nx = bx + bayW;
        const up = i % 2 === 0;
        lot.addStrut(
          mats.darkMetal,
          [bx, up ? yLow : yHigh, sz * colZ],
          [nx, up ? yHigh : yLow, sz * colZ],
          0.052,
        );
      }
    }
  }

  // 3. Layered 3D Signboard Casing (看板筐体) + Champagne-Gold Metallic Bezel + Recessed Plaque
  const signW = Math.min(halfSpan * 1.18, 6.75);
  const signH = signW > 5.8 ? 1.32 : 1.08;
  const signY = (yLow + yHigh) * 0.5 + 0.06;
  const caseD = 0.62;
  const frameT = 0.095;

  // Dark steel inner sign cabinet
  lot.addBox(mats.darkMetal, signW, signH, caseD, 0, signY, 0);
  // Recessed vermilion/gold sign plaque on front & back
  lot.add(banner, signBox(signW - frameT * 1.5, signH - frameT * 1.5, caseD + 0.04), 0, signY, 0);

  // Protruding 4-sided brushed champagne-gold metallic bezel frame (projects +6 cm ahead of plaque!)
  const bezelD = caseD + 0.16;
  lot.addBox(mats.archGoldTrim, signW + frameT, frameT, bezelD, 0, signY + signH * 0.5, 0);
  lot.addBox(mats.archGoldTrim, signW + frameT, frameT, bezelD, 0, signY - signH * 0.5, 0);
  lot.addBox(mats.archGoldTrim, frameT, signH + frameT, bezelD, -signW * 0.5, signY, 0);
  lot.addBox(mats.archGoldTrim, frameT, signH + frameT, bezelD, signW * 0.5, signY, 0);
  // Crown molding cap above sign
  lot.addBox(mats.accentRed, signW + 0.34, 0.09, bezelD + 0.08, 0, signY + signH * 0.5 + 0.08, 0);

  // 4. Overhead Gooseneck Floodlight Arms (アームスポットライト) illuminating both faces of the plaque!
  const spotCount = signW > 5.8 ? 5 : 3;
  for (let i = 0; i < spotCount; i++) {
    const sx = -signW * 0.38 + (signW * 0.76 * i) / Math.max(1, spotCount - 1);
    for (const sz of [-1, 1]) {
      const baseZ = sz * (bezelD * 0.5);
      const outZ = sz * (bezelD * 0.5 + 0.44);
      const topY = signY + signH * 0.5 + 0.12;
      lot.addStrut(mats.darkMetal, [sx, topY, baseZ * 0.85], [sx, topY + 0.24, outZ * 0.72], 0.032);
      lot.addStrut(mats.darkMetal, [sx, topY + 0.24, outZ * 0.72], [sx, topY + 0.12, outZ], 0.028);
      // Angled conical floodlight hood + warm glowing lens aiming back at the sign face
      lot.addProto(mats.darkMetal, PROTO_BELL_CAP, sx, topY + 0.07, outZ, 0.085, 0.11, 0.085, -sz * 0.55, 0, 0);
      lot.addProto(mats.warmLamp, PROTO_SPHERE, sx, topY + 0.04, outZ - sz * 0.03, 0.055, 0.055, 0.055);
    }
  }

  // 5. Stem-suspended Suzuran Bell Globes below the lower truss chord (zero mid-air floating!)
  const lampOffsets = signW > 5.8 ? [-4.3, -2.15, 2.15, 4.3] : [-2.8, 2.8];
  for (const lx of lampOffsets) {
    lot.addProto(mats.darkMetal, PROTO_CYL8, lx, yLow - 0.13, 0, 0.024, 0.26, 0.024);
    lot.addProto(mats.darkMetal, PROTO_BELL_CAP, lx, yLow - 0.27, 0, 0.20, 0.13, 0.20);
    lot.addProto(mats.warmLamp, PROTO_SPHERE, lx, yLow - 0.43, 0, 0.165, 0.185, 0.165);
  }

  // 6. Marquee rim bulbs on large flagship promenade arches for festive Osaka Dotonbori presence
  if (signW > 5.8 && mats.marqueeBulb) {
    const bulbN = 15;
    for (let bi = 0; bi < bulbN; bi++) {
      const bx = -signW * 0.46 + (signW * 0.92 * bi) / (bulbN - 1);
      for (const sz of [-1, 1]) {
        lot.addProto(mats.marqueeBulb, PROTO_BULB_CORE, bx, signY + signH * 0.5, sz * (bezelD * 0.5 + 0.025), 0.026, 0.026, 0.026);
        lot.addProto(mats.marqueeBulb, PROTO_BULB_CORE, bx, signY - signH * 0.5, sz * (bezelD * 0.5 + 0.025), 0.026, 0.026, 0.026);
      }
    }
  }
}

// ------------------------------------------------------------------ OSAKA DOTONBORI FLAGSHIP 3D RELIEF SIGNAGE & ARCHITECTURE

/**
 * Connects two 3D local points [x0,y0,z0] -> [x1,y1,z1] with a smooth organic crab/octopus limb segment
 * plus an optional ivory joint knuckle ring at point `a`.
 */
function addOrganicLimb(sub, bodyBucket, jointBucket, a, b, rBase, rTip = null) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const mx = (a[0] + b[0]) * 0.5;
  const my = (a[1] + b[1]) * 0.5;
  const mz = (a[2] + b[2]) * 0.5;
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
  _quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  _pos.set(mx, my, mz);
  const rMid = rTip !== null ? (rBase + rTip) * 0.5 : rBase;
  _scale.set(rBase, len, rMid * 0.78);
  _localMat.compose(_pos, _quat, _scale);
  _mat4.multiplyMatrices(sub.worldMatrix, _localMat);
  const g = (rTip !== null && rTip < rBase * 0.65 ? PROTO_TAPER_LIMB : PROTO_CYL12).clone();
  g.applyMatrix4(_mat4);
  g.computeVertexNormals();
  bodyBucket.geometries.push(g);

  if (jointBucket) {
    sub.addProto(jointBucket, PROTO_SPHERE, a[0], a[1], a[2], rBase * 0.96, rBase * 0.96, rBase * 0.82);
  }
}

/**
 * Giant 3D Sculpted Crimson Snow Crab (かに道楽スタイル 巨大立体カニ看板, ~4.6 m wide):
 * - Sculpted multi-lobed convex glossy crimson carapace with dorsal gastric/cardiac ridges
 * - Twin vertical eye stalks with glossy black eyes & white collars
 * - 2 raised curved pincer claws arching inward above the carapace
 * - 8 articulated 3-segment curved walking legs fanning symmetrically across the backlit louvers
 */
export function addGiant3DCrab(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const red = mats.kaniRed ?? mats.accentRed;
  const cream = mats.kaniCream ?? mats.vendWhite;
  const eyeBlack = mats.carTrimBlack ?? mats.darkMetal;
  const s = scale;

  // Heavy steel wall standoff brackets anchoring the crab sculpture to the louver backing
  for (const [bx, by] of [[-0.48 * s, 0.12 * s], [0.48 * s, 0.12 * s], [-1.35 * s, -0.18 * s], [1.35 * s, -0.18 * s]]) {
    sub.addBox(mats.darkMetal, 0.08 * s, 0.08 * s, 0.36 * s, bx, by, -0.18 * s);
  }

  // 1. Sculpted convex crimson carapace (甲羅: rounded triangular-shield crab body + dorsal lobes)
  sub.addProto(red, PROTO_SPHERE, 0, -0.12 * s, 0.16 * s, 0.78 * s, 0.68 * s, 0.30 * s);
  sub.addProto(red, PROTO_SPHERE, -0.34 * s, 0.02 * s, 0.18 * s, 0.54 * s, 0.46 * s, 0.26 * s, 0, 0, 0.35);
  sub.addProto(red, PROTO_SPHERE, 0.34 * s, 0.02 * s, 0.18 * s, 0.54 * s, 0.46 * s, 0.26 * s, 0, 0, -0.35);
  // Central cardiac & gastric shell bosses for realistic 3D specular highlights
  sub.addProto(red, PROTO_SPHERE, 0, 0.06 * s, 0.31 * s, 0.34 * s, 0.30 * s, 0.18 * s);
  sub.addProto(red, PROTO_SPHERE, 0, -0.32 * s, 0.28 * s, 0.42 * s, 0.24 * s, 0.15 * s);
  // Cream ventral rim & rostrum teeth
  sub.addProto(cream, PROTO_SPHERE, 0, -0.52 * s, 0.14 * s, 0.52 * s, 0.22 * s, 0.18 * s);

  // 2. Iconic vertical stalked eyes (目玉)
  for (const sx of [-1, 1]) {
    const ex = sx * 0.155 * s;
    sub.addProto(cream, PROTO_CYL8, ex, 0.48 * s, 0.26 * s, 0.042 * s, 0.22 * s, 0.042 * s, 0, 0, -sx * 0.08);
    sub.addProto(eyeBlack, PROTO_SPHERE, ex + sx * 0.01 * s, 0.62 * s, 0.29 * s, 0.082 * s, 0.095 * s, 0.082 * s);
    sub.addProto(cream, PROTO_SPHERE, ex + sx * 0.03 * s, 0.65 * s, 0.355 * s, 0.024 * s, 0.024 * s, 0.018 * s);
  }

  // 3. Twin raised articulated pincer claws (ハサミ) arching overhead toward the center!
  for (const sx of [-1, 1]) {
    const p0 = [sx * 0.46 * s, 0.30 * s, 0.20 * s];
    const p1 = [sx * 0.96 * s, 0.78 * s, 0.26 * s];
    const p2 = [sx * 0.74 * s, 1.12 * s, 0.30 * s];
    const pTipUpper = [sx * 0.12 * s, 1.18 * s, 0.32 * s];
    const pTipLower = [sx * 0.16 * s, 1.00 * s, 0.30 * s];
    addOrganicLimb(sub, red, cream, p0, p1, 0.115 * s);
    addOrganicLimb(sub, red, cream, p1, p2, 0.125 * s);
    // Swollen chela palm + open upper & lower pincer dactyls
    sub.addProto(red, PROTO_SPHERE, sx * 0.56 * s, 1.10 * s, 0.31 * s, 0.24 * s, 0.15 * s, 0.13 * s, 0, 0, -sx * 0.18);
    addOrganicLimb(sub, red, null, [sx * 0.46 * s, 1.15 * s, 0.31 * s], pTipUpper, 0.082 * s, 0.025 * s);
    addOrganicLimb(sub, cream, null, [sx * 0.46 * s, 1.04 * s, 0.30 * s], pTipLower, 0.062 * s, 0.020 * s);
  }

  // 4. Eight 3-segment curved walking legs (歩脚, 4 left + 4 right) spanning ~4.6 m!
  const legSpecs = [
    { y0: 0.16, x1: 1.38, y1: 0.44, x2: 2.08, y2: 0.34, x3: 2.28, y3: 0.16, r: 0.105 },
    { y0: -0.04, x1: 1.46, y1: 0.14, x2: 2.18, y2: 0.02, x3: 2.34, y3: -0.20, r: 0.102 },
    { y0: -0.24, x1: 1.38, y1: -0.16, x2: 2.04, y2: -0.32, x3: 2.16, y3: -0.56, r: 0.095 },
    { y0: -0.42, x1: 1.14, y1: -0.46, x2: 1.66, y2: -0.66, x3: 1.54, y3: -0.88, r: 0.086 },
  ];
  for (const sx of [-1, 1]) {
    for (const lg of legSpecs) {
      const a0 = [sx * 0.58 * s, lg.y0 * s, 0.16 * s];
      const a1 = [sx * lg.x1 * s, lg.y1 * s, 0.24 * s];
      const a2 = [sx * lg.x2 * s, lg.y2 * s, 0.22 * s];
      const a3 = [sx * lg.x3 * s, lg.y3 * s, 0.16 * s];
      addOrganicLimb(sub, red, cream, a0, a1, lg.r * s);
      addOrganicLimb(sub, red, cream, a1, a2, lg.r * 0.88 * s);
      addOrganicLimb(sub, red, cream, a2, a3, lg.r * 0.72 * s, lg.r * 0.25 * s);
    }
  }
}

/**
 * Giant 3D Sculpted Crimson Octopus & Takoyaki Boat (道頓堀 大たこ立体看板, ~4.2 m wide):
 * - Plump tilted crimson octopus head with festive white/gold twisted hachimaki headband & expressive eyes
 * - 8 curling multi-segment tentacles with ivory suction-cup discs
 * - Cedar wood takoyaki boat (舟皿) filled with 5 golden-brown 3D takoyaki spheres & sauce glaze
 */
export function addGiant3DOctopus(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const red = mats.kaniRed ?? mats.accentRed;
  const cream = mats.kaniCream ?? mats.vendWhite;
  const gold = mats.kaniGold ?? mats.archGoldTrim;
  const eyeBlack = mats.carTrimBlack ?? mats.darkMetal;
  const s = scale;

  for (const bx of [-0.65 * s, 0.65 * s]) {
    sub.addBox(mats.darkMetal, 0.08 * s, 0.08 * s, 0.38 * s, bx, 0.1 * s, -0.18 * s);
  }

  // 1. Bulbous tilted crimson octopus mantle head + twisted festival Hachimaki headband (鉢巻)
  sub.addProto(red, PROTO_SPHERE, 0.05 * s, 0.52 * s, 0.24 * s, 0.68 * s, 0.82 * s, 0.52 * s, -0.12, 0, -0.10);
  // Twisted white cloth hachimaki ring around brow + knot on temple
  sub.addProto(cream, PROTO_CYL12, 0.03 * s, 0.68 * s, 0.26 * s, 0.66 * s, 0.13 * s, 0.50 * s, 0.06, 0, -0.10);
  sub.addProto(gold, PROTO_SPHERE, -0.58 * s, 0.76 * s, 0.38 * s, 0.14 * s, 0.14 * s, 0.12 * s);
  // Expressive white eyes + black pupils + round funnel mouth (漏斗)
  for (const sx of [-1, 1]) {
    sub.addProto(cream, PROTO_SPHERE, sx * 0.26 * s, 0.34 * s, 0.66 * s, 0.16 * s, 0.18 * s, 0.10 * s);
    sub.addProto(eyeBlack, PROTO_SPHERE, sx * 0.24 * s, 0.33 * s, 0.74 * s, 0.09 * s, 0.11 * s, 0.06 * s);
  }
  sub.addProto(red, PROTO_CYL12, 0.42 * s, 0.16 * s, 0.56 * s, 0.13 * s, 0.24 * s, 0.13 * s, Math.PI * 0.42, 0, -0.35);

  // 2. Sweeping curled tentacles with ivory suction-cup discs (吸盤)
  const arms = [
    { x1: 1.15, y1: 0.48, x2: 1.88, y2: 0.78, x3: 2.06, y3: 1.08 },
    { x1: 1.28, y1: 0.06, x2: 1.98, y2: 0.18, x3: 2.15, y3: 0.48 },
    { x1: 1.18, y1: -0.34, x2: 1.82, y2: -0.48, x3: 1.98, y3: -0.22 },
  ];
  for (const sx of [-1, 1]) {
    for (const arm of arms) {
      const p0 = [sx * 0.44 * s, -0.02 * s, 0.22 * s];
      const p1 = [sx * arm.x1 * s, arm.y1 * s, 0.28 * s];
      const p2 = [sx * arm.x2 * s, arm.y2 * s, 0.32 * s];
      const p3 = [sx * arm.x3 * s, arm.y3 * s, 0.26 * s];
      addOrganicLimb(sub, red, null, p0, p1, 0.125 * s);
      addOrganicLimb(sub, red, null, p1, p2, 0.095 * s);
      addOrganicLimb(sub, red, null, p2, p3, 0.065 * s, 0.022 * s);
      sub.addProto(cream, PROTO_SPHERE, p1[0], p1[1] - 0.06 * s, p1[2] + 0.08 * s, 0.055 * s, 0.055 * s, 0.03 * s);
      sub.addProto(cream, PROTO_SPHERE, p2[0], p2[1] - 0.05 * s, p2[2] + 0.07 * s, 0.045 * s, 0.045 * s, 0.025 * s);
    }
  }

  // 3. Giant Hinoki cedar boat tray (たこ焼き舟皿) + 5 golden 3D takoyaki balls below!
  sub.addBox(mats.woodWarm, 2.35 * s, 0.26 * s, 0.56 * s, 0, -0.82 * s, 0.34 * s);
  sub.addBox(mats.woodWarm, 2.75 * s, 0.18 * s, 0.44 * s, 0, -0.74 * s, 0.36 * s);
  for (let ti = -2; ti <= 2; ti++) {
    const tx = ti * 0.42 * s;
    sub.addProto(gold, PROTO_SPHERE, tx, -0.54 * s, 0.36 * s, 0.21 * s, 0.20 * s, 0.21 * s);
    // Glossy dark takoyaki sauce cap
    sub.addProto(red, PROTO_SPHERE, tx, -0.46 * s, 0.37 * s, 0.17 * s, 0.11 * s, 0.17 * s);
  }
}

/**
 * Giant 3D Glowing Tiger Pufferfish Lantern (道頓堀 名代とらふぐ立体提灯, ~3.0 m wide):
 * - Plump glowing Washi blowfish body with internal incandescent core & crisp street-facing tiger-spot saddles
 */
export function addGiant3DFugu(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const fuguMat = mats.fuguGlow ?? mats.lanternWarms[0];
  const dark = mats.carTrimBlack ?? mats.darkMetal;
  const cream = mats.kaniCream ?? mats.vendWhite;
  const red = mats.kaniRed ?? mats.accentRed;
  const gold = mats.archGoldTrim;
  const s = scale;

  // Ornate vermilion & gold overhead suspension beam + iron hanging chains
  sub.addBox(mats.accentRed, 2.9 * s, 0.14 * s, 0.56 * s, 0, 1.12 * s, 0.28 * s);
  sub.addBox(gold, 3.0 * s, 0.06 * s, 0.60 * s, 0, 1.20 * s, 0.28 * s);
  for (const cx of [-0.55 * s, 0.55 * s]) {
    sub.addBox(mats.darkMetal, 0.06 * s, 0.06 * s, 0.56 * s, cx, 1.12 * s, 0.0 * s);
    sub.addProto(mats.darkMetal, PROTO_CYL6, cx, 0.80 * s, 0.38 * s, 0.018 * s, 0.60 * s, 0.018 * s);
  }

  // Compact inner incandescent bulb + plump sculpted 3D blowfish Washi shell
  if (mats.chochinCore) {
    sub.addProto(mats.chochinCore, PROTO_BULB_CORE, -0.06 * s, 0.04 * s, 0.38 * s, 0.12 * s, 0.12 * s, 0.12 * s);
  }
  sub.addProto(fuguMat, PROTO_SPHERE, -0.06 * s, 0.04 * s, 0.38 * s, 1.06 * s, 0.74 * s, 0.64 * s, 0, 0.18, 0.04);

  // Sumi-black tiger-fugu dorsal & flank blotches (虎河豚斑紋) proud on the +Z/+Y outer shell!
  for (const [dx, dy, dz, rx, ry, rz] of [
    [-0.16, 0.48, 0.74, 0.32, 0.22, 0.24],
    [0.32, 0.40, 0.72, 0.26, 0.20, 0.22],
    [-0.54, 0.30, 0.68, 0.22, 0.17, 0.20],
    [0.08, 0.18, 0.88, 0.22, 0.16, 0.16],
    [0.54, 0.16, 0.76, 0.20, 0.15, 0.18],
  ]) {
    sub.addProto(dark, PROTO_SPHERE, dx * s, dy * s, dz * s, rx * s, ry * s, rz * s);
  }

  // Crimson & gold pouty mouth ring, expressive bulging eyes & dorsal/pectoral/caudal fins
  sub.addProto(red, PROTO_CYL12, -1.08 * s, 0.02 * s, 0.54 * s, 0.19 * s, 0.10 * s, 0.19 * s, 0, 0.18, Math.PI * 0.5);
  sub.addProto(gold, PROTO_CYL12, -1.12 * s, 0.02 * s, 0.56 * s, 0.15 * s, 0.12 * s, 0.15 * s, 0, 0.18, Math.PI * 0.5);
  sub.addProto(cream, PROTO_SPHERE, -0.72 * s, 0.30 * s, 0.78 * s, 0.16 * s, 0.16 * s, 0.10 * s);
  sub.addProto(dark, PROTO_SPHERE, -0.76 * s, 0.30 * s, 0.86 * s, 0.085 * s, 0.085 * s, 0.055 * s);
  // Dorsal crest fin, fanned tail fin & side pectoral fin
  sub.addBox(red, 0.42 * s, 0.30 * s, 0.06 * s, 0.34 * s, 0.78 * s, 0.38 * s, 0, 0.18, -0.28);
  sub.addBox(cream, 0.54 * s, 0.80 * s, 0.07 * s, 1.10 * s, 0.12 * s, 0.20 * s, 0, 0.18, 0.18);
  sub.addBox(red, 0.14 * s, 0.78 * s, 0.08 * s, 1.32 * s, 0.12 * s, 0.16 * s, 0, 0.18, 0.18);
  sub.addBox(cream, 0.40 * s, 0.28 * s, 0.05 * s, -0.16 * s, -0.06 * s, 0.98 * s, 0.32, 0.42, 0);
}

/**
 * Giant 3D Golden Kushikatsu Skewer Fan & Shrine Crest (鉄板神社・日本一の串かつ 立体黄金串看板):
 * - 5 radiating golden 3D skewers with sculpted golden cutlets + embossed crimson/gold taiko crest
 *   flanked by oversized glowing festival lanterns!
 */
export function addGiant3DGourmetCrest(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const gold = mats.kaniGold ?? mats.archGoldTrim;
  const red = mats.kaniRed ?? mats.accentRed;
  const cream = mats.kaniCream ?? mats.vendWhite;
  const s = scale;

  // 5 radiating golden skewers (黄金串) fanning behind the crest
  for (const ang of [-0.68, -0.34, 0, 0.34, 0.68]) {
    const tipX = Math.sin(ang) * 1.65 * s;
    const tipY = Math.cos(ang) * 1.48 * s - 0.15 * s;
    sub.addStrut(mats.woodWarm, [0, -0.55 * s, 0.14 * s], [tipX, tipY, 0.22 * s], 0.048 * s);
    // Golden-breaded kushikatsu cutlet along upper skewer shaft
    const midX = Math.sin(ang) * 1.08 * s;
    const midY = Math.cos(ang) * 0.98 * s - 0.15 * s;
    sub.addProto(gold, PROTO_SPHERE, midX, midY, 0.24 * s, 0.22 * s, 0.38 * s, 0.14 * s, 0, 0, -ang);
  }

  // Central embossed crimson & champagne-gold taiko drum crest medallion
  sub.addProto(gold, PROTO_CYL12, 0, -0.22 * s, 0.28 * s, 0.68 * s, 0.16 * s, 0.68 * s, Math.PI * 0.5, 0, 0);
  sub.addProto(red, PROTO_CYL12, 0, -0.22 * s, 0.32 * s, 0.58 * s, 0.16 * s, 0.58 * s, Math.PI * 0.5, 0, 0);
  sub.addProto(cream, PROTO_CYL12, 0, -0.22 * s, 0.36 * s, 0.42 * s, 0.14 * s, 0.42 * s, Math.PI * 0.5, 0, 0);

  // Flanking oversized glowing shrine lanterns (大提灯, homage to Reference 1's 鉄板神社 lantern!)
  const lanternMat = mats.festivalLanterns ? mats.festivalLanterns[0] : mats.lanternWarms[0];
  for (const sx of [-1, 1]) {
    const lx = sx * 1.72 * s;
    const ly = -0.08 * s;
    const lz = 0.34 * s;
    sub.addBox(mats.darkMetal, 0.06 * s, 0.06 * s, 0.42 * s, lx, ly + 0.52 * s, 0.14 * s);
    if (mats.chochinCore) {
      sub.addProto(mats.chochinCore, PROTO_BULB_CORE, lx, ly, lz, 0.09 * s, 0.12 * s, 0.09 * s);
    }
    sub.addProto(lanternMat, PROTO_CHOCHIN_RICH, lx, ly, lz, 0.34 * s, 0.44 * s, 0.34 * s);
    sub.addProto(mats.darkMetal, PROTO_CYL12, lx, ly + 0.45 * s, lz, 0.17 * s, 0.06 * s, 0.17 * s);
    sub.addProto(mats.darkMetal, PROTO_CYL12, lx, ly - 0.45 * s, lz, 0.16 * s, 0.06 * s, 0.16 * s);
  }
}

/**
 * Multi-Storey Stacked Projecting Vertical Sign Tower (多段突き出し縦看板, Reference 3!):
 * Projects into the commercial canyon inside a sleek 3D dark-steel structural outrigger cage.
 */
export function addStackedSignTower(lot, mats, towerIdx, {
  x, yBot = 4.6, z, height = 8.4, width = 0.78,
}) {
  const pool = mats.towerSigns;
  if (!pool || !pool.length) return;
  const signBucket = pool[((towerIdx % pool.length) + pool.length) % pool.length];
  const thick = 0.22;
  const cy = yBot + height * 0.5;
  const standoff = 0.20;
  const sz = z + standoff + width * 0.5;

  // Heavy steel outrigger mounting struts + diagonal truss ties back to building pilaster
  for (const frac of [0.12, 0.50, 0.88]) {
    const by = yBot + height * frac;
    lot.addBox(mats.darkMetal, 0.07, 0.07, standoff + 0.12, x, by, z + standoff * 0.5);
    lot.addStrut(mats.darkMetal, [x, by - 0.28, z + 0.02], [x, by, z + standoff + 0.04], 0.042);
  }

  // 3D dark anodized steel perimeter frame + champagne-gold corner caps
  lot.addBox(mats.darkMetal, thick + 0.04, 0.065, width + 0.07, x, yBot + height + 0.02, sz);
  lot.addBox(mats.darkMetal, thick + 0.04, 0.065, width + 0.07, x, yBot - 0.02, sz);
  lot.addBox(mats.darkMetal, thick + 0.04, height, 0.055, x, cy, sz - width * 0.5 - 0.02);
  lot.addBox(mats.darkMetal, thick + 0.04, height, 0.055, x, cy, sz + width * 0.5 + 0.02);
  lot.addBox(mats.archGoldTrim, thick + 0.06, 0.04, width + 0.09, x, yBot + height + 0.055, sz);

  // 3-tier stacked graphic lightbox (readable from both directions along the boulevard!)
  lot.add(signBucket, signBox(width, height, thick), x, cy, sz, 0, Math.PI * 0.5, 0);
}

/**
 * Rooftop Landmark Neon/LED Crown Billboard on an Open Steel Truss Frame (屋上広告塔, Reference 2!):
 */
export function addRooftopBillboard(lot, mats, crownIdx, {
  w = 7.4, h = 3.5, yRoof, zFront,
}) {
  const pool = mats.rooftopSigns;
  if (!pool || !pool.length) return;
  const signBucket = pool[((crownIdx % pool.length) + pool.length) % pool.length];
  const legH = 0.85;
  const signY = yRoof + legH + h * 0.5;
  const zSign = zFront - 0.42;
  const braceBackZ = zSign - 1.85;

  // Open steel space-frame support columns + diagonal wind braces (屋上鉄骨やぐら)
  const posts = 4;
  for (let i = 0; i < posts; i++) {
    const px = -w * 0.42 + (w * 0.84 * i) / (posts - 1);
    lot.addBox(mats.darkMetal, 0.11, legH + h, 0.11, px, yRoof + (legH + h) * 0.5, zSign - 0.18);
    lot.addStrut(mats.darkMetal, [px, yRoof + legH + h * 0.82, zSign - 0.18], [px, yRoof + 0.1, braceBackZ], 0.08);
    lot.addStrut(mats.darkMetal, [px, yRoof + legH + h * 0.35, zSign - 0.18], [px, yRoof + 0.1, braceBackZ * 0.5 + zSign * 0.5], 0.065);
  }
  // Horizontal steel truss girts & maintenance catwalk ledge
  lot.addBox(mats.darkMetal, w * 0.90, 0.09, 0.09, 0, yRoof + legH + h * 0.82, zSign - 0.18);
  lot.addBox(mats.darkMetal, w * 0.90, 0.09, 0.09, 0, yRoof + legH + 0.12, zSign - 0.18);
  lot.addBox(mats.silverMetal, w * 0.94, 0.05, 0.46, 0, yRoof + legH - 0.08, zSign + 0.24);

  // Dark steel cabinet + champagne-gold trim bezel + front-facing neon/LED crown panel
  lot.addBox(mats.darkMetal, w + 0.16, h + 0.16, 0.24, 0, signY, zSign);
  lot.addBox(mats.archGoldTrim, w + 0.22, 0.08, 0.28, 0, signY + h * 0.5 + 0.06, zSign);
  lot.add(signBucket, frontFaceBox(w, h, 0.26, 0.005, 0.005), 0, signY, zSign + 0.04);

  // 4 overhead gooseneck floodlight arms illuminating the rooftop billboard
  for (let s = 0; s < 4; s++) {
    const sx = -w * 0.36 + (w * 0.72 * s) / 3;
    const topY = signY + h * 0.5 + 0.10;
    lot.addStrut(mats.darkMetal, [sx, topY, zSign], [sx, topY + 0.28, zSign + 0.58], 0.035);
    lot.addProto(mats.darkMetal, PROTO_BELL_CAP, sx, topY + 0.20, zSign + 0.58, 0.09, 0.12, 0.09, -0.55, 0, 0);
    lot.addProto(mats.warmLamp, PROTO_SPHERE, sx, topY + 0.16, zSign + 0.54, 0.06, 0.06, 0.06);
  }
}

/**
 * Continuous Dotonbori Golden Festival Lantern Colonnade (道頓堀提灯並木, Reference 2!):
 * Runs rhythmically along both sidewalk curbs of the flagship promenade inside the Shotengai gates,
 * proportioned at `railY = 2.96 m` so 1F flagship signboards sit completely unobstructed above!
 */
export function addDotonboriLanternGarland(mats, { x, z0, z1, side = 1 }) {
  const span = z1 - z0;
  if (span < 6.0 || !mats.festivalLanterns?.length) return;
  const lot = new LotContext(x, (z0 + z1) * 0.5, 0, 0);
  const halfLen = span * 0.5;
  const railY = 2.96;
  const lanternY = 2.62;

  // Sleek dark-bronze overhead lintel rail + champagne-gold trim molding + compact rain hood
  lot.addBox(mats.darkMetal, 0.075, 0.075, span + 0.20, 0, railY, 0);
  lot.addBox(mats.archGoldTrim, 0.095, 0.028, span + 0.24, 0, railY + 0.048, 0);
  lot.addBox(mats.darkMetal, 0.38, 0.036, span + 0.26, 0, railY + 0.082, 0);

  // Slender fluted dark-bronze support posts + granite plinth collars every ~11.5 m
  const postIntervals = Math.max(2, Math.round(span / 11.5));
  for (let pi = 0; pi <= postIntervals; pi++) {
    const pz = -halfLen + (span * pi) / postIntervals;
    lot.addProto(mats.concrete, PROTO_CYL12, 0, 0.25, pz, 0.11, 0.12, 0.11);
    lot.addProto(mats.archGoldTrim, PROTO_CYL12, 0, 0.33, pz, 0.082, 0.045, 0.082);
    lot.addProto(mats.darkMetal, PROTO_CYL12, 0, (railY + 0.20) * 0.5, pz, 0.048, railY - 0.16, 0.048);
  }

  // Closely spaced glowing golden festival lanterns (1.32 m pitch -> continuous Dotonbori ribbon of light!)
  const lCount = Math.max(4, Math.floor((span - 1.0) / 1.32));
  for (let li = 0; li < lCount; li++) {
    const lz = -halfLen + 0.68 + ((span - 1.36) * li) / Math.max(1, lCount - 1);
    const lMat = mats.festivalLanterns[(li + (side > 0 ? 0 : 1)) % mats.festivalLanterns.length];
    lot.addProto(mats.darkMetal, PROTO_CYL6, 0, railY - 0.08, lz, 0.010, 0.14, 0.010);
    if (mats.chochinCore) {
      lot.addProto(mats.chochinCore, PROTO_BULB_CORE, 0, lanternY, lz, 0.048, 0.075, 0.048);
    }
    lot.addProto(lMat, PROTO_CHOCHIN_LITE, 0, lanternY, lz, 0.155, 0.225, 0.155, 0, Math.PI * 0.5, 0);
    lot.addProto(mats.darkMetal, PROTO_CYL12, 0, lanternY + 0.23, lz, 0.084, 0.032, 0.084);
    lot.addProto(mats.darkMetal, PROTO_CYL12, 0, lanternY - 0.23, lz, 0.080, 0.032, 0.080);
  }
}

/**
 * One-of-a-Kind Landmark: Kinryu Ramen Sculpted 3D Emerald-Jade & Gold-Horned Dragon (金龍ラーメン立体青龍):
 * Coils dynamically out of a golden sunburst relief frame across the vermilion facade clutching a glowing pearl!
 */
export function addGiant3DDragon(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const jade = mats.dragonJade ?? mats.awningGreen;
  const gold = mats.kaniGold ?? mats.archGoldTrim;
  const red = mats.kaniRed ?? mats.accentRed;
  const cream = mats.kaniCream ?? mats.vendWhite;
  const s = scale;

  // Golden-bordered sunburst yellow relief panel behind the emerging dragon head (left bay)
  const hx = -1.05 * s;
  sub.addBox(gold, 2.55 * s, 2.55 * s, 0.14 * s, hx, 0.08 * s, 0.05 * s);
  sub.addBox(cream, 2.32 * s, 2.32 * s, 0.16 * s, hx, 0.08 * s, 0.08 * s);
  // Radial crimson & gold sunburst rays behind dragon head
  for (const ang of [-0.7, -0.35, 0, 0.35, 0.7]) {
    sub.addBox(red, 0.14 * s, 2.1 * s, 0.05 * s, hx, 0.08 * s, 0.16 * s, 0, 0, ang);
  }

  // Fierce sculpted 3D Emerald Dragon Head lunging forward (+Z)
  sub.addProto(jade, PROTO_SPHERE, hx, 0.16 * s, 0.56 * s, 0.56 * s, 0.48 * s, 0.62 * s);
  sub.addProto(jade, PROTO_SPHERE, hx, -0.02 * s, 0.98 * s, 0.40 * s, 0.28 * s, 0.44 * s); // Snout
  sub.addProto(red, PROTO_SPHERE, hx, -0.22 * s, 0.88 * s, 0.32 * s, 0.16 * s, 0.38 * s, 0.22, 0, 0); // Open crimson maw
  // White fangs, bulging golden eyes, flowing golden whiskers & swept antlers!
  for (const sx of [-1, 1]) {
    sub.addProto(cream, PROTO_CONE10, hx + sx * 0.22 * s, -0.14 * s, 1.18 * s, 0.045 * s, 0.18 * s, 0.045 * s, Math.PI, 0, 0);
    sub.addProto(gold, PROTO_SPHERE, hx + sx * 0.34 * s, 0.34 * s, 0.78 * s, 0.13 * s, 0.13 * s, 0.11 * s);
    sub.addProto(mats.carTrimBlack ?? mats.darkMetal, PROTO_SPHERE, hx + sx * 0.36 * s, 0.34 * s, 0.87 * s, 0.065 * s, 0.065 * s, 0.05 * s);
    // Swept golden dragon horns & flowing whiskers
    addOrganicLimb(sub, gold, null, [hx + sx * 0.24 * s, 0.50 * s, 0.48 * s], [hx + sx * 0.56 * s, 1.16 * s, 0.18 * s], 0.065 * s, 0.022 * s);
    addOrganicLimb(sub, gold, null, [hx + sx * 0.30 * s, 0.02 * s, 1.12 * s], [hx + sx * 0.86 * s, 0.22 * s, 1.24 * s], 0.032 * s, 0.012 * s);
  }

  // Sinuous undulating S-curve emerald dragon body coiling across the right facade!
  const spinePts = [
    [hx + 0.42 * s, 0.02 * s, 0.34 * s],
    [0.12 * s, -0.38 * s, 0.56 * s],
    [0.78 * s, 0.36 * s, 0.62 * s],
    [1.46 * s, 0.48 * s, 0.42 * s],
    [1.98 * s, -0.18 * s, 0.52 * s],
    [2.42 * s, 0.18 * s, 0.36 * s],
  ];
  for (let i = 0; i < spinePts.length - 1; i++) {
    const r0 = (0.28 - i * 0.032) * s;
    const r1 = (0.25 - i * 0.032) * s;
    addOrganicLimb(sub, jade, gold, spinePts[i], spinePts[i + 1], r0, r1);
    // Golden dorsal spine crest fin along each coil
    const mx = (spinePts[i][0] + spinePts[i + 1][0]) * 0.5;
    const my = (spinePts[i][1] + spinePts[i + 1][1]) * 0.5 + r0 * 0.85;
    const mz = (spinePts[i][2] + spinePts[i + 1][2]) * 0.5;
    sub.addProto(gold, PROTO_CONE10, mx, my, mz, 0.06 * s, 0.22 * s, 0.08 * s, 0, 0, -0.15);
  }
  // Dragon foreclaw clutching a glowing golden dragon pearl (龍珠)!
  addOrganicLimb(sub, jade, null, [0.05 * s, -0.34 * s, 0.56 * s], [-0.28 * s, -0.78 * s, 0.82 * s], 0.11 * s, 0.06 * s);
  sub.addProto(gold, PROTO_SPHERE, -0.32 * s, -0.84 * s, 0.90 * s, 0.22 * s, 0.22 * s, 0.22 * s);
  if (mats.chochinCore) {
    sub.addProto(mats.chochinCore, PROTO_BULB_CORE, -0.32 * s, -0.84 * s, 0.96 * s, 0.11 * s, 0.11 * s, 0.11 * s);
  }
}

/**
 * One-of-a-Kind Landmark: Osaka Ohsho Giant 3D Crispy Gyoza Platter + 4-Tier `大・阪・王・将` Lantern Rack!
 */
export function addGiant3DGyozaAndRack(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const crust = mats.gyozaCrust ?? mats.woodWarm;
  const dough = mats.kaniCream ?? mats.vendWhite;
  const red = mats.kaniRed ?? mats.accentRed;
  const gold = mats.kaniGold ?? mats.archGoldTrim;
  const s = scale;

  // 1. Semicircular traditional Japanese folding fan crest (`あっぱれ扇`) crowning the platter
  const gx = -0.85 * s;
  for (let fi = -4; fi <= 4; fi++) {
    const ang = fi * 0.18;
    sub.addBox(dough, 0.26 * s, 0.96 * s, 0.06 * s, gx + Math.sin(ang) * 0.62 * s, 1.12 * s + Math.cos(ang) * 0.22 * s, 0.16 * s, 0, 0, -ang);
  }
  sub.addBox(red, 1.48 * s, 0.12 * s, 0.08 * s, gx, 1.42 * s, 0.18 * s);

  // 2. Tilted round porcelain platter + 2 rows of 5 sculpted crescent 3D pan-seared Gyoza!
  const platterSub = sub.subContext(gx, 0.34 * s, 0, -0.06 * s);
  platterSub.addProto(dough, PROTO_CYL12, 0, 0, 0, 1.28 * s, 0.14 * s, 1.28 * s, 1.12, 0, -0.22);
  platterSub.addProto(red, PROTO_CYL12, 0, -0.02 * s, -0.02 * s, 1.34 * s, 0.10 * s, 1.34 * s, 1.12, 0, -0.22);

  for (const rowX of [-0.36, 0.36]) {
    for (let gi = -2; gi <= 2; gi++) {
      const dx = (rowX + gi * 0.05) * s;
      const dy = (gi * 0.34) * s;
      const dz = (0.20 + (2 - Math.abs(gi)) * 0.04) * s;
      // Plump pleated ivory gyoza wrapper + golden-brown crispy seared flat bottom!
      platterSub.addProto(dough, PROTO_SPHERE, dx, dy, dz, 0.36 * s, 0.17 * s, 0.20 * s, 0.15, 0, -0.22);
      platterSub.addBox(crust, 0.62 * s, 0.19 * s, 0.09 * s, dx + 0.03 * s, dy + 0.02 * s, dz + 0.14 * s, 0.15, 0, -0.22);
    }
  }

  // 3. Tall Black Structural Steel Cage holding 4 Vertically Stacked Giant `大・阪・王・将` Lanterns!
  const rx = 1.68 * s;
  const rz = 0.62 * s;
  const rackH = 4.65 * s;
  for (const ox of [-0.54 * s, 0.54 * s]) {
    sub.addBox(mats.darkMetal, 0.07 * s, rackH, 0.07 * s, rx + ox, 0.35 * s, rz);
    sub.addBox(mats.darkMetal, 0.06 * s, 0.06 * s, 0.68 * s, rx + ox, 2.45 * s, rz - 0.32 * s);
    sub.addBox(mats.darkMetal, 0.06 * s, 0.06 * s, 0.68 * s, rx + ox, -1.65 * s, rz - 0.32 * s);
  }
  for (let k = 0; k <= 4; k++) {
    const barY = -1.85 * s + k * (rackH / 4);
    sub.addBox(mats.darkMetal, 1.16 * s, 0.06 * s, 0.06 * s, rx, barY, rz);
  }

  // Slice PROTO_CHOCHIN_LITE UVs per quarter (`大`, `阪`, `王`, `将` top-to-bottom) in 1 single bucket!
  if (mats.ohshoLantern) {
    for (let idx = 0; idx < 4; idx++) {
      const ly = (2.06 - idx * 1.14) * s;
      const vMin = (3 - idx) * 0.25 + 0.008;
      const vSpan = 0.234;
      const g = PROTO_CHOCHIN_LITE.clone();
      const uv = g.attributes.uv;
      for (let vi = 0; vi < uv.count; vi++) {
        uv.setXY(vi, uv.getX(vi), vMin + uv.getY(vi) * vSpan);
      }
      uv.needsUpdate = true;
      g.scale(0.42 * s, 0.48 * s, 0.42 * s);
      sub.add(mats.ohshoLantern, g, rx, ly, rz, 0, Math.PI * 0.5, 0);
      if (mats.chochinCore) {
        sub.addProto(mats.chochinCore, PROTO_BULB_CORE, rx, ly, rz, 0.11 * s, 0.14 * s, 0.11 * s);
      }
      sub.addProto(mats.darkMetal, PROTO_CYL12, rx, ly + 0.48 * s, rz, 0.20 * s, 0.05 * s, 0.20 * s);
      sub.addProto(mats.darkMetal, PROTO_CYL12, rx, ly - 0.48 * s, rz, 0.19 * s, 0.05 * s, 0.19 * s);
    }
  }
  // Side column of 6 small golden festival lanterns flanking the Ohsho rack
  if (mats.festivalLanterns?.length) {
    for (let sm = 0; sm < 6; sm++) {
      const sy = (2.25 - sm * 0.78) * s;
      sub.addProto(mats.festivalLanterns[0], PROTO_CHOCHIN_LITE, rx + 0.74 * s, sy, rz + 0.08 * s, 0.14 * s, 0.18 * s, 0.14 * s);
      sub.addProto(gold, PROTO_CYL8, rx + 0.74 * s, sy + 0.19 * s, rz + 0.08 * s, 0.07 * s, 0.03 * s, 0.07 * s);
    }
  }
}

/**
 * One-of-a-Kind Landmark: Genroku Sushi Giant 3D Glossy Maguro Tuna Nigiri on Hinoki Cedar Geta (元禄寿司 巨大まぐろ握り)!
 */
export function addGiant3DSushiNigiri(lot, mats, { x = 0, y = 6.2, z = 0, scale = 1.0 }) {
  const sub = lot.subContext(x, z, 0, y);
  const tunaRed = mats.kaniRed ?? mats.accentRed;
  const rice = mats.kaniCream ?? mats.vendWhite;
  const s = scale;

  // Heavy wall brackets + Hinoki cedar sushi geta board (寿司下駄)
  for (const bx of [-0.75 * s, 0.75 * s]) {
    sub.addBox(mats.darkMetal, 0.08 * s, 0.08 * s, 0.56 * s, bx, -0.58 * s, 0.12 * s);
    sub.addBox(mats.woodWarm, 0.24 * s, 0.28 * s, 0.92 * s, bx, -0.72 * s, 0.48 * s);
  }
  sub.addBox(mats.woodWarm, 2.65 * s, 0.16 * s, 1.05 * s, 0, -0.52 * s, 0.48 * s, 0.10, -0.14, 0);

  // Two oversized sculpted nigiri pieces (Left: Ruby Hon-Maguro Tuna; Right: Golden Tamago / Salmon with Nori obi!)
  const nigiriSpecs = [
    { dx: -0.62, topMat: tunaRed, nori: false },
    { dx: 0.66, topMat: mats.kaniGold ?? mats.archGoldTrim, nori: true },
  ];
  for (const ng of nigiriSpecs) {
    const nx = ng.dx * s;
    // Plump sculpted white shari rice pillow
    sub.addProto(rice, PROTO_SPHERE, nx, -0.18 * s, 0.50 * s, 0.46 * s, 0.28 * s, 0.32 * s, 0.10, -0.14, 0);
    // Glossy draped neta topping overhanging the shari rice
    sub.addProto(ng.topMat, PROTO_SPHERE, nx, 0.04 * s, 0.52 * s, 0.58 * s, 0.20 * s, 0.38 * s, 0.12, -0.14, -0.06);
    if (ng.nori) {
      sub.addBox(mats.carTrimBlack ?? mats.darkMetal, 0.22 * s, 0.50 * s, 0.78 * s, nx, -0.06 * s, 0.51 * s, 0.10, -0.14, 0);
    }
  }
}

/**
 * One-of-a-Kind Architectural Landmark: Osaka Shochikuza Neo-Renaissance Kabuki Theatre (大阪松竹座, 1923/1997):
 * Stately pale carved-limestone classical facade featuring a monumental 3-storey semicircular triumphal arch,
 * radial stone voussoirs, circular oculi medallions, bronze marquee portico, and festive Kabuki nobori banners!
 */
export function buildShochikuzaTheatre(lot, mats, rnd, { w = 13.6, d = 12.4 }) {
  const bw = w - 0.28;
  const bd = d - 0.60;
  const bz = -0.10;
  const frontZ = bz + bd * 0.5;
  const h1 = 4.65;
  const hUpper = 13.8; // Stately 5-storey classical theatre volume (~18.45 m to cornice)
  const totalH = h1 + hUpper;
  const stone = mats.ivoryStone ?? mats.commUpperLight;
  const trim = mats.warmTravertine ?? mats.concrete;

  // 1. Hollow 1F Theatre Foyer + Classical Limestone Pilasters & Bronze Marquee Portico
  addHollow1FShell(lot, stone, { bw, h1, bd, bz, wallT: 0.24 });
  addRecessedStorefront(lot, mats, rnd, {
    bw: bw - 0.8, h1, frontZ, pierMat: stone, shopKind: 'kissaten',
    fasciaBucket: null, shutterMat: mats.darkMetal, withFascia: false, roomDepth: 4.4,
  });

  // Dark bronze classical portico marquee + fluted columns + warm twin theatre globe sconces
  const portW = bw - 0.6;
  const portD = 1.65;
  lot.addBox(mats.darkMetal, portW, 0.24, portD, 0, 3.52, frontZ + portD * 0.5);
  lot.addBox(mats.archGoldTrim, portW + 0.08, 0.06, portD + 0.08, 0, 3.66, frontZ + portD * 0.5);
  for (const cx of [-portW * 0.42, -portW * 0.16, portW * 0.16, portW * 0.42]) {
    if (Math.abs(cx) > portW * 0.3) {
      lot.addProto(mats.darkMetal, PROTO_CYL12, cx, 1.76, frontZ + portD - 0.18, 0.11, 3.52, 0.11);
      lot.addProto(mats.archGoldTrim, PROTO_CYL12, cx, 0.22, frontZ + portD - 0.18, 0.15, 0.14, 0.15);
    }
    lot.addProto(mats.warmLamp, PROTO_SPHERE, cx, 3.22, frontZ + 0.35, 0.13, 0.13, 0.13);
  }

  // Classical `大阪松竹座` plaque + Edo Kabuki wooden billing board (`歌舞伎絵看板`)
  const kabukiFascia = mats.kabukiFascia ?? mats.dotonboriFascias?.[0];
  if (kabukiFascia) {
    lot.addBox(mats.archGoldTrim, 6.2, 1.06, 0.22, 0, 4.28, frontZ + 0.16);
    lot.add(kabukiFascia, signBox(6.0, 0.94, 0.24), 0, 4.28, frontZ + 0.18);
  }
  if (mats.kabukiPoster) {
    for (const sx of [-1, 1]) {
      lot.addBox(mats.woodDark, 2.35, 1.38, 0.14, sx * (bw * 0.31), 2.15, frontZ + 0.12);
      lot.add(mats.kabukiPoster, frontFaceBox(2.20, 1.24, 0.16, 0.005, 0.005), sx * (bw * 0.31), 2.15, frontZ + 0.14);
    }
  }

  // Festive row of colorful Kabuki Nobori theatre banners (`歌舞伎幟`) flanking the portico!
  if (mats.streetFlags?.length) {
    for (const sx of [-1, 1]) {
      for (let bi = 0; bi < 3; bi++) {
        const bx = sx * (bw * 0.26 + bi * 0.68);
        const bzFlag = frontZ + 0.72;
        lot.addProto(mats.woodWarm, PROTO_CYL6, bx, 1.55, bzFlag, 0.018, 2.9, 0.018);
        const flagMat = mats.streetFlags[(bi + (sx > 0 ? 0 : 2)) % mats.streetFlags.length];
        lot.add(flagMat, streetFlagGeometry(0.44, 1.52, 0.014, 0.04), bx, 2.05, bzFlag + 0.02, 0.03 * bi, 0, 0);
      }
    }
  }

  // 2. Upper Neo-Renaissance Limestone Massing + Monumental Semicircular Triumphal Arch!
  lot.add(stone, box(bw, hUpper, bd, 3.2, 3.4), 0, h1 + hUpper * 0.5, bz);
  // Flanking rusticated classical stone piers
  for (const sx of [-1, 1]) {
    lot.add(trim, box(1.65, hUpper, 0.28, 1.65, 3.2), sx * (bw * 0.5 - 0.825), h1 + hUpper * 0.5, frontZ + 0.14);
    // Circular Neo-Renaissance oculus medallion window in upper spandrels!
    const oy = h1 + hUpper - 2.65;
    const ox = sx * (bw * 0.5 - 1.55);
    lot.addProto(trim, PROTO_CYL12, ox, oy, frontZ + 0.18, 0.68, 0.24, 0.68, Math.PI * 0.5, 0, 0);
    lot.addProto(mats.windowLitAmber, PROTO_CYL12, ox, oy, frontZ + 0.22, 0.48, 0.26, 0.48, Math.PI * 0.5, 0, 0);
  }

  // Grand Recessed Triumphal Arch Window (`archR` semicircle + tall vertical classical stone mullions!)
  const archR = Math.min(3.65, (bw - 3.6) * 0.5);
  const archSpringY = h1 + 6.25;
  const archBotY = h1 + 0.85;
  const archRectH = archSpringY - archBotY;
  // Warm amber theatre foyer glazing recessed inside the triumphal arch
  addWindowAssembly(lot, mats, rnd, {
    x: 0, y: archBotY + archRectH * 0.5, z: frontZ, w: archR * 1.92, h: archRectH,
    frameMat: mats.archGoldTrim, style: 'commercial', preferOffice: false, litProb: 1.0,
  });
  // Semicircular lunette glazing fanlight + 13 radial carved-stone voussoir arch blocks + keystone!
  const archSegs = 13;
  for (let i = 0; i < archSegs; i++) {
    const a = (Math.PI * (i + 0.5)) / archSegs;
    const vx = Math.cos(a) * (archR + 0.16);
    const vy = archSpringY + Math.sin(a) * (archR + 0.16);
    const isKeystone = i === 6;
    lot.addBox(
      isKeystone ? mats.archGoldTrim : trim,
      isKeystone ? 0.52 : 0.42,
      isKeystone ? 0.82 : 0.62,
      0.38,
      vx, vy, frontZ + 0.19,
      0, 0, a - Math.PI * 0.5,
    );
  }
  // Vertical limestone mullions subdividing the grand arch into 5 tall classical bays
  for (const frac of [-0.62, -0.22, 0.22, 0.62]) {
    const mx = frac * archR;
    const mTop = archSpringY + Math.sqrt(Math.max(0, archR * archR - mx * mx));
    const mh = mTop - archBotY;
    lot.add(stone, box(0.22, mh, 0.28, 0.22, 3.0), mx, archBotY + mh * 0.5, frontZ + 0.14);
  }
  // Horizontal spandrel entablature across mid-arch
  lot.add(trim, box(archR * 2.0, 0.34, 0.30, 3.0, 0.34), 0, h1 + 3.65, frontZ + 0.15);

  // Classical Dentil Cornice Crown & Balustrade Parapet
  lot.add(trim, box(bw + 0.48, 0.48, bd + 0.48, 3.2, 0.48), 0, totalH - 0.42, bz);
  lot.addBox(mats.archGoldTrim, bw + 0.56, 0.09, bd + 0.56, 0, totalH - 0.14, bz);
  const dentilN = Math.round(bw / 0.48);
  for (let di = 0; di <= dentilN; di++) {
    const dx = -bw * 0.48 + (bw * 0.96 * di) / dentilN;
    lot.addBox(stone, 0.18, 0.22, 0.24, dx, totalH - 0.72, frontZ + 0.22);
  }
  lot.addBox(mats.roofConcrete, bw + 0.24, 0.28, bd + 0.24, 0, totalH + 0.14, bz);
  lot.add(stone, box(bw + 0.32, 0.78, 0.32, 3.0, 0.78), 0, totalH + 0.52, frontZ);

  // Side-elevation arched windows so cross-street views read with matching classical dignity
  for (const sx of [-1, 1]) {
    for (const fy of [h1 + 2.2, h1 + 5.8, h1 + 9.4]) {
      for (const szOff of [-bd * 0.24, bd * 0.24]) {
        addWindowAssembly(lot, mats, rnd, {
          x: sx * bw * 0.5, y: fy, z: bz + szOff, w: 1.85, h: 2.25, rotY: sx * Math.PI * 0.5,
          frameMat: mats.archGoldTrim, style: 'commercial', preferOffice: false, litProb: 0.82,
        });
      }
    }
  }
}

/**
 * One-of-a-Kind Architectural Landmark: Dotonbori Imai Sukiya Flagship (道頓堀 今井 本店):
 * Serene 3-storey traditional Osaka culinary sanctuary with fine vertical Hinoki cedar lattice,
 * tiered kawara eaves, glowing square wooden Andon sign lantern, white linen Noren, and a weeping willow!
 */
export function buildDotonboriImaiSukiya(lot, mats, rnd, { w = 9.8, d = 11.8 }) {
  const bw = w - 0.36;
  const bd = d - 0.80;
  const bz = -0.15;
  const frontZ = bz + bd * 0.5;
  const h1 = 3.85;
  const h2 = 3.25;
  const h3 = 2.95;

  // 1F Hinoki cedar Sukiya storefront + warm interior
  addHollow1FShell(lot, mats.woodWarm, { bw, h1, bd, bz, wallT: 0.20 });
  addRecessedStorefront(lot, mats, rnd, {
    bw, h1, frontZ, pierMat: mats.woodWarm, shopKind: 'izakaya',
    fasciaBucket: null, shutterMat: mats.woodWarm, withFascia: false, roomDepth: 3.8,
  });

  // Fine-pitch vertical Hinoki cedar architectural lattice screen (`千本格子`) framing left bay & 2F!
  const slatN = Math.round((bw * 0.42) / 0.14);
  for (let i = 0; i <= slatN; i++) {
    const sx = -bw * 0.46 + i * 0.14;
    lot.addBox(mats.woodWarm, 0.038, 2.75, 0.08, sx, 1.56, frontZ + 0.08);
  }

  // Tier 1 clay kawara lean-to eave (`一文字瓦庇`) + crisp pure-white 4-panel linen Noren (`手打蕎麦` / `今井`)
  buildLeanToEave(lot, mats, {
    x: 0, y: h1 + 0.08, z: frontZ - 0.04, w: bw + 0.44, depth: 1.18, drop: 0.30, roofBucket: mats.kawaraDark,
  });
  addMultiPanelNoren(lot, mats, mats.norenSets[2], {
    x: bw * 0.14, y: 2.38, z: frontZ + 0.24, totalW: 2.65, panelH: 0.78,
  });

  // Traditional square wooden Andon sign lantern (`木製行燈`) + subtle horizontal calligraphy plaque
  lot.addBox(mats.woodDark, 0.58, 0.92, 0.46, -bw * 0.04, 2.35, frontZ + 0.34);
  lot.addBox(mats.chochinCore ?? mats.warmLamp, 0.46, 0.78, 0.36, -bw * 0.04, 2.35, frontZ + 0.35);
  if (mats.imaiFascia) {
    lot.addBox(mats.woodDark, 3.8, 0.74, 0.14, 0, h1 + 0.52, frontZ + 0.22);
    lot.add(mats.imaiFascia, signBox(3.64, 0.62, 0.16), 0, h1 + 0.52, frontZ + 0.24);
  }

  // 2F Shikkui white plaster + full-width Hinoki mushiko/koshido lattice + Tier 2 kawara eave!
  lot.add(mats.shikkuiWall, box(bw - 0.24, h2, bd - 0.36, 3.0, h2), 0, h1 + h2 * 0.5, bz - 0.12);
  for (const wx of [-bw * 0.25, bw * 0.25]) {
    addWindowAssembly(lot, mats, rnd, {
      x: wx, y: h1 + 1.58, z: bz - 0.12 + (bd - 0.36) * 0.5, w: 2.15, h: 1.38,
      frameMat: mats.woodWarm, style: 'koshido', hasShutter: false, litProb: 0.85,
    });
  }
  buildLeanToEave(lot, mats, {
    x: 0, y: h1 + h2 + 0.06, z: frontZ - 0.22, w: bw + 0.20, depth: 0.86, drop: 0.24, roofBucket: mats.kawaraDark,
  });

  // 3F Setback Sukiya Tea-Room Penthouse + Traditional Kirizuma Clay-Tile Gabled Roof!
  const w3 = bw - 0.9;
  const d3 = bd - 1.4;
  lot.add(mats.shikkuiWall, box(w3, h3, d3, 3.0, h3), 0, h1 + h2 + h3 * 0.5, bz - 0.45);
  addWindowAssembly(lot, mats, rnd, {
    x: 0, y: h1 + h2 + 1.42, z: bz - 0.45 + d3 * 0.5, w: 2.8, h: 1.22,
    frameMat: mats.woodWarm, style: 'koshido', hasShutter: false, litProb: 0.75,
  });
  buildGabledRoof(lot, mats, {
    x: 0, y: h1 + h2 + h3, z: bz - 0.45, w: w3, d: d3, rise: 1.48, overhang: 0.56,
    ridgeAxis: 'x', roofBucket: mats.kawaraDark, wallBlankBucket: mats.shikkuiBlank, trimBucket: mats.woodDark, isKawara: true, tier: 2,
  });

  // Signature Dotonbori Imai green willow / zelkova tree right beside the stone entrance!
  lot.addBox(mats.concrete, 1.15, 0.32, 0.95, -bw * 0.34, 0.16, frontZ + 0.62);
  addGardenTree(lot, mats, -bw * 0.34, frontZ + 0.62, 1.05, 'leafy', true);
  addPottedPlant(lot, mats, { x: bw * 0.40, z: frontZ + 0.34, scale: 1.1, yaw: 0.8 });
}

/**
 * Builds Either a Unique One-of-a-Kind Osaka Dotonbori Landmark (`landmark` string) OR One of
 * 6 Distinct Non-Mascot Upscale Osaka Minami Architectural Building Typologies (`archStyle = 0..5`)!
 */
export function buildDotonboriFlagship(lot, mats, rnd, {
  w = 10.4, d = 12.2, storeys = 5, seq = 0, landmark = null, archStyle = 0, fasciaIdx = null, withRooftopCrown = false,
}) {
  // Dispatch specialized standalone architectural landmarks directly
  if (landmark === 'shochikuza') {
    buildShochikuzaTheatre(lot, mats, rnd, { w, d });
    return;
  }
  if (landmark === 'imai') {
    buildDotonboriImaiSukiya(lot, mats, rnd, { w, d });
    return;
  }

  const bw = w - 0.32;
  const bd = d - 0.65;
  const bz = -0.10;
  const frontZ = bz + bd * 0.5;
  const h1 = 4.68;
  const floorH = 3.32;
  const upperStoreys = Math.max(2, storeys - 1);
  const hUpper = upperStoreys * floorH;
  const totalH = h1 + hUpper;

  // Determine cladding, canopy, shop interior & fascia palette from `landmark` or `archStyle` (0..5)
  // Non-mascot archStyles:
  //   0: Shinsaibashi Luxury Glass & Brass Curtain-Wall Boutique (dark granite + neon_ring)
  //   1: Taisho-Roman Heritage Brick & Carved Limestone Dining (`はり重 / 北極星` style)
  //   2: Modernist Kengo-Kuma Cedar Timber-Louver Kappo / Matcha House (`宇治茶 / 割烹`)
  //   3: Minami Bright White Cosmetics & Watch Tax-Free Store (`免税コスメ百貨`)
  //   4: Charcoal Honed-Granite & Brass Teppanyaki / Jazz Bar Tower (`千房 / 鉄板焼`)
  //   5: Warm Travertine & Asymmetrical Recessed Atrium Plaza (`心斎橋プラザ`)
  const styleId = ((archStyle % 6) + 6) % 6;

  let stoneMat = mats.warmTravertine ?? mats.commUppers[1];
  let canopyMat = mats.darkMetal;
  let shopKind = 'izakaya';
  let defaultFascia = seq;

  if (landmark === 'kani_doraku') {
    stoneMat = mats.ivoryStone ?? mats.commUpperLight;
    canopyMat = mats.canopyCrimson ?? mats.accentRed;
    shopKind = 'izakaya';
    defaultFascia = 0;
  } else if (landmark === 'kinryu_dragon') {
    stoneMat = mats.canopyCrimson ?? mats.accentRed;
    canopyMat = mats.canopyCrimson ?? mats.accentRed;
    shopKind = 'ramen';
    defaultFascia = 8;
  } else if (landmark === 'osaka_ohsho') {
    stoneMat = mats.commUppers[2]; // Warm terracotta-red brick/tile!
    canopyMat = mats.awningOchre;
    shopKind = 'ramen';
    defaultFascia = 9;
  } else if (landmark === 'genroku_sushi') {
    stoneMat = mats.ivoryStone ?? mats.commUpperLight;
    canopyMat = mats.awningNavy;
    shopKind = 'izakaya';
    defaultFascia = 10;
  } else if (landmark === 'zuboraya_fugu') {
    stoneMat = mats.ivoryStone ?? mats.commUpperLight;
    canopyMat = mats.awningBurgundy;
    shopKind = 'ramen';
    defaultFascia = 4;
  } else if (landmark === 'otako_octopus') {
    stoneMat = mats.warmTravertine ?? mats.commUppers[1];
    canopyMat = mats.canopyCrimson ?? mats.accentRed;
    shopKind = 'izakaya';
    defaultFascia = 2;
  } else if (landmark === 'ebisu_media') {
    stoneMat = mats.charcoalGranite ?? mats.houseDarkWalls[0];
    canopyMat = mats.awningNavy;
    shopKind = 'pharmacy';
    defaultFascia = 7;
  } else if (landmark === 'teppan_shrine') {
    stoneMat = mats.charcoalGranite ?? mats.houseDarkWalls[0];
    canopyMat = mats.awningBurgundy;
    shopKind = 'izakaya';
    defaultFascia = 1;
  } else if (styleId === 0) {
    stoneMat = mats.charcoalGranite ?? mats.houseDarkWalls[0];
    canopyMat = mats.darkMetal;
    shopKind = 'kissaten';
    defaultFascia = 11;
  } else if (styleId === 1) {
    stoneMat = mats.commUppers[2]; // Heritage russet terracotta brick!
    canopyMat = mats.awningBurgundy;
    shopKind = 'kissaten';
    defaultFascia = 12;
  } else if (styleId === 2) {
    stoneMat = mats.houseDarkWalls[2];
    canopyMat = mats.woodDark;
    shopKind = 'kissaten';
    defaultFascia = 13;
  } else if (styleId === 3) {
    stoneMat = mats.ivoryStone ?? mats.commUpperLight;
    canopyMat = mats.awningNavy;
    shopKind = 'pharmacy';
    defaultFascia = 14;
  } else if (styleId === 4) {
    stoneMat = mats.charcoalGranite ?? mats.houseDarkWalls[0];
    canopyMat = mats.awningGreen;
    shopKind = 'izakaya';
    defaultFascia = 3;
  } else {
    stoneMat = mats.warmTravertine ?? mats.commUppers[1];
    canopyMat = mats.darkMetal;
    shopKind = 'bookstore';
    defaultFascia = 15;
  }

  const fasciaPool = mats.dotonboriFascias ?? mats.fasciasAll;
  const chosenFasciaIdx = fasciaIdx !== null ? fasciaIdx : defaultFascia;
  const fasciaBucket = fasciaPool[((chosenFasciaIdx % fasciaPool.length) + fasciaPool.length) % fasciaPool.length];

  // 1. Hollow 1F Storefront & Furnished 3D Dining/Retail Interior
  addHollow1FShell(lot, stoneMat, { bw, h1, bd, bz, wallT: 0.22 });
  addRecessedStorefront(lot, mats, rnd, {
    bw, h1, frontZ, pierMat: stoneMat, shopKind, fasciaBucket: null,
    shutterMat: mats.darkMetal, withFascia: false, roomDepth: Math.min(bd - 0.9, 4.4),
  });

  // 1F Corner Pilaster Trim & Cross-Street Return Windows
  for (const sx of [-1, 1]) {
    const trimM = styleId === 1 ? (mats.ivoryStone ?? mats.concrete) : mats.archGoldTrim;
    lot.addBox(trimM, styleId === 1 ? 0.36 : 0.065, h1 - 0.2, 0.10, sx * (bw * 0.5 - 0.28), h1 * 0.5, frontZ + 0.05);
    lot.addBox(mats.concrete, 0.08, 0.24, bd + 0.06, sx * (bw * 0.5 + 0.02), 0.12, bz);
    for (const szOff of [-bd * 0.26, bd * 0.22]) {
      addWindowAssembly(lot, mats, rnd, {
        x: sx * bw * 0.5, y: 2.02, z: bz + szOff, w: 2.08, h: 1.68, rotY: sx * Math.PI * 0.5,
        frameMat: styleId === 2 ? mats.woodWarm : mats.archGoldTrim,
        style: (shopKind === 'pharmacy' || styleId === 0) ? 'commercial' : 'koshido',
        preferOffice: false, litProb: 0.82,
      });
    }
  }

  // 2. Varied Canopy & Signboard Treatments (Marquee vs Minimalist Cantilever vs Traditional Wood Eave)
  const canW = bw - 0.18;
  const canD = styleId === 0 ? 0.96 : 1.34;
  const canY = 3.22;
  if (styleId === 2) {
    // Contemporary Cedar & Dark-Slate Cantilever Eave
    buildLeanToEave(lot, mats, {
      x: 0, y: 3.36, z: frontZ - 0.02, w: canW + 0.24, depth: 1.15, drop: 0.22, roofBucket: mats.slateRoof,
    });
  } else {
    lot.addBox(canopyMat, canW, 0.15, canD, 0, canY, frontZ + canD * 0.5, styleId === 0 ? 0 : 0.08, 0, 0);
    if (styleId !== 0) {
      lot.addBox(canopyMat, canW, 0.24, 0.07, 0, canY - 0.12, frontZ + canD - 0.02);
    }
    lot.addBox(mats.archGoldTrim, canW + 0.04, 0.042, canD + 0.04, 0, canY + 0.075, frontZ + canD * 0.5, styleId === 0 ? 0 : 0.08, 0, 0);
    for (const tx of [-canW * 0.38, canW * 0.38]) {
      lot.addStrut(mats.archGoldTrim, [tx, h1 - 0.14, frontZ + 0.05], [tx, canY + 0.08, frontZ + canD * 0.84], 0.026);
    }
    // Festoon bulbs ONLY on lively gourmet landmarks & izakaya/teppan fronts (not luxury glass boutiques!)
    if (mats.marqueeBulb && (landmark !== null || styleId === 4)) {
      const nBulbs = Math.max(5, Math.round(canW / 0.92));
      for (let bi = 0; bi < nBulbs; bi++) {
        const bx = -canW * 0.44 + (canW * 0.88 * bi) / (nBulbs - 1);
        lot.addProto(mats.marqueeBulb, PROTO_BULB_CORE, bx, canY - 0.10, frontZ + canD - 0.16, 0.034, 0.034, 0.034);
      }
    }
  }

  // Elevated 1F Flagship Signboard (`y = 4.14 m`, 100% unobstructed above sidewalks & lanterns)
  const mainSignW = Math.min(bw - 0.44, styleId === 0 ? 5.6 : 7.4);
  const mainSignH = styleId === 0 ? 0.86 : 1.04;
  const mainSignY = h1 - 0.54;
  lot.addBox(mats.darkMetal, mainSignW + 0.12, mainSignH + 0.12, 0.20, 0, mainSignY, frontZ + 0.13);
  lot.addBox(mats.archGoldTrim, mainSignW + 0.16, 0.045, 0.24, 0, mainSignY + mainSignH * 0.5 + 0.045, frontZ + 0.13);
  lot.add(fasciaBucket, signBox(mainSignW, mainSignH, 0.22), 0, mainSignY, frontZ + 0.15);

  if (shopKind === 'izakaya' || shopKind === 'ramen' || styleId === 2) {
    const norenSet = mats.norenSets[(seq + styleId) % mats.norenSets.length];
    addMultiPanelNoren(lot, mats, norenSet, {
      x: 0, y: 2.48, z: frontZ + 0.22, totalW: Math.min(bw * 0.46, 2.8), panelH: 0.72,
    });
  }
  for (const sx of [-1, 1]) {
    if (styleId === 1) {
      // Brass globe wall sconces on Taisho-Roman heritage brick facades!
      lot.addBox(mats.darkMetal, 0.06, 0.06, 0.26, sx * (bw * 0.44), 2.72, frontZ + 0.12);
      lot.addProto(mats.warmLamp, PROTO_SPHERE, sx * (bw * 0.44), 2.64, frontZ + 0.24, 0.12, 0.12, 0.12);
    } else {
      addPottedPlant(lot, mats, { x: sx * (bw * 0.42), z: frontZ + 0.36, scale: 1.04, yaw: seq + sx });
    }
  }

  // 3. Upper Architectural Massing
  lot.add(stoneMat, box(bw, hUpper, bd, 3.2, floorH), 0, h1 + hUpper * 0.5, bz);
  for (let f = 0; f <= upperStoreys; f++) {
    const cy = h1 + f * floorH;
    const beltM = styleId === 1 ? (mats.ivoryStone ?? mats.concrete) : mats.concrete;
    lot.addBox(beltM, bw + 0.18, styleId === 1 ? 0.22 : 0.15, bd + 0.18, 0, cy, bz);
  }

  const showcaseH = floorH * 1.82;
  const showcaseCy = h1 + floorH * 0.98;
  const showcaseW = Math.max(3.6, bw - 1.35);
  const sculptureScale = Math.min(1.10, Math.max(0.76, showcaseW / 5.4));

  // 4A. ONE-OF-A-KIND LANDMARK UPPER SHOWCASES (Each occurs at most ONCE in the entire scene!)
  let upperWinStartFloor = 2;

  if (landmark === 'kani_doraku' || landmark === 'otako_octopus' || landmark === 'zuboraya_fugu') {
    const frameM = mats.ivoryStone ?? mats.commUpperLight;
    lot.add(frameM, box(showcaseW + 0.36, 0.24, 0.36, 2.0, 0.24), 0, showcaseCy + showcaseH * 0.5, frontZ + 0.18);
    lot.add(frameM, box(showcaseW + 0.36, 0.22, 0.32, 2.0, 0.22), 0, showcaseCy - showcaseH * 0.5, frontZ + 0.16);
    for (const sx of [-1, 1]) {
      lot.add(frameM, box(0.22, showcaseH, 0.32, 0.22, 2.0), sx * (showcaseW * 0.5 + 0.09), showcaseCy, frontZ + 0.16);
    }
    if (mats.coveWarm) {
      lot.add(mats.coveWarm, frontFaceBox(showcaseW - 0.12, showcaseH - 0.28, 0.06, 0.5, 0.5), 0, showcaseCy, frontZ + 0.04);
    }
    const slatMat = landmark === 'zuboraya_fugu' ? mats.woodWarm : frameM;
    const slatCount = Math.max(12, Math.round(showcaseW / 0.38));
    for (let si = 0; si < slatCount; si++) {
      const lx = -showcaseW * 0.46 + (showcaseW * 0.92 * si) / (slatCount - 1);
      lot.addBox(slatMat, 0.13, showcaseH - 0.26, 0.16, lx, showcaseCy, frontZ + 0.15);
    }
    if (landmark === 'kani_doraku') {
      addGiant3DCrab(lot, mats, { x: 0, y: showcaseCy + 0.12, z: frontZ + 0.30, scale: sculptureScale });
    } else if (landmark === 'otako_octopus') {
      addGiant3DOctopus(lot, mats, { x: 0, y: showcaseCy + 0.18, z: frontZ + 0.30, scale: sculptureScale * 0.96 });
    } else {
      addGiant3DFugu(lot, mats, { x: 0, y: showcaseCy + 0.08, z: frontZ + 0.30, scale: sculptureScale * 0.98 });
    }
  } else if (landmark === 'kinryu_dragon') {
    addGiant3DDragon(lot, mats, { x: 0, y: showcaseCy, z: frontZ + 0.16, scale: sculptureScale * 0.95 });
  } else if (landmark === 'osaka_ohsho') {
    addGiant3DGyozaAndRack(lot, mats, { x: 0, y: showcaseCy + 0.10, z: frontZ + 0.14, scale: sculptureScale * 0.92 });
  } else if (landmark === 'genroku_sushi') {
    if (mats.coveWarm) {
      lot.add(mats.coveWarm, frontFaceBox(showcaseW * 0.88, showcaseH - 0.35, 0.06, 0.5, 0.5), 0, showcaseCy, frontZ + 0.04);
    }
    addGiant3DSushiNigiri(lot, mats, { x: 0, y: showcaseCy + 0.12, z: frontZ + 0.18, scale: sculptureScale * 0.96 });
  } else if (landmark === 'teppan_shrine') {
    if (mats.coveWarm) {
      lot.add(mats.coveWarm, frontFaceBox(showcaseW * 0.88, showcaseH - 0.35, 0.06, 0.5, 0.5), 0, showcaseCy, frontZ + 0.04);
    }
    addGiant3DGourmetCrest(lot, mats, { x: 0, y: showcaseCy + 0.12, z: frontZ + 0.20, scale: sculptureScale * 0.94 });
  } else if (landmark === 'ebisu_media') {
    // Iconic Ebisubashi Multi-Screen Neon & Sprinter Media Wall spanning 2F..top!
    upperWinStartFloor = upperStoreys;
    const sprinterMat = mats.sprinterPoster ?? mats.podiumPosters?.[0];
    const tallH = Math.min(hUpper - 0.8, floorH * 3.1);
    const mainW = Math.min(bw * 0.56, 5.8);
    if (sprinterMat) {
      lot.addBox(mats.darkMetal, mainW + 0.18, tallH + 0.18, 0.20, -bw * 0.16, h1 + tallH * 0.5 + 0.35, frontZ + 0.12);
      lot.add(sprinterMat, frontFaceBox(mainW, tallH, 0.22, 0.005, 0.005), -bw * 0.16, h1 + tallH * 0.5 + 0.35, frontZ + 0.15);
    }
    // Stacked companion neon billboards on right half of the media wall
    if (mats.podiumPosters?.length) {
      const sideW = Math.max(2.4, bw - mainW - 0.95);
      const sx = bw * 0.5 - sideW * 0.5 - 0.28;
      for (let k = 0; k < 2; k++) {
        const pm = mats.podiumPosters[(k * 2 + 1) % mats.podiumPosters.length];
        const ph = (tallH - 0.28) * 0.5;
        const py = h1 + 0.35 + ph * 0.5 + k * (ph + 0.28);
        lot.addBox(mats.darkMetal, sideW + 0.12, ph + 0.12, 0.18, sx, py, frontZ + 0.10);
        lot.add(pm, frontFaceBox(sideW, ph, 0.20, 0.005, 0.005), sx, py, frontZ + 0.13);
      }
    }
  } else {
    // 4B. 6 NON-MASCOT UPSCALE ARCHITECTURAL FACADES (Zero animal sculptures!)
    if (styleId === 0) {
      // Shinsaibashi Luxury Curtain-Wall Boutique + Glowing Neon Ring behind upper glass!
      upperWinStartFloor = 1;
      const glassW = bw - 0.9;
      addWindowAssembly(lot, mats, rnd, {
        x: 0, y: h1 + floorH * 0.52, z: frontZ, w: glassW, h: floorH - 0.42,
        frameMat: mats.archGoldTrim, style: 'commercial', preferOffice: false, litProb: 0.95,
      });
      if (mats.neonRingPoster && upperStoreys >= 3) {
        upperWinStartFloor = 3;
        const nw = Math.min(glassW, 5.4);
        const nh = floorH * 1.72;
        const ny = h1 + floorH * 2.0;
        lot.addBox(mats.archGoldTrim, nw + 0.18, nh + 0.18, 0.14, 0, ny, frontZ + 0.08);
        lot.add(mats.neonRingPoster, frontFaceBox(nw, nh, 0.16, 0.005, 0.005), 0, ny, frontZ + 0.10);
      }
      // Vertical brushed champagne-brass curtain-wall fins
      const finN = Math.max(3, Math.round(bw / 2.2));
      for (let fi = 0; fi <= finN; fi++) {
        const fx = -bw * 0.46 + (bw * 0.92 * fi) / finN;
        lot.addBox(mats.archGoldTrim, 0.06, hUpper, 0.20, fx, h1 + hUpper * 0.5, frontZ + 0.10);
      }
    } else if (styleId === 1) {
      // Taisho-Roman Heritage Brick & Carved Limestone Quoins (`はり重 / 北極星`)
      upperWinStartFloor = 0; // All upper floors get classical arched stone windows!
      const quoinM = mats.ivoryStone ?? mats.concrete;
      for (const sx of [-1, 1]) {
        for (let qy = h1 + 0.35; qy < totalH - 0.3; qy += 0.68) {
          const qw = ((Math.round(qy * 3) % 2) === 0) ? 0.62 : 0.42;
          lot.add(quoinM, box(qw, 0.30, 0.18, 1.0, 0.30), sx * (bw * 0.5 - qw * 0.5 + 0.04), qy, frontZ + 0.08);
        }
      }
    } else if (styleId === 2) {
      // Modernist Kengo-Kuma Horizontal & Vertical Cedar Louver Facade (`宇治茶 辻利 / 割烹`)
      upperWinStartFloor = Math.min(2, upperStoreys);
      const louverSpanH = upperWinStartFloor * floorH - 0.35;
      const louverCy = h1 + upperWinStartFloor * floorH * 0.5;
      if (mats.coveWarm) {
        lot.add(mats.coveWarm, frontFaceBox(bw - 1.2, louverSpanH - 0.2, 0.05, 0.5, 0.5), 0, louverCy, frontZ + 0.03);
      }
      const lRows = Math.max(10, Math.round(louverSpanH / 0.34));
      for (let r = 0; r < lRows; r++) {
        const ly = louverCy - louverSpanH * 0.47 + (louverSpanH * 0.94 * r) / (lRows - 1);
        const shift = ((r % 3) - 1) * 0.14;
        lot.addBox(mats.woodWarm, bw - 0.72, 0.095, 0.22, shift, ly, frontZ + 0.14);
      }
      for (const sx of [-1, 1]) {
        lot.addBox(mats.darkMetal, 0.12, louverSpanH + 0.1, 0.24, sx * (bw * 0.5 - 0.28), louverCy, frontZ + 0.13);
      }
    } else if (styleId === 3) {
      // Minami Bright White Cosmetics, Luxury Watch & Tax-Free Department Store!
      upperWinStartFloor = 2;
      addWindowAssembly(lot, mats, rnd, {
        x: 0, y: h1 + floorH * 0.50, z: frontZ, w: bw - 1.1, h: 2.25,
        frameMat: mats.silverMetal, style: 'commercial', preferOffice: false, litProb: 0.95,
      });
      if (mats.cosmePoster) {
        const pw = Math.min(bw - 1.0, 6.2);
        const ph = floorH - 0.45;
        const py = h1 + floorH * 1.50;
        lot.addBox(mats.silverMetal, pw + 0.16, ph + 0.16, 0.16, 0, py, frontZ + 0.09);
        lot.add(mats.cosmePoster, frontFaceBox(pw, ph, 0.18, 0.005, 0.005), 0, py, frontZ + 0.11);
      }
    } else {
      // Styles 4 & 5: Charcoal-Granite Teppanyaki Tower or Travertine Plaza with 2F–3F Glazed Dining Bays
      upperWinStartFloor = 0;
    }
  }

  // 5. Populate Upper Commercial Windows (Front `upperWinStartFloor..top` + Full Cross-Street Side Elevations!)
  const cols = Math.max(2, Math.min(4, Math.floor((bw - 0.9) / 2.48)));
  const baySpan = (bw - 1.2) / cols;
  const winW = Math.min(2.12, baySpan - 0.36);

  for (let f = 0; f < upperStoreys; f++) {
    const wy = h1 + (f + 0.50) * floorH;
    if (f >= upperWinStartFloor) {
      for (let c = 0; c < cols; c++) {
        const wx = -((cols - 1) * baySpan) * 0.5 + c * baySpan;
        addWindowAssembly(lot, mats, rnd, {
          x: wx, y: wy, z: frontZ, w: winW, h: styleId === 1 ? 1.88 : 2.06,
          frameMat: styleId === 1 ? mats.woodDark : (f % 2 === 0 ? mats.darkMetal : mats.archGoldTrim),
          style: 'commercial', preferOffice: f >= 3, litProb: 0.78,
        });
        // Carved stone semicircular arch eyebrow above 2F/3F Taisho-Roman heritage brick windows!
        if (styleId === 1 && f <= 1) {
          lot.add(mats.ivoryStone ?? mats.concrete, box(winW + 0.24, 0.26, 0.18, 1.5, 0.26), wx, wy + 1.08, frontZ + 0.09);
        }
      }
    }
    // Cross-street side return elevations
    for (const sx of [-1, 1]) {
      for (const szOff of [-bd * 0.24, bd * 0.24]) {
        addWindowAssembly(lot, mats, rnd, {
          x: sx * bw * 0.5, y: wy, z: bz + szOff, w: 2.05, h: 1.92, rotY: sx * Math.PI * 0.5,
          frameMat: styleId === 1 ? mats.woodDark : mats.darkMetal,
          style: 'commercial', preferOffice: f >= 2, litProb: 0.72,
        });
      }
    }
  }

  // Vertical architectural pilasters / brass blades on Styles 4 & 5
  if (styleId === 4 || styleId === 5) {
    for (let c = 0; c <= cols; c++) {
      const fx = -((cols - 1) * baySpan) * 0.5 + (c - 0.5) * baySpan;
      if (Math.abs(fx) < bw * 0.48) {
        lot.addBox(
          styleId === 4 ? mats.archGoldTrim : stoneMat,
          styleId === 4 ? 0.07 : 0.26,
          hUpper,
          0.18,
          fx, h1 + hUpper * 0.5, frontZ + 0.09,
        );
      }
    }
  }

  // 6. Varied Rooftop Termination (Pitched Tile Crown on Heritage/Timber vs Molded Parapet on Towers)
  if (styleId === 1 && storeys <= 4) {
    // Molded classical cornice + low slate hipped roof on Taisho-Roman heritage buildings!
    const stoneTrim = mats.ivoryStone ?? mats.concrete;
    lot.add(stoneTrim, box(bw + 0.42, 0.36, bd + 0.42, 3.0, 0.36), 0, totalH + 0.12, bz);
    lot.add(mats.slateRoof, hippedRoofGeometry(bw + 0.52, 1.15, bd + 0.52, 0.16), 0, totalH + 0.32, bz);
  } else {
    const pt = 0.26;
    lot.addBox(mats.roofConcrete, bw + 0.20, 0.24, bd + 0.20, 0, totalH + 0.12, bz);
    lot.addBox(mats.concrete, bw + pt, 0.68, pt, 0, totalH + 0.46, frontZ);
    lot.addBox(mats.archGoldTrim, bw + pt + 0.10, 0.08, pt + 0.12, 0, totalH + 0.82, frontZ);
    lot.addBox(mats.concrete, bw + pt, 0.48, pt, 0, totalH + 0.36, bz - bd * 0.5);
    lot.addBox(mats.concrete, pt, 0.48, bd, -bw * 0.5, totalH + 0.36, bz);
    lot.addBox(mats.concrete, pt, 0.48, bd, bw * 0.5, totalH + 0.36, bz);

    if (withRooftopCrown && storeys >= 5) {
      addRooftopBillboard(lot, mats, seq, {
        w: Math.min(bw * 0.86, 8.0),
        h: 3.4,
        yRoof: totalH + 0.84,
        zFront: frontZ,
      });
    } else {
      lot.add(stoneMat, box(2.5, 2.2, 2.5, 2.5, 2.2), -bw * 0.2, totalH + 1.1, bz - bd * 0.24);
      lot.addBox(mats.roofConcrete, 2.7, 0.16, 2.7, -bw * 0.2, totalH + 2.28, bz - bd * 0.24);
    }
  }

  // 7. Varied Projecting Vertical Signage (Some have 3-tier tower sign, some have single sleeve sign,
  //    and Luxury Glass / Taisho Heritage / Timber Louver facades stay clean & sign-free!)
  const primarySide = seq % 2 === 0 ? 1 : -1;
  if (landmark === 'osaka_ohsho') {
    // Osaka Ohsho already carries its own 4-lantern steel tower rack!
  } else if (landmark !== null || styleId === 3 || styleId === 4) {
    if (storeys >= 5 && (seq % 2 === 0 || landmark === 'ebisu_media' || styleId === 3)) {
      const towerH = Math.min(totalH - h1 - 0.6, 8.8);
      addStackedSignTower(lot, mats, seq * 3 + styleId, {
        x: primarySide * (bw * 0.46),
        yBot: h1 + 0.32,
        z: frontZ + 0.06,
        height: towerH,
        width: 0.76,
      });
    } else {
      addSleeveSign(lot, mats, seq * 5 + styleId, {
        x: primarySide * (bw * 0.45),
        y: h1 + 1.85,
        z: frontZ + 0.05,
      });
    }
  } else if (styleId === 5) {
    addSleeveSign(lot, mats, seq * 7 + 3, {
      x: primarySide * (bw * 0.45),
      y: h1 + 1.85,
      z: frontZ + 0.05,
    });
  }
}
