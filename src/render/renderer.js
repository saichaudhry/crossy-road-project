import * as THREE from 'three';
import {
  TILE, MAX_TILE, rowToZ, ROWS_AHEAD, ROWS_BEHIND, LOOK_AHEAD, VISIBLE_BEHIND, EAGLE_SWOOP,
} from '../core/constants.js';
import { getCharacter } from '../core/characters.js';
import { createRowView, WATER_TOP, RIDE_HEIGHT } from './rowViews.js';
import { buildCharacter, buildEagle, buildSplash } from './models.js';

const SKY = 0x8ed0ef;
// A 4-degree yaw and a 52-degree pitch: lanes stay readable and horizontal,
// with just enough turn to show one end of every vehicle.
const CAM_DIR = new THREE.Vector3(0.043, 0.794, 0.619).normalize();
const CAM_DIST = 1400;
const LATERAL_FOLLOW = 0.15;     // how much the camera slides sideways with the player
const AHEAD_ROWS = 4.0;          // rows that must stay visible past the look-ahead point
// LOOK_AHEAD and VISIBLE_BEHIND come from the core: the same numbers decide how
// far back the player may hop, so view and rules can never disagree.

const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

function shortestAngle(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function createRenderer(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = options.shadows !== false;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, CAM_DIST + 260, CAM_DIST + 1000);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAM_DIST * 3);
  camera.position.copy(CAM_DIR).multiplyScalar(CAM_DIST);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const camOffset = camera.position.clone();

  // A stand-in that never moves, used purely to measure the framing. The real
  // camera travels with the player, so it cannot be used as a reference frame.
  const gauge = new THREE.Object3D();
  gauge.position.copy(camera.position);
  gauge.quaternion.copy(camera.quaternion);
  gauge.updateMatrixWorld(true);

  scene.add(new THREE.AmbientLight(0xd7ecff, 1.15));
  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x4b6a3a, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
  sun.position.set(-320, 620, 220);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 2200;
  const S = 470;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);

  // --- world container ---
  const world = new THREE.Group();
  scene.add(world);
  const views = new Map();

  // --- player ---
  let character = null;
  const playerHolder = new THREE.Group();
  world.add(playerHolder);
  let rideY = 0;
  let facing = 0;

  function setCharacter(id) {
    if (character) playerHolder.remove(character.group);
    character = buildCharacter(getCharacter(id));
    playerHolder.add(character.group);
    return character;
  }
  setCharacter(options.character);

  // --- eagle ---
  const eagle = buildEagle();
  eagle.group.visible = false;
  world.add(eagle.group);
  const eagleFrom = new THREE.Vector3();
  const eagleLast = new THREE.Vector3();
  const grabPoint = new THREE.Vector3();
  let eagleYaw = 0;

  // --- splash ---
  const splash = buildSplash();
  splash.group.visible = false;
  world.add(splash.group);
  let splashT = -1;
  const splashVel = splash.drops.map(() => new THREE.Vector3());

  // --- camera framing ---
  let camX = 0;
  const camTarget = new THREE.Vector3();

  function fit() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);

    // Work out the frustum from the box the player must always be able to see,
    // projected into camera space. Doing it this way keeps the same amount of
    // playfield on screen on a tall phone and a wide monitor.
    const halfWorldX = (MAX_TILE + 0.6) * TILE + LATERAL_FOLLOW * MAX_TILE * TILE;
    // The region in front of the camera target is deeper than the region
    // behind it, so the required box is measured as a proper min/max range and
    // the frustum is centred on it -- mirroring the larger side would zoom the
    // whole game out for no reason.
    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [-halfWorldX, halfWorldX]) {
      for (const z of [(LOOK_AHEAD + VISIBLE_BEHIND) * TILE, -AHEAD_ROWS * TILE]) {
        for (const y of [0, 96]) {
          p.set(x, y, z);
          gauge.worldToLocal(p);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      }
    }
    const pad = 12;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let halfW = (maxX - minX) / 2 + pad;
    let halfH = (maxY - minY) / 2 + pad;

    const aspect = w / h;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;

    camera.left = cx - halfW;
    camera.right = cx + halfW;
    camera.top = cy + halfH;
    camera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
  }

  // --- per-row streaming ---
  function syncRows(state) {
    const centre = Math.round(state.camera.row - LOOK_AHEAD);
    const from = centre - ROWS_BEHIND;
    const to = centre + ROWS_AHEAD;
    state.terrain.ensure(from, to);

    for (const [index, view] of views) {
      if (index < from || index > to) {
        view.dispose();
        views.delete(index);
      }
    }
    for (let i = from; i <= to; i++) {
      if (views.has(i)) continue;
      const view = createRowView(state.terrain.get(i));
      world.add(view.group);
      views.set(i, view);
    }
    for (const view of views.values()) view.update(state.time);
  }

  // --- player animation ---
  function animatePlayer(state, dt) {
    const p = state.player;
    const dying = state.phase === 'dying' || state.phase === 'over';
    const cause = state.death.cause;

    const targetRide = p.carrier ? RIDE_HEIGHT : 0;
    rideY = damp(rideY, targetRide, 18, dt);

    playerHolder.position.set(p.x, p.y + rideY, p.z);
    facing += shortestAngle(facing, p.facing) * Math.min(1, dt * 18);
    playerHolder.rotation.y = facing;

    const rig = character.rig;
    if (dying && (cause === 'car' || cause === 'train')) {
      const k = Math.min(1, state.death.t / 0.12);
      rig.scale.set(1 + 0.75 * k, Math.max(0.1, 1 - 0.9 * k), 1 + 0.55 * k);
      character.legL.visible = character.legR.visible = false;
    } else if (dying && (cause === 'water' || cause === 'offscreen')) {
      const k = Math.min(1, state.death.t / 0.55);
      playerHolder.position.y = p.y + rideY - k * 52;
      rig.rotation.z = k * 0.5;
    } else if (state.eagle.active && (dying || state.eagle.t > EAGLE_SWOOP * 0.8)) {
      // In the talons: dangling and wriggling. Position comes from the eagle.
      rig.rotation.z = Math.sin(state.time * 24) * 0.25;
      rig.scale.set(1, 1, 1);
      character.legL.rotation.x = Math.sin(state.time * 30) * 0.6;
      character.legR.rotation.x = -Math.sin(state.time * 30) * 0.6;
    } else {
      const hop = p.hopping ? Math.sin(Math.PI * p.hopT) : 0;
      const squash = p.squash;
      rig.scale.set(
        1 - 0.1 * hop + 0.28 * squash,
        1 + 0.16 * hop - 0.34 * squash,
        1 - 0.1 * hop + 0.28 * squash,
      );
      rig.rotation.x = -hop * 0.18;
      rig.rotation.z = 0;
      character.legL.visible = character.legR.visible = true;
      character.legL.rotation.x = hop * 0.7;
      character.legR.rotation.x = hop * 0.7;
      character.legL.position.y = hop * 3;
      character.legR.position.y = hop * 3;
      // A slow breathing bob so a waiting character never looks frozen.
      if (!p.hopping && state.phase === 'playing') {
        playerHolder.position.y += Math.sin(state.time * 2.6) * 0.9;
      }
    }
  }

  function animateEagle(state, dt) {
    const e = state.eagle;
    if (!e.active) {
      eagle.group.visible = false;
      return;
    }
    const p = state.player;
    if (!eagle.group.visible) {
      // Commit: start high up, off to one side and ahead of the player, so
      // the dive crosses the screen instead of dropping straight in.
      eagleFrom.set(p.x + (p.x > 0 ? -1 : 1) * 260, 560, p.z - 420);
      eagleLast.copy(eagleFrom);
      eagleYaw = 0;
      eagle.group.visible = true;
    }

    const dive = Math.min(1, e.t / EAGLE_SWOOP);
    const carry = state.phase === 'dying' ? state.death.t : 0;
    const ease = dive * dive * (3 - 2 * dive);
    const grabY = p.y + rideY + 30;

    if (dive < 1) {
      eagle.group.position.set(
        eagleFrom.x + (p.x - eagleFrom.x) * ease,
        eagleFrom.y + (grabY - eagleFrom.y) * ease,
        eagleFrom.z + (p.z - eagleFrom.z) * ease,
      );
    } else {
      // Away with the prize: up and forward, accelerating.
      eagle.group.position.set(p.x + carry * 40, grabY + carry * carry * 260 + carry * 80, p.z - carry * 260);
    }

    // Face the direction of travel; the model's nose points down -Z.
    const dx = eagle.group.position.x - eagleLast.x;
    const dz = eagle.group.position.z - eagleLast.z;
    if (dx * dx + dz * dz > 0.01) eagleYaw = Math.atan2(-dx, -dz);
    eagle.group.rotation.y += shortestAngle(eagle.group.rotation.y, eagleYaw) * Math.min(1, dt * 10);
    eagle.group.rotation.x = dive < 1 ? 0.25 : -0.2;
    eagleLast.copy(eagle.group.position);

    const flap = Math.sin(state.time * (dive < 1 ? 14 : 20)) * 0.6;
    eagle.wingL.rotation.z = flap;
    eagle.wingR.rotation.z = -flap;

    // Once the talons close, the player hangs from them.
    if (dive >= 0.8) {
      const grip = Math.min(1, (dive - 0.8) / 0.2);
      grabPoint.set(eagle.group.position.x, eagle.group.position.y - 32, eagle.group.position.z + 4);
      playerHolder.position.lerp(grabPoint, grip);
    }
  }

  function triggerSplash(x, z) {
    splash.group.visible = true;
    splash.group.position.set(x, WATER_TOP, z);
    splashT = 0;
    splash.drops.forEach((drop, i) => {
      const a = (i / splash.drops.length) * Math.PI * 2;
      drop.position.set(0, 0, 0);
      drop.scale.setScalar(1);
      splashVel[i].set(Math.cos(a) * 70, 150 + (i % 3) * 40, Math.sin(a) * 70);
    });
  }

  function animateSplash(dt) {
    if (splashT < 0) return;
    splashT += dt;
    if (splashT > 0.9) { splash.group.visible = false; splashT = -1; return; }
    splash.drops.forEach((drop, i) => {
      splashVel[i].y -= 560 * dt;
      drop.position.addScaledVector(splashVel[i], dt);
      drop.scale.setScalar(Math.max(0.05, 1 - splashT));
    });
  }

  function updateCamera(state, dt) {
    const p = state.player;
    // Forward scroll is decided by the simulation; only the small sideways
    // drift is a purely visual choice made here.
    const desiredX = p.x * LATERAL_FOLLOW;
    camX = state.phase === 'ready' ? desiredX : damp(camX, desiredX, 7, dt);

    camTarget.set(camX, 0, rowToZ(state.camera.row));
    camera.position.copy(camTarget).add(camOffset);
    sun.position.copy(camTarget).add(new THREE.Vector3(-330, 640, 240));
    sun.target.position.copy(camTarget);
    sun.target.updateMatrixWorld();
  }

  let shakeT = 0;
  const shake = () => { shakeT = 0.32; };

  // Adaptive quality: if the machine cannot hold a smooth frame rate with
  // shadows on, drop them once rather than stuttering for the whole run.
  let slowFrames = 0;
  let qualityLocked = false;
  function checkQuality(dt) {
    if (qualityLocked || !renderer.shadowMap.enabled || dt <= 0) return;
    slowFrames = dt > 1 / 34 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 90) {
      qualityLocked = true;
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.needsUpdate = true;
      sun.castShadow = false;
    }
  }

  function render(state, dt) {
    checkQuality(dt);
    syncRows(state);
    animatePlayer(state, dt);
    animateEagle(state, dt);
    animateSplash(dt);
    updateCamera(state, dt);

    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      const k = shakeT / 0.32;
      camera.position.x += Math.sin(state.time * 90) * 12 * k;
      camera.position.y += Math.cos(state.time * 78) * 9 * k;
    }
    renderer.render(scene, camera);
  }

  function clearRows() {
    for (const view of views.values()) view.dispose();
    views.clear();
    rideY = 0;
    facing = 0;
    splashT = -1;
    splash.group.visible = false;
    eagle.group.visible = false;
    character.rig.rotation.set(0, 0, 0);
    character.rig.scale.set(1, 1, 1);
  }

  fit();
  window.addEventListener('resize', fit);

  return {
    renderer, scene, camera, world,
    render, fit, setCharacter, clearRows, triggerSplash, shake,
    get playerObject() { return playerHolder; },
    setShadows(on) {
      if (renderer.shadowMap.enabled === on) return;
      renderer.shadowMap.enabled = on;
      renderer.shadowMap.needsUpdate = true;
      sun.castShadow = on;
    },
    dispose() {
      window.removeEventListener('resize', fit);
      clearRows();
      renderer.dispose();
    },
  };
}
