import * as THREE from 'three';
import { TILE } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Every model in the game is built here out of boxes and low-poly cylinders.
// There are no art assets: a shared unit-cube geometry is scaled per part and
// materials are cached by colour, so a whole row of traffic costs almost
// nothing to build.
// ---------------------------------------------------------------------------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map();

export function material(colour, opts = {}) {
  const key = `${colour}|${opts.flat ? 1 : 0}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color: colour,
      flatShading: !!opts.flat,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000,
    });
    materialCache.set(key, mat);
  }
  return mat;
}

/** A scaled unit cube. Sizes are full extents; position is the box centre. */
export function box(w, h, d, colour, x = 0, y = 0, z = 0, opts = {}) {
  const mesh = new THREE.Mesh(UNIT_BOX, material(colour, opts));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2 * (opts.anchor === 'bottom' ? 1 : 0), z);
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  return mesh;
}

const cylinderCache = new Map();
function cylinder(radius, height, segments, colour, opts = {}) {
  const key = `${radius}|${height}|${segments}`;
  let geo = cylinderCache.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(radius, radius, height, segments);
    cylinderCache.set(key, geo);
  }
  const mesh = new THREE.Mesh(geo, material(colour, opts));
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  return mesh;
}

// --- Player ----------------------------------------------------------------

/**
 * Builds a character from its palette. Returns the group plus the handful of
 * parts the animator needs (the body squashes on landing, legs swing, the
 * whole thing tips forward slightly mid-hop).
 */
export function buildCharacter(spec) {
  const group = new THREE.Group();
  const rig = new THREE.Group();          // everything that squashes
  group.add(rig);

  const legL = box(6, 9, 6, spec.accent, -6, 0, 4, { anchor: 'bottom' });
  const legR = box(6, 9, 6, spec.accent, 6, 0, 4, { anchor: 'bottom' });
  group.add(legL, legR);

  rig.add(box(24, 20, 22, spec.body, 0, 8, 0, { anchor: 'bottom' }));
  if (spec.belly) rig.add(box(15, 15, 3, spec.detail, 0, 11, -11, { anchor: 'bottom' }));

  // wings / arms
  rig.add(box(3, 13, 15, spec.body, -13, 12, 1, { anchor: 'bottom' }));
  rig.add(box(3, 13, 15, spec.body, 13, 12, 1, { anchor: 'bottom' }));

  const head = box(17, 14, 15, spec.body, 0, 28, -2, { anchor: 'bottom' });
  rig.add(head);
  rig.add(box(3, 3, 3, spec.eye, -5.5, 33, -9.5));
  rig.add(box(3, 3, 3, spec.eye, 5.5, 33, -9.5));

  if (spec.beak) rig.add(box(6, 4, 7, spec.accent, 0, 30, -12));
  if (spec.tail) rig.add(box(13, 10, 6, spec.body, 0, 18, 12, { anchor: 'bottom' }));

  switch (spec.crest) {
    case 'comb':
      rig.add(box(3, 6, 11, spec.detail, 0, 42, -3, { anchor: 'bottom' }));
      rig.add(box(3, 4, 4, spec.detail, 0, 30, -10, { anchor: 'bottom' }));
      break;
    case 'ears':
      rig.add(box(5, 6, 5, spec.body, -5, 42, -2, { anchor: 'bottom' }));
      rig.add(box(5, 6, 5, spec.body, 5, 42, -2, { anchor: 'bottom' }));
      break;
    case 'eyes':   // frog: eyes sit on top of the head
      rig.add(box(7, 7, 7, spec.body, -6, 41, -4, { anchor: 'bottom' }));
      rig.add(box(7, 7, 7, spec.body, 6, 41, -4, { anchor: 'bottom' }));
      rig.add(box(4, 4, 3, spec.eye, -6, 44, -8));
      rig.add(box(4, 4, 3, spec.eye, 6, 44, -8));
      break;
    case 'antenna':
      rig.add(box(2, 8, 2, spec.accent, 0, 42, -2, { anchor: 'bottom' }));
      rig.add(box(5, 5, 5, spec.detail, 0, 50, -2));
      break;
    default:
      break;
  }

  return { group, rig, legL, legR };
}

// --- Traffic ---------------------------------------------------------------

function wheels(group, length, width) {
  const inset = length / 2 - 12;
  for (const x of [-inset, inset]) {
    group.add(box(13, 10, width + 3, 0x22242b, x, 1, 0, { anchor: 'bottom' }));
  }
}

export function buildVehicle(occ) {
  const g = new THREE.Group();
  const { kind, length, width, colour, variant } = occ;

  if (kind === 'truck') {
    const cabLen = 36;
    const cargoLen = length - cabLen - 6;
    const nose = length / 2 - cabLen / 2;
    g.add(box(cabLen, 24, width, colour, nose, 8, 0, { anchor: 'bottom' }));
    g.add(box(cabLen - 12, 13, width - 3, 0x2b3550, nose - 2, 30, 0, { anchor: 'bottom' }));
    g.add(box(cargoLen, 34, width + 2, 0xe9ecef, -length / 2 + cargoLen / 2, 9, 0, { anchor: 'bottom' }));
    g.add(box(cargoLen - 8, 22, width + 3, 0xd3d8de, -length / 2 + cargoLen / 2, 15, 0, { anchor: 'bottom' }));
  } else if (kind === 'van') {
    g.add(box(length, 26, width, colour, 0, 6, 0, { anchor: 'bottom' }));
    g.add(box(length - 26, 13, width - 4, 0x2b3550, -5, 24, 0, { anchor: 'bottom' }));
    g.add(box(length * 0.4, 11, width + 1, 0xf2f2f2, -length * 0.24, 14, 0, { anchor: 'bottom' }));
  } else {
    // car / taxi: a low body with a small cabin set slightly back, so it never
    // reads as a bus at a glance.
    const roof = variant === 2 ? 0xf2f2f2 : colour;
    g.add(box(length, 15, width, colour, 0, 6, 0, { anchor: 'bottom' }));
    g.add(box(length * 0.44, 12, width - 8, roof, -length * 0.06, 20, 0, { anchor: 'bottom' }));
    // windscreen and rear window, so the cabin has a front
    g.add(box(3, 8, width - 9, 0x2b3550, length * 0.16, 22, 0, { anchor: 'bottom' }));
    g.add(box(3, 8, width - 9, 0x2b3550, -length * 0.28, 22, 0, { anchor: 'bottom' }));
    g.add(box(length * 0.36, 3, width - 9, 0x2b3550, -length * 0.06, 31, 0, { anchor: 'bottom' }));
    if (kind === 'taxi') {
      g.add(box(11, 5, 7, 0x2b2b2b, -length * 0.06, 34, 0, { anchor: 'bottom' }));
      g.add(box(length * 0.62, 5, width + 1, 0x2b2b2b, 0, 11, 0, { anchor: 'bottom' }));
    }
  }

  wheels(g, length, width);
  // head- and tail-lights: the vehicle model points along +X and gets flipped
  // by the row view when it travels the other way.
  g.add(box(4, 5, 7, 0xfff3b0, length / 2 - 1, 10, -width / 2 + 6, { anchor: 'bottom' }));
  g.add(box(4, 5, 7, 0xfff3b0, length / 2 - 1, 10, width / 2 - 6, { anchor: 'bottom' }));
  g.add(box(4, 5, 7, 0xd0453a, -length / 2 + 1, 10, -width / 2 + 6, { anchor: 'bottom' }));
  g.add(box(4, 5, 7, 0xd0453a, -length / 2 + 1, 10, width / 2 - 6, { anchor: 'bottom' }));
  return g;
}

export function buildTrain(carriages) {
  const g = new THREE.Group();
  const carLen = 96;
  const total = carriages * carLen + 60;
  let x = total / 2 - 60 / 2;

  // engine
  g.add(box(60, 40, 38, 0xd94f3d, x, 6, 0, { anchor: 'bottom' }));
  g.add(box(34, 16, 32, 0x2b3550, x - 4, 46, 0, { anchor: 'bottom' }));
  g.add(box(6, 10, 30, 0xf7d154, x + 30, 20, 0, { anchor: 'bottom' }));
  x -= 60 / 2;

  for (let i = 0; i < carriages; i++) {
    const cx = x - carLen / 2 + 1;
    g.add(box(carLen - 8, 42, 38, 0x4a5a86, cx, 6, 0, { anchor: 'bottom' }));
    g.add(box(carLen - 26, 14, 40, 0xbfd3ef, cx, 26, 0, { anchor: 'bottom' }));
    g.add(box(carLen - 8, 6, 40, 0x36446b, cx, 48, 0, { anchor: 'bottom' }));
    x -= carLen;
  }
  for (let i = 0; i < carriages + 1; i++) {
    g.add(box(10, 8, 34, 0x22242b, total / 2 - 30 - i * carLen, 0, 0, { anchor: 'bottom' }));
  }
  return g;
}

// --- River -----------------------------------------------------------------

// Logs float half-submerged: their origin is the water surface, so the deck
// sits RIDE_HEIGHT above it and the player rides at that offset.
export const RIDE_HEIGHT = 4;

export function buildLog(occ) {
  const g = new THREE.Group();
  const body = cylinder(12, occ.length, 8, 0x8a5a34, { flat: true });
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const cap = cylinder(12.4, 3, 8, 0xa9723f, { flat: true });
    cap.rotation.z = Math.PI / 2;
    cap.position.set(s * (occ.length / 2 - 1), 0, 0);
    g.add(cap);
  }
  if (occ.variant === 1) g.add(box(occ.length * 0.28, 4, 9, 0x6f4526, 0, RIDE_HEIGHT, 3, { anchor: 'bottom' }));
  return g;
}

export function buildLily() {
  const g = new THREE.Group();
  const pad = cylinder(18, 5, 9, 0x4b9e4b, { flat: true });
  pad.position.y = RIDE_HEIGHT - 2.5;
  g.add(pad);
  g.add(box(6, 6, 6, 0xf2a2c8, 7, RIDE_HEIGHT, -6, { anchor: 'bottom' }));
  return g;
}

// --- Scenery ---------------------------------------------------------------

const TREE_GREENS = [0x2f7a3f, 0x36894a, 0x286b38, 0x3d9455];

export function buildTree(height, seedIndex = 0) {
  const g = new THREE.Group();
  const canopy = 24 + height * 13;
  g.add(box(14, 20, 14, 0x6b4a2f, 0, 0, 0, { anchor: 'bottom' }));
  const tone = Math.abs(Math.trunc(seedIndex));
  g.add(box(33, canopy, 33, TREE_GREENS[tone % TREE_GREENS.length], 0, 16, 0, { anchor: 'bottom' }));
  g.add(box(25, 11, 25, TREE_GREENS[(tone + 2) % TREE_GREENS.length], 0, 16 + canopy - 3, 0, { anchor: 'bottom' }));
  return g;
}

export function buildRock(scale = 1) {
  const g = new THREE.Group();
  g.add(box(22 * scale, 16 * scale, 20 * scale, 0x8d8f96, 0, 0, 0, { anchor: 'bottom' }));
  g.add(box(13 * scale, 10 * scale, 13 * scale, 0x9ea1a8, 5 * scale, 14 * scale, -3 * scale, { anchor: 'bottom' }));
  return g;
}

export function buildCoin() {
  const g = new THREE.Group();
  const disc = cylinder(11, 4, 10, 0xf7c948, { emissive: 0x3a2c00 });
  disc.rotation.x = Math.PI / 2;
  disc.position.y = 22;
  g.add(disc);
  const inner = cylinder(7, 5, 10, 0xffe08a, { emissive: 0x4a3a00 });
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 22;
  g.add(inner);
  return g;
}

export function buildSignal() {
  const g = new THREE.Group();
  g.add(box(6, 46, 6, 0x59606b, 0, 0, 0, { anchor: 'bottom' }));
  g.add(box(20, 14, 8, 0x3b414b, 0, 46, 0, { anchor: 'bottom' }));
  const lampL = box(7, 7, 4, 0x5a2320, -5, 53, -4);
  const lampR = box(7, 7, 4, 0x5a2320, 5, 53, -4);
  // Cloned so each crossing can blink independently; flagged so the row view
  // knows to dispose of them.
  lampL.material = lampL.material.clone();
  lampR.material = lampR.material.clone();
  lampL.material.__cloned = true;
  lampR.material.__cloned = true;
  g.add(lampL, lampR);
  return { group: g, lamps: [lampL, lampR] };
}

export function buildEagle() {
  const g = new THREE.Group();
  g.add(box(22, 18, 46, 0x5b4632, 0, 0, 0));           // body, facing -Z
  g.add(box(16, 14, 16, 0xf2efe6, 0, 6, -28));         // white head
  g.add(box(8, 5, 9, 0xf0a92c, 0, 3, -38));            // beak
  g.add(box(3, 3, 3, 0x1b1b1b, -4, 9, -34));
  g.add(box(3, 3, 3, 0x1b1b1b, 4, 9, -34));
  g.add(box(14, 4, 16, 0xf2efe6, 0, 0, 26));           // tail feathers
  const wingL = box(48, 5, 30, 0x6d543c, -25, 2, 2);
  const wingR = box(48, 5, 30, 0x6d543c, 25, 2, 2);
  g.add(wingL, wingR);
  g.add(box(18, 6, 10, 0xf0a92c, 0, -10, -4));          // talons
  return { group: g, wingL, wingR };
}

export function buildSplash() {
  const g = new THREE.Group();
  const drops = [];
  for (let i = 0; i < 10; i++) {
    const d = box(6, 6, 6, 0xbfe0ff, 0, 0, 0, { cast: false });
    g.add(d);
    drops.push(d);
  }
  return { group: g, drops };
}

export { TILE };
