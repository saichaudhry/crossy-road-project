// All sound is synthesised with the Web Audio API -- no audio files. Each cue
// is a couple of oscillators or a burst of filtered noise, which keeps the
// build asset-free and the download tiny.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);

    const frames = ctx.sampleRate * 0.5;
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone({ type = 'square', from, to = from, start = 0, duration = 0.12, gain = 0.5, sweep = 'exp' }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) {
      if (sweep === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
      else osc.frequency.linearRampToValueAtTime(to, t0 + duration);
    }
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noise({ start = 0, duration = 0.3, gain = 0.4, freq = 1200, q = 1, type = 'lowpass', sweepTo }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(env).connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  const cues = {
    hop: () => tone({ type: 'square', from: 460, to: 720, duration: 0.07, gain: 0.22 }),
    land: () => tone({ type: 'sine', from: 260, to: 180, duration: 0.06, gain: 0.16 }),
    bump: () => tone({ type: 'sine', from: 150, to: 90, duration: 0.09, gain: 0.3 }),
    coin: () => {
      tone({ type: 'triangle', from: 990, duration: 0.07, gain: 0.32 });
      tone({ type: 'triangle', from: 1480, start: 0.06, duration: 0.13, gain: 0.28 });
    },
    crash: () => {
      noise({ duration: 0.34, gain: 0.6, freq: 2600, sweepTo: 200 });
      tone({ type: 'sawtooth', from: 190, to: 44, duration: 0.34, gain: 0.4 });
    },
    splash: () => {
      noise({ duration: 0.42, gain: 0.5, freq: 400, sweepTo: 2800, type: 'bandpass', q: 1.4 });
      tone({ type: 'sine', from: 620, to: 180, duration: 0.22, gain: 0.2 });
    },
    train: () => {
      tone({ type: 'sawtooth', from: 168, duration: 0.5, gain: 0.26 });
      tone({ type: 'sawtooth', from: 222, duration: 0.5, gain: 0.22 });
    },
    warning: () => tone({ type: 'square', from: 880, duration: 0.06, gain: 0.12 }),
    eagle: () => {
      tone({ type: 'sawtooth', from: 1500, to: 420, duration: 0.55, gain: 0.3 });
      noise({ duration: 0.5, gain: 0.2, freq: 3000, sweepTo: 700, type: 'bandpass', q: 2 });
    },
    gameover: () => {
      const notes = [523, 415, 349, 262];
      notes.forEach((f, i) => tone({ type: 'triangle', from: f, duration: 0.22, gain: 0.26, start: i * 0.13 }));
    },
    unlock: () => {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ type: 'triangle', from: f, duration: 0.18, gain: 0.26, start: i * 0.07 }));
    },
  };

  return {
    resume,
    play(name) { cues[name]?.(); },
    get muted() { return muted; },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = value ? 0 : 0.32;
    },
  };
}
