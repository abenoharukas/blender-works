// Playground: the street from the ThreeRT `the-stack2-day` study, with any of
// the blender-works models standing in it. Models are added from the palette,
// keep their real scale, and stay in the scene together.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildStreet } from './street.js';
import { MODELS, PLOTS, groundHeightAt } from './models.js';
import {
  createAtmosphereSystem,
  TIME_PRESETS,
  WEATHER_MODES,
  formatHour,
  phaseLabel,
} from './atmosphere.js';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#status');
const palette = document.querySelector('#palette');
const placedList = document.querySelector('#placed');
const placedCount = document.querySelector('#placed-count');
const toast = document.querySelector('#toast');
const loadingCard = document.querySelector('#loading');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const timeSlider = document.querySelector('#time-slider');
const timeClock = document.querySelector('#time-clock');
const timePhase = document.querySelector('#time-phase');
const timePlayBtn = document.querySelector('#time-play');
const timeSpeedBtn = document.querySelector('#time-speed');
const timePresetsEl = document.querySelector('#time-presets');
const weatherButtonsEl = document.querySelector('#weather-buttons');
const weatherLabel = document.querySelector('#weather-label');
const weatherIntensityEl = document.querySelector('#weather-intensity');
const weatherIntensityVal = document.querySelector('#weather-intensity-val');
const intensityRow = document.querySelector('.intensity-row');

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// 1.75 on a 2x display is 3.3 MP of a 1.7 MP frame. At dusk the street lamp
// pool is the last fill-rate cost, so 1.5 keeps 60 fps while still supersampling.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Tighter near/far keeps ~5 cm facade-frame steps well above 24-bit depth
// quantization across street (350 m) and overview (900 m) viewing distances.
const camera = new THREE.PerspectiveCamera(52, 1, 1.5, 24000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 2600;

// ------------------------------------------------------------------ the street
const streetGroup = buildStreet(scene);
renderer.shadowMap.autoUpdate = false;

// ------------------------------------------------------------------ views
const VIEWS = {
  street: {
    position: new THREE.Vector3(0.9, 1.75, 412),
    target: new THREE.Vector3(-4, 118, 0),
  },
  shotengai: {
    position: new THREE.Vector3(3.6, 8.8, 366),
    target: new THREE.Vector3(-12, 4.6, 308),
  },
  ikkodate: {
    position: new THREE.Vector3(38, 3.5, 386.8),
    target: new THREE.Vector3(106, 3.1, 385.8),
  },
  overview: {
    position: new THREE.Vector3(560, 410, 790),
    target: new THREE.Vector3(0, 95, -210),
  },
};

let tween = null;
function flyTo(position, target, duration = 950) {
  tween = {
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: position.clone(),
    toTarget: target.clone(),
    started: performance.now(),
    duration,
  };
}
function applyView(name) {
  const view = VIEWS[name];
  if (!view) return;
  viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === name));
  flyTo(view.position, view.target);
}

// ------------------------------------------------------------------ models & atmosphere
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const assetCache = new Map();
const placed = [];
const reservedPlots = new Set();
const atmosphere = createAtmosphereSystem({ scene, renderer, camera, controls, placed });
atmosphere.registerStreetMaterials(streetGroup.userData.mats);
atmosphere.registerLampSpots(streetGroup.userData.lampSpots);
window.__playground = { THREE, scene, camera, controls, renderer, placed, atmosphere };
let nextTicket = 1;
let loadDepth = 0;

function setStatus(text) {
  status.textContent = text;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function loadAsset(config) {
  if (!assetCache.has(config.id)) {
    const promise = new Promise((resolve, reject) => {
      loader.load(
        config.asset,
        (gltf) => {
          prepareMaterials(gltf.scene);
          resolve(gltf.scene);
        },
        (event) => {
          if (!event.total) return;
          setStatus(`${config.label} ${Math.round((event.loaded / event.total) * 100)}%`);
        },
        reject,
      );
    });
    assetCache.set(config.id, promise);
  }
  return assetCache.get(config.id);
}

/**
 * In daylight the Blender glass should read as dark reflective panes, not as
 * a white veil: leaving transmission on (or a low-opacity pane) stacks dozens
 * of surfaces into haze at street distance. Same idea as the viewer in `web/`,
 * tuned for an outdoor scene.
 */
function prepareMaterials(root) {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh) return;

    const meshName = object.name ?? '';
    // Interior roller blinds sit 10-12 cm behind the curtain wall. When
    // outdoor glass is rendered opaque below, hide interior curtain meshes so
    // they do not add ~200k unseen triangles or bleed at extreme distances.
    if (/curtain/i.test(meshName) && !/wall/i.test(meshName)) {
      object.visible = false;
      return;
    }

    const isEscalatorTube = /escalator.*glass|continuous_glass_tube/i.test(meshName);
    const isFrostMesh = /frost/i.test(meshName);
    const isGlassMesh = /glass/i.test(meshName) && !isFrostMesh && !isEscalatorTube;
    const isLightMesh = /light|glow/i.test(meshName);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const matName = material.name ?? '';
      const isEscalatorGlass = isEscalatorTube || /escalator_glass/i.test(matName);
      const namedGlass = /glass/i.test(matName) && !/frost/i.test(matName) && !isEscalatorGlass;
      if (isEscalatorGlass) {
        // Centre Pompidou's exterior escalator tube is a single-wall glass
        // enclosure wrapping the red circulation stair; keep it translucent.
        material.transmission = 0;
        material.transparent = true;
        material.opacity = 0.34;
        material.depthWrite = false;
        material.color.setHex(0x8ab8cf);
        material.metalness = 0.12;
        material.roughness = 0.08;
        material.envMapIntensity = 1.35;
        material.userData.isPlaygroundGlass = true;
        material.needsUpdate = true;
      } else if ((material.transmission ?? 0) > 0.4 || namedGlass || isGlassMesh) {
        material.transmission = 0;
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = 1;
        material.polygonOffsetUnits = 1;
        material.color.setHex(0x3d505b);
        material.metalness = 0.35;
        material.roughness = 0.12;
        material.metalnessMap = null;
        material.roughnessMap = null;
        material.envMapIntensity = 2.0;
        material.clearcoat = 0;
        material.specularIntensity = 0.4;
        material.userData.isPlaygroundGlass = true;
        material.needsUpdate = true;
      } else if (isFrostMesh) {
        material.transmission = 0;
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = 1;
        material.polygonOffsetUnits = 1;
        material.color.setHex(0x697880);
        material.roughness = 0.35;
        material.metalness = 0.15;
        material.userData.isPlaygroundFrost = true;
        material.needsUpdate = true;
      }
      // Any leftover transmission makes WebGLRenderer render the whole scene a
      // second time into the transmission target every frame. The Stack's
      // foliage exports at 0.12; outdoors nothing should be refractive.
      if ((material.transmission ?? 0) > 0) {
        material.transmission = 0;
        material.needsUpdate = true;
      }
      // The glTF carries the Blender interior fills as emissive materials in
      // nits (8..360). Clamp for daylight balance and tag for night boost.
      const hasEmissive = (material.emissive && (material.emissive.r + material.emissive.g + material.emissive.b > 0.02))
        || Boolean(material.emissiveMap)
        || isLightMesh;
      if (hasEmissive && !material.userData.isPlaygroundGlass && !material.userData.isPlaygroundFrost) {
        material.userData.isTowerEmissive = true;
        if (material.emissiveIntensity > 2) material.emissiveIntensity = 1.1;
      }
    }
  });
}

function firstFreePlot() {
  return PLOTS.findIndex((_, index) => !reservedPlots.has(index));
}

function plotName(index) {
  const row = 'ABC'[Math.floor(index / 3)] ?? 'A';
  return `${row}${(index % 3) + 1}`;
}

function frameEntry(entry) {
  // Precise bounds: the models' merged meshes carry rotated transforms, and a
  // non-precise Box3 inflates their axis-aligned box badly.
  const box = new THREE.Box3().setFromObject(entry.group, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const distance = (maxSize / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.5;
  const position = center.clone().add(
    new THREE.Vector3(0.42, 0.16, 1).normalize().multiplyScalar(distance),
  );
  position.y = Math.max(position.y, 30);
  flyTo(position, center);
}

async function addModel(id, { focus = true } = {}) {
  const config = MODELS.find((model) => model.id === id);
  if (!config) return;
  const plotIndex = firstFreePlot();
  if (plotIndex < 0) {
    showToast('All nine plots are taken — remove a model first.');
    return;
  }
  reservedPlots.add(plotIndex);

  loadDepth += 1;
  loadingCard.classList.remove('is-hidden');
  loadingCard.querySelector('span:last-child').textContent = `Loading ${config.label}`;
  setStatus(`Loading ${config.label}`);

  try {
    const source = await loadAsset(config);
    const root = source.clone(true);

    // Every study is authored with the ground at its own origin (the house
    // convention). Do not lift by the bounding box: two of the web exports
    // carry a merged mesh with stray geometry far below the origin, and
    // grounding on the lowest vertex sends the whole building into the air.
    root.position.set(0, 0, 0);

    const group = new THREE.Group();
    group.name = `${config.id}_${nextTicket}`;
    group.rotation.y = config.yaw ?? 0;
    group.add(root);

    const plot = PLOTS[plotIndex];
    group.position.set(plot.x, groundHeightAt(plot.x, plot.z), plot.z);
    scene.add(group);
    group.updateMatrixWorld(true);

    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });

    const entry = {
      ticket: nextTicket++,
      id: config.id,
      label: config.label,
      group,
      plot: plotIndex,
      hidden: false,
    };
    placed.push(entry);
    atmosphere.applyAtmosphere();
    renderPlaced();
    renderPalette();
    renderer.shadowMap.needsUpdate = true;
    setStatus(`${config.label} placed at ${plotName(plotIndex)}`);
    if (focus) frameEntry(entry);
  } catch (error) {
    console.error(`${config.label} failed to load`, error);
    reservedPlots.delete(plotIndex);
    setStatus(`${config.label} could not be loaded`);
    showToast(`Could not load ${config.label}. Check the asset path.`);
  } finally {
    loadDepth -= 1;
    if (loadDepth === 0) loadingCard.classList.add('is-hidden');
  }
}

function removeEntry(entry) {
  scene.remove(entry.group);
  if (entry.interiorLights) {
    entry.interiorLights.forEach((pt) => scene.remove(pt));
    entry.interiorLights = null;
  }
  const index = placed.indexOf(entry);
  if (index >= 0) placed.splice(index, 1);
  reservedPlots.delete(entry.plot);
  renderPlaced();
  renderPalette();
  renderer.shadowMap.needsUpdate = true;
  setStatus(`${entry.label} removed`);
}

function clearAll() {
  for (const entry of [...placed]) removeEntry(entry);
  showToast('Scene cleared.');
}

// ------------------------------------------------------------------ panel
function renderPalette() {
  const counts = new Map();
  for (const entry of placed) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  palette.innerHTML = MODELS.map((model) => `
    <button class="palette-button" data-model="${model.id}">
      <span class="palette-index">${String(MODELS.indexOf(model) + 1).padStart(2, '0')}</span>
      <span class="palette-name">${model.label}<small>${model.meta}</small></span>
      <span class="palette-action">${counts.get(model.id) ? `+ again` : '+ add'}</span>
    </button>
  `).join('');
}

function renderPlaced() {
  placedCount.textContent = `${placed.length} / ${PLOTS.length}`;
  if (!placed.length) {
    placedList.innerHTML = '<p class="empty">No model yet. Add one from the palette — the street stays the same.</p>';
    return;
  }
  placedList.innerHTML = placed.map((entry) => `
    <div class="placed-row${entry.hidden ? ' is-hidden' : ''}" data-ticket="${entry.ticket}">
      <button class="placed-focus" data-act="focus">
        <span class="placed-ticket">${String(entry.ticket).padStart(2, '0')}</span>
        <span class="placed-name">${entry.label}<small>plot ${plotName(entry.plot)}</small></span>
      </button>
      <button class="placed-icon" data-act="hide" title="${entry.hidden ? 'Show' : 'Hide'}">${entry.hidden ? '○' : '●'}</button>
      <button class="placed-icon" data-act="remove" title="Remove">×</button>
    </div>
  `).join('');
}

palette.addEventListener('click', (event) => {
  const button = event.target.closest('[data-model]');
  if (button) addModel(button.dataset.model);
});

placedList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-ticket]');
  if (!row) return;
  const entry = placed.find((item) => String(item.ticket) === row.dataset.ticket);
  if (!entry) return;
  const action = event.target.closest('[data-act]')?.dataset.act;
  if (action === 'remove') {
    removeEntry(entry);
  } else if (action === 'hide') {
    entry.hidden = !entry.hidden;
    entry.group.visible = !entry.hidden;
    renderPlaced();
    renderer.shadowMap.needsUpdate = true;
  } else {
    frameEntry(entry);
  }
});

document.querySelector('#clear-scene').addEventListener('click', clearAll);
viewButtons.forEach((button) => button.addEventListener('click', () => applyView(button.dataset.view)));

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const index = Number(event.key);
  if (index >= 1 && index <= MODELS.length) addModel(MODELS[index - 1].id);
  const key = event.key.toLowerCase();
  if (key === 's') applyView('street');
  if (key === 'm') applyView('shotengai');
  if (key === 'h') applyView('ikkodate');
  if (key === 'o') applyView('overview');
  if (key === 'p') togglePlay();
  if (event.key === '[') {
    atmosphere.setTime(atmosphere.state.hour - 1);
    syncEnvUI();
  }
  if (event.key === ']') {
    atmosphere.setTime(atmosphere.state.hour + 1);
    syncEnvUI();
  }
});

// ------------------------------------------------------------------ environment UI
const SPEEDS = [1, 4, 12];
let speedIdx = 0;

function renderEnvControls() {
  timePresetsEl.innerHTML = TIME_PRESETS.map((p) => `
    <button class="preset-btn" data-hour="${p.hour}" data-preset="${p.id}">
      <span>${p.zh}</span>
      <small>${formatHour(p.hour)}</small>
    </button>
  `).join('');

  weatherButtonsEl.innerHTML = WEATHER_MODES.map((w) => `
    <button class="weather-btn" data-weather="${w.id}">
      <span>${w.zh}</span>
      <small>${w.label}</small>
    </button>
  `).join('');
}

function syncEnvUI() {
  const { hour, weather, intensity, playing } = atmosphere.state;
  timeClock.textContent = formatHour(hour);
  timePhase.textContent = phaseLabel(hour);
  timeSlider.value = hour.toFixed(2);
  timePlayBtn.textContent = playing ? '⏸' : '▶';
  timePlayBtn.classList.toggle('is-active', playing);

  timePresetsEl.querySelectorAll('[data-hour]').forEach((btn) => {
    const target = Number(btn.dataset.hour);
    btn.classList.toggle('is-active', Math.abs(hour - target) < 0.35);
  });

  const wObj = WEATHER_MODES.find((w) => w.id === weather);
  weatherLabel.textContent = wObj ? `${wObj.label} · ${wObj.zh}` : weather;
  weatherButtonsEl.querySelectorAll('[data-weather]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.weather === weather);
  });

  weatherIntensityEl.value = String(intensity);
  weatherIntensityVal.textContent = `${Math.round(intensity * 100)}%`;
  intensityRow.classList.toggle('is-disabled', weather === 'clear');
}

function togglePlay() {
  atmosphere.setPlaying(!atmosphere.state.playing);
  syncEnvUI();
}

timeSlider.addEventListener('input', () => {
  atmosphere.setTime(Number(timeSlider.value), { forceEnv: false });
  syncEnvUI();
});
timeSlider.addEventListener('change', () => {
  atmosphere.setTime(Number(timeSlider.value), { forceEnv: true });
  syncEnvUI();
});
timePresetsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-hour]');
  if (!btn) return;
  atmosphere.setPlaying(false);
  atmosphere.setTime(Number(btn.dataset.hour), { forceEnv: true });
  syncEnvUI();
});
weatherButtonsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-weather]');
  if (!btn) return;
  atmosphere.setWeather(btn.dataset.weather, { forceEnv: true });
  syncEnvUI();
});
weatherIntensityEl.addEventListener('input', () => {
  atmosphere.setIntensity(Number(weatherIntensityEl.value));
  syncEnvUI();
});
timePlayBtn.addEventListener('click', togglePlay);
timeSpeedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  atmosphere.setSpeed(SPEEDS[speedIdx]);
  timeSpeedBtn.textContent = `${SPEEDS[speedIdx]}×`;
});

// ------------------------------------------------------------------ loop
function updateTween(now) {
  if (!tween) return;
  const progress = Math.min((now - tween.started) / tween.duration, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
  if (progress >= 1) tween = null;
}

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

renderer.setAnimationLoop((now) => {
  updateTween(now);
  controls.update();
  atmosphere.update(now);
  if (atmosphere.state.playing) {
    timeClock.textContent = formatHour(atmosphere.state.hour);
    timePhase.textContent = phaseLabel(atmosphere.state.hour);
    timeSlider.value = atmosphere.state.hour.toFixed(2);
  }
  // A tall target puts the orbit above the horizon on purpose; keep the eye
  // itself off the ground.
  if (camera.position.y < 0.8) camera.position.y = 0.8;
  renderer.render(scene, camera);
});

window.addEventListener('resize', resize);

// ------------------------------------------------------------------ start
Object.assign(window.__playground, { addModel, removeEntry, applyView });
renderEnvControls();
atmosphere.applyAtmosphere({ forceEnv: true });
syncEnvUI();
renderer.shadowMap.needsUpdate = true;
renderPalette();
renderPlaced();
camera.position.copy(VIEWS.street.position);
controls.target.copy(VIEWS.street.target);
controls.update();
viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === 'street'));
resize();
setStatus('Street ready — add a model');

// A first model so the playground never opens empty. The camera stays in the
// street for the first look instead of framing the tower.
addModel(MODELS[0].id, { focus: false });
