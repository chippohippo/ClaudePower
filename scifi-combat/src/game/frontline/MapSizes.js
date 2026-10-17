// MapSizes: one battlefield per match size, each built for its player count (a tight
// close-quarters fight at 4v4, Battlefront scale at 64v64, the Extreme Warfront at 200v200).
// FrontlineMap.generate() takes one of these.
//
//  * sectors: HQ | line sectors | HQ along X; `lanes` are the Z positions of each line sector's
//    capture points (one point per lane). The middle sector starts neutral.
//  * trenches: a WW1 fire trench (zigzag bays, sandbag parapets, communication trenches back to
//    the rear, dugouts) along every boundary between line sectors, wire belts in front of them.
//    Bay, jog and exit spacing are even metres: the trench stays on the 2 m nav grid.
//  * villages: ruined buildings with real rooms and doorways (squads sweep and clear them),
//    placed around the listed sectors' points.
//  * craters: shell holes per hectare of no-man's-land (the neutral middle gets the most).
//  * match: tickets per player, reinforcement waves, capture and time limits, squad size, and how
//    many positions each team may dig in (Fortify).
//  * support: each team's field guns ([kind, count]: howitzer, rockets, at) in its artillery park,
//    supply trucks at its HQ dump (leaving `spacing` s apart, if set), and the supply economy
//    (Logistics): what the HQ produces per minute, starting stock at the HQ and the forward depot,
//    and their capacities. null = no artillery or logistics (the 4v4 skirmish).

const sector = (x0, x1, lanes = null) => ({ x0, x1, lanes, kind: lanes ? 'line' : 'hq' });

export const MAP_SIZES = {
  '4v4': {
    name: 'Outpost', players: 8, minX: -130, minZ: -60, width: 260, depth: 120, terrainAmp: 2.2,
    sectors: [sector(-130, -100), sector(-100, -34, [0]), sector(-34, 34, [0]), sector(34, 100, [0]), sector(100, 130)],
    pointRadius: 7,
    trenches: { bay: 8, jog: 4, comms: 1, dugouts: 1, wire: 0.5, exits: 16 },
    villages: [1, 2, 3], ruinsPerVillage: [4, 6], craters: 6,
    scatterPerHa: 9, structures: 0, pads: [],
    match: { ticketsPerPlayer: 10, waveInterval: 5, captureTime: 8, secureTime: 3, timeLimit: 600, squadSize: 4, fortCap: 8 },
    support: null,
  },
  '12v12': {
    name: 'Ridgeline', players: 24, minX: -260, minZ: -110, width: 520, depth: 220, terrainAmp: 4.5,
    sectors: [sector(-260, -210), sector(-210, -70, [-50, 50]), sector(-70, 70, [-50, 50]), sector(70, 210, [-50, 50]), sector(210, 260)],
    pointRadius: 8,
    trenches: { bay: 10, jog: 4, comms: 2, dugouts: 2, wire: 0.55, exits: 22 },
    villages: [2], ruinsPerVillage: [6, 9], craters: 9,
    scatterPerHa: 11, structures: 1, pads: [['hoverbike', 1]],
    match: { ticketsPerPlayer: 7, waveInterval: 6, captureTime: 10, secureTime: 3, timeLimit: 900, squadSize: 4, fortCap: 16 },
    support: { guns: [['howitzer', 1], ['at', 1]], trucks: 1, production: 70, hqStart: 300, frontStart: 180, hqCap: 1200, frontCap: 400 },
  },
  '32v32': {
    name: 'Valley', players: 64, minX: -450, minZ: -180, width: 900, depth: 360, terrainAmp: 6.5,
    sectors: [
      sector(-450, -380), sector(-380, -228, [-70, 70]), sector(-228, -76, [-110, 0, 110]), sector(-76, 76, [-110, 0, 110]),
      sector(76, 228, [-110, 0, 110]), sector(228, 380, [-70, 70]), sector(380, 450),
    ],
    pointRadius: 9,
    trenches: { bay: 10, jog: 4, comms: 2, dugouts: 3, wire: 0.6, exits: 26 },
    villages: [2, 4], ruinsPerVillage: [5, 8], craters: 8,
    scatterPerHa: 12, structures: 2, pads: [['tank', 1], ['hoverbike', 2]],
    match: { ticketsPerPlayer: 6, waveInterval: 6, captureTime: 10, secureTime: 3, timeLimit: 1500, squadSize: 4, fortCap: 30 },
    support: { guns: [['howitzer', 2], ['rockets', 1], ['at', 2]], trucks: 2, production: 130, hqStart: 450, frontStart: 260, hqCap: 2000, frontCap: 600 },
  },
  '64v64': {
    name: 'Frontline', players: 128, minX: -700, minZ: -260, width: 1400, depth: 520, terrainAmp: 9,
    sectors: [
      sector(-700, -610), sector(-610, -436, [-90, 90]), sector(-436, -262, [-150, 0, 150]), sector(-262, -88, [-150, 0, 150]),
      sector(-88, 88, [-150, 0, 150]),
      sector(88, 262, [-150, 0, 150]), sector(262, 436, [-150, 0, 150]), sector(436, 610, [-90, 90]), sector(610, 700),
    ],
    pointRadius: 9,
    trenches: { bay: 12, jog: 4, comms: 3, dugouts: 4, wire: 0.6, exits: 30 },
    villages: [3, 5], ruinsPerVillage: [6, 9], craters: 8,
    scatterPerHa: 11, structures: 3, pads: [['tank', 2], ['hoverbike', 3]],
    match: { ticketsPerPlayer: 5, waveInterval: 7, captureTime: 10, secureTime: 3, timeLimit: 2100, squadSize: 4, fortCap: 50 },
    support: { guns: [['howitzer', 4], ['rockets', 2], ['at', 3]], trucks: 3, production: 200, hqStart: 600, frontStart: 320, hqCap: 3000, frontCap: 800 },
  },
  // Extreme Warfront: 400 soldiers along a 2.6 km front, eleven line sectors and ten trench
  // lines between the HQs, batteries of guns, a stream of supply trucks on a kilometre-long
  // haul. An hour of war.
  '200v200': {
    name: 'Extreme Warfront', players: 400, minX: -1300, minZ: -440, width: 2600, depth: 880, terrainAmp: 11,
    sectors: [
      sector(-1300, -1200), sector(-1200, -982, [-200, 0, 200]),
      ...[-982, -764, -546, -328, -110, 110, 328, 546, 764].map((x0, i, a) => sector(x0, a[i + 1] ?? 982, [-300, -100, 100, 300])),
      sector(982, 1200, [-200, 0, 200]), sector(1200, 1300),
    ],
    pointRadius: 10,
    trenches: { bay: 12, jog: 4, comms: 4, dugouts: 5, wire: 0.6, exits: 30 },
    villages: [3, 5, 7, 9], ruinsPerVillage: [6, 9], craters: 9,
    scatterPerHa: 10, structures: 4, pads: [['tank', 4], ['hoverbike', 5]],
    match: { ticketsPerPlayer: 4, waveInterval: 8, captureTime: 12, secureTime: 4, timeLimit: 3600, squadSize: 4, fortCap: 120 },
    support: { guns: [['howitzer', 8], ['rockets', 4], ['at', 6]], trucks: 10, spacing: 14, production: 560, hqStart: 1500, frontStart: 1200, hqCap: 6000, frontCap: 2400 },
  },
};

/** The profile for a match size (or the one built for a player count). */
export function mapSizeFor(size = null, players = null) {
  if (size && MAP_SIZES[size]) return { id: size, ...MAP_SIZES[size] };
  const n = players ?? 64;
  const id = n <= 8 ? '4v4' : n <= 24 ? '12v12' : n <= 64 ? '32v32' : n <= 128 ? '64v64' : '200v200';
  return { id, ...MAP_SIZES[id] };
}
