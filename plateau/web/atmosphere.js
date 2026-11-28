// 24-hour Time-of-Day lighting, procedural sky/stars/moon, dynamic PMREM reflections,
// street/tower night illumination, and multi-state Weather Simulation for Playground.
import * as THREE from 'three';

export const WEATHER_MODES = [
  { id: 'clear', label: 'Clear', zh: '晴朗' },
  { id: 'cloudy', label: 'Cloudy', zh: '多云' },
  { id: 'rain', label: 'Rain', zh: '下雨' },
  { id: 'snow', label: 'Snow', zh: '下雪' },
  { id: 'fog', label: 'Fog', zh: '大雾' },
];

export const TIME_PRESETS = [
  { id: 'dawn', label: 'Dawn', zh: '朝阳', hour: 6.0 },
  { id: 'morning', label: 'Morning', zh: '上午', hour: 9.5 },
  { id: 'noon', label: 'Noon', zh: '正午', hour: 12.5 },
  { id: 'dusk', label: 'Dusk', zh: '傍晚', hour: 17.75 },
  { id: 'blue', label: 'Blue Hr', zh: '蓝调', hour: 18.75 },
  { id: 'night', label: 'Night', zh: '黑夜', hour: 22.5 },
];

// Keyframes across a 24-hour cycle (hours 0..24)
const TIME_KEYFRAMES = [
  {
    hour: 0.0,
    zenith: '#050914',
    horizon: '#0d1629',
    sunColor: '#9ab4e8',
    hemiSky: '#1e2f50',
    hemiGround: '#10131b',
    hemiIntensity: 0.42,
    fogColor: '#0c1424',
    exposure: 0.85,
    envIntensity: 0.42,
  },
  {
    hour: 4.5,
    zenith: '#091124',
    horizon: '#1e2742',
    sunColor: '#ff9666',
    hemiSky: '#28385a',
    hemiGround: '#14161e',
    hemiIntensity: 0.44,
    fogColor: '#1a2238',
    exposure: 0.82,
    envIntensity: 0.44,
  },
  {
    hour: 5.75, // Sunrise / Dawn (朝阳)
    zenith: '#26467a',
    horizon: '#f49d68',
    sunColor: '#ff9b54',
    hemiSky: '#f0b892',
    hemiGround: '#5a4d45',
    hemiIntensity: 0.78,
    fogColor: '#e2a37e',
    exposure: 0.78,
    envIntensity: 0.78,
  },
  {
    hour: 7.25, // Early morning
    zenith: '#3c73b8',
    horizon: '#e8d7c5',
    sunColor: '#ffdfb3',
    hemiSky: '#cbe0fa',
    hemiGround: '#756e64',
    hemiIntensity: 0.92,
    fogColor: '#d3d5d8',
    exposure: 0.74,
    envIntensity: 0.88,
  },
  {
    hour: 10.0,
    zenith: '#467ec2',
    horizon: '#dce6ee',
    sunColor: '#fff4df',
    hemiSky: '#dcebff',
    hemiGround: '#827c73',
    hemiIntensity: 1.02,
    fogColor: '#c3d3e4',
    exposure: 0.74,
    envIntensity: 0.96,
  },
  {
    hour: 12.5, // Midday
    zenith: '#4a83c6',
    horizon: '#dfe6ec',
    sunColor: '#fff6e4',
    hemiSky: '#e2eeff',
    hemiGround: '#858077',
    hemiIntensity: 1.08,
    fogColor: '#bfd0e2',
    exposure: 0.74,
    envIntensity: 1.0,
  },
  {
    hour: 16.0,
    zenith: '#3f76b8',
    horizon: '#e5ddd0',
    sunColor: '#ffe7c2',
    hemiSky: '#d8e4f5',
    hemiGround: '#756e64',
    hemiIntensity: 0.94,
    fogColor: '#c9cfd8',
    exposure: 0.74,
    envIntensity: 0.9,
  },
  {
    hour: 17.75, // Golden hour / Sunset (傍晚)
    zenith: '#274375',
    horizon: '#f0824f',
    sunColor: '#ff7d40',
    hemiSky: '#e8a27a',
    hemiGround: '#54433a',
    hemiIntensity: 0.74,
    fogColor: '#d98863',
    exposure: 0.78,
    envIntensity: 0.76,
  },
  {
    hour: 18.75, // Blue hour / Twilight (蓝调)
    zenith: '#101d3b',
    horizon: '#624869',
    sunColor: '#ff6e48',
    hemiSky: '#3b4a73',
    hemiGround: '#24242e',
    hemiIntensity: 0.52,
    fogColor: '#36354d',
    exposure: 0.82,
    envIntensity: 0.56,
  },
  {
    hour: 20.0, // Nightfall
    zenith: '#060c1a',
    horizon: '#121d33',
    sunColor: '#9ab4e8',
    hemiSky: '#203254',
    hemiGround: '#141720',
    hemiIntensity: 0.42,
    fogColor: '#0e1728',
    exposure: 0.85,
    envIntensity: 0.42,
  },
  {
    hour: 24.0,
    zenith: '#050914',
    horizon: '#0d1629',
    sunColor: '#9ab4e8',
    hemiSky: '#1e2f50',
    hemiGround: '#10131b',
    hemiIntensity: 0.42,
    fogColor: '#0c1424',
    exposure: 0.85,
    envIntensity: 0.42,
  },
];

const _cA = new THREE.Color();
const _cB = new THREE.Color();

function sampleTimeKeyframes(hour) {
  const h = ((hour % 24) + 24) % 24;
  let k0 = TIME_KEYFRAMES[0];
  let k1 = TIME_KEYFRAMES[TIME_KEYFRAMES.length - 1];
  for (let i = 0; i < TIME_KEYFRAMES.length - 1; i++) {
    if (h >= TIME_KEYFRAMES[i].hour && h <= TIME_KEYFRAMES[i + 1].hour) {
      k0 = TIME_KEYFRAMES[i];
      k1 = TIME_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(k1.hour - k0.hour, 0.0001);
  const t = THREE.MathUtils.smoothstep((h - k0.hour) / span, 0, 1);
  const lerpHex = (hexA, hexB, out = new THREE.Color()) => {
    _cA.set(hexA);
    _cB.set(hexB);
    return out.copy(_cA).lerp(_cB, t);
  };
  return {
    zenith: lerpHex(k0.zenith, k1.zenith),
    horizon: lerpHex(k0.horizon, k1.horizon),
    sunColor: lerpHex(k0.sunColor, k1.sunColor),
    hemiSky: lerpHex(k0.hemiSky, k1.hemiSky),
    hemiGround: lerpHex(k0.hemiGround, k1.hemiGround),
    hemiIntensity: THREE.MathUtils.lerp(k0.hemiIntensity, k1.hemiIntensity, t),
    fogColor: lerpHex(k0.fogColor, k1.fogColor),
    exposure: THREE.MathUtils.lerp(k0.exposure, k1.exposure, t),
    envIntensity: THREE.MathUtils.lerp(k0.envIntensity, k1.envIntensity, t),
  };
}

export function formatHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function phaseLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5.0 && h < 7.0) return 'Sunrise · 朝阳';
  if (h >= 7.0 && h < 11.0) return 'Morning · 上午';
  if (h >= 11.0 && h < 15.5) return 'Midday · 白天';
  if (h >= 15.5 && h < 17.2) return 'Afternoon · 午后';
  if (h >= 17.2 && h < 18.45) return 'Sunset · 傍晚';
  if (h >= 18.45 && h < 19.6) return 'Blue Hour · 蓝调';
  return 'Night · 黑夜';
}

// Realistic 24-hour grouped skyscraper lighting schedule for The Stack's 64 circuits.
const STACK_OFFICE_CURVE = [
  [0.0, 0.16], [4.5, 0.12], [6.0, 0.0], [16.75, 0.0], [17.75, 0.48],
  [18.75, 0.63], [20.5, 0.48], [22.5, 0.36], [23.5, 0.20], [24.0, 0.16],
];
const STACK_APARTMENT_CURVE = [
  [0.0, 0.20], [2.0, 0.12], [5.25, 0.15], [6.25, 0.0], [17.0, 0.0],
  [18.0, 0.35], [18.75, 0.50], [21.0, 0.56], [22.5, 0.44], [23.5, 0.28], [24.0, 0.20],
];
const STACK_MALL_CURVE = [
  [0.0, 0.20], [5.25, 0.15], [6.25, 0.0], [16.75, 0.0], [18.0, 0.85],
  [18.75, 1.0], [22.0, 1.0], [22.5, 0.85], [23.5, 0.25], [24.0, 0.20],
];
const STACK_GARDEN_CURVE = [
  [0.0, 1.0], [5.25, 1.0], [6.0, 0.0], [17.0, 0.0], [18.0, 1.0], [24.0, 1.0],
];

function sampleStackCurve(curve, hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < curve.length - 1; i++) {
    const [h0, v0] = curve[i];
    const [h1, v1] = curve[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / Math.max(1e-6, h1 - h0);
      return v0 + (v1 - v0) * t;
    }
  }
  return curve[0][1];
}

function stackLampIntensity(matName, hour, sunUpFactor, weatherOfficeFloor = 0) {
  if (!matName || !matName.startsWith('Stack_')) return null;
  let m = matName.match(/^Stack_Light_Daylight_G(\d+)/);
  if (m) {
    const g = parseInt(m[1], 10);
    const rank = ((g * 19 + 7) % 32) / 32;
    const bright = 0.72 + 0.56 * (((g * 13 + 3) % 32) / 31);
    const occ = Math.max(sampleStackCurve(STACK_OFFICE_CURVE, hour), weatherOfficeFloor);
    if (occ <= 0.001) return 0;
    return THREE.MathUtils.smoothstep(occ, rank - 0.015, rank + 0.015) * 2.4 * bright;
  }
  m = matName.match(/^Stack_Light_Warm_G(\d+)/);
  if (m) {
    const g = parseInt(m[1], 10);
    const rank = ((g * 23 + 11) % 32) / 32;
    const bright = 0.70 + 0.60 * (((g * 17 + 5) % 32) / 31);
    const occ = sampleStackCurve(STACK_APARTMENT_CURVE, hour);
    if (occ <= 0.001) return 0;
    return THREE.MathUtils.smoothstep(occ, rank - 0.015, rank + 0.015) * 2.7 * bright;
  }
  if (matName.startsWith('Stack_Mall_Glow')) {
    return Math.max(sampleStackCurve(STACK_MALL_CURVE, hour), weatherOfficeFloor * 0.6) * 2.0;
  }
  if (matName.startsWith('Stack_Light_Warm')) {
    return sampleStackCurve(STACK_GARDEN_CURVE, hour) * 3.2;
  }
  if (matName === 'Stack_Ceiling_Slab') {
    return 0.32 * sunUpFactor;
  }
  return null;
}

function createSnowflakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.45, 'rgba(240,247,255,0.8)');
  g.addColorStop(1, 'rgba(240,247,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLampPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(255, 214, 148, 0.95)');
  g.addColorStop(0.35, 'rgba(255, 186, 102, 0.45)');
  g.addColorStop(0.75, 'rgba(255, 168, 82, 0.10)');
  g.addColorStop(1.0, 'rgba(255, 160, 72, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAtmosphereSystem({ scene, renderer, camera, controls, placed }) {
  // ------------------------------------------------------------------ sky dome
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color('#4d84c4') },
      uHorizon: { value: new THREE.Color('#dfe6ec') },
      uSunColor: { value: new THREE.Color('#fff6e2') },
      uSunDirection: { value: new THREE.Vector3(0.3, 0.85, 0.4) },
      uMoonDirection: { value: new THREE.Vector3(-0.3, 0.5, -0.4) },
      uStarIntensity: { value: 0.0 },
      uMoonVisibility: { value: 0.0 },
      uCloudCover: { value: 0.32 },
      uCloudDarkness: { value: 0.0 },
      uCloudTint: { value: new THREE.Color('#ffffff') },
      uTime: { value: 0.0 },
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
      uniform vec3 uMoonDirection;
      uniform float uStarIntensity;
      uniform float uMoonVisibility;
      uniform float uCloudCover;
      uniform float uCloudDarkness;
      uniform vec3 uCloudTint;
      uniform float uTime;
      varying vec3 vWorldPosition;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
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

        // Sun disc + atmospheric Mie glow (fades out smoothly below horizon)
        float sunElev = clamp(uSunDirection.y * 4.5 + 0.35, 0.0, 1.0);
        float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
        float sunClear = 1.0 - smoothstep(0.45, 0.95, uCloudCover);
        color += uSunColor * (pow(sunDot, 2200.0) * 10.0 * sunClear + pow(sunDot, 18.0) * 0.24) * sunElev;

        // Stars at night (attenuated near horizon & under heavy clouds)
        if (uStarIntensity > 0.01 && up > 0.03) {
          vec3 starCell = floor(direction * 340.0);
          float starSeed = hash3(starCell);
          if (starSeed > 0.992) {
            float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + starSeed * 80.0);
            float starMask = smoothstep(0.03, 0.32, up) * (1.0 - smoothstep(0.25, 0.78, uCloudCover));
            color += vec3(0.88, 0.92, 1.0) * ((starSeed - 0.992) / 0.008) * twinkle * starMask * uStarIntensity * 1.4;
          }
        }

        // Moon disc + cool silver halo
        if (uMoonVisibility > 0.01 && up > 0.0) {
          float moonDot = max(dot(direction, normalize(uMoonDirection)), 0.0);
          float moonClear = 1.0 - smoothstep(0.55, 0.96, uCloudCover);
          float moonDisc = smoothstep(0.99945, 0.99968, moonDot);
          float moonHalo = pow(moonDot, 42.0) * 0.16;
          color += vec3(0.82, 0.89, 1.0) * (moonDisc * 2.2 + moonHalo) * moonClear * uMoonVisibility;
        }

        // Procedural FBM clouds with weather coverage & storm darkening
        if (up > 0.012 && uCloudCover > 0.02) {
          vec2 windDrift = vec2(uTime * 0.008, uTime * 0.003);
          vec2 uv = direction.xz / (up + 0.14) * 0.55 + vec2(7.3, 2.1) + windDrift;
          float pattern = fbm(uv * 1.35);
          float threshold = mix(0.74, 0.26, uCloudCover);
          float coverage = smoothstep(threshold, threshold + 0.24, pattern) * smoothstep(0.015, 0.22, up);
          vec3 litCloud = uCloudTint * (0.82 + 0.18 * pattern);
          vec3 darkCloud = mix(uHorizon * 0.75, vec3(0.18, 0.21, 0.26), 0.65);
          vec3 cloud = mix(litCloud, darkCloud, uCloudDarkness);
          color = mix(color, cloud, coverage * mix(0.86, 0.96, uCloudCover));
        }

        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 24), skyMaterial);
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);

  // ------------------------------------------------------------------ primary lights
  const sunLight = new THREE.DirectionalLight(0xfff2de, 3.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -760;
  sunLight.shadow.camera.right = 760;
  sunLight.shadow.camera.top = 760;
  sunLight.shadow.camera.bottom = -760;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 5000;
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.6;
  sunLight.target.position.set(0, 0, 100);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemisphere = new THREE.HemisphereLight(0xdcebff, 0x6b675f, 0.75);
  scene.add(hemisphere);

  // Dynamic 9-light PointLight pool: always snaps to the 9 nearest streetlamps
  // around the camera/target so every residential lane & bar street is lit.
  // Every lit fragment evaluates all of them, so this count is the night frame
  // cost: the old 28 left the street at 15-30 fps; 9 street + 3 interior holds
  // 60 fps, and the additive lamp pools below carry the light further out.
  const nightLights = [];
  for (let i = 0; i < 9; i++) {
    // Physical inverse-square decay (2.0) + local 36 m cutoff prevents adjacent
    // Shotengai lamps from stacking into blown-out yellow facades in walk mode.
    const pt = new THREE.PointLight(0xffb969, 0, 36, 2.0);
    pt.visible = false;
    scene.add(pt);
    nightLights.push(pt);
  }

  let allLampSpots = [];
  let lampPoolMesh = null;
  let lastPoolSortPos = new THREE.Vector3(1e9, 1e9, 1e9);
  const _lampAim = new THREE.Vector3();
  const _lampFocus = new THREE.Vector3();
  let currentGlowFactor = 0;

  function registerLampSpots(spots) {
    allLampSpots = Array.isArray(spots) ? spots : [];
    if (lampPoolMesh) {
      scene.remove(lampPoolMesh);
      lampPoolMesh.geometry.dispose();
      lampPoolMesh.material.dispose();
      lampPoolMesh = null;
    }
    if (!allLampSpots.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: createLampPoolTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    lampPoolMesh = new THREE.InstancedMesh(geo, mat, allLampSpots.length);
    lampPoolMesh.frustumCulled = false;
    lampPoolMesh.visible = false;
    const dummy = new THREE.Object3D();
    allLampSpots.forEach((spot, idx) => {
      dummy.position.set(spot.x, 0.24, spot.z);
      dummy.scale.set((spot.radius ?? 18) * 0.75, 1, (spot.radius ?? 18) * 0.75);
      dummy.updateMatrix();
      lampPoolMesh.setMatrixAt(idx, dummy.matrix);
    });
    lampPoolMesh.instanceMatrix.needsUpdate = true;
    scene.add(lampPoolMesh);
    lastPoolSortPos.set(1e9, 1e9, 1e9);
  }

  function updateNearestLampLights(force = false) {
    if (!allLampSpots.length || currentGlowFactor <= 0.04) return;
    camera.getWorldDirection(_lampAim);
    _lampAim.y = 0;
    if (_lampAim.lengthSq() > 1e-6) _lampAim.normalize();
    const lookAhead = controls?.target
      ? Math.min(camera.position.distanceTo(controls.target) * 0.35, 28)
      : 20;
    _lampFocus.copy(camera.position).addScaledVector(_lampAim, lookAhead);
    if (!force && _lampFocus.distanceToSquared(lastPoolSortPos) < 64) return;
    lastPoolSortPos.copy(_lampFocus);

    const ranked = allLampSpots
      .map((spot) => {
        const dx = spot.x - _lampFocus.x;
        const dz = spot.z - _lampFocus.z;
        return { spot, d2: dx * dx + dz * dz };
      })
      .sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < nightLights.length; i++) {
      const item = ranked[i];
      const pt = nightLights[i];
      if (!item) {
        pt.visible = false;
        continue;
      }
      pt.position.set(item.spot.x, item.spot.y, item.spot.z);
      pt.intensity = currentGlowFactor * 20.0;
      pt.visible = true;
    }
  }

  scene.fog = new THREE.Fog(0xb9cbe0, 900, 4200);

  // ------------------------------------------------------------------ weather particles (camera-centered)
  const BOX_W = 130;
  const BOX_H = 72;
  const BOX_D = 130;

  // Rain streaks
  const RAIN_COUNT = 2400;
  const rainSeeds = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainSeeds[i * 3] = (Math.random() - 0.5) * BOX_W;
    rainSeeds[i * 3 + 1] = Math.random() * BOX_H;
    rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * BOX_D;
  }
  const rainPositions = new Float32Array(RAIN_COUNT * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xcfe2f5,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  scene.add(rainMesh);

  // Snowflakes
  const SNOW_COUNT = 1800;
  const snowSeeds = new Float32Array(SNOW_COUNT * 3);
  for (let i = 0; i < SNOW_COUNT; i++) {
    snowSeeds[i * 3] = (Math.random() - 0.5) * BOX_W;
    snowSeeds[i * 3 + 1] = Math.random() * BOX_H;
    snowSeeds[i * 3 + 2] = (Math.random() - 0.5) * BOX_D;
  }
  const snowPositions = new Float32Array(SNOW_COUNT * 3);
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowMat = new THREE.PointsMaterial({
    color: 0xf4f8ff,
    map: createSnowflakeTexture(),
    size: 0.42,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const snowMesh = new THREE.Points(snowGeo, snowMat);
  snowMesh.frustumCulled = false;
  snowMesh.visible = false;
  scene.add(snowMesh);

  // ------------------------------------------------------------------ street material registry
  const materialBaselines = new Map();
  let streetMats = null;

  function registerStreetMaterials(mats) {
    streetMats = mats;
    if (!mats) return;
    const record = (m) => {
      if (!m || materialBaselines.has(m)) return;
      materialBaselines.set(m, {
        color: m.color.clone(),
        roughness: m.roughness ?? 0.8,
        metalness: m.metalness ?? 0.0,
        envMapIntensity: m.envMapIntensity ?? 1.0,
        emissiveIntensity: m.emissiveIntensity ?? 0.0,
      });
    };
    for (const val of Object.values(mats)) {
      if (Array.isArray(val)) {
        val.forEach((b) => record(b?.material));
      } else if (val?.material) {
        record(val.material);
      }
    }
    const groundMesh = scene.getObjectByName('ground');
    if (groundMesh?.material) record(groundMesh.material);
  }

  // ------------------------------------------------------------------ PMREM dynamic environment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = sky.clone();
  envScene.add(envSky);
  let currentEnvTarget = null;
  let lastBakedHour = -99;
  let lastBakedWeather = '';
  let lastBakedTimeMs = 0;

  function bakeEnvironment(force = false) {
    const now = performance.now();
    const hourDelta = Math.abs(state.hour - lastBakedHour);
    const weatherChanged = state.weather !== lastBakedWeather;
    if (!force && !weatherChanged && hourDelta < 0.35) return;
    if (!force && now - lastBakedTimeMs < 140) return;

    envSky.material = skyMaterial;
    const nextTarget = pmrem.fromScene(envScene, 0, 1, 20000);
    if (currentEnvTarget) currentEnvTarget.dispose();
    currentEnvTarget = nextTarget;
    scene.environment = nextTarget.texture;
    lastBakedHour = state.hour;
    lastBakedWeather = state.weather;
    lastBakedTimeMs = now;
  }

  // ------------------------------------------------------------------ state
  const state = {
    hour: 22.5,
    weather: 'clear',
    intensity: 0.75,
    playing: false,
    speed: 1, // 1x = 1 hour per 4s, 4x, 12x
  };

  let lastShadowHour = -99;

  function applyAtmosphere({ forceEnv = false } = {}) {
    const h = ((state.hour % 24) + 24) % 24;
    const kf = sampleTimeKeyframes(h);

    // Solar angle: 05:45 sunrise (east, +X), 11:52 peak (high), 18:00 sunset (west, -X)
    // In Three.js (+X East, +Y Up, +Z South): phi = polar angle from +Y, theta = azimuth from +Z towards +X.
    // East (+90 deg) -> South (0 deg) -> West (-90 deg), so the southern/western Shinjuku facades
    // facing the camera receive direct sunlight throughout the day!
    const dayProgress = (h - 5.75) / 12.25; // 0 at 05:45, 1 at 18:00
    const sunElevDeg = Math.sin(dayProgress * Math.PI) * 64; // -64 .. +64
    const sunAzimDeg = 85 - dayProgress * 170; // East (+85) -> South (0) -> West (-85)

    const sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - sunElevDeg),
      THREE.MathUtils.degToRad(sunAzimDeg),
    );
    const moonDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - Math.max(18, -sunElevDeg * 0.85)),
      THREE.MathUtils.degToRad(sunAzimDeg + 165),
    );

    const sunUpFactor = THREE.MathUtils.smoothstep(sunElevDeg, -4, 14);
    const nightFactor = 1.0 - THREE.MathUtils.smoothstep(sunElevDeg, -6, 8);
    const moonUpFactor = THREE.MathUtils.smoothstep(-sunElevDeg, 1, 14);

    // Weather modifiers
    const w = state.weather;
    const inten = state.intensity;
    let cloudCover = 0.3;
    let cloudDarkness = 0.0;
    let sunDamp = 1.0;
    let fogNear = 900;
    let fogFar = 4200;
    let wetness = 0.0;
    let snowCover = 0.0;
    let exposureBoost = 1.0;

    if (w === 'cloudy') {
      cloudCover = 0.65 + 0.25 * inten;
      cloudDarkness = 0.25 + 0.2 * inten;
      sunDamp = 1.0 - 0.55 * inten;
      fogNear = 520;
      fogFar = 2800;
    } else if (w === 'rain') {
      cloudCover = 0.88 + 0.1 * inten;
      cloudDarkness = 0.58 + 0.25 * inten;
      sunDamp = 1.0 - 0.78 * inten;
      fogNear = 240 - 90 * inten;
      fogFar = 1650 - 550 * inten;
      wetness = 0.65 + 0.35 * inten;
      exposureBoost = 1.08;
    } else if (w === 'snow') {
      cloudCover = 0.78 + 0.16 * inten;
      cloudDarkness = 0.22 + 0.12 * inten;
      sunDamp = 1.0 - 0.62 * inten;
      fogNear = 220 - 80 * inten;
      fogFar = 1400 - 450 * inten;
      snowCover = 0.45 + 0.55 * inten;
      exposureBoost = 0.96;
    } else if (w === 'fog') {
      cloudCover = 0.55 + 0.2 * inten;
      cloudDarkness = 0.15;
      sunDamp = 1.0 - 0.65 * inten;
      fogNear = 45 - 25 * inten;
      fogFar = 480 - 230 * inten;
    }

    // Sky uniforms
    skyMaterial.uniforms.uZenith.value.copy(kf.zenith);
    skyMaterial.uniforms.uHorizon.value.copy(kf.horizon);
    if (w === 'rain') {
      skyMaterial.uniforms.uZenith.value.lerp(new THREE.Color('#1f2630'), 0.55 * inten);
      skyMaterial.uniforms.uHorizon.value.lerp(new THREE.Color('#47525e'), 0.5 * inten);
    } else if (w === 'snow' || w === 'fog') {
      const overcastGray = new THREE.Color().lerpColors(
        new THREE.Color('#232c3b'),
        new THREE.Color('#cfd8e0'),
        1.0 - nightFactor,
      );
      skyMaterial.uniforms.uZenith.value.lerp(overcastGray, 0.55 * inten);
      skyMaterial.uniforms.uHorizon.value.lerp(overcastGray, 0.62 * inten);
    }
    skyMaterial.uniforms.uSunColor.value.copy(kf.sunColor);
    skyMaterial.uniforms.uSunDirection.value.copy(sunDir);
    skyMaterial.uniforms.uMoonDirection.value.copy(moonDir);
    skyMaterial.uniforms.uStarIntensity.value = nightFactor * (1.0 - Math.min(1, cloudCover * 1.1));
    skyMaterial.uniforms.uMoonVisibility.value = moonUpFactor;
    skyMaterial.uniforms.uCloudCover.value = cloudCover;
    skyMaterial.uniforms.uCloudDarkness.value = cloudDarkness;

    // Cloud tint picks up warm sunrise/sunset glow!
    const warmFactor = THREE.MathUtils.clamp(1.0 - Math.abs(sunElevDeg - 5) / 18, 0, 1) * (1 - nightFactor * 0.7);
    skyMaterial.uniforms.uCloudTint.value
      .set('#f6f8fc')
      .lerp(kf.sunColor, warmFactor * 0.55)
      .lerp(new THREE.Color('#24304a'), nightFactor * 0.82);

    // Directional Sun / Moon light
    if (sunElevDeg > -2.5) {
      sunLight.position.copy(sunDir).multiplyScalar(1800);
      sunLight.color.copy(kf.sunColor);
      sunLight.intensity = (0.4 + 2.75 * sunUpFactor) * sunDamp;
    } else {
      // Moonlight
      sunLight.position.copy(moonDir).multiplyScalar(1800);
      sunLight.color.setHex(0x8cb0e8);
      sunLight.intensity = 0.32 * moonUpFactor * sunDamp;
    }

    // Hemisphere light
    hemisphere.color.copy(kf.hemiSky);
    hemisphere.groundColor.copy(kf.hemiGround);
    hemisphere.intensity = kf.hemiIntensity * (w === 'rain' ? 0.85 : 1.0);

    // Fog
    scene.fog.color.copy(kf.fogColor);
    if (w === 'rain') scene.fog.color.lerp(new THREE.Color('#4a5562'), 0.45 * (1 - nightFactor * 0.7));
    if (w === 'snow' || w === 'fog') {
      const fogTint = nightFactor > 0.5 ? new THREE.Color('#1d2738') : new THREE.Color('#cbd5df');
      scene.fog.color.lerp(fogTint, 0.55 * inten);
    }
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;

    // Exposure & environment intensity
    renderer.toneMappingExposure = kf.exposure * exposureBoost;
    scene.environmentIntensity = kf.envIntensity * (w === 'rain' ? 1.15 : 1.0);

    // Realistic urban lighting schedule:
    // - Morning (05:00 -> 06:00): night lights fade out as people wake & sun rises (0 at 06:00 Dawn)
    // - Evening (16:45 -> 18:30): streetlamps, bars, shops & homes turn on (~0.65 at 17:45 Dusk, 1.0 by 18:30)
    const morningFade = h < 6.5 ? 1.0 - THREE.MathUtils.smoothstep(h, 5.0, 6.0) : 0.0;
    const eveningRamp = h >= 16.5 ? THREE.MathUtils.smoothstep(h, 16.75, 18.5) : 0.0;
    const urbanSchedule = Math.max(morningFade, eveningRamp);
    const glowFactor = Math.max(urbanSchedule, (w === 'rain' || w === 'fog') ? 0.38 * inten : 0);
    currentGlowFactor = glowFactor;
    if (glowFactor <= 0.04) {
      for (const pt of nightLights) pt.visible = false;
    } else {
      updateNearestLampLights(true);
    }
    if (lampPoolMesh) {
      lampPoolMesh.visible = glowFactor > 0.04;
      lampPoolMesh.material.opacity = glowFactor * 0.18;
    }

    // Update street materials for night emissives, wet rain reflections, and snow dusting
    if (streetMats) {
      const boostEmissive = (bucketOrArr, baseMult, nightMult) => {
        const list = Array.isArray(bucketOrArr) ? bucketOrArr : [bucketOrArr];
        for (const b of list) {
          const m = b?.material;
          const base = materialBaselines.get(m);
          if (!m || !base) continue;
          m.emissiveIntensity = THREE.MathUtils.lerp(base.emissiveIntensity * baseMult, nightMult, glowFactor);
        }
      };
      boostEmissive(streetMats.warmLamp, 0.8, 6.0);
      boostEmissive(streetMats.lanternRed, 0.7, 4.2);
      boostEmissive(streetMats.lanternWarm, 0.7, 4.2);
      boostEmissive(streetMats.vendFace, 0.75, 3.2);
      boostEmissive(streetMats.sleeveSigns, 0.8, 1.5);
      boostEmissive(streetMats.shotengaiBanner, 0.8, 1.5);
      boostEmissive(streetMats.konbiniSignBlue, 0.8, 2.2);
      boostEmissive(streetMats.konbiniSignGreen, 0.8, 2.0);
      // Randomly lit residential windows & commercial storefronts at night
      boostEmissive(streetMats.houseLightWalls, 0, 1.8);
      boostEmissive(streetMats.houseSlitWalls, 0, 1.8);
      boostEmissive(streetMats.houseDarkWalls, 0, 1.8);
      boostEmissive(streetMats.houseTileWalls, 0, 1.7);
      boostEmissive(streetMats.woodAccentWall, 0, 1.7);
      boostEmissive(streetMats.washikiLower, 0, 1.7);
      boostEmissive(streetMats.shikkuiWall, 0, 1.7);
      boostEmissive(streetMats.commUppers, 0, 2.0);
      boostEmissive(streetMats.shopIzakaya, 0, 1.35);
      boostEmissive(streetMats.shopRamen, 0, 1.35);
      boostEmissive(streetMats.shopKissaten, 0, 1.25);
      boostEmissive(streetMats.shopPharmacy, 0, 1.35);
      boostEmissive(streetMats.shopBookstore, 0, 1.2);
      boostEmissive(streetMats.shopKonbiniLawson, 0, 1.8);
      boostEmissive(streetMats.shopKonbiniFamima, 0, 1.8);

      // Wet roads & plazas in rain
      for (const key of ['road', 'lane', 'asphaltApron', 'sidewalk', 'plaza', 'plazaBorder']) {
        const m = streetMats[key]?.material;
        const base = materialBaselines.get(m);
        if (!m || !base) continue;
        m.roughness = THREE.MathUtils.lerp(base.roughness, 0.14, wetness);
        m.metalness = THREE.MathUtils.lerp(base.metalness, 0.28, wetness);
        m.envMapIntensity = THREE.MathUtils.lerp(base.envMapIntensity, 2.1, wetness);
        if (snowCover > 0) {
          m.color.copy(base.color).lerp(new THREE.Color('#dde5ee'), snowCover * 0.42);
        } else if (wetness > 0) {
          m.color.copy(base.color).multiplyScalar(1.0 - wetness * 0.28);
        } else {
          m.color.copy(base.color);
        }
      }

      // Snow dusting on roofs & trees
      const snowTargets = [
        streetMats.kawaraDark,
        streetMats.kawaraBrown,
        streetMats.galvaCharcoal,
        streetMats.galvaNavy,
        streetMats.slateRoof,
        streetMats.foliageFresh,
        streetMats.foliagePine,
        streetMats.hedge,
      ];
      for (const b of snowTargets) {
        const m = b?.material;
        const base = materialBaselines.get(m);
        if (!m || !base) continue;
        m.color.copy(base.color).lerp(new THREE.Color('#e6edf5'), snowCover * 0.62);
      }
    }

    // Lift interior lamp fixtures at night along the 24h cycle while keeping
    // all exported glTF glass and surface PBR properties untouched.
    // The Stack switches its 64 office/apartment circuits independently.
    const nightWeight = 1 - sunUpFactor;
    const lampBoost = 1 + 3.2 * nightWeight;
    const weatherOfficeFloor =
      (w === 'rain' || w === 'fog') && h >= 8.0 && h <= 17.5 ? 0.45 * inten : 0;
    for (const entry of placed) {
      if (!entry.lampMaterials) {
        entry.lampMaterials = [];
        entry.group.traverse((obj) => {
          if (!obj.isMesh) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (!mat) continue;
            const isStackFixture = /^Stack_(Light_|Mall_Glow|Ceiling_Slab)/.test(mat.name || '');
            if (!isStackFixture && mat.userData.lampBase === undefined && (mat.emissiveIntensity ?? 0) <= 1) {
              continue;
            }
            if (mat.userData.lampBase === undefined) {
              mat.userData.lampBase = mat.emissiveIntensity || 1.0;
            }
            if (!entry.lampMaterials.includes(mat)) {
              entry.lampMaterials.push(mat);
            }
          }
        });
      }
      for (const mat of entry.lampMaterials) {
        const stackIntensity = stackLampIntensity(mat.name, h, sunUpFactor, weatherOfficeFloor);
        if (stackIntensity !== null) {
          mat.emissiveIntensity = stackIntensity;
        } else {
          mat.emissiveIntensity = mat.userData.lampBase * lampBoost;
        }
      }
    }

    // Particle visibility & opacity
    rainMesh.visible = w === 'rain';
    rainMat.opacity = 0.22 + 0.36 * inten;
    snowMesh.visible = w === 'snow';
    snowMat.opacity = 0.45 + 0.45 * inten;

    // Update shadow map when sun/moon moves > 0.12h
    if (Math.abs(h - lastShadowHour) >= 0.12 || forceEnv) {
      renderer.shadowMap.needsUpdate = true;
      lastShadowHour = h;
    }

    bakeEnvironment(forceEnv);
  }

  // ------------------------------------------------------------------ per-frame tick
  let prevNow = performance.now();

  function update(now) {
    const dt = Math.min((now - prevNow) / 1000, 0.1);
    prevNow = now;

    skyMaterial.uniforms.uTime.value = now * 0.001;

    if (state.playing) {
      state.hour = (state.hour + dt * 0.32 * state.speed) % 24;
      applyAtmosphere();
    }
    updateNearestLampLights(false);

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    if (rainMesh.visible) {
      const fallSpeed = 38 + 18 * state.intensity;
      const windX = 3.5 * state.intensity;
      const t = now * 0.001;
      const pos = rainPositions;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const s3 = i * 3;
        const rx = (((rainSeeds[s3] + windX * t - cx) % BOX_W) + BOX_W * 1.5) % BOX_W - BOX_W * 0.5 + cx;
        const ry = (((rainSeeds[s3 + 1] - fallSpeed * t - cy) % BOX_H) + BOX_H * 1.5) % BOX_H - BOX_H * 0.5 + cy;
        const rz = (((rainSeeds[s3 + 2] - cz) % BOX_D) + BOX_D * 1.5) % BOX_D - BOX_D * 0.5 + cz;
        const p6 = i * 6;
        pos[p6] = rx;
        pos[p6 + 1] = ry;
        pos[p6 + 2] = rz;
        pos[p6 + 3] = rx - 0.18 * state.intensity;
        pos[p6 + 4] = ry + 1.55;
        pos[p6 + 5] = rz;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    if (snowMesh.visible) {
      const fallSpeed = 3.2 + 2.8 * state.intensity;
      const t = now * 0.001;
      const pos = snowPositions;
      for (let i = 0; i < SNOW_COUNT; i++) {
        const s3 = i * 3;
        const driftX = Math.sin(t * 0.9 + i * 0.37) * 1.8 + t * 1.2 * state.intensity;
        const driftZ = Math.cos(t * 0.7 + i * 0.53) * 1.4;
        const sx = (((snowSeeds[s3] + driftX - cx) % BOX_W) + BOX_W * 1.5) % BOX_W - BOX_W * 0.5 + cx;
        const sy = (((snowSeeds[s3 + 1] - fallSpeed * t - cy) % BOX_H) + BOX_H * 1.5) % BOX_H - BOX_H * 0.5 + cy;
        const sz = (((snowSeeds[s3 + 2] + driftZ - cz) % BOX_D) + BOX_D * 1.5) % BOX_D - BOX_D * 0.5 + cz;
        pos[s3] = sx;
        pos[s3 + 1] = sy;
        pos[s3 + 2] = sz;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
  }

  return {
    state,
    registerStreetMaterials,
    registerLampSpots,
    applyAtmosphere,
    update,
    setTime(hour, { forceEnv = true } = {}) {
      state.hour = ((hour % 24) + 24) % 24;
      applyAtmosphere({ forceEnv });
    },
    setWeather(weather, { forceEnv = true } = {}) {
      state.weather = weather;
      applyAtmosphere({ forceEnv });
    },
    setIntensity(intensity) {
      state.intensity = THREE.MathUtils.clamp(intensity, 0.15, 1.0);
      applyAtmosphere({ forceEnv: true });
    },
    setPlaying(playing) {
      state.playing = Boolean(playing);
    },
    setSpeed(speed) {
      state.speed = speed;
    },
  };
}
