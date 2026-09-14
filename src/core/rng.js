// A tiny seeded PRNG (mulberry32). Deterministic runs make the terrain
// generator testable and let a seed be replayed exactly.

export function createRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    /** float in [0, 1) */
    next,
    /** float in [min, max) */
    range: (min, max) => min + next() * (max - min),
    /** integer in [min, max] */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** uniform pick */
    pick: (list) => list[Math.floor(next() * list.length)],
    /** true with probability p */
    chance: (p) => next() < p,
    /** pick from [{ weight, ...}] proportionally to weight */
    weighted(entries) {
      let total = 0;
      for (const e of entries) total += e.weight;
      let roll = next() * total;
      for (const e of entries) {
        roll -= e.weight;
        if (roll <= 0) return e;
      }
      return entries[entries.length - 1];
    },
  };
}
