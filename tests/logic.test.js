/* =========================================================================
   NEON DUEL — tests/logic.test.js      run:  node tests/logic.test.js
   Headless: no browser, no three.js, no canvas.

   Every rule of the fight lives in one clearly marked block inside index.html,
   and this file lifts that block straight out of the page and exercises it. The
   claim the game makes is that a strike is decided by the side it lands on and
   that the warning is always 1.5s long — both testable, and both tested here.
   The pictures are checked separately, by the #cap= probes in the page itself.
   ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var A = SRC.indexOf('/* ==== PURE-LOGIC-START ==== */');
var B = SRC.indexOf('/* ==== PURE-LOGIC-END ==== */');
if (A < 0 || B < 0) {
  console.error('the pure-logic markers are missing from index.html');
  process.exit(2);
}
var LOGIC = new Function(SRC.slice(A, B) + '\nreturn LOGIC;')();

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

/* ------------------------------------------------------------------ maths */
section('maths');
(function () {
  near(LOGIC.clamp(5, 0, 1), 1, 0, 'clamp pulls a high value down');
  near(LOGIC.clamp(-5, 0, 1), 0, 0, 'clamp pulls a low value up');
  near(LOGIC.clamp(0.4, 0, 1), 0.4, 0, 'clamp leaves a value inside alone');
  near(LOGIC.lerp(2, 6, 0.5), 4, 0, 'lerp hits the midpoint');
  near(LOGIC.lerp(2, 6, 0), 2, 0, 'lerp hits the start');
  near(LOGIC.lerp(2, 6, 1), 6, 0, 'lerp hits the end');

  /* The reason damp exists: the same wall-clock second must smooth the same
     amount whether it arrives as one step or as sixty. */
  var one = LOGIC.damp(0, 1, 8, 1);
  var x = 0;
  for (var i = 0; i < 60; i++) x = LOGIC.damp(x, 1, 8, 1 / 60);
  near(x, one, 1e-9, 'damp is independent of the step size');
  near(one, 1 - Math.exp(-8), 1e-12, 'damp matches the closed form');
  ok(LOGIC.damp(0, 1, 8, 0.016) < 1, 'damp never overshoots in one step');
  ok(LOGIC.damp(0, 1, 8, 1e-9) >= 0, 'damp stays non-negative');
  near(LOGIC.damp(3, 3, 8, 0.5), 3, 1e-12, 'damp at rest stays at rest');
})();

/* -------------------------------------------------------------------- rng */
section('the random number generator');
(function () {
  var a = LOGIC.mulberry32(1234), b = LOGIC.mulberry32(1234), c = LOGIC.mulberry32(1235);
  var same = true, inRange = true, min = 1, max = 0, sum = 0, n = 20000, diff = false;
  for (var i = 0; i < n; i++) {
    var v = a(), w = b(), u = c();
    if (v !== w) same = false;
    if (u !== v) diff = true;
    if (!(v >= 0 && v < 1)) inRange = false;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  ok(same, 'the same seed replays the same numbers');
  ok(diff, 'a different seed gives different numbers');
  ok(inRange, 'every value lands in [0,1)', 'min ' + min + ' max ' + max);
  near(sum / n, 0.5, 0.02, 'and the stream is centred');
  ok(min < 0.01 && max > 0.99, 'and it reaches both ends', 'min ' + min + ' max ' + max);
})();


/* ------------------------------------------------------------------ moves */
section('the three moves');
(function () {
  var A = LOGIC.ACTIONS;
  ok(A.quick.dmg < A.bolt.dmg && A.bolt.dmg < A.heavy.dmg,
    'damage rises quick < bolt < heavy', A.quick.dmg + '/' + A.bolt.dmg + '/' + A.heavy.dmg);
  ok(A.quick.cd < A.bolt.cd && A.bolt.cd < A.heavy.cd,
    'cooldown rises quick < bolt < heavy', A.quick.cd + '/' + A.bolt.cd + '/' + A.heavy.cd);
  ['quick', 'heavy', 'bolt'].forEach(function (k) {
    var m = A[k];
    ok(m.windup > 0 && m.windup < m.hit, k + ' has a wind-up before its hit');
    ok(m.hit < m.cd, k + ' can never hit twice inside one cooldown');
    ok(m.dmg > 0, k + ' does damage');
  });
  ok(A.heavy.cd >= 3, 'the heavy swing is a real commitment', A.heavy.cd + 's');
  ok(A.quick.cd <= 0.5, 'and the quick slash is not', A.quick.cd + 's');
})();

/* ------------------------------------------------------------------ bosses */
section('boss selection and scaling');
(function () {
  var rng = LOGIC.mulberry32(7);
  var last = null, repeats = 0, counts = { demon: 0, ice: 0 }, n = 4000;
  for (var i = 0; i < n; i++) {
    var def = LOGIC.rollBoss(rng, last);
    if (def.id === last) repeats++;
    counts[def.id]++;
    last = def.id;
  }
  ok(repeats === 0, 'the same boss never walks in twice in a row', repeats + ' repeats');
  ok(counts.demon > n * 0.4 && counts.ice > n * 0.4, 'both bosses get used',
    JSON.stringify(counts));
  ok(!!LOGIC.rollBoss(LOGIC.mulberry32(1), null), 'a first boss can be rolled from nothing');

  LOGIC.BOSSES.forEach(function (def) {
    var plan = LOGIC.planFor(def, 0);
    near(plan.telegraph, 1.5, 1e-12, def.id + ' warns for exactly 1.5s');
    ok(plan.hp === def.hp && plan.dmg === def.dmg, def.id + ' starts at its own numbers');
    var harder = LOGIC.planFor(def, 6);
    ok(harder.hp > plan.hp, def.id + ' gains health as the run goes on', plan.hp + ' -> ' + harder.hp);
    ok(harder.dmg > plan.dmg, def.id + ' hits harder as the run goes on');
    ok(harder.recover < plan.recover, def.id + ' gives you less time to breathe');
    near(LOGIC.planFor(def, 60).telegraph, 1.5, 1e-12, def.id + ' still warns for 1.5s at wave 61');
    ok(LOGIC.planFor(def, 60).recover >= 0.62, def.id + ' never shortens recovery past the floor');
    ok(LOGIC.planFor(def, 1).hp === Math.round(def.hp * 1.12), def.id + ' gains 12% per wave',
      plan.hp + ' -> ' + LOGIC.planFor(def, 1).hp);
  });
})();

/* ------------------------------------------------------------------- sides */
section('which half you are standing in');
(function () {
  ok(LOGIC.sideOf(-2.6) === 'left', 'negative x is the left half');
  ok(LOGIC.sideOf(2.6) === 'right', 'positive x is the right half');
  ok(LOGIC.sideOf(0) === 'right', 'dead centre counts as the right half');
  ok(LOGIC.otherSide('left') === 'right', 'the other side of left is right');
  ok(LOGIC.otherSide('right') === 'left', 'the other side of right is left');
  ['left', 'right'].forEach(function (a) {
    ['left', 'right'].forEach(function (p) {
      var safe = LOGIC.isSafe(a, p);
      ok(safe === (a !== p), 'standing ' + p + ' against a ' + a + ' strike is ' +
        (safe ? 'safe' : 'a hit'));
    });
  });

/* ----------------------------------------------------------------- damage */
section('damage dealt and taken');
(function () {
  var rng = LOGIC.mulberry32(99), i, r;
  var crits = 0, n = 8000, lo = 1e9, hi = 0, ints = true;
  for (i = 0; i < n; i++) {
    r = LOGIC.hitFor('quick', 0, rng);
    if (r.crit) crits++;
    if (r.amount < lo) lo = r.amount;
    if (r.amount > hi) hi = r.amount;
    if (r.amount !== Math.round(r.amount)) ints = false;
  }
  ok(ints, 'damage is always a whole number');
  near(crits / n, LOGIC.CRIT_CHANCE, 0.02, 'critical hits land at the advertised rate');
  ok(lo === LOGIC.ACTIONS.quick.dmg, 'a plain quick slash is exactly its base damage', String(lo));
  var top = Math.ceil(LOGIC.ACTIONS.quick.dmg * 1.3 * LOGIC.CRIT_MULT);
  ok(hi <= top && hi > LOGIC.ACTIONS.quick.dmg, 'and a full-combo crit tops out at the cap',
    hi + ' <= ' + top);

  function avg(move, combo) {
    var s = 0, m = 4000, g = LOGIC.mulberry32(5);
    for (var k = 0; k < m; k++) s += LOGIC.hitFor(move, combo, g).amount;
    return s / m;
  }
  ok(avg('quick', 8) > avg('quick', 0) * 1.15, 'a combo is worth real damage',
    avg('quick', 0) + ' -> ' + avg('quick', 8));
  ok(avg('quick', 30) === avg('quick', 10), 'and it stops paying out past the cap');
  ok(avg('heavy', 0) > avg('bolt', 0) && avg('bolt', 0) > avg('quick', 0),
    'the moves keep their order on average');

  near(LOGIC.incoming(18, 100), 82, 0, 'a demon strike takes 18 off 100');
  near(LOGIC.incoming(22, 20), 0, 0, 'a killing blow floors at zero, never negative');
  near(LOGIC.incoming(0, 100), 100, 0, 'a zero-damage hit changes nothing');
  near(LOGIC.incoming(1e9, 100), 0, 0, 'and neither does an absurd one');
})();

/* ------------------------------------------------------------------ combo */
section('the combo counter');
(function () {
  var W = LOGIC.COMBO_WINDOW;
  ok(W >= 1.5 && W <= 4, 'the combo window is human-sized', W + 's');
  near(LOGIC.comboAfterHit(0, 10, -99), 1, 0, 'the first hit starts a combo of one');
  near(LOGIC.comboAfterHit(1, 10.5, 10), 2, 0, 'a hit inside the window extends it');
  near(LOGIC.comboAfterHit(7, 10.5, 10), 8, 0, 'and it keeps climbing');
  near(LOGIC.comboAfterHit(7, 10 + W + 0.01, 10), 1, 0, 'a hit after the window starts over');
  near(LOGIC.comboAfterHit(7, 10 + W, 10), 8, 0, 'the window boundary itself is inclusive');
  near(LOGIC.comboTick(5, 10, 10), 5, 0, 'a live combo survives a tick');
  near(LOGIC.comboTick(5, 10 + W + 0.01, 10), 0, 0, 'an expired combo is cleared');
  near(LOGIC.comboTick(0, 999, -99), 0, 0, 'a cleared combo stays cleared');
  near(LOGIC.comboMult(0), 1, 0, 'no combo is no bonus');
  near(LOGIC.comboMult(10), 1.3, 1e-12, 'ten hits is a 30% bonus');
  near(LOGIC.comboMult(50), 1.3, 1e-12, 'and it is capped there');
})();

/* -------------------------------------------------------------- cooldowns */
section('cooldowns');
(function () {
  var at = LOGIC.readyAt(10, 0.42);
  near(at, 10.42, 1e-12, 'a cooldown ends when it says it does');
  ok(LOGIC.isReady(at, at), 'ready exactly on the tick');
  ok(!LOGIC.isReady(at - 0.001, at), 'not ready a millisecond early');
  near(LOGIC.cdFraction(10, at, 0.42), 1, 1e-12, 'a fresh cooldown reads full');
  near(LOGIC.cdFraction(at, at, 0.42), 0, 0, 'a finished cooldown reads empty');
  near(LOGIC.cdFraction(99, at, 0.42), 0, 0, 'and never reads below empty');
  near(LOGIC.cdFraction(0, at, 0.42), 1, 0, 'nor above full');
  var prev = 2, monotone = true;
  for (var t = 10; t <= at; t += 0.01) {
    var f = LOGIC.cdFraction(t, at, 0.42);
    if (f > prev + 1e-9) monotone = false;
    prev = f;
  }
  ok(monotone, 'the cooldown pie only ever fills back up');
})();

})();


/* ------------------------------------------------- the attack state machine */
section('the boss attack cycle');
(function () {
  var plan = LOGIC.planFor(LOGIC.BOSSES[0], 0);

  /* Runs the machine at a fixed step and reports how long the warning lasted,
     measured the only way a player would experience it: in game seconds. */
  function measure(step) {
    var s = LOGIC.bossInit(plan, LOGIC.mulberry32(3));
    var t = 0, i;
    ok(s.phase === 'idle', 'a fresh boss waits instead of swinging');
    for (i = 0; i < Math.round(plan.recover / step); i++) {
      LOGIC.bossStep(s, step); t += step;
    }
    ok(s.phase === 'idle', 'it is still waiting just before its recovery ends');
    while (s.phase !== 'telegraph' && t < 20) { LOGIC.bossStep(s, step); t += step; }
    var warnedAt = t, side = s.side;
    ok(side === 'left' || side === 'right', 'the warning always picks a real side', String(side));
    var ev = [], struck = 0;
    while (s.phase === 'telegraph' && t < 20) {
      ev = LOGIC.bossStep(s, step);
      t += step;
    }
    ev.forEach(function (e) { if (e.type === 'strike') struck++; });
    return { warn: t - warnedAt, side: side, strikes: struck };
  }

  var a = measure(1 / 60), b = measure(1 / 240);
  /* The warning is only ever observed at a frame boundary, so one frame of
     granularity is the correct tolerance here — not a fudge factor. */
  ok(Math.abs(a.warn - 1.5) <= 1.5 / 60, 'the warning lasts 1.5s at 60fps', a.warn.toFixed(4) + 's');
  ok(Math.abs(b.warn - 1.5) <= 1.5 / 240, 'and 1.5s at 240fps', b.warn.toFixed(4) + 's');
  ok(Math.abs(a.warn - b.warn) <= 1 / 60, 'the two agree with each other',
    b.warn.toFixed(4) + ' vs ' + a.warn.toFixed(4));
  ok(a.strikes === 1 && b.strikes === 1, 'exactly one strike is emitted per warning',
    a.strikes + '/' + b.strikes);

  /* A long run: the machine must keep cycling, never stall, never invent a phase. */
  var s = LOGIC.bossInit(LOGIC.planFor(LOGIC.BOSSES[1], 0), LOGIC.mulberry32(11));
  var seen = { telegraph: 0, strike: 0, recover: 0 }, bogus = 0, bad = 0;
  var i2, j;
  for (i2 = 0; i2 < 60 * 400; i2++) {
    LOGIC.bossStep(s, 1 / 60).forEach(function (e) {
      if (seen[e.type] === undefined) bogus++; else seen[e.type]++;
    });
    if (s.phase !== 'idle' && s.phase !== 'telegraph' && s.phase !== 'strike') bad++;
  }
  ok(bogus === 0, 'no unknown events are ever emitted', bogus);
  ok(bad === 0, 'the machine only ever sits in a known phase', bad);
  ok(seen.strike > 90, 'it keeps swinging for the whole run', seen.strike + ' strikes in 400s');
  /* A fixed-length run can stop in the middle of a cycle, which is worth one. */
  ok(Math.abs(seen.recover - seen.strike) <= 1, 'every strike is followed by a recovery',
    seen.strike + ' vs ' + seen.recover);
  ok(Math.abs(seen.telegraph - seen.strike) <= 1, 'and every telegraph ends in a strike');

  /* Difficulty has to be felt as more swings, not as a shorter warning. */
  var easy = LOGIC.bossInit(LOGIC.planFor(LOGIC.BOSSES[0], 0), LOGIC.mulberry32(2));
  var hard = LOGIC.bossInit(LOGIC.planFor(LOGIC.BOSSES[0], 10), LOGIC.mulberry32(2));
  for (j = 0; j < 60 * 60; j++) { LOGIC.bossStep(easy, 1 / 60); LOGIC.bossStep(hard, 1 / 60); }
  ok(hard.strikes > easy.strikes, 'a late-wave boss attacks more often in the same minute',
    easy.strikes + ' -> ' + hard.strikes);
  near(easy.plan.telegraph, hard.plan.telegraph, 1e-12, 'and never warns for less time');
  ok(LOGIC.telegraphT(easy) === 0 || (LOGIC.telegraphT(easy) > 0 && LOGIC.telegraphT(easy) <= 1),
    'the warning progress reads 0..1', String(LOGIC.telegraphT(easy)));
  ok(LOGIC.telegraphT({ phase: 'idle', t: 5, plan: plan }) === 0, 'and reads zero when not warning');
})();

/* ------------------------------------------------------------ a whole fight */
section('a whole fight, played out');
(function () {
  var rng = LOGIC.mulberry32(4242), step = 1 / 60;
  var waves = 0, hits = 0, dodges = 0, deaths = 0, badHp = 0, wrongDamage = 0;
  var run, hpx, guard, wave, plan, s, combo, lastHit, t, evs, k;
  for (run = 0; run < 12; run++) {
    for (wave = 0; wave < 5; wave++) {
      plan = LOGIC.planFor(LOGIC.rollBoss(rng, null), wave);
      s = LOGIC.bossInit(plan, rng);
      hpx = 100; combo = 0; lastHit = -99; t = 0; guard = 0;
      while (hpx > 0 && s.strikes < 40 && guard++ < 60 * 900) {
        t += step;
        combo = LOGIC.comboTick(combo, t, lastHit);
        evs = LOGIC.bossStep(s, step);
        for (k = 0; k < evs.length; k++) {
          if (evs[k].type !== 'strike') continue;
          /* The bot dodges half the time; when it does not, it must be hit. */
          var playerSide = rng() < 0.5 ? LOGIC.otherSide(evs[k].side) : evs[k].side;
          if (LOGIC.isSafe(evs[k].side, playerSide)) { dodges++; continue; }
          var before = hpx;
          hpx = LOGIC.incoming(plan.dmg, hpx);
          if (before - hpx !== plan.dmg && hpx > 0) wrongDamage++;
          hits++;
        }
        if (rng() < 0.4) {                        // swing back at it
          LOGIC.hitFor('quick', combo, rng);
          combo = LOGIC.comboAfterHit(combo, t, lastHit);
          lastHit = t;
        }
      }
      if (hpx <= 0) deaths++;
      if (hpx < 0 || hpx > 100) badHp++;
      waves++;
    }
  }
  ok(waves === 60, 'sixty waves were played end to end', String(waves));
  ok(hits > 200 && dodges > 200, 'both outcomes happened plenty of times',
    hits + ' hits / ' + dodges + ' dodges');
  ok(deaths > 0, 'standing still eventually kills you', deaths + ' deaths');
  ok(badHp === 0, 'health never leaves its legal range', badHp);
  ok(wrongDamage === 0, 'every hit that lands costs exactly the boss damage', wrongDamage);
  var hp2 = 100, total = 0;
  while (hp2 > 0) { hp2 = LOGIC.incoming(18, hp2); total++; }
  ok(total === 6, 'and 18 damage off 100 is six clean strikes', String(total));
})();

done();
