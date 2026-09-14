import {
  TILE, MIN_TILE, MAX_TILE, tileToX, xToTile, HOP_DURATION, HOP_HEIGHT,
  PLAYER_HALF_WIDTH, MOVE_QUEUE_MAX, ROWS_AHEAD, ROWS_BEHIND,
  LOOK_AHEAD, VISIBLE_BEHIND, CAMERA_CATCHUP, CAMERA_CREEP, EDGE_MARGIN, DEATH_HOLD, COIN_VALUE,
  EAGLE_GRACE, IDLE_GRACE, EAGLE_SWOOP,
  FOREST, ROAD, RIVER, RAIL,
} from './constants.js';
import { createRng } from './rng.js';
import { createTerrain, occupantX, isBlocked, trainState } from './rows.js';

const MAX_STEP = 1 / 60;   // simulation is stepped at a fixed rate for stable collisions

// How much of a row the player has to be over before that row's traffic can
// hit them. With 0.4 there is a brief window in the middle of a hop where the
// player is over neither row -- that is what makes a close hop feel fair
// instead of like the game reached out and grabbed them.
const ROW_OVERLAP = 0.4;
// Vehicles are a touch forgiving on X so a grazing bumper is a near miss.
const HIT_SLACK = 5;

export const DIRECTIONS = {
  forward: { drow: 1, dtile: 0, facing: 0 },
  back:    { drow: -1, dtile: 0, facing: Math.PI },
  left:    { drow: 0, dtile: -1, facing: Math.PI / 2 },
  right:   { drow: 0, dtile: 1, facing: -Math.PI / 2 },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
// Ease-out on the horizontal part of a hop; the vertical part is a parabola.
const easeHop = (t) => 1 - (1 - t) * (1 - t);

export function createGame(options = {}) {
  const emit = options.onEvent ?? (() => {});

  const state = {
    phase: 'ready',           // ready -> playing -> dying -> over
    seed: 0,
    time: 0,                  // clock that drives all traffic
    terrain: null,
    player: {
      row: 0, tile: 0, x: 0, z: 0, y: 0, rowFloat: 0,
      facing: 0,
      hopping: false, hopT: 0,
      fromX: 0, fromRow: 0, toX: 0, toRow: 0,
      squash: 0,              // 0..1, drives the landing squash on the model
      carrier: null,          // the log/lilypad currently under the player
      carrierRow: null,
    },
    camera: { row: LOOK_AHEAD },
    queue: [],
    score: 0,
    maxRow: 0,
    coins: 0,
    idleTimer: 0,             // seconds since the last hop
    edgeTimer: 0,             // seconds spent parked at the bottom of the screen
    eagle: { active: false, t: 0 },
    death: { cause: null, t: 0 },
  };

  function reset(seed = (Math.random() * 0xffffffff) >>> 0) {
    const rng = createRng(seed);
    state.seed = seed;
    state.phase = 'ready';
    state.time = 0;
    state.terrain = createTerrain(rng);
    state.terrain.ensure(-ROWS_BEHIND, ROWS_AHEAD);
    Object.assign(state.player, {
      row: 0, tile: 0, x: 0, z: 0, y: 0, rowFloat: 0, facing: 0,
      hopping: false, hopT: 0, fromX: 0, fromRow: 0, toX: 0, toRow: 0,
      squash: 0, carrier: null, carrierRow: null,
    });
    state.camera.row = LOOK_AHEAD;
    state.queue.length = 0;
    state.score = 0;
    state.maxRow = 0;
    state.coins = 0;
    state.idleTimer = 0;
    state.edgeTimer = 0;
    state.eagle = { active: false, t: 0 };
    state.death = { cause: null, t: 0 };
    emit('reset', { seed });
    return state;
  }

  function start() {
    if (state.phase !== 'ready') return;
    state.phase = 'playing';
    emit('start', {});
  }

  function queueMove(direction) {
    if (!DIRECTIONS[direction]) return;
    if (state.phase === 'ready') start();
    if (state.phase !== 'playing') return;
    if (state.eagle.active) return;           // too late -- it has you
    if (state.queue.length >= MOVE_QUEUE_MAX) return;
    state.queue.push(direction);
  }

  // --- helpers -------------------------------------------------------------

  /** The lowest row still on screen -- the player may not hop below it. */
  const bottomRow = () => state.camera.row - LOOK_AHEAD - VISIBLE_BEHIND;

  /** The log / lily pad under world position `x` on a river row, or null. */
  function carrierAt(row, x) {
    if (!row || row.type !== RIVER) return null;
    for (const occ of row.occupants) {
      const cx = occupantX(row, occ, state.time);
      if (Math.abs(x - cx) <= occ.length / 2 + PLAYER_HALF_WIDTH * 0.35) return occ;
    }
    return null;
  }

  /** Does anything on `row` overlap the player's box at world x? */
  function hazardAt(row, x) {
    if (!row) return null;
    if (row.type === ROAD) {
      for (const occ of row.occupants) {
        const cx = occupantX(row, occ, state.time);
        if (Math.abs(x - cx) < occ.length / 2 + PLAYER_HALF_WIDTH - HIT_SLACK) return 'car';
      }
    } else if (row.type === RAIL) {
      const train = trainState(row, state.time);
      if (train.active && Math.abs(x - train.x) < train.length / 2 + PLAYER_HALF_WIDTH - HIT_SLACK) {
        return 'train';
      }
    }
    return null;
  }

  function beginHop(direction) {
    const p = state.player;
    const dir = DIRECTIONS[direction];
    p.facing = dir.facing;

    const targetRow = p.row + dir.drow;
    if (targetRow < bottomRow() + 0.5) { emit('bump', {}); return false; }

    const row = state.terrain.get(targetRow);
    let targetX = p.x + dir.dtile * TILE;

    // Landing on solid ground always snaps back onto the grid, so drifting
    // down a river never leaves the player wedged between two columns.
    if (row.type !== RIVER) targetX = tileToX(clamp(xToTile(targetX), MIN_TILE, MAX_TILE));
    else targetX = clamp(targetX, tileToX(MIN_TILE), tileToX(MAX_TILE));

    if (dir.dtile !== 0 && Math.abs(targetX - p.x) < 1) { emit('bump', {}); return false; }
    if (isBlocked(row, xToTile(targetX))) { emit('bump', {}); return false; }

    p.hopping = true;
    p.hopT = 0;
    p.fromX = p.x;
    p.fromRow = p.row;
    p.toX = targetX;
    p.toRow = targetRow;
    state.idleTimer = 0;
    emit('hop', { direction });
    return true;
  }

  function land() {
    const p = state.player;
    p.hopping = false;
    p.hopT = 0;
    p.row = p.toRow;
    p.x = p.toX;
    p.y = 0;
    p.rowFloat = p.row;
    p.squash = 1;

    const row = state.terrain.get(p.row);
    // Solid ground is a grid; the hop target was on it, but make sure nothing
    // (a log carrying the take-off point) has nudged the landing off it.
    if (row.type !== RIVER) p.x = tileToX(clamp(xToTile(p.x), MIN_TILE, MAX_TILE));
    p.tile = xToTile(p.x);
    p.carrier = carrierAt(row, p.x);
    p.carrierRow = p.carrier ? row : null;

    if (p.row > state.maxRow) {
      state.maxRow = p.row;
      state.score = p.row;
      state.terrain.ensure(p.row - ROWS_BEHIND, p.row + ROWS_AHEAD);
      // Keep everything still on screen, plus what the renderer streams behind.
      state.terrain.prune(Math.floor(bottomRow()) - ROWS_BEHIND - 4);
      emit('score', { score: state.score });
    }

    if (row.type === FOREST && row.coin && !row.coin.taken && row.coin.tile === p.tile) {
      row.coin.taken = true;
      state.coins += COIN_VALUE;
      emit('coin', { total: state.coins });
    }
    emit('land', { row: p.row });
  }

  function die(cause) {
    if (state.phase !== 'playing') return;
    const p = state.player;
    state.phase = 'dying';
    state.death = { cause, t: 0 };
    state.queue.length = 0;
    p.hopping = false;
    if (cause !== 'eagle') state.eagle.active = false;
    if (cause === 'car' || cause === 'train') {
      // Whatever hit the player did so on the ground; nothing gets flattened
      // in mid-air. Position stays exactly where the hit happened.
      p.y = 0;
    }
    emit('death', { cause, score: state.score, coins: state.coins });
  }

  function startEagle() {
    if (state.eagle.active) return;
    state.eagle = { active: true, t: 0 };
    state.queue.length = 0;
    emit('eagle', {});
  }

  // --- simulation ----------------------------------------------------------

  function updateCamera(dt) {
    const p = state.player;
    const cam = state.camera;
    const target = p.rowFloat + LOOK_AHEAD;
    // Follow forward when the player is ahead of the view...
    if (target > cam.row) cam.row = damp(cam.row, target, CAMERA_CATCHUP, dt);
    // ...and otherwise keep scrolling on its own. The creep stops once the
    // player is at the bottom edge -- the view never pushes them off screen --
    // and, like everything else here, it never moves backwards.
    const limit = p.rowFloat + LOOK_AHEAD + VISIBLE_BEHIND - EDGE_MARGIN;
    cam.row = Math.max(cam.row, Math.min(cam.row + CAMERA_CREEP * dt, limit));
  }

  function step(dt) {
    const p = state.player;
    state.time += dt;

    if (state.phase === 'dying') {
      state.death.t += dt;
      if (state.eagle.active) state.eagle.t += dt;
      // Swept away: the log keeps carrying the body off the edge.
      if (state.death.cause === 'offscreen' && p.carrierRow) {
        p.x += p.carrierRow.direction * p.carrierRow.speed * dt;
      }
      if (state.death.t >= (DEATH_HOLD[state.death.cause] ?? 1.2)) {
        state.phase = 'over';
        emit('gameover', { score: state.score, coins: state.coins });
      }
      return;
    }
    if (state.phase !== 'playing') return;

    // Ride the current log: the player and the take-off point drift with it.
    // The landing point only drifts if it is also on the water -- a hop onto
    // grass has a fixed target.
    if (p.carrier && p.carrierRow && p.carrierRow.speed) {
      const drift = p.carrierRow.direction * p.carrierRow.speed * dt;
      p.x += drift;
      p.fromX += drift;
      if (p.hopping && state.terrain.get(p.toRow).type === RIVER) p.toX += drift;
    }

    // Once the eagle has committed there is no hopping out from under it.
    if (!p.hopping && state.queue.length && !state.eagle.active) beginHop(state.queue.shift());

    if (p.hopping) {
      p.hopT += dt / HOP_DURATION;
      if (p.hopT >= 1) {
        land();
      } else {
        const e = easeHop(p.hopT);
        p.x = p.fromX + (p.toX - p.fromX) * e;
        p.rowFloat = p.fromRow + (p.toRow - p.fromRow) * e;
        p.y = Math.sin(Math.PI * p.hopT) * HOP_HEIGHT;
      }
    } else {
      p.squash = Math.max(0, p.squash - dt * 7);
      p.rowFloat = p.row;
    }
    p.z = -p.rowFloat * TILE;

    // --- hazards: only rows the player is actually over ---
    const lo = Math.ceil(p.rowFloat - ROW_OVERLAP);
    const hi = Math.floor(p.rowFloat + ROW_OVERLAP);
    for (let r = lo; r <= hi; r++) {
      const hit = hazardAt(state.terrain.get(r), p.x);
      if (hit) { die(hit); return; }
    }

    if (!p.hopping) {
      const row = state.terrain.get(p.row);
      if (row.type === RIVER) {
        p.carrier = carrierAt(row, p.x);
        p.carrierRow = p.carrier ? row : null;
        if (!p.carrier) { die('water'); return; }
        if (p.x < tileToX(MIN_TILE) - TILE * 0.9 || p.x > tileToX(MAX_TILE) + TILE * 0.9) {
          die('offscreen'); return;
        }
      } else {
        p.carrier = null;
        p.carrierRow = null;
      }
      p.tile = xToTile(p.x);
    }

    // --- the eagle ---
    state.idleTimer += dt;
    const atEdge = p.rowFloat <= bottomRow() + EDGE_MARGIN + 0.05;
    state.edgeTimer = atEdge ? state.edgeTimer + dt : 0;

    if (state.eagle.active) {
      state.eagle.t += dt;
      if (state.eagle.t >= EAGLE_SWOOP) { die('eagle'); return; }
      return;                                   // the view holds still for the grab
    }
    if (state.edgeTimer > EAGLE_GRACE || state.idleTimer > IDLE_GRACE) {
      startEagle();
      return;
    }

    updateCamera(dt);
  }

  /** Advance the world by `dt` seconds, in fixed sub-steps. */
  function update(dt) {
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0) {
      const step_ = Math.min(MAX_STEP, remaining);
      step(step_);
      remaining -= step_;
    }
    return state;
  }

  reset(options.seed);
  return { state, reset, start, queueMove, update, die, bottomRow };
}
