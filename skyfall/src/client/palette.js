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

export function applyPalette(name) {
  Object.assign(PAL, PALETTES[name] || PALETTES.default);
  const root = document.documentElement.style;
  root.setProperty('--enemy', PAL.enemy);
  root.setProperty('--ally', PAL.ally);
  root.setProperty('--health', PAL.health);
  root.setProperty('--head', PAL.head);
}
