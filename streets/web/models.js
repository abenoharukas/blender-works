// The models the street viewer can load. Every asset is the browser copy in
// `model_viewer/assets/*.optimized.glb`; `assets` in this folder is a symlink
// to `../../model_viewer/assets`, so the page works from the repository root
// or from `streets/web/`.
export const MODELS = [
  {
    id: 'stack',
    label: 'The Stack',
    meta: '301.8 m',
    asset: './assets/the_stack.optimized.glb?v=20261127e',
    yaw: Math.PI,
  },
  {
    id: 'abeno',
    label: 'Abeno Harukas',
    meta: '300 m',
    asset: './assets/abeno_harukas.optimized.glb',
    yaw: Math.PI,
  },
  {
    id: 'pompidou',
    label: 'Centre Pompidou',
    meta: 'facade study',
    asset: './assets/centre_pompidou.optimized.glb',
    yaw: Math.PI,
  },
  {
    id: 'house',
    label: 'Highrise House',
    meta: 'residential',
    asset: './assets/highrise_house.optimized.glb',
    yaw: Math.PI,
  },
  {
    id: 'office',
    label: 'Office Tower',
    meta: 'office study',
    asset: './assets/office_tower.optimized.glb',
    yaw: Math.PI,
  },
];

// Where a loaded model stands, in scene metres, front row first so the first
// pick is the one seen down the street. Three rows of three plots, spaced far
// enough apart that 300 m towers read as separate buildings.
export const PLOTS = [
  { x: 0, z: 60 },
  { x: -330, z: 60 },
  { x: 330, z: 60 },
  { x: -330, z: -280 },
  { x: 0, z: -280 },
  { x: 330, z: -280 },
  { x: -330, z: -620 },
  { x: 0, z: -620 },
  { x: 330, z: -620 },
];
export const PLOT_CLEAR = 158;

// The plaza slab the front row stands on: its top face is 0.12 m above the
// ground, and a model grounded at 0 would z-fight with it.
const PLAZA = { x0: -150, x1: 150, z0: -115, z1: 135, top: 0.12 };
export function groundHeightAt(x, z) {
  const onPlaza = x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1;
  return (onPlaza ? PLAZA.top : 0) + 0.02;
}
