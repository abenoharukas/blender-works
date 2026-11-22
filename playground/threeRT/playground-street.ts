// Playground (ThreeRT interactive edition): the procedural Japanese streetscape + The Stack tower running inside
// ThreeRT's Rust path-traced viewport (`threert-render play`) with:
//   - 24-hour Time-of-Day cycle (`SkyAtmosphere` dynamic sky + sun + moon + night streetlamps + auto exposure)
//   - Weather simulation (Clear / Cloudy / Rain with `RainCurtain` + `wetLayer()` puddles / Fog)
//   - 4 Camera presets (Street / Shotengai / Ikkodate / Overview)
//   - Interactive `egui` HUD panel via `@threert/gameplay` (`hud.set` + `hud.choose`) and keyboard shortcuts
//
// Bundle & run from blender-works:
//   npm run rt:play
import {
  Color,
  DirectionalLight,
  ExponentialHeightFog,
  GLTFModel,
  PerspectiveCamera,
  PointLight,
  RainCurtain,
  Scene,
  SkyAtmosphere,
  wetLayer,
} from "@threert/scene";
import { defineGame, host, hud, type FrameContext } from "@threert/gameplay";
import tape from "./playground-scene.json";

type Tape = typeof tape;
type WeatherId = "clear" | "cloudy" | "rain" | "fog";
type ViewId = "street" | "shotengai" | "ikkodate" | "overview";

interface State {
  hour: number;
  hourSeq: number;
  playing: boolean;
  speed: number;
  weather: WeatherId;
  view: ViewId;
  viewSeq: number;
}

const TIME_PRESETS = [
  { id: "dawn", label: "朝阳 06:00", hour: 6.0 },
  { id: "morning", label: "上午 09:30", hour: 9.5 },
  { id: "noon", label: "正午 12:30", hour: 12.5 },
  { id: "dusk", label: "傍晚 17:45", hour: 17.75 },
  { id: "blue", label: "蓝调 18:45", hour: 18.75 },
  { id: "night", label: "黑夜 22:30", hour: 22.5 },
] as const;

const WEATHERS: { id: WeatherId; label: string; cloud: number; rain: number; fogDensity: number; fogIntensity: number }[] = [
  { id: "clear", label: "晴朗 Clear", cloud: 0.12, rain: 0.0, fogDensity: 0.00002, fogIntensity: 4 },
  { id: "cloudy", label: "多云 Cloudy", cloud: 0.78, rain: 0.0, fogDensity: 0.00005, fogIntensity: 8 },
  { id: "rain", label: "下雨 Rain", cloud: 0.94, rain: 0.85, fogDensity: 0.00018, fogIntensity: 14 },
  { id: "fog", label: "大雾 Fog", cloud: 0.58, rain: 0.0, fogDensity: 0.0014, fogIntensity: 28 },
];

const VIEWS: Record<ViewId, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  street: { label: "街道 Street", pos: [4.9, 1.7, 438], target: [0, 120, 90] },
  shotengai: { label: "商店街 Shotengai", pos: [3.6, 8.8, 366], target: [-12, 4.6, 308] },
  ikkodate: { label: "住宅区 Ikkodate", pos: [38, 3.5, 386.8], target: [106, 3.1, 385.8] },
  overview: { label: "俯瞰 Overview", pos: [560, 410, 790], target: [0, 95, -210] },
};

const VIEW_ORDER: ViewId[] = ["street", "shotengai", "ikkodate", "overview"];

function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function phaseLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5.0 && h < 7.0) return "朝阳 Sunrise";
  if (h >= 7.0 && h < 11.0) return "上午 Morning";
  if (h >= 11.0 && h < 15.5) return "正午 Midday";
  if (h >= 15.5 && h < 17.2) return "午后 Afternoon";
  if (h >= 17.2 && h < 18.45) return "傍晚 Sunset";
  if (h >= 18.45 && h < 19.6) return "蓝调 Blue Hour";
  return "黑夜 Night";
}

function lerpKeys(x: number, keys: [number, number][]): number {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [x1, y1] = keys[i];
    const [x0, y0] = keys[i - 1];
    if (x <= x1) {
      const u = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1][1];
}

// Physically-paced solar arc: 06:00 sunrise (+1.8°), 12:30 noon (+52°),
// 17:45 golden sunset (+1.6° in the west), 18:45 civil twilight blue hour (-3.2°), 22:30 night (-28°).
function sunAnglesAt(hour: number): { elevation: number; azimuth: number } {
  const h = ((hour % 24) + 24) % 24;
  const elevation = lerpKeys(h, [
    [0.0, -30.0],
    [5.25, -3.5],
    [6.0, 1.8],
    [9.5, 34.0],
    [12.5, 52.0],
    [16.0, 22.0],
    [17.75, 1.6],
    [18.75, -3.2],
    [20.0, -14.0],
    [22.5, -28.0],
    [24.0, -30.0],
  ]);
  const azimuth = lerpKeys(h, [
    [0.0, 180.0],
    [6.0, 105.0],
    [9.5, 55.0],
    [12.5, 8.0],
    [16.0, -60.0],
    [17.75, -110.0],
    [18.75, -122.0],
    [24.0, -180.0],
  ]);
  return { elevation, azimuth };
}

// Calibrated to SkyAtmosphere + 100,000 lux sun (matching games/tokyo/tokyo-tod.game.ts):
// Noon ~13.8, Golden sunset (+1.6°) ~10.6, Blue hour (-3.2°) ~7.4, Night (-28°) ~4.2.
function evAt(elevation: number): number {
  return lerpKeys(elevation, [
    [-14, 4.2],
    [-6, 5.6],
    [-3.2, 7.4],
    [0, 9.8],
    [1.6, 10.6],
    [5, 11.8],
    [12, 13.0],
    [25, 13.8],
  ]);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function nightGlowFactor(hour: number, weather: WeatherId): number {
  const h = ((hour % 24) + 24) % 24;
  const morningFade = h < 6.5 ? 1.0 - smoothstep(5.0, 6.0, h) : 0.0;
  const eveningRamp = h >= 16.5 ? smoothstep(16.75, 18.5, h) : 0.0;
  const schedule = Math.max(morningFade, eveningRamp);
  return Math.max(schedule, weather === "rain" || weather === "fog" ? 0.35 : 0);
}

const data = tape as Tape;

// Frame-local mutable state (never mutate the frozen `f.state` inside `frame()`).
let liveHour = 17.75;
let syncedHourSeq = 0;
let syncedViewSeq = 0;
let currentRain = 0;
let currentCloud = 0.12;
let currentFogDensity = 0.00002;
let currentFogIntensity = 4;

// Route clicks from the native egui HUD panel (`hud.choose`) into transactional handlers via `world.emit`.
host.on("hud.choose", (m, world) => {
  if (m.item === "time_menu") {
    if (m.row === 0) world.emit("togglePlay", {});
    else if (m.row === 1) world.emit("stepHour", { delta: -1, base: liveHour });
    else if (m.row === 2) world.emit("stepHour", { delta: 1, base: liveHour });
    else {
      const preset = TIME_PRESETS[m.row - 3];
      if (preset) world.emit("setHour", { hour: preset.hour });
    }
  } else if (m.item === "weather_menu") {
    const w = WEATHERS[m.row];
    if (w) world.emit("setWeather", { weather: w.id });
  } else if (m.item === "view_menu") {
    const vId = VIEW_ORDER[m.row];
    if (vId) world.emit("setView", { view: vId });
  }
});

function applyLighting(
  sun: DirectionalLight,
  moon: DirectionalLight | undefined,
  camera: PerspectiveCamera,
  pointLights: { obj: PointLight; baseIntensity: number }[],
  hour: number,
  weather: WeatherId,
) {
  const { elevation, azimuth } = sunAnglesAt(hour);
  sun.setSunAngles(elevation, azimuth);
  // Keep sun at physical 100 klx above atmosphere; SkyAtmosphere attenuates & reddens it naturally at low elevation.
  sun.intensity = 100000;

  if (moon) {
    const moonElev = Math.max(18, -elevation * 0.85);
    moon.setSunAngles(moonElev, azimuth + 165);
    moon.intensity = elevation < -5 ? 1.2 : 0;
  }

  const weatherEvShift = weather === "rain" ? -0.7 : weather === "cloudy" ? -0.35 : 0;
  camera.setManualExposure(evAt(elevation) + weatherEvShift);

  const glow = nightGlowFactor(hour, weather);
  for (const pl of pointLights) {
    pl.obj.intensity = pl.baseIntensity * (glow * 1.6);
  }
}

function pushHud(state: Readonly<State>, displayHour: number) {
  const wInfo = WEATHERS.find((w) => w.id === state.weather) ?? WEATHERS[0];
  const vInfo = VIEWS[state.view];
  const timeRows = [
    [state.playing ? "暂停时间" : "播放时间"],
    ["-1 小时"],
    ["+1 小时"],
    ...TIME_PRESETS.map((p) => [p.label]),
  ];
  const weatherRows = WEATHERS.map((w) => [w.label]);
  const viewRows = VIEW_ORDER.map((id) => [VIEWS[id].label]);

  const timeHighlight = TIME_PRESETS.findIndex((p) => Math.abs(displayHour - p.hour) < 0.35);
  const weatherHighlight = WEATHERS.findIndex((w) => w.id === state.weather);
  const viewHighlight = VIEW_ORDER.indexOf(state.view);

  hud.set({
    items: [
      { type: "text", anchor: "top-left", label: "时间", text: `${formatHour(displayHour)} · ${phaseLabel(displayHour)}`, tone: "accent", size: "large" },
      { type: "text", anchor: "top-left", label: "天气", text: wInfo.label, tone: state.weather === "rain" ? "warn" : "default" },
      { type: "text", anchor: "top-left", label: "机位", text: vInfo.label, tone: "dim" },
      {
        type: "table",
        anchor: "top-right",
        id: "time_menu",
        title: "日夜循环 Time",
        columns: ["操作"],
        rows: timeRows,
        selectable: true,
        ...(timeHighlight >= 0 ? { highlight: timeHighlight + 3 } : {}),
      },
      {
        type: "table",
        anchor: "top-right",
        id: "weather_menu",
        title: "天气 Weather",
        columns: ["模式"],
        rows: weatherRows,
        selectable: true,
        highlight: weatherHighlight,
      },
      {
        type: "table",
        anchor: "top-right",
        id: "view_menu",
        title: "机位 Camera",
        columns: ["视角"],
        rows: viewRows,
        selectable: true,
        highlight: viewHighlight,
      },
    ],
  });
}

export default defineGame<State>({
  state: {
    hour: 17.75,
    hourSeq: 0,
    playing: false,
    speed: 1,
    weather: "clear",
    view: "street",
    viewSeq: 0,
  },
  keys: {},
  setup() {
    liveHour = 17.75;
    syncedHourSeq = 0;
    syncedViewSeq = 0;
    currentRain = 0;
    currentCloud = 0.12;
    currentFogDensity = 0.00002;
    currentFogIntensity = 4;

    const scene = new Scene();

    const street = new GLTFModel("assets/playground_street_rt.glb", {
      functions: {
        road: wetLayer({ wet: 1, puddles: 1, puddleScale: 8 }),
        lane: wetLayer({ wet: 1, puddles: 0.7, puddleScale: 8 }),
        asphalt: wetLayer({ wet: 1, puddles: 0.85, puddleScale: 7 }),
        sidewalk: wetLayer({ wet: 0.85, puddles: 0.45, puddleScale: 6 }),
        plaza: wetLayer({ wet: 0.9, puddles: 0.8, puddleScale: 9 }),
      },
    });
    street.name = "playground_street";
    scene.add(street);

    const tower = new GLTFModel("assets/the_stack_final.glb");
    tower.name = "the_stack";
    tower.position.set(data.tower.pos[0], data.tower.pos[1], data.tower.pos[2]);
    tower.rotation.y = data.tower.yaw;
    scene.add(tower);

    const sun = new DirectionalLight(0xfff4e8, 95000);
    sun.name = "sun";
    scene.add(sun);

    const moon = new DirectionalLight(0x9ab8f0, 0);
    moon.name = "moon";
    scene.add(moon);

    const pointLights: { obj: PointLight; baseIntensity: number }[] = [];
    for (const [i, l] of data.points.entries()) {
      const baseIntensity = l.intensity * 90;
      const p = new PointLight(parseInt(l.color, 16), baseIntensity, l.distance, 2);
      p.name = `playground_light_${i}`;
      p.position.set(l.pos[0], l.pos[1], l.pos[2]);
      p.radius = l.intensity > 1000 ? 1.2 : 0.08;
      scene.add(p);
      pointLights.push({ obj: p, baseIntensity });
    }

    const sky = new SkyAtmosphere({
      sun,
      dynamic: true,
      aerialPerspective: 1,
      glow: new Color().setRGB(0.85, 0.95, 1.45),
      glowIntensity: 0.08,
      horizonGlow: new Color().setRGB(1.25, 0.9, 0.82),
      horizonGlowIntensity: 0.55,
      horizonGlowHeight: 5.0 * (Math.PI / 180),
    });
    // Tokyo-like Mie haze (10x) produces warm golden-orange sunset scattering near the horizon.
    sky.mieScale = 10;
    scene.environment = sky;

    const fog = new ExponentialHeightFog(0.00002, 0.0004, parseInt(data.fog.color, 16));
    fog.intensity = 4;
    scene.fog = fog;

    scene.rain = 0;
    scene.cloudCover = 0.12;
    scene.add(new RainCurtain());

    const v0 = VIEWS.street;
    const camera = new PerspectiveCamera(data.camera.fov, 16 / 9, 1.5, 24000);
    camera.name = "camera";
    camera.position.set(...v0.pos);
    camera.lookAt(...v0.target);
    scene.add(camera);

    applyLighting(sun, moon, camera, pointLights, 17.75, "clear");

    return {
      scene,
      camera,
      options: {
        name: "playground-street",
        width: 1280,
        height: 720,
        preset: "cinematic" as const,
        overrides: {
          post: {
            bloom: { intensity: 0.45, threshold: 1.2, sizeScale: 5 },
            vignette: 0.25,
          },
        },
      },
    };
  },
  handlers: {
    togglePlay(tx) {
      tx.state.playing = !tx.state.playing;
    },
    prevHour(tx) {
      tx.state.hour = (tx.state.hour - 1 + 24) % 24;
      tx.state.hourSeq += 1;
    },
    nextHour(tx) {
      tx.state.hour = (tx.state.hour + 1) % 24;
      tx.state.hourSeq += 1;
    },
    stepHour(tx, ev: { delta?: number; base?: number }) {
      const base = typeof ev?.base === "number" ? ev.base : tx.state.hour;
      const delta = typeof ev?.delta === "number" ? ev.delta : 0;
      tx.state.hour = ((base + delta) % 24 + 24) % 24;
      tx.state.hourSeq += 1;
    },
    setHour(tx, ev: { hour?: number }) {
      if (typeof ev?.hour === "number") {
        tx.state.playing = false;
        tx.state.hour = ((ev.hour % 24) + 24) % 24;
        tx.state.hourSeq += 1;
      }
    },
    cycleWeather(tx) {
      const idx = WEATHERS.findIndex((w) => w.id === tx.state.weather);
      tx.state.weather = WEATHERS[(idx + 1) % WEATHERS.length].id;
    },
    setWeather(tx, ev: { weather?: WeatherId }) {
      if (ev?.weather && WEATHERS.some((w) => w.id === ev.weather)) {
        tx.state.weather = ev.weather;
      }
    },
    weatherClear(tx) {
      tx.state.weather = "clear";
    },
    weatherCloudy(tx) {
      tx.state.weather = "cloudy";
    },
    weatherRain(tx) {
      tx.state.weather = "rain";
    },
    weatherFog(tx) {
      tx.state.weather = "fog";
    },
    setView(tx, ev: { view?: ViewId }) {
      if (ev?.view && VIEWS[ev.view]) {
        tx.state.view = ev.view;
        tx.state.viewSeq += 1;
      }
    },
    viewStreet(tx) {
      tx.state.view = "street";
      tx.state.viewSeq += 1;
    },
    viewShotengai(tx) {
      tx.state.view = "shotengai";
      tx.state.viewSeq += 1;
    },
    viewIkkodate(tx) {
      tx.state.view = "ikkodate";
      tx.state.viewSeq += 1;
    },
    viewOverview(tx) {
      tx.state.view = "overview";
      tx.state.viewSeq += 1;
    },
  },
  frame(f: FrameContext<State>) {
    if (f.snap || f.state.hourSeq !== syncedHourSeq) {
      liveHour = f.state.hour;
      syncedHourSeq = f.state.hourSeq;
    } else if (f.state.playing) {
      liveHour = (liveHour + f.dt * 0.4 * f.state.speed) % 24;
    }

    const sun = f.object("sun") as DirectionalLight;
    const moon = f.object("moon") as DirectionalLight | undefined;
    const pointLights = data.points
      .map((l, i) => ({
        obj: f.object(`playground_light_${i}`) as PointLight,
        baseIntensity: l.intensity * 90,
      }))
      .filter((p) => Boolean(p.obj));

    applyLighting(sun, moon, f.camera, pointLights, liveHour, f.state.weather);

    const wCfg = WEATHERS.find((w) => w.id === f.state.weather) ?? WEATHERS[0];
    const alpha = f.snap ? 1 : Math.min(1, f.dt / 0.8);
    const approach = (cur: number, target: number, eps: number) =>
      Math.abs(target - cur) <= eps ? target : cur + (target - cur) * alpha;
    currentCloud = approach(currentCloud, wCfg.cloud, 1e-4);
    currentRain = approach(currentRain, wCfg.rain, 1e-4);
    currentFogDensity = approach(currentFogDensity, wCfg.fogDensity, 1e-7);
    currentFogIntensity = approach(currentFogIntensity, wCfg.fogIntensity, 1e-3);

    f.scene.cloudCover = currentCloud;
    f.scene.rain = currentRain;
    if (f.scene.fog) {
      f.scene.fog.density = currentFogDensity;
      f.scene.fog.intensity = currentFogIntensity;
    }

    if (f.state.viewSeq !== syncedViewSeq) {
      const targetView = VIEWS[f.state.view];
      f.camera.position.set(...targetView.pos);
      f.camera.lookAt(...targetView.target);
      syncedViewSeq = f.state.viewSeq;
    }

    pushHud(f.state, liveHour);
  },
});
