// PLATEAU Tokyo Web Scene: Real Nishi-Shinjuku LOD2 urban twin (Project PLATEAU
// 2025, 13104 Shinjuku-ku) with a central residential block excavated so any of
// the 5 blender-works architectural models can be placed and switched inside it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildPlateauBase, attachPlateauCityModel } from './plateau-city.js';
import { MODELS, PLOTS, groundHeightAt } from './models.js?v=20261128b';
import { createWalkController } from './walk.js?v=20261127e';
import {
  createAtmosphereSystem,
  TIME_PRESETS,
  WEATHER_MODES,
  formatHour,
  phaseLabel,
} from './atmosphere.js?v=20261128b';

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
// Patch WebGLRenderer's transmission chunk once at startup so glTF materials
// authored as smooth clear glass (roughness < 0.02) sample Mip-0 directly.
{
  const chunk = THREE.ShaderChunk.transmission_pars_fragment;
  const sig = 'vec4 getTransmissionSample';
  const start = chunk.indexOf(sig);
  const openBrace = start >= 0 ? chunk.indexOf('{', start) : -1;
  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i >= 0 && i < chunk.length; i++) {
    if (chunk[i] === '{') depth += 1;
    else if (chunk[i] === '}' && --depth === 0) {
      closeBrace = i;
      break;
    }
  }
  if (start >= 0 && closeBrace > openBrace) {
    const renamed = chunk
      .slice(start, closeBrace + 1)
      .replace('vec4 getTransmissionSample', 'vec4 _defaultTransmissionSample');
    const wrapper = `
vec4 getTransmissionSample( const in vec2 fragCoord, const in float clampedRoughness, const in float ior ) {
\tif ( roughness < 0.02 ) {
\t\tivec2 texSize = textureSize( transmissionSamplerMap, 0 );
\t\tif ( thickness == 0.0 && all( lessThan( abs( fragCoord.xy * vec2( texSize ) - gl_FragCoord.xy ), vec2( 2.5 ) ) ) ) {
\t\t\tivec2 pix = clamp( ivec2( gl_FragCoord.xy ), ivec2( 0 ), texSize - ivec2( 1 ) );
\t\t\treturn texelFetch( transmissionSamplerMap, pix, 0 );
\t\t}
\t\treturn textureLod( transmissionSamplerMap, fragCoord.xy, 0.0 );
\t}
\treturn _defaultTransmissionSample( fragCoord, clampedRoughness, ior );
}`;
    THREE.ShaderChunk.transmission_pars_fragment =
      chunk.slice(0, start) + renamed + wrapper + chunk.slice(closeBrace + 1);
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.transmissionResolutionScale = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 2.2, 14500);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 3200;

// ------------------------------------------------------------------ walk mode
const walkToggleBtn = document.querySelector('#walk-toggle');
const walkHud = document.querySelector('#walk-hud');

const walk = createWalkController({
  camera,
  controls,
  domElement: renderer.domElement,
  groundHeightAt,
  onChange: (active) => {
    walkToggleBtn.classList.toggle('is-active', active);
    walkHud.classList.toggle('is-visible', active);
    if (active) tween = null;
  },
});

walkToggleBtn.addEventListener('click', () => walk.toggle());

// ------------------------------------------------------------------ PLATEAU base
const plateauGroup = buildPlateauBase(scene);
renderer.shadowMap.autoUpdate = false;

// ------------------------------------------------------------------ views
// Framed specifically for Minato-ku Toranomon Hills LOD3:
// - `skyline` (DEFAULT): standing inside the Toranomon Hills 300 m skyscraper cluster
//   (on the 163.7 m rooftop deck at x=-309, y=165.4, z=248, flanked by Mori Tower,
//   Station Tower, and Residential Tower) looking northeast toward our excavated plot!
// - `alley`: standing on the 218.3 m Toranomon Hills Residential Tower rooftop deck
//   (x=-340, y=220.0, z=-52) looking east across the Toranomon canyon toward our tower
// - `street`: eye-level (1.75 m) on the south Nishi-Shimbashi approach avenue looking
//   north at the excavated plot framed by LOD3 buildings
// - `overview`: high aerial view from the Toranomon Hills skyscraper side looking across the district
const VIEWS = {
  skyline: {
    position: new THREE.Vector3(-309, 165.45, 248),
    target: new THREE.Vector3(0, 110, 32),
  },
  street: {
    position: new THREE.Vector3(0.8, 1.75, 368),
    target: new THREE.Vector3(0, 108, 20),
  },
  alley: {
    position: new THREE.Vector3(-340, 220.0, -52),
    target: new THREE.Vector3(0, 115, 32),
  },
  overview: {
    position: new THREE.Vector3(-640, 420, 480),
    target: new THREE.Vector3(-40, 90, 0),
  },
};

let tween = null;
function flyTo(position, target, duration = 950) {
  walk.exit();
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
  viewButtons.forEach((button) =>
    button.classList.toggle('is-active', button.dataset.view === name),
  );
  flyTo(view.position, view.target);
}

// ------------------------------------------------------------------ models & atmosphere
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setRequestHeader({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });

const assetCache = new Map();
const placed = [];
const atmosphere = createAtmosphereSystem({ scene, renderer, camera, controls, placed });
// Start at 15:00 Afternoon so the sun in the West/Southwest illuminates the western
// facades facing the Toranomon Hills skyscraper cluster
atmosphere.state.hour = 15.0;
atmosphere.registerStreetMaterials(plateauGroup.userData.mats);
atmosphere.registerLampSpots(plateauGroup.userData.lampSpots);
window.__plateau = { THREE, scene, camera, controls, renderer, placed, atmosphere };

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

function beginLoading(text) {
  loadDepth += 1;
  loadingCard.classList.remove('is-hidden');
  loadingCard.querySelector('span:last-child').textContent = text;
  setStatus(text);
}

function endLoading() {
  loadDepth = Math.max(0, loadDepth - 1);
  if (loadDepth === 0) loadingCard.classList.add('is-hidden');
}

function loadAsset(config) {
  if (!assetCache.has(config.id)) {
    const promise = new Promise((resolve, reject) => {
      loader.load(
        config.asset,
        (gltf) => resolve(gltf.scene),
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

async function loadPlateauCity() {
  beginLoading('Loading PLATEAU Minato-ku LOD3...');
  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        './tokyo_plateau.optimized.glb',
        resolve,
        (event) => {
          if (!event.total) return;
          setStatus(`PLATEAU Minato-ku LOD3 ${Math.round((event.loaded / event.total) * 100)}%`);
        },
        reject,
      );
    });
    attachPlateauCityModel(gltf.scene, plateauGroup, atmosphere);
    walk.setColliderGroup('plateau', gltf.scene);
    // Re-sync camera height in case the default view starts on a PLATEAU skyscraper rooftop
    if (walk.active) walk.syncFromCamera({ preserveHeight: true });
    renderer.shadowMap.needsUpdate = true;
    setStatus('PLATEAU Tokyo ready · Minato-ku LOD3');
  } catch (error) {
    console.error('Failed to load PLATEAU Tokyo GLB:', error);
    setStatus('PLATEAU Tokyo failed to load');
    showToast('Could not load tokyo_plateau.optimized.glb');
  } finally {
    endLoading();
  }
}

function frameEntry(entry) {
  const box = new THREE.Box3().setFromObject(entry.group, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const distance = (maxSize / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35;
  // Frame from the West (Toranomon Hills skyscraper cluster direction) looking East
  const offset = new THREE.Vector3(-0.88, 0, 0.42).normalize().multiplyScalar(distance);
  const position = new THREE.Vector3(
    center.x + offset.x,
    Math.max(box.min.y + Math.min(size.y * 0.35, 115), 24),
    center.z + offset.z,
  );
  flyTo(position, center);
}

/**
 * Places or switches the active building in the single excavated Nishi-Shinjuku plot.
 */
async function switchModel(id, { focus = false } = {}) {
  const config = MODELS.find((model) => model.id === id);
  if (!config) return;

  // If the same model is already in the excavated plot, simply frame it
  if (placed.length === 1 && placed[0].id === id) {
    if (focus) frameEntry(placed[0]);
    return;
  }

  beginLoading(`Loading ${config.label}`);

  try {
    const source = await loadAsset(config);
    const root = source.clone(true);
    root.position.set(0, 0, 0);

    // Clear previous building from the excavated plot before placing the new one
    for (const prev of [...placed]) {
      scene.remove(prev.group);
    }
    placed.length = 0;

    const group = new THREE.Group();
    group.name = `${config.id}_${nextTicket}`;
    group.rotation.y = config.yaw ?? 0;
    group.add(root);

    const plot = PLOTS[0];
    group.position.set(plot.x, groundHeightAt(plot.x, plot.z), plot.z);
    scene.add(group);
    group.updateMatrixWorld(true);

    root.traverse((object) => {
      if (!object.isMesh) return;
      const nName = (object.name || '').toLowerCase();
      // Hide built-in single-building viewer ground pads (`Ground_Site`, `Ground_Tower_Footprint`,
      // `Office_Ground`) so they don't coplanar-flicker with the excavated PLATEAU civic plaza slab!
      if (
        nName === 'ground_site' ||
        nName === 'ground_tower_footprint' ||
        nName === 'office_ground'
      ) {
        object.visible = false;
        return;
      }
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      const isGlassOrLamp = mats.some(
        (m) =>
          m &&
          ((m.transmission ?? 0) > 0 ||
            m.transparent ||
            (m.emissiveIntensity ?? 0) > 1 ||
            /^Stack_(Light_|Mall_Glow)/.test(m.name || '')),
      );
      const isInteriorSlab =
        /slab/i.test(object.name) ||
        mats.some((m) => m && /slab/i.test(m.name));
      const skipShadow = isGlassOrLamp || isInteriorSlab;
      object.castShadow = !skipShadow;
      object.receiveShadow = !skipShadow;
    });

    const entry = {
      ticket: nextTicket++,
      id: config.id,
      label: config.label,
      group,
      plot: 0,
      hidden: false,
    };
    placed.push(entry);
    walk.setColliderGroup('placed', group);
    atmosphere.applyAtmosphere();
    renderPlaced();
    renderPalette();
    renderer.shadowMap.needsUpdate = true;
    setStatus(`${config.label} active in ${plot.code}`);
    if (focus) frameEntry(entry);
  } catch (error) {
    console.error(`${config.label} failed to load`, error);
    setStatus(`${config.label} could not be loaded`);
    showToast(`Could not load ${config.label}. Check the asset path.`);
  } finally {
    endLoading();
  }
}

function removeEntry(entry) {
  scene.remove(entry.group);
  const index = placed.indexOf(entry);
  if (index >= 0) placed.splice(index, 1);
  walk.setColliderGroup('placed', null);
  renderPlaced();
  renderPalette();
  renderer.shadowMap.needsUpdate = true;
  setStatus('Excavated plot empty');
}

function clearAll() {
  for (const entry of [...placed]) removeEntry(entry);
  showToast('Excavated residential plot cleared.');
}

// ------------------------------------------------------------------ panel
function renderPalette() {
  const activeId = placed[0]?.id ?? null;
  palette.innerHTML = MODELS.map(
    (model, idx) => `
    <button class="palette-button${activeId === model.id ? ' is-active' : ''}" data-model="${model.id}">
      <span class="palette-index">${String(idx + 1).padStart(2, '0')}</span>
      <span class="palette-name">${model.label}<small>${model.meta}</small></span>
      <span class="palette-action">${activeId === model.id ? '● active' : 'switch'}</span>
    </button>
  `,
  ).join('');
}

function renderPlaced() {
  placedCount.textContent = `${placed.length} / ${PLOTS.length}`;
  if (!placed.length) {
    placedList.innerHTML =
      '<p class="empty">Excavated Nishi-Shinjuku plot is empty. Pick a building above to place it into the Tokyo block.</p>';
    return;
  }
  placedList.innerHTML = placed
    .map(
      (entry) => `
    <div class="placed-row${entry.hidden ? ' is-hidden' : ''}" data-ticket="${entry.ticket}">
      <button class="placed-focus" data-act="focus">
        <span class="placed-ticket">01</span>
        <span class="placed-name">${entry.label}<small>${PLOTS[entry.plot].code}</small></span>
      </button>
      <button class="placed-icon" data-act="hide" title="${entry.hidden ? 'Show' : 'Hide'}">${entry.hidden ? '○' : '●'}</button>
      <button class="placed-icon" data-act="remove" title="Remove">×</button>
    </div>
  `,
    )
    .join('');
}

palette.addEventListener('click', (event) => {
  const button = event.target.closest('[data-model]');
  if (button) switchModel(button.dataset.model, { focus: false });
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
viewButtons.forEach((button) =>
  button.addEventListener('click', () => applyView(button.dataset.view)),
);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'f') {
    walk.toggle();
    return;
  }
  const index = Number(event.key);
  if (index >= 1 && index <= MODELS.length) {
    switchModel(MODELS[index - 1].id, { focus: false });
    return;
  }
  if (key === 's' && !walk.active) applyView('street');
  if (key === 'a' && !walk.active) applyView('alley');
  if (key === 'k') applyView('skyline');
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
  timePresetsEl.innerHTML = TIME_PRESETS.map(
    (p) => `
    <button class="preset-btn" data-hour="${p.hour}" data-preset="${p.id}">
      <span>${p.zh}</span>
      <small>${formatHour(p.hour)}</small>
    </button>
  `,
  ).join('');

  weatherButtonsEl.innerHTML = WEATHER_MODES.map(
    (w) => `
    <button class="weather-btn" data-weather="${w.id}">
      <span>${w.zh}</span>
      <small>${w.label}</small>
    </button>
  `,
  ).join('');
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
let lastFrame = 0;

function updateTween(now) {
  if (!tween) return;
  const progress = Math.min((now - tween.started) / tween.duration, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
  controls.update();
  if (progress >= 1) {
    tween = null;
    walk.enter({ lock: false, preserveHeight: true });
  }
}

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

renderer.setAnimationLoop((now) => {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
  lastFrame = now;
  if (walk.active) {
    walk.update(dt);
  } else {
    updateTween(now);
    controls.update();
  }
  atmosphere.update(now);
  if (atmosphere.state.playing) {
    timeClock.textContent = formatHour(atmosphere.state.hour);
    timePhase.textContent = phaseLabel(atmosphere.state.hour);
    timeSlider.value = atmosphere.state.hour.toFixed(2);
  }
  if (!walk.active && camera.position.y < 0.8) camera.position.y = 0.8;
  renderer.render(scene, camera);
});

window.addEventListener('resize', resize);

// ------------------------------------------------------------------ start
Object.assign(window.__plateau, { switchModel, removeEntry, applyView, walk });
renderEnvControls();
atmosphere.applyAtmosphere({ forceEnv: true });
syncEnvUI();
renderer.shadowMap.needsUpdate = true;
renderPalette();
renderPlaced();
camera.position.copy(VIEWS.skyline.position);
controls.target.copy(VIEWS.skyline.target);
controls.update();
viewButtons.forEach((button) =>
  button.classList.toggle('is-active', button.dataset.view === 'skyline'),
);
walk.enter({ lock: false, preserveHeight: true });
resize();

// Load the excavated PLATEAU Tokyo city chunk and place the initial building
loadPlateauCity();
switchModel(MODELS[0].id, { focus: false });
