import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#load-status');
const loadingCard = document.querySelector('#loading-card');
const viewButtons = [...document.querySelectorAll('.view-button')];
const resetButton = document.querySelector('#reset-view');
const modelList = document.querySelector('#model-list');
const modelEyebrow = document.querySelector('#model-eyebrow');
const modelTitle = document.querySelector('#model-title');
const modelIntro = document.querySelector('#model-intro');
const metricHeight = document.querySelector('#metric-height');
const metricStoreys = document.querySelector('#metric-storeys');
const metricFootprint = document.querySelector('#metric-footprint');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8e9d93');

const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2500);
const devicePixelRatio = window.devicePixelRatio || 1;
// Full device resolution at all times. Orbiting used to drop to one device
// pixel per CSS pixel and come back 120 ms after release, which blurred the
// facade exactly while it was being inspected; the scene is fast enough now.
const pixelRatio = Math.min(devicePixelRatio, 2);
const renderer = new WebGPURenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
await renderer.init();
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.sortObjects = true;
window.__stackDebug = { renderer, scene, camera, renderFrames: 0 };
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
viewer.appendChild(renderer.domElement);

// Time-of-day sky. One equirectangular painting, rebuilt from the sun's
// elevation, feeds both the visible background and the reflection environment,
// so glass mirrors the sky of the hour instead of a fixed studio box.
const SKY_WIDTH = 512;
const SKY_HEIGHT = 256;
const skyCanvas = document.createElement('canvas');
skyCanvas.width = SKY_WIDTH;
skyCanvas.height = SKY_HEIGHT;
const skyContext = skyCanvas.getContext('2d');
// The WebGPU backend keeps the GPU copy of a CanvasTexture after the canvas is
// repainted, even when needsUpdate is set, so each repaint swaps in a fresh
// texture instead. 512x256 is above the detail of a smooth gradient.
let skyTexture = null;

function pushSkyTexture() {
  const previous = skyTexture;
  skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTexture;
  if (previous) previous.dispose();
  window.__stackDebug.skyCanvas = skyCanvas;
  window.__stackDebug.skyTexture = skyTexture;
}
const skyPmrem = new THREE.PMREMGenerator(renderer);
let skyEnvironment = null;
let lastSkyUpdate = 0;

// Sky keyframes by clock hour. The dial is the thing the reader drags, so the
// mood is authored against it directly: a sun that climbs 70 degrees in six
// hours squeezes sunset into a few minutes of dial travel otherwise. The
// palette stays muted — the viewer is an editorial render, not a postcard.
const SKY_HOURS = [
  { hour: 0, zenith: '#0c1622', horizon: '#18232e', sun: '#22303c', glow: 0.03 },
  { hour: 4.2, zenith: '#0d1724', horizon: '#192530', sun: '#233240', glow: 0.04 },
  { hour: 5.2, zenith: '#2a3d52', horizon: '#55636b', sun: '#8a7a6a', glow: 0.18 },
  { hour: 6.0, zenith: '#46596b', horizon: '#9a8672', sun: '#d9a273', glow: 0.45 },
  { hour: 6.8, zenith: '#6e8494', horizon: '#c8b9a4', sun: '#ffcf9b', glow: 0.60 },
  { hour: 8.0, zenith: '#8ba2a3', horizon: '#d2d3c2', sun: '#ffe6b8', glow: 0.40 },
  { hour: 10.0, zenith: '#9cb3ad', horizon: '#d5dbca', sun: '#fff1d4', glow: 0.22 },
  { hour: 12.0, zenith: '#a8bdb7', horizon: '#d8decd', sun: '#fff6e3', glow: 0.15 },
  { hour: 15.0, zenith: '#a3b8b2', horizon: '#d6dcc9', sun: '#fff0cf', glow: 0.20 },
  { hour: 16.8, zenith: '#93a8a6', horizon: '#dcd2b8', sun: '#ffe0ae', glow: 0.35 },
  { hour: 17.6, zenith: '#7a8f99', horizon: '#dfc39f', sun: '#ffc98a', glow: 0.55 },
  { hour: 18.4, zenith: '#5b7186', horizon: '#cfa07c', sun: '#f0a26a', glow: 0.70 },
  { hour: 19.1, zenith: '#24384f', horizon: '#4d6480', sun: '#7a90a8', glow: 0.30 },
  { hour: 20.0, zenith: '#16222f', horizon: '#26343f', sun: '#33475a', glow: 0.10 },
  { hour: 21.5, zenith: '#0c1622', horizon: '#18232e', sun: '#22303c', glow: 0.03 },
  { hour: 24, zenith: '#0c1622', horizon: '#18232e', sun: '#22303c', glow: 0.03 },
].map((stop) => ({
  hour: stop.hour,
  glow: stop.glow,
  zenith: new THREE.Color(stop.zenith),
  horizon: new THREE.Color(stop.horizon),
  sun: new THREE.Color(stop.sun),
}));

const skyGround = new THREE.Color();
const SKY_GROUND_NEUTRAL = new THREE.Color('#3a444d');

function skyStopsAtHour(hour) {
  const stops = SKY_HOURS;
  let index = 0;
  while (index < stops.length - 2 && stops[index + 1].hour <= hour) index += 1;
  const low = stops[index];
  const high = stops[index + 1];
  const t = Math.min(1, Math.max(0, (hour - low.hour) / (high.hour - low.hour)));
  return {
    zenith: low.zenith.clone().lerp(high.zenith, t),
    horizon: low.horizon.clone().lerp(high.horizon, t),
    sun: low.sun.clone().lerp(high.sun, t),
    glow: low.glow + (high.glow - low.glow) * t,
  };
}

function cssColor(color, alpha) {
  const style = color.getStyle();
  if (alpha >= 1) return style;
  return style.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

function paintSky(hour, azimuth) {
  const { zenith, horizon, sun, glow } = skyStopsAtHour(hour);
  // The lower half of the equirect sits behind the site, so it borrows the
  // ground plane's tone rather than turning the horizon into a brown band.
  skyGround.copy(horizon).lerp(SKY_GROUND_NEUTRAL, 0.45).multiplyScalar(0.85);
  const gradient = skyContext.createLinearGradient(0, 0, 0, SKY_HEIGHT);
  gradient.addColorStop(0, cssColor(zenith, 1));
  gradient.addColorStop(0.5, cssColor(horizon, 1));
  gradient.addColorStop(0.501, cssColor(skyGround, 1));
  gradient.addColorStop(1, cssColor(skyGround.clone().multiplyScalar(0.7), 1));
  skyContext.fillStyle = gradient;
  skyContext.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);

  // Sun bearing in equirect u, and its height in v.
  const elevation = Math.sin((hour - 6) / 12 * Math.PI) * SUN_ELEVATION_MAX;
  const elevationDeg = (elevation * 180) / Math.PI;
  const cosEl = Math.cos(elevation);
  const sunX = Math.sin(azimuth) * cosEl;
  const sunZ = -Math.cos(azimuth) * cosEl;
  const u = ((Math.atan2(sunZ, sunX) / (Math.PI * 2)) + 0.5 + 1) % 1;
  const sunPx = u * SKY_WIDTH;
  const horizonY = SKY_HEIGHT * 0.5;

  // Horizon glow: broad and warm, strongest while the sun crosses the horizon.
  if (glow > 0.01) {
    const halo = skyContext.createRadialGradient(
      sunPx, horizonY, 0, sunPx, horizonY, SKY_WIDTH * 0.42);
    halo.addColorStop(0, cssColor(sun, Math.min(1, glow)));
    halo.addColorStop(0.35, cssColor(sun, glow * 0.45));
    halo.addColorStop(1, cssColor(sun, 0));
    skyContext.fillStyle = halo;
    skyContext.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);
  }

  // The disc itself, while it is above the horizon.
  if (elevationDeg > -2) {
    const discY = SKY_HEIGHT * (0.5 - elevation / Math.PI);
    const disc = skyContext.createRadialGradient(
      sunPx, discY, 0, sunPx, discY, SKY_HEIGHT * 0.05);
    disc.addColorStop(0, cssColor(sun, Math.min(1, 0.4 + elevationDeg / 14)));
    disc.addColorStop(1, cssColor(sun, 0));
    skyContext.fillStyle = disc;
    skyContext.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);
  }
  pushSkyTexture();
}

function refreshSkyEnvironment(force = false) {
  const now = performance.now();
  if (!force && now - lastSkyUpdate < 120) return;
  lastSkyUpdate = now;
  if (skyEnvironment) skyEnvironment.dispose();
  skyEnvironment = skyPmrem.fromEquirectangular(skyTexture);
  scene.environment = skyEnvironment.texture;
}

// Modelled lamp panels: exported at a fixed emissive strength, brightened as
// the sky darkens so lit windows read at night the way they do at dusk.
const lampMaterials = new Set();

function collectLampMaterials() {
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || (material.emissiveIntensity ?? 0) <= 0.5) continue;
      if (material.userData.lampBase === undefined) {
        material.userData.lampBase = material.emissiveIntensity;
      }
      lampMaterials.add(material);
    }
  });
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 95;
controls.maxDistance = 720;
// glTF is Y-up: Blender Z becomes Three.js Y after export.
controls.target.set(0, 145, 0);

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderFrame);
}
function renderFrame() {
  renderQueued = false;
  const dampingActive = controls.update();
  window.__stackDebug.renderFrames += 1;
  renderer.render(scene, camera);
  if (dampingActive) requestRender();
}
controls.addEventListener('change', requestRender);

const hemiLight = new THREE.HemisphereLight('#f4f7ed', '#7e8d83', 0.9);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight('#fff8e5', 2.2);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight('#c3d9e5', 0.8);
scene.add(fillLight);
const SUN_DISTANCE = 420;
const SUN_ELEVATION_MAX = (70 * Math.PI) / 180;
const DAY_GROUND = new THREE.Color('#aeb9af');
const NIGHT_GROUND = new THREE.Color('#2f3833');
const FILL_COLOR_DAY = new THREE.Color('#c3d9e5');
const FILL_COLOR_NIGHT = new THREE.Color('#1c2836');
const SUN_HANDLE_R = 54;
const SUN_CENTER = 70;
let sunHour = 10;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 900),
  new THREE.MeshStandardMaterial({ color: '#aeb9af', roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.35;
scene.add(ground);
const grid = new THREE.GridHelper(600, 30, '#aebcaf', '#c6d0c3');
grid.position.y = -0.28;
grid.material.transparent = true;
grid.material.opacity = 0.22;
scene.add(grid);

// The Blender scene origin is the building footprint centre at ground level.
// Keep it visible in the viewer instead of relying on the text axis key alone.
const originAxes = new THREE.AxesHelper(24);
originAxes.position.set(0, 0.02, 0);
scene.add(originAxes);
const originMarker = new THREE.Mesh(
  new THREE.RingGeometry(1.3, 1.55, 40),
  new THREE.MeshBasicMaterial({ color: '#202421', side: THREE.DoubleSide })
);
originMarker.rotation.x = -Math.PI / 2;
originMarker.position.y = 0.04;
scene.add(originMarker);

const views = {
  overview: { position: new THREE.Vector3(310, 260, -390), target: new THREE.Vector3(0, 145, 0) },
  garden: { position: new THREE.Vector3(180, 128, -215), target: new THREE.Vector3(0, 118, 0) },
  base: { position: new THREE.Vector3(185, 42, -250), target: new THREE.Vector3(0, 30, 0) },
};
const models = {
  stack: {
    label: 'The Stack', meta: '01 / 301.8 m', asset: './assets/the_stack.optimized.glb?v=20261127g',
    eyebrow: 'MVRDV competition proposal / web conversion',
    title: 'A vertical city,<br /><i>stacked in public.</i>',
    intro: 'A vertical sequence of retail, gardens, work and living bands, translated from the procedural Blender study.',
    metrics: ['301.8', '64', '115 × 40'],
  },
  abeno: {
    label: 'Abeno Harukas', meta: '02 / high-rise study', asset: './assets/abeno_harukas.optimized.glb',
    eyebrow: 'Structural facade study / web conversion',
    title: 'A tower of<br /><i>layered structure.</i>',
    intro: 'A procedural high-rise study with continuous curtain wall, truss bands and a linked core reconstruction.',
    metrics: ['300', '60+', '—'],
  },
  pompidou: {
    label: 'Centre Pompidou', meta: '03 / facade study', asset: './assets/centre_pompidou.optimized.glb',
    eyebrow: 'Centre Pompidou study / web conversion',
    title: 'Infrastructure<br /><i>on display.</i>',
    intro: 'A browser-ready study of exposed services, circulation and the building-scale facade language.',
    metrics: ['—', '—', '—'],
  },
  house: {
    label: 'Highrise House', meta: '04 / residential study', asset: './assets/highrise_house.optimized.glb',
    eyebrow: 'Residential tower study / web conversion',
    title: 'Domestic life<br /><i>in the vertical.</i>',
    intro: 'A residential high-rise with planted terraces, a continuous podium and a layered curtain wall.',
    metrics: ['—', '—', '—'],
  },
  office: {
    label: 'Office Tower', meta: '05 / office study', asset: './assets/office_tower.optimized.glb',
    eyebrow: 'Office tower study / web conversion',
    title: 'Workplace<br /><i>as a facade.</i>',
    intro: 'A compact office-tower study with modular glazing, floor plates and a readable interior rhythm.',
    metrics: ['—', '—', '—'],
  },
};
let model;
let activeModelId = 'stack';
let modelBounds;
let defaultView;

function getView(name) {
  if (activeModelId === 'stack' && views[name]) return views[name];
  if (!modelBounds || name === 'overview') return defaultView;
  const { center, size, distance } = modelBounds;
  const targetY = name === 'base'
    ? center.y - size.y * 0.28
    : center.y + size.y * 0.05;
  return {
    position: new THREE.Vector3(
      center.x + distance * 0.68,
      targetY + distance * 0.18,
      center.z - distance * 0.86
    ),
    target: new THREE.Vector3(center.x, targetY, center.z),
  };
}

function applyView(name, instant = false) {
  const view = getView(name);
  if (!view) return;
  viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === name));
  if (instant) {
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    controls.update();
    return;
  }
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const started = performance.now();
  const duration = 700;
  function animateView(now) {
    const progress = Math.min((now - started) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    camera.position.lerpVectors(startPosition, view.position, eased);
    controls.target.lerpVectors(startTarget, view.target, eased);
    controls.update();
    requestRender();
    if (progress < 1) requestAnimationFrame(animateView);
  }
  requestAnimationFrame(animateView);
}

function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const distance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.45;
  modelBounds = { center, size, maxSize, distance };
  controls.target.copy(center);
  camera.position.set(
    center.x + distance * 0.72,
    center.y + distance * 0.26,
    center.z - distance * 0.92
  );
  controls.maxDistance = maxSize * 2.4;
  controls.minDistance = maxSize * 0.24;
  controls.update();
  defaultView = { position: camera.position.clone(), target: center.clone() };
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let loadToken = 0;

function disposeModel(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material?.dispose());
  });
  scene.remove(root);
}

function updateModelMeta(config) {
  modelEyebrow.textContent = config.eyebrow;
  modelTitle.innerHTML = config.title;
  modelIntro.textContent = config.intro;
  metricHeight.textContent = config.metrics[0];
  metricStoreys.textContent = config.metrics[1];
  metricFootprint.textContent = config.metrics[2];
}

function renderModelList() {
  modelList.innerHTML = Object.entries(models).map(([id, config]) => (
    `<button class="model-button${id === activeModelId ? ' is-active' : ''}" data-model="${id}">
      <span>${config.label}</span><small>${config.meta}</small>
    </button>`
  )).join('');
  modelList.querySelectorAll('.model-button').forEach((button) => {
    button.addEventListener('click', () => loadModel(button.dataset.model));
  });
}

function loadModel(id) {
  const config = models[id];
  if (!config) return;
  activeModelId = id;
  updateModelMeta(config);
  renderModelList();
  if (model) {
    disposeModel(model);
    model = null;
  }
  modelBounds = null;
  defaultView = null;
  loadingCard.innerHTML = '<span class="spinner"></span><span>Preparing the building</span>';
  loadingCard.classList.remove('is-hidden');
  status.textContent = `Loading ${config.label}`;
  const token = ++loadToken;
  loader.load(
    config.asset,
    (gltf) => {
      if (token !== loadToken) {
        disposeModel(gltf.scene);
        return;
      }
      model = gltf.scene;
      scene.add(model);
      frameModel(model);
      collectLampMaterials();
      setSunHour(sunHour, true);
      requestRender();
      status.textContent = 'Model ready';
      loadingCard.classList.add('is-hidden');
    },
    (progress) => {
      if (progress.total) {
        status.textContent = `${config.label} ${Math.round(progress.loaded / progress.total * 100)}%`;
      }
    },
    (error) => {
      if (token !== loadToken) return;
      console.error(`${config.label} failed to load`, error);
      status.textContent = 'Model unavailable';
      loadingCard.innerHTML = '<span>Could not load the GLB asset</span>';
    }
  );
}

viewButtons.forEach((button) => button.addEventListener('click', () => applyView(button.dataset.view)));
resetButton.addEventListener('click', () => {
  if (defaultView) {
    camera.position.copy(defaultView.position);
    controls.target.copy(defaultView.target);
    controls.update();
    requestRender();
  } else {
    applyView('overview', true);
  }
});

const sunDial = document.querySelector('#sun-dial');
const sunHandle = document.querySelector('#sun-handle');
const sunTime = document.querySelector('#sun-time');
const sunPhase = document.querySelector('#sun-phase');
const sunTicks = document.querySelector('#sun-ticks');
const sunLabels = document.querySelector('#sun-labels');
const scratchColor = new THREE.Color();

function hourAngle(hour) {
  return ((hour - 12) / 24) * Math.PI * 2 - Math.PI / 2;
}

function padHour(hour) {
  const wrapped = ((hour % 24) + 24) % 24;
  const hours = Math.floor(wrapped);
  const minutes = Math.round((wrapped - hours) * 60);
  if (minutes === 60) return `${String((hours + 1) % 24).padStart(2, '0')}:00`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function sunPhaseName(hour) {
  if (hour < 5.2 || hour >= 20.4) return 'night';
  if (hour < 6.2) return 'dawn';
  if (hour < 7.4) return 'sunrise';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 18.6) return 'sunset';
  return 'blue hour';
}

function drawSunDial() {
  sunTicks.replaceChildren();
  sunLabels.replaceChildren();
  for (let hour = 0; hour < 24; hour += 1) {
    const angle = hourAngle(hour);
    const inner = hour % 6 === 0 ? 46 : 50;
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', String(SUN_CENTER + Math.cos(angle) * inner));
    tick.setAttribute('y1', String(SUN_CENTER + Math.sin(angle) * inner));
    tick.setAttribute('x2', String(SUN_CENTER + Math.cos(angle) * SUN_HANDLE_R));
    tick.setAttribute('y2', String(SUN_CENTER + Math.sin(angle) * SUN_HANDLE_R));
    tick.setAttribute('class', hour % 6 === 0 ? 'sun-tick is-major' : 'sun-tick');
    sunTicks.append(tick);
    if (hour % 6 !== 0) continue;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'sun-label');
    label.setAttribute('x', String(SUN_CENTER + Math.cos(angle) * 38));
    label.setAttribute('y', String(SUN_CENTER + Math.sin(angle) * 38));
    label.textContent = String(hour);
    sunLabels.append(label);
  }
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function setSunHour(hour, immediate = false) {
  sunHour = ((hour % 24) + 24) % 24;
  const azimuth = (sunHour / 24) * Math.PI * 2;
  // Latitude-free sun path: rises at 06:00, peaks at 70 degrees at noon, sets
  // at 18:00 and keeps falling to -70 degrees after dark.
  const elevation = Math.sin((sunHour - 6) / 12 * Math.PI) * SUN_ELEVATION_MAX;
  const elevationDeg = (elevation * 180) / Math.PI;
  const cosEl = Math.cos(elevation);
  const x = SUN_DISTANCE * Math.sin(azimuth) * cosEl;
  const y = SUN_DISTANCE * Math.sin(elevation);
  const z = -SUN_DISTANCE * Math.cos(azimuth) * cosEl;
  keyLight.position.set(x, Math.max(y, SUN_DISTANCE * 0.03), z);
  fillLight.position.set(-x * 0.7, Math.max(y * 0.35, 80), -z * 0.7);

  // daylight spans civil twilight to full day; golden peaks as the disc
  // touches the horizon.
  const daylight = smoothstep(-6, 14, elevationDeg);
  const golden = smoothstep(-2, 1, elevationDeg) * (1 - smoothstep(6, 22, elevationDeg));

  paintSky(sunHour, azimuth);
  refreshSkyEnvironment(immediate);

  const sky = skyStopsAtHour(sunHour);
  scratchColor.copy(sky.sun).lerp(sky.zenith, 0.25);
  keyLight.color.copy(scratchColor);
  keyLight.intensity = 2.2 * smoothstep(-1.5, 26, elevationDeg) + 0.35 * golden;
  fillLight.color.copy(FILL_COLOR_NIGHT).lerp(FILL_COLOR_DAY, daylight);
  fillLight.intensity = 0.10 + 0.70 * daylight;
  hemiLight.color.copy(sky.zenith);
  hemiLight.groundColor.copy(skyGround);
  hemiLight.intensity = 0.34 + 0.54 * daylight;
  scene.environmentIntensity = 0.16 + 0.84 * daylight;
  renderer.toneMappingExposure = 0.50 + 0.36 * daylight;
  ground.material.color.copy(NIGHT_GROUND).lerp(DAY_GROUND, daylight);

  // Exported lamp panels brighten as the sky darkens.
  const lampBoost = 1 + 3.2 * (1 - daylight);
  for (const material of lampMaterials) {
    material.emissiveIntensity = material.userData.lampBase * lampBoost;
  }

  const angle = hourAngle(sunHour);
  sunHandle.setAttribute('cx', String(SUN_CENTER + Math.cos(angle) * SUN_HANDLE_R));
  sunHandle.setAttribute('cy', String(SUN_CENTER + Math.sin(angle) * SUN_HANDLE_R));
  sunTime.textContent = padHour(sunHour);
  sunPhase.textContent = sunPhaseName(sunHour);
  sunDial.setAttribute('aria-valuenow', sunHour.toFixed(2));
  sunDial.setAttribute('aria-valuetext', `${padHour(sunHour)} ${sunPhaseName(sunHour)}`);
  requestRender();
}

function hourFromPointer(event) {
  const bounds = sunDial.querySelector('svg').getBoundingClientRect();
  const dx = event.clientX - (bounds.left + bounds.width / 2);
  const dy = event.clientY - (bounds.top + bounds.height / 2);
  const svgAngle = Math.atan2(dy, dx);
  return (12 + (svgAngle + Math.PI / 2) / (Math.PI * 2) * 24 + 24) % 24;
}

function bindSunDial() {
  drawSunDial();
  let dragging = false;
  sunDial.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    sunDial.classList.add('is-dragging');
    sunDial.setPointerCapture(event.pointerId);
    setSunHour(hourFromPointer(event));
  });
  sunDial.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    setSunHour(hourFromPointer(event));
  });
  const stopDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    sunDial.classList.remove('is-dragging');
    if (sunDial.hasPointerCapture(event.pointerId)) {
      sunDial.releasePointerCapture(event.pointerId);
    }
    // The throttled rebuild may have skipped the final position.
    refreshSkyEnvironment(true);
  };
  sunDial.addEventListener('pointerup', stopDrag);
  sunDial.addEventListener('pointercancel', stopDrag);
  sunDial.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 1 : 0.25;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSunHour(sunHour + step);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSunHour(sunHour - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSunHour(12);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSunHour(0);
    }
  });
  setSunHour(sunHour);
}

bindSunDial();
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'r') resetButton.click();
  if (event.key === '1') applyView('overview');
  if (event.key === '2') applyView('garden');
  if (event.key === '3') applyView('base');
});

renderModelList();
updateModelMeta(models[activeModelId]);
loadModel(activeModelId);

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
window.addEventListener('resize', () => {
  resize();
  requestRender();
});
resize();
requestRender();
