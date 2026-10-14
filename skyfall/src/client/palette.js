import * as THREE from 'three';

// Friend/foe and damage colours. Everything that tells you "enemy", "ally", "health damage" or
// "headshot" reads from PAL, so a colourblind preset (Settings → Colour vision) recolours the
// whole game at once — like Apex's protanopia / deuteranopia / tritanopia modes.

export const PALETTES = {
  default: { enemy: '#ff3b30', enemyRim: '#ff4a2a', ally: '#33d6ff', allyRim: '#33d6ff', health: '#ff4d3a', head: '#ffd23f', label: 'Default' },
  protanopia: { enemy: '#ffb300', enemyRim: '#ffb300', ally: '#3d8bff', allyRim: '#3d8bff', health: '#ffb300', head: '#ffffff', label: 'Protanopia' },
  deuteranopia: { enemy: '#ff8a00', enemyRim: '#ff8a00', ally: '#2f74ff', allyRim: '#2f74ff', health: '#ff8a00', head: '#fff27a', label: 'Deuteranopia' },
  tritanopia: { enemy: '#ff2f6d', enemyRim: '#ff2f6d', ally: '#00c2a8', allyRim: '#00c2a8', health: '#ff2f6d', head: '#ffe14d', label: 'Tritanopia' },
};

export const PAL = { ...PALETTES.default };

// Team rim light on character models: a fresnel edge glow in the friend/foe colour, stronger at
// range where small silhouettes get lost against terrain. Shared uniforms, so switching the colour
// preset recolours every character live. Depth-tested: it never shows through walls.
export const RIM = {
  enemy: { color: { value: new THREE.Color(PAL.enemyRim) }, strength: { value: 0.85 } },
  ally: { color: { value: new THREE.Color(PAL.allyRim) }, strength: { value: 0.55 } },
};

const rimCache = new Map();
export function teamRim(obj, team) {
  const U = RIM[team];
  obj.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.transparent || o.userData.isHull) return;
    const src = o.material;
    const key = src.uuid + team;
    let m = rimCache.get(key);
    if (!m) {
      m = src.clone();
      const prev = src.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
        sh.uniforms.rimColor = U.color;
        sh.uniforms.rimStrength = U.strength;
        sh.fragmentShader = 'uniform vec3 rimColor;\nuniform float rimStrength;\n' + sh.fragmentShader.replace(
          '#include <opaque_fragment>',
          `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.2);
          float rimFar = mix(1.0, 1.9, smoothstep(25.0, 140.0, length(vViewPosition)));
          outgoingLight += rimColor * rimF * rimStrength * rimFar;
          #include <opaque_fragment>`);
      };
      const base = src.customProgramCacheKey ? src.customProgramCacheKey() : '';
      m.customProgramCacheKey = () => 'rim' + team + base;
      rimCache.set(key, m);
    }
    o.material = m;
  });
}

// Rim strength per art style: cel shading absorbs it, the clean PBR look needs a lighter touch
export function setRimStrength(enemyMul, comic) {
  RIM.enemy.strength.value = 0.85 * enemyMul * (comic ? 1 : 0.45);
  RIM.ally.strength.value = 0.55 * (comic ? 1 : 0.5);
}

export function applyPalette(name) {
  Object.assign(PAL, PALETTES[name] || PALETTES.default);
  const root = document.documentElement.style;
  root.setProperty('--enemy', PAL.enemy);
  root.setProperty('--ally', PAL.ally);
  root.setProperty('--health', PAL.health);
  root.setProperty('--head', PAL.head);
  RIM.enemy.color.value.set(PAL.enemyRim);
  RIM.ally.color.value.set(PAL.allyRim);
}
