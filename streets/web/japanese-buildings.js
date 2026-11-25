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
const PROTO_PINE_PAD = ensureIndexedClean(new THREE.CylinderGeometry(0.82, 1.0, 1, 7));
const PROTO_CROWN = ensureIndexedClean(new THREE.DodecahedronGeometry(1, 0));
const PROTO_SPHERE = ensureIndexedClean(new THREE.SphereGeometry(1, 16, 12));
const PROTO_BELL_CAP = ensureIndexedClean(new THREE.CylinderGeometry(0.28, 1.0, 1, 12));
const PROTO_WHEEL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14);
  g.rotateZ(Math.PI / 2);
  return ensureIndexedClean(g);
})();

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

  if (!rich) {
    sub.addBox(fMat, w, h, 0.032, 0, 0, 0.016);
    sub.add(paneMat, frontFaceBox(w - ft * 1.8, h - ft * 1.8, 0.016, 0.5, 0.5), 0, 0, 0.028);
    return;
  }

  // 1. Recessed glass pane (1.2 cm ahead of main wall box, 5.6 cm recessed inside outer jamb!)
  sub.add(paneMat, frontFaceBox(w - ft * 1.4, h - ft * 1.4, 0.016, 0.5, 0.5), 0, 0, 0.012);

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

// ------------------------------------------------------------------ YARD, CARPORT, VEHICLES & TREES

export function addGardenTree(lot, mats, lx, lz, scale = 1.0, style = 'leafy', rich = true) {
  const trunkH = 1.65 * scale;
  lot.addProto(mats.trunk, PROTO_CYL8, lx, trunkH * 0.5, lz, 0.13 * scale, trunkH, 0.13 * scale);
  const foliage = style === 'autumn' ? mats.foliageWarm : (style === 'pine' ? mats.foliagePine : mats.foliageFresh);

  if (style === 'pine') {
    lot.addProto(foliage, PROTO_PINE_PAD, lx, trunkH + 0.15 * scale, lz, 0.88 * scale, 0.44 * scale, 0.88 * scale);
    if (rich) {
      lot.addProto(foliage, PROTO_PINE_PAD, lx - 0.26 * scale, trunkH + 0.62 * scale, lz + 0.16 * scale, 0.66 * scale, 0.38 * scale, 0.66 * scale);
      lot.addProto(foliage, PROTO_PINE_PAD, lx + 0.2 * scale, trunkH + 0.98 * scale, lz - 0.12 * scale, 0.54 * scale, 0.36 * scale, 0.54 * scale);
    }
  } else {
    lot.addProto(foliage, PROTO_CROWN, lx, trunkH + 0.68 * scale, lz, 0.96 * scale, 0.88 * scale, 0.96 * scale);
    if (rich) {
      lot.addProto(foliage, PROTO_CROWN, lx + 0.42 * scale, trunkH + 0.48 * scale, lz + 0.24 * scale, 0.66 * scale, 0.62 * scale, 0.66 * scale);
      lot.addProto(foliage, PROTO_CROWN, lx - 0.36 * scale, trunkH + 0.94 * scale, lz - 0.18 * scale, 0.6 * scale, 0.58 * scale, 0.6 * scale);
    }
  }
}

export function addKeiCar(lot, mats, lx, lz, yaw = 0, bodyBucket = null, isVan = false, withWheels = true) {
  const carBody = bodyBucket ?? mats.carWhite;
  const cw = isVan ? 1.54 : 1.48;
  const cl = isVan ? 3.52 : 3.38;
  const ch = isVan ? 1.82 : 1.64;

  const sub = lot.subContext(lx, lz, yaw, 0);

  // Lower body + bumpers + subtle wheel-well sill trim
  sub.addBox(carBody, cw, 0.56, cl - 0.08, 0, 0.52, 0);
  sub.addBox(mats.darkMetal, cw + 0.02, 0.16, cl + 0.04, 0, 0.29, 0);
  // Greenhouse cabin + sloped windshield & dark reflective glass
  const cabL = isVan ? cl * 0.78 : cl * 0.68;
  const cabZ = isVan ? -0.10 : -0.18;
  const cabH = ch - 0.76;
  sub.addBox(carBody, cw - 0.08, cabH, cabL, 0, 0.80 + cabH * 0.5, cabZ);
  sub.addBox(mats.windowUnlit, cw - 0.04, cabH * 0.62, cabL - 0.14, 0, 0.84 + cabH * 0.48, cabZ);
  // Roof panel cap
  sub.addBox(carBody, cw - 0.12, 0.06, cabL - 0.08, 0, 0.80 + cabH + 0.02, cabZ);

  if (withWheels) {
    // Yellow Kei-car license plates (軽自動車黄色ナンバー) + headlights & red taillights
    sub.addBox(mats.tactileYellow, 0.33, 0.165, 0.025, -0.28, 0.36, cl * 0.5 + 0.02);
    sub.addBox(mats.tactileYellow, 0.33, 0.165, 0.025, 0, 0.38, -cl * 0.5 - 0.02);
    for (const sx of [-1, 1]) {
      sub.addBox(mats.warmLamp, 0.24, 0.13, 0.03, sx * (cw * 0.34), 0.62, cl * 0.5 - 0.03);
      sub.addBox(mats.lanternRed, 0.16, 0.26, 0.03, sx * (cw * 0.41), 0.72, -cl * 0.5 + 0.03);
      // Side mirrors
      sub.addBox(carBody, 0.12, 0.09, 0.14, sx * (cw * 0.5 + 0.05), 0.96, cabZ + cabL * 0.38);
    }
    // Smooth 14-sided tires + silver alloy hubcaps!
    for (const [wx, wz] of [[-cw * 0.46, cl * 0.33], [cw * 0.46, cl * 0.33], [-cw * 0.46, -cl * 0.34], [cw * 0.46, -cl * 0.34]]) {
      sub.addProto(mats.darkMetal, PROTO_WHEEL, wx, 0.28, wz, 0.18, 0.28, 0.28);
      sub.addProto(mats.silverMetal, PROTO_WHEEL, wx + Math.sign(wx) * 0.02, 0.28, wz, 0.16, 0.17, 0.17);
    }
  }
}

export function addBicycleCluster(lot, mats, lx, lz, count = 2, rotY = 0) {
  for (let i = 0; i < count; i++) {
    const ox = lx + i * 0.62;
    lot.addProto(mats.darkMetal, PROTO_WHEEL, ox, 0.31, lz - 0.46, 0.04, 0.3, 0.3, 0, rotY, 0.08);
    lot.addProto(mats.darkMetal, PROTO_WHEEL, ox, 0.31, lz + 0.46, 0.04, 0.3, 0.3, 0, rotY, 0.08);
    lot.addBox(mats.silverMetal, 0.05, 0.45, 0.92, ox, 0.52, lz, 0, rotY, 0.08);
    // Front mamachari wire basket & handlebars
    lot.addBox(mats.darkMetal, 0.28, 0.22, 0.24, ox, 0.78, lz + 0.4, 0, rotY, 0);
    lot.addBox(mats.silverMetal, 0.42, 0.04, 0.04, ox, 0.92, lz + 0.34, 0, rotY, 0);
  }
}

function buildLotExterior(lot, mats, rnd, {
  lotW, lotD, drivewaySide = -1, hasCarport = false, hasCar = false,
  wallStyle = 'block', tier = 2,
}) {
  lot.addBox(mats.lotPad, lotW - 0.25, 0.06, lotD - 0.25, 0, 0.03, 0);

  const wallH = wallStyle === 'hedge' ? 1.05 : 1.18;
  const wallThick = wallStyle === 'hedge' ? 0.38 : 0.15;
  const perimBucket = wallStyle === 'hedge' ? mats.hedge : (wallStyle === 'wood' ? mats.woodDark : mats.blockWall);
  const useBlockUV = wallStyle === 'block' && tier >= 1;

  const wallBox = (w, h, d) => (useBlockUV ? box(w, h, d, 1.6, 0.8) : box(w, h, d));

  lot.add(perimBucket, wallBox(lotW - 0.3, wallH, wallThick), 0, wallH * 0.5, -lotD * 0.5 + 0.2);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), -lotW * 0.5 + 0.2, wallH * 0.5, 0);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), lotW * 0.5 - 0.2, wallH * 0.5, 0);

  const openW = hasCarport || hasCar ? 3.8 : 2.1;
  const wallLen = Math.max(1.2, lotW - openW - 0.6);
  const wallX = -drivewaySide * ((lotW - wallLen) * 0.5 - 0.2);
  lot.add(perimBucket, wallBox(wallLen, wallH * 0.88, wallThick), wallX, wallH * 0.44, lotD * 0.5 - 0.22);
  // Concrete coping cap (笠木) on top of front block wall!
  if (wallStyle === 'block' && tier >= 1) {
    lot.addBox(mats.concrete, wallLen + 0.04, 0.055, wallThick + 0.05, wallX, wallH * 0.88 + 0.025, lotD * 0.5 - 0.22);
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

  const carX = drivewaySide * (lotW * 0.5 - 1.55);
  const carZ = lotD * 0.5 - 2.35;
  if (hasCarport) {
    const sideEdge = drivewaySide * (lotW * 0.5 - 0.34);
    lot.addBox(mats.darkMetal, 0.11, 2.32, 0.11, sideEdge, 1.16, carZ - 1.35);
    lot.addBox(mats.darkMetal, 0.11, 2.32, 0.11, sideEdge, 1.16, carZ + 1.35);
    lot.addBox(mats.darkMetal, 2.58, 0.09, 0.09, carX, 2.28, carZ - 1.35, 0, 0, -drivewaySide * 0.05);
    lot.addBox(mats.darkMetal, 2.58, 0.09, 0.09, carX, 2.28, carZ + 1.35, 0, 0, -drivewaySide * 0.05);
    lot.addBox(mats.carportRoof, 2.58, 0.05, 4.4, carX, 2.35, carZ, 0, 0, -drivewaySide * 0.05);
  }
  if (hasCar) {
    const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
    addKeiCar(lot, mats, carX, carZ, 0, carMat, rnd() < 0.28, tier >= 2);
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

  const w1 = w * 0.54;
  lot.add(wall, box(w1, h1, d, 3.0, 2.85), -driveSide * (w - w1) * 0.5, h1 * 0.5, hz);
  lot.add(wall, box(w, h1, d * 0.45, 3.0, 2.85), 0, h1 * 0.5, hz - d * 0.275);
  lot.addBox(mats.darkMetal, 0.24, h1, 0.24, driveSide * (w * 0.5 - 0.18), h1 * 0.5, hz + d * 0.5 - 0.2);

  if (tier >= 1 && rnd() < 0.72) {
    const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
    addKeiCar(lot, mats, driveSide * (w * 0.23), hz + d * 0.24, 0, carMat, false, tier >= 2);
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
    lot.add(mats.windowLitAmber, frontFaceBox(1.26, 1.88, 0.04, 0.5, 0.5), driveSide * (w * 0.24), 1.32, hz + d * 0.5 + 0.05);
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

function addChochinRow(lot, mats, { x0, x1, y, z, count = 3, red = true }) {
  const mat = red ? mats.lanternRed : mats.lanternWarm;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const lx = x0 + (x1 - x0) * t;
    // Hanging wire stem from eave + top/bottom wooden caps + plump paper lantern body
    lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y + 0.34, z, 0.012, 0.18, 0.012);
    lot.addProto(mat, PROTO_SPHERE, lx, y, z, 0.19, 0.25, 0.19);
    lot.addProto(mats.darkMetal, PROTO_CYL8, lx, y + 0.24, z, 0.11, 0.045, 0.11);
    lot.addProto(mats.darkMetal, PROTO_CYL8, lx, y - 0.24, z, 0.10, 0.045, 0.10);
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
 * Builds a recessed ground-floor commercial shopfront bay (`recess = 0.32 m`) with corner pilasters,
 * granite threshold, overhead roll-up shutter box, soffit downlights, and clamped 3D fascia signboard!
 */
function addRecessedStorefront(lot, mats, {
  bw, h1, frontZ, pierMat, shopBayMat, fasciaBucket, shutterMat = null, withFascia = true,
}) {
  const pierW = 0.38;
  const recess = 0.32;
  const innerW = Math.max(1.8, bw - pierW * 2);
  const bayCount = Math.max(1, Math.round(innerW / 3.1));
  const bayTileW = innerW / bayCount;
  const bayH = h1 - 0.62;

  // Left & right structural facade pilasters (柱)
  lot.add(pierMat, box(pierW, h1, recess + 0.18, 1.2, 2.8), -bw * 0.5 + pierW * 0.5, h1 * 0.5, frontZ - recess * 0.5);
  lot.add(pierMat, box(pierW, h1, recess + 0.18, 1.2, 2.8), bw * 0.5 - pierW * 0.5, h1 * 0.5, frontZ - recess * 0.5);

  // Recessed shopfront glazing/doorway wall (integer bays -> zero sliced text/doors!)
  lot.add(shopBayMat, box(innerW, bayH, 0.14, bayTileW, bayH), 0, 0.14 + bayH * 0.5, frontZ - recess);

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
  lot.addBox(mats.asphaltApron, w + 1.6, 0.08, d + 2.4, 0, 0.04, 0.6);

  const isLawson = rnd() < 0.5;
  const bw = w - 1.8;
  const bd = d - 3.4;
  const bz = -1.1;
  const h1 = 3.95;
  const frontZ = bz + bd * 0.5;

  lot.add(mats.commUpperLight, box(bw, h1, bd, 3.0, 3.2), 0, h1 * 0.5, bz);
  // Recessed bright Konbini plate-glass front & corner return window (masked emissive!)
  const bayBays = Math.max(2, Math.round((bw - 0.9) / 3.2));
  lot.add(mats.shopKonbiniBay, box(bw - 0.9, 2.95, 0.14, (bw - 0.9) / bayBays, 2.95), 0, 1.54, frontZ - 0.18);
  lot.add(mats.shopKonbiniBay, box(0.14, 2.95, bd * 0.58, bd * 0.58, 2.95), bw * 0.5 - 0.12, 1.54, bz + bd * 0.12);
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

  // Framed roadside Konbini pylon sign (ポール看板 — replaces the blank cyan neon block!)
  const poleX = bw * 0.5 + 0.38;
  const poleZ = d * 0.5 - 0.58;
  lot.addProto(mats.concrete, PROTO_CYL8, poleX, 0.22, poleZ, 0.28, 0.44, 0.28);
  lot.addProto(mats.silverMetal, PROTO_CYL12, poleX, 3.35, poleZ, 0.14, 6.7, 0.14);
  const pylonBucket = isLawson ? mats.konbiniPylonLawson : mats.konbiniPylonFamima;
  const pyW = 1.28;
  const pyH = 1.62;
  // 3D aluminum outer frame + horizontal mounting collars + double-sided pylon lightbox
  lot.addBox(mats.silverMetal, pyW + 0.10, 0.08, 0.30, poleX - 0.72, 6.0 + pyH * 0.5 + 0.03, poleZ);
  lot.addBox(mats.silverMetal, pyW + 0.10, 0.08, 0.30, poleX - 0.72, 6.0 - pyH * 0.5 - 0.03, poleZ);
  lot.addBox(mats.silverMetal, 0.24, 0.10, 0.10, poleX - 0.1, 6.45, poleZ);
  lot.addBox(mats.silverMetal, 0.24, 0.10, 0.10, poleX - 0.1, 5.55, poleZ);
  lot.add(pylonBucket, signBox(pyW, pyH, 0.24), poleX - 0.72, 6.0, poleZ);

  if (detail) {
    // Stainless steel parking bollards + trash/recycle bins + bicycles + parked Kei-van
    for (let bx = -bw * 0.38; bx <= bw * 0.1; bx += 1.65) {
      lot.addProto(mats.silverMetal, PROTO_CYL8, bx, 0.39, frontZ + 0.72, 0.06, 0.78, 0.06);
    }
    for (let gi = 0; gi < 3; gi++) {
      lot.addBox(mats.acUnit, 0.38, 0.76, 0.36, -bw * 0.38 + gi * 0.42, 0.38, frontZ + 0.08);
      lot.addBox(gi === 0 ? mats.vendBlue : mats.darkMetal, 0.36, 0.12, 0.34, -bw * 0.38 + gi * 0.42, 0.80, frontZ + 0.08);
    }
    addBicycleCluster(lot, mats, bw * 0.25, frontZ + 1.05, 3, 0.15);
    if (rnd() < 0.7) {
      const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
      addKeiCar(lot, mats, -bw * 0.22, frontZ + 2.35, Math.PI * 0.5, carMat, true, true);
    }
  }
}

export function buildMachiyaShop(lot, mats, rnd, { w = 7.4, d = 10.5, detail = true, signSeed = 0 }) {
  const isRamen = rnd() < 0.45;
  const shopMat = isRamen ? mats.shopRamen : mats.shopIzakaya;
  const fasciaPool = isRamen ? mats.fasciasRamen : mats.fasciasIzakaya;
  const fasciaBucket = fasciaPool[Math.floor(rnd() * fasciaPool.length)];

  const h1 = 3.68;
  const h2 = 2.95;
  const bw = w - 0.35;
  const bd = d - 0.8;
  const bz = -0.2;
  const frontZ = bz + bd * 0.5;

  lot.add(mats.woodDark, box(bw, h1, bd, 3.0, 3.0), 0, h1 * 0.5, bz);
  addRecessedStorefront(lot, mats, {
    bw, h1, frontZ, pierMat: mats.woodDark, shopBayMat: shopMat,
    fasciaBucket: null, shutterMat: mats.woodDark, withFascia: false,
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
      x0: -bw * 0.34, x1: bw * 0.34, y: 2.58, z: frontZ + 0.68,
      count: bw > 7.5 ? 3 : 2, red: isRamen || rnd() < 0.5,
    });
    addMenuBoardStand(lot, mats, { x: bw * 0.34, z: frontZ + 0.56, yaw: -0.24 });
    addBeerCrateStack(lot, mats, { x: -bw * 0.40, z: frontZ + 0.16, count: rnd() < 0.5 ? 2 : 3, blue: !isRamen });
    lot.addProto(mats.woodDark, PROTO_CYL8, bw * 0.41, 0.19, frontZ + 0.22, 0.20, 0.38, 0.20);
    lot.addProto(mats.foliageFresh, PROTO_CROWN, bw * 0.41, 0.52, frontZ + 0.22, 0.30, 0.30, 0.30);
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

  // Recessed ground-floor storefront + clamped 3D fascia signboard!
  const fasciaBucket = shopEntry.fascias[Math.floor(rnd() * shopEntry.fascias.length)];
  addRecessedStorefront(lot, mats, {
    bw, h1, frontZ, pierMat: upperMat, shopBayMat: shopEntry.bay, fasciaBucket, withFascia: true,
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

  const wall2F = mats.houseLightWalls[Math.floor(rnd() * mats.houseLightWalls.length)];
  const awning = rnd() < 0.5 ? mats.awningGreen : mats.awningBurgundy;
  const fasciaBucket = mats.fasciasKissaten[Math.floor(rnd() * mats.fasciasKissaten.length)];

  lot.add(mats.houseTileWalls[1], box(bw, h1, bd, 3.2, 3.1), 0, h1 * 0.5, 0);
  addRecessedStorefront(lot, mats, {
    bw, h1, frontZ, pierMat: mats.houseTileWalls[1], shopBayMat: mats.shopKissaten, fasciaBucket, withFascia: true,
  });
  // Side street corner return display window (integer 2 bays -> crisp proportions, masked emissive!)
  const sideW = bd * 0.58;
  lot.add(mats.shopKissaten, box(0.14, h1 - 0.65, sideW, sideW * 0.5, h1 - 0.65), bw * 0.5 - 0.08, 0.14 + (h1 - 0.65) * 0.5, bd * 0.08);

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
      lot.addBox(mats.hedge, 0.70, 0.34, 0.28, px, 0.48, frontZ + 0.38);
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
  const h = 5.4;

  lot.add(mats.commUpperLight, box(bw, h, bd, 3.2, 2.8), 0, h * 0.5, bz);
  const fasciaBucket = mats.fasciasPharmacy[Math.floor(rnd() * mats.fasciasPharmacy.length)];
  addRecessedStorefront(lot, mats, {
    bw: bw - 0.4, h1: 3.9, frontZ, pierMat: mats.commUpperLight,
    shopBayMat: mats.shopPharmacy, fasciaBucket, withFascia: false,
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
}
