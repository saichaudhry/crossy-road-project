import { STORAGE_KEY } from '../core/constants.js';
import { DEFAULT_CHARACTER } from '../core/characters.js';

// Progress lives in localStorage. Every read is defensive: a private window or
// a cleared profile must still start a playable game.

const BLANK = () => ({
  best: 0,
  coins: 0,
  plays: 0,
  unlocked: [DEFAULT_CHARACTER],
  selected: DEFAULT_CHARACTER,
  muted: false,
  shadows: true,
});

export function loadSave() {
  const blank = BLANK();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw);
    return {
      ...blank,
      ...parsed,
      unlocked: Array.isArray(parsed.unlocked) && parsed.unlocked.length
        ? [...new Set([DEFAULT_CHARACTER, ...parsed.unlocked])]
        : blank.unlocked,
    };
  } catch {
    return blank;
  }
}

export function persist(save) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable -- the run still works, it just will not be remembered */
  }
  return save;
}
