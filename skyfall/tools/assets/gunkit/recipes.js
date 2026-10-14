// Gun recipes: parts from Firearms Kit 1.0, snapped by bounding box. Kit axes: +X = muzzle, +Y = up.
// place: [part, mat, opts]. opts.ref = earlier key (default 'base');
//   x: 'front' (part.min = ref.max), 'behind' (part.max = ref.min), 'start' (min=min), 'end' (max=max), 'mid'
//   y: 'above' (part.min = ref.max), 'below' (part.max = ref.min), 'top', 'bottom', 'mid'
//   dx/dy offsets in kit units, key: name for later refs, name: viewmodel part name (mag, pump, bolt, stock)
export const RECIPES = {
  talon: [
    ['body.005_19', 'm', { key: 'base' }],
    ['ar15_tophalf_23', 'm', { key: 'up', x: 'start', dx: -0.1, y: 'above', dy: -0.5 }],
    ['stock.007_26', 'p', { ref: 'up', x: 'behind', dx: 0.05, y: 'top', dy: -0.45, name: 'stock' }],
    ['hand_guard.002_25', 'p', { ref: 'up', x: 'start', dx: 2.0, y: 'bottom', dy: -0.1, key: 'hg' }],
    ['grip.012_119', 'p', { grip: true, ref: 'base', x: 'start', dx: 0.2, y: 'below', dy: 0.3 }],
    ['magazine_71', 'm', { ref: 'base', x: 'mid', dx: 0.5, y: 'below', dy: 0.5, name: 'mag' }],
    ['foregrip.001_17', 'p', { fore: true, ref: 'hg', x: 'mid', dx: 0.2, y: 'below', dy: 0.05 }],
  ],
  mauler: [
    ['body.006_4', 'p', { key: 'base' }],
    ['scar_tophalf_121', 'm', { key: 'up', x: 'start', dx: -0.1, y: 'above', dy: -0.45 }],
    ['grip.001_24', 'p', { grip: true, x: 'start', dx: 0.3, y: 'below', dy: 0.3 }],
    ['magazine.010_3', 'm', { x: 'mid', dx: 0.4, y: 'below', dy: 0.4, name: 'mag' }],
    ['stock.010_117', 'p', { ref: 'up', x: 'behind', dx: 0.05, y: 'top', dy: 0, name: 'stock' }],
    ['barrel_78', 'm', { fore: true, ref: 'up', x: 'front', dx: -0.6, y: 'mid', dy: -0.1, key: 'bar' }],
    ['muzzle.001_32', 'm', { ref: 'bar', x: 'front', dx: -0.1, y: 'mid' }],
  ],
  hornet: [ // AK-style compact SMG
    ['body.003_102', 'm', { key: 'base' }],
    ['ak_topcover_101', 'm', { x: 'start', dx: 0.05, y: 'top', dy: 0.1 }],
    ['grip.010_95', 'p', { grip: true, x: 'start', dx: 0.2, y: 'below', dy: 0.45 }],
    ['magazine.006_96', 'm', { x: 'end', dx: -0.35, y: 'below', dy: 0.3, name: 'mag' }],
    ['stock.002_103', 'm', { x: 'behind', dx: 0.1, y: 'top', dy: 0.05, name: 'stock' }],
    ['hand_guard.007_100', 'p', { fore: true, x: 'front', dx: -0.2, y: 'top', dy: -0.05, key: 'hg' }],
    ['#cyl', 'm', { r: 0.1, len: 1.0, ref: 'hg', x: 'front', dx: -0.3, y: 'top', dy: -0.15, key: 'bar' }],
    ['muzzle.006_82', 'm', { ref: 'bar', x: 'front', dx: -0.05, y: 'mid' }],
  ],
  volt: [
    ['body.002_132', 'p', { key: 'base' }],
    ['hand_guard.003_45', 'm', { fore: true, x: 'front', dx: -0.1, y: 'top', dy: -0.05, key: 'hg' }],
    ['muzzle.002_6', 'm', { ref: 'hg', x: 'front', dx: -0.1, y: 'mid' }],
    ['magazine.009_16', 'p', { x: 'start', dx: 0.6, y: 'below', dy: 0.9, name: 'mag' }],
    ['pic_rail_15', 'm', { x: 'mid', y: 'above', dy: -0.14 }],
  ],
  bulwark: [
    ['body_53', 'm', { key: 'base' }],
    ['grip.006_65', 'p', { grip: true, x: 'start', dx: 0.5, y: 'below', dy: 0.3 }],
    ['magazine.012_11', 'm', { x: 'mid', dx: -0.2, y: 'below', dy: 0.2, name: 'mag' }],
    ['stock.006_135', 'p', { x: 'behind', dx: 0.1, y: 'top', dy: 0.0, name: 'stock' }],
    ['barrel.002_44', 'm', { x: 'front', dx: -0.3, y: 'mid', dy: 0.1, key: 'bar' }],
    ['heat_shield_70', 'm', { fore: true, ref: 'bar', x: 'start', dx: 0.1, y: 'above', dy: -0.05 }],
    ['muzzle.003_58', 'm', { ref: 'bar', x: 'front', dx: -0.1, y: 'mid' }],
  ],
  breacher: [ // pump shotgun
    ['body.003_102', 'm', { key: 'base' }],
    ['grip.010_95', 'p', { grip: true, x: 'start', dx: 0.1, y: 'below', dy: 0.4 }],
    ['stock.005_136', 'w', { x: 'behind', dx: 0.15, y: 'top', dy: 0.0, name: 'stock' }],
    ['#cyl', 'm', { r: 0.2, len: 3.6, x: 'front', dx: -0.15, y: 'top', dy: -0.12, key: 'bar' }],
    ['#cyl', 'm', { r: 0.15, len: 3.0, ref: 'bar', x: 'start', y: 'below', dy: 0.06, key: 'tube' }],
    ['#cyl', 'w', { r: 0.24, len: 1.3, ref: 'tube', x: 'start', dx: 0.4, y: 'mid', fore: true, name: 'pump' }],
  ],
  scout: [
    ['body.001_13', 'm', { key: 'base' }],
    ['magazine.010_3', 'm', { x: 'mid', dx: 0.2, y: 'below', dy: 0.88, name: 'mag' }],
    ['stock.009_49', 'p', { x: 'behind', dx: 0.45, y: 'top', dy: -0.1, name: 'stock' }],
    ['hand_guard_56', 'p', { fore: true, x: 'front', dx: -0.1, y: 'top', dy: -0.35, key: 'hg' }],
    ['barrel.002_44', 'm', { ref: 'hg', x: 'front', dx: -0.6, y: 'mid', key: 'bar' }],
    ['muzzle.005_64', 'm', { ref: 'bar', x: 'front', dx: -0.1, y: 'mid' }],
    ['pic_rail.003_123', 'm', { x: 'end', dx: -0.2, y: 'above', dy: -0.05 }],
  ],
  sentinel: [
    ['stock.003_110', 'p', { key: 'base', name: 'stock' }],
    ['bolt_action.001_51', 'm', { key: 'act', x: 'front', dx: -0.6, y: 'top', dy: -0.15, name: 'bolt' }],
    ['trigger.002_31', 'p', { ref: 'act', x: 'start', dx: 0.6, y: 'below', dy: 0.05 }],
    ['grip.002_74', 'p', { grip: true, ref: 'act', x: 'start', dx: 0.0, y: 'below', dy: 0.1 }],
    ['magazine.002_35', 'm', { ref: 'act', x: 'mid', dx: 0.3, y: 'below', dy: 0.3, name: 'mag' }],
    ['hand_guard_56', 'p', { fore: true, ref: 'act', x: 'front', dx: -0.1, y: 'mid', dy: -0.1, key: 'hg' }],
    ['barrel.002_44', 'm', { ref: 'hg', x: 'front', dx: -0.8, y: 'mid', key: 'bar' }],
    ['muzzle_47', 'm', { ref: 'bar', x: 'front', dx: -0.1, y: 'mid' }],
    ['scope_mount_30', 'p', { ref: 'act', x: 'mid', dx: 0.3, y: 'above', dy: -0.1, key: 'mnt' }],
    ['scope.001_36', 'm', { ref: 'act', x: 'mid', dx: 0.3, y: 'above', dy: 0.0, name: 'scope' }],
  ],
  viper: [
    ['grip_137', 'm', { key: 'base' }],
    ['#box', 'm', { size: [2.1, 0.42, 0.34], x: 'end', dx: 0.25, y: 'top', dy: 0.17, key: 'slide' }],
    ['muzzle.004_59', 'm', { ref: 'slide', x: 'front', dx: -0.15, y: 'mid', dy: -0.04 }],
  ],
  p20: [
    ['grip.011_106', 'p', { key: 'base' }],
    ['#box', 'm', { size: [2.45, 0.38, 0.3], x: 'end', dx: 0.0, y: 'top', dy: 0.08, key: 'slide' }],
  ],
};

export const MATS = {
  m: { color: '#3a3e45', metalness: 0.75, roughness: 0.38 }, // gunmetal
  p: { color: '#1d1f23', metalness: 0.1, roughness: 0.7 }, // polymer
  w: { color: '#5b3b22', metalness: 0.0, roughness: 0.62 }, // wood
};
