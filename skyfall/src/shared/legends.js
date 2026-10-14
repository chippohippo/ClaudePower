// Legend roster. Ability behaviour is implemented in src/sim/abilities.js keyed by ability id;
// everything tunable (cooldowns, durations, radii) lives here.

export const LEGENDS = {
  jolt: {
    cls: 'dps',
    name: 'JOLT', role: 'Assault', color: '#ff7a1a',
    blurb: 'Adrenaline-junkie speedster. Lives in the fight, never stays still.',
    passive: { id: 'swiftmend', name: 'Swift Mend', desc: 'Regenerates health while out of combat (after 6s).' },
    tactical: { id: 'stim', name: 'Stim', desc: 'Move 40% faster for 6s. Costs 10 health.', cd: 1.2, dur: 6, cost: 10, mul: 1.4 },
    ultimate: { id: 'jumppad', name: 'Launch Pad', desc: 'Throw a pad that launches anyone high into the air.', cd: 90, dur: 60 },
  },
  phantom: {
    cls: 'dps',
    name: 'PHANTOM', role: 'Skirmisher', color: '#9b6bff',
    blurb: 'Interdimensional duelist. Slips out of bad fights and pulls the squad through.',
    passive: { id: 'whisper', name: 'Whispers', desc: 'Warned when an enemy is aiming at you.' },
    tactical: { id: 'phase', name: 'Phase Walk', desc: 'Enter the void for 2s: untouchable and fast, but unable to shoot.', cd: 22, dur: 2, mul: 1.5 },
    ultimate: { id: 'rift', name: 'Dimensional Rift', desc: 'Run up to 70m, then link a two-way portal for the squad.', cd: 120, dur: 60, range: 70 },
  },
  halo: {
    cls: 'support',
    name: 'HALO', role: 'Support', color: '#4fe39b',
    blurb: 'Combat medic. Keeps the squad standing and the loot flowing.',
    passive: { id: 'fieldmedic', name: 'Field Medic', desc: 'Revive teammates 2x faster. Heal items 25% faster.' },
    tactical: { id: 'drone', name: 'Heal Drone', desc: 'Deploy a drone that heals nearby allies 8 HP/s for 18s.', cd: 45, dur: 18, rate: 8, radius: 6 },
    ultimate: { id: 'carepkg', name: 'Care Package', desc: 'Call in a drop pod full of high-tier gear.', cd: 150 },
  },
  bastion: {
    cls: 'tank',
    name: 'BASTION', role: 'Defender', color: '#3fa9ff',
    blurb: 'Walking fortress. Makes his own cover and shells the enemy out of theirs.',
    passive: { id: 'fortified', name: 'Fortified', desc: 'Takes 15% less damage. Immune to slows.' },
    tactical: { id: 'dome', name: 'Dome of Protection', desc: 'Throw a dome that blocks all bullets for 12s.', cd: 30, dur: 12, radius: 5 },
    ultimate: { id: 'bombard', name: 'Bombardment', desc: 'Call a mortar barrage on a target area for 6s.', cd: 150, dur: 6, radius: 18 },
  },
  echo: {
    cls: 'support',
    name: 'ECHO', role: 'Recon', color: '#ffd23f',
    blurb: 'Bio-sonar hunter. Nothing hides from the pulse.',
    passive: { id: 'heartbeat', name: 'Heartbeat', desc: 'Senses enemies within 40m while aiming down sights.' },
    tactical: { id: 'pulse', name: 'Sonar Pulse', desc: 'Fire a cone pulse that reveals enemies through walls for 4s.', cd: 25, dur: 4, range: 60 },
    ultimate: { id: 'exhibit', name: 'Exhibit', desc: 'Create a 60m dome that reveals any enemy moving fast or shooting.', cd: 120, dur: 30, radius: 60 },
  },
  miasma: {
    cls: 'tank',
    name: 'MIASMA', role: 'Controller', color: '#9bd84a',
    blurb: 'Toxic engineer. Turns every building into a death trap.',
    passive: { id: 'gasvision', name: 'Gas Vision', desc: 'Sees enemies inside gas. Immune to own gas.' },
    tactical: { id: 'gastrap', name: 'Gas Trap', desc: 'Place a canister that vents gas when enemies approach.', cd: 20, dur: 60, radius: 6 },
    ultimate: { id: 'gasnade', name: 'Nox Grenade', desc: 'Throw a massive gas cloud that slows and damages.', cd: 120, dur: 15, radius: 14 },
  },
  volt: {
    cls: 'support',
    name: 'VOLTA', role: 'Controller', color: '#5ad1ff',
    blurb: 'Tactical veteran. Smoke, speed and thunder.',
    passive: { id: 'doubletime', name: 'Double Time', desc: 'Sprint 30% faster for 2s when shot at.' },
    tactical: { id: 'smoke', name: 'Smoke Launcher', desc: 'Fire a canister that bursts into a thick smoke wall.', cd: 20, dur: 14, radius: 8 },
    ultimate: { id: 'thunder', name: 'Rolling Thunder', desc: 'Call a line of artillery that creeps across the battlefield.', cd: 150, dur: 6 },
  },
  spectre: {
    cls: 'dps',
    name: 'SPECTRE', role: 'Skirmisher', color: '#ff4d6d',
    blurb: 'Jet-powered ace. Owns the vertical game.',
    passive: { id: 'jetpack', name: 'VTOL Jets', desc: 'Hold jump in the air to hover on your jetpack.' },
    tactical: { id: 'missiles', name: 'Missile Swarm', desc: 'Fire 12 mini-rockets that damage and stun.', cd: 30 },
    ultimate: { id: 'skyward', name: 'Skyward Dive', desc: 'Launch the whole squad into the sky and redeploy.', cd: 150 },
  },
  kodiak: {
    cls: 'tank',
    name: 'KODIAK', role: 'Vanguard', color: '#e8b04a',
    blurb: 'Armoured breacher. Walks the squad through the front door and holds it open.',
    passive: { id: 'juggernaut', name: 'Juggernaut', desc: 'Shields recharge 4/s after 5s out of combat. Immune to slows.' },
    tactical: { id: 'riotwall', name: 'Riot Wall', desc: 'Slam down a 6m energy wall that blocks bullets for 10s.', cd: 24, dur: 10, width: 6, height: 2.8 },
    ultimate: { id: 'charge', name: 'Breaching Charge', desc: 'Charge forward, smashing enemies aside for 35 damage and a slow.', cd: 100, dur: 0.5, speed: 24, damage: 35 },
  },
};

export const LEGEND_IDS = Object.keys(LEGENDS);

// Hero-shooter roles. Sixes squads aim for 2 Tank / 2 DPS / 2 Support (soft lock: any pick is
// allowed, the lobby nudges and bots fill whatever is missing). Role perks apply in Sixes only.
export const ROLES = {
  tank: { label: 'TANK', color: '#3fa9ff', perk: 'Takes 10% less damage. Creates space and peels for the squad.', dmgTaken: 0.9 },
  dps: { label: 'DPS', color: '#ff5a3a', perk: 'Reloads and swaps weapons 15% faster. Takes aggressive angles.', reload: 0.85 },
  support: { label: 'SUPPORT', color: '#4fe39b', perk: 'Heals 25% faster and revives 30% faster. Keeps the squad alive.', heal: 0.75, revive: 1.3 },
};
export const ROLE_IDS = ['tank', 'dps', 'support'];

// Role targets for a squad of the given size (Sixes = 2/2/2; smaller squads trim DPS first).
export function roleTargets(size) {
  const t = { tank: 0, dps: 0, support: 0 };
  const order = ['tank', 'support', 'dps', 'tank', 'support', 'dps'];
  for (let i = 0; i < size; i++) t[order[i % order.length]]++;
  return t;
}

export function legendsOfRole(role) {
  return LEGEND_IDS.filter((id) => LEGENDS[id].cls === role);
}
