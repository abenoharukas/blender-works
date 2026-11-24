// Builds the excavated Nishi-Shinjuku site pad, perimeter roads, streetlamps,
// and loads the real Tokyo Project PLATEAU 2025 LOD2 city chunk
// (`./tokyo_plateau.optimized.glb`). Also enriches untextured PLATEAU wall/roof
// buckets with Japanese residential facade/window emissive maps and generates
// subtle night window glow on real textured LOD2 skyscraper/apartment facades.
import * as THREE from 'three';
import { EXCAVATED_BOUNDS } from './models.js';
import {
  createHouseWallTexture,
  createHouseWallEmissiveMap,
  createCommercialUpperTexture,
  createCommercialUpperEmissiveMap,
  createRoofTexture,
} from './japanese-textures.js';

/**
 * Generates an emissive map from a PLATEAU LOD2 facade texture atlas AND gently
 * lifts dark baked aerial-photography shadows on the daytime color texture so
 * Shinjuku skyscrapers read crisp and bright under Three.js ACES tone mapping.
 */
function processPlateauAtlasTextures(srcTexture, seed = 1) {
  const img = srcTexture?.image;
  if (!img || !img.width || !img.height) return null;

  // 1. Brighten daytime albedo texture (lift dark aerial shadow areas with a 0.72 gamma curve)
  const cw = img.width;
  const ch = img.height;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = cw;
  colorCanvas.height = ch;
  const colorCtx = colorCanvas.getContext('2d');
  colorCtx.drawImage(img, 0, 0, cw, ch);

  try {
    const cData = colorCtx.getImageData(0, 0, cw, ch);
    const px = cData.data;
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      // Lift shadows while preserving bright highlights
      const norm = i / 255;
      lut[i] = Math.min(255, Math.round(Math.pow(norm, 0.72) * 242 + 13));
    }
    for (let i = 0; i < px.length; i += 4) {
      px[i] = lut[px[i]];
      px[i + 1] = lut[px[i + 1]];
      px[i + 2] = lut[px[i + 2]];
    }
    colorCtx.putImageData(cData, 0, 0);
  } catch {
    return null;
  }

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.flipY = srcTexture.flipY;
  colorTex.wrapS = srcTexture.wrapS;
  colorTex.wrapT = srcTexture.wrapT;

  // 2. Build 512x512 night window emissive map from original image contrast
  const w = Math.min(512, img.width);
  const h = Math.min(512, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const cellSize = 16;
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cellSize);
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cellSize);
      const cellHash = Math.abs(Math.imul(cx * 73 + cy * 199 + seed * 37, 0x45d9f3b)) % 100;
      const idx = (y * w + x) * 4;

      if (cellHash < 52) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        continue;
      }

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum > 20 && lum < 122 && b >= r * 0.82) {
        const strength = Math.min(1, (122 - lum) / 72);
        const warm = cellHash < 82;
        data[idx] = Math.round((warm ? 255 : 210) * strength);
        data[idx + 1] = Math.round((warm ? 208 : 230) * strength);
        data[idx + 2] = Math.round((warm ? 138 : 255) * strength);
      } else {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const emissiveTex = new THREE.CanvasTexture(canvas);
  emissiveTex.colorSpace = THREE.SRGBColorSpace;
  emissiveTex.flipY = srcTexture.flipY;
  emissiveTex.wrapS = srcTexture.wrapS;
  emissiveTex.wrapT = srcTexture.wrapT;
  return { colorTex, emissiveTex };
}

export function buildPlateauBase(scene) {
  const group = new THREE.Group();
  group.name = 'plateau_city';
  scene.add(group);

  // Material buckets registered with `atmosphere.js` so rain wetness, snow cover,
  // and night emissive window lighting work seamlessly.
  const mats = {
    road: {
      material: new THREE.MeshStandardMaterial({
        name: 'road_asphalt',
        color: 0x3b3e43,
        roughness: 0.84,
      }),
    },
    lane: {
      material: new THREE.MeshStandardMaterial({
        name: 'lane_asphalt',
        color: 0x45484d,
        roughness: 0.86,
      }),
    },
    sidewalk: {
      material: new THREE.MeshStandardMaterial({
        name: 'sidewalk',
        color: 0x9c9890,
        roughness: 0.86,
      }),
    },
    plaza: {
      material: new THREE.MeshStandardMaterial({
        name: 'plaza_granite',
        color: 0x989289,
        roughness: 0.78,
      }),
    },
    plazaBorder: {
      material: new THREE.MeshStandardMaterial({
        name: 'plaza_border',
        color: 0x7a756d,
        roughness: 0.82,
      }),
    },
    warmLamp: {
      material: new THREE.MeshStandardMaterial({
        name: 'warm_lamp',
        color: 0xfff0d4,
        emissive: 0xffc675,
        emissiveIntensity: 1.5,
        roughness: 0.35,
      }),
    },
    darkMetal: {
      material: new THREE.MeshStandardMaterial({
        name: 'dark_metal',
        color: 0x2c3035,
        roughness: 0.45,
        metalness: 0.58,
      }),
    },
    roadPaint: {
      material: new THREE.MeshStandardMaterial({
        name: 'road_paint',
        color: 0xeae4d7,
        roughness: 0.68,
      }),
    },
    houseLightWalls: [],
    houseDarkWalls: [],
    houseTileWalls: [],
    commUppers: [],
    kawaraDark: null,
    kawaraBrown: null,
    foliageFresh: {
      material: new THREE.MeshStandardMaterial({
        name: 'foliage_fresh',
        color: 0x4b6e3d,
        roughness: 0.86,
      }),
    },
    trunk: {
      material: new THREE.MeshStandardMaterial({
        name: 'tree_trunk',
        color: 0x453426,
        roughness: 0.92,
      }),
    },
  };

  // 1. Urban ground plane (sits 0.45 m below y = 0 so it never z-fights at 1000 m overview distance)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24000, 24000),
    new THREE.MeshStandardMaterial({
      name: 'ground',
      color: 0x7c7870,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.45;
  ground.receiveShadow = true;
  scene.add(ground);

  // 2. Excavated Residential Plot Civic Plaza & Perimeter Framing Streets
  const { x0, x1, z0, z1 } = EXCAVATED_BOUNDS;
  const plotW = x1 - x0;
  const plotD = z1 - z0;
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;

  // Crisp granite curb border around the excavated site (top at y = 0.14 m, bottom at y = -0.26 m)
  mats.plazaBorder.material.polygonOffset = true;
  mats.plazaBorder.material.polygonOffsetFactor = 1;
  mats.plazaBorder.material.polygonOffsetUnits = 1;
  const borderMesh = new THREE.Mesh(
    new THREE.BoxGeometry(plotW + 4.8, 0.4, plotD + 4.8),
    mats.plazaBorder.material,
  );
  borderMesh.position.set(cx, -0.06, cz);
  borderMesh.receiveShadow = true;
  group.add(borderMesh);

  // Main excavated plot stone slab (top at y = 0.24 m, 10 cm above the border so they never coplanar-flicker)
  const plazaMesh = new THREE.Mesh(new THREE.BoxGeometry(plotW, 0.44, plotD), mats.plaza.material);
  plazaMesh.position.set(cx, 0.02, cz);
  plazaMesh.receiveShadow = true;
  group.add(plazaMesh);

  // Perimeter asphalt streets wrapping the excavated site (top at y = 0.06 m, non-overlapping at corners)
  mats.road.material.polygonOffset = true;
  mats.road.material.polygonOffsetFactor = -1;
  mats.road.material.polygonOffsetUnits = -1;
  const roadW = 8.4;
  const nsRoadGeo = new THREE.BoxGeometry(roadW, 0.24, plotD + 4.8);
  for (const rx of [x0 - 2.4 - roadW * 0.5, x1 + 2.4 + roadW * 0.5]) {
    const m = new THREE.Mesh(nsRoadGeo, mats.road.material);
    m.position.set(rx, -0.06, cz);
    m.receiveShadow = true;
    group.add(m);
  }
  const ewRoadGeo = new THREE.BoxGeometry(plotW + roadW * 2 + 4.8, 0.24, roadW);
  for (const rz of [z0 - 2.4 - roadW * 0.5, z1 + 2.4 + roadW * 0.5]) {
    const m = new THREE.Mesh(ewRoadGeo, mats.road.material);
    m.position.set(cx, -0.06, rz);
    m.receiveShadow = true;
    group.add(m);
  }

  // 3. Perimeter Streetlamps & Zelkova Trees around the Excavated Plot
  const lampSpots = [];
  const poleGeo = new THREE.BoxGeometry(0.12, 5.2, 0.12);
  const headGeo = new THREE.BoxGeometry(0.38, 0.18, 0.38);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 2.4, 7);
  const crownGeo = new THREE.DodecahedronGeometry(2.1, 1);

  const addLampAndTree = (lx, lz, placeTree = true) => {
    const pole = new THREE.Mesh(poleGeo, mats.darkMetal.material);
    pole.position.set(lx, 2.6, lz);
    pole.castShadow = true;
    group.add(pole);

    const head = new THREE.Mesh(headGeo, mats.warmLamp.material);
    head.position.set(lx, 5.2, lz);
    group.add(head);

    lampSpots.push({ x: lx, y: 5.0, z: lz, radius: 26 });

    if (placeTree) {
      const tx = lx + (lx < 0 ? 3.5 : -3.5);
      const trunk = new THREE.Mesh(trunkGeo, mats.trunk.material);
      trunk.position.set(tx, 1.2, lz);
      trunk.castShadow = true;
      group.add(trunk);

      const crown = new THREE.Mesh(crownGeo, mats.foliageFresh.material);
      crown.position.set(tx, 3.6, lz);
      crown.scale.set(1.15, 1.35, 1.15);
      crown.castShadow = true;
      crown.receiveShadow = true;
      group.add(crown);
    }
  };

  for (let x = x0 + 18; x <= x1 - 18; x += 36) {
    if (Math.abs(x) < 20) continue; // Keep central sightline clear
    addLampAndTree(x, z1 + 1.4, true);
    addLampAndTree(x, z0 - 1.4, true);
  }
  for (let z = z0 + 18; z <= z1 - 18; z += 36) {
    addLampAndTree(x0 - 1.4, z, false);
    addLampAndTree(x1 + 1.4, z, false);
  }
  for (let z = z1 + 24; z <= z1 + 310; z += 34) {
    addLampAndTree(-5.4, z, false);
    addLampAndTree(5.4, z, false);
  }

  group.userData.mats = mats;
  group.userData.lampSpots = lampSpots;
  return group;
}

/**
 * Configures the loaded `tokyo_plateau.optimized.glb` scene graph, binding
 * procedural window textures & night emissive maps to untextured residential
 * buckets and subtle night window emissive maps to textured LOD2 tiles.
 */
export function attachPlateauCityModel(plateauRoot, plateauGroup, atmosphere) {
  const mats = plateauGroup.userData.mats;

  const wallConfigs = [
    { hex: 0xede8de, style: 'plaster', frame: '#2a2e33', win: 'sliding', seed: 101 },
    { hex: 0xe3dcd0, style: 'siding', frame: '#34383d', win: 'sliding', seed: 137 },
    { hex: 0xd5ccc0, style: 'siding', frame: '#26292e', win: 'slit', seed: 173 },
    { hex: 0x353940, style: 'siding', frame: '#1b1d20', win: 'sliding', seed: 211 },
    { hex: 0xb89f88, style: 'tile', frame: '#2a241e', win: 'sliding', seed: 257 },
  ];

  const wallMaterials = wallConfigs.map((cfg, i) => {
    const map = createHouseWallTexture({
      baseHex: cfg.hex,
      style: cfg.style,
      frameColor: cfg.frame,
      windowType: cfg.win,
    });
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    const emissiveMap = createHouseWallEmissiveMap({ windowType: cfg.win, seed: cfg.seed });
    emissiveMap.wrapS = THREE.RepeatWrapping;
    emissiveMap.wrapT = THREE.RepeatWrapping;

    const mat = new THREE.MeshStandardMaterial({
      name: `Plateau_Res_Wall_${i}`,
      map,
      emissive: new THREE.Color(0xffffff),
      emissiveMap,
      emissiveIntensity: 0,
      roughness: 0.84,
      metalness: 0.05,
    });
    if (i === 3) mats.houseDarkWalls.push({ material: mat });
    else if (i === 4) mats.houseTileWalls.push({ material: mat });
    else mats.houseLightWalls.push({ material: mat });
    return mat;
  });

  const commMap = createCommercialUpperTexture({ baseHex: 0xded8cc, accentHex: 0xb8b0a2 });
  commMap.wrapS = THREE.RepeatWrapping;
  commMap.wrapT = THREE.RepeatWrapping;
  const commEmissive = createCommercialUpperEmissiveMap({ seed: 509 });
  commEmissive.wrapS = THREE.RepeatWrapping;
  commEmissive.wrapT = THREE.RepeatWrapping;
  const commMat = new THREE.MeshStandardMaterial({
    name: 'Plateau_Comm_Wall_0',
    map: commMap,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: commEmissive,
    emissiveIntensity: 0,
    roughness: 0.74,
    metalness: 0.08,
  });
  mats.commUppers.push({ material: commMat });

  const roof0Tex = createRoofTexture({ baseHex: 0x35393e, style: 'kawara' });
  roof0Tex.wrapS = THREE.RepeatWrapping;
  roof0Tex.wrapT = THREE.RepeatWrapping;
  const roof0Mat = new THREE.MeshStandardMaterial({
    name: 'Plateau_Res_Roof_0',
    map: roof0Tex,
    roughness: 0.6,
    metalness: 0.14,
  });
  mats.kawaraDark = { material: roof0Mat };

  const roof1Tex = createRoofTexture({ baseHex: 0x5e4234, style: 'kawara' });
  roof1Tex.wrapS = THREE.RepeatWrapping;
  roof1Tex.wrapT = THREE.RepeatWrapping;
  const roof1Mat = new THREE.MeshStandardMaterial({
    name: 'Plateau_Res_Roof_1',
    map: roof1Tex,
    roughness: 0.64,
    metalness: 0.08,
  });
  mats.kawaraBrown = { material: roof1Mat };

  let tileSeed = 1;
  plateauRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const mName = obj.material?.name || obj.name || '';
    if (mName.startsWith('Plateau_Res_Wall_')) {
      const idx = Number(mName.replace('Plateau_Res_Wall_', '')) || 0;
      obj.material = wallMaterials[idx % wallMaterials.length];
    } else if (mName.startsWith('Plateau_Comm_Wall_')) {
      obj.material = commMat;
    } else if (mName === 'Plateau_Res_Roof_0') {
      obj.material = roof0Mat;
    } else if (mName === 'Plateau_Res_Roof_1') {
      obj.material = roof1Mat;
    } else if (mName === 'Plateau_Road_LOD3') {
      obj.castShadow = false;
      obj.receiveShadow = true;
      obj.material = mats.road.material;
    } else if (obj.material?.map) {
      // Real textured PLATEAU LOD2 building tile (Nishi-Shinjuku skyscrapers & avenues)
      const mat = obj.material;
      mat.roughness = 0.62;
      mat.metalness = 0.08;
      mat.side = THREE.DoubleSide;
      const processed = processPlateauAtlasTextures(mat.map, tileSeed++);
      if (processed) {
        mat.map = processed.colorTex;
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = processed.emissiveTex;
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
        mats.commUppers.push({ material: mat });
      }
    }
  });

  plateauGroup.add(plateauRoot);
  atmosphere.registerStreetMaterials(mats);
  atmosphere.applyAtmosphere();
}
