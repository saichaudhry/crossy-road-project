import {
  TILE, MIN_TILE, MAX_TILE, TILES_PER_ROW, WRAP_SPAN, WRAP_MIN_X, wrapX,
  SAFE_ROWS, FOREST, ROAD, RIVER, RAIL,
} from './constants.js';

// ---------------------------------------------------------------------------
// Terrain generation
//
// Rows are generated one at a time and never mutated afterwards (except for
// coins being collected), which keeps the world deterministic for a given
// seed. Traffic is *stateless*: an occupant stores where it was at t=0 and its
// position at any later time is a pure function of the elapsed clock. That
// removes drift, makes wrapping exact, and means nothing has to be simulated
// for rows the player cannot see.
// ---------------------------------------------------------------------------

const VEHICLES = {
  car:   { length: 62,  width: 34, height: 26, weight: 3 },
  taxi:  { length: 62,  width: 34, height: 26, weight: 1 },
  van:   { length: 82,  width: 36, height: 34, weight: 2 },
  truck: { length: 118, width: 36, height: 38, weight: 2 },
};

const CAR_COLOURS = [
  0xe4453a, 0x3d6ec9, 0x4bab5a, 0xf0b429, 0x9b59b6,
  0xef7f4b, 0x2fb8b0, 0xd94f8a, 0xf2f2f2, 0x3a3f4b,
];

/** 0 at the start of a run, 1 once the terrain is at full difficulty. */
export const difficultyAt = (row) => Math.min(1, Math.max(0, (row - SAFE_ROWS) / 220));

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Lay repeating objects around the wrap span so the spacing is exactly even
 * and the pattern is seamless when it wraps. Returns the period actually used.
 */
function layOut(length, gapTiles, rng, make) {
  const wanted = length + gapTiles * TILE;
  const count = Math.max(2, Math.round(WRAP_SPAN / wanted));
  const period = WRAP_SPAN / count;
  const jitter = Math.max(0, (period - length) * 0.18);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(make(WRAP_MIN_X + i * period + rng.range(-jitter, jitter), i));
  }
  return out;
}

function makeRoad(index, rng, ctx) {
  const d = difficultyAt(index);
  const spec = rng.weighted(
    Object.entries(VEHICLES).map(([kind, v]) => ({ ...v, kind, weight: v.weight })),
  );
  const direction = rng.chance(0.5) ? 1 : -1;
  const speed = rng.range(lerp(46, 104, d), lerp(78, 178, d));
  const gapTiles = rng.range(lerp(3.4, 1.9, d), lerp(5.2, 3.0, d));

  const occupants = layOut(spec.length, gapTiles, rng, (x0) => ({
    kind: spec.kind,
    x0,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    colour: spec.kind === 'taxi' ? 0xf5c243 : rng.pick(CAR_COLOURS),
    // Small per-vehicle look-and-feel variation.
    variant: rng.int(0, 2),
  }));

  return {
    index, type: ROAD, direction, speed, occupants,
    // A road row is "busy" if it is part of a multi-lane highway; the view uses
    // this to draw the dashed lane divider only between adjacent road rows.
    highwayBelow: ctx.previousType === ROAD,
  };
}

function makeRiver(index, rng) {
  const d = difficultyAt(index);
  const direction = rng.chance(0.5) ? 1 : -1;
  const speed = rng.range(lerp(30, 62, d), lerp(58, 104, d));
  const lily = rng.chance(0.14);

  if (lily) {
    // A stationary row of lily pads: a breather lane, but the pads are small.
    const occupants = layOut(TILE * 0.9, rng.range(1.4, 2.2), rng, (x0) => ({
      kind: 'lily', x0, length: TILE * 0.9, width: TILE * 0.9,
    }));
    return { index, type: RIVER, direction: 1, speed: 0, occupants, lily: true };
  }

  const lengthTiles = rng.int(2, 4);
  const gapTiles = rng.range(lerp(1.0, 1.5, d), lerp(1.6, 2.4, d));
  const occupants = layOut(lengthTiles * TILE, gapTiles, rng, (x0) => ({
    kind: 'log', x0, length: lengthTiles * TILE, width: TILE * 0.86,
    variant: rng.int(0, 2),
  }));

  return { index, type: RIVER, direction, speed, occupants, lily: false };
}

function makeRail(index, rng) {
  const d = difficultyAt(index);
  return {
    index, type: RAIL,
    direction: rng.chance(0.5) ? 1 : -1,
    speed: lerp(430, 720, d),
    carriages: rng.int(2, 4),
    period: rng.range(lerp(7.0, 4.8, d), lerp(10.0, 6.6, d)),
    phase: rng.range(0, 12),
    warnLead: 1.7,
    occupants: [],
  };
}

function makeForest(index, rng, ctx) {
  const d = difficultyAt(index);
  const trees = [];
  const density = index < SAFE_ROWS ? 0 : lerp(0.16, 0.34, d);
  const blocked = new Set();

  // `corridor` is a tile column that is guaranteed to stay clear on every
  // forest row, so the player can never be sealed in by a wall of trees.
  for (let tile = MIN_TILE; tile <= MAX_TILE; tile++) {
    if (tile === ctx.corridor || tile === ctx.corridor + ctx.corridorDrift) continue;
    if (index < SAFE_ROWS && Math.abs(tile) <= 1) continue;
    if (rng.next() < density) {
      trees.push({ tile, height: rng.int(1, 3) });
      blocked.add(tile);
    }
  }

  let coin = null;
  const free = [];
  for (let tile = MIN_TILE; tile <= MAX_TILE; tile++) {
    if (!blocked.has(tile)) free.push(tile);
  }
  if (index > SAFE_ROWS && rng.chance(0.3) && free.length) {
    coin = { tile: rng.pick(free), taken: false };
  }

  return { index, type: FOREST, trees, coin, blocked, occupants: [] };
}

/**
 * Decides what the next row should be. Terrain comes in short clusters
 * (a two-lane road, a three-log river) rather than being shuffled per row,
 * which is what makes the world read as a landscape instead of noise.
 */
function chooseType(index, rng, ctx) {
  if (index < SAFE_ROWS) return FOREST;
  if (ctx.remainingInCluster > 0) return ctx.clusterType;
  if (ctx.previousType === RAIL) return FOREST;   // always a breather after a train
  const d = difficultyAt(index);

  const options = [
    { type: FOREST, weight: ctx.previousType === FOREST ? 1.1 : 2.6 },
    { type: ROAD, weight: 3.4 + 1.4 * d },
    { type: RIVER, weight: 1.6 + 1.1 * d },
    { type: RAIL, weight: index > 12 ? 0.9 + 0.8 * d : 0 },
  ];
  return rng.weighted(options).type;
}

function clusterLength(type, rng, d) {
  if (type === ROAD) return rng.int(1, d > 0.4 ? 4 : 3);
  if (type === RIVER) return rng.int(1, 3);
  if (type === RAIL) return rng.chance(0.25) ? 2 : 1;
  return rng.int(1, 2);
}

export function createTerrain(rng) {
  const rows = new Map();
  let lowest = 0;      // the oldest index the generator has actually produced
  let highest = -1;    // the newest index, so generation always runs in order
  const ctx = {
    previousType: null,
    clusterType: FOREST,
    remainingInCluster: 0,
    corridor: 0,
    corridorDrift: 0,
  };

  function generate(index) {
    const d = difficultyAt(index);
    const type = chooseType(index, rng, ctx);
    if (ctx.remainingInCluster <= 0) {
      ctx.clusterType = type;
      ctx.remainingInCluster = clusterLength(type, rng, d);
    }
    ctx.remainingInCluster--;

    // Drift the guaranteed-open corridor so forests do not form a straight
    // hallway up the middle of the map.
    if (rng.chance(0.35)) {
      ctx.corridor = Math.min(MAX_TILE - 1, Math.max(MIN_TILE + 1, ctx.corridor + rng.int(-1, 1)));
    }
    ctx.corridorDrift = rng.chance(0.5) ? 1 : -1;

    let row;
    if (type === ROAD) row = makeRoad(index, rng, ctx);
    else if (type === RIVER) row = makeRiver(index, rng);
    else if (type === RAIL) row = makeRail(index, rng);
    else row = makeForest(index, rng, ctx);

    row.tint = (index % 2) === 0 ? 0 : 1;   // alternating grass/asphalt shade
    ctx.previousType = type;
    rows.set(index, row);
    lowest = Math.min(lowest, index);
    highest = Math.max(highest, index);
    return row;
  }

  /**
   * A row behind the pruned window. Re-running the generator there would both
   * hand back different terrain than the player already crossed and corrupt
   * the generator's running state, so those rows come back as plain grass.
   */
  function fallback(index) {
    const row = {
      index, type: FOREST, trees: [], coin: null,
      blocked: new Set(), occupants: [], tint: (index % 2) === 0 ? 0 : 1,
    };
    rows.set(index, row);
    return row;
  }

  return {
    rows,
    get(index) {
      const existing = rows.get(index);
      if (existing) return existing;
      if (index < lowest) return fallback(index);
      // Generation is sequential: fill any gap so cluster and corridor state
      // stays consistent.
      for (let i = highest + 1; i < index; i++) generate(i);
      return generate(index);
    },
    ensure(from, to) {
      for (let i = from; i <= to; i++) if (!rows.has(i)) this.get(i);
    },
    prune(before) {
      for (const key of rows.keys()) if (key < before) rows.delete(key);
      lowest = Math.max(lowest, before);
    },
  };
}

// --- Traffic queries -------------------------------------------------------

/** World X of a moving occupant at time `t` (seconds since the run started). */
export function occupantX(row, occ, t) {
  if (!row.speed) return occ.x0;
  return wrapX(occ.x0 + row.direction * row.speed * t);
}

/** Is a tile column blocked by a tree on this row? */
export function isBlocked(row, tile) {
  return row.type === FOREST && row.blocked?.has(tile);
}

/**
 * State of the train on a rail row at time `t`.
 * Trains are not wrapped like cars -- they run one pass at a time with a
 * warning light beforehand, so the player gets a fair tell.
 */
export function trainState(row, t) {
  const length = row.carriages * 96 + 60;
  const travel = WRAP_SPAN + length;
  const crossing = travel / row.speed;
  // Each cycle is: warning light, then the train, then quiet. Ordering it this
  // way means a train can never arrive before its own warning.
  const cycle = ((t + row.phase) % row.period + row.period) % row.period;
  const active = cycle >= row.warnLead && cycle < row.warnLead + crossing;
  const warning = cycle < row.warnLead + crossing;

  if (!active) return { active: false, warning, length, x: 0 };

  const travelled = (cycle - row.warnLead) * row.speed;
  const x = row.direction > 0
    ? WRAP_MIN_X - length / 2 + travelled
    : WRAP_MIN_X + WRAP_SPAN + length / 2 - travelled;
  return { active: true, warning: true, length, x };
}

export const rowBounds = () => ({ min: MIN_TILE, max: MAX_TILE, count: TILES_PER_ROW });
