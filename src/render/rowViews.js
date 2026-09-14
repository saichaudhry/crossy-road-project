import * as THREE from 'three';
import {
  TILE, MAX_TILE, GROUND_WIDTH, tileToX, rowToZ,
  FOREST, ROAD, RIVER, RAIL,
} from '../core/constants.js';
import { occupantX, trainState } from '../core/rows.js';
import {
  box, buildVehicle, buildTrain, buildLog, buildLily, buildTree, buildRock,
  buildCoin, buildSignal, RIDE_HEIGHT,
} from './models.js';

// ---------------------------------------------------------------------------
// One view per terrain row. The view owns its meshes and is thrown away when
// the row scrolls out of range; per-frame work is limited to writing the X
// position of things that move.
// ---------------------------------------------------------------------------

export const GROUND_TOP = 0;
export const WATER_TOP = -8;

const GRASS = [0x74c365, 0x69b95b];
const ASPHALT = [0x464b55, 0x4b515c];
const WATER = [0x3f86d6, 0x3a7dcb];
const GRAVEL = [0x8f897a, 0x878174];

/** Trees and rocks lining the sides, so the play area reads as bounded. */
function edgeScenery(group, row) {
  for (let i = 1; i <= 9; i++) {
    for (const side of [-1, 1]) {
      const tile = side * (MAX_TILE + i);
      const roll = ((row.index * 73856093) ^ (tile * 19349663) ^ (i * 83492791)) >>> 0;
      const r = (roll % 1000) / 1000;
      if (i === 1 && r > 0.72) continue;      // the odd gap keeps the edge organic
      const obj = r > 0.22
        ? buildTree(1 + (roll >>> 8) % 3, roll >>> 3)
        : buildRock(0.8 + ((roll >>> 5) % 40) / 100);
      obj.position.set(tileToX(tile) + ((roll >>> 11) % 14) - 7, GROUND_TOP, ((roll >>> 13) % 14) - 7);
      group.add(obj);
    }
  }
}

function groundSlab(row, colours, top, thickness = 14) {
  const colour = colours[row.tint];
  return box(GROUND_WIDTH, thickness, TILE, colour, 0, top - thickness, 0,
    { anchor: 'bottom', cast: false });
}

function buildForest(row, group) {
  group.add(groundSlab(row, GRASS, GROUND_TOP));
  for (const tree of row.trees) {
    const t = buildTree(tree.height, row.index + tree.tile);
    t.position.set(tileToX(tree.tile), GROUND_TOP, 0);
    group.add(t);
  }
  edgeScenery(group, row);

  let coinMesh = null;
  if (row.coin) {
    coinMesh = buildCoin();
    coinMesh.position.set(tileToX(row.coin.tile), GROUND_TOP, 0);
    group.add(coinMesh);
  }
  return { coinMesh };
}

function buildRoad(row, group) {
  group.add(groundSlab(row, ASPHALT, GROUND_TOP));

  // Dashed divider between two adjacent road lanes; solid kerb line otherwise.
  const dividerZ = TILE / 2;
  if (row.highwayBelow) {
    for (let x = -GROUND_WIDTH / 2; x < GROUND_WIDTH / 2; x += 46) {
      group.add(box(26, 1, 3.5, 0xe9e4d4, x, GROUND_TOP - 0.4, dividerZ, { anchor: 'bottom', cast: false }));
    }
  } else {
    group.add(box(GROUND_WIDTH, 1, 3.5, 0xd9d3c3, 0, GROUND_TOP - 0.4, dividerZ,
      { anchor: 'bottom', cast: false }));
  }

  const meshes = row.occupants.map((occ) => {
    const m = buildVehicle(occ);
    m.rotation.y = row.direction > 0 ? 0 : Math.PI;
    group.add(m);
    return m;
  });
  return { meshes };
}

function buildRiver(row, group) {
  group.add(groundSlab(row, WATER, WATER_TOP, 22));
  const meshes = row.occupants.map((occ) => {
    const m = row.lily ? buildLily() : buildLog(occ);
    m.position.y = WATER_TOP;
    group.add(m);
    return m;
  });
  return { meshes };
}

function buildRail(row, group) {
  group.add(groundSlab(row, GRAVEL, GROUND_TOP));
  for (let x = -GROUND_WIDTH / 2; x < GROUND_WIDTH / 2; x += 26) {
    group.add(box(12, 4, 40, 0x6b5b45, x, GROUND_TOP - 1, 0, { anchor: 'bottom', cast: false }));
  }
  for (const z of [-11, 11]) {
    group.add(box(GROUND_WIDTH, 4, 5, 0xa9adb5, 0, GROUND_TOP + 2, z, { anchor: 'bottom', cast: false }));
  }

  const signals = [];
  for (const side of [-1, 1]) {
    const s = buildSignal();
    s.group.position.set(tileToX(side * (MAX_TILE + 1)) - side * 8, GROUND_TOP, TILE * 0.34);
    s.group.rotation.y = side > 0 ? -0.35 : 0.35;
    group.add(s.group);
    signals.push(s);
  }

  const train = buildTrain(row.carriages);
  train.rotation.y = row.direction > 0 ? 0 : Math.PI;
  train.visible = false;
  group.add(train);
  return { train, signals };
}

export function createRowView(row) {
  const group = new THREE.Group();
  group.position.z = rowToZ(row.index);

  let parts = {};
  if (row.type === FOREST) parts = buildForest(row, group);
  else if (row.type === ROAD) parts = buildRoad(row, group);
  else if (row.type === RIVER) parts = buildRiver(row, group);
  else if (row.type === RAIL) parts = buildRail(row, group);

  const view = {
    row,
    group,
    ...parts,
    update(t) {
      if (parts.meshes) {
        for (let i = 0; i < parts.meshes.length; i++) {
          parts.meshes[i].position.x = occupantX(row, row.occupants[i], t);
        }
      }
      if (row.type === FOREST && parts.coinMesh) {
        if (row.coin.taken) {
          parts.coinMesh.visible = false;
        } else {
          parts.coinMesh.rotation.y = t * 2.6;
          parts.coinMesh.position.y = GROUND_TOP + Math.sin(t * 3 + row.index) * 2.5;
        }
      }
      if (row.type === RAIL) {
        const st = trainState(row, t);
        parts.train.visible = st.active;
        if (st.active) parts.train.position.x = st.x;
        const lit = st.warning && Math.floor(t * 4) % 2 === 0;
        for (const s of parts.signals) {
          s.lamps[0].material.color.setHex(lit ? 0xff4a3d : 0x5a2320);
          s.lamps[0].material.emissive.setHex(lit ? 0x8a1a10 : 0x000000);
          s.lamps[1].material.color.setHex(!lit && st.warning ? 0xff4a3d : 0x5a2320);
          s.lamps[1].material.emissive.setHex(!lit && st.warning ? 0x8a1a10 : 0x000000);
        }
      }
    },
    dispose() {
      group.traverse((obj) => {
        if (obj.isMesh && obj.material?.isMaterial && obj.material.__cloned) obj.material.dispose();
      });
      group.removeFromParent();
    },
  };
  return view;
}

export { RIDE_HEIGHT };
