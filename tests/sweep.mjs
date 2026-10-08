#!/usr/bin/env node
/* =========================================================================
   NEON DUEL — tests/sweep.mjs      run:  node tests/sweep.mjs [mode ...]

   Runs the in-page captures in headless Chrome and prints what they measured.
   It serves the project itself (no python, no server to remember), drives
   Chrome over the DevTools protocol, and waits for #probe to be written.

   Real time on purpose: an OfflineAudioContext render cannot be hurried by
   --virtual-time-budget, and `#cap=audio` has to wait for one. Everything else
   here finishes in milliseconds anyway.

   Flags:  --shots          also save a PNG of each mode into ./shots
           --size WxH       window size (default 1100x700)
           --chrome PATH    browser binary (default $CHROME, else the usuals)
   ========================================================================= */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const ALL = ['idle', 'telegraph', 'strike', 'dodge', 'heavy', 'bolt', 'combo', 'win', 'lose',
  'demon', 'ice', 'gfx', 'bench', 'autoplay', 'audio'];

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i < 0 ? dflt : argv[i + 1];
};
const shots = argv.includes('--shots');
const [w, h] = (flag('--size', '1100x700') + '').split('x').map(Number);
const wanted = argv.filter((a) => ALL.includes(a));
const list = wanted.length ? wanted : ALL;

const CANDIDATES = [process.env.CHROME, flag('--chrome', ''),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const CHROME = CANDIDATES.find((c) => existsSync(c));
if (!CHROME) {
  console.error('no Chrome found — pass --chrome /path/to/chrome or set $CHROME');
  process.exit(2);
}

/* ---- serve the folder ---------------------------------------------------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
process.on('exit', () => server.close());


/* ---- drive Chrome -------------------------------------------------------- */
const PROFILE = mkdtempSync(join(tmpdir(), 'duel-sweep-'));
const DP = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
  '--no-first-run', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${PROFILE}`,
  `--window-size=${w},${h}`, `--remote-debugging-port=${DP}`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(path) {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${DP}${path}`); if (r.ok) return await r.json(); } catch {}
    await sleep(200);
  }
  throw new Error('devtools never answered on ' + DP);
}
const targets = await getJson('/json/list');
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result ? r.result.value : undefined;
};

/* ---- one mode at a time -------------------------------------------------- */
/* A fresh page per mode: the game resets itself, but a reload also clears the
   audio graph and the RNG, so no mode can be influenced by the one before it. */
if (shots) mkdirSync(join(ROOT, 'shots'), { recursive: true });
let bad = 0, total = 0, modes = 0;
const pad = (v, n) => String(v).padEnd(n);
for (const mode of list) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#cap=${mode}` });
  let raw = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try { raw = await js('(document.getElementById("probe")||{}).textContent||""'); } catch {}
    if (raw) break;
    await sleep(200);
  }
  modes++;
  if (!raw) { console.log(pad(mode, 9) + 'NO PROBE (not reached in 60s)'); bad++; continue; }
  const j = JSON.parse(raw);
  if (j.audioError) { console.log(pad(mode, 9) + 'THREW ' + j.audioError.split('\n')[0]); bad++; continue; }
  const checks = j.checks || [];
  const failed = checks.filter((c) => !c.pass);
  total += checks.length;
  bad += failed.length + (j.errors || []).length + (j.nanObjects ? 1 : 0);
  console.log(pad(mode, 9) + 'checks ' + pad(j.passed + '/' + checks.length, 7) +
    'nan ' + pad(j.nanObjects, 5) + 'errors ' + pad((j.errors || []).length, 4) +
    (mode === 'audio'
      ? 'sounds ' + pad(j.audio.sounds, 6) + 'loop rms ' + pad(j.audio.musicRms, 8) + 'peak ' + j.audio.musicPeak
      : 'calls ' + pad(j.calls, 5) + 'tris ' + pad(j.tris, 7) + 'state ' + j.state));
  failed.forEach((c) => console.log('   x ' + c.name + '  [' + c.detail + ']'));
  if (shots) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ROOT, 'shots', mode + '.png'), Buffer.from(s.data, 'base64'));
  }
}
console.log('\n' + (bad ? 'FAIL' : 'PASS') + ': ' + modes + ' modes, ' + total + ' checks, ' +
  bad + ' problems  (' + (shots ? 'shots in ./shots' : 'no screenshots') + ')');
ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
