import { CHARACTERS } from '../core/characters.js';

const CAUSE_TEXT = {
  car: 'Squashed!',
  train: 'Flattened!',
  water: 'Splash!',
  offscreen: 'Swept away!',
  eagle: 'Snatched!',
};

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const $ = (id) => document.getElementById(id);

export function createUI(handlers) {
  const el = {
    score: $('score'),
    coins: $('coins'),
    hint: $('hint'),
    flash: $('flash'),
    title: $('screen-title'),
    over: $('screen-over'),
    shop: $('screen-shop'),
    pause: $('screen-pause'),
    titleBest: $('title-best'),
    titleCoins: $('title-coins'),
    overFlag: $('over-flag'),
    overCause: $('over-cause'),
    overScore: $('over-score'),
    overBest: $('over-best'),
    overCoins: $('over-coins'),
    shopCoins: $('shop-coins'),
    grid: $('char-grid'),
    sound: $('btn-sound'),
  };

  const screens = [el.title, el.over, el.shop, el.pause];
  let lastScreen = el.title;

  function show(screen) {
    for (const s of screens) s.classList.toggle('show', s === screen);
    if (screen) lastScreen = screen;
  }
  const hideAll = () => { for (const s of screens) s.classList.remove('show'); };

  function setScore(value) {
    el.score.firstChild.nodeValue = String(value);
    el.score.classList.add('pop');
    setTimeout(() => el.score.classList.remove('pop'), 90);
  }
  const setCoins = (value) => { el.coins.textContent = String(value); };

  function flash() {
    el.flash.classList.remove('hit');
    void el.flash.offsetWidth;   // restart the animation
    el.flash.classList.add('hit');
  }

  /** A little div-built face so the shop shows each character without a 3D view. */
  function portrait(spec) {
    const node = document.createElement('div');
    node.className = 'portrait';
    node.style.background = hex(spec.body);
    const parts = [
      ['eye l', spec.eye],
      ['eye r', spec.eye],
      ['snout', spec.beak ? spec.accent : spec.detail],
    ];
    if (spec.crest !== 'none') parts.push(['crest', spec.crest === 'antenna' ? spec.detail : spec.detail]);
    for (const [cls, colour] of parts) {
      const i = document.createElement('i');
      i.className = cls;
      i.style.background = hex(colour);
      node.appendChild(i);
    }
    return node;
  }

  function renderShop(save) {
    el.grid.replaceChildren();
    el.shopCoins.textContent = String(save.coins);
    for (const spec of CHARACTERS) {
      const owned = save.unlocked.includes(spec.id);
      const affordable = !owned && save.coins >= spec.price;
      const btn = document.createElement('button');
      btn.className = 'char';
      btn.classList.toggle('selected', save.selected === spec.id);
      btn.classList.toggle('locked', !owned);
      btn.classList.toggle('affordable', affordable);
      btn.appendChild(portrait(spec));

      const name = document.createElement('span');
      name.className = 'char-name';
      name.textContent = spec.name;
      btn.appendChild(name);

      const cost = document.createElement('span');
      cost.className = 'char-cost';
      cost.textContent = owned ? (save.selected === spec.id ? 'Wearing' : 'Owned') : `${spec.price} ¢`;
      btn.appendChild(cost);

      if (!owned) {
        const lock = document.createElement('span');
        lock.className = 'lock-badge';
        lock.textContent = affordable ? '🔓' : '🔒';
        btn.appendChild(lock);
      }
      btn.addEventListener('click', () => handlers.onChoose(spec.id));
      el.grid.appendChild(btn);
    }
  }

  function refresh(save) {
    el.titleBest.textContent = String(save.best);
    el.titleCoins.textContent = String(save.coins);
    el.coins.textContent = String(save.coins);
    el.sound.textContent = save.muted ? '🔇' : '🔊';
    el.sound.classList.toggle('off', save.muted);
    if (el.shop.classList.contains('show')) renderShop(save);
  }

  function showOver(result, save) {
    el.overCause.textContent = CAUSE_TEXT[result.cause] ?? 'Game over';
    el.overScore.textContent = String(result.score);
    el.overBest.textContent = String(save.best);
    el.overCoins.textContent = String(result.coins);
    el.overFlag.innerHTML = result.newBest ? '★ NEW BEST ★' : '&nbsp;';
    show(el.over);
  }

  // --- wiring ---
  const bind = (id, fn) => $(id).addEventListener('click', fn);
  bind('btn-play', () => handlers.onPlay());
  bind('btn-again', () => handlers.onPlay());
  bind('btn-shop', () => handlers.onOpenShop());
  bind('btn-shop2', () => handlers.onOpenShop());
  bind('btn-close-shop', () => handlers.onCloseShop());
  bind('btn-sound', () => handlers.onToggleSound());
  bind('btn-pause', () => handlers.onPause());
  bind('btn-resume', () => handlers.onResume());
  bind('btn-quit', () => handlers.onQuit());

  return {
    setScore,
    setCoins,
    refresh,
    showOver,
    showTitle: () => show(el.title),
    showShop: (save) => { renderShop(save); show(el.shop); },
    showPause: () => show(el.pause),
    hideAll,
    flash,
    setHint: (visible) => { el.hint.hidden = !visible; },
    isOverlayOpen: () => screens.some((s) => s.classList.contains('show')),
    get lastScreen() { return lastScreen; },
  };
}
