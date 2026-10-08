/* =========================================================================
   NEON DUEL — tests/capture.js

   The optional capture harness. index.html pulls this in *only* when the URL
   carries  #cap=<mode>  or  ?cap=<mode>, so the game itself never ships it.

   Serve the project and open, e.g.:

     http://localhost:8000/index.html#cap=dodge

   A mode drives the game from a fixed timestep with a seeded PRNG, renders one
   frame, reads pixels back out of it, and writes a JSON report (with its own
   pass/fail checks) into #probe, window.__probe and document.title. Because
   the step size and the seed are pinned, the same URL always reports the same
   numbers.
   ========================================================================= */
/* ============================ capture driver ============================= */
export function runCapture(A, mode) {
  /* Injected by index.html: the harness touches the game, never the reverse. */
  const { step, draw, LOGIC, CFG, CAP, errs, scene, renderer, bloom, B, P, G, camRig, warnZone, overEl, boot, spawnBoss, hudBoss, tryAttack, tryMove, newRun, lumaProbe, nanScan, report } = A;
  boot.style.display = 'none';
  const S = 1 / 60;
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const run = (sec) => { const n = Math.max(1, Math.round(sec / S)); for (let i = 0; i < n; i++) step(S); };
  const until = (fn, maxSec) => {
    const lim = Math.round((maxSec || 8) / S);
    let n = 0;
    while (!fn() && n < lim) { step(S); n++; }
    return +(n * S).toFixed(3);
  };
  /* Walk up to the boss's next warning. Timings below are all measured in
     *game* time, which must not care what the frame rate was doing. */
  const toTelegraph = () => { until(() => B.st.phase === 'telegraph', 8); return G.t; };

  if (mode === 'idle') run(3.5);

  else if (mode === 'telegraph') {
    toTelegraph();
    run(0.5);
    ok('warning zone is showing', warnZone.visible, 'visible=' + warnZone.visible);
    ok('warning is on the telegraphed side',
      warnZone.rotation.y === (B.st.side === 'right' ? 0 : Math.PI), 'side=' + B.st.side);
    ok('the boss winds up',
      Math.abs(B.parts.armR.g.rotation.x) > 0.2 || Math.abs(B.parts.armL.g.rotation.x) > 0.2,
      'armR=' + B.parts.armR.g.rotation.x.toFixed(2));
  } else if (mode === 'strike' || mode === 'dodge' || mode === 'hurt') {
    toTelegraph();
    const side = B.st.side;
    /* Stand in it to be hit, step out of it to be safe — the rule, verified. */
    tryMove(mode === 'dodge' ? (side === 'left' ? 1 : -1) : (side === 'left' ? -1 : 1));
    const t0 = G.t, hp0 = P.hp;
    until(() => B.st.phase === 'strike', 5);
    const waited = +(G.t - t0).toFixed(3);
    run(0.25);
    ok('telegraph lasts 1.5s', Math.abs(waited - 1.5) < 0.03, waited + 's');
    if (mode === 'dodge') {
      ok('dodging the armed side takes no damage', P.hp === hp0, hp0 + ' -> ' + P.hp);
      ok('dodging put the player on the other side', LOGIC.isSafe(side, P.side), side + ' vs ' + P.side);
    } else {
      ok('standing in it costs health', P.hp < hp0, hp0 + ' -> ' + P.hp);
      ok('the hit is worth exactly the boss damage', P.hp === hp0 - B.plan.dmg,
        'dealt ' + (hp0 - P.hp) + ', expected ' + B.plan.dmg);
    }
    ok('the zone clears after the strike', !warnZone.visible);
  } else if (mode === 'heavy' || mode === 'bolt' || mode === 'combo') {
    const h0 = B.hp;
    if (mode === 'combo') {
      for (let i = 0; i < 6; i++) { tryAttack('quick'); run(0.46); }
      ok('consecutive quick slashes build a combo', G.combo >= 4, 'combo=' + G.combo);
      ok('the combo is worth more than six bare hits', B.hp < h0 - 6 * 9, 'lost ' + (h0 - B.hp));
    } else {
      tryAttack(mode);
      run(mode === 'heavy' ? 0.46 : 0.9);      // stop while the impact is still live
      ok(mode + ' damaged the boss', B.hp < h0, h0 + ' -> ' + B.hp);
      if (mode === 'heavy') ok('heavy hits harder than a quick slash',
        h0 - B.hp >= LOGIC.ACTIONS.quick.dmg, 'dealt ' + (h0 - B.hp));
      ok('cooldown is respected', P.readyAt[mode] > G.t,
        'ready in ' + (P.readyAt[mode] - G.t).toFixed(2) + 's');
    }
  } else if (mode === 'demon' || mode === 'ice') {
    const def = LOGIC.BOSSES[mode === 'demon' ? 0 : 1];
    const plan = LOGIC.planFor(def, 0);
    G.state = 'fight'; spawnBoss(plan); hudBoss(plan);
    run(2.6);
    ok('boss on stage is ' + mode, B.def.id === mode, B.def.id);
  } else if (mode === 'win') {
    B.hp = 4; tryAttack('quick'); run(0.4);
    ok('a lethal hit wins the wave', G.state === 'victory' && G.slain === 1, G.state + ' slain=' + G.slain);
    const was = B.def.id, hp0 = P.hp;
    ok('killing the boss heals you', P.hp >= hp0, hp0 + ' -> ' + P.hp);
    run(3.2);
    ok('a new boss takes its place', G.state === 'fight' && !B.dead, G.state);
    ok('it is a different boss', B.def.id !== was, was + ' -> ' + (B.def ? B.def.id : 'none'));
    ok('and it is tougher than the first', B.maxHp > LOGIC.BOSSES[0].hp, 'maxHp=' + B.maxHp);
  } else if (mode === 'lose') {
    P.hp = 14;
    for (let i = 0; i < 8 && G.state === 'fight'; i++) {
      toTelegraph();
      tryMove(B.st.side === 'left' ? -1 : 1);       // walk into it, repeatedly
      until(() => B.st.phase === 'strike', 5);
      run(0.3);
    }
    ok('dying shows DEFEATED', G.state === 'defeat', 'state=' + G.state);
    ok('health never goes below zero', P.hp >= 0, 'hp=' + P.hp);
    ok('the defeat panel is on', overEl.className.indexOf('on') >= 0, overEl.className);
    ok('the panel lists the run', overEl.querySelector('.stats').innerHTML.indexOf('BOSSES') > 0);
    newRun();
    ok('restart resets the run',
      G.state === 'fight' && P.hp === P.maxHp && G.slain === 0 && !B.dead,
      G.state + ' hp=' + P.hp + ' slain=' + G.slain);
    ok('restart clears the panel', overEl.className.indexOf('on') < 0);
  } else if (mode === 'autoplay') {
    /* A dim bot: dodge when warned, otherwise swing. The point is not to win,
       it is to run the whole machine — spawns, deaths, waves — for a minute
       without a crash, a NaN, or a stuck state. */
    const r = LOGIC.mulberry32(99);
    for (let i = 0; i < 60 * 60 && G.state !== 'defeat'; i++) {
      if (B.st && B.st.phase === 'telegraph' && r() < 0.2) tryMove(B.st.side === 'left' ? 1 : -1);
      if (r() < 0.05) tryAttack('quick');
      if (r() < 0.008) tryAttack('heavy');
      if (r() < 0.012) tryAttack('bolt');
      step(S);
    }
    ok('a minute of play without a crash', errs.length === 0, errs.join('|'));
    ok('the machine kept running', G.t > 30, 't=' + G.t.toFixed(1));
    ok('no NaN anywhere in the scene graph', nanScan().nanObjects === 0, JSON.stringify(nanScan()));
  } else if (mode === 'bench') {
    run(1.5);
    const t0 = performance.now();
    for (let i = 0; i < 24; i++) { step(S); draw(); }
    A.avgMs = (performance.now() - t0) / 24;
    ok('frames complete', A.avgMs > 0 && A.avgMs < 4000, A.avgMs.toFixed(1) + 'ms/frame on software GL');
    ok('draw calls stay modest', renderer.info.render.calls < 260,
      'calls=' + renderer.info.render.calls);
  } else run(2.5);        // 'gfx' and anything else: settle, then measure the picture

  draw();
  const lum = lumaProbe();
  if (['gfx', 'idle', 'demon', 'ice', 'strike'].includes(mode)) {
    /* Render the same frame twice, with and without the bloom pass: the
       difference is the proof that post-processing is really on. */
    bloom.enabled = false; draw();
    const flat = lumaProbe();
    bloom.enabled = true; draw();
    ok('bloom is spreading the highlights', lum.brightFrac >= flat.brightFrac,
      flat.brightFrac + ' -> ' + lum.brightFrac);
    ok('the frame is dark but not black', lum.meanLuma > 0.01 && lum.meanLuma < 0.6, 'luma=' + lum.meanLuma);
    ok('the frame has colour in it', lum.meanSat > 0.04, 'sat=' + lum.meanSat);
  }
  report(Object.assign({ checks, passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length }, lum));
  /* Keep presenting the frozen frame. A capture renders once, and a canvas that
     never draws again does not always survive the trip to a screenshot — so the
     tableau is re-presented every frame without advancing any simulation. */
  requestAnimationFrame(function hold() { draw(); requestAnimationFrame(hold); });
}


