// Playground: the street from the ThreeRT `the-stack2-day` study, with any of
// the blender-works models standing in it. Models are added from the palette,
// keep their real scale, and stay in the scene together.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildStreet } from './street.js';
import { MODELS, PLOTS, groundHeightAt } from './models.js';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#status');
const palette = document.querySelector('#palette');
const placedList = document.querySelector('#placed');
const placedCount = document.querySelector('#placed-count');
const toast = document.querySelector('#toast');
const loadingCard = document.querySelector('#loading');
const viewButtons = [...document.querySelectorAll('[data-view]')];

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9cbe0, 900, 4200);

const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 60000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 2600;

// ------------------------------------------------------------------ sky
const SUN = { elevation: 62, azimuth: 42 };
const sunDirection = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - SUN.elevation),
  THREE.MathUtils.degToRad(SUN.azimuth),
);

// A clear midday dome: deep blue overhead washing to a pale horizon, with a
// deck of cumulus — the sky the ThreeRT study renders, kept as a small shader
// so its colours do not depend on the scene exposure.
const skyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uZenith: { value: new THREE.Color('#4d84c4') },
    uHorizon: { value: new THREE.Color('#dfe6ec') },
    uSunColor: { value: new THREE.Color('#fff6e2') },
    uSunDirection: { value: sunDirection.clone() },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorldPosition;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPosition = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uSunColor;
    uniform vec3 uSunDirection;
    varying vec3 vWorldPosition;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.03;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec3 direction = normalize(vWorldPosition - cameraPosition);
      float up = clamp(direction.y, 0.0, 1.0);
      vec3 color = mix(uHorizon, uZenith, pow(up, 0.55));

      float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
      color += uSunColor * (pow(sun, 2200.0) * 10.0 + pow(sun, 22.0) * 0.16);

      if (up > 0.015) {
        vec2 uv = direction.xz / (up + 0.12) * 0.6 + vec2(7.3, 2.1);
        float pattern = fbm(uv * 1.35);
        float coverage = smoothstep(0.54, 0.74, pattern) * smoothstep(0.02, 0.2, up);
        vec3 cloud = vec3(0.96, 0.97, 0.99) * (0.82 + 0.18 * pattern);
        color = mix(color, cloud, coverage * 0.88);
      }

      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  toneMapped: false,
});

const sky = new THREE.Mesh(new THREE.SphereGeometry(18000, 48, 24), skyMaterial);
sky.name = 'sky';
sky.frustumCulled = false;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xfff2de, 3.1);
sun.position.copy(sunDirection).multiplyScalar(1800);
sun.target.position.set(0, 0, 100);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -760;
sun.shadow.camera.right = 760;
sun.shadow.camera.top = 760;
sun.shadow.camera.bottom = -760;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 5000;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(sun.target);

const hemisphere = new THREE.HemisphereLight(0xdcebff, 0x6b675f, 0.75);
scene.add(hemisphere);

// The models' glass needs something to reflect: bake the sky into an
// environment map once. Shadows and the street are static, so the shadow map
// is rendered once too, and again only when a model arrives or leaves.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentScene = new THREE.Scene();
  environmentScene.add(sky.clone());
  scene.environment = pmrem.fromScene(environmentScene, 0, 1, 30000).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
}
renderer.shadowMap.autoUpdate = false;

// ------------------------------------------------------------------ the street
buildStreet(scene);

// ------------------------------------------------------------------ views
const VIEWS = {
  street: {
    position: new THREE.Vector3(0.9, 1.75, 412),
    target: new THREE.Vector3(-11, 128, 0),
  },
  overview: {
    position: new THREE.Vector3(610, 430, 820),
    target: new THREE.Vector3(0, 100, -240),
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

// ------------------------------------------------------------------ models
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const assetCache = new Map();
const placed = [];
const reservedPlots = new Set();
window.__playground = { THREE, scene, camera, controls, renderer, placed };
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
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const namedGlass = /glass/i.test(material.name ?? '') && !/frost/i.test(material.name ?? '');
      if ((material.transmission ?? 0) > 0.01 || namedGlass) {
        material.transmission = 0;
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.color.setHex(0x3d505b);
        material.metalness = 0.35;
        material.roughness = 0.12;
        material.metalnessMap = null;
        material.roughnessMap = null;
        material.envMapIntensity = 2.0;
        material.clearcoat = 0;
        material.specularIntensity = 0.4;
        material.needsUpdate = true;
      }
      // The glTF carries the Blender interior fills as emissive materials in
      // nits (100, 360). Outdoors at midday they would blow the facade white,
      // so they stay a hint of a lit room instead.
      if (material.emissiveIntensity > 2) material.emissiveIntensity = 1.1;
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
  const index = Number(event.key);
  if (index >= 1 && index <= MODELS.length) addModel(MODELS[index - 1].id);
  if (event.key.toLowerCase() === 's') applyView('street');
  if (event.key.toLowerCase() === 'o') applyView('overview');
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
  // A tall target puts the orbit above the horizon on purpose; keep the eye
  // itself off the ground.
  if (camera.position.y < 0.8) camera.position.y = 0.8;
  renderer.render(scene, camera);
});

window.addEventListener('resize', resize);

// ------------------------------------------------------------------ start
Object.assign(window.__playground, { addModel, removeEntry, applyView });
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
