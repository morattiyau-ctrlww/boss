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

  /* ---- audio: the sound is measured, not described ------------------------ */
  /* Nothing here listens to anything. The same synth the arena plays through is
     rendered into an OfflineAudioContext — faster than real time, and without
     an output device — and then the samples are counted: "it has music" and "a
     sword makes a noise" become numbers, exactly like "it glows" did. */
  if (mode === 'audio') return audioProbe().catch((e) => report({
    checks, passed: 0, failed: 1, audioError: String((e && e.stack) || e) }));

  async function audioProbe() {
    const AU = A.AUDIO;
    const SR = 44100;
    const stats = (d) => {
      let sum = 0, peak = 0, clip = 0, tail = 0, tn = 0;
      for (let i = 0; i < d.length; i++) {
        const v = d[i], av = Math.abs(v);
        sum += v * v;
        if (av > peak) peak = av;
        if (av >= 0.999) clip++;
        if (i > d.length - 4410) { tail += v * v; tn++; }
      }
      return { rms: Math.sqrt(sum / d.length), peak, clip, tail: Math.sqrt(tail / Math.max(1, tn)) };
    };
    /* Energy at one frequency (Goertzel). A whole spectrum would be overkill to
       answer "is there a kick down there and hats up there". */
    const band = (d, f) => {
      const coef = 2 * Math.cos(2 * Math.PI * f / SR);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < d.length; i++) { const s0 = d[i] + coef * s1 - s2; s2 = s1; s1 = s0; }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coef * s1 * s2)) / d.length;
    };
    const render = async (secs, build) => {
      const oc = new OfflineAudioContext(2, Math.ceil(SR * secs), SR);
      build(AU.graph(oc), oc);
      const buf = await oc.startRendering();
      return { L: buf.getChannelData(0), R: buf.getChannelData(1) };
    };
    const differs = (d, e) => {
      for (let i = 0; i < d.length; i += 97) if (Math.abs(d[i] - e[i]) > 1e-7) return true;
      return false;
    };

    /* --- the loop --------------------------------------------------------- */
    AU.setElement('fire'); AU.setHeat(0.3);
    const music = (secs) => render(2.0, (gg) => {
      const n = Math.floor(secs / AU.grid.S16);
      for (let k = 0; k < n; k++) AU.voiceStep(gg, k, 0.05 + k * AU.grid.S16);
    });
    const m1 = await music(2);
    const M = stats(m1.L), MR = stats(m1.R);
    ok('the loop makes sound', M.rms > 0.01 && M.rms < 0.5, 'rms=' + M.rms.toFixed(4));
    ok('nothing in it clips', M.clip === 0 && M.peak <= 0.999, 'peak=' + M.peak.toFixed(3));
    ok('there is a low end to it', band(m1.L, 60) > 0.002, 'kick@60Hz=' + band(m1.L, 60).toFixed(5));
    /* A hat is a 45ms transient and a broadband one, so a single Goertzel bin
       over two seconds reports nothing at all — the right probe is broadband
       brightness (the sample-to-sample difference is a one-line high-pass).
       Compare where it lands with the beat just after it as the control: the
       claim being tested is that the cymbals are on the beat. */
    const bright = (d, s, secs) => {
      const a = Math.floor(s * SR), b = Math.floor((s + secs) * SR);
      let sum = 0;
      for (let i = a + 1; i < b; i++) { const v = d[i] - d[i - 1]; sum += v * v; }
      return Math.sqrt(sum / Math.max(1, b - a));
    };
    const beat = 0.05 + 2 * AU.grid.S16, gap = 0.05 + 3 * AU.grid.S16;
    const hOn = bright(m1.L, beat, 0.15), hOff = bright(m1.L, gap, 0.15);
    ok('the hats land on the beat', hOn > hOff * 1.5 && hOn > 0.001,
      'brightness on the beat ' + hOn.toFixed(5) + ' vs off it ' + hOff.toFixed(5));
    ok('the loop is in stereo', MR.rms > 0.001 && differs(m1.L, m1.R),
      'rms L/R = ' + M.rms.toFixed(4) + '/' + MR.rms.toFixed(4));
    /* Same seed, same noise buffer, same notes: no Math.random in the signal
       path, so two renders of the same bar differ only by float32 rounding —
       an unseeded source would show up here as a difference of whole percent. */
    const m2 = await music(2);
    const dMax = (d, e) => { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - e[i])); return m; };
    const drift = dMax(m1.L, m2.L);
    ok('a second render is the same signal', drift < 1e-5, 'max sample drift=' + drift.toExponential(2));
    /* The titan plays in a different key — the signal should know. */
    AU.setElement('ice');
    const mIce = await music(2);
    ok('the ice titan gets its own arrangement', differs(m1.L, mIce.L),
      'rms ' + M.rms.toFixed(4) + ' -> ' + stats(mIce.L).rms.toFixed(4));
    AU.setElement('fire');
    /* Heat is the wave's temper: hotter waves hit more often. */
    AU.setHeat(0.9);
    const mHot = await music(2);
    ok('later waves are busier', stats(mHot.L).rms > M.rms, stats(mHot.L).rms.toFixed(4) + ' > ' + M.rms.toFixed(4));
    AU.setHeat(0.3);

    /* --- every sound effect ----------------------------------------------- */
    /* One render each, and only the two sounds that branch on the element get
       a second one: off-line rendering costs virtual time, and the sweep has a
       budget to live inside. */
    const names = Object.keys(AU.sfx);
    const quiet = [], clipped = [], short = [];
    const levels = {};
    for (const name of names) {
      AU.setElement('fire');
      const s = stats((await render(1.0, (gg) => AU.sfx[name](gg, 0.02, { element: 'fire', pan: 0.3, gain: 1 }))).L);
      levels[name] = +s.rms.toFixed(4);
      if (s.rms < 0.002) quiet.push(name + ':' + s.rms.toFixed(5));
      if (s.clip > 0 || s.peak > 0.999) clipped.push(name + ':' + s.peak.toFixed(3));
      if (s.peak < 0.02) short.push(name + ':' + s.peak.toFixed(4));
    }
    ok('every sound effect is audible (' + names.length + ')', quiet.length === 0, quiet.join(' ') || 'all above 0.002 rms');
    ok('no sound effect clips', clipped.length === 0, clipped.join(' ') || 'all peaks below 1.0');
    ok('no sound effect is a click', short.length === 0, short.join(' ') || 'all peaks above 0.02');
    /* The warning has to cover the whole 1.5s the rules give you, and it is the
       one sound the player cannot afford to miss. */
    const warn = await render(1.6, (gg) => AU.sfx.warn(gg, 0.02, { element: 'fire', pan: -0.5 }));
    ok('the warning still sounds 1.4s in', stats(warn.L).tail > 0.002, 'tail rms=' + stats(warn.L).tail.toFixed(4));
    const hitIce = await render(1.0, (gg) => { AU.setElement('ice'); return AU.sfx.hit(gg, 0.02, { element: 'ice', pan: 0 }); });
    const hitFire = await render(1.0, (gg) => { AU.setElement('fire'); return AU.sfx.hit(gg, 0.02, { element: 'fire', pan: 0 }); });
    ok('a hit on the titan sounds unlike a hit on the demon', differs(hitIce.L, hitFire.L), 'both non-silent');
    AU.setElement('fire');

    /* --- the live path: a real context, scheduling in real time ----------- */
    /* Everything above is off-line. This is the loop a player actually hears:
       a running AudioContext, the pump scheduling into it on a timer, and the
       button reflecting it. (The sweep runs Chrome with
       --autoplay-policy=no-user-gesture-required, because a headless click is
       not a gesture; on a real page the first keypress is.) */
    const btn = document.getElementById('snd');
    AU.unlock();
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline && AU.notes() === 0) await new Promise((r) => setTimeout(r, 50));
    ok('the live context runs and schedules notes', AU.live() && AU.notes() > 0,
      'state=' + AU.state() + ' steps=' + AU.notes());
    ok('the sound button says it is playing', btn.className === 'on', 'class=' + btn.className);
    const quietBefore = AU.play('ui', {});
    AU.setOn(false);
    const quietAfter = AU.play('ui', {});
    ok('muting silences the mixer', AU.muted() && quietBefore && !quietAfter, 'play before/after mute');
    ok('and the button shows it', btn.className === 'off', 'class=' + btn.className);
    AU.setOn(true);
    ok('unmuting brings it back', !AU.muted() && AU.play('ui', {}) && btn.className === 'on',
      'class=' + btn.className);
    AU.music(false);

    report({ checks, passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      audio: { sounds: names.length, musicRms: +M.rms.toFixed(4), musicPeak: +M.peak.toFixed(3),
        stereo: +MR.rms.toFixed(4), liveState: AU.state(), liveSteps: AU.notes(), levels } });
    requestAnimationFrame(function hold() { draw(); requestAnimationFrame(hold); });
    return true;
  }

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


