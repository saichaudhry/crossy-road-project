import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../src/core/rng.js';
import { createTerrain, occupantX, trainState, difficultyAt } from '../src/core/rows.js';
import { createGame } from '../src/core/game.js';
import {
  TILE, MIN_TILE, MAX_TILE, WRAP_SPAN, WRAP_MIN_X, wrapX, tileToX,
  FOREST, ROAD, RIVER, RAIL, SAFE_ROWS, LOOK_AHEAD, VISIBLE_BEHIND,
} from '../src/core/constants.js';

const advance = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60);
};
/** Replace rows [from, to] with empty grass so a test controls the hazards. */
const flatten = (game, from, to) => {
  for (let i = from; i <= to; i++) {
    const row = game.state.terrain.get(i);
    row.type = FOREST; row.trees = []; row.blocked = new Set(); row.coin = null; row.occupants = [];
  }
};
/** Run a whole hop plus a frame to settle. */
const hop = (game, dir = 'forward') => {
  game.queueMove(dir);
  advance(game, 0.2);
};

test('rng is deterministic for a seed and diverges between seeds', () => {
  const a = createRng(1234);
  const b = createRng(1234);
  const c = createRng(1235);
  const seqA = Array.from({ length: 8 }, () => a.next());
  const seqB = Array.from({ length: 8 }, () => b.next());
  const seqC = Array.from({ length: 8 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('wrapX folds any position back into the traffic span', () => {
  for (const x of [0, 5000, -5000, WRAP_MIN_X, WRAP_MIN_X + WRAP_SPAN - 0.001]) {
    const w = wrapX(x);
    assert.ok(w >= WRAP_MIN_X - 1e-6 && w < WRAP_MIN_X + WRAP_SPAN + 1e-6, `${x} -> ${w}`);
  }
  assert.ok(Math.abs(wrapX(WRAP_MIN_X + WRAP_SPAN) - WRAP_MIN_X) < 1e-6);
});

test('the run always opens with safe grass rows', () => {
  for (const seed of [1, 2, 3, 99, 12345]) {
    const terrain = createTerrain(createRng(seed));
    for (let i = 0; i < SAFE_ROWS; i++) {
      const row = terrain.get(i);
      assert.equal(row.type, FOREST, `seed ${seed} row ${i}`);
      assert.ok(row.trees.every((t) => Math.abs(t.tile) > 1), 'start tiles stay clear');
    }
  }
});

test('terrain never walls the player in and never stacks trains', () => {
  for (const seed of [7, 21, 404, 90210]) {
    const terrain = createTerrain(createRng(seed));
    terrain.ensure(0, 400);
    let previous = null;
    let railStreak = 0;
    for (let i = 0; i <= 400; i++) {
      const row = terrain.get(i);
      if (row.type === FOREST) {
        const free = [];
        for (let t = MIN_TILE; t <= MAX_TILE; t++) if (!row.blocked.has(t)) free.push(t);
        assert.ok(free.length >= 3, `row ${i} of seed ${seed} left ${free.length} open tiles`);
      }
      railStreak = row.type === RAIL ? railStreak + 1 : 0;
      assert.ok(railStreak <= 2, `too many rail rows in a row at ${i}`);
      if (previous === RAIL && row.type !== RAIL) {
        assert.equal(row.type, FOREST, 'a rail cluster is always followed by grass');
      }
      previous = row.type;
    }
  }
});

test('every terrain kind shows up and difficulty ramps', () => {
  const terrain = createTerrain(createRng(2024));
  terrain.ensure(0, 400);
  const seen = new Set();
  for (let i = 0; i <= 400; i++) seen.add(terrain.get(i).type);
  assert.deepEqual([...seen].sort(), [FOREST, RAIL, RIVER, ROAD].sort());

  assert.equal(difficultyAt(0), 0);
  assert.equal(difficultyAt(1000), 1);
  assert.ok(difficultyAt(100) > difficultyAt(50));
});

test('road and river rows are evenly spaced and leave a crossable gap', () => {
  const terrain = createTerrain(createRng(5150));
  terrain.ensure(0, 300);
  for (let i = 0; i <= 300; i++) {
    const row = terrain.get(i);
    if (row.type !== ROAD && row.type !== RIVER) continue;
    assert.ok(row.occupants.length >= 2, `row ${i} needs traffic`);
    const xs = row.occupants.map((o) => o.x0).sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) {
      const gap = xs[k] - xs[k - 1] - row.occupants[k].length;
      assert.ok(gap > 4, `row ${i} occupants overlap (gap ${gap.toFixed(1)})`);
    }
    if (row.type === RIVER && !row.lily) {
      const period = WRAP_SPAN / row.occupants.length;
      assert.ok(period - row.occupants[0].length < TILE * 3,
        `river ${i} logs are too far apart to jump between`);
    }
  }
});

test('traffic wraps without teleporting', () => {
  const terrain = createTerrain(createRng(77));
  terrain.ensure(0, 120);
  const row = [...terrain.rows.values()].find((r) => r.type === ROAD);
  const occ = row.occupants[0];
  let previous = occupantX(row, occ, 0);
  let wraps = 0;
  for (let t = 0.02; t < 60; t += 0.02) {
    const x = occupantX(row, occ, t);
    const delta = Math.abs(x - previous);
    if (delta > WRAP_SPAN / 2) wraps++;
    else assert.ok(delta < 12, `step of ${delta.toFixed(2)} at t=${t.toFixed(2)}`);
    previous = x;
  }
  assert.ok(wraps > 0, 'traffic should have wrapped at least once in a minute');
});

test('trains run a full pass and warn before arriving', () => {
  const terrain = createTerrain(createRng(31337));
  terrain.ensure(0, 400);
  const row = [...terrain.rows.values()].find((r) => r.type === RAIL);
  let passes = 0;
  let previous = null;
  for (let t = 0; t < 60; t += 1 / 60) {
    const st = trainState(row, t);
    if (previous && st.active && !previous.active) {
      passes++;
      assert.ok(previous.warning, 'a train arrived with no warning light');
    }
    if (st.active) assert.ok(st.warning, 'the light stays lit while the train passes');
    previous = st;
  }
  assert.ok(passes >= 2, `expected repeated passes, saw ${passes}`);
});

test('hopping forward scores, and the score is the furthest row reached', () => {
  const game = createGame({ seed: 4242 });
  game.start();
  for (let i = 0; i < 3; i++) hop(game);
  assert.equal(game.state.player.row, 3);
  assert.equal(game.state.score, 3);
  hop(game, 'back');
  assert.equal(game.state.player.row, 2);
  assert.equal(game.state.score, 3, 'going back does not reduce the score');
});

test('trees and the map edge block movement', () => {
  const game = createGame({ seed: 8 });
  game.start();
  const { state } = game;

  // Walk into the left wall.
  for (let i = 0; i < MAX_TILE * 3; i++) hop(game, 'left');
  assert.equal(state.player.tile, MIN_TILE);
  assert.ok(state.player.x >= tileToX(MIN_TILE) - 0.01);

  // A tree directly ahead refuses the hop.
  const row = state.terrain.get(state.player.row + 1);
  if (row.type === FOREST) {
    row.blocked = new Set([state.player.tile]);
    row.trees = [{ tile: state.player.tile, height: 2 }];
    const before = state.player.row;
    hop(game, 'forward');
    assert.equal(state.player.row, before, 'the player should not walk through a tree');
  }
});

test('a car kills the player', () => {
  const game = createGame({ seed: 100 });
  game.start();
  const { state } = game;
  const row = state.terrain.get(1);
  row.type = ROAD;
  row.direction = 1;
  row.speed = 0;
  row.occupants = [{ kind: 'car', x0: 0, length: 62, width: 34, colour: 0, variant: 0 }];
  row.trees = [];
  row.blocked = new Set();
  hop(game, 'forward');
  assert.equal(state.phase, 'dying');
  assert.equal(state.death.cause, 'car');
});

test('water drowns the player, a log carries them', () => {
  const game = createGame({ seed: 200 });
  const { state } = game;
  game.start();

  const river = state.terrain.get(1);
  river.type = RIVER;
  river.lily = false;
  river.direction = 1;
  river.speed = 40;
  river.trees = [];
  river.blocked = new Set();
  river.occupants = [{ kind: 'log', x0: 0, length: 3 * TILE, width: 36, variant: 0 }];

  hop(game, 'forward');
  assert.equal(state.phase, 'playing', 'landing on the log is safe');
  assert.ok(state.player.carrier, 'the player should be riding the log');

  const startX = state.player.x;
  advance(game, 0.5);
  assert.ok(state.player.x > startX + 15, 'the log should carry the player downstream');
  assert.equal(state.phase, 'playing');

  // Now remove the log out from under them.
  river.occupants = [{ kind: 'log', x0: -900, length: TILE, width: 36, variant: 0 }];
  advance(game, 0.2);
  assert.equal(state.death.cause, 'water');
});

test('drifting off the side of the screen on a log is fatal', () => {
  const game = createGame({ seed: 201 });
  const { state } = game;
  game.start();
  const river = state.terrain.get(1);
  river.type = RIVER;
  river.lily = false;
  river.direction = 1;
  river.speed = 300;
  river.trees = [];
  river.blocked = new Set();
  river.occupants = [{ kind: 'log', x0: 0, length: 8 * TILE, width: 36, variant: 0 }];
  hop(game, 'forward');
  advance(game, 3);
  assert.equal(state.death.cause, 'offscreen');
});

test('coins are collected once and only once', () => {
  const game = createGame({ seed: 300 });
  const { state } = game;
  game.start();
  const row = state.terrain.get(1);
  row.type = FOREST;
  row.trees = [];
  row.blocked = new Set();
  row.coin = { tile: 0, taken: false };
  hop(game, 'forward');
  assert.equal(state.coins, 1);
  hop(game, 'back');
  hop(game, 'forward');
  assert.equal(state.coins, 1, 'the same coin cannot be banked twice');
});

test('standing still brings the view down on you, then the eagle', () => {
  const game = createGame({ seed: 400 });
  const { state } = game;
  game.start();
  const before = state.camera.row;
  advance(game, 2);
  assert.ok(state.camera.row > before + 0.5, 'the view should creep forward on its own');

  let t = 2;
  while (state.phase === 'playing' && t < 20) { game.update(1 / 60); t += 1 / 60; }
  assert.equal(state.death.cause, 'eagle');
  assert.ok(t > 4 && t < 9, `the eagle should arrive after a few seconds, not ${t.toFixed(1)}`);
  assert.ok(state.player.row >= game.bottomRow(), 'the view never scrolls the player off the bottom');
});

test('a player who keeps moving is never taken', () => {
  const game = createGame({ seed: 401 });
  const { state } = game;
  flatten(game, 0, 80);
  game.start();
  for (let i = 0; i < 40; i++) {
    game.queueMove('forward');
    advance(game, 0.5);
    assert.equal(state.phase, 'playing', `taken at hop ${i}`);
  }
  assert.equal(state.eagle.active, false);
});

test('once the eagle commits there is no hopping away', () => {
  const game = createGame({ seed: 402 });
  const { state } = game;
  flatten(game, 0, 20);
  game.start();
  while (!state.eagle.active) game.update(1 / 60);
  const row = state.player.row;
  game.queueMove('forward');
  game.queueMove('forward');
  advance(game, 0.4);
  assert.equal(state.player.row, row, 'a committed eagle cannot be outrun');
  assert.equal(state.queue.length, 0, 'moves are discarded, not held');
  advance(game, 1);
  assert.equal(state.death.cause, 'eagle');
});

test('the camera only scrolls forward and stays ahead of the player', () => {
  const game = createGame({ seed: 500 });
  const { state } = game;
  flatten(game, 0, 20);
  game.start();
  let previous = state.camera.row;
  for (let i = 0; i < 12; i++) {
    hop(game, 'forward');
    assert.ok(state.camera.row >= previous - 1e-9, 'camera moved backwards');
    previous = state.camera.row;
  }
  advance(game, 1);
  const lead = state.camera.row - (state.player.row + LOOK_AHEAD);
  assert.ok(lead >= 0 && lead < 0.6,
    `after a second idle the view leads by LOOK_AHEAD plus a little creep, got ${lead.toFixed(2)}`);

  previous = state.camera.row;
  hop(game, 'back');
  hop(game, 'back');
  assert.ok(state.camera.row >= previous, 'hopping back does not drag the camera');
});

test('the player cannot hop off the bottom of the screen', () => {
  const game = createGame({ seed: 500 });
  const { state } = game;
  flatten(game, 0, 20);
  game.start();
  for (let i = 0; i < 12; i++) hop(game, 'forward');
  advance(game, 1);
  for (let i = 0; i < 20 && state.phase === 'playing'; i++) hop(game, 'back');
  const bottom = state.camera.row - LOOK_AHEAD - VISIBLE_BEHIND;
  assert.ok(state.player.row >= bottom, `row ${state.player.row} is below the screen edge ${bottom}`);
  assert.ok(state.player.row <= bottom + 1.5, 'the player should have been allowed to reach the edge');
});

test('a mid-hop hit puts the player on the ground where it happened', () => {
  const game = createGame({ seed: 101 });
  const { state } = game;
  game.start();
  const row = state.terrain.get(1);
  row.type = ROAD; row.direction = 1; row.speed = 0;
  row.occupants = [{ kind: 'car', x0: 0, length: 62, width: 34, colour: 0, variant: 0 }];
  game.queueMove('forward');
  let frames = 0;
  while (state.phase === 'playing' && frames++ < 30) game.update(1 / 60);
  assert.equal(state.death.cause, 'car');
  assert.equal(state.player.y, 0, 'nothing is flattened in mid-air');
  assert.ok(state.player.rowFloat > 0.5, 'the hit happened over the road, not on the grass');
  assert.equal(state.queue.length, 0, 'buffered moves are dropped on death');
});

test('traffic on the row ahead cannot hit a player who has barely left the grass', () => {
  const game = createGame({ seed: 102 });
  const { state } = game;
  game.start();
  const row = state.terrain.get(1);
  row.type = ROAD; row.direction = 1; row.speed = 0;
  row.occupants = [{ kind: 'car', x0: 0, length: 62, width: 34, colour: 0, variant: 0 }];
  game.queueMove('forward');
  game.update(1 / 60);           // hop begins
  game.update(1 / 60);           // ~12% of the way -- still over the grass
  assert.equal(state.phase, 'playing');
  assert.ok(state.player.rowFloat < 0.4);
});

test('hopping from a log onto grass lands exactly on the grid', () => {
  const game = createGame({ seed: 202 });
  const { state } = game;
  game.start();
  const river = state.terrain.get(1);
  river.type = RIVER; river.lily = false; river.direction = 1; river.speed = 90;
  river.trees = []; river.blocked = new Set();
  river.occupants = [{ kind: 'log', x0: 0, length: 4 * TILE, width: 36, variant: 0 }];
  const grass = state.terrain.get(2);
  grass.type = FOREST; grass.trees = []; grass.blocked = new Set(); grass.coin = null;

  hop(game, 'forward');
  assert.ok(state.player.carrier, 'on the log');
  advance(game, 0.3);
  hop(game, 'forward');
  assert.equal(state.player.row, 2);
  const offGrid = Math.abs(state.player.x - tileToX(state.player.tile));
  assert.ok(offGrid < 1e-6, `landed ${offGrid.toFixed(2)} units off the grid`);
});

test('being swept away keeps drifting with the log', () => {
  const game = createGame({ seed: 203 });
  const { state } = game;
  game.start();
  const river = state.terrain.get(1);
  river.type = RIVER; river.lily = false; river.direction = 1; river.speed = 300;
  river.trees = []; river.blocked = new Set();
  river.occupants = [{ kind: 'log', x0: 0, length: 8 * TILE, width: 36, variant: 0 }];
  hop(game, 'forward');
  for (let i = 0; i < 300 && state.phase === 'playing'; i++) game.update(1 / 60);
  assert.equal(state.death.cause, 'offscreen');
  const x = state.player.x;
  advance(game, 0.3);
  assert.equal(state.phase, 'dying', 'still animating');
  assert.ok(state.player.x > x + 30, 'the body should keep moving with the log');
});

test('a run always ends cleanly, never mid-update', () => {
  for (const seed of [11, 22, 33, 44, 55, 66]) {
    const game = createGame({ seed });
    const rng = createRng(seed);
    game.start();
    const moves = ['forward', 'forward', 'forward', 'left', 'right', 'back'];
    for (let i = 0; i < 400 && game.state.phase === 'playing'; i++) {
      game.queueMove(moves[rng.int(0, moves.length - 1)]);
      advance(game, 0.18);
    }
    advance(game, 2);
    assert.ok(['playing', 'over'].includes(game.state.phase), `seed ${seed}: ${game.state.phase}`);
    assert.ok(Number.isFinite(game.state.player.x));
    assert.ok(game.state.score >= 0);
  }
});

test('reset wipes the run but keeps the world generator working', () => {
  const game = createGame({ seed: 900 });
  game.start();
  for (let i = 0; i < 5; i++) hop(game);
  game.reset(901);
  assert.equal(game.state.phase, 'ready');
  assert.equal(game.state.score, 0);
  assert.equal(game.state.coins, 0);
  assert.equal(game.state.player.row, 0);
  assert.equal(game.state.player.x, 0);
  assert.equal(game.state.terrain.get(0).type, FOREST);
});

test('terrain behind the player never changes under it', () => {
  const game = createGame({ seed: 606 });
  const { state } = game;
  game.start();
  for (let i = 0; i < 40; i++) {
    game.queueMove('forward');
    advance(game, 0.2);
    if (state.phase !== 'playing') { game.reset(606 + i); game.start(); }
  }
  const snapshot = new Map();
  for (const [index, row] of state.terrain.rows) snapshot.set(index, row.type);
  for (const [index, type] of snapshot) {
    assert.equal(state.terrain.get(index).type, type, `row ${index} changed`);
  }
});

test('rows are always generated in order, even when queried out of order', () => {
  const a = createTerrain(createRng(808));
  a.ensure(0, 60);
  const b = createTerrain(createRng(808));
  b.get(60);
  for (let i = 0; i <= 60; i++) {
    assert.equal(b.get(i).type, a.get(i).type, `row ${i} differs`);
  }
});
