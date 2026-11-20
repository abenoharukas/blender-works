// The street around the models, ported from the ThreeRT study
// `scenes/the-stack2-day.ts` (low-rise frontages, power lines, plaza) onto
// plain three.js primitives. Everything static is merged per material, so the
// whole district costs about twenty draw calls and one shadow pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLOTS, PLOT_CLEAR } from './models.js';

export const STREET = { road: 5.0, walk: 2.1, from: 96, to: 560 };
const FRONT = STREET.road + STREET.walk;

// ------------------------------------------------------------------ randomness
// Fixed seed: the street is the same on every visit, so a view can be compared
// with the last one (and with the ThreeRT render).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x2c9d0);
const between = (a, b) => a + (b - a) * rnd();
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

// ------------------------------------------------------------------ textures
const WALL_TINTS = [
  0xb8ac98, 0x9d9689, 0xc3b9a7, 0x8c7a6d, 0x8f8f8c, 0xa89b87,
  0x77746c, 0x9a938a, 0xb0a58f, 0x8a8880, 0xa89e8a, 0x96887a,
];

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** One bay (3 m) by one floor (3.2 m): plaster, a punched window, a sill and a lintel. */
function facadeTexture(tint) {
  const hex = `#${tint.toString(16).padStart(6, '0')}`;
  return canvasTexture(128, 128, (g) => {
    const shade = (amount) => {
      const channel = (shift) => Math.max(0, Math.min(255, ((tint >> shift) & 255) + amount));
      return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
    };
    g.fillStyle = hex;
    g.fillRect(0, 0, 128, 128);
    // Weathering: a faint vertical wash, so large walls are not flat colour.
    for (let i = 0; i < 7; i++) {
      g.fillStyle = shade(i % 2 ? 5 : -6);
      g.globalAlpha = 0.16;
      g.fillRect(i * 19, 0, between(3, 10), 128);
    }
    g.globalAlpha = 1;
    // Window opening, with the reflection a bright sky puts on day glass.
    g.fillStyle = '#242a2e';
    g.fillRect(26, 27, 76, 58);
    const sky = g.createLinearGradient(0, 27, 0, 85);
    sky.addColorStop(0, 'rgba(190,214,226,.55)');
    sky.addColorStop(0.45, 'rgba(96,120,134,.22)');
    sky.addColorStop(1, 'rgba(30,38,44,0)');
    g.fillStyle = sky;
    g.fillRect(26, 27, 76, 58);
    g.fillStyle = 'rgba(16,20,23,.5)';
    g.fillRect(62, 27, 4, 58);
    g.fillRect(26, 52, 76, 2);
    // Reveal, sill and lintel.
    g.fillStyle = 'rgba(255,255,255,.30)';
    g.fillRect(26, 27, 76, 2);
    g.fillRect(22, 85, 84, 4); // sill
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.fillRect(24, 23, 80, 3); // lintel
    // A little grime under the sill.
    g.fillStyle = 'rgba(0,0,0,.10)';
    g.fillRect(24, 89, 80, 7);
  });
}

/** One shop bay (2.8 m) by the full ground storey (4.3 m), fascia included. */
function shopTexture(variant) {
  const signs = ['#ff7a4c', '#ffc07a', '#a8d8ff'];
  const warm = ['#3a2c20', '#43301f', '#232c31'];
  return canvasTexture(160, 240, (g) => {
    g.fillStyle = '#2b2c30';
    g.fillRect(0, 0, 160, 240);
    // Fascia and its small lit sign.
    g.fillStyle = '#1d1f22';
    g.fillRect(0, 0, 160, 54);
    g.fillStyle = signs[variant % signs.length];
    g.globalAlpha = 0.85;
    g.fillRect(26, 16, 108, 20);
    g.globalAlpha = 1;
    // Glazing.
    const glass = g.createLinearGradient(0, 54, 0, 240);
    glass.addColorStop(0, '#39454b');
    glass.addColorStop(0.5, '#242d32');
    glass.addColorStop(1, warm[variant % warm.length]);
    g.fillStyle = glass;
    g.fillRect(10, 54, 140, 178);
    // Frames, a transom and a dim counter behind the glass.
    g.fillStyle = '#141618';
    g.fillRect(0, 232, 160, 8);
    g.fillRect(0, 54, 10, 186);
    g.fillRect(150, 54, 10, 186);
    g.fillRect(76, 54, 6, 178);
    g.fillRect(6, 118, 148, 4);
    g.fillStyle = 'rgba(255,196,130,.20)';
    g.fillRect(16, 150, 52, 60);
    g.fillStyle = 'rgba(255,236,208,.10)';
    g.fillRect(88, 142, 58, 44);
  });
}

// ------------------------------------------------------------------ geometry
const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

/** Repeats a box's face UVs so one texture tile covers `tileW` x `tileH` metres. */
function tileUV(geometry, w, h, d, tileW, tileH) {
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
}

function boxGeometry(w, h, d, tileW, tileH) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (tileW && tileH) tileUV(geometry, w, h, d, tileW, tileH);
  return geometry;
}

class Bucket {
  constructor(material) {
    this.material = material;
    this.geometries = [];
  }
  add(geometry, x = 0, y = 0, z = 0, rotationY = 0, rotationZ = 0) {
    _euler.set(0, rotationY, rotationZ);
    _quaternion.setFromEuler(_euler);
    _position.set(x, y, z);
    _matrix.compose(_position, _quaternion, _scale);
    geometry.applyMatrix4(_matrix);
    this.geometries.push(geometry);
    return this;
  }
  build(parent, { name, castShadow = true, receiveShadow = true } = {}) {
    if (!this.geometries.length) return null;
    const merged = mergeGeometries(this.geometries, false);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.geometries.length = 0;
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = name ?? this.material.name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }
}

/** A cable hanging as its own weight pulls it: catenary, not a straight line. */
function wireGeometry(a, b, sag, radius = 0.025) {
  const SEGMENTS = 20;
  const SIDES = 4;
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const dx = bx - ax;
  const dz = bz - az;
  const flat = Math.hypot(dx, dz) || 1;
  const k = 4 * Math.atanh(Math.min((2 * sag) / flat, 0.9));
  const amp = sag / (Math.cosh(k / 2) - 1);
  const drop = (t) => amp * (Math.cosh(k * (t - 0.5)) - Math.cosh(k / 2));
  const sx = dz / flat;
  const sz = -dx / flat;
  const position = [];
  const normal = [];
  const uv = [];
  const index = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const cx = ax + dx * t;
    const cy = ay + (by - ay) * t + drop(t);
    const cz = az + dz * t;
    for (let s = 0; s < SIDES; s++) {
      const angle = (s / SIDES) * Math.PI * 2;
      const nx = Math.cos(angle) * sx;
      const ny = Math.sin(angle);
      const nz = Math.cos(angle) * sz;
      position.push(cx + nx * radius, cy + ny * radius, cz + nz * radius);
      normal.push(nx, ny, nz);
      uv.push(t, s / SIDES);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    for (let s = 0; s < SIDES; s++) {
      const a0 = i * SIDES + s;
      const a1 = i * SIDES + ((s + 1) % SIDES);
      const b0 = a0 + SIDES;
      const b1 = a1 + SIDES;
      index.push(a0, a1, b0, a1, b1, b0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

// ------------------------------------------------------------------ street
function insidePlot(x, z, clear = PLOT_CLEAR) {
  return PLOTS.some((plot) => Math.hypot(x - plot.x, z - plot.z) < clear);
}

export function buildStreet(scene) {
  const facadeTextures = WALL_TINTS.map(facadeTexture);
  const shopTextures = [0, 1, 2].map(shopTexture);

  const wallBuckets = WALL_TINTS.map(
    (tint, i) => new Bucket(new THREE.MeshStandardMaterial({
      name: `wall_${i}`, map: facadeTextures[i], roughness: 0.86, metalness: 0,
    })),
  );
  const shopBuckets = shopTextures.map(
    (texture, i) => new Bucket(new THREE.MeshStandardMaterial({
      name: `shop_${i}`, map: texture, roughness: 0.5, metalness: 0.08,
    })),
  );
  const awningBuckets = [0x54201d, 0x1b332a, 0x1d2739, 0x44423d].map(
    (color, i) => new Bucket(new THREE.MeshStandardMaterial({ name: `awning_${i}`, color, roughness: 0.85 })),
  );

  const roadMat = new THREE.MeshStandardMaterial({ name: 'road', color: 0x3c3e42, roughness: 0.62 });
  const walkMat = new THREE.MeshStandardMaterial({ name: 'walk', color: 0x8b8780, roughness: 0.86 });
  const plazaMat = new THREE.MeshStandardMaterial({ name: 'plaza', color: 0x8a8580, roughness: 0.8 });
  const paintMat = new THREE.MeshStandardMaterial({ name: 'paint', color: 0xd8d0bd, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ name: 'roof', color: 0x55565a, roughness: 0.92 });
  const metalMat = new THREE.MeshStandardMaterial({ name: 'metal', color: 0x3f4245, roughness: 0.45, metalness: 0.6 });
  const concreteMat = new THREE.MeshStandardMaterial({ name: 'concrete', color: 0x9c968c, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ name: 'trunk', color: 0x2a2119, roughness: 0.9 });
  const lampMat = new THREE.MeshStandardMaterial({
    name: 'lamp', color: 0x241d12, roughness: 0.5, emissive: 0xffc078, emissiveIntensity: 1.6,
  });
  const glassMat = new THREE.MeshStandardMaterial({ name: 'street_glass', color: 0x2b3338, roughness: 0.18, metalness: 0.1 });
  const carMat = new THREE.MeshStandardMaterial({ name: 'car', color: 0x1a1c20, roughness: 0.35, metalness: 0.5 });
  const vendingMats = [
    new THREE.MeshStandardMaterial({ name: 'vend_red', color: 0x5a1d1a, roughness: 0.5, metalness: 0.15 }),
    new THREE.MeshStandardMaterial({ name: 'vend_white', color: 0x8a867e, roughness: 0.5, metalness: 0.15 }),
  ];
  const vendingFaceMat = new THREE.MeshStandardMaterial({
    name: 'vend_face', color: 0x14110e, roughness: 0.4, emissive: 0xdff0ff, emissiveIntensity: 1.4,
  });

  const roadBucket = new Bucket(roadMat);
  const walkBucket = new Bucket(walkMat);
  const plazaBucket = new Bucket(plazaMat);
  const paintBucket = new Bucket(paintMat);
  const roofBucket = new Bucket(roofMat);
  const metalBucket = new Bucket(metalMat);
  const concreteBucket = new Bucket(concreteMat);
  const trunkBucket = new Bucket(trunkMat);
  const lampBucket = new Bucket(lampMat);
  const glassBucket = new Bucket(glassMat);
  const carBucket = new Bucket(carMat);
  const vendBuckets = vendingMats.map((material) => new Bucket(material));
  const vendFaceBucket = new Bucket(vendingFaceMat);

  // --- ground, plaza and carriageway -------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24000, 24000),
    new THREE.MeshStandardMaterial({ name: 'ground', color: 0x383a33, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const length = STREET.to - STREET.from;
  const midZ = STREET.from + length / 2 - 20;
  plazaBucket.add(boxGeometry(300, 0.12, 250), 0, 0.06, 10);
  roadBucket.add(boxGeometry(STREET.road * 2, 0.1, length + 40), 0, 0.05, midZ);
  for (const side of [-1, 1]) {
    walkBucket.add(boxGeometry(STREET.walk, 0.24, length + 40), side * (STREET.road + STREET.walk / 2), 0.12, midZ);
    walkBucket.add(boxGeometry(0.16, 0.26, length + 40), side * (STREET.road + 0.08), 0.13, midZ);
  }
  for (let z = STREET.from + 8; z < STREET.to; z += 9.5) {
    paintBucket.add(boxGeometry(0.14, 0.02, 3.6), 0, 0.11, z);
  }

  // --- houses -------------------------------------------------------------
  function buildHouse({ x, z, w, d, h, facing }) {
    const tintIndex = Math.floor(rnd() * WALL_TINTS.length);
    const wallBucket = wallBuckets[tintIndex];
    wallBucket.add(boxGeometry(w, h, d, 3.0, 3.2), x, h / 2, z);
    roofBucket.add(boxGeometry(w + 0.24, 0.24, d + 0.24), x, h + 0.12, z);
    // Parapet: four thin boxes on the roof edge.
    const t = 0.3;
    for (const [pw, pd, px, pz] of [
      [w + t, t, x, z - d / 2],
      [w + t, t, x, z + d / 2],
      [t, d, x - w / 2, z],
      [t, d, x + w / 2, z],
    ]) {
      roofBucket.add(boxGeometry(pw, 0.42, pd), px, h + 0.33, pz);
    }
    if (facing !== 0) {
      const face = x + facing * (w / 2);
      // Ground storey: shop glass, fascia, and now and then an awning.
      const shopLen = d - 1.2;
      const shop = shopBuckets[Math.floor(rnd() * shopBuckets.length)];
      shop.add(boxGeometry(0.24, 4.3, shopLen, 2.8, 4.3), face + facing * 0.03, 2.15, z);
      if (rnd() < 0.45) {
        const awning = awningBuckets[Math.floor(rnd() * awningBuckets.length)];
        awning.add(
          boxGeometry(1.25, 0.08, Math.min(shopLen, between(2.4, 6))),
          face + facing * 0.7, 3.1, z, 0, -facing * 0.14,
        );
      }
      // Air conditioners and a balcony or two: the upper floors' fine print.
      const floors = Math.floor((h - 4.6) / 3.2);
      for (let f = 0; f < floors; f++) {
        const y = 5.6 + f * 3.2;
        if (rnd() < 0.42 && y + 0.7 < h - 0.2) {
          const az = z + between(-d / 2 + 0.8, d / 2 - 0.8);
          metalBucket.add(boxGeometry(0.55, 0.55, 0.8), face + facing * 0.3, y + 0.4, az);
        }
        if (rnd() < 0.26 && y + 1.1 < h - 0.2) {
          const bz = z + between(-d / 2 + 1.6, d / 2 - 1.6);
          concreteBucket.add(boxGeometry(0.85, 0.1, 2.6), face + facing * 0.45, y + 0.05, bz);
          const ex = face + facing * 0.84;
          for (let r = 0; r < 5; r++) {
            metalBucket.add(boxGeometry(0.05, 0.85, 0.05), ex, y + 0.53, bz - 1.2 + r * 0.6);
          }
          metalBucket.add(boxGeometry(0.05, 0.05, 2.56), ex, y + 0.96, bz);
        }
      }
    }
    // Rooftop plant: a tank, an AC plant or a stair head.
    const kind = rnd();
    const cx = x + between(-w / 2 + 1.5, w / 2 - 1.5);
    const cz = z + between(-d / 2 + 1.5, d / 2 - 1.5);
    if (kind < 0.3) {
      concreteBucket.add(new THREE.CylinderGeometry(0.85, 0.85, 1.7, 12), cx, h + 1.1, cz);
    } else if (kind < 0.65) {
      metalBucket.add(boxGeometry(between(0.9, 1.7), between(0.5, 0.9), between(0.9, 1.6)), cx, h + 0.6, cz);
    } else {
      wallBucket.add(boxGeometry(between(1.8, 2.6), between(1.7, 2.4), between(1.8, 2.6), 3, 3.2), cx, h + 1.1, cz);
    }
  }

  // Front terrace of the street, then a second row seen over the roofs.
  for (const side of [-1, 1]) {
    let z = STREET.from;
    while (z < STREET.to) {
      if (rnd() < 0.07) {
        z += between(4, 7);
        continue;
      }
      const w = between(7, 16);
      const d = between(10, 16);
      if (z + w > STREET.to) break;
      const h = pick([2, 2, 3, 3, 4]) * between(2.9, 3.4) + 0.4;
      buildHouse({ x: side * (FRONT + d / 2 + between(0, 0.6)), z: z + w / 2, w: d, d: w, h, facing: -side });
      z += w + between(0.1, 0.9);
    }
  }
  for (const side of [-1, 1]) {
    for (let z = STREET.from; z < STREET.to + 30; z += between(13, 21)) {
      const d = between(10, 17);
      const w = between(11, 19);
      const h = pick([2, 3, 3, 4, 4]) * between(2.9, 3.4) + 0.4;
      buildHouse({ x: side * (FRONT + 19 + d / 2), z: z + w / 2, w: d, d: w, h, facing: 0 });
    }
  }

  // --- the district beyond -------------------------------------------------
  const cell = 30;
  for (let z = -760; z < STREET.to + 140; z += cell) {
    for (let x = -720; x < 720; x += cell) {
      if (Math.abs(x) < 150 && z > -150 && z < 155) continue; // the plaza
      if (Math.abs(x) < 32 && z > STREET.from - 34) continue; // the street
      if (insidePlot(x, z)) continue;
      if (rnd() < 0.16) continue;
      const w = between(13, 21);
      const d = between(12, 19);
      const h = pick([2, 2, 3, 3, 4, 5]) * between(2.8, 3.3) + 0.4;
      buildHouse({ x: x + between(-3, 3), z: z + between(-3, 3), w, d, h, facing: 0 });
    }
  }

  // --- street furniture ----------------------------------------------------
  // Street lights.
  for (const side of [-1, 1]) {
    for (let z = STREET.from + 22; z < STREET.to; z += 44) {
      const x = side * (STREET.road + 0.5);
      metalBucket.add(new THREE.CylinderGeometry(0.1, 0.14, 4.9, 8), x, 2.45, z);
      metalBucket.add(boxGeometry(1.4, 0.08, 0.08), x - side * 0.7, 4.85, z);
      lampBucket.add(boxGeometry(0.75, 0.16, 0.32), x - side * 1.35, 4.76, z);
    }
  }
  // Distribution poles and their wires on the right pavement.
  const poleX = STREET.road + 1.4;
  const poleZs = [];
  for (let z = STREET.from + 12; z < STREET.to; z += 78) poleZs.push(z);
  for (const z of poleZs) {
    trunkBucket.add(new THREE.CylinderGeometry(0.13, 0.18, 8.8, 8), poleX, 4.4, z);
    metalBucket.add(boxGeometry(0.1, 0.1, 1.8), poleX, 7.7, z);
    metalBucket.add(boxGeometry(0.1, 0.1, 1.4), poleX, 8.25, z);
  }
  for (let i = 0; i < poleZs.length - 1; i++) {
    const dz = poleZs[i + 1] - poleZs[i];
    for (const [dy, dx] of [[7.82, 0.75], [7.82, -0.75], [8.37, 0.55]]) {
      trunkBucket.add(wireGeometry([poleX + dx, dy, poleZs[i]], [poleX + dx, dy, poleZs[i + 1]], dz * 0.02));
    }
  }
  // Wires across the street near the camera: a frame within the frame.
  for (const [y, z] of [[7.4, 404], [8.1, 401]]) {
    trunkBucket.add(wireGeometry([-FRONT - 0.5, y, z], [FRONT + 0.5, y, z], (FRONT * 2 + 1) * 0.025, 0.028));
  }

  // Vending machines, bins, bollards and a parked car.
  const vendingSpots = [[-1, 352], [1, 318], [-1, 268]];
  for (const [side, z] of vendingSpots) {
    const x = side * (STREET.road + 1.05);
    const bucket = vendBuckets[Math.floor(rnd() * vendBuckets.length)];
    bucket.add(boxGeometry(0.8, 1.95, 1.05), x, 0.98, z);
    vendFaceBucket.add(boxGeometry(0.06, 1.35, 0.86), x - side * 0.42, 1.2, z);
  }
  for (const [side, z] of [[-1, 388], [-1, 392], [1, 402], [1, 406]]) {
    metalBucket.add(new THREE.CylinderGeometry(0.09, 0.11, 0.85, 8), side * (STREET.road + 0.7), 0.42, z);
  }
  for (const [side, z] of [[1, 372], [-1, 330]]) {
    metalBucket.add(boxGeometry(0.55, 0.85, 0.55), side * (STREET.road + 1.3), 0.43, z);
  }
  {
    const cx = STREET.road - 1.1;
    const cz = 344;
    carBucket.add(boxGeometry(1.78, 0.72, 4.3), cx, 0.62, cz);
    carBucket.add(boxGeometry(1.6, 0.62, 2.3), cx, 1.27, cz - 0.1);
    for (const [dx, dz] of [[-0.78, 1.4], [0.78, 1.4], [-0.78, -1.4], [0.78, -1.4]]) {
      const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
      wheel.rotateX(Math.PI / 2);
      wheel.rotateY(Math.PI / 2);
      wheel.translate(cx + dx, 0.32, cz + dz);
      metalBucket.geometries.push(wheel);
    }
    glassBucket.add(boxGeometry(1.42, 0.5, 2.0), cx, 1.28, cz - 0.1);
  }

  // --- commit ---------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'street';
  scene.add(group);
  roadBucket.build(group, { name: 'road' });
  walkBucket.build(group, { name: 'pavement' });
  plazaBucket.build(group, { name: 'plaza' });
  paintBucket.build(group, { name: 'road_paint' });
  roofBucket.build(group, { name: 'roofs' });
  metalBucket.build(group, { name: 'street_metal' });
  concreteBucket.build(group, { name: 'concrete' });
  trunkBucket.build(group, { name: 'poles_and_wires' });
  lampBucket.build(group, { name: 'lamps' });
  glassBucket.build(group, { name: 'car_glass' });
  carBucket.build(group, { name: 'car' });
  vendBuckets.forEach((bucket, i) => bucket.build(group, { name: `vending_${i}` }));
  vendFaceBucket.build(group, { name: 'vending_faces' });
  wallBuckets.forEach((bucket, i) => bucket.build(group, { name: `houses_${i}` }));
  shopBuckets.forEach((bucket, i) => bucket.build(group, { name: `shops_${i}` }));
  awningBuckets.forEach((bucket, i) => bucket.build(group, { name: `awnings_${i}` }));

  return group;
}
