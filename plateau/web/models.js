// The models the PLATEAU Tokyo viewer can load into the excavated Nishi-Shinjuku
// residential plot. Every asset is the browser copy in `model_viewer/assets/*.optimized.glb`;
// `assets` in this folder is a symlink to `../../model_viewer/assets`.
export const MODELS = [
  {
    id: 'stack',
    label: 'The Stack',
    meta: '301.8 m',
    asset: './assets/the_stack.optimized.glb',
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

// Single excavated plot in Nishi-Shinjuku 5-chome (139.6852°E, 35.6915°N).
// 291 low-rise detached houses inside [-136..136] x [-110..120] m were removed
// from the PLATEAU LOD2 dataset so any of the 5 architectural studies can be
// switched in and out on the civic plaza slab.
export const PLOTS = [{ x: 0, z: 32, code: 'SHINJUKU-01' }];

export const EXCAVATED_BOUNDS = {
  x0: -136,
  x1: 136,
  z0: -110,
  z1: 120,
};

const PLAZA = {
  x0: EXCAVATED_BOUNDS.x0,
  x1: EXCAVATED_BOUNDS.x1,
  z0: EXCAVATED_BOUNDS.z0,
  z1: EXCAVATED_BOUNDS.z1,
  top: 0.24,
};

export function groundHeightAt(x, z) {
  const onPlaza = x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1;
  return (onPlaza ? PLAZA.top : 0) + 0.08;
}
