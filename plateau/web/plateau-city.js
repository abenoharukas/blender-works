// Builds the excavated Nishi-Shinjuku site pad, perimeter roads, streetlamps,
// and loads the authentic Tokyo Project PLATEAU 2025 LOD2 city chunk
// (`./tokyo_plateau.optimized.glb`), keeping PLATEAU's original aerial textures
// and untextured LOD2 white-model geometry faithfully without fake procedural
// facade textures or synthetic night window emissives.
import * as THREE from 'three';
import { EXCAVATED_BOUNDS } from './models.js';

export function buildPlateauBase(scene) {
  const group = new THREE.Group();
  group.name = 'plateau_city';
  scene.add(group);

  // Material buckets registered with `atmosphere.js` for roads, plaza, and streetlamps.
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
 * Attaches the loaded `tokyo_plateau.optimized.glb` scene graph in its authentic
 * Project PLATEAU state: textured LOD2 buildings keep their original aerial
 * textures untouched, and untextured LOD2 buildings render as clean neutral
 * architectural solids without fake procedural window textures or emissive maps.
 */
export function attachPlateauCityModel(plateauRoot, plateauGroup, atmosphere) {
  const mats = plateauGroup.userData.mats;

  const untexturedWallMat = new THREE.MeshStandardMaterial({
    name: 'Plateau_Untextured_Wall',
    color: 0xd8d5ce,
    roughness: 0.85,
    metalness: 0.04,
  });
  const untexturedRoofMat = new THREE.MeshStandardMaterial({
    name: 'Plateau_Untextured_Roof',
    color: 0xb8b5ae,
    roughness: 0.82,
    metalness: 0.06,
  });

  plateauRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const mName = obj.material?.name || obj.name || '';
    if (mName.startsWith('Plateau_Res_Wall_') || mName.startsWith('Plateau_Comm_Wall_')) {
      obj.material = untexturedWallMat;
    } else if (mName.startsWith('Plateau_Res_Roof_')) {
      obj.material = untexturedRoofMat;
    } else if (mName === 'Plateau_Road_LOD3') {
      obj.castShadow = false;
      obj.receiveShadow = true;
      obj.material = mats.road.material;
    } else if (obj.material?.map) {
      // Original PLATEAU LOD2 aerial photography texture — keep unmodified
      const mat = obj.material;
      mat.roughness = 0.78;
      mat.metalness = 0.05;
      mat.side = THREE.DoubleSide;
    }
  });

  plateauGroup.add(plateauRoot);
  atmosphere.registerStreetMaterials(mats);
  atmosphere.applyAtmosphere();
}
