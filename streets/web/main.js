// Playground: the street from the ThreeRT `the-stack2-day` study, with any of
// the blender-works models standing in it. Models are added from the palette,
// keep their real scale, and stay in the scene together.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildStreet } from './street.js?v=20261128d';
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
// Keep Three.js library untouched; patch WebGLRenderer's transmission chunk once
// at startup so glTF materials authored as smooth clear glass (roughness < 0.02)
// sample Mip-0 directly instead of hitting WebGLRenderer's 0.0525 roughness
// floor + 16-tap B-spline mip blur, while frosted glass keeps Three.js's blur.
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

// Tighter near/far keeps ~5 cm facade-frame steps well above 24-bit depth
// quantization across street (350 m) and overview (900 m) viewing distances.
const camera = new THREE.PerspectiveCamera(52, 1, 1.5, 24000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 2600;

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
    if (active) {
      // Enter mid-flight and the half-finished camera tween would drag the eye
      // back out of the walk as soon as it ends.
      tween = null;
    }
  },
});

walkToggleBtn.addEventListener('click', () => walk.toggle());

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
    position: new THREE.Vector3(3.8, 6.2, 398),
    target: new THREE.Vector3(-9.5, 7.2, 304),
  },
  ikkodate: {
    position: new THREE.Vector3(36, 3.2, 380.0),
    target: new THREE.Vector3(106, 2.8, 379.2),
  },
  overview: {
    position: new THREE.Vector3(560, 410, 790),
    target: new THREE.Vector3(0, 95, -210),
  },
};

let tween = null;
function flyTo(position, target, duration = 950) {
  // A library view or a framed model overrides the walk: hand control back.
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
  viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === name));
  flyTo(view.position, view.target);
}

// ------------------------------------------------------------------ models & atmosphere
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setRequestHeader({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });

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
  const distance = (maxSize / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.42;
  // Frame from street/podium eye level rather than 220+ m up: ceiling light
  // fixtures sit underneath opaque floor slabs, so a low architectural angle
  // reads every lit storey from the retail podium to the crown (matching
  // model_viewer's facade elevation).
  const offset = new THREE.Vector3(0.32, 0, 1).normalize().multiplyScalar(distance);
  const position = new THREE.Vector3(
    center.x + offset.x,
    Math.max(box.min.y + Math.min(size.y * 0.03, 9), 6),
    center.z + offset.z,
  );
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
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'f') {
    walk.toggle();
    return;
  }
  const index = Number(event.key);
  if (index >= 1 && index <= MODELS.length) addModel(MODELS[index - 1].id);
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
    // OrbitControls.update() re-aims the camera at its stale target, so it
    // stays parked until the walk ends.
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
  // A tall target puts the orbit above the horizon on purpose; keep the eye
  // itself off the ground.
  if (!walk.active && camera.position.y < 0.8) camera.position.y = 0.8;
  renderer.render(scene, camera);
});

window.addEventListener('resize', resize);

// ------------------------------------------------------------------ start
Object.assign(window.__playground, { addModel, removeEntry, applyView, walk });
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
walk.enter({ lock: false, preserveHeight: false });
resize();
setStatus('Street ready — add a model');

// A first model so the playground never opens empty. The camera stays in the
// street for the first look instead of framing the tower.
addModel(MODELS[0].id, { focus: false });
