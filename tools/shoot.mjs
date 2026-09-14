// Screenshot harness: drives headless Chrome over the DevTools Protocol so we
// can wait for the render loop to settle instead of for a "load" event that a
// game page never really reaches.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? 9222;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function newTab(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`could not open tab: ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id) for (const fn of listeners) fn(msg);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    ready,
    send(method, params = {}) {
      const messageId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    },
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [url, out, widthArg, heightArg, waitArg, script] = process.argv.slice(2);
const width = Number(widthArg ?? 1280);
const height = Number(heightArg ?? 800);

const tab = await newTab(url);
const client = connect(tab.webSocketDebuggerUrl);
await client.ready;
await client.send('Page.enable');
await client.send('Runtime.enable');
await client.send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});

const errors = [];
client.send('Log.enable');
// Surface anything the page logs or throws -- a silent exception in the render
// loop would otherwise just look like a frozen screenshot.
client.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    errors.push(msg.params.args.map((a) => a.description ?? a.value).join(' '));
  }
});
await sleep(Number(waitArg ?? 2500));

if (script) {
  const res = await client.send('Runtime.evaluate', { expression: script, awaitPromise: true });
  if (res.exceptionDetails) errors.push(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  await sleep(900);
}

const probe = await client.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    ok: !!window.__crossy,
    phase: window.__crossy?.game.state.phase,
    row: window.__crossy?.game.state.player.row,
    rows: window.__crossy ? window.__crossy.game.state.terrain.rows.size : 0,
    draws: window.__crossy?.renderer.renderer.info.render.calls ?? 0,
    tris: window.__crossy?.renderer.renderer.info.render.triangles ?? 0,
    cam: window.__crossy ? [window.__crossy.renderer.camera.left, window.__crossy.renderer.camera.right, window.__crossy.renderer.camera.bottom, window.__crossy.renderer.camera.top].map(Math.round) : null,
  })`,
  returnByValue: true,
});

const shot = await client.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(out, probe.result.value, errors.length ? errors : '');
client.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
