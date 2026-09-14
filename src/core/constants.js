// World geometry ------------------------------------------------------------
// The world is a grid. `tile` is the lateral axis (screen left/right, world X)
// and `row` is the forward axis (world -Z, so a bigger row index is further
// "up" the screen). Everything else is derived from these two numbers.

export const TILE = 42;              // edge length of one grid cell, in world units
export const MIN_TILE = -5;          // playable left edge (inclusive)
export const MAX_TILE = 5;           // playable right edge (inclusive)
export const TILES_PER_ROW = MAX_TILE - MIN_TILE + 1;

/** World X of the centre of a tile column. */
export const tileToX = (tile) => tile * TILE;
/** Nearest tile column to a world X. */
export const xToTile = (x) => Math.round(x / TILE);
/** World Z of the centre of a row (forward is -Z). */
export const rowToZ = (row) => -row * TILE;

// How far off the playable strip traffic travels before it wraps around. The
// wrap span is wider than the visible strip so vehicles enter and leave the
// screen instead of popping in at the edge.
export const WRAP_MARGIN_TILES = 7;
export const WRAP_SPAN = (TILES_PER_ROW + 2 * WRAP_MARGIN_TILES) * TILE;
export const WRAP_MIN_X = (MIN_TILE - WRAP_MARGIN_TILES) * TILE;

/** Fold a world X back into the wrap span. */
export function wrapX(x) {
  let v = (x - WRAP_MIN_X) % WRAP_SPAN;
  if (v < 0) v += WRAP_SPAN;
  return v + WRAP_MIN_X;
}

// Streaming -----------------------------------------------------------------
export const ROWS_AHEAD = 22;        // rows generated in front of the player
export const ROWS_BEHIND = 12;       // rows kept behind the player before culling

// Ground slabs are drawn far wider than the playable strip so the horizon is
// always covered, whatever the aspect ratio.
export const GROUND_WIDTH = 2800;
export const SAFE_ROWS = 4;          // grass rows at the start of a run

// Player --------------------------------------------------------------------
export const HOP_DURATION = 0.16;    // seconds for one hop
export const HOP_HEIGHT = 20;        // apex of the hop arc, in world units
export const PLAYER_HALF_WIDTH = 12; // collision half-extent on X
export const PLAYER_HALF_DEPTH = 12; // collision half-extent on Z
export const MOVE_QUEUE_MAX = 3;     // buffered inputs, so fast tapping feels right

// Camera ----------------------------------------------------------------------
// The camera is part of the simulation, not the renderer: it only ever scrolls
// forward, and it decides how far back the player may hop.
export const LOOK_AHEAD = 2.2;       // rows the camera leads the player by
export const VISIBLE_BEHIND = 3.0;   // rows kept on screen behind the player
export const CAMERA_CATCHUP = 7;     // damping rate when the camera follows forward
export const CAMERA_CREEP = 0.45;    // rows per second the view scrolls on its own
export const EDGE_MARGIN = 0.8;      // rows the player is kept clear of the bottom edge

// The eagle ---------------------------------------------------------------------
// The view's creep is what brings it: once the player has been parked at the
// bottom edge for EAGLE_GRACE seconds the eagle commits and cannot be escaped.
export const EAGLE_GRACE = 0.7;      // seconds at the bottom edge before it commits
export const IDLE_GRACE = 8;         // seconds without a hop -- a fallback the creep normally beats
export const EAGLE_SWOOP = 0.9;      // seconds from commit to grab

// Death -----------------------------------------------------------------------
export const DEATH_HOLD = {          // seconds each death animation plays before game over
  car: 1.1,
  train: 1.1,
  water: 1.25,
  offscreen: 1.4,
  eagle: 1.7,
};

// Scoring -------------------------------------------------------------------
export const COIN_VALUE = 1;
export const STORAGE_KEY = 'crossy-road.save.v1';

// Terrain kinds -------------------------------------------------------------
export const FOREST = 'forest';
export const ROAD = 'road';
export const RIVER = 'river';
export const RAIL = 'rail';
