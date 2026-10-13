/* =========================================================================
   NEON DUEL — tests/syntax.test.js      run:  node tests/syntax.test.js

   The game is one HTML file with its whole brain in a single <script
   type="module">. Node cannot import that file, and a syntax error in it does
   not throw where anyone is looking: the module simply never runs, the page
   keeps its loading screen, and every browser check times out one by one
   instead of failing once with a line number.

   So: lift each script block out of index.html, hand it to the JavaScript
   parser, and fail loudly. It takes well under a second and it is the cheapest
   check in the project — it is also the one that catches the typo that would
   otherwise cost ten minutes of headless Chrome.
   ========================================================================= */
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0;
const failures = [];
const ok = (name, good, detail) => {
  if (good) { pass++; return; }
  failures.push(name + (detail ? '  [' + detail + ']' : ''));
};

/* Every <script> block, in the order the browser meets them. */
const blocks = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(HTML))) {
  const attrs = m[1];
  const body = m[2];
  if (/src\s*=/.test(attrs) || !body.trim()) continue;
  const type = (/type\s*=\s*["']([^"']+)["']/.exec(attrs) || [])[1] || '';
  const mod = type === 'module';
  /* An import map is JSON, not JavaScript — but a malformed one silently breaks
     every bare import in the page, so it is worth checking too, its own way. */
  const json = type === 'importmap' || type === 'application/json';
  blocks.push({ module: mod, json, body, at: HTML.slice(0, m.index).split('\n').length });
}
ok('index.html has script blocks to check', blocks.length > 0, 'found ' + blocks.length);

const dir = mkdtempSync(join(tmpdir(), 'duel-syntax-'));
try {
  blocks.forEach((b, i) => {
    /* An import map and `import ... from 'three'` are fine for a parser; only
       the *shape* of the file is under test here, not whether three is there. */
    const file = join(dir, 'block' + i + (b.module ? '.mjs' : '.js'));
    writeFileSync(file, b.body);
    let err = '';
    if (b.json) {
      try { JSON.parse(b.body); } catch (e) { err = 'not valid JSON: ' + e.message; }
    } else {
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (e) {
        err = String((e.stderr || e.stdout || e.message)).split('\n').slice(0, 6).join(' | ');
        /* --check reports the line inside the extracted file; say where that is
           in the HTML, which is the number anyone can actually act on. */
        const inner = /:(\d+)\n/.exec(String(e.stderr || ''));
        if (inner) err = 'near index.html line ' + (b.at + Number(inner[1])) + ' :: ' + err;
      }
    }
    const kind = b.json ? 'import map' : (b.module ? 'module' : 'classic');
    ok('script block ' + (i + 1) + ' (' + kind + ', ' + b.body.split('\n').length + ' lines) parses',
      !err, err);
  });
  /* The deliverables of the two features have to be findable in the file: a
     refactor that quietly drops one would still parse. */
  ok('the photo upload hook is in the page', /usePhotoSource/.test(HTML) && /id="photoBtn"/.test(HTML));
  ok('the torso shader patch is in the page', /onBeforeCompile/.test(HTML) && /uPhotoHas/.test(HTML));
  ok('the chromatic aberration pass is in the page', /ShaderPass/.test(HTML) && /uAmount/.test(HTML));
  ok('the effects are pooled, not per-hit', /boltPool/.test(HTML) && /flashPool/.test(HTML) &&
    /crestPool/.test(HTML) && /ringPool/.test(HTML));
  ok('the hit-stop counts frames', /freezeLeft/.test(HTML) && /freeze\(4\)/.test(HTML));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\na page that compiles');
console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + ': ' + pass + ' checks passed, ' +
  failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
process.exit(0);
