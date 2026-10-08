/* =========================================================================
   NEON DUEL — tests/audio.test.js      run:  node tests/audio.test.js
   Headless: no browser, no Web Audio, no speakers.

   The score is data before it is sound: `stepPlan(k)` turns a sixteenth index
   into a list of notes, and it is lifted straight out of index.html and read
   here. So the harmony, the drum grid, the tempo and the two keys are all
   checkable without rendering a single sample.

   What cannot be read as data — the actual waveform — is measured instead by
   `#cap=audio`, which renders the same notes into an OfflineAudioContext and
   counts the samples. This file is the theory; that one is the signal.
   ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var A = SRC.indexOf('/* ==== AUDIO-PURE-START ==== */');
var B = SRC.indexOf('/* ==== AUDIO-PURE-END ==== */');
if (A < 0 || B < 0) {
  console.error('the audio-pure markers are missing from index.html');
  process.exit(2);
}
var SC = new Function(SRC.slice(A, B) +
  '\nreturn { stepPlan, MIDI, PROG, KEYS, KICK, SNARE, ARP, BPM, BEAT, S16, BAR };')();
var stepPlan = SC.stepPlan, MIDI = SC.MIDI;
var plan = function (k, element, heat) {
  return stepPlan(k, { element: element || 'fire', heat: heat == null ? 0.3 : heat });
};
var of = function (k, name, element, heat) {
  return plan(k, element, heat).filter(function (n) { return n.inst === name; });
};

var pass = 0, fail = 0, group = '', failures = [];
function ok(cond, what, detail) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(group + ' :: ' + what + (detail == null ? '' : '  [' + detail + ']'));
  return false;
}
function near(a, b, tol, what) {
  return ok(Math.abs(a - b) <= tol, what, 'got ' + a + ', expected ' + b + ' +-' + tol);
}
function section(name) { group = name; console.log('\n' + name); }
function done() {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) { failures.forEach(function (f) { console.log('  x ' + f); }); process.exit(1); }
  process.exit(0);
}

/* ------------------------------------------------------------------- tempo */
section('tempo and grid');
(function () {
  near(SC.BPM, 132, 0, 'the track is 132bpm');
  near(SC.BEAT, 60 / 132, 1e-12, 'a beat is 60/132 seconds');
  near(SC.S16, 60 / 132 / 4, 1e-12, 'a sixteenth is a quarter of a beat');
  var bar = SC.BAR * SC.S16;
  near(bar, (60 / 132) * 4, 1e-12, 'sixteen sixteenths make one 4/4 bar');
  ok(bar > 1.7 && bar < 1.9, 'a bar is about 1.8s at this tempo', bar.toFixed(3) + 's');
  var empty = [];
  for (var k = 0; k < 128; k++) if (!plan(k).length) empty.push(k);
  ok(empty.length === 0, 'eight bars never fall silent', 'silent steps: ' + empty.join(','));
  ok(plan(0).every(function (n) { return n.at === 0; }), 'every note is placed inside its own step');
  ok(plan(0).every(function (n) { return n.gain > 0 && n.gain <= 1; }), 'no note is asked for with a silly gain');
})();


/* ---------------------------------------------------------------- harmony */
section('harmony');
(function () {
  /* i - VI - III - VII in D minor, the four bars every synthwave track owns. */
  var want = [[38, 62, 65, 69], [34, 58, 62, 65], [41, 53, 57, 60], [36, 60, 64, 67]];
  ok(SC.PROG.length === 4, 'the progression is four bars long', SC.PROG.length);
  want.forEach(function (w, i) {
    var c = SC.PROG[i];
    ok(c.root === w[0], 'bar ' + i + ' has the root written down', 'root ' + c.root + ' vs ' + w[0]);
    ok(c.tones.join() === w.slice(1).join(), 'bar ' + i + ' has the chord written down',
      c.tones.join() + ' vs ' + w.slice(1).join());
  });
  /* Every chord tone has to belong to D natural minor, or the loop is a lie. */
  var D_MINOR = [0, 2, 3, 5, 7, 8, 10].map(function (s) { return (38 + s) % 12; });
  var off = [];
  SC.PROG.forEach(function (c) {
    c.tones.forEach(function (m) { if (D_MINOR.indexOf(m % 12) < 0) off.push(m); });
  });
  ok(off.length === 0, 'every chord tone is in D natural minor',
    off.length ? 'outsiders: ' + off.join(',') : 'seven notes, no accidents');

  /* The bass must play the chord that is under it, all sixteen bars of it. */
  var wrong = [];
  for (var b = 0; b < 16; b++) {
    var k0 = b * SC.BAR;
    for (var k = k0; k < k0 + SC.BAR; k++) {
      of(k, 'bass').forEach(function (n) {
        var d = n.midi - SC.PROG[b % 4].root;
        if (d !== 0 && d !== 12) wrong.push(k + ':' + n.midi);
      });
    }
  }
  ok(wrong.length === 0, 'every bass note is the current root or its octave',
    wrong.slice(0, 4).join(' ') || '16 bars checked');

  /* The lead plays the chord too, an octave up, and never wanders off it. */
  var stray = [];
  for (var k2 = 0; k2 < 64; k2++) {
    (function (k3) {
      var ch = SC.PROG[Math.floor(k3 / SC.BAR) % 4].tones;
      of(k3, 'lead').forEach(function (n) {
        var m = n.midi - 12;
        if (ch.indexOf(m) < 0 && ch.indexOf(m - 12) < 0 && ch.indexOf(m + 12) < 0) stray.push(k3 + ':' + n.midi);
      });
    })(k2);
  }
  ok(stray.length === 0, 'every lead note is a chord tone an octave up',
    stray.slice(0, 4).join(' ') || '64 steps checked');

  /* The pad holds the chord for the bar, and comes back every bar. */
  var pads = of(0, 'pad');
  ok(pads.length === 1, 'one pad per bar', String(pads.length));
  ok(pads[0].midis.length === 3, 'the pad plays a triad', pads[0].midis.join());
  near(pads[0].dur, SC.BAR * SC.S16, 1e-12, 'the pad lasts the whole bar');
  var padBars = 0;
  for (var k4 = 0; k4 < SC.BAR * 4; k4++) padBars += of(k4, 'pad').length;
  ok(padBars === 4, 'four bars, four pads', String(padBars));
})();

/* -------------------------------------------------------------- both keys */
section('the two bosses, two keys');
(function () {
  ok(SC.KEYS.fire.shift === 0 && SC.KEYS.ice.shift === 7,
    'the titan plays a fifth above the demon', 'fire +' + SC.KEYS.fire.shift + ', ice +' + SC.KEYS.ice.shift);
  var A_MINOR = [9, 11, 0, 2, 4, 5, 7];
  var aMinor = SC.PROG.map(function (c) { return (c.root + 7) % 12; });
  ok(aMinor.every(function (n) { return A_MINOR.indexOf(n) >= 0; }),
    'transposed, the same progression lands in A minor', aMinor.join());
  var shifted = plan(3, 'ice').filter(function (n) { return n.midi != null; }).map(function (n) { return n.midi; });
  var plain = plan(3, 'fire').filter(function (n) { return n.midi != null; }).map(function (n) { return n.midi; });
  ok(shifted.length === plain.length && shifted.every(function (m, i) { return m === plain[i] + 7; }),
    'every pitched ice note is exactly seven semitones up', shifted.join() + ' vs ' + plain.join());
  ok(SC.KEYS.ice.bell === 1 && SC.KEYS.fire.bell === 0, 'only the titan rings a bell');
  ok(SC.KEYS.ice.lead !== SC.KEYS.fire.lead, 'the two leads use different oscillators',
    SC.KEYS.fire.lead + ' / ' + SC.KEYS.ice.lead);
})();

/* ------------------------------------------------------------- drum grid */
section('the drum grid');
(function () {
  var kicks = [], snares = [], hats = 0;
  for (var s = 0; s < SC.BAR; s++) {
    if (of(s, 'kick', 'fire', 0.2).length) kicks.push(s);
    if (of(s, 'snare', 'fire', 0.2).length) snares.push(s);
    hats += of(s, 'hat', 'fire', 0.2).length;
  }
  ok(kicks.join() === '0,4,8,12', 'the kick is on all four beats', kicks.join());
  ok(snares.join() === '4,12', 'the snare is on two and four', snares.join());
  ok(hats === 8, 'the hats are eighths', String(hats));
  ok(of(0, 'kick', 'fire', 0.2)[0].gain === 1, 'the kick is the loudest thing in the plan');
  ok(of(SC.BAR - 2, 'hat', 'fire', 0.2)[0].open === true, 'the last hat of the bar is the open one');
  ok(of(SC.BAR - 2, 'kick', 'fire', 0.9).length === 1, 'a hot wave adds a kick before the turn');
  ok(of(SC.BAR - 2, 'kick', 'fire', 0.2).length === 0, 'a calm one does not');
  /* The bar the loop turns over on gets a fill. */
  var fill = 0;
  for (var k = 7 * SC.BAR + 8; k < 8 * SC.BAR; k++) fill += of(k, 'snare', 'fire', 0.2).length;
  ok(fill >= 6, 'bar eight runs a snare fill into the repeat', fill + ' snares in its second half');
  ok(of(0, 'snare', 'fire', 0.2).length === 0, 'and the fill does not leak into bar one');
})();


/* ------------------------------------------------------------------ heat */
section('heat is the wave\u2019s temper');
(function () {
  var count = function (h) {
    var n = 0;
    for (var k = 0; k < SC.BAR * 4; k++) n += plan(k, 'fire', h).length;
    return n;
  };
  /* heat is a step function, not a slope: the layers come in at 0.35 (the
     extra kick), 0.5 (sixteenth hats) and 0.55 (the lead on every sixteenth).
     So test the ladder the game actually climbs — heatOf() gives 0.25, 0.45,
     0.65, 0.85, 1.0 as the waves stack up — not an imaginary smooth ramp. */
  var ladder = [0.25, 0.45, 0.65, 0.85, 1].map(count);
  ok(ladder[0] < ladder[1] && ladder[1] < ladder[2], 'each early wave adds a layer',
    ladder.join(' -> '));
  ok(ladder[4] >= ladder[3] && ladder[3] >= ladder[2], 'and the ladder never goes backwards',
    ladder.join(' -> '));
  var gains = [0.25, 0.45, 0.65, 0.85, 1].map(function (h) { return of(1, 'lead', 'fire', h)[0].gain; });
  ok(gains.every(function (g, i) { return i === 0 || g > gains[i - 1]; }),
    'and the lead keeps getting louder on top of that',
    gains.map(function (g) { return g.toFixed(3); }).join(' -> '));
  var hats = function (h) {
    var n = 0;
    for (var k = 0; k < SC.BAR; k++) n += of(k, 'hat', 'fire', h).length;
    return n;
  };
  ok(hats(0.2) === 8, 'a calm wave plays eighth-note hats', String(hats(0.2)));
  ok(hats(0.9) === 16, 'a hot wave plays sixteenths', String(hats(0.9)));
  var leads = function (h) {
    var n = 0;
    for (var k = 0; k < SC.BAR; k++) n += of(k, 'lead', 'fire', h).length;
    return n;
  };
  ok(leads(0.2) === 8 && leads(0.9) === 16, 'the lead doubles up when it gets hot',
    leads(0.2) + ' -> ' + leads(0.9));
  ok(of(1, 'lead', 'fire', 0.9)[0].gain >= of(1, 'lead', 'fire', 0.2)[0].gain,
    'the lead is not quieter when hot');
  /* Heat is clamped by the game, but the score must not care how it arrives. */
  ok(plan(0, 'fire', 2).length === plan(0, 'fire', 0.9).length, 'a heat above 1 behaves like 1');
})();

/* ------------------------------------------------------------ determinism */
section('a score, not a dice roll');
(function () {
  var shape = function (k, el, h) {
    return plan(k, el, h).map(function (n) { return n.inst + '#' + (n.midi || 0); }).join('|');
  };
  ok(JSON.stringify(plan(37)) === JSON.stringify(plan(37)), 'the same step twice names the same notes');
  ok(JSON.stringify(plan(37, 'ice', 0.9)) === JSON.stringify(plan(37, 'ice', 0.9)),
    'and the same again in the titan\u2019s key');
  ok(shape(0) !== shape(4), 'bar two is not a copy of bar one', shape(0) + ' vs ' + shape(4));
  var period = true;
  for (var k = 0; k < 32; k++) if (shape(k) !== shape(k + 64)) period = false;
  ok(period, 'the eight-bar pattern repeats exactly', '32 steps checked against +64');
  /* No NaN can reach an oscillator: an infinite frequency throws, and a silent
     one is worse — it looks like the game has no sound at all. */
  var bad = [];
  for (var k2 = 0; k2 < 64; k2++) {
    plan(k2, k2 % 2 ? 'ice' : 'fire', 0.9).forEach(function (n) {
      var f = n.midi == null ? 0 : MIDI(n.midi);
      if (!Number.isFinite(f) || (n.midi != null && (f < 20 || f > 18000))) bad.push(n.inst + ':' + n.midi);
    });
  }
  ok(bad.length === 0, 'every note is a frequency a speaker can produce',
    bad.slice(0, 3).join(' ') || '64 steps, both keys, all inside 20Hz-18kHz');
  near(MIDI(69), 440, 1e-9, 'A4 is 440Hz');
  near(MIDI(60), 261.6255653, 1e-6, 'middle C is 261.63Hz');
  near(MIDI(38), 73.41619198, 1e-6, 'D2, the root of the whole track, is 73.42Hz');
  ok(MIDI(12) > 0 && MIDI(127) < 13000, 'the whole MIDI range stays sane',
    MIDI(12).toFixed(1) + '-' + MIDI(127).toFixed(0));
  var names = [];
  for (var k3 = 0; k3 < SC.BAR * 8; k3++) {
    plan(k3, 'ice', 0.9).forEach(function (n) { if (names.indexOf(n.inst) < 0) names.push(n.inst); });
  }
  var allowed = ['kick', 'snare', 'hat', 'bass', 'lead', 'pad'];
  ok(names.every(function (n) { return allowed.indexOf(n) >= 0; }) && names.length === allowed.length,
    'the plan only ever calls the band that exists', names.join());
  ok(SC.ARP.every(function (a) { return Number.isInteger(a) && a >= 0 && a <= 3; }),
    'every arpeggio index points at a chord tone (3 means the root, up an octave)', SC.ARP.join());
  ok(SC.KICK.join() === '0,4,8,12' && SC.SNARE.join() === '4,12', 'the grid constants are where they say');
})();

done();
