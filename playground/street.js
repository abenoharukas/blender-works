// Japanese streetscape & town generator for Playground:
// Combines a lively station-front Shotengai & neighborhood commercial hubs (小商圈:
// Konbini, Izakaya, Ramen, Kissaten, Pharmacies, Bookstores, Neighborhood Supermarkets)
// with dense, subdivided residential blocks of authentic Japanese detached houses
// (一戸建て: Kirizuma, Katanagare, Yosemune, 3F Kyosho-jutaku, Machiya, Courtyard).
// All static geometry is merged per material (~40 draw calls total) for fast rendering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLOTS } from './models.js';
import {
  createHouseWallTexture,
  createCommercialUpperTexture,
  createShopfrontTexture,
  createSleeveSignTexture,
  createNorenTexture,
  createRoofTexture,
  createBlockWallTexture,
} from './japanese-textures.js';
import {
  box,
  LotContext,
  buildRandomIkkodate,
  buildKonbini,
  buildMachiyaShop,
  buildShotengaiBuilding,
  buildKissatenCorner,
  buildNeighborhoodSuper,
  addGardenTree,
  addKeiCar,
  addUtilityPole,
  addShotengaiLamp,
  addShotengaiArch,
} from './japanese-buildings.js';

export const STREET = { road: 4.8, walk: 2.3, from: 136, to: 592 };
const FRONT = STREET.road + STREET.walk;

// ------------------------------------------------------------------ deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ geometry merging bucket
const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

class Bucket {
  constructor(material) {
    this.material = material;
    this.geometries = [];
  }
  add(geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _euler.set(rx, ry, rz, 'YXZ');
    _quaternion.setFromEuler(_euler);
    _position.set(x, y, z);
    _matrix.compose(_position, _quaternion, _scale);
    geometry.applyMatrix4(_matrix);
    this.geometries.push(geometry);
    return this;
  }
  build(parent, { name, castShadow = true, receiveShadow = true } = {}) {
    if (!this.geometries.length) return null;
    // Normalize geometry attributes (strip non-indexed or mismatched normals/uvs safely)
    const normalized = this.geometries.map((geom) => {
      const g = geom.index ? geom.toNonIndexed() : geom;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        const count = g.attributes.position.count;
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (g !== geom) geom.dispose();
      return g;
    });
    this.geometries.length = 0;
    const merged = mergeGeometries(normalized, false);
    normalized.forEach((g) => g.dispose());
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

/** Catenary overhead power/telecom cable between two points. */
function wireGeometry(a, b, sag, radius = 0.024) {
  const SEGMENTS = 16;
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

// ------------------------------------------------------------------ plot clearances
// Plot 0 (0, 60) uses the exact central station plaza [-150..150, -115..135] from models.js.
// Plots 1..8 use crisp rectangular civic plazas (240 m x 154 m) so all 5 large architectural
// models fit with generous breathing room while dense Japanese neighborhoods weave between them.
function insideAnyPlotPlaza(x, z, pad = 6) {
  if (Math.abs(x) < 150 + pad && z > -115 - pad && z < 135 + pad) return true;
  for (let i = 1; i < PLOTS.length; i++) {
    const p = PLOTS[i];
    if (Math.abs(x - p.x) < 120 + pad && Math.abs(z - p.z) < 77 + pad) return true;
  }
  return false;
}

function createMaterialLibrary() {
  const std = (name, props) => new Bucket(new THREE.MeshStandardMaterial({ name, ...props }));

  // Residential light walls + matching windowless gable-end walls
  const lightDefs = [
    { hex: 0xede8de, style: 'plaster', frame: '#2a2e33' }, // Shikkui warm white
    { hex: 0xe3dcd0, style: 'siding', frame: '#34383d' },  // Ivory ceramic siding
    { hex: 0xd5ccc0, style: 'siding', frame: '#26292e' },  // Greige modern siding
    { hex: 0xdfd4c3, style: 'plaster', frame: '#4a3525' }, // Sand beige plaster
  ];
  const houseLightWalls = lightDefs.map((d, i) => std(`house_light_${i}`, {
    map: createHouseWallTexture({ baseHex: d.hex, style: d.style, frameColor: d.frame, windowType: 'sliding' }),
    roughness: 0.85,
  }));
  const houseLightBlanks = lightDefs.map((d, i) => std(`house_light_blank_${i}`, {
    map: createHouseWallTexture({ baseHex: d.hex, style: d.style, windowType: 'none' }),
    roughness: 0.85,
  }));

  // Slit-window contemporary walls
  const houseSlitWalls = [0xf0ece4, 0xd8d2c7].map((hex, i) => std(`house_slit_${i}`, {
    map: createHouseWallTexture({ baseHex: hex, style: 'plaster', windowType: 'slit' }),
    roughness: 0.84,
  }));

  // Dark modern Japanese galvalume / sumi ceramic siding walls
  const darkDefs = [
    { hex: 0x363a40, style: 'siding', frame: '#1b1d20' }, // Sumi charcoal
    { hex: 0x2c3848, style: 'siding', frame: '#dce2e8' }, // Navy slate (iconic modern ikkodate!)
    { hex: 0x4b4843, style: 'siding', frame: '#222426' }, // Warm umber-grey
  ];
  const houseDarkWalls = darkDefs.map((d, i) => std(`house_dark_${i}`, {
    map: createHouseWallTexture({ baseHex: d.hex, style: d.style, frameColor: d.frame, windowType: 'sliding' }),
    roughness: 0.76, metalness: 0.08,
  }));
  const houseDarkBlanks = darkDefs.map((d, i) => std(`house_dark_blank_${i}`, {
    map: createHouseWallTexture({ baseHex: d.hex, style: d.style, windowType: 'none' }),
    roughness: 0.76, metalness: 0.08,
  }));

  // Ceramic tile base walls & traditional Japanese cedar/washiki walls
  const houseTileWalls = [0xb59b84, 0x9c826e].map((hex, i) => std(`house_tile_${i}`, {
    map: createHouseWallTexture({ baseHex: hex, style: 'tile', windowType: 'sliding' }),
    roughness: 0.8,
  }));
  const woodAccentWall = std('wood_accent_wall', {
    map: createHouseWallTexture({ baseHex: 0x8f5e3b, style: 'wood_warm', frameColor: '#261c14', windowType: 'slit' }),
    roughness: 0.82,
  });
  const washikiLower = std('washiki_lower', {
    map: createHouseWallTexture({ baseHex: 0x5c3e28, style: 'wood_warm', frameColor: '#3b2617', windowType: 'koshido' }),
    roughness: 0.86,
  });
  const shikkuiWall = std('shikkui_wall', {
    map: createHouseWallTexture({ baseHex: 0xf1ece1, style: 'plaster', frameColor: '#4c3422', windowType: 'koshido' }),
    roughness: 0.88,
  });
  const shikkuiBlank = std('shikkui_blank', {
    map: createHouseWallTexture({ baseHex: 0xf1ece1, style: 'plaster', windowType: 'none' }),
    roughness: 0.88,
  });

  // Commercial upper-storey porcelain tile facades
  const commPalette = [
    { baseHex: 0xe6e0d4, accentHex: 0xc8bfb0 },
    { baseHex: 0xc9b49b, accentHex: 0x9e846b },
    { baseHex: 0xb06c52, accentHex: 0x8a4f39 }, // Classic Japanese terracotta-tile pencil building
    { baseHex: 0xbcc4c9, accentHex: 0x88949c },
    { baseHex: 0x9a948c, accentHex: 0x706b64 },
  ];
  const commUppers = commPalette.map((p, i) => std(`comm_upper_${i}`, {
    map: createCommercialUpperTexture(p),
    roughness: 0.72,
  }));

  // Ground-floor Japanese storefronts
  const shopIzakaya = std('shop_izakaya', { map: createShopfrontTexture('izakaya'), roughness: 0.65 });
  const shopRamen = std('shop_ramen', { map: createShopfrontTexture('ramen'), roughness: 0.65 });
  const shopKissaten = std('shop_kissaten', { map: createShopfrontTexture('kissaten'), roughness: 0.58 });
  const shopPharmacy = std('shop_pharmacy', { map: createShopfrontTexture('pharmacy'), roughness: 0.55 });
  const shopBookstore = std('shop_bookstore', { map: createShopfrontTexture('bookstore'), roughness: 0.58 });
  const shopKonbiniLawson = std('shop_konbini_lawson', { map: createShopfrontTexture('konbini_lawson'), roughness: 0.48 });
  const shopKonbiniFamima = std('shop_konbini_famima', { map: createShopfrontTexture('konbini_famima'), roughness: 0.48 });

  // Vertical projecting sleeve signs (袖看板)
  const signConfigs = [
    { bg: '#c9382b', fg: '#fff8eb', text: '居酒屋' },
    { bg: '#f5efe0', fg: '#1e2b3c', text: '珈琲館' },
    { bg: '#1e7858', fg: '#ffffff', text: '処方箋' },
    { bg: '#f2be38', fg: '#1d1c1a', text: '中華そば' },
    { bg: '#223b66', fg: '#f5f2e9', text: '古書堂' },
    { bg: '#e86830', fg: '#ffffff', text: '焼きたて' },
    { bg: '#f4f2ec', fg: '#b52b24', text: 'そば処' },
  ];
  const sleeveSigns = signConfigs.map((cfg, i) => {
    const tex = createSleeveSignTexture(cfg);
    return std(`sleeve_sign_${i}`, {
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.45,
    });
  });

  // Noren curtains (暖簾)
  const norenConfigs = [
    { bg: '#213254', fg: '#f4f0e6', crestText: '酒処暖簾' },
    { bg: '#9c2c24', fg: '#fff6e5', crestText: '中華そば' },
    { bg: '#ece6d8', fg: '#262320', crestText: '手打蕎麦' },
    { bg: '#34523c', fg: '#f5f0e4', crestText: '茶房甘味' },
  ];
  const norens = norenConfigs.map((cfg, i) => std(`noren_${i}`, {
    map: createNorenTexture(cfg), roughness: 0.92,
  }));

  // Shotengai arch / lamp banner sign
  const shotengaiBannerTex = createSleeveSignTexture({ bg: '#b82923', fg: '#fff7e2', text: 'すずらん通', border: '#d9b45b' });
  const shotengaiBanner = std('shotengai_banner', {
    map: shotengaiBannerTex, emissive: 0xffffff, emissiveMap: shotengaiBannerTex, emissiveIntensity: 0.22, roughness: 0.5,
  });

  // Roof materials
  const kawaraDark = std('roof_kawara_dark', {
    map: createRoofTexture({ baseHex: 0x35393e, style: 'kawara' }), roughness: 0.58, metalness: 0.14,
  });
  const kawaraBrown = std('roof_kawara_brown', {
    map: createRoofTexture({ baseHex: 0x614233, style: 'kawara' }), roughness: 0.64, metalness: 0.08,
  });
  const galvaCharcoal = std('roof_galva_charcoal', {
    map: createRoofTexture({ baseHex: 0x2b2f35, style: 'galvalume' }), roughness: 0.44, metalness: 0.42,
  });
  const galvaNavy = std('roof_galva_navy', {
    map: createRoofTexture({ baseHex: 0x253344, style: 'galvalume' }), roughness: 0.44, metalness: 0.38,
  });
  const slateRoof = std('roof_slate', {
    map: createRoofTexture({ baseHex: 0x484b50, style: 'slate' }), roughness: 0.78,
  });
  const solarRoof = std('roof_solar', {
    map: createRoofTexture({ baseHex: 0x162842, style: 'solar' }), roughness: 0.22, metalness: 0.55,
  });

  // Awnings
  const awningBurgundy = std('awning_burgundy', { color: 0x822824, roughness: 0.85 });
  const awningGreen = std('awning_green', { color: 0x1e4a38, roughness: 0.85 });
  const awningNavy = std('awning_navy', { color: 0x223654, roughness: 0.85 });
  const awningOchre = std('awning_ochre', { color: 0xb87a28, roughness: 0.85 });

  // Ground, roads, walls, greenery & vehicles
  const blockWall = std('block_wall', { map: createBlockWallTexture(0x9c988e), roughness: 0.92 });

  const carColors = [0xf2f0eb, 0xd8dde2, 0xe8c448, 0x5c8ab5, 0x282c32, 0xc94a3e, 0x86a68a];
  const carPalette = carColors.map((color, i) => std(`kei_car_${i}`, { color, roughness: 0.3, metalness: 0.38 }));

  return {
    houseLightWalls,
    houseLightBlanks,
    houseSlitWalls,
    houseDarkWalls,
    houseDarkBlanks,
    houseTileWalls,
    woodAccentWall,
    washikiLower,
    shikkuiWall,
    shikkuiBlank,
    commUppers,
    commUpperLight: commUppers[0],
    shopIzakaya,
    shopRamen,
    shopKissaten,
    shopPharmacy,
    shopBookstore,
    shopKonbiniLawson,
    shopKonbiniFamima,
    shopRetails: [shopKissaten, shopPharmacy, shopBookstore, shopIzakaya, shopRamen],
    sleeveSigns,
    norens,
    shotengaiBanner,
    kawaraDark,
    kawaraBrown,
    galvaCharcoal,
    galvaNavy,
    slateRoof,
    solarRoof,
    awningBurgundy,
    awningGreen,
    awningNavy,
    awningOchre,
    awnings: [awningBurgundy, awningGreen, awningNavy, awningOchre],
    blockWall,
    road: std('road_asphalt', { color: 0x3b3e43, roughness: 0.82 }),
    lane: std('lane_asphalt', { color: 0x484b50, roughness: 0.85 }),
    asphaltApron: std('asphalt_apron', { color: 0x56585c, roughness: 0.86 }),
    sidewalk: std('sidewalk', { color: 0x9e9a92, roughness: 0.86 }),
    plaza: std('plaza_granite', { color: 0x9b958c, roughness: 0.78 }),
    plazaBorder: std('plaza_border', { color: 0x7e7971, roughness: 0.82 }),
    lotPad: std('lot_pad', { color: 0x868279, roughness: 0.92 }),
    roadPaint: std('road_paint', { color: 0xeae4d7, roughness: 0.68 }),
    tactileYellow: std('tactile_yellow', { color: 0xd9a826, roughness: 0.72 }),
    concrete: std('concrete', { color: 0xb2ada3, roughness: 0.88 }),
    roofConcrete: std('roof_concrete', { color: 0x6e7073, roughness: 0.9 }),
    balconyWall: std('balcony_wall', { color: 0xdad5ca, roughness: 0.82 }),
    frostedPanel: std('frosted_panel', { color: 0x9ab4c2, roughness: 0.28, metalness: 0.15 }),
    carportRoof: std('carport_roof', { color: 0x526472, roughness: 0.32, metalness: 0.25 }),
    poleConcrete: std('pole_concrete', { color: 0x8d8a82, roughness: 0.88 }),
    woodWarm: std('wood_warm', { color: 0x8c5b36, roughness: 0.8 }),
    woodDark: std('wood_dark', { color: 0x3b2a1e, roughness: 0.86 }),
    darkMetal: std('dark_metal', { color: 0x2c3035, roughness: 0.45, metalness: 0.58 }),
    silverMetal: std('silver_metal', { color: 0xa6acb2, roughness: 0.36, metalness: 0.68 }),
    acUnit: std('ac_unit', { color: 0xdcd9d0, roughness: 0.65, metalness: 0.15 }),
    glassDark: std('glass_dark', { color: 0x243038, roughness: 0.16, metalness: 0.25 }),
    accentRed: std('accent_red', { color: 0xb83028, roughness: 0.55 }),
    konbiniSignBlue: std('konbini_blue', { color: 0x1e6bb8, emissive: 0x1e6bb8, emissiveIntensity: 0.35, roughness: 0.4 }),
    konbiniSignGreen: std('konbini_green', { color: 0x1e9648, emissive: 0x1e9648, emissiveIntensity: 0.3, roughness: 0.4 }),
    warmLamp: std('warm_lamp', { color: 0xfff0d4, emissive: 0xffc675, emissiveIntensity: 1.5, roughness: 0.35 }),
    lanternRed: std('lantern_red', { color: 0xd93829, emissive: 0xff5a36, emissiveIntensity: 1.15, roughness: 0.6 }),
    lanternWarm: std('lantern_warm', { color: 0xfff0d2, emissive: 0xffcf86, emissiveIntensity: 1.1, roughness: 0.6 }),
    vendRed: std('vend_red', { color: 0xa82622, roughness: 0.45, metalness: 0.15 }),
    vendBlue: std('vend_blue', { color: 0x1f5694, roughness: 0.45, metalness: 0.15 }),
    vendWhite: std('vend_white', { color: 0xe6e3dc, roughness: 0.45, metalness: 0.15 }),
    vendFace: std('vend_face', { color: 0xdff2ff, emissive: 0xd4ecff, emissiveIntensity: 1.2, roughness: 0.3 }),
    trunk: std('tree_trunk', { color: 0x453426, roughness: 0.92 }),
    hedge: std('hedge_green', { color: 0x46633b, roughness: 0.9 }),
    foliageFresh: std('foliage_fresh', { color: 0x4f7340, roughness: 0.86 }),
    foliagePine: std('foliage_pine', { color: 0x2f4d31, roughness: 0.88 }),
    foliageWarm: std('foliage_warm', { color: 0xb55432, roughness: 0.84 }), // Subtle Japanese maple accent!
    wire: std('overhead_wire', { color: 0x1d1e21, roughness: 0.7 }),
    carWhite: carPalette[0],
    carPalette,
  };
}

// ------------------------------------------------------------------ road & crosswalk helpers

function addZebraCrosswalk(mats, cx, cz, width, alongX = false) {
  const stripeCount = Math.max(3, Math.floor((width - 1.2) / 0.95));
  const start = -((stripeCount - 1) * 0.95) * 0.5;
  for (let i = 0; i < stripeCount; i++) {
    const offset = start + i * 0.95;
    if (alongX) {
      mats.roadPaint.add(box(3.4, 0.02, 0.45), cx, 0.115, cz + offset);
    } else {
      mats.roadPaint.add(box(0.45, 0.02, 3.4), cx + offset, 0.115, cz);
    }
  }
}

function addNorthSouthAvenue(mats, x, z0, z1, roadHalf = 4.6, walkW = 2.1, tactile = false) {
  const len = z1 - z0;
  if (len <= 2) return;
  const midZ = (z0 + z1) * 0.5;
  mats.road.add(box(roadHalf * 2, 0.1, len), x, 0.05, midZ);

  for (const s of [-1, 1]) {
    mats.sidewalk.add(box(walkW, 0.2, len), x + s * (roadHalf + walkW * 0.5), 0.1, midZ);
    mats.concrete.add(box(0.16, 0.22, len), x + s * (roadHalf + 0.08), 0.11, midZ);
    // Outer white lane edge line (外側線)
    mats.roadPaint.add(box(0.14, 0.02, len - 4), x + s * (roadHalf - 0.55), 0.108, midZ);
    if (tactile) {
      mats.tactileYellow.add(box(0.3, 0.02, len - 2), x + s * (roadHalf + 0.75), 0.208, midZ);
    }
  }
  // Center dashed line
  for (let z = z0 + 9; z < z1 - 9; z += 9.5) {
    mats.roadPaint.add(box(0.14, 0.02, 3.8), x, 0.108, z);
  }
}

function addEastWestAvenue(mats, z, x0, x1, roadHalf = 4.2, walkW = 1.9) {
  const len = x1 - x0;
  if (len <= 2) return;
  const midX = (x0 + x1) * 0.5;
  mats.road.add(box(len, 0.095, roadHalf * 2), midX, 0.048, z);

  for (const s of [-1, 1]) {
    mats.sidewalk.add(box(len, 0.19, walkW), midX, 0.095, z + s * (roadHalf + walkW * 0.5));
    mats.concrete.add(box(len, 0.21, 0.15), midX, 0.105, z + s * (roadHalf + 0.08));
    mats.roadPaint.add(box(len - 4, 0.02, 0.14), midX, 0.102, z + s * (roadHalf - 0.5));
  }
  for (let x = x0 + 9; x < x1 - 9; x += 9.5) {
    mats.roadPaint.add(box(3.8, 0.02, 0.14), x, 0.102, z);
  }
}

/** Narrow 4.6 m Japanese local residential street (生活道路) with white side-stripes (路側帯) and no raised curb. */
function addResidentialLaneEW(mats, z, x0, x1) {
  const len = x1 - x0;
  if (len <= 4) return;
  const midX = (x0 + x1) * 0.5;
  mats.lane.add(box(len, 0.07, 4.6), midX, 0.035, z);
  mats.roadPaint.add(box(len - 2, 0.015, 0.11), midX, 0.075, z - 1.85);
  mats.roadPaint.add(box(len - 2, 0.015, 0.11), midX, 0.075, z + 1.85);
}

// ------------------------------------------------------------------ urban block fillers

/**
 * Populates a commercial frontage strip (小商圈 / 商店街) from startPos to endPos.
 * `axis` is 'z' (frontage runs along Z, facing yaw) or 'x' (frontage runs along X, facing yaw).
 */
function populateCommercialStrip(mats, rnd, {
  axis = 'z', fixedCoord, from, to, yaw, crossCoords = [], detail = true, allowSuper = false,
}) {
  let cursor = from;
  const depth = 11.4;

  while (cursor < to - 5.5) {
    // Keep cross-street intersections clear
    const nearCross = crossCoords.find((c) => cursor + 8 > c - 7.5 && cursor < c + 7.5);
    if (nearCross !== undefined) {
      cursor = nearCross + 8.0;
      continue;
    }

    const distToNextCross = crossCoords
      .filter((c) => c > cursor)
      .reduce((min, c) => Math.min(min, c - 7.5 - cursor), to - cursor);

    if (distToNextCross < 6.0) {
      cursor += distToNextCross + 15.5;
      continue;
    }

    const atCorner = crossCoords.some((c) => Math.abs(cursor - (c + 8.0)) < 2.2 || Math.abs((cursor + 12) - (c - 7.5)) < 3.5);
    let lotW;
    let builderType;

    if (allowSuper && distToNextCross >= 17.5 && rnd() < 0.18) {
      lotW = 16.8;
      builderType = 'super';
    } else if (atCorner && distToNextCross >= 13.0 && rnd() < 0.55) {
      lotW = Math.min(13.6, distToNextCross);
      builderType = rnd() < 0.62 ? 'konbini' : 'kissaten';
    } else if (atCorner && distToNextCross >= 9.2 && rnd() < 0.6) {
      lotW = Math.min(9.6, distToNextCross);
      builderType = 'kissaten';
    } else {
      const roll = rnd();
      if (roll < 0.38) {
        lotW = Math.min(6.8 + rnd() * 2.2, distToNextCross);
        builderType = 'machiya';
      } else {
        lotW = Math.min(7.2 + rnd() * 2.8, distToNextCross);
        builderType = 'shotengai';
      }
    }

    const mid = cursor + lotW * 0.5;
    const cx = axis === 'z' ? fixedCoord : mid;
    const cz = axis === 'z' ? mid : fixedCoord;

    if (!insideAnyPlotPlaza(cx, cz, 5)) {
      const lot = new LotContext(cx, cz, yaw, 0);
      if (builderType === 'konbini') {
        buildKonbini(lot, mats, rnd, { w: lotW - 0.3, d: depth, twoStorey: rnd() < 0.42, detail });
      } else if (builderType === 'super') {
        buildNeighborhoodSuper(lot, mats, rnd, { w: lotW - 0.4, d: depth + 1.5, detail });
      } else if (builderType === 'kissaten') {
        buildKissatenCorner(lot, mats, rnd, { w: lotW - 0.3, d: depth - 0.6, detail });
      } else if (builderType === 'machiya') {
        buildMachiyaShop(lot, mats, rnd, { w: lotW - 0.25, d: depth - 0.5, detail });
      } else {
        const storeys = rnd() < 0.28 ? 2 : (rnd() < 0.72 ? 3 : 4);
        buildShotengaiBuilding(lot, mats, rnd, { w: lotW - 0.25, d: depth, storeys, detail });
      }
    }

    // Authentic tight Japanese urban narrow gap between shophouses (25–55 cm maintenance gap!)
    cursor += lotW + 0.3 + rnd() * 0.35;
  }
}

/**
 * Subdivides a rectangular residential superblock [x0..x1] x [z0..z1] into
 * East-West local residential lanes (生活道路) and double-loaded rows of Japanese 一戸建て!
 */
function populateIkkodateBlock(mats, rnd, { x0, x1, z0, z1 }) {
  const widthX = x1 - x0;
  const depthZ = z1 - z0;
  if (widthX < 10 || depthZ < 12) return;

  // Each residential double-row + 4.6m local lane takes ~28.5m in Z
  const lanePitch = 28.5;
  const strips = Math.max(1, Math.round(depthZ / lanePitch));
  const stripDepth = depthZ / strips;

  for (let s = 0; s < strips; s++) {
    const sz0 = z0 + s * stripDepth;
    const sz1 = sz0 + stripDepth;
    const laneZ = (sz0 + sz1) * 0.5;

    if (stripDepth >= 22) {
      // Carve an East-West local residential lane down the middle of the strip,
      // and place two rows of Ikkodate facing EACH OTHER across this lane!
      if (!insideAnyPlotPlaza((x0 + x1) * 0.5, laneZ, 2)) {
        addResidentialLaneEW(mats, laneZ, x0 + 0.5, x1 - 0.5);
      }

      const lotD = Math.min(13.2, (stripDepth - 4.8) * 0.5);
      const rows = [
        { cz: laneZ - 2.4 - lotD * 0.5, yaw: 0 },          // South of lane, faces +Z onto lane
        { cz: laneZ + 2.4 + lotD * 0.5, yaw: Math.PI },    // North of lane, faces -Z onto lane
      ];

      // Utility poles along inner residential lanes
      for (let px = x0 + 12; px < x1 - 10; px += 52) {
        if (Math.hypot(px, laneZ - 300) < 320 && !insideAnyPlotPlaza(px, laneZ + 2.2, 4)) {
          addUtilityPole(mats, px, laneZ + 2.25, rnd() < 0.3, 0);
        }
      }

      for (const row of rows) {
        let lx = x0 + 0.6;
        while (lx < x1 - 8.2) {
          const lotW = Math.min(9.6 + rnd() * 3.0, x1 - 0.6 - lx);
          if (lotW < 8.0) break;
          const cx = lx + lotW * 0.5;
          if (!insideAnyPlotPlaza(cx, row.cz, 5)) {
            const dist = Math.hypot(cx, row.cz - 310);
            const tier = dist < 230 ? 2 : (dist < 440 ? 1 : 0);
            const lot = new LotContext(cx, row.cz, row.yaw, 0);
            buildRandomIkkodate(lot, mats, rnd, { lotW, lotD, tier });
          }
          lx += lotW + 0.25;
        }
      }
    } else {
      const lotD = Math.min(13.0, stripDepth - 1.2);
      let lx = x0 + 0.6;
      while (lx < x1 - 8.2) {
        const lotW = Math.min(9.8 + rnd() * 2.8, x1 - 0.6 - lx);
        if (lotW < 8.0) break;
        const cx = lx + lotW * 0.5;
        if (!insideAnyPlotPlaza(cx, laneZ, 5)) {
          const dist = Math.hypot(cx, laneZ - 310);
          const tier = dist < 230 ? 2 : (dist < 440 ? 1 : 0);
          const lot = new LotContext(cx, laneZ, 0, 0);
          buildRandomIkkodate(lot, mats, rnd, { lotW, lotD, tier });
        }
        lx += lotW + 0.25;
      }
    }
  }
}

// ------------------------------------------------------------------ main town builder

export function buildStreet(scene) {
  const rnd = mulberry32(0x5a7c19);
  const mats = createMaterialLibrary();

  // 1. Subtle urban ground plane (slightly below y = 0 so road & plaza slabs never z-fight)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24000, 24000),
    new THREE.MeshStandardMaterial({ name: 'ground', color: 0x5c5b55, roughness: 0.96 }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // 2. Civic Plazas for all 9 Large Architectural Plots
  // Plot 0 (0, 60) matches models.js PLAZA: x in [-150, 150], z in [-115, 135], top = 0.12
  mats.plaza.add(box(300, 0.12, 250), 0, 0.06, 10);
  mats.plazaBorder.add(box(304, 0.1, 4.0), 0, 0.05, 135);
  mats.plazaBorder.add(box(304, 0.1, 4.0), 0, 0.05, -115);

  // Plots 1..8 get crisp stone civic plazas at top = 0.012 (below groundHeightAt = 0.02!)
  for (let i = 1; i < PLOTS.length; i++) {
    const p = PLOTS[i];
    mats.plaza.add(box(236, 0.05, 150), p.x, -0.015, p.z);
    mats.plazaBorder.add(box(242, 0.045, 156), p.x, -0.02, p.z);
    // Perimeter Zelkova avenue trees framing each civic plaza
    for (let tx = p.x - 108; tx <= p.x + 108; tx += 27) {
      for (const tz of [p.z - 73, p.z + 73]) {
        const treeLot = new LotContext(tx, tz, 0, 0);
        addGardenTree(treeLot, mats, 0, 0, 1.25, 'leafy');
      }
    }
  }
  // Zelkova street trees framing the main Central Plaza (Plot 0) without blocking x = 0 sightline
  for (const tx of [-144, 144]) {
    for (let tz = -105; tz <= 125; tz += 26) {
      const treeLot = new LotContext(tx, tz, 0, 0.12);
      addGardenTree(treeLot, mats, 0, 0, 1.35, 'leafy');
    }
  }
  for (const tx of [-126, -98, -70, -42, 42, 70, 98, 126]) {
    const treeLot = new LotContext(tx, 131, 0, 0.12);
    addGardenTree(treeLot, mats, 0, 0, 1.3, rnd() < 0.25 ? 'autumn' : 'leafy');
  }

  // 3. Japanese Town Road Network (neatly bounded to town perimeter [-602..602] x [-716..598])
  const ewCrossZs = [144, 232, 324, 436, 526, 594];
  const northEwZs = [-122, -198, -362, -452, -538, -714];
  const nsAvenueXs = [-600, -460, -182, 182, 460, 600];

  // Main North-South Ekimae Shotengai (駅前通り・商店街: x = 0, z = 136..596)
  addNorthSouthAvenue(mats, 0, STREET.from, STREET.to + 4, STREET.road, STREET.walk, true);

  // Secondary North-South Avenues weaving cleanly through the town
  for (const ax of nsAvenueXs) {
    addNorthSouthAvenue(mats, ax, -716, 598, 4.4, 1.8, Math.abs(ax) === 182);
  }

  // East-West Cross-Avenues across South Town & North Inter-Tower Districts
  for (const az of [...ewCrossZs, ...northEwZs]) {
    addEastWestAvenue(mats, az, -604, 604, 4.2, 1.8);
  }

  // Zebra crosswalks (横断歩道) at every Shotengai & major avenue intersection!
  for (const cz of ewCrossZs) {
    addZebraCrosswalk(mats, 0, cz - 7.2, STREET.road * 2);
    addZebraCrosswalk(mats, 0, cz + 7.2, STREET.road * 2);
    addZebraCrosswalk(mats, -8.2, cz, 8.4, true);
    addZebraCrosswalk(mats, 8.2, cz, 8.4, true);

    for (const cx of [-182, 182]) {
      addZebraCrosswalk(mats, cx, cz - 6.8, 8.8);
      addZebraCrosswalk(mats, cx, cz + 6.8, 8.8);
    }
  }

  // Side Shotengai Entrance Welcome Arches (商店街アーチ) framing cross-shopping streets!
  addShotengaiArch(mats, 514, STREET.road + 1.15);
  for (const side of [-1, 1]) {
    const archLot = new LotContext(side * 12.8, 324, Math.PI * 0.5, 0);
    archLot.addBox(mats.accentRed, 0.34, 5.6, 0.34, -4.8, 2.8, 0);
    archLot.addBox(mats.accentRed, 0.34, 5.6, 0.34, 4.8, 2.8, 0);
    archLot.addBox(mats.accentRed, 10.2, 0.55, 0.42, 0, 5.4, 0);
    archLot.addBox(mats.shotengaiBanner, 5.4, 1.0, 0.5, 0, 5.52, 0);
  }

  // 4. COMMERCIAL DISTRICTS (小商圈 & 駅前商店街)
  const mainFrontX = FRONT + 5.85;

  // (a) Main Ekimae Shotengai (both West & East frontages along x = 0, z = 152..588)
  populateCommercialStrip(mats, rnd, {
    axis: 'z', fixedCoord: -mainFrontX, from: 152, to: 586, yaw: Math.PI * 0.5,
    crossCoords: ewCrossZs, detail: true, allowSuper: false,
  });
  populateCommercialStrip(mats, rnd, {
    axis: 'z', fixedCoord: mainFrontX, from: 152, to: 586, yaw: -Math.PI * 0.5,
    crossCoords: ewCrossZs, detail: true, allowSuper: false,
  });

  // (b) Cross-Street Commercial Sub-Centers (東西小商圈 along z = 324 and z = 232 out to x = ±174)
  for (const cz of [232, 324]) {
    for (const dir of [-1, 1]) {
      const xStart = dir > 0 ? 21 : -173;
      const xEnd = dir > 0 ? 173 : -21;
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: cz - 11.8, from: xStart, to: xEnd, yaw: 0,
        crossCoords: [], detail: true, allowSuper: true,
      });
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: cz + 11.8, from: xStart, to: xEnd, yaw: Math.PI,
        crossCoords: [], detail: true, allowSuper: true,
      });
    }
  }

  // (c) Neighborhood Sub-Centers along x = ±182 avenues & North Inter-Plot Avenues (z = -122, -362)
  for (const ax of [-182, 182]) {
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax - 11.9, from: 150, to: 400, yaw: Math.PI * 0.5,
      crossCoords: ewCrossZs, detail: true, allowSuper: true,
    });
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax + 11.9, from: 150, to: 400, yaw: -Math.PI * 0.5,
      crossCoords: ewCrossZs, detail: true, allowSuper: true,
    });
  }
  for (const nz of [-122, -362]) {
    for (const [xStart, xEnd] of [[-448, -192], [-172, 172], [192, 448]]) {
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: nz - 11.8, from: xStart, to: xEnd, yaw: 0,
        crossCoords: [], detail: false, allowSuper: true,
      });
    }
  }

  // 5. JAPANESE DETACHED HOUSE NEIGHBORHOODS (一戸建て住宅街)
  // Fill every urban block outside commercial frontages & civic plazas with subdivided Ikkodate streets!
  const xBands = [
    [-595, -468],
    [-452, -190],
    [-174, -20],
    [20, 174],
    [190, 452],
    [468, 595],
  ];

  // South Town residential superblocks (between ewCrossZs: 142..592)
  for (let zi = 0; zi < ewCrossZs.length - 1; zi++) {
    const bz0 = ewCrossZs[zi] + 6.5;
    const bz1 = ewCrossZs[zi + 1] - 6.5;

    for (const [bx0, bx1] of xBands) {
      // Reserve frontage depth where commercial strips already stand!
      let rx0 = bx0;
      let rx1 = bx1;
      let rz0 = bz0;
      let rz1 = bz1;

      // Buffer behind x = ±182 commercial strips (for z in 142..408)
      if (bz0 < 405) {
        if (Math.abs(bx1 - (-190)) < 2) rx1 -= 12.5;
        if (Math.abs(bx0 - (-174)) < 2) rx0 += 12.5;
        if (Math.abs(bx1 - 174) < 2) rx1 -= 12.5;
        if (Math.abs(bx0 - 190) < 2) rx0 += 12.5;
      }
      // Buffer behind z = 232 and z = 324 commercial cross-strips (for |x| < 175)
      if (Math.abs(bx0) < 176 && Math.abs(bx1) < 176) {
        if (ewCrossZs[zi] === 232 || ewCrossZs[zi] === 324) rz0 += 12.5;
        if (ewCrossZs[zi + 1] === 232 || ewCrossZs[zi + 1] === 324) rz1 -= 12.5;
      }

      populateIkkodateBlock(mats, rnd, { x0: rx0, x1: rx1, z0: rz0, z1: rz1 });
    }
  }

  // Mid & North Town residential superblocks weaving around and behind the 9 Tower Plots!
  const northZBands = [
    [-715, -546],
    [-530, -459],
    [-445, -380],
    [-354, -205],
    [-191, -140],
    [-114, 134],
  ];
  for (const [bz0, bz1] of northZBands) {
    for (const [bx0, bx1] of xBands) {
      populateIkkodateBlock(mats, rnd, { x0: bx0, x1: bx1, z0: bz0, z1: bz1 });
    }
  }

  // 6. MAIN SHOTENGAI STREET FURNITURE, UTILITY POLES, OVERHEAD WIRES & KEI-CARS
  // Suzuran decorative lamps with shopping-street flags on both sidewalks
  for (const side of [-1, 1]) {
    const banner = mats.sleeveSigns[side < 0 ? 0 : 4];
    for (let z = STREET.from + 14; z < STREET.to - 8; z += 26) {
      if (ewCrossZs.some((cz) => Math.abs(z - cz) < 8.5)) continue;
      addShotengaiLamp(mats, side * (STREET.road + 0.55), z, side, banner);
    }
  }

  // Authentic Japanese concrete utility poles (電柱) + transformers + overhead catenary wires!
  const rightPoleX = STREET.road + 1.65;
  const leftPoleX = -(STREET.road + 1.65);
  const rightPoles = [];
  const leftPoles = [];

  for (let z = STREET.from + 18; z < STREET.to - 12; z += 44) {
    const snappedZ = ewCrossZs.some((cz) => Math.abs(z - cz) < 8) ? z + 10 : z;
    rightPoles.push(snappedZ);
    addUtilityPole(mats, rightPoleX, snappedZ, rightPoles.length % 2 === 1, rightPoles.length === 6 ? 1 : 0);
  }
  for (let z = STREET.from + 36; z < STREET.to - 12; z += 66) {
    const snappedZ = ewCrossZs.some((cz) => Math.abs(z - cz) < 8) ? z - 10 : z;
    leftPoles.push(snappedZ);
    addUtilityPole(mats, leftPoleX, snappedZ, leftPoles.length % 2 === 0, 0);
  }

  // Longitudinal 3-phase high-voltage & low-voltage telecom catenary wires
  for (let i = 0; i < rightPoles.length - 1; i++) {
    const zA = rightPoles[i];
    const zB = rightPoles[i + 1];
    const span = zB - zA;
    for (const [dx, y, sagScale] of [[-0.75, 9.05, 0.016], [0, 9.05, 0.016], [0.75, 9.05, 0.016], [-0.52, 8.2, 0.02], [0.35, 6.9, 0.024]]) {
      mats.wire.add(wireGeometry([rightPoleX + dx, y, zA], [rightPoleX + dx, y, zB], span * sagScale, 0.022));
    }
  }
  for (let i = 0; i < leftPoles.length - 1; i++) {
    const zA = leftPoles[i];
    const zB = leftPoles[i + 1];
    const span = zB - zA;
    for (const [dx, y] of [[-0.55, 8.95], [0.55, 8.95], [0.25, 6.9]]) {
      mats.wire.add(wireGeometry([leftPoleX + dx, y, zA], [leftPoleX + dx, y, zB], span * 0.019, 0.02));
    }
  }
  // Cross-street service drop wires framing the sky near the camera!
  for (const [zCross, yCross] of [[402, 7.6], [398, 8.3], [348, 7.8], [282, 8.1], [204, 7.9]]) {
    mats.wire.add(wireGeometry([leftPoleX, yCross, zCross], [rightPoleX, yCross + 0.25, zCross + 2.5], 0.42, 0.02));
  }

  // Street-side Vending Machine Corners (自販機コーナー) along Shotengai
  for (const [side, z] of [[-1, 376], [1, 344], [-1, 276], [1, 194]]) {
    const vx = side * (STREET.road + 1.82);
    mats.vendRed.add(box(0.72, 1.9, 0.96), vx, 0.95, z);
    mats.vendFace.add(box(0.05, 1.26, 0.82), vx - side * 0.37, 1.16, z);
    mats.vendWhite.add(box(0.72, 1.9, 0.96), vx, 0.95, z + 1.06);
    mats.vendFace.add(box(0.05, 1.26, 0.82), vx - side * 0.37, 1.16, z + 1.06);
    // Blue bottle/can recycle bin beside vending bank!
    mats.vendBlue.add(box(0.45, 0.86, 0.46), vx, 0.43, z + 1.88);
  }

  // Japanese Kei-cars & delivery vans cruising/parked on the Shotengai & cross-streets!
  const roadCars = [
    { x: -2.2, z: 362, yaw: Math.PI, color: 0, van: false },
    { x: 2.2, z: 292, yaw: 0, color: 2, van: false },      // Yellow Kei-car!
    { x: -2.3, z: 248, yaw: Math.PI, color: 3, van: true }, // Delivery kei-van
    { x: 2.1, z: 446, yaw: 0, color: 5, van: false },
    { x: -46, z: 318.1, yaw: Math.PI * 0.5, color: 1, van: true },
    { x: 58, z: 221.9, yaw: -Math.PI * 0.5, color: 6, van: false },
  ];
  for (const c of roadCars) {
    const carLot = new LotContext(c.x, c.z, 0, 0.08);
    addKeiCar(carLot, mats, 0, 0, c.yaw, mats.carPalette[c.color], c.van);
  }

  // 7. Build all merged static meshes into one clean `street` group
  const group = new THREE.Group();
  group.name = 'street';
  scene.add(group);

  const buildAll = (bucketOrArray, shadowOpts = {}) => {
    if (Array.isArray(bucketOrArray)) {
      bucketOrArray.forEach((b) => b.build(group, shadowOpts));
    } else if (bucketOrArray instanceof Bucket) {
      bucketOrArray.build(group, shadowOpts);
    }
  };

  // Ground/road surfaces receive shadows without needing to cast them
  for (const key of ['road', 'lane', 'asphaltApron', 'sidewalk', 'plaza', 'plazaBorder', 'lotPad', 'roadPaint', 'tactileYellow']) {
    buildAll(mats[key], { castShadow: false, receiveShadow: true });
  }

  // All 3D buildings, roofs, signs, vehicles, trees & wires cast and receive shadows
  const skipKeys = new Set([
    'road', 'lane', 'asphaltApron', 'sidewalk', 'plaza', 'plazaBorder', 'lotPad',
    'roadPaint', 'tactileYellow', 'commUpperLight', 'shopRetails', 'awnings', 'carWhite',
  ]);
  for (const [key, val] of Object.entries(mats)) {
    if (skipKeys.has(key)) continue;
    buildAll(val, { castShadow: true, receiveShadow: true });
  }

  group.userData.mats = mats;
  return group;
}
