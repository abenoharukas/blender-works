// Japanese streetscape & town generator for Playground:
// Combines a lively station-front Shotengai & neighborhood commercial hubs (小商圈:
// Konbini, Izakaya, Ramen, Kissaten, Pharmacies, Bookstores, Neighborhood Supermarkets)
// with dense, subdivided residential blocks of authentic Japanese detached houses
// (一戸建て: Kirizuma, Katanagare, Yosemune, 3F Kyosho-jutaku, Machiya, Courtyard).
// All static geometry is merged per material (~65 draw calls total) for fast rendering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLOTS } from './models.js?v=20261127e';
import {
  createWallCladdingPBR,
  createBlockWallPBR,
  createRoofPBR,
  createUnlitWindowTexture,
  createLitWindowTextureSet,
  createShopFasciaSignSet,
  createKonbiniFasciaSet,
  createKonbiniPylonSet,
  createPolePlaqueTexture,
  createPoleReflectorTexture,
  createStreetFlagTexture,
  createSleeveSignTextureSet,
  createArchSignTextureSet,
  createNorenPanelTexture,
  createAcUnitTexture,
  createDrainGrateTexture,
  createBarkPBR,
  createHedgePBR,
  createFoliageClusterTextureSet,
  createChochinTextureSet,
  createPromenadePaverPBR,
  createCoveGlowTextureSet,
  createDotonboriFasciaSet,
  createTowerSignTextureSet,
  createRooftopBillboardSet,
  createPodiumPosterSet,
  createOhshoLanternStackSet,
  createFestivalLanternSet,
  createKeiLicensePlateTexture,
} from './japanese-textures.js?v=20261128c';
import {
  box,
  LotContext,
  buildRandomIkkodate,
  buildKonbini,
  buildMachiyaShop,
  buildShotengaiBuilding,
  buildKissatenCorner,
  buildNeighborhoodSuper,
  buildDotonboriFlagship,
  addDotonboriLanternGarland,
  addSleeveSign,
  addChochinRow,
  addGardenTree,
  addKeiCar,
  addUtilityPole,
  addShotengaiLamp,
  addShotengaiArch,
} from './japanese-buildings.js?v=20261128c';
import { applyInteriorMapping } from './interior-mapping.js?v=20261127e';

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
    const normalized = this.geometries.map((geom) => {
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
  const stdPbr = (name, pbr, extra = {}) => std(name, {
    map: pbr.map,
    normalMap: pbr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: pbr.roughnessMap,
    roughness: 1.0,
    ...extra,
  });

  // 1. Pure Residential Claddings (512x512 PBR normalMap + roughnessMap, zero 2D painted fake windows!)
  const lightDefs = [
    { hex: 0xede8de, style: 'plaster' }, // Shikkui warm white
    { hex: 0xe3dcd0, style: 'siding' },  // Ivory ceramic siding
    { hex: 0xd5ccc0, style: 'siding' },  // Greige modern siding
    { hex: 0xdfd4c3, style: 'plaster' }, // Sand beige troweled stucco
  ];
  const houseLightWalls = lightDefs.map((d, i) =>
    stdPbr(`house_light_${i}`, createWallCladdingPBR({ baseHex: d.hex, style: d.style, seed: 11 + i * 37 })),
  );

  const houseSlitWalls = [0xf0ece4, 0xd8d2c7].map((hex, i) =>
    stdPbr(`house_slit_${i}`, createWallCladdingPBR({ baseHex: hex, style: 'plaster', seed: 211 + i * 53 })),
  );

  const darkDefs = [
    { hex: 0x363a40, style: 'siding' }, // Sumi charcoal ceramic siding
    { hex: 0x2c3848, style: 'siding' }, // Navy slate modern ikkodate siding
    { hex: 0x4b4843, style: 'siding' }, // Warm umber-grey siding
  ];
  const houseDarkWalls = darkDefs.map((d, i) =>
    stdPbr(`house_dark_${i}`, createWallCladdingPBR({ baseHex: d.hex, style: d.style, seed: 401 + i * 71 }), { metalness: 0.08 }),
  );

  const houseTileWalls = [0xb59b84, 0x9c826e].map((hex, i) =>
    stdPbr(`house_tile_${i}`, createWallCladdingPBR({ baseHex: hex, style: 'tile', seed: 607 + i * 43 })),
  );
  const woodAccentWall = stdPbr(
    'wood_accent_wall',
    createWallCladdingPBR({ baseHex: 0x8f5e3b, style: 'wood_warm', seed: 733 }),
  );
  const washikiLower = stdPbr(
    'washiki_lower',
    createWallCladdingPBR({ baseHex: 0x563924, style: 'yakisugi', seed: 829 }),
  );
  const shikkuiWall = stdPbr(
    'shikkui_wall',
    createWallCladdingPBR({ baseHex: 0xf1ece1, style: 'plaster', seed: 941 }),
  );

  // 2. Commercial Upper-Storey Porcelain Tile Claddings (pure tile + normalMap, zero corner-sliced painted windows!)
  const commPalette = [
    { baseHex: 0xe4ddd0, accentHex: 0xc5bcb0 },
    { baseHex: 0xc7b198, accentHex: 0x9b8269 },
    { baseHex: 0xab684f, accentHex: 0x854b36 }, // Classic Japanese terracotta-tile Zakkyo building
    { baseHex: 0xbac2c7, accentHex: 0x87929a },
    { baseHex: 0x969088, accentHex: 0x6d6861 },
  ];
  const commUppers = commPalette.map((p, i) =>
    stdPbr(
      `comm_upper_${i}`,
      createWallCladdingPBR({ baseHex: p.baseHex, style: 'comm_tile', accentHex: p.accentHex, seed: 1009 + i * 97 }),
    ),
  );

  // 3. True 3D Recessed Window Panes (Single-quad 3D Parallax Interior Mapping + glossy PBR glass reflections)
  const windowUnlit = std('window_unlit', {
    map: createUnlitWindowTexture({ style: 'curtain' }),
    roughness: 0.06,
    metalness: 0.14,
  });
  applyInteriorMapping(windowUnlit.material, 'unlit_curtain');

  const windowUnlitBlinds = std('window_unlit_blinds', {
    map: createUnlitWindowTexture({ style: 'blinds' }),
    roughness: 0.06,
    metalness: 0.14,
  });
  applyInteriorMapping(windowUnlitBlinds.material, 'unlit_blinds');

  const makeLitWin = (name, variant) => {
    const set = createLitWindowTextureSet(variant);
    const b = std(name, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0,
      roughness: 0.08,
      metalness: 0.08,
    });
    applyInteriorMapping(b.material, variant);
    return b;
  };
  const windowLitWarm = makeLitWin('window_lit_warm', 'living_warm');
  const windowLitAmber = makeLitWin('window_lit_amber', 'amber_shoji');
  const windowLitOffice = makeLitWin('window_lit_office', 'office_cool');
  const windowLitModern = makeLitWin('window_lit_modern', 'modern_led');

  // 4. Shared 3D Ground-Floor Shop Interior Palette + Clear Physical Storefront Glass
  //    (All 1F commercial storefronts now have real 3D furnished rooms + 3D framing/koushi lattice;
  //     parallax Interior Mapping is strictly reserved for windows without 3D interior geometry.)
  const shopGlass = new Bucket(new THREE.MeshPhysicalMaterial({
    name: 'shop_glass',
    color: 0xeaf2f7,
    roughness: 0.015,
    metalness: 0.0,
    transmission: 0.96,
    ior: 1.50,
  }));
  const shop3dPlasterWarm = std('shop3d_plaster_warm', { color: 0x9e8165, roughness: 0.84 });
  const shop3dPlasterCream = std('shop3d_plaster_cream', { color: 0xb7ac9c, roughness: 0.82 });
  const shop3dPlasterCool = std('shop3d_plaster_cool', { color: 0xc8ced4, roughness: 0.76 });
  const shop3dWoodDark = std('shop3d_wood_dark', { color: 0x473526, roughness: 0.52 });
  const shop3dWoodWarm = std('shop3d_wood_warm', { color: 0x7c593e, roughness: 0.56 });
  const shop3dFloorDark = std('shop3d_floor_dark', { color: 0x514437, roughness: 0.32 });
  const shop3dFloorLight = std('shop3d_floor_light', { color: 0xb4b2ac, roughness: 0.20 });
  const shop3dCeilWood = std('shop3d_ceil_wood', { color: 0x5e4934, roughness: 0.78 });
  const shop3dCeilWhite = std('shop3d_ceil_white', { color: 0xd1d4d7, roughness: 0.75 });
  const shop3dMetalDark = std('shop3d_metal_dark', { color: 0x333337, roughness: 0.30, metalness: 0.85 });
  const shop3dGoodsRed = std('shop3d_goods_red', { color: 0xc8554c, roughness: 0.48 });
  const shop3dGoodsBlue = std('shop3d_goods_blue', { color: 0x598ac8, roughness: 0.48 });
  const shop3dGoodsOchre = std('shop3d_goods_ochre', { color: 0xd4a955, roughness: 0.48 });
  const shop3dGoodsGreen = std('shop3d_goods_green', { color: 0x55a574, roughness: 0.48 });
  const shop3dMenuPlaque = std('shop3d_menu_plaque', { color: 0xeadab7, roughness: 0.82 });
  const shop3dLampWarm = std('shop3d_lamp_warm', {
    color: 0xfff3de, emissive: 0xffd792, emissiveIntensity: 0, roughness: 0.15,
  });
  const shop3dLampAmber = std('shop3d_lamp_amber', {
    color: 0xffe7bd, emissive: 0xffbf67, emissiveIntensity: 0, roughness: 0.25,
  });
  const shop3dLampCool = std('shop3d_lamp_cool', {
    color: 0xf7fdff, emissive: 0xedf8ff, emissiveIntensity: 0, roughness: 0.20,
  });
  const shop3dCoolerGlow = std('shop3d_cooler_glow', {
    color: 0xd7eeff, emissive: 0xbfe7ff, emissiveIntensity: 0, roughness: 0.25,
  });

  // Clamped 3D Shop Fascia Signboards (never repeat or slice mid-kanji!)
  let fasciaCounter = 0;
  const makeFascia = (cfg) => {
    const set = createShopFasciaSignSet(cfg);
    return std(`shop_fascia_${fasciaCounter++}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: cfg.backlit === false ? 0 : 0.18,
      roughness: cfg.backlit === false ? 0.72 : 0.42,
    });
  };
  const fasciasIzakaya = [
    makeFascia({ bg: '#261b14', fg: '#f5ebd6', text: '居酒屋 八重', sub: '炭火焼・地酒・肴', border: '#5c4128', backlit: false }),
    makeFascia({ bg: '#8c251e', fg: '#fff6e4', text: '旬菜酒場 まる屋', sub: 'おでん・串焼き', border: '#2b221c' }),
    makeFascia({ bg: '#1e2c42', fg: '#f4efe2', text: '炭火焼鳥 とり源', sub: '備長炭使用', border: '#383028' }),
  ];
  const fasciasRamen = [
    makeFascia({ bg: '#a32820', fg: '#fff6e0', text: '中華そば 一番軒', sub: '自家製麺・支那そば', border: '#241e1a' }),
    makeFascia({ bg: '#302319', fg: '#f5ecd8', text: '手打蕎麦 薮久', sub: '石臼挽き二八蕎麦', border: '#5e442b', backlit: false }),
  ];
  const fasciasKissaten = [
    makeFascia({ bg: '#1e362d', fg: '#e8d29c', text: '自家焙煎 珈琲琥珀', sub: 'COFFEE & TOAST', border: '#3b2c20' }),
    makeFascia({ bg: '#b85c28', fg: '#fffaf0', text: '焼きたて 麦の穂パン', sub: 'BAKERY & CAFE', border: '#3d281c' }),
    makeFascia({ bg: '#2c221e', fg: '#f2e4c6', text: '純喫茶 すずらん', sub: 'SINCE 1978', border: '#6e5536' }),
  ];
  const fasciasPharmacy = [
    makeFascia({ bg: '#186e50', fg: '#ffffff', text: '処方箋 あおば薬局', sub: 'くすり・日用品・調剤', border: '#cfd6d2' }),
    makeFascia({ bg: '#1c568c', fg: '#ffffff', text: 'くらしの店 毎日屋', sub: '青果・精肉・日配品', border: '#d4dadf' }),
  ];
  const fasciasBookstore = [
    makeFascia({ bg: '#233042', fg: '#efe6d2', text: '古書・文具 松栄堂', sub: 'BOOKS & STATIONERY', border: '#4a3d2e' }),
    makeFascia({ bg: '#384534', fg: '#f5efe0', text: '本と雑貨 すずらん堂', sub: '新刊・文庫・万年筆', border: '#2b2824' }),
  ];
  const fasciasAll = [
    ...fasciasIzakaya,
    ...fasciasRamen,
    ...fasciasKissaten,
    ...fasciasPharmacy,
    ...fasciasBookstore,
  ];

  // Konbini striped fascias & framed roadside pylon signs
  const makeKonbiniMat = (name, set, roughness = 0.38) => std(name, {
    map: set.map,
    emissive: 0xffffff,
    emissiveMap: set.emissiveMap,
    emissiveIntensity: 0.25,
    roughness,
  });
  const konbiniFasciaLawson = makeKonbiniMat('konbini_fascia_lawson', createKonbiniFasciaSet('lawson'));
  const konbiniFasciaFamima = makeKonbiniMat('konbini_fascia_famima', createKonbiniFasciaSet('famima'));
  const konbiniPylonLawson = makeKonbiniMat('konbini_pylon_lawson', createKonbiniPylonSet('lawson'));
  const konbiniPylonFamima = makeKonbiniMat('konbini_pylon_famima', createKonbiniPylonSet('famima'));

  // 5. Fix #1: Non-emissive Curved Utility Pole Plaques & Safety Reflector Wrap
  const polePlaqueDefs = [
    { ward: 'すずらん一丁目', num: '12', sub: '本町地区' },
    { ward: 'すずらん一丁目', num: '15', sub: '本町地区' },
    { ward: 'すずらん二丁目', num: '4', sub: '駅前地区' },
    { ward: '本町三丁目', num: '9', sub: '中央地区' },
  ];
  const polePlaques = polePlaqueDefs.map((cfg, i) => std(`pole_plaque_${i}`, {
    map: createPolePlaqueTexture(cfg),
    roughness: 0.34,
    metalness: 0.16,
  }));
  const poleReflector = std('pole_reflector', {
    map: createPoleReflectorTexture(),
    roughness: 0.42,
    metalness: 0.12,
  });

  // 6. Fix #2: Non-emissive Woven Shotengai Streetlamp Flags + 16 Deduplicated Shop Sleeve Signs
  const flagDefs = [
    { bg: '#f5f0e3', accent: '#1d5c42', fg: '#183b2c', title: 'すずらん通り', subtitle: 'SUZURAN ST.' },
    { bg: '#f7f2e7', accent: '#a82c24', fg: '#821e18', title: '歓迎・商店街', subtitle: 'WELCOME' },
    { bg: '#1e3554', accent: '#c9a14a', fg: '#f7f2e6', title: 'すずらん街', subtitle: 'SHOPPING AVE' },
    { bg: '#f6efe0', accent: '#b87624', fg: '#2b2520', title: '歳末大感謝祭', subtitle: '本町振興組合' },
  ];
  const streetFlags = flagDefs.map((cfg, i) => std(`street_flag_${i}`, {
    map: createStreetFlagTexture(cfg),
    roughness: 0.84,
  }));

  const signConfigs = [
    { bg: '#b83227', fg: '#fff8eb', text: '居酒屋', sub: '炭火・地酒' },
    { bg: '#f4ede0', fg: '#1e2b3c', text: '珈琲館', sub: '自家焙煎' },
    { bg: '#1b6e50', fg: '#ffffff', text: '処方箋', sub: '調剤薬局' },
    { bg: '#e0ad2f', fg: '#1d1c1a', text: '中華そば', sub: '手打麺' },
    { bg: '#22385e', fg: '#f5f2e9', text: '古書堂', sub: '新刊・古本' },
    { bg: '#d45c28', fg: '#ffffff', text: '焼きたて', sub: 'ベーカリー' },
    { bg: '#f2efe8', fg: '#9e2620', text: '手打蕎麦', sub: 'うどん' },
    { bg: '#296885', fg: '#ffffff', text: '歯科医院', sub: '小児・矯正' },
    { bg: '#2b1f1a', fg: '#f5d996', text: '炭火焼肉', sub: 'ホルモン' },
    { bg: '#ebe5d8', fg: '#2e4a3e', text: '美容室', sub: 'HAIR SALON' },
    { bg: '#1f5482', fg: '#ffffff', text: '白洋舎', sub: 'クリーニング' },
    { bg: '#2e5e36', fg: '#fff8e8', text: '青果鮮魚', sub: '八百屋' },
    { bg: '#9e2c22', fg: '#fff6e2', text: 'お好み焼', sub: '鉄板焼' },
    { bg: '#f0ece4', fg: '#1d324a', text: '理容室', sub: 'BARBER' },
    { bg: '#3b4a38', fg: '#f5efe2', text: '和菓子司', sub: '茶房・甘味' },
    { bg: '#283340', fg: '#f2e8cf', text: '不動産', sub: '賃貸・売買' },
  ];
  const sleeveSigns = signConfigs.map((cfg, i) => {
    const set = createSleeveSignTextureSet(cfg);
    return std(`sleeve_sign_${i}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.22,
      roughness: 0.42,
    });
  });

  // 4-panel fluttering Noren sets (暖簾)
  const norenDefs = [
    { bg: '#213254', fg: '#f4f0e6', chars: ['酒', '処', '八', '重'] },
    { bg: '#942820', fg: '#fff6e5', chars: ['中', '華', 'そ', 'ば'] },
    { bg: '#eae3d4', fg: '#262320', chars: ['手', '打', '蕎', '麦'] },
    { bg: '#324f3a', fg: '#f5f0e4', chars: ['茶', '房', '甘', '味'] },
  ];
  const norenAll = [];
  const norenSets = norenDefs.map((cfg, sIdx) =>
    cfg.chars.map((kanji, pIdx) => {
      const b = std(`noren_${sIdx}_${pIdx}`, {
        map: createNorenPanelTexture({ bg: cfg.bg, fg: cfg.fg, kanji, isFirst: pIdx === 0 }),
        roughness: 0.92,
      });
      norenAll.push(b);
      return b;
    }),
  );

  // 7. Fix #3: Shotengai Entrance Archway Plaques (Main Suzuran Arch + 3 Distinct Side Street Arches!)
  const makeArchBanner = (name, cfg) => {
    const set = createArchSignTextureSet(cfg);
    return std(name, {
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: set.roughnessMap,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.2,
      roughness: 1.0,
      metalness: 0.12,
    });
  };
  const shotengaiBanner = makeArchBanner('shotengai_banner', {
    bg: '#8c1d18', fg: '#fff8e8', text: 'すずらん本通り', sub: 'SUZURAN GRAND PROMENADE', accent: '#e6c167',
  });
  const sideArchBanners = [
    makeArchBanner('arch_banner_ichibangai', {
      bg: '#1c3b5e', fg: '#fff8e8', text: '一番街通り', sub: 'ICHIBANGAI AVENUE', accent: '#d4af5a',
    }),
    makeArchBanner('arch_banner_yokocho', {
      bg: '#781d18', fg: '#ffeec8', text: 'ほろ酔い横丁', sub: 'LANTERN BAR ALLEY', accent: '#d9b05b',
    }),
    makeArchBanner('arch_banner_yanagi', {
      bg: '#1e4a38', fg: '#f7f3e6', text: '柳小路商店街', sub: 'YANAGI-KOJI STREET', accent: '#d4af5a',
    }),
  ];

  // 8. Roof PBR Materials (512x512 normalMap + roughnessMap)
  const kawaraDark = stdPbr('roof_kawara_dark', createRoofPBR({ baseHex: 0x35393e, style: 'kawara' }), { metalness: 0.14 });
  const kawaraBrown = stdPbr('roof_kawara_brown', createRoofPBR({ baseHex: 0x614233, style: 'kawara' }), { metalness: 0.08 });
  const galvaCharcoal = stdPbr('roof_galva_charcoal', createRoofPBR({ baseHex: 0x2b2f35, style: 'galvalume' }), { metalness: 0.42 });
  const galvaNavy = stdPbr('roof_galva_navy', createRoofPBR({ baseHex: 0x253344, style: 'galvalume' }), { metalness: 0.38 });
  const slateRoof = stdPbr('roof_slate', createRoofPBR({ baseHex: 0x484b50, style: 'slate' }));
  const solarRoof = stdPbr('roof_solar', createRoofPBR({ baseHex: 0x162842, style: 'solar' }), { metalness: 0.52 });

  // Awnings, block walls, AC units, storm drains & Kei-car paint palette
  const awningBurgundy = std('awning_burgundy', { color: 0x7d2622, roughness: 0.86 });
  const awningGreen = std('awning_green', { color: 0x1d4736, roughness: 0.86 });
  const awningNavy = std('awning_navy', { color: 0x213452, roughness: 0.86 });
  const awningOchre = std('awning_ochre', { color: 0xad7224, roughness: 0.86 });

  const blockWall = stdPbr('block_wall', createBlockWallPBR(0x9c988e));
  const phys = (name, props) => new Bucket(new THREE.MeshPhysicalMaterial({ name, ...props }));
  const acBody = std('ac_body', { map: createAcUnitTexture(), roughness: 0.62, metalness: 0.14 });
  const drainGrate = std('drain_grate', { map: createDrainGrateTexture(), roughness: 0.48, metalness: 0.62 });

  // Botanical bark, clipped boxwood hedge & alpha-cutout branchlet crowns
  const trunk = stdPbr('tree_trunk', createBarkPBR(), { normalScale: new THREE.Vector2(1.0, 1.0) });
  const hedge = stdPbr('hedge_green', createHedgePBR(), { normalScale: new THREE.Vector2(1.15, 1.15) });
  const makeFoliage = (name, variant, roughness = 0.70) => {
    const set = createFoliageClusterTextureSet(variant);
    return std(name, {
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness,
      alphaTest: 0.46,
      side: THREE.DoubleSide,
    });
  };
  const foliageFresh = makeFoliage('foliage_fresh', 'zelkova', 0.68);
  const foliageWarm = makeFoliage('foliage_warm', 'maple', 0.70);
  const foliagePine = makeFoliage('foliage_pine', 'pine', 0.74);
  const foliageShrub = makeFoliage('foliage_shrub', 'shrub', 0.62);

  // Dual-layer corrugated Washi paper lanterns (inner glowing filament core + outer rough-transmissive ribbed shell!)
  const chochinCore = std('chochin_core', {
    color: 0xfff6de,
    emissive: 0xffe29a,
    emissiveIntensity: 2.2,
    roughness: 0.22,
  });
  const makeChochin = (name, cfg) => {
    const set = createChochinTextureSet(cfg);
    return phys(name, {
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.22,
      transmission: 0.74,
      roughness: 0.44,
      ior: 1.28,
    });
  };
  const lanternReds = [
    makeChochin('lantern_red_0', { style: 'red', text: '居酒屋', sideText: '炭火焼' }),
    makeChochin('lantern_red_1', { style: 'red', text: '中華そば', sideText: '自家製麺' }),
    makeChochin('lantern_red_2', { style: 'red', text: 'やきとり', sideText: '地酒・肴' }),
  ];
  const lanternWarms = [
    makeChochin('lantern_warm_0', { style: 'warm', text: 'おでん', sideText: '旬菜酒場' }),
    makeChochin('lantern_warm_1', { style: 'warm', text: '手打蕎麦', sideText: '二八蕎麦' }),
  ];

  // Clearcoat metallic Kei-car paint palette, physical transmissive safety glass & Japanese Kei plates
  const carColors = [0xf2f0eb, 0xd8dde2, 0xe8c448, 0x5c8ab5, 0x282c32, 0xc94a3e, 0x86a68a];
  const carPalette = carColors.map((color, i) => phys(`kei_car_${i}`, {
    color,
    roughness: 0.18,
    metalness: 0.34,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
  }));
  const carGlass = phys('car_glass', {
    color: 0xb8ccd8,
    roughness: 0.015,
    metalness: 0.0,
    transmission: 0.86,
    ior: 1.50,
  });
  const carClearLens = phys('car_clear_lens', {
    color: 0xeef5fc,
    roughness: 0.012,
    metalness: 0.0,
    transmission: 0.94,
    ior: 1.50,
  });
  const carTrimBlack = std('car_trim_black', {
    color: 0x14171b,
    roughness: 0.38,
    metalness: 0.10,
  });
  const carHeadlampOff = phys('car_headlamp_off', {
    color: 0xe2ebf2,
    roughness: 0.10,
    metalness: 0.85,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  });
  const carHeadlampOn = std('car_headlamp_on', {
    color: 0xfff8e8,
    emissive: 0xffe8ba,
    emissiveIntensity: 1.6,
    roughness: 0.14,
  });
  const carTaillampOff = phys('car_taillamp_off', {
    color: 0x9c1616,
    roughness: 0.14,
    metalness: 0.22,
    clearcoat: 0.95,
    clearcoatRoughness: 0.04,
  });
  const carTaillampOn = std('car_taillamp_on', {
    color: 0xe62922,
    emissive: 0xff2b1f,
    emissiveIntensity: 1.2,
    roughness: 0.18,
  });
  const carAmber = phys('car_amber', {
    color: 0xd95b08,
    roughness: 0.18,
    metalness: 0.15,
    clearcoat: 0.90,
    clearcoatRoughness: 0.04,
  });
  const keiPlateYellow = std('kei_plate_yellow', {
    map: createKeiLicensePlateTexture({ commercial: false }),
    roughness: 0.36,
    metalness: 0.12,
  });
  const keiPlateBlack = std('kei_plate_black', {
    map: createKeiLicensePlateTexture({ commercial: true }),
    roughness: 0.36,
    metalness: 0.12,
  });

  // 9. Osaka Dotonbori & Shinsaibashi Diverse Promenade Claddings, Unique Landmarks & Signage
  const promenadePaver = stdPbr('promenade_paver', createPromenadePaverPBR());
  const ivoryStone = stdPbr(
    'ivory_stone',
    createWallCladdingPBR({ baseHex: 0xf4efe4, style: 'plaster', seed: 1301 }),
    { roughness: 0.58 },
  );
  const warmTravertine = stdPbr(
    'warm_travertine',
    createWallCladdingPBR({ baseHex: 0xded3c1, style: 'comm_tile', accentHex: 0xbfb29e, seed: 1327 }),
    { roughness: 0.52 },
  );
  const charcoalGranite = stdPbr(
    'charcoal_granite',
    createWallCladdingPBR({ baseHex: 0x262930, style: 'comm_tile', accentHex: 0x1a1c21, seed: 1361 }),
    { metalness: 0.20, roughness: 0.40 },
  );
  const kaniRed = phys('kani_red', {
    color: 0xd11d15,
    roughness: 0.16,
    metalness: 0.05,
    clearcoat: 0.96,
    clearcoatRoughness: 0.05,
  });
  const dragonJade = phys('dragon_jade', {
    color: 0x168a52,
    roughness: 0.18,
    metalness: 0.08,
    clearcoat: 0.92,
    clearcoatRoughness: 0.06,
  });
  const gyozaCrust = std('gyoza_crust', { color: 0xba6a26, roughness: 0.54 });
  const kaniCream = std('kani_cream', { color: 0xf6efe0, roughness: 0.32, metalness: 0.04 });
  const kaniGold = std('kani_gold', { color: 0xe0b34c, roughness: 0.24, metalness: 0.74 });
  const canopyCrimson = std('canopy_crimson', { color: 0xa61c16, roughness: 0.68 });
  const fuguGlow = phys('fugu_glow', {
    color: 0xfff0cc,
    emissive: 0xffc86b,
    emissiveIntensity: 0.32,
    transmission: 0.72,
    roughness: 0.38,
    ior: 1.28,
  });
  const marqueeBulb = std('marquee_bulb', {
    color: 0xfff6e0,
    emissive: 0xffd280,
    emissiveIntensity: 1.8,
    roughness: 0.18,
  });
  const coveGlowSet = createCoveGlowTextureSet();
  const coveWarm = std('cove_warm', {
    map: coveGlowSet.map,
    emissive: 0xffffff,
    emissiveMap: coveGlowSet.emissiveMap,
    emissiveIntensity: 0.35,
    roughness: 0.55,
  });

  const ohshoSet = createOhshoLanternStackSet();
  const ohshoLantern = phys('ohsho_lantern', {
    map: ohshoSet.map,
    emissive: 0xffffff,
    emissiveMap: ohshoSet.emissiveMap,
    emissiveIntensity: 0.30,
    transmission: 0.70,
    roughness: 0.42,
    ior: 1.28,
  });

  const dotonboriFasciaDefs = [
    { style: 'ivory_sumi', text: 'かに道楽', badge: '本店', sub: 'KANI DORAKU · 活かに会席', seal: '道楽' },
    { style: 'lacquer_gold', text: '鉄板神社 総本店', sub: 'TEPPAN JINJYA · 黒毛和牛串焼', seal: '神社' },
    { style: 'crimson_gold', text: '本家 大たこ', sub: 'HONKE ŌTAKO · 名物たこ焼', seal: '本家' },
    { style: 'chibo_neon', text: 'お好み焼 千房', sub: 'OKONOMIYAKI CHIBO · 鉄板焼', seal: '千房' },
    { style: 'ivory_sumi', text: '名代 ふぐ料理 玄品', badge: '本店', sub: 'TORA-FUGU KAISEKI · てっちり', seal: '玄品' },
    { style: 'crimson_gold', text: '元祖串かつ だるま', sub: 'KUSHIKATSU DARUMA · 二度漬け禁止', seal: '元祖' },
    { style: 'lacquer_gold', text: '鮨・割烹 橘本陣', sub: 'OMAKASE SUSHI & KAPPŌ · 天然本鮪', seal: '本陣' },
    { style: 'crimson_gold', text: '中央 マルチビジョン館', sub: 'SUZURAN GRAND VISION · PLAZA', seal: '中央' },
    { style: 'crimson_gold', text: '金龍ラーメン 本店', sub: 'KINRYU RAMEN · 秘伝豚骨スープ', seal: '金龍' },
    { style: 'ivory_sumi', text: '餃子専門 元祖王将', badge: '本店', sub: 'GYOZA OHSHO · 元祖焼餃子', seal: '王将' },
    { style: 'lacquer_gold', text: '元祖 廻る元禄寿司', sub: 'GENROKU SUSHI · 創業昭和三十三年', seal: '元禄' },
    { style: 'modern_minimal', bgHex: '#13161c', accent: '#e0ba67', text: 'LUMIÈRE MODE', sub: 'LUXURY BOUTIQUE & ATELIER' },
    { style: 'lacquer_gold', text: 'すき焼・和牛 はり重', sub: 'SUKIYAKI HARIJU · 創業大正八年', seal: 'はり' },
    { style: 'modern_minimal', bgHex: '#1b2b21', accent: '#d8be78', text: '宇治茶 辻利兵衛本店', sub: 'UJI MATCHA & WAGASHI SALON' },
    { style: 'modern_minimal', bgHex: '#f5f2eb', accent: '#c92218', text: '中央 免税コスメ館', sub: 'COSMETICS · WATCHES · TAX FREE' },
    { style: 'ivory_sumi', text: '北極星 洋食本店', badge: '老舗', sub: 'HOKKYOKUSEI · 大正オムライス', seal: '洋食' },
    { style: 'kabuki_theatre', text: 'すずらん松竹座', sub: 'SUZURAN SHOCHIKUZA · 歌舞伎・演劇殿堂' },
    { style: 'modern_minimal', bgHex: '#f6f0e2', accent: '#6b4e2e', text: 'うどん 粋家 今井', sub: 'UDON SUKIYA IMAI · 創業昭和二十一年' },
  ];
  const dotonboriFascias = dotonboriFasciaDefs.map((cfg, i) => {
    const set = createDotonboriFasciaSet(cfg);
    return std(`dotonbori_fascia_${i}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.28,
      roughness: 0.36,
    });
  });
  const kabukiFascia = dotonboriFascias[16];
  const imaiFascia = dotonboriFascias[17];

  const towerSignDefs = [
    [
      { bg: '#186b42', fg: '#fff8e8', accent: '#f2c955', text: '元祖串かつ', sub: '名代' },
      { bg: '#f0be37', fg: '#181410', accent: '#9e1c14', text: '24時間\n営業', sub: '年中無休', horizontal: true },
      { bg: '#b82018', fg: '#fff8eb', accent: '#f2c955', text: 'だるま本店', sub: '串かつ' },
    ],
    [
      { bg: '#faf4e6', fg: '#171311', accent: '#c42218', text: 'かに道楽', sub: '活かに' },
      { bg: '#c42218', fg: '#fff8eb', accent: '#f2cf70', text: '炭火かにすき', sub: '会席' },
      { bg: '#1e2c44', fg: '#f5dfb0', accent: '#d9b256', text: '個室予約承り', sub: '2F〜4F' },
    ],
    [
      { bg: '#181311', fg: '#f5d27a', accent: '#cf261d', text: '鉄板神社', sub: '総本店' },
      { bg: '#b82218', fg: '#fff8eb', accent: '#f5d27a', text: '黒毛和牛', sub: 'A5等級' },
      { bg: '#f5ecd8', fg: '#181311', accent: '#181311', text: 'お好み焼', sub: '鉄板焼' },
    ],
    [
      { bg: '#cc1f16', fg: '#ffffff', accent: '#ffe078', text: '免税\nTAX FREE', sub: 'DUTY FREE', horizontal: true },
      { bg: '#193561', fg: '#fff6e0', accent: '#ebbf57', text: '時計・宝飾品', sub: 'LUXURY' },
      { bg: '#187050', fg: '#ffffff', accent: '#cbe8d8', text: '医薬品・化粧品', sub: 'COSME' },
    ],
    [
      { bg: '#14241b', fg: '#52f290', accent: '#ff4838', text: '千房本店', sub: 'お好み焼' },
      { bg: '#d94c1e', fg: '#fffaf0', accent: '#ffe078', text: '特製ねぎ焼', sub: '名物' },
      { bg: '#f2c23d', fg: '#171411', accent: '#171411', text: '鉄板ステーキ', sub: '和牛' },
    ],
    [
      { bg: '#1b3054', fg: '#fff8eb', accent: '#e6be58', text: 'とらふぐ亭', sub: '活ふぐ' },
      { bg: '#faf5ea', fg: '#181412', accent: '#1b3054', text: 'てっちり鍋', sub: '名代' },
      { bg: '#9e2219', fg: '#fff6e2', accent: '#e6be58', text: '白子・てっさ', sub: '季節味覚' },
    ],
    [
      { bg: '#c9281d', fg: '#fff8eb', accent: '#ffd86b', text: '金龍ラーメン', sub: '24H営業' },
      { bg: '#f2be38', fg: '#181410', accent: '#b81f17', text: '豚骨・焼豚', sub: '秘伝' },
      { bg: '#212e42', fg: '#fff5df', accent: '#f2be38', text: '生ビール・酒', sub: '酒処' },
    ],
    [
      { bg: '#1c2433', fg: '#f5d482', accent: '#d4ab4e', text: '元禄寿司', sub: '回転寿司' },
      { bg: '#f7f2e6', fg: '#192230', accent: '#b8241a', text: '天然本鮪', sub: '大トロ' },
      { bg: '#1e5c45', fg: '#fff8ec', accent: '#e8c468', text: '活魚にぎり', sub: 'SUSHI' },
    ],
  ];
  const towerSigns = towerSignDefs.map((tiers, i) => {
    const set = createTowerSignTextureSet(tiers);
    return std(`tower_sign_${i}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.30,
      roughness: 0.38,
    });
  });

  const rooftopSigns = ['taxfree', 'kanidoraku', 'chibo', 'ebisu', 'asahi_gold'].map((v, i) => {
    const set = createRooftopBillboardSet(v);
    return std(`rooftop_sign_${i}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.34,
      roughness: 0.35,
    });
  });

  const podiumPosters = [
    'wagyu', 'crab_feast', 'gourmet_fest', 'glico_sprinter', 'neon_ring', 'cosme_luxury', 'kabuki_bill',
  ].map((v, i) => {
    const set = createPodiumPosterSet(v);
    return std(`podium_poster_${i}`, {
      map: set.map,
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.30,
      roughness: 0.34,
    });
  });

  const festivalLanterns = [
    { text: 'すずらん', sub: '中央本通り' },
    { text: '本町筋', sub: '歓迎・商店街' },
  ].map((cfg, i) => {
    const set = createFestivalLanternSet(cfg);
    return phys(`festival_lantern_${i}`, {
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.80, 0.80),
      emissive: 0xffffff,
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0.28,
      transmission: 0.72,
      roughness: 0.42,
      ior: 1.28,
    });
  });

  return {
    promenadePaver,
    ivoryStone,
    warmTravertine,
    charcoalGranite,
    kaniRed,
    dragonJade,
    gyozaCrust,
    kaniCream,
    kaniGold,
    canopyCrimson,
    fuguGlow,
    marqueeBulb,
    coveWarm,
    ohshoLantern,
    dotonboriFascias,
    kabukiFascia,
    imaiFascia,
    towerSigns,
    rooftopSigns,
    podiumPosters,
    sprinterPoster: podiumPosters[3],
    neonRingPoster: podiumPosters[4],
    cosmePoster: podiumPosters[5],
    kabukiPoster: podiumPosters[6],
    festivalLanterns,
    houseLightWalls,
    houseLightBlanks: houseLightWalls,
    houseSlitWalls,
    houseDarkWalls,
    houseDarkBlanks: houseDarkWalls,
    houseTileWalls,
    woodAccentWall,
    washikiLower,
    shikkuiWall,
    shikkuiBlank: shikkuiWall,
    commUppers,
    commUpperLight: commUppers[0],
    windowUnlit,
    windowUnlitBlinds,
    windowLitWarm,
    windowLitAmber,
    windowLitOffice,
    windowLitModern,
    windowLitList: [windowLitWarm, windowLitAmber, windowLitOffice, windowLitModern],
    shopGlass,
    shop3dPlasterWarm,
    shop3dPlasterCream,
    shop3dPlasterCool,
    shop3dWoodDark,
    shop3dWoodWarm,
    shop3dFloorDark,
    shop3dFloorLight,
    shop3dCeilWood,
    shop3dCeilWhite,
    shop3dMetalDark,
    shop3dGoodsRed,
    shop3dGoodsBlue,
    shop3dGoodsOchre,
    shop3dGoodsGreen,
    shop3dMenuPlaque,
    shop3dLampWarm,
    shop3dLampAmber,
    shop3dLampCool,
    shop3dCoolerGlow,
    fasciasIzakaya,
    fasciasRamen,
    fasciasKissaten,
    fasciasPharmacy,
    fasciasBookstore,
    fasciasAll,
    konbiniFasciaLawson,
    konbiniFasciaFamima,
    konbiniPylonLawson,
    konbiniPylonFamima,
    konbiniLitList: [konbiniFasciaLawson, konbiniFasciaFamima, konbiniPylonLawson, konbiniPylonFamima],
    shopRetails: [
      { kind: 'kissaten', fascias: fasciasKissaten },
      { kind: 'pharmacy', fascias: fasciasPharmacy },
      { kind: 'bookstore', fascias: fasciasBookstore },
      { kind: 'izakaya', fascias: fasciasIzakaya },
      { kind: 'ramen', fascias: fasciasRamen },
    ],
    polePlaques,
    poleReflector,
    streetFlags,
    sleeveSigns,
    norenSets,
    norenAll,
    shotengaiBanner,
    sideArchBanners,
    archGoldTrim: std('arch_gold_trim', { color: 0xc9a354, roughness: 0.30, metalness: 0.74 }),
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
    acBody,
    drainGrate,
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
    frostedPanel: std('frosted_panel', { color: 0x9ab4c2, roughness: 0.24, metalness: 0.15 }),
    carportRoof: std('carport_roof', { color: 0x526472, roughness: 0.32, metalness: 0.25 }),
    poleConcrete: std('pole_concrete', { color: 0x8d8a82, roughness: 0.88 }),
    woodWarm: std('wood_warm', { color: 0x8c5b36, roughness: 0.78 }),
    woodDark: std('wood_dark', { color: 0x3b2a1e, roughness: 0.84 }),
    darkMetal: std('dark_metal', { color: 0x2a2e33, roughness: 0.42, metalness: 0.62 }),
    gutterMetal: std('gutter_metal', { color: 0x3b3f45, roughness: 0.40, metalness: 0.54 }),
    silverMetal: std('silver_metal', { color: 0xa6acb2, roughness: 0.34, metalness: 0.72 }),
    acUnit: std('ac_unit', { color: 0xdcd9d0, roughness: 0.65, metalness: 0.15 }),
    glassDark: std('glass_dark', { color: 0x202b33, roughness: 0.08, metalness: 0.18 }),
    accentRed: std('accent_red', { color: 0xa82820, roughness: 0.44, metalness: 0.18 }),
    warmLamp: std('warm_lamp', { color: 0xfff0d4, emissive: 0xffc675, emissiveIntensity: 1.5, roughness: 0.32 }),
    chochinCore,
    lanternReds,
    lanternWarms,
    lanternRed: lanternReds[0],
    lanternWarm: lanternWarms[0],
    lanternAll: [...lanternReds, ...lanternWarms],
    vendRed: std('vend_red', { color: 0xa82622, roughness: 0.42, metalness: 0.16 }),
    vendBlue: std('vend_blue', { color: 0x1f5694, roughness: 0.42, metalness: 0.16 }),
    vendWhite: std('vend_white', { color: 0xe6e3dc, roughness: 0.42, metalness: 0.16 }),
    vendFace: std('vend_face', { color: 0xdff2ff, emissive: 0xd4ecff, emissiveIntensity: 1.2, roughness: 0.28 }),
    ceramicPot: std('ceramic_pot', { color: 0x6e402b, roughness: 0.52, metalness: 0.08 }),
    trunk,
    hedge,
    foliageFresh,
    foliagePine,
    foliageWarm,
    foliageShrub,
    wire: std('overhead_wire', { color: 0x1d1e21, roughness: 0.7 }),
    carGlass,
    carClearLens,
    carTrimBlack,
    carTire: std('car_tire', { color: 0x1e2023, roughness: 0.84, metalness: 0.06 }),
    carUndercarriage: std('car_undercarriage', { color: 0x16181b, roughness: 0.88, metalness: 0.18 }),
    carHeadlampOff,
    carHeadlampOn,
    carTaillampOff,
    carTaillampOn,
    carAmber,
    keiPlateYellow,
    keiPlateBlack,
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

function addNorthSouthAvenue(
  mats, x, z0, z1, roadHalf = 4.6, walkW = 2.1, tactile = false, withDrainGrates = false, promenade = false,
) {
  const len = z1 - z0;
  if (len <= 2) return;
  const midZ = (z0 + z1) * 0.5;
  if (promenade && mats.promenadePaver) {
    // Honed granite interlocking herringbone stone carriageway & wide pedestrian promenade!
    mats.promenadePaver.add(box(roadHalf * 2, 0.105, len, 3.4, 3.4), x, 0.052, midZ);
  } else {
    mats.road.add(box(roadHalf * 2, 0.1, len), x, 0.05, midZ);
  }

  for (const s of [-1, 1]) {
    if (promenade && mats.promenadePaver) {
      mats.promenadePaver.add(box(walkW, 0.2, len, 2.6, 2.6), x + s * (roadHalf + walkW * 0.5), 0.1, midZ);
      mats.archGoldTrim.add(box(0.05, 0.02, len - 2), x + s * (roadHalf + 0.22), 0.205, midZ);
    } else {
      mats.sidewalk.add(box(walkW, 0.2, len), x + s * (roadHalf + walkW * 0.5), 0.1, midZ);
    }
    // Granite/concrete curb + street gutter apron (L型側溝)
    mats.concrete.add(box(0.18, 0.22, len), x + s * (roadHalf + 0.09), 0.11, midZ);
    mats.concrete.add(box(0.32, 0.015, len - 2), x + s * (roadHalf - 0.16), 0.106, midZ);
    if (!promenade) {
      mats.roadPaint.add(box(0.14, 0.02, len - 4), x + s * (roadHalf - 0.55), 0.108, midZ);
    }
    if (tactile) {
      mats.tactileYellow.add(box(0.28, 0.02, len - 2), x + s * (roadHalf + 0.82), 0.208, midZ);
    }
    if (withDrainGrates) {
      for (let gz = z0 + 12; gz < z1 - 12; gz += 15) {
        mats.drainGrate.add(box(0.30, 0.02, 0.86, 0.30, 0.86), x + s * (roadHalf - 0.16), 0.110, gz);
      }
    }
  }
  if (!promenade) {
    for (let z = z0 + 9; z < z1 - 9; z += 9.5) {
      mats.roadPaint.add(box(0.14, 0.02, 3.8), x, 0.108, z);
    }
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

let _globalSignSeq = 0;

/**
 * Curated Zero-Repetition Osaka Minami Promenade Planner:
 * Mixes strictly ONE-OF-A-KIND Dotonbori landmarks (1 Crab, 1 Shochikuza Theatre, 1 Kinryu Dragon,
 * 1 Osaka Ohsho Gyoza+Lanterns, 1 Dotonbori Imai Willow Sukiya, 1 Genroku Sushi, 1 Fugu, 1 Octopus,
 * 1 Ebisu Sprinter Media Wall, 1 Teppan Crest) with 6 upscale Shinsaibashi/Taisho architectural styles
 * AND classic 2F clay-roofed Machiya, Corner Kissaten cafés, and 3F–4F Porcelain Zakkyo shops!
 */
function resolvePromenadeSlot(sideKey, blockIdx, lotInBlock, atCorner) {
  const key = `${sideKey}:${blockIdx}:${lotInBlock}`;
  const UNIQUE_SLOTS = {
    // Block 4 (z = 534..586): South approach & `street` camera foreground
    'west:4:0': { kind: 'kissaten', w: 9.6 },
    'west:4:1': { kind: 'flagship', archStyle: 1, storeys: 4, w: 10.6, fasciaIdx: 12 }, // はり重 Taisho Brick
    'west:4:2': { kind: 'shotengai', storeys: 3, w: 8.4 },
    'west:4:3': { kind: 'flagship', archStyle: 5, storeys: 5, w: 10.2, fasciaIdx: 6 },
    'east:4:0': { kind: 'flagship', archStyle: 0, storeys: 4, w: 10.8, fasciaIdx: 11 }, // Shinsaibashi Luxury Glass
    'east:4:1': { kind: 'machiya', w: 7.8 },
    'east:4:2': { kind: 'shotengai', storeys: 3, w: 8.6 },
    'east:4:3': { kind: 'flagship', archStyle: 2, storeys: 4, w: 10.2, fasciaIdx: 13 },

    // Block 3 (z = 444..518): Grand Entrance Block framed inside z = 514 道頓堀 戎橋通り Arch!
    'west:3:0': { kind: 'flagship', archStyle: 3, storeys: 5, w: 10.4, fasciaIdx: 14 },
    'west:3:1': { kind: 'machiya', w: 7.6 },
    'west:3:2': { kind: 'flagship', landmark: 'teppan_shrine', storeys: 4, w: 10.2 },   // Unique 鉄板神社!
    'west:3:3': { kind: 'shotengai', storeys: 3, w: 8.4 },
    'west:3:4': { kind: 'flagship', archStyle: 2, storeys: 4, w: 9.6, fasciaIdx: 13 },
    'west:3:5': { kind: 'flagship', landmark: 'ebisu_media', storeys: 6, w: 12.2, crown: 3 }, // Unique Sprinter Media Wall!
    'east:3:0': { kind: 'kissaten', w: 9.4 },
    'east:3:1': { kind: 'flagship', archStyle: 4, storeys: 5, w: 10.2, fasciaIdx: 5 },
    'east:3:2': { kind: 'shotengai', storeys: 4, w: 8.6 },
    'east:3:3': { kind: 'machiya', w: 7.6 },
    'east:3:4': { kind: 'flagship', archStyle: 1, storeys: 4, w: 9.8, fasciaIdx: 15 },
    'east:3:5': { kind: 'flagship', landmark: 'shochikuza', storeys: 5, w: 13.2 },      // Unique 大阪松竹座 Theatre!

    // Block 2 (z = 332..428): Central Dotonbori Culinary & Luxury Heart (`shotengai_walk` & `shotengai`)
    'west:2:0': { kind: 'kissaten', w: 9.4 },
    'west:2:1': { kind: 'flagship', archStyle: 2, storeys: 4, w: 9.8, fasciaIdx: 13 },  // 宇治茶 辻利 Cedar Louvers
    'west:2:2': { kind: 'flagship', landmark: 'genroku_sushi', storeys: 3, w: 9.8 },    // Unique 元禄寿司 Giant Nigiri!
    'west:2:3': { kind: 'shotengai', storeys: 3, w: 8.2 },
    'west:2:4': { kind: 'flagship', landmark: 'osaka_ohsho', storeys: 4, w: 10.6 },     // Unique 大阪王将 Gyoza + 4 Lanterns!
    'west:2:5': { kind: 'flagship', archStyle: 1, storeys: 4, w: 10.0, fasciaIdx: 15 }, // 北極星 Taisho Heritage Brick
    'west:2:6': { kind: 'machiya', w: 7.6 },
    'west:2:7': { kind: 'flagship', archStyle: 5, storeys: 5, w: 10.4, fasciaIdx: 6, crown: 0 },
    'east:2:0': { kind: 'flagship', archStyle: 4, storeys: 5, w: 10.6, fasciaIdx: 3, crown: 2 }, // 千房 Neon Tower
    'east:2:1': { kind: 'machiya', w: 7.8 },
    'east:2:2': { kind: 'flagship', landmark: 'kinryu_dragon', storeys: 3, w: 10.6 },   // Unique 金龍 Emerald Dragon!
    'east:2:3': { kind: 'flagship', archStyle: 0, storeys: 4, w: 10.2, fasciaIdx: 11 }, // Shinsaibashi Glass + Neon Ring
    'east:2:4': { kind: 'flagship', landmark: 'imai', storeys: 3, w: 9.8 },             // Unique 道頓堀 今井 Willow Sukiya!
    'east:2:5': { kind: 'flagship', landmark: 'kani_doraku', storeys: 4, w: 10.8 },     // THE ONE & ONLY かに道楽 Crab!
    'east:2:6': { kind: 'flagship', archStyle: 3, storeys: 5, w: 10.4, fasciaIdx: 14 }, // 心斎橋 免税コスメ館
    'east:2:7': { kind: 'shotengai', storeys: 3, w: 8.6 },

    // Block 1 (z = 240..316): Mid-North Promenade
    'west:1:5': { kind: 'flagship', landmark: 'otako_octopus', storeys: 4, w: 10.4 },   // Unique 本家 大たこ Octopus!
    'east:1:3': { kind: 'flagship', landmark: 'zuboraya_fugu', storeys: 4, w: 10.2 },   // Unique 名代 とらふぐ Lantern!
  };
  if (UNIQUE_SLOTS[key]) return UNIQUE_SLOTS[key];

  // Diverse fallback mix across Blocks 0 & 1 (zero repeated 3D mascots!)
  const mixHash = (blockIdx * 7 + lotInBlock * 3 + (sideKey === 'east' ? 5 : 0)) % 9;
  if (atCorner && mixHash % 3 === 0) return { kind: 'kissaten', w: 9.4 };
  if (mixHash === 1) return { kind: 'machiya', w: 7.6 };
  if (mixHash === 3 || mixHash === 7) return { kind: 'shotengai', storeys: mixHash === 3 ? 3 : 4, w: 8.6 };
  const archStyle = (blockIdx * 2 + lotInBlock + (sideKey === 'east' ? 3 : 0)) % 6;
  const storeys = [4, 3, 4, 5, 5, 4][archStyle];
  const fasciaMap = [11, 12, 13, 14, 6, 15];
  return {
    kind: 'flagship',
    archStyle,
    storeys,
    w: 9.8 + (lotInBlock % 3) * 0.6,
    fasciaIdx: fasciaMap[archStyle],
    crown: (atCorner && storeys >= 5) ? ((blockIdx + lotInBlock) % 5) : null,
  };
}

/**
 * Populates a commercial frontage strip (小商圈 / 大阪ミナミ・道頓堀商店街) from startPos to endPos.
 */
function populateCommercialStrip(mats, rnd, {
  axis = 'z', fixedCoord, from, to, yaw, crossCoords = [], detail = true, allowSuper = false, mode = 'retail', sideKey = 'west',
}) {
  let cursor = from;
  const depth = mode === 'dotonbori' ? 12.2 : 11.4;
  let stripSeq = sideKey === 'east' ? 17 : 0;
  let currentBlock = -1;
  let lotInBlock = 0;

  while (cursor < to - 5.5) {
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

    const blockIdx = crossCoords.filter((c) => c < cursor).length - 1;
    if (blockIdx !== currentBlock) {
      currentBlock = blockIdx;
      lotInBlock = 0;
    }

    const atCorner = crossCoords.some((c) => Math.abs(cursor - (c + 8.0)) < 2.2 || Math.abs((cursor + 12) - (c - 7.5)) < 3.5);
    let lotW;
    let builderType;
    let slotSpec = null;

    if (mode === 'dotonbori') {
      slotSpec = resolvePromenadeSlot(sideKey, Math.max(0, blockIdx), lotInBlock, atCorner);
      lotW = Math.min(slotSpec.w ?? 10.0, distToNextCross);
      builderType = slotSpec.kind;
      lotInBlock += 1;
    } else if (mode === 'yokocho') {
      if (atCorner && distToNextCross >= 9.2 && rnd() < 0.55) {
        lotW = Math.min(9.4, distToNextCross);
        builderType = 'kissaten';
      } else if (rnd() < 0.54) {
        lotW = Math.min(6.4 + rnd() * 2.0, distToNextCross);
        builderType = 'machiya';
      } else {
        lotW = Math.min(6.8 + rnd() * 2.4, distToNextCross);
        builderType = 'shotengai';
      }
    } else if (allowSuper && distToNextCross >= 17.5 && rnd() < 0.18) {
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
      _globalSignSeq = (_globalSignSeq + 5) % mats.sleeveSigns.length;
      const signSeed = _globalSignSeq;

      if (builderType === 'flagship') {
        const crownIdx = slotSpec?.crown ?? null;
        buildDotonboriFlagship(lot, mats, rnd, {
          w: lotW - 0.18,
          d: depth,
          storeys: slotSpec?.storeys ?? 4,
          seq: crownIdx !== null ? crownIdx : stripSeq,
          landmark: slotSpec?.landmark ?? null,
          archStyle: slotSpec?.archStyle ?? 0,
          fasciaIdx: slotSpec?.fasciaIdx ?? null,
          withRooftopCrown: crownIdx !== null,
        });
        stripSeq += 1;
      } else if (builderType === 'konbini') {
        buildKonbini(lot, mats, rnd, { w: lotW - 0.3, d: depth, twoStorey: rnd() < 0.42, detail });
      } else if (builderType === 'super') {
        buildNeighborhoodSuper(lot, mats, rnd, { w: lotW - 0.4, d: depth + 1.5, detail });
      } else if (builderType === 'kissaten') {
        buildKissatenCorner(lot, mats, rnd, { w: lotW - 0.3, d: depth - 0.6, detail });
      } else if (builderType === 'machiya') {
        buildMachiyaShop(lot, mats, rnd, { w: lotW - 0.25, d: depth - 0.5, detail, signSeed });
      } else {
        const storeys = rnd() < 0.28 ? 2 : (rnd() < 0.72 ? 3 : 4);
        buildShotengaiBuilding(lot, mats, rnd, { w: lotW - 0.25, d: depth, storeys, detail, signSeed });
      }
      if (mode === 'yokocho') {
        const frontZ = depth * 0.5 + 0.32;
        addChochinRow(lot, mats, {
          x0: -lotW * 0.34,
          x1: lotW * 0.34,
          y: 2.96,
          z: frontZ,
          count: Math.max(2, Math.round(lotW / 2.6)),
          red: rnd() < 0.58,
          rich: detail,
          seed: signSeed + 1,
          tall: true,
        });
        if (rnd() < 0.68) {
          _globalSignSeq = (_globalSignSeq + 3) % mats.sleeveSigns.length;
          addSleeveSign(lot, mats, _globalSignSeq, { x: lotW * 0.38, y: 4.45, z: frontZ - 0.1 });
        }
      }
    }

    cursor += lotW + (mode === 'dotonbori' ? 0.16 : 0.3 + rnd() * 0.35);
  }
}

/**
 * Subdivides a rectangular residential superblock [x0..x1] x [z0..z1] into
 * East-West local residential lanes (生活道路) and double-loaded rows of Japanese 一戸建て!
 */
function populateIkkodateBlock(mats, rnd, { x0, x1, z0, z1, lampSpots = null }) {
  const widthX = x1 - x0;
  const depthZ = z1 - z0;
  if (widthX < 10 || depthZ < 12) return;

  const lanePitch = 28.5;
  const strips = Math.max(1, Math.round(depthZ / lanePitch));
  const stripDepth = depthZ / strips;

  for (let s = 0; s < strips; s++) {
    const sz0 = z0 + s * stripDepth;
    const sz1 = sz0 + stripDepth;
    const laneZ = (sz0 + sz1) * 0.5;

    if (stripDepth >= 22) {
      if (!insideAnyPlotPlaza((x0 + x1) * 0.5, laneZ, 2)) {
        addResidentialLaneEW(mats, laneZ, x0 + 0.5, x1 - 0.5);
        let lampIdx = 0;
        for (let lx = x0 + 14; lx < x1 - 12; lx += 28) {
          if (insideAnyPlotPlaza(lx, laneZ, 4)) continue;
          const side = (lampIdx++ % 2 === 0) ? 1 : -1;
          const lz = laneZ + side * 2.22;
          mats.darkMetal.add(box(0.09, 4.1, 0.09), lx, 2.05, lz);
          mats.darkMetal.add(box(0.08, 0.08, 0.65), lx, 4.05, lz - side * 0.32);
          mats.warmLamp.add(box(0.24, 0.14, 0.36), lx, 3.98, lz - side * 0.58);
          if (lampSpots) lampSpots.push({ x: lx, y: 4.0, z: lz - side * 0.5, radius: 17 });
        }
      }

      const lotD = Math.min(13.2, (stripDepth - 4.8) * 0.5);
      const rows = [
        { cz: laneZ - 2.4 - lotD * 0.5, yaw: 0 },
        { cz: laneZ + 2.4 + lotD * 0.5, yaw: Math.PI },
      ];

      let innerPoleIdx = 0;
      for (let px = x0 + 12; px < x1 - 10; px += 52) {
        if (Math.hypot(px, laneZ - 300) < 320 && !insideAnyPlotPlaza(px, laneZ + 2.2, 4)) {
          addUtilityPole(mats, px, laneZ + 2.25, rnd() < 0.3, 0, 1, innerPoleIdx++);
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
            const tier = dist < 260 ? 2 : (dist < 460 ? 1 : 0);
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
          const tier = dist < 260 ? 2 : (dist < 460 ? 1 : 0);
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
  _globalSignSeq = 0;
  const mats = createMaterialLibrary();
  const lampSpots = [
    { x: 0, y: 6.5, z: 134, radius: 28 },
    { x: -42, y: 6.0, z: 72, radius: 28 },
    { x: 42, y: 6.0, z: 72, radius: 28 },
  ];

  // 1. Subtle urban ground plane
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
  mats.plaza.add(box(300, 0.12, 250), 0, 0.06, 10);
  mats.plazaBorder.add(box(304, 0.1, 4.0), 0, 0.05, 135);
  mats.plazaBorder.add(box(304, 0.1, 4.0), 0, 0.05, -115);

  for (let i = 1; i < PLOTS.length; i++) {
    const p = PLOTS[i];
    mats.plaza.add(box(236, 0.05, 150), p.x, -0.015, p.z);
    mats.plazaBorder.add(box(242, 0.045, 156), p.x, -0.02, p.z);
    for (let tx = p.x - 108; tx <= p.x + 108; tx += 27) {
      for (const tz of [p.z - 73, p.z + 73]) {
        const treeLot = new LotContext(tx, tz, 0, 0);
        addGardenTree(treeLot, mats, 0, 0, 1.25, 'leafy');
      }
    }
  }
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

  // 3. Japanese Town Road Network
  const ewCrossZs = [144, 232, 324, 436, 526, 594];
  const northEwZs = [-122, -198, -362, -452, -538, -714];
  const nsAvenueXs = [-600, -460, -182, 182, 460, 600];

  // Main North-South Osaka Dotonbori Flagship Promenade (herringbone granite stone pavers & undergrounded utilities!)
  addNorthSouthAvenue(mats, 0, STREET.from, STREET.to + 4, STREET.road, 2.42, true, true, true);

  for (const ax of nsAvenueXs) {
    addNorthSouthAvenue(mats, ax, -716, 598, 4.4, 1.8, Math.abs(ax) === 182, false);
  }

  for (const az of [...ewCrossZs, ...northEwZs]) {
    addEastWestAvenue(mats, az, -604, 604, 4.2, 1.8);
  }

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

  // Main Dotonbori Ebisu Grand Entrance Archway + Central Promenade Arch + Side-Street Arches!
  addShotengaiArch(mats, 514, STREET.road + 1.15, mats.shotengaiBanner, 0, 0);
  addShotengaiArch(mats, 240, STREET.road + 1.15, mats.shotengaiBanner, 0, 0);
  for (const side of [-1, 1]) {
    addShotengaiArch(mats, 324, 4.85, mats.sideArchBanners[0], side * 13.0, Math.PI * 0.5);
  }

  // 4. OSAKA DOTONBORI FLAGSHIP PROMENADE & COMMERCIAL DISTRICTS
  const mainFrontX = FRONT + 5.85;
  const allCrossZs = [...northEwZs, ...ewCrossZs].sort((a, b) => a - b);

  populateCommercialStrip(mats, rnd, {
    axis: 'z', fixedCoord: -mainFrontX, from: 152, to: 586, yaw: Math.PI * 0.5,
    crossCoords: ewCrossZs, detail: true, allowSuper: false, mode: 'dotonbori', sideKey: 'west',
  });
  populateCommercialStrip(mats, rnd, {
    axis: 'z', fixedCoord: mainFrontX, from: 152, to: 586, yaw: -Math.PI * 0.5,
    crossCoords: ewCrossZs, detail: true, allowSuper: false, mode: 'dotonbori', sideKey: 'east',
  });

  for (const dir of [-1, 1]) {
    const xStart = dir > 0 ? 21 : -173;
    const xEnd = dir > 0 ? 173 : -21;
    populateCommercialStrip(mats, rnd, {
      axis: 'x', fixedCoord: 232 - 11.8, from: xStart, to: xEnd, yaw: 0,
      crossCoords: [], detail: true, allowSuper: true,
    });
    populateCommercialStrip(mats, rnd, {
      axis: 'x', fixedCoord: 232 + 11.8, from: xStart, to: xEnd, yaw: Math.PI,
      crossCoords: [], detail: true, allowSuper: true,
    });
  }

  for (const [cz, mode] of [[324, 'retail'], [436, 'yokocho']]) {
    for (const [xStart, xEnd] of [[-448, -192], [-173, -21], [21, 173], [192, 448]]) {
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: cz - 11.8, from: xStart, to: xEnd, yaw: 0,
        crossCoords: [], detail: true, allowSuper: mode === 'retail', mode,
      });
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: cz + 11.8, from: xStart, to: xEnd, yaw: Math.PI,
        crossCoords: [], detail: true, allowSuper: mode === 'retail', mode,
      });
    }
  }

  for (const dir of [-1, 1]) {
    const xStart = dir > 0 ? 21 : -173;
    const xEnd = dir > 0 ? 173 : -21;
    populateCommercialStrip(mats, rnd, {
      axis: 'x', fixedCoord: 526 - 11.8, from: xStart, to: xEnd, yaw: 0,
      crossCoords: [], detail: true, mode: 'yokocho',
    });
    populateCommercialStrip(mats, rnd, {
      axis: 'x', fixedCoord: 526 + 11.8, from: xStart, to: xEnd, yaw: Math.PI,
      crossCoords: [], detail: true, mode: 'yokocho',
    });
  }

  for (const [ax, mode] of [[-182, 'yokocho'], [182, 'retail']]) {
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax - 11.9, from: -350, to: 586, yaw: Math.PI * 0.5,
      crossCoords: allCrossZs, detail: true, allowSuper: mode === 'retail', mode,
    });
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax + 11.9, from: -350, to: 586, yaw: -Math.PI * 0.5,
      crossCoords: allCrossZs, detail: true, allowSuper: mode === 'retail', mode,
    });
  }

  for (const ax of [-460, 460]) {
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax - 11.9, from: 150, to: 520, yaw: Math.PI * 0.5,
      crossCoords: ewCrossZs, detail: false, allowSuper: true, mode: ax < 0 ? 'yokocho' : 'retail',
    });
    populateCommercialStrip(mats, rnd, {
      axis: 'z', fixedCoord: ax + 11.9, from: 150, to: 520, yaw: -Math.PI * 0.5,
      crossCoords: ewCrossZs, detail: false, allowSuper: true, mode: ax < 0 ? 'yokocho' : 'retail',
    });
  }

  for (const [nz, mode] of [[-122, 'retail'], [-198, 'yokocho'], [-362, 'retail']]) {
    for (const [xStart, xEnd] of [[-448, -192], [-172, 172], [192, 448]]) {
      populateCommercialStrip(mats, rnd, {
        axis: 'x', fixedCoord: nz - 11.8, from: xStart, to: xEnd, yaw: 0,
        crossCoords: [], detail: false, allowSuper: mode === 'retail', mode,
      });
    }
  }

  // Extra Bar & Yokocho entrance truss arches with distinct neighborhood names!
  for (const [ax, az, rot, bIdx] of [
    [-182, 420, 0, 1],
    [-182, 248, 0, 2],
    [-13.0, 436, Math.PI * 0.5, 1],
    [13.0, 436, Math.PI * 0.5, 1],
  ]) {
    addShotengaiArch(mats, az, 4.85, mats.sideArchBanners[bIdx], ax, rot);
  }

  // Streetlamps & light spots along major avenues
  for (const ax of nsAvenueXs) {
    for (let z = -690; z <= 580; z += 34) {
      if (allCrossZs.some((cz) => Math.abs(z - cz) < 8) || insideAnyPlotPlaza(ax, z, 6)) continue;
      const side = (Math.floor(z / 34) % 2 === 0) ? 1 : -1;
      const lx = ax + side * 4.8;
      mats.darkMetal.add(box(0.11, 5.0, 0.11), lx, 2.5, z);
      mats.warmLamp.add(box(0.32, 0.18, 0.46), lx - side * 0.4, 4.95, z);
      lampSpots.push({ x: lx - side * 0.3, y: 4.9, z, radius: 24 });
    }
  }
  for (const az of [...ewCrossZs, ...northEwZs]) {
    for (let x = -580; x <= 580; x += 36) {
      if (nsAvenueXs.some((ax) => Math.abs(x - ax) < 9) || Math.abs(x) < 10 || insideAnyPlotPlaza(x, az, 6)) continue;
      const side = (Math.floor(x / 36) % 2 === 0) ? 1 : -1;
      const lz = az + side * 4.6;
      mats.darkMetal.add(box(0.11, 5.0, 0.11), x, 2.5, lz);
      mats.warmLamp.add(box(0.46, 0.18, 0.32), x, 4.95, lz - side * 0.4);
      lampSpots.push({ x, y: 4.9, z: lz - side * 0.3, radius: 24 });
    }
  }

  // 5. JAPANESE DETACHED HOUSE NEIGHBORHOODS (一戸建て住宅街)
  const xBands = [
    [-595, -468],
    [-452, -190],
    [-174, -20],
    [20, 174],
    [190, 452],
    [468, 595],
  ];

  for (let zi = 0; zi < ewCrossZs.length - 1; zi++) {
    const bz0 = ewCrossZs[zi] + 6.5;
    const bz1 = ewCrossZs[zi + 1] - 6.5;

    for (const [bx0, bx1] of xBands) {
      let rx0 = bx0;
      let rx1 = bx1;
      let rz0 = bz0;
      let rz1 = bz1;

      if (Math.abs(bx1 - (-190)) < 2) rx1 -= 12.5;
      if (Math.abs(bx0 - (-174)) < 2) rx0 += 12.5;
      if (Math.abs(bx1 - 174) < 2) rx1 -= 12.5;
      if (Math.abs(bx0 - 190) < 2) rx0 += 12.5;
      if (bz0 < 524) {
        if (Math.abs(bx1 - (-468)) < 2) rx1 -= 12.5;
        if (Math.abs(bx0 - (-452)) < 2) rx0 += 12.5;
        if (Math.abs(bx1 - 452) < 2) rx1 -= 12.5;
        if (Math.abs(bx0 - 468) < 2) rx0 += 12.5;
      }
      const innerX = Math.abs(bx0) < 176 && Math.abs(bx1) < 176;
      const midX = Math.abs(bx0) < 455 && Math.abs(bx1) < 455;
      if ((innerX && (ewCrossZs[zi] === 232 || ewCrossZs[zi] === 526)) || (midX && (ewCrossZs[zi] === 324 || ewCrossZs[zi] === 436))) {
        rz0 += 12.5;
      }
      if ((innerX && (ewCrossZs[zi + 1] === 232 || ewCrossZs[zi + 1] === 526)) || (midX && (ewCrossZs[zi + 1] === 324 || ewCrossZs[zi + 1] === 436))) {
        rz1 -= 12.5;
      }

      populateIkkodateBlock(mats, rnd, { x0: rx0, x1: rx1, z0: rz0, z1: rz1, lampSpots });
    }
  }

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
      populateIkkodateBlock(mats, rnd, { x0: bx0, x1: bx1, z0: bz0, z1: bz1, lampSpots });
    }
  }

  // 6. PROMENADE STREETSCAPE RHYTHM: CENTRAL DOTONBORI LANTERN COLONNADE + SHINSAIBASHI STREET TREES!
  // Reserve the continuous golden festival lantern colonnade exclusively for the central culinary heart [336..424]
  // while framing the entrance & boutique blocks with manicured Zelkova/Maple street trees in granite curb planters!
  const garlandSegments = [
    [336, 424],
  ];
  const treePlanterZs = [168, 198, 258, 294, 458, 488, 574];
  for (const side of [-1, 1]) {
    const gx = side * (STREET.road + 0.48);
    for (const [gz0, gz1] of garlandSegments) {
      addDotonboriLanternGarland(mats, { x: gx, z0: gz0, z1: gz1, side });
    }
    for (let ti = 0; ti < treePlanterZs.length; ti++) {
      const tz = treePlanterZs[ti];
      const tx = side * (STREET.road + 0.62);
      mats.concrete.add(box(0.96, 0.28, 1.32), tx, 0.22, tz);
      mats.archGoldTrim.add(box(1.02, 0.04, 1.38), tx, 0.37, tz);
      const tLot = new LotContext(tx, tz, 0, 0.18);
      addGardenTree(tLot, mats, 0, 0, 0.92, (ti + (side > 0 ? 1 : 0)) % 4 === 0 ? 'autumn' : 'leafy', true);
    }
    let lampSeq = 0;
    for (const lz of [152, 184, 218, 244, 276, 312, 332, 379, 428, 444, 474, 506, 534, 586]) {
      const lx = side * (STREET.road + 0.52);
      const flagBucket = mats.streetFlags[(lampSeq + (side > 0 ? 0 : 2)) % mats.streetFlags.length];
      const breeze = Math.sin(lampSeq * 1.9 + side) * 0.04;
      addShotengaiLamp(mats, lx, lz, side, flagBucket, breeze);
      lampSpots.push({ x: lx, y: 4.5, z: lz, radius: 25 });
      lampSeq += 1;
    }
  }
  for (const side of [-1, 1]) {
    for (let z = 348; z <= 416; z += 28) {
      lampSpots.push({ x: side * (STREET.road + 0.5), y: 3.1, z, radius: 22 });
    }
  }

  // Secondary commercial avenue (x = 182): authentic Japanese concrete utility poles, overhead wires & vending corners
  const secAvenueX = 182;
  const rightPoleX = secAvenueX + 4.4 + 1.45;
  const leftPoleX = secAvenueX - (4.4 + 1.45);
  const rightPoles = [];
  const leftPoles = [];

  for (let z = STREET.from + 18; z < STREET.to - 12; z += 44) {
    const snappedZ = ewCrossZs.some((cz) => Math.abs(z - cz) < 8) ? z + 10 : z;
    rightPoles.push(snappedZ);
    addUtilityPole(mats, rightPoleX, snappedZ, rightPoles.length % 2 === 1, rightPoles.length === 6 ? 1 : 0, 1, rightPoles.length - 1);
  }
  for (let z = STREET.from + 36; z < STREET.to - 12; z += 66) {
    const snappedZ = ewCrossZs.some((cz) => Math.abs(z - cz) < 8) ? z - 10 : z;
    leftPoles.push(snappedZ);
    addUtilityPole(mats, leftPoleX, snappedZ, leftPoles.length % 2 === 0, 0, -1, leftPoles.length + 1);
  }

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
  for (const [zCross, yCross] of [[402, 7.6], [398, 8.3], [348, 7.8], [282, 8.1], [204, 7.9]]) {
    mats.wire.add(wireGeometry([leftPoleX, yCross, zCross], [rightPoleX, yCross + 0.25, zCross + 2.5], 0.42, 0.02));
  }

  // Street-side Vending Machine Corners along secondary commercial streets
  for (const [side, z] of [[-1, 376], [1, 344], [-1, 276], [1, 194]]) {
    const vx = secAvenueX + side * (4.4 + 1.55);
    mats.vendRed.add(box(0.72, 1.9, 0.96), vx, 0.95, z);
    mats.vendFace.add(box(0.05, 1.26, 0.82), vx - side * 0.37, 1.16, z);
    mats.vendWhite.add(box(0.72, 1.9, 0.96), vx, 0.95, z + 1.06);
    mats.vendFace.add(box(0.05, 1.26, 0.82), vx - side * 0.37, 1.16, z + 1.06);
    mats.vendBlue.add(box(0.45, 0.86, 0.46), vx, 0.43, z + 1.88);
  }

  // Japanese Kei-cars & delivery vans on cross-streets & approaches (keeping pedestrian-priority promenade uncluttered)
  const roadCars = [
    { x: -2.2, z: 548, yaw: Math.PI, color: 0, van: false },
    { x: 2.2, z: 206, yaw: 0, color: 2, van: false },
    { x: -46, z: 318.1, yaw: Math.PI * 0.5, color: 1, van: true },
    { x: 58, z: 221.9, yaw: -Math.PI * 0.5, color: 6, van: false },
  ];
  for (const c of roadCars) {
    const carLot = new LotContext(c.x, c.z, 0, 0.08);
    addKeiCar(carLot, mats, 0, 0, c.yaw, mats.carPalette[c.color], c.van, true, true);
  }

  // 7. Build all merged static meshes into one clean `street` group
  const group = new THREE.Group();
  group.name = 'street';
  scene.add(group);

  const buildAll = (bucketOrArray, shadowOpts = {}) => {
    if (Array.isArray(bucketOrArray)) {
      bucketOrArray.forEach((b) => {
        if (b instanceof Bucket) b.build(group, shadowOpts);
      });
    } else if (bucketOrArray instanceof Bucket) {
      bucketOrArray.build(group, shadowOpts);
    }
  };

  for (const key of [
    'road', 'lane', 'asphaltApron', 'sidewalk', 'promenadePaver', 'plaza', 'plazaBorder',
    'lotPad', 'roadPaint', 'tactileYellow', 'drainGrate',
  ]) {
    buildAll(mats[key], { castShadow: false, receiveShadow: true });
  }
  buildAll(mats.shopGlass, { castShadow: false, receiveShadow: false });
  buildAll(mats.carGlass, { castShadow: false, receiveShadow: false });
  buildAll(mats.carClearLens, { castShadow: false, receiveShadow: false });

  const skipKeys = new Set([
    'road', 'lane', 'asphaltApron', 'sidewalk', 'promenadePaver', 'plaza', 'plazaBorder', 'lotPad',
    'roadPaint', 'tactileYellow', 'drainGrate', 'shopGlass', 'carGlass', 'carClearLens',
    'houseLightBlanks', 'houseDarkBlanks', 'shikkuiBlank',
    'commUpperLight', 'windowLitList', 'konbiniLitList',
    'fasciasIzakaya', 'fasciasRamen', 'fasciasKissaten', 'fasciasPharmacy', 'fasciasBookstore',
    'shopRetails', 'norenSets', 'awnings', 'carWhite',
    'lanternRed', 'lanternWarm', 'lanternAll',
    'kabukiFascia', 'imaiFascia', 'sprinterPoster', 'neonRingPoster', 'cosmePoster', 'kabukiPoster',
  ]);
  for (const [key, val] of Object.entries(mats)) {
    if (skipKeys.has(key)) continue;
    buildAll(val, { castShadow: true, receiveShadow: true });
  }

  group.userData.mats = mats;
  group.userData.lampSpots = lampSpots;
  return group;
}
