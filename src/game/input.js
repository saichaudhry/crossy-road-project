// Keyboard, swipe and on-screen controls all funnel into one `onMove` callback.

const KEY_MAP = {
  ArrowUp: 'forward', KeyW: 'forward',
  ArrowDown: 'back', KeyS: 'back',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

const SWIPE_THRESHOLD = 26;   // px before a drag counts as a swipe
const TAP_SLOP = 14;          // px of movement still treated as a tap

export function createInput({ target, onMove, onConfirm, onPause }) {
  let start = null;
  let handled = false;

  function keydown(event) {
    if (event.repeat && !KEY_MAP[event.code]) return;
    const move = KEY_MAP[event.code];
    if (move) {
      event.preventDefault();
      onMove(move);
      return;
    }
    if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      onConfirm?.();
    } else if (event.code === 'Escape' || event.code === 'KeyP') {
      onPause?.();
    }
  }

  function pointerdown(event) {
    if (event.target.closest?.('[data-ui]')) return;
    start = { x: event.clientX, y: event.clientY, t: performance.now() };
    handled = false;
    target.setPointerCapture?.(event.pointerId);
  }

  function pointermove(event) {
    if (!start || handled) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
    handled = true;
    if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left');
    else onMove(dy > 0 ? 'back' : 'forward');
  }

  function pointerup(event) {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!handled && Math.hypot(dx, dy) < TAP_SLOP) onMove('forward');
    start = null;
    handled = false;
  }

  window.addEventListener('keydown', keydown);
  target.addEventListener('pointerdown', pointerdown);
  target.addEventListener('pointermove', pointermove);
  target.addEventListener('pointerup', pointerup);
  target.addEventListener('pointercancel', () => { start = null; });

  return {
    /** Wire a D-pad button (or any element) to a direction. */
    bindButton(element, direction) {
      const fire = (event) => { event.preventDefault(); onMove(direction); };
      element.addEventListener('pointerdown', fire);
    },
    dispose() {
      window.removeEventListener('keydown', keydown);
      target.removeEventListener('pointerdown', pointerdown);
      target.removeEventListener('pointermove', pointermove);
      target.removeEventListener('pointerup', pointerup);
    },
  };
}
