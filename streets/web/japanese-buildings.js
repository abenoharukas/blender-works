// Architectural building & street-prop generators for a Japanese townscape:
// - 6 distinct Japanese detached house archetypes (一戸建て: Kirizuma, Katanagare,
//   Yosemune, 3F Kyosho-jutaku, Traditional Machiya/Washiki, Courtyard L-house)
// - 5 distinct Japanese neighborhood commercial archetypes (小商圈・商店街:
//   Corner Konbini, Wooden Izakaya/Ramen Machiya, Multi-storey Zakkyo/Pencil Shop,
//   Corner Kissaten/Bakery, Neighborhood Supermarket/Drugstore)
// - Japanese street furniture: concrete utility poles with transformers,
//   shotengai street lamps/arches, vending banks, mamachari bicycles, kei-cars,
//   hedges, concrete block walls, functional gateposts, and garden/avenue trees.
import * as THREE from 'three';

const _mat4 = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _one = new THREE.Vector3(1, 1, 1);

// Pre-built non-indexed unit prototypes for fast instancing without GC churn
function toNonIndexedClean(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

const PROTO_BOX = toNonIndexedClean(new THREE.BoxGeometry(1, 1, 1));
const PROTO_CYL6 = toNonIndexedClean(new THREE.CylinderGeometry(1, 1, 1, 6));
const PROTO_CYL8 = toNonIndexedClean(new THREE.CylinderGeometry(1, 1, 1, 8));
const PROTO_TAPER_POLE = toNonIndexedClean(new THREE.CylinderGeometry(0.65, 1.0, 1, 8));
const PROTO_PINE_PAD = toNonIndexedClean(new THREE.CylinderGeometry(0.82, 1.0, 1, 7));
const PROTO_CROWN = toNonIndexedClean(new THREE.DodecahedronGeometry(1, 0));
const PROTO_SPHERE = toNonIndexedClean(new THREE.SphereGeometry(1, 8, 6));
const PROTO_WHEEL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8);
  g.rotateZ(Math.PI / 2);
  return toNonIndexedClean(g);
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
    return toNonIndexedClean(g);
  }
  const g = PROTO_BOX.clone();
  g.scale(w, h, d);
  return g;
}

/**
 * Signboard box whose front (+Z) and back (-Z) broad faces map [0..1] UV,
 * while the 4 narrow edge faces (+X, -X, +Y, -Y) sample the solid border pixel
 * so text never wraps or squashes onto thin edges.
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
  return toNonIndexedClean(g);
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
export function hippedRoofGeometry(W, rise, D, fasciaH = 0.15, tileW = 2.2, tileH = 2.2) {
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
}

// ------------------------------------------------------------------ roof assemblies

function buildGabledRoof(lot, {
  x = 0, y, z = 0, w, d, rise = 1.3, overhang = 0.45, ridgeAxis = 'x',
  roofBucket, wallBlankBucket, trimBucket,
}) {
  const span = ridgeAxis === 'x' ? d : w;
  const length = ridgeAxis === 'x' ? w : d;
  const rotY = ridgeAxis === 'x' ? Math.PI / 2 : 0;

  lot.add(wallBlankBucket, gableWallGeometry(span, rise, length), x, y, z, 0, rotY, 0);

  const angle = Math.atan2(rise, span / 2);
  const halfOut = span / 2 + overhang;
  const slopeLen = halfOut / Math.cos(angle);
  const dropCenter = (halfOut * 0.5) * Math.tan(angle);
  const cy = y + rise - dropCenter + 0.07;
  const lenOut = length + overhang * 2;

  if (ridgeAxis === 'z') {
    lot.add(roofBucket, box(slopeLen + 0.06, 0.14, lenOut, 1.8, 1.8), x - halfOut * 0.5, cy, z, 0, 0, angle);
    lot.add(roofBucket, box(slopeLen + 0.06, 0.14, lenOut, 1.8, 1.8), x + halfOut * 0.5, cy, z, 0, 0, -angle);
    lot.addBox(trimBucket, 0.26, 0.16, lenOut + 0.04, x, y + rise + 0.13, z);
  } else {
    lot.add(roofBucket, box(lenOut, 0.14, slopeLen + 0.06, 1.8, 1.8), x, cy, z + halfOut * 0.5, angle, 0, 0);
    lot.add(roofBucket, box(lenOut, 0.14, slopeLen + 0.06, 1.8, 1.8), x, cy, z - halfOut * 0.5, -angle, 0, 0);
    lot.addBox(trimBucket, lenOut + 0.04, 0.16, 0.26, x, y + rise + 0.13, z);
  }
}

function buildMonoslopeRoof(lot, {
  x = 0, y, z = 0, w, d, rise = 1.15, overhang = 0.42, highSide = '+x',
  roofBucket, wallBlankBucket, solarBucket = null,
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

  if (highSide === '+x') {
    lot.add(roofBucket, box(slopeLen, 0.14, lenOut, 1.6, 1.6), x, cy, z, 0, 0, angle);
    if (solarBucket) {
      lot.add(solarBucket, box(slopeLen * 0.68, 0.05, lenOut * 0.72, 1.6, 1.6), x + 0.1, cy + 0.1, z, 0, 0, angle);
    }
  } else if (highSide === '-x') {
    lot.add(roofBucket, box(slopeLen, 0.14, lenOut, 1.6, 1.6), x, cy, z, 0, 0, -angle);
    if (solarBucket) {
      lot.add(solarBucket, box(slopeLen * 0.68, 0.05, lenOut * 0.72, 1.6, 1.6), x - 0.1, cy + 0.1, z, 0, 0, -angle);
    }
  } else if (highSide === '+z') {
    lot.add(roofBucket, box(lenOut, 0.14, slopeLen, 1.6, 1.6), x, cy, z, -angle, 0, 0);
    if (solarBucket) {
      lot.add(solarBucket, box(lenOut * 0.72, 0.05, slopeLen * 0.68, 1.6, 1.6), x, cy + 0.1, z + 0.1, -angle, 0, 0);
    }
  } else {
    lot.add(roofBucket, box(lenOut, 0.14, slopeLen, 1.6, 1.6), x, cy, z, angle, 0, 0);
    if (solarBucket) {
      lot.add(solarBucket, box(lenOut * 0.72, 0.05, slopeLen * 0.68, 1.6, 1.6), x, cy + 0.1, z - 0.1, angle, 0, 0);
    }
  }
}

function buildLeanToEave(lot, { x, y, z, w, depth = 1.15, drop = 0.28, roofBucket }) {
  const angle = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  lot.addBox(roofBucket, w, 0.1, len, x, y - drop * 0.5, z + depth * 0.5, angle, 0, 0);
}

// ------------------------------------------------------------------ yard, carport, vehicles & trees

export function addGardenTree(lot, mats, lx, lz, scale = 1.0, style = 'leafy', rich = true) {
  const trunkH = 1.65 * scale;
  lot.addProto(mats.trunk, PROTO_CYL6, lx, trunkH * 0.5, lz, 0.13 * scale, trunkH, 0.13 * scale);
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
  const cw = isVan ? 1.56 : 1.48;
  const cl = isVan ? 3.55 : 3.39;
  const ch = isVan ? 1.78 : 1.62;

  const sub = new LotContext(
    lot.cx + lx * Math.cos(lot.yaw) + lz * Math.sin(lot.yaw),
    lot.cz - lx * Math.sin(lot.yaw) + lz * Math.cos(lot.yaw),
    lot.yaw + yaw,
    lot.baseY,
  );

  sub.addBox(carBody, cw, 0.58, cl, 0, 0.52, 0);
  sub.addBox(carBody, cw - 0.08, ch - 0.72, isVan ? cl * 0.78 : cl * 0.68, 0, 0.81 + (ch - 0.72) * 0.5, isVan ? -0.14 : -0.18);
  sub.addBox(mats.glassDark, cw - 0.04, (ch - 0.72) * 0.62, isVan ? cl * 0.72 : cl * 0.62, 0, 0.92 + (ch - 0.72) * 0.38, isVan ? -0.14 : -0.18);
  sub.addBox(mats.darkMetal, cw + 0.02, 0.16, cl + 0.06, 0, 0.3, 0);

  if (withWheels) {
    sub.addBox(mats.tactileYellow, 0.33, 0.16, 0.03, -0.28, 0.36, cl * 0.5 + 0.03);
    sub.addBox(mats.tactileYellow, 0.33, 0.16, 0.03, 0, 0.38, -cl * 0.5 - 0.03);
    for (const [wx, wz] of [[-cw * 0.46, cl * 0.33], [cw * 0.46, cl * 0.33], [-cw * 0.46, -cl * 0.34], [cw * 0.46, -cl * 0.34]]) {
      sub.addProto(mats.darkMetal, PROTO_WHEEL, wx, 0.27, wz, 0.18, 0.27, 0.27);
    }
  }
}

export function addBicycleCluster(lot, mats, lx, lz, count = 2, rotY = 0) {
  for (let i = 0; i < count; i++) {
    const ox = lx + i * 0.62;
    lot.addProto(mats.darkMetal, PROTO_WHEEL, ox, 0.31, lz - 0.46, 0.05, 0.3, 0.3, 0, rotY, 0.08);
    lot.addProto(mats.darkMetal, PROTO_WHEEL, ox, 0.31, lz + 0.46, 0.05, 0.3, 0.3, 0, rotY, 0.08);
    lot.addBox(mats.silverMetal, 0.06, 0.45, 0.92, ox, 0.52, lz, 0, rotY, 0.08);
    lot.addBox(mats.darkMetal, 0.28, 0.22, 0.24, ox, 0.78, lz + 0.4, 0, rotY, 0);
  }
}

function buildLotExterior(lot, mats, rnd, {
  lotW, lotD, drivewaySide = -1, hasCarport = false, hasCar = false,
  wallStyle = 'block', tier = 2,
}) {
  lot.addBox(mats.lotPad, lotW - 0.25, 0.06, lotD - 0.25, 0, 0.03, 0);

  const wallH = wallStyle === 'hedge' ? 1.05 : 1.18;
  const wallThick = wallStyle === 'hedge' ? 0.38 : 0.14;
  const perimBucket = wallStyle === 'hedge' ? mats.hedge : (wallStyle === 'wood' ? mats.woodDark : mats.blockWall);
  const useBlockUV = wallStyle === 'block' && tier >= 1;

  const wallBox = (w, h, d) => (useBlockUV ? box(w, h, d, 1.6, 1.2) : box(w, h, d));

  lot.add(perimBucket, wallBox(lotW - 0.3, wallH, wallThick), 0, wallH * 0.5, -lotD * 0.5 + 0.2);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), -lotW * 0.5 + 0.2, wallH * 0.5, 0);
  lot.add(perimBucket, wallBox(wallThick, wallH, lotD - 0.4), lotW * 0.5 - 0.2, wallH * 0.5, 0);

  const openW = hasCarport || hasCar ? 3.8 : 2.1;
  const wallLen = Math.max(1.2, lotW - openW - 0.6);
  const wallX = -drivewaySide * ((lotW - wallLen) * 0.5 - 0.2);
  lot.add(perimBucket, wallBox(wallLen, wallH * 0.88, wallThick), wallX, wallH * 0.44, lotD * 0.5 - 0.22);

  if (tier === 0) return;

  if (tier >= 2) {
    const gateX = drivewaySide * (lotW * 0.5 - openW - 0.15);
    const gateZ = lotD * 0.5 - 0.35;
    lot.addBox(mats.darkMetal, 0.22, 1.48, 0.12, gateX, 0.74, gateZ);
    lot.addBox(rnd() < 0.45 ? mats.accentRed : mats.silverMetal, 0.32, 0.28, 0.22, gateX, 1.12, gateZ + 0.06);
  }

  const carX = drivewaySide * (lotW * 0.5 - 1.55);
  const carZ = lotD * 0.5 - 2.35;
  if (hasCarport) {
    const sideEdge = drivewaySide * (lotW * 0.5 - 0.34);
    lot.addBox(mats.darkMetal, 0.1, 2.28, 0.1, sideEdge, 1.14, carZ - 1.3);
    lot.addBox(mats.darkMetal, 0.1, 2.28, 0.1, sideEdge, 1.14, carZ + 1.3);
    lot.addBox(mats.carportRoof, 2.55, 0.06, 4.35, carX, 2.32, carZ, 0, 0, -drivewaySide * 0.05);
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
    lot.addBox(mats.concrete, 1.55, 0.18, 1.15, gx, 0.09, gz + 0.48);
    lot.addBox(mats.woodWarm, 0.98, 2.15, 0.12, gx, 1.24, gz + 0.04);
    lot.addBox(mats.darkMetal, 1.68, 0.1, 0.95, gx, 2.48, gz + 0.42);
  }
  if (tier >= 2) {
    lot.addBox(mats.darkMetal, 0.08, 0.55, 0.06, gx + 0.34, 1.18, gz + 0.11);
    lot.addBox(mats.warmLamp, 0.16, 0.22, 0.14, gx + 0.66, 2.02, gz + 0.08);
    lot.addBox(mats.acUnit, 0.78, 0.56, 0.32, gx - 1.45, 0.34, gz + 0.18);
  }

  if (balconyW > 0) {
    const bd = 0.98;
    lot.addBox(mats.concrete, balconyW, 0.16, bd, balconyX, balconyY, balconyZ + bd * 0.5);
    const screenBucket = balconyStyle === 'wood' ? mats.woodWarm : (balconyStyle === 'frosted' ? mats.frostedPanel : mats.balconyWall);
    lot.addBox(screenBucket, balconyW, 1.06, 0.1, balconyX, balconyY + 0.58, balconyZ + bd - 0.05);
    if (tier >= 1) {
      lot.addBox(screenBucket, 0.1, 1.06, bd, balconyX - balconyW * 0.5 + 0.05, balconyY + 0.58, balconyZ + bd * 0.5);
      lot.addBox(screenBucket, 0.1, 1.06, bd, balconyX + balconyW * 0.5 - 0.05, balconyY + 0.58, balconyZ + bd * 0.5);
      lot.addBox(mats.silverMetal, balconyW + 0.04, 0.05, 0.14, balconyX, balconyY + 1.13, balconyZ + bd - 0.05);
    }
  }
}

/** Adds crisp 3D window frames & dark reflective glass panes on street-facing walls. */
function addHouseWindows(lot, mats, { x, zFront, w, d, twoStorey = true, woodFrame = false, tier = 2 }) {
  if (tier < 1) return;
  const frame = woodFrame ? mats.woodDark : mats.darkMetal;
  // 1F street-facing living room window
  const w1x = x - w * 0.2;
  lot.addBox(frame, 1.72, 1.38, 0.08, w1x, 1.48, zFront + 0.03);
  lot.addBox(mats.glassDark, 1.56, 1.22, 0.06, w1x, 1.48, zFront + 0.05);
  if (twoStorey) {
    // Pair of 2F windows
    for (const dx of [-w * 0.24, w * 0.24]) {
      lot.addBox(frame, 1.38, 1.12, 0.08, x + dx, 4.35, zFront + 0.03);
      lot.addBox(mats.glassDark, 1.24, 0.98, 0.06, x + dx, 4.35, zFront + 0.05);
    }
  }
  // Side casement window for 3D relief down residential lanes
  if (tier >= 2) {
    lot.addBox(frame, 0.08, 1.05, 1.28, x + w * 0.5 + 0.03, 4.3, zFront - d * 0.36);
    lot.addBox(mats.glassDark, 0.06, 0.92, 1.14, x + w * 0.5 + 0.05, 4.3, zFront - d * 0.36);
    lot.addBox(frame, 0.08, 1.05, 1.28, x - w * 0.5 - 0.03, 4.3, zFront - d * 0.36);
    lot.addBox(mats.glassDark, 0.06, 0.92, 1.14, x - w * 0.5 - 0.05, 4.3, zFront - d * 0.36);
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

  lot.add(wallMain, box(w, h, d, 3.2, 2.9), hx, 0.06 + h * 0.5, hz);
  buildGabledRoof(lot, {
    x: hx, y: 0.06 + h, z: hz, w, d, rise: 1.38, overhang: 0.48,
    ridgeAxis: rnd() < 0.65 ? 'x' : 'z',
    roofBucket: roof, wallBlankBucket: wallBlank, trimBucket: mats.darkMetal,
  });

  const wingW = w * 0.58;
  const wingD = 1.65;
  const wingH = 2.95;
  const wingX = hx - driveSide * (w * 0.16);
  const wingZ = hz + d * 0.5 + wingD * 0.5 - 0.1;
  lot.add(mats.woodAccentWall, box(wingW, wingH, wingD, 3.2, 2.9), wingX, 0.06 + wingH * 0.5, wingZ);
  buildLeanToEave(lot, {
    x: wingX, y: 0.06 + wingH + 0.18, z: hz + d * 0.5 - 0.1,
    w: wingW + 0.5, depth: wingD + 0.45, drop: 0.42, roofBucket: roof,
  });
  addHouseWindows(lot, mats, { x: hx, zFront: hz + d * 0.5, w, d, twoStorey: true, tier });
  addHouseWindows(lot, mats, { x: wingX, zFront: wingZ + wingD * 0.5, w: wingW, d: wingD, twoStorey: false, woodFrame: true, tier });

  addGenkanAndBalcony(lot, mats, {
    gx: hx + driveSide * (w * 0.24),
    gz: hz + d * 0.5,
    balconyX: wingX,
    balconyY: 3.16,
    balconyW: wingW * 0.92,
    balconyZ: hz + d * 0.5,
    balconyStyle: 'wood',
    tier,
  });

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
  const h = 5.9 + rnd() * 0.35;
  const hx = -driveSide * 0.55;
  const hz = -0.5;

  const wA = w * 0.62;
  const xA = hx - driveSide * (w * 0.18);
  lot.add(wallMain, box(wA, h, d, 3.2, 2.95), xA, 0.06 + h * 0.5, hz);
  buildMonoslopeRoof(lot, {
    x: xA, y: 0.06 + h, z: hz, w: wA, d, rise: 1.25, overhang: 0.4,
    highSide: driveSide > 0 ? '-x' : '+x',
    roofBucket: roof, wallBlankBucket: wallBlank,
    solarBucket: rnd() < 0.72 ? mats.solarRoof : null,
  });
  addHouseWindows(lot, mats, { x: xA, zFront: hz + d * 0.5, w: wA, d, twoStorey: true, tier });

  const wB = w * 0.48;
  const hB = h - 0.75;
  const xB = hx + driveSide * (w * 0.25);
  lot.add(secondaryWall, box(wB, hB, d * 0.88, 3.2, 2.85), xB, 0.06 + hB * 0.5, hz - 0.15);
  lot.add(roof, box(wB + 0.4, 0.16, d * 0.88 + 0.4, 1.8, 1.8), xB, 0.06 + hB + 0.08, hz - 0.15);
  lot.addBox(mats.woodWarm, 1.85, 2.75, 0.35, xB, 1.44, hz + d * 0.44);

  addGenkanAndBalcony(lot, mats, {
    gx: xB,
    gz: hz + d * 0.44,
    balconyX: xA,
    balconyY: 3.14,
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

  lot.add(lowerMat, box(w, h1, d, 3.2, 2.95), hx, 0.06 + h1 * 0.5, hz);
  lot.addBox(mats.concrete, w + 0.14, 0.14, d + 0.14, hx, 0.06 + h1 + 0.02, hz);
  lot.add(upperMat, box(w - 0.12, h2, d - 0.12, 3.2, 2.85), hx, 0.06 + h1 + h2 * 0.5, hz);
  lot.add(roof, hippedRoofGeometry(w + 0.96, 1.45, d + 0.96, 0.16), hx, 0.06 + h1 + h2 + 0.08, hz);
  addHouseWindows(lot, mats, { x: hx, zFront: hz + (d - 0.12) * 0.5, w: w - 0.12, d, twoStorey: true, tier });

  addGenkanAndBalcony(lot, mats, {
    gx: hx + driveSide * (w * 0.22),
    gz: hz + d * 0.5,
    balconyX: hx - driveSide * 0.3,
    balconyY: 0.06 + h1 + 0.12,
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

  if (rnd() < 0.55) {
    buildGabledRoof(lot, {
      x: 0, y: h1 + hUpper, z: hz, w, d, rise: 1.25, overhang: 0.34,
      ridgeAxis: 'z', roofBucket: roof, wallBlankBucket: wallBlank, trimBucket: mats.darkMetal,
    });
  } else {
    buildMonoslopeRoof(lot, {
      x: 0, y: h1 + hUpper, z: hz, w, d, rise: 1.05, overhang: 0.32,
      highSide: '-z', roofBucket: roof, wallBlankBucket: wallBlank, solarBucket: mats.solarRoof,
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

  lot.add(mats.kawaraDark, box(lotW * 0.52, 0.12, 0.42, 1.4, 1.4), -driveSide * (lotW * 0.22), 1.12, lotD * 0.5 - 0.22);

  const w = Math.min(lotW - 2.6, 7.2 + rnd() * 1.6);
  const d = Math.min(lotD - 4.4, 6.4 + rnd() * 1.2);
  const h1 = 2.85;
  const h2 = 2.65;
  const hz = -0.65;

  lot.add(mats.washikiLower, box(w, h1, d, 3.2, 2.85), 0, h1 * 0.5, hz);
  lot.add(mats.shikkuiWall, box(w - 0.3, h2, d - 0.5, 3.2, 2.65), 0, h1 + h2 * 0.5, hz - 0.12);

  buildLeanToEave(lot, {
    x: 0, y: h1 + 0.14, z: hz + d * 0.5 - 0.15,
    w: w + 0.75, depth: 1.18, drop: 0.34, roofBucket: mats.kawaraDark,
  });
  lot.addBox(mats.woodWarm, w * 0.55, 0.32, 0.72, -driveSide * (w * 0.15), 0.16, hz + d * 0.5 + 0.36);

  buildGabledRoof(lot, {
    x: 0, y: h1 + h2, z: hz - 0.12, w: w - 0.3, d: d - 0.5, rise: 1.52, overhang: 0.62,
    ridgeAxis: 'x',
    roofBucket: mats.kawaraDark, wallBlankBucket: mats.shikkuiBlank, trimBucket: mats.woodDark,
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
  lot.add(wallMain, box(w, h, backD, 3.2, 2.9), 0, h * 0.5, backZ);
  lot.add(roof, hippedRoofGeometry(w + 0.65, 1.15, backD + 0.65, 0.14), 0, h + 0.06, backZ);

  const legW = w * 0.44;
  const legD = d * 0.48;
  const legH = 3.15;
  const legX = -driveSide * (w * 0.5 - legW * 0.5);
  const legZ = hz + d * 0.5 - legD * 0.5;
  lot.add(mats.woodAccentWall, box(legW, legH, legD, 3.2, 3.15), legX, legH * 0.5, legZ);
  lot.add(roof, box(legW + 0.36, 0.16, legD + 0.36, 1.8, 1.8), legX, legH + 0.08, legZ);

  const deckX = driveSide * (w * 0.14);
  lot.addBox(mats.woodWarm, w * 0.48, 0.24, legD * 0.82, deckX, 0.12, legZ - 0.1);
  addGardenTree(lot, mats, deckX + driveSide * 0.4, legZ + 0.4, 0.92, rnd() < 0.45 ? 'autumn' : 'leafy', tier >= 1);

  addGenkanAndBalcony(lot, mats, {
    gx: deckX - driveSide * 0.4,
    gz: backZ + backD * 0.5,
    balconyX: deckX,
    balconyY: 3.08,
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

function addSleeveSign(lot, mats, rnd, { x, y, z }) {
  const signBucket = mats.sleeveSigns[Math.floor(rnd() * mats.sleeveSigns.length)];
  const sw = 0.72;
  const sh = 2.25;
  lot.addBox(mats.darkMetal, 0.06, 0.06, 0.56, x, y + sh * 0.34, z + 0.28);
  lot.addBox(mats.darkMetal, 0.06, 0.06, 0.56, x, y - sh * 0.34, z + 0.28);
  lot.add(signBucket, signBox(sw, sh, 0.16), x, y, z + 0.22 + sw * 0.5, 0, Math.PI / 2, 0);
}

function addChochinRow(lot, mats, { x0, x1, y, z, count = 3, red = true }) {
  const mat = red ? mats.lanternRed : mats.lanternWarm;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const lx = x0 + (x1 - x0) * t;
    lot.addProto(mat, PROTO_CYL8, lx, y, z, 0.17, 0.46, 0.17);
    lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y + 0.25, z, 0.12, 0.05, 0.12);
    lot.addProto(mats.darkMetal, PROTO_CYL6, lx, y - 0.25, z, 0.11, 0.05, 0.11);
  }
}

export function buildKonbini(lot, mats, rnd, { w = 13.5, d = 11.5, twoStorey = false, detail = true }) {
  lot.addBox(mats.asphaltApron, w + 1.6, 0.08, d + 2.4, 0, 0.04, 0.6);

  const isLawson = rnd() < 0.5;
  const shopMat = isLawson ? mats.shopKonbiniLawson : mats.shopKonbiniFamima;
  const bw = w - 1.8;
  const bd = d - 3.4;
  const bz = -1.1;
  const h1 = 3.95;

  lot.add(mats.commUpperLight, box(bw, h1, bd, 3.0, 3.2), 0, h1 * 0.5, bz);
  lot.add(shopMat, box(bw + 0.08, h1 - 0.1, 0.18, 3.2, h1 - 0.1), 0, (h1 - 0.1) * 0.5, bz + bd * 0.5 + 0.06);
  lot.add(shopMat, box(0.18, h1 - 0.1, bd * 0.65, 3.2, h1 - 0.1), bw * 0.5 + 0.06, (h1 - 0.1) * 0.5, bz + bd * 0.15);

  let topY = h1;
  if (twoStorey) {
    const h2 = 3.25;
    lot.add(mats.commUpperLight, box(bw, h2, bd, 3.0, 3.25), 0, h1 + h2 * 0.5, bz);
    topY += h2;
  }

  lot.addBox(mats.roofConcrete, bw + 0.3, 0.28, bd + 0.3, 0, topY + 0.14, bz);
  lot.addBox(mats.acUnit, 1.8, 0.95, 1.3, -bw * 0.24, topY + 0.72, bz - 0.8);

  const poleX = bw * 0.5 + 0.35;
  const poleZ = d * 0.5 - 0.55;
  lot.addProto(mats.silverMetal, PROTO_CYL8, poleX, 3.3, poleZ, 0.15, 6.6, 0.15);
  const signBucket = isLawson ? mats.konbiniSignBlue : mats.konbiniSignGreen;
  lot.addBox(signBucket, 1.35, 1.55, 0.32, poleX, 6.2, poleZ);

  if (detail) {
    for (let bx = -bw * 0.38; bx <= bw * 0.1; bx += 1.65) {
      lot.addProto(mats.silverMetal, PROTO_CYL6, bx, 0.39, bz + bd * 0.5 + 0.75, 0.07, 0.78, 0.07);
    }
    addBicycleCluster(lot, mats, bw * 0.25, bz + bd * 0.5 + 1.05, 3, 0.15);
    if (rnd() < 0.7) {
      const carMat = mats.carPalette[Math.floor(rnd() * mats.carPalette.length)];
      addKeiCar(lot, mats, -bw * 0.22, bz + bd * 0.5 + 2.35, Math.PI * 0.5, carMat, true, true);
    }
  }
}

export function buildMachiyaShop(lot, mats, rnd, { w = 7.4, d = 10.5, detail = true }) {
  const isRamen = rnd() < 0.45;
  const shopMat = isRamen ? mats.shopRamen : mats.shopIzakaya;
  const h1 = 3.65;
  const h2 = 2.95;
  const bw = w - 0.35;
  const bd = d - 0.8;
  const bz = -0.2;

  const shopFrontW = bw - 0.2;
  const shopBays = Math.max(1, Math.round(shopFrontW / 3.2));
  const shopTileW = shopFrontW / shopBays;
  lot.add(mats.woodDark, box(bw, h1, bd, 3.0, 3.0), 0, h1 * 0.5, bz);
  lot.add(shopMat, box(shopFrontW, h1 - 0.15, 0.16, shopTileW, h1 - 0.15), 0, (h1 - 0.15) * 0.5, bz + bd * 0.5 + 0.05);
  lot.add(rnd() < 0.55 ? mats.washikiLower : mats.shikkuiWall, box(bw - 0.2, h2, bd - 0.4, 3.0, 2.95), 0, h1 + h2 * 0.5, bz - 0.15);

  const eaveZ = bz + bd * 0.5;
  buildLeanToEave(lot, {
    x: 0, y: h1 + 0.12, z: eaveZ - 0.05,
    w: bw + 0.35, depth: 1.05, drop: 0.3, roofBucket: mats.kawaraDark,
  });

  const norenMat = mats.norens[Math.floor(rnd() * mats.norens.length)];
  lot.add(norenMat, signBox(Math.min(bw * 0.58, 3.4), 0.78, 0.04), -bw * 0.08, 2.48, eaveZ + 0.38);

  if (detail) {
    addChochinRow(lot, mats, {
      x0: -bw * 0.34, x1: bw * 0.34, y: 2.62, z: eaveZ + 0.72,
      count: bw > 7.5 ? 3 : 2, red: isRamen || rnd() < 0.5,
    });
    lot.addBox(mats.woodWarm, 0.48, 0.88, 0.36, bw * 0.36, 0.44, eaveZ + 0.68, 0, -0.22, 0);
    lot.addProto(mats.woodDark, PROTO_CYL6, -bw * 0.38, 0.19, eaveZ + 0.55, 0.21, 0.38, 0.21);
    lot.addProto(mats.foliageFresh, PROTO_CROWN, -bw * 0.38, 0.54, eaveZ + 0.55, 0.32, 0.32, 0.32);
  }

  if (rnd() < 0.75) {
    addSleeveSign(lot, mats, rnd, { x: bw * 0.45, y: h1 + 1.4, z: eaveZ + 0.05 });
  }

  buildGabledRoof(lot, {
    x: 0, y: h1 + h2, z: bz - 0.15, w: bw - 0.2, d: bd - 0.4, rise: 1.45, overhang: 0.48,
    ridgeAxis: 'x',
    roofBucket: mats.kawaraDark, wallBlankBucket: mats.shikkuiBlank, trimBucket: mats.woodDark,
  });
}

export function buildShotengaiBuilding(lot, mats, rnd, { w = 8.2, d = 11.5, storeys = 3, detail = true }) {
  const bw = w - 0.45;
  const bd = d - 0.9;
  const bz = -0.15;
  const h1 = 3.85;
  const upperStoreys = Math.max(1, storeys - 1);
  const floorH = 3.15;
  const hUpper = upperStoreys * floorH;
  const totalH = h1 + hUpper;

  const upperMat = mats.commUppers[Math.floor(rnd() * mats.commUppers.length)];
  const shopMat = mats.shopRetails[Math.floor(rnd() * mats.shopRetails.length)];
  const awningMat = mats.awnings[Math.floor(rnd() * mats.awnings.length)];

  lot.add(upperMat, box(bw, totalH, bd, 3.0, floorH), 0, totalH * 0.5, bz);
  lot.add(shopMat, box(bw - 0.3, h1 - 0.1, 0.18, 3.2, h1 - 0.1), 0, (h1 - 0.1) * 0.5, bz + bd * 0.5 + 0.06);

  const eaveZ = bz + bd * 0.5;
  lot.addBox(awningMat, bw - 0.2, 0.08, 1.25, 0, 2.74, eaveZ + 0.62, 0.26, 0, 0);
  lot.addBox(awningMat, bw - 0.2, 0.24, 0.06, 0, 2.50, eaveZ + 1.21);

  const pt = 0.24;
  lot.addBox(mats.roofConcrete, bw + 0.16, 0.22, bd + 0.16, 0, totalH + 0.11, bz);
  lot.addBox(mats.concrete, bw + pt, 0.58, pt, 0, totalH + 0.42, bz + bd * 0.5);
  lot.addBox(mats.concrete, bw + pt, 0.48, pt, 0, totalH + 0.36, bz - bd * 0.5);
  lot.addBox(mats.concrete, pt, 0.48, bd, -bw * 0.5, totalH + 0.36, bz);
  lot.addBox(mats.concrete, pt, 0.48, bd, bw * 0.5, totalH + 0.36, bz);

  const signSide = rnd() < 0.5 ? -1 : 1;
  addSleeveSign(lot, mats, rnd, {
    x: signSide * (bw * 0.44),
    y: h1 + 1.55,
    z: eaveZ + 0.05,
  });
  if (upperStoreys >= 2 && rnd() < 0.65) {
    addSleeveSign(lot, mats, rnd, {
      x: -signSide * (bw * 0.44),
      y: h1 + floorH + 1.45,
      z: eaveZ + 0.05,
    });
  }

  if (detail) {
    for (let f = 0; f < upperStoreys; f++) {
      const fy = h1 + 0.45 + f * floorH;
      if (rnd() < 0.65) {
        lot.addBox(mats.acUnit, 0.75, 0.54, 0.3, -signSide * (bw * 0.32), fy, eaveZ + 0.2);
      }
    }
    if (rnd() < 0.4) {
      addBicycleCluster(lot, mats, -signSide * (bw * 0.28), eaveZ + 0.85, 2, 0.12);
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
  const h1 = 3.75;
  const h2 = 3.05;

  const wall2F = mats.houseLightWalls[Math.floor(rnd() * mats.houseLightWalls.length)];
  const awning = rnd() < 0.5 ? mats.awningGreen : mats.awningBurgundy;

  lot.add(mats.houseTileWalls[1], box(bw, h1, bd, 3.2, 3.1), 0, h1 * 0.5, 0);
  lot.add(mats.shopKissaten, box(bw - 0.3, h1 - 0.15, 0.16, 3.2, h1 - 0.15), 0, (h1 - 0.15) * 0.5, bd * 0.5 + 0.06);
  lot.add(mats.shopKissaten, box(0.16, h1 - 0.15, bd * 0.68, 3.2, h1 - 0.15), bw * 0.5 + 0.06, (h1 - 0.15) * 0.5, bd * 0.1);

  lot.addBox(awning, bw - 0.2, 0.08, 1.15, 0, 2.72, bd * 0.5 + 0.58, 0.25, 0, 0);
  lot.addBox(awning, 1.15, 0.08, bd * 0.66, bw * 0.5 + 0.58, 2.72, bd * 0.1, 0, 0, -0.25);

  lot.add(wall2F, box(bw - 0.25, h2, bd - 0.25, 3.2, 3.05), 0, h1 + h2 * 0.5, 0);
  lot.add(mats.kawaraBrown, hippedRoofGeometry(bw + 0.65, 1.35, bd + 0.65, 0.15), 0, h1 + h2 + 0.06, 0);

  if (detail) {
    for (const px of [-bw * 0.35, bw * 0.35]) {
      lot.addBox(mats.woodWarm, 0.75, 0.36, 0.34, px, 0.18, bd * 0.5 + 0.45);
      lot.addBox(mats.hedge, 0.68, 0.32, 0.28, px, 0.48, bd * 0.5 + 0.45);
    }
    lot.addProto(mats.warmLamp, PROTO_SPHERE, bw * 0.46, 2.75, bd * 0.5 + 0.35, 0.15, 0.15, 0.15);
  }
}

export function buildNeighborhoodSuper(lot, mats, rnd, { w = 16.5, d = 13.5, detail = true }) {
  lot.addBox(mats.asphaltApron, w + 1.2, 0.08, d + 2.0, 0, 0.04, 0.5);

  const bw = w - 1.6;
  const bd = d - 3.2;
  const bz = -1.0;
  const h = 5.4;

  lot.add(mats.commUpperLight, box(bw, h, bd, 3.2, 2.8), 0, h * 0.5, bz);
  lot.add(mats.shopPharmacy, box(bw - 0.5, 3.85, 0.18, 3.4, 3.85), 0, 1.93, bz + bd * 0.5 + 0.06);

  const headerMat = rnd() < 0.5 ? mats.konbiniSignGreen : mats.accentRed;
  lot.addBox(headerMat, bw + 0.25, 1.25, bd * 0.35, 0, h - 0.5, bz + bd * 0.35);
  lot.addBox(mats.roofConcrete, bw + 0.3, 0.25, bd + 0.3, 0, h + 0.12, bz);

  lot.addBox(mats.darkMetal, bw * 0.88, 0.14, 1.85, 0, 3.45, bz + bd * 0.5 + 0.92);
  for (const cx of [-bw * 0.38, 0, bw * 0.38]) {
    lot.addProto(mats.darkMetal, PROTO_CYL6, cx, 1.72, bz + bd * 0.5 + 1.7, 0.08, 3.45, 0.08);
  }

  lot.addBox(mats.acUnit, 2.4, 1.05, 1.6, -bw * 0.22, h + 0.75, bz - 1.2);
  lot.addBox(mats.acUnit, 1.8, 0.9, 1.3, bw * 0.24, h + 0.68, bz - 1.2);

  if (detail) {
    addBicycleCluster(lot, mats, -bw * 0.34, bz + bd * 0.5 + 1.25, 4, 0.1);
    lot.addBox(mats.vendRed, 0.95, 1.92, 0.74, bw * 0.36, 0.96, bz + bd * 0.5 + 0.52);
    lot.addBox(mats.vendFace, 0.82, 1.28, 0.06, bw * 0.36, 1.18, bz + bd * 0.5 + 0.9);
    lot.addBox(mats.vendBlue, 0.95, 1.92, 0.74, bw * 0.36 - 1.04, 0.96, bz + bd * 0.5 + 0.52);
    lot.addBox(mats.vendFace, 0.82, 1.28, 0.06, bw * 0.36 - 1.04, 1.18, bz + bd * 0.5 + 0.9);
  }
}

// ------------------------------------------------------------------ JAPANESE STREET INFRASTRUCTURE

export function addUtilityPole(mats, x, z, hasTransformer = false, guyDirZ = 0) {
  const lot = new LotContext(x, z, 0, 0);
  lot.addProto(mats.poleConcrete, PROTO_TAPER_POLE, 0, 4.8, 0, 0.21, 9.6, 0.21);
  lot.addBox(mats.konbiniSignBlue, 0.14, 0.68, 0.38, 0, 2.55, 0);

  lot.addBox(mats.darkMetal, 1.95, 0.09, 0.09, 0, 8.95, 0);
  lot.addBox(mats.darkMetal, 1.55, 0.08, 0.08, 0, 8.15, 0);
  lot.addBox(mats.darkMetal, 1.15, 0.07, 0.07, 0, 6.85, 0);

  if (hasTransformer) {
    lot.addProto(mats.silverMetal, PROTO_CYL8, -0.36, 7.35, 0.18, 0.27, 0.92, 0.27);
    lot.addBox(mats.darkMetal, 0.32, 0.08, 0.24, -0.18, 7.55, 0.08);
  }

  if (guyDirZ !== 0) {
    lot.addProto(mats.tactileYellow, PROTO_CYL6, 0, 1.15, guyDirZ * 0.45, 0.035, 2.4, 0.035, guyDirZ * 0.36, 0, 0);
  }
}

export function addShotengaiLamp(mats, x, z, side = 1, bannerBucket = null) {
  const lot = new LotContext(x, z, 0, 0);
  lot.addProto(mats.darkMetal, PROTO_CYL6, 0, 2.25, 0, 0.1, 4.5, 0.1);
  lot.addBox(mats.darkMetal, 0.95, 0.06, 0.06, -side * 0.42, 4.42, 0);
  lot.addProto(mats.warmLamp, PROTO_SPHERE, -side * 0.86, 4.28, 0, 0.19, 0.19, 0.19);
  lot.addProto(mats.warmLamp, PROTO_SPHERE, side * 0.05, 4.58, 0, 0.15, 0.15, 0.15);

  if (bannerBucket) {
    lot.addBox(mats.silverMetal, 0.52, 0.04, 0.04, -side * 0.28, 3.68, 0);
    lot.addBox(mats.silverMetal, 0.52, 0.04, 0.04, -side * 0.28, 2.62, 0);
    lot.add(bannerBucket, signBox(0.44, 1.02, 0.03), -side * 0.3, 3.15, 0);
  }
}

export function addShotengaiArch(mats, z, halfSpan = 6.3) {
  const lot = new LotContext(0, z, 0, 0);
  for (const s of [-1, 1]) {
    lot.addProto(mats.accentRed, PROTO_CYL8, s * halfSpan, 3.3, 0, 0.22, 6.6, 0.22);
    lot.addProto(mats.darkMetal, PROTO_CYL8, s * halfSpan, 0.23, 0, 0.29, 0.45, 0.29);
  }
  lot.addBox(mats.accentRed, halfSpan * 2 + 0.6, 0.72, 0.52, 0, 6.35, 0);
  lot.add(mats.shotengaiBanner, signBox(6.8, 1.25, 0.64), 0, 6.52, 0);
  for (const lx of [-4.2, -2.1, 2.1, 4.2]) {
    lot.addProto(mats.warmLamp, PROTO_SPHERE, lx, 5.78, 0, 0.18, 0.18, 0.18);
  }
}
