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
  const { step, draw, LOGIC, CFG, CAP, errs, scene, renderer, bloom, B, P, G, camRig, warnZone, overEl, boot, spawnBoss, hudBoss, tryAttack, tryMove, newRun, lumaProbe, nanScan, report, rectProbe, screenOf, snapshot, diffFrames, edgeProbe, photoMeshes, vfx } = A;
  boot.style.display = 'none';
  const S = 1 / 60;
  const checks = [];
  let fog = null;                                  // the worst frame of the autoplay minute
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
  /* Feature 1 is asynchronous by nature (FileReader, Image.decode), so it gets
     its own async probe, exactly like the audio one. */
  if (mode === 'photo') return photoProbe().catch((e) => report({
    checks, passed: 0, failed: 1, photoError: String((e && e.stack) || e) }));

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

  /* ---- Feature 1: the photo lands on the torso, and only the torso --------- */
  /* Everything here is measured, not described: the material identities, the
     shader uniform, and the actual pixels of the chest, the head and an empty
     patch of floor, before and after an upload. */
  async function photoProbe() {
    const AU = A.photo;                       // PHOTO itself: { on, u, tex, frame }
    const at = (obj, w, h, dy) => {
      const s = screenOf(obj);
      return rectProbe(s.x - w / 2, s.y - h / 2 + (dy || 0), w, h);
    };
    run(0.8);                                 // the boss settles on stage
    draw();
    const torso0 = at(B.parts.torso, 0.09, 0.11);
    const frame0 = snapshot();                // the whole picture, for the diff below

    ok('no photo to start with', !AU.applied() && A.PHOTO.u.has.value === 0);
    ok('the torso wears the boss\'s own skin', B.parts.torso.material === B.parts.skin);
    ok('the fists already have their own material',
      B.parts.armL.hand.material === B.parts.armL.mats[1] && B.parts.armL.mats[1] !== B.parts.skin);
    const limbBase = B.parts.armL.base.slice();

    /* A magenta field with a white bar across the middle: a hue neither boss
       owns, so any change to the chest pixels is the photo and nothing else. */
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const g2 = canvas.getContext('2d');
    g2.fillStyle = '#ff00c8'; g2.fillRect(0, 0, 400, 300);
    g2.fillStyle = '#ffffff'; g2.fillRect(0, 130, 400, 40);

    ok('the picture is accepted', AU.use(canvas, 'harness') === true);
    /* Same frame, only the material changed: no camera drift and no pose drift,
       so any change in the head's pixels could only mean the photo bled onto it.
       (The simulation is deliberately not advanced between the two reads.) */
    draw();

    ok('the shader uniform is on the torso material', A.PHOTO.u.has.value === 1 && AU.applied());
    ok('the torso now has a material of its own',
      B.parts.torso.material !== B.parts.skin && B.parts.torso.material.userData.photo === true);
    ok('the head keeps the plain skin', !B.parts.head.material.map &&
      B.parts.head.material !== B.parts.torso.material, 'head mat has no map');
    ok('the hands are untouched by the picture',
      !B.parts.armL.hand.material.map && !B.parts.armR.hand.material.map &&
      B.parts.armL.hand.material === B.parts.armL.mats[1] &&
      B.parts.armL.hand.material !== B.parts.torso.material);
    ok('the limbs keep their own colours', B.parts.armL.base.join() === limbBase.join(), limbBase.join('/'));
    ok('a locket of light is drawn round the portrait', !!A.PHOTO.frame);

    const torso1 = at(B.parts.torso, 0.09, 0.11);
    const frame1 = snapshot();
    const dTorso = Math.abs(torso1.meanLuma - torso0.meanLuma) + Math.abs(torso1.meanSat - torso0.meanSat);
    ok('the chest really changed colour', dTorso > 0.05,
      'luma ' + torso0.meanLuma + '→' + torso1.meanLuma + ', sat ' + torso0.meanSat + '→' + torso1.meanSat);
    /* The airtight half: which meshes in the entire scene are wearing the photo.
       It has to be one, and the head, both fists and both arms have to be absent
       from that list — they are separate meshes with their own materials. */
    const painted = photoMeshes();
    ok('exactly one mesh in the scene carries the photo', painted.length === 1, 'meshes=' + painted.length);
    ok('and it is the torso — not the head, not a fist',
      painted[0] === B.parts.torso && painted.indexOf(B.parts.head) < 0 &&
      painted.indexOf(B.parts.armL.hand) < 0 && painted.indexOf(B.parts.armR.hand) < 0 &&
      painted.indexOf(B.parts.armL.g) < 0 && painted.indexOf(B.parts.armR.g) < 0,
      'torso=' + (painted[0] === B.parts.torso));
    /* And what the eye would see: the change is carried by the chest, and what
       reaches the rest of the frame is only the bloom halo off it. */
    const all = diffFrames(frame0, frame1);
    const sc = screenOf(B.parts.torso);
    const chestDiff = diffFrames(frame0, frame1, { x: sc.x - 0.045, y: sc.y - 0.055, w: 0.09, h: 0.11 });
    const floorPatch = diffFrames(frame0, frame1, { x: 0, y: 0, w: 0.20, h: 0.40 });
    const halo = diffFrames(frame0, frame1, { x: 0.78, y: 0.62, w: 0.22, h: 0.38 });
    ok('the upload visibly changed the frame', all.changedFrac > 0.002 && all.changedFrac < 0.45,
      'changed=' + all.changedFrac + ' of the frame, meanΔ=' + all.meanDelta);
    ok('the chest carries the change', chestDiff.meanDelta > 20,
      'meanΔ=' + chestDiff.meanDelta + ' over ' + chestDiff.changed + 'px');
    ok('and several times more of it than the halo does', chestDiff.meanDelta > halo.meanDelta * 6,
      'chestΔ=' + chestDiff.meanDelta + ' vs haloΔ=' + halo.meanDelta);
    ok('the floor patch did not change at all', floorPatch.changed === 0,
      'changed=' + floorPatch.changed + 'px of ' + floorPatch.pixels);
    run(0.06);

    /* The path a player actually takes: a File through FileReader. */
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], 'harness-face.png', { type: 'image/png' });
    ok('a real File loads through FileReader',
      (await AU.loadFile(file)) === true && A.PHOTO.name === 'harness-face', 'name=' + A.PHOTO.name);
    ok('the crop is a 4:5 portrait texture',
      !!A.PHOTO.tex && A.PHOTO.tex.image.width === 512 && A.PHOTO.tex.image.height === 640,
      A.PHOTO.tex ? A.PHOTO.tex.image.width + 'x' + A.PHOTO.tex.image.height : 'no texture');
    ok('the source size is reported back', A.PHOTO.w === 400 && A.PHOTO.h === 300,
      A.PHOTO.w + 'x' + A.PHOTO.h);
    ok('a thumbnail is offered for the button', /^data:image\/jpeg/.test(A.PHOTO.thumb));

    /* It has to survive the wave it is pinned to. */
    const other = LOGIC.BOSSES[B.def.id === 'demon' ? 1 : 0];
    G.state = 'fight';
    const p2 = LOGIC.planFor(other, 1);
    spawnBoss(p2); hudBoss(p2);
    run(0.4); draw();
    ok('the next boss wears the same photo',
      AU.applied() && A.PHOTO.u.has.value === 1 && B.parts.torso.material.userData.photo === true &&
      A.PHOTO.frame.parent === B.parts.torso, 'boss=' + B.def.id);
    ok('and its arms are still bare',
      !B.parts.armL.hand.material.map && B.parts.armL.hand.material !== B.parts.torso.material);
    ok('the fists keep their molten colour on the new boss', B.parts.armL.base[1] > 1,
      'hand emissive=' + B.parts.armL.base[1]);

    A.photo.clear();
    run(0.2); draw();
    ok('removing the photo gives the skin back',
      !AU.applied() && A.PHOTO.u.has.value === 0 &&
      B.parts.torso.material === B.parts.skin && !A.PHOTO.frame);
    ok('and nothing was left in a bad state', nanScan().nanObjects === 0 && errs.length === 0,
      JSON.stringify(nanScan()) + ' ' + errs.join('|'));

    /* Put it back on and stop there: the sweep photographs the tableau a mode
       finishes on, and a boss wearing someone's face is the picture to look at. */
    AU.use(canvas, 'harness-face');
    run(0.15); draw();

    report({ checks, passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      photo: { on: A.PHOTO.on, name: A.PHOTO.name, texture: !!A.PHOTO.tex,
        crop: A.PHOTO.tex ? [A.PHOTO.tex.image.width, A.PHOTO.tex.image.height] : null,
        chestLuma: [torso0.meanLuma, torso1.meanLuma], chestSat: [torso0.meanSat, torso1.meanSat],
        chestDelta: chestDiff.meanDelta, haloDelta: halo.meanDelta,
        changedFrac: all.changedFrac, box: all.box } });
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
    /* One tableau is a single moment, and which moment it lands on depends on
       the build's own timing — so a build that washes the screen out on every
       second heavy hit would still pass a check that only ever looked at one
       frame. The minute is sampled as it goes, every two seconds, and the
       *median* of those thirty samples is what gets judged: that is the frame a
       player mostly looks at. The 90th percentile and the worst frame are
       reported beside it but not asserted on, because the two builds disagree
       about them for a reason that is not pictures: a hit-stop holds the peak
       frame on screen for two frames longer here, so a sampler that fires on a
       fixed beat lands on a peak about three times as often in this build. The
       money frame itself is held and measured in `vfx` mode, where the budget is
       the pre-feature envelope. */
    fog = { luma: 0, clip: 0, sat: 0, at: 0, clips: [] };
    for (let i = 0; i < 60 * 60 && G.state !== 'defeat'; i++) {
      if (B.st && B.st.phase === 'telegraph' && r() < 0.2) tryMove(B.st.side === 'left' ? 1 : -1);
      if (r() < 0.05) tryAttack('quick');
      if (r() < 0.008) tryAttack('heavy');
      if (r() < 0.012) tryAttack('bolt');
      step(S);
      if (i % 120 === 0) {
        draw();
        const s = lumaProbe();
        fog.clips.push(s.brightFrac);
        /* Copy by hand: Object.assign(fog, s) would add a `brightFrac` key and
           leave `clip` at zero, which is a check that can never fail. */
        if (s.brightFrac > fog.clip) {
          fog.luma = s.meanLuma; fog.clip = s.brightFrac; fog.sat = s.meanSat;
          fog.at = +(i * S).toFixed(1);
          /* What was on screen when it happened. A washout number on its own
             says nothing about which effect owns it. */
          const l = vfx && vfx.live ? vfx.live() : null;
          if (l) fog.fx = [l.rings, l.crests, l.arcs, l.flashes, l.bolts, l.particles, l.lightPeak, l.bloom];
        }
      }
    }
    const sorted = fog.clips.slice().sort((a, b) => a - b);
    fog.p50 = sorted[Math.floor(sorted.length / 2)];
    fog.p90 = sorted[Math.min(sorted.length - 1, Math.round(sorted.length * 0.9))];
    fog.n = sorted.length;
    ok('a minute of play without a crash', errs.length === 0, errs.join('|'));
    ok('the machine kept running', G.t > 30, 't=' + G.t.toFixed(1));
    ok('the ordinary frame in a minute of play stays out of the fog',
      fog.p50 < 0.3, 'clipped: median ' + fog.p50 + ', 90th ' + fog.p90 +
      ', worst ' + fog.clip + ' at ' + fog.at + 's of ' + fog.n + ' samples ' + JSON.stringify(fog.fx));
    ok('no NaN anywhere in the scene graph', nanScan().nanObjects === 0, JSON.stringify(nanScan()));
  } else if (mode === 'arms') {
    /* Feature 1, the other half: the wind-up stays readable because the fists
       are their own material and the armed one charges as the countdown runs. */
    toTelegraph();
    const armed = B.st.side === 'left' ? B.parts.armL : B.parts.armR;
    const idle = B.st.side === 'left' ? B.parts.armR : B.parts.armL;
    run(0.75);
    const u = LOGIC.telegraphT(B.st);
    ok('the fist that is about to swing lights up', armed.light.intensity > 8,
      'u=' + u.toFixed(2) + ' light=' + armed.light.intensity.toFixed(1));
    ok('its knuckles burn above their resting glow',
      armed.mats[1].emissiveIntensity > armed.base[1] + 0.5,
      armed.base[1] + ' -> ' + armed.mats[1].emissiveIntensity.toFixed(2));
    ok('the other fist stays cold', idle.light.intensity < armed.light.intensity * 0.25,
      'idle=' + idle.light.intensity.toFixed(2));
    ok('a charge shell swells round it', armed.shell.visible && armed.shell.material.opacity > 0.1,
      'opacity=' + armed.shell.material.opacity.toFixed(2));
    ok('the fists are never the torso material',
      armed.hand.material !== B.parts.torso.material && !armed.hand.material.map);
    const peak = armed.light.intensity;
    until(() => B.st.phase === 'strike' || B.st.phase === 'recover', 4);
    run(0.4);
    ok('the glow dies down once the blow is thrown', armed.light.intensity < peak * 0.6,
      peak.toFixed(1) + ' -> ' + armed.light.intensity.toFixed(1));
  } else if (mode === 'vfx') {
    /* Feature 2: the "juice". Every claim below is read off the effect systems
       themselves — a trail with vertices in it, a hit-stop that really stops
       game time, a light pool that empties itself again — so a regression cannot
       hide behind a pretty frame. */
    const V = A.vfx;
    const live = () => V.live();
    /* The arena is not silent at rest (embers, the entry flourish), so the
       particle field is judged against the floor it idles at, not against zero. */
    let floor = live().particles;
    for (let i = 0; i < 72; i++) { step(S); floor = Math.max(floor, live().particles); }
    const calls0 = renderer.info.render.calls;
    P.hp = P.maxHp;
    /* A yardstick for the two luma checks at the end of this mode: the arena at
       rest, from this same camera, before any blow has been struck. */
    draw();
    const restLum = lumaProbe();
    const restEdges = edgeProbe();

    /* --- (1) the sword trail: the arc the blade really drew ---------------- */
    tryAttack('quick');
    const drew = until(() => live().trailSamples >= 4, 1);
    const trail = live();
    ok('a swing samples the blade into a trail', trail.trailSamples >= 4,
      trail.trailSamples + ' samples after ' + drew.toFixed(2) + 's');
    ok('both trail tiers have geometry to draw',
      trail.trailCore >= 12 && trail.trailHalo >= 12,
      'core=' + trail.trailCore + ' halo=' + trail.trailHalo + ' verts');

    /* --- (2) the heavy blow: hit-stop, shockwave, aberration, bloom --------- */
    until(() => live().flashes === 0, 1.5);        // let the slash flash die first
    const before = live();
    P.hp = P.maxHp;
    tryAttack('heavy');
    const landed = until(() => live().flashes > 0, 1.6);
    const hit = live();                            // the impact frame itself
    ok('the blow lands at the end of its wind-up', landed > 0.15 && landed < 1.2,
      landed.toFixed(2) + 's after the press');
    /* A hit-stop is counted in frames, so count them: while the world is held,
       game time must not move at all. That is the difference between a freeze
       and a merely heavier slow motion. */
    const tA = G.t, held = [];
    for (let i = 0; i < 8; i++) { const t0 = G.t; step(S); if (G.t === t0) held.push(i); }
    ok('the blow stops the world dead for four frames', held.join() === '0,1,2,3',
      'held frames ' + held.join() + ' of 8');
    ok('and the world is stopped, not slowed', G.t - tA < 0.05,
      'advanced ' + (G.t - tA).toFixed(4) + 's over 8 frames (0.133s would play)');
    ok('a shockwave runs out across the floor', hit.rings >= 1 && hit.crests >= 2,
      'rings=' + hit.rings + ' crests=' + hit.crests);
    ok('the impact lights the arena', hit.lightPeak > 20, 'peak=' + hit.lightPeak);
    ok('the strike throws up debris', hit.particles - before.particles > 80,
      before.particles + ' -> ' + hit.particles + ' motes');
    ok('the camera is shoved away from the blow', hit.kick > 0.1, 'kick=' + hit.kick);
    ok('aberration is on at the moment of impact', hit.chromaOn && hit.chromaAmount > 0,
      'amount=' + hit.chromaAmount);
    ok('bloom opens up with the hit', hit.bloom > hit.bloomBase + 0.1,
      'bloom ' + hit.bloomBase + ' -> ' + hit.bloom);

    /* --- (3) the comet bolt: a tail in flight, a layered detonation -------- */
    until(() => P.atk.name === null, 1.5);         // let the heavy swing finish
    /* Wait for the stage to drain before the cast. The detonation below is found
       by watching for the first crest, and a crest still running from the heavy
       blow would answer that question instead — the layers would then be counted
       on the wrong frame. */
    until(() => { const l = live(); return l.rings === 0 && l.crests === 0 && l.arcs === 0; }, 2);
    /* The arena is never empty — the titan breathes motes of its own — so the
       tail is measured as a *rate* rather than a head count. `spawned` is the
       cursor that hands out particle slots, so the increase between two reads is
       exactly how many motes were born in between, whoever made them: read it
       once with nothing in the air, then again with the comet flying, and the
       difference is the tail. */
    const moteRate = (frames) => {
      const a = live().spawned;
      run(frames * S);
      return (live().spawned - a) / frames;
    };
    const calmRate = moteRate(8);
    P.readyAt.bolt = 0;
    tryAttack('bolt');
    const airborne = until(() => live().bolts > 0, 0.6);
    const flying = live();
    ok('the bolt sets off as a comet', flying.bolts === 1,
      'bolts=' + flying.bolts + ' after ' + airborne.toFixed(2) + 's');
    /* Eight frames, not six: the arena's own breathing drifts by a tenth of a
       mote a frame, and the tail only adds a couple, so the window has to be
       long enough to average that drift out — at six frames, a busy CPU could
       move the threshold past the effect. What is asserted is the *shape* of
       the curve, that the field spawns motes faster with the comet up than it
       does on its own, with a margin an order of magnitude above the drift. */
    const tailRate = moteRate(8);                  // eight frames of flight
    ok('the comet sheds a tail as it flies', live().bolts >= 1 && tailRate > calmRate + 1,
      'motes a frame ' + calmRate.toFixed(1) + ' calm -> ' + tailRate.toFixed(1) + ' with the comet up');
    const bang = until(() => live().crests > 0, 1.2);   // it arrives
    const boom = live();
    ok('it detonates in layers when it lands', boom.crests >= 2 && boom.rings >= 2 && boom.chromaOn,
      'crests=' + boom.crests + ' rings=' + boom.rings + ' after ' + bang.toFixed(2) + 's');

    /* --- (4) everything cleans up after itself ----------------------------- */
    /* Win the wave first: a boss that keeps swinging spawns exactly the effects
       being counted, and the check would then be measuring the boss instead of
       the pools. */
    B.hp = 1; tryAttack('quick');
    until(() => G.state === 'victory', 1.2);
    ok('the wave can still be won with all of this running', G.state === 'victory', G.state);
    const quiet = until(() => { const l = live(); return l.rings === 0 && l.arcs === 0 &&
      l.crests === 0 && l.flashes === 0 && l.bolts === 0; }, 6);
    const after = live();
    ok('every pooled effect cleans up after itself', quiet < 6,
      'quiet ' + quiet.toFixed(2) + 's after the last blow');
    ok('no pooled light is left burning', after.lightPeak === 0, 'peak=' + after.lightPeak);
    ok('the aberration switches itself back off', !after.chromaOn, 'amount=' + after.chroma);
    ok('bloom returns to its resting strength', Math.abs(after.bloom - after.bloomBase) < 0.001,
      after.bloom + ' vs ' + after.bloomBase);
    ok('no NaN reached the scene graph', nanScan().nanObjects === 0, JSON.stringify(nanScan()));
    ok('the trail stops drawing once the blade is still', after.trailCore === 0,
      'core=' + after.trailCore + ' verts');
    /* Particles have no pool to read: they are one flat array, so the leak
       question is answered by the shape of the curve instead. The arena never
       stays empty for long — the next wave walks in on a timer, and the window
       ends the moment it does — so this samples the *trough*: how far the field
       fell on its own before that happened. A field that frees its slots comes
       back down between hits; one that leaks stays up at the peak. An absolute
       floor would be a different measurement every run, because it is the next
       wave's timer, not the effects, that decides where the window stops. */
    let trough = after.particles;
    for (let i = 0; i < 96 && B.dead; i++) {
      step(S);
      trough = Math.min(trough, live().particles);
    }
    const drained = 1 - trough / after.particles;
    ok('the particle field drains instead of accumulating', drained > 0.9,
      after.particles + ' motes at the kill -> trough of ' + trough +
      ' (' + Math.round(drained * 100) + '% gone)');
    /* --- (5) the tableau: a heavy blow held mid-impact --------------------- */
    /* One more fight, so the screenshot below lands on the freeze itself: the
       shockwave open, the lens shoved, the frame fringed. */
    const plan = LOGIC.planFor(LOGIC.BOSSES[0], 0);
    G.state = 'fight'; spawnBoss(plan); hudBoss(plan);
    run(1.4);                                      // the titan takes the stage
    P.hp = P.maxHp;
    P.readyAt.heavy = 0;                           // the harness may re-arm a move
    tryAttack('heavy');
    until(() => live().flashes > 0, 1.6);
    run(2 * S);                                    // hold the freeze, not the whole beat
    const held2 = live();
    ok('the held frame is fringed and still frozen',
      held2.chromaOn && held2.frozen > 0 && held2.rings >= 1 && held2.crests >= 2,
      'chroma=' + held2.chromaAmount + ' frozen=' + held2.frozen + ' rings=' + held2.rings);
    /* Aberration is a channel shift, so the picture changes without getting
       darker. Measuring both is what separates it from a plain blur — and it is
       the only way to see a post pass that is quietly switched off. The frame
       has to be presented first: a capture steps the game without drawing, so
       the buffer being read is from whenever the last draw happened. */
    draw();
    const abFrame = snapshot(), abLuma = lumaProbe();
    V.chroma.enabled = false; draw();
    const plainFrame = snapshot(), plainLuma = lumaProbe();
    V.chroma.enabled = true; draw();
    const shift = diffFrames(abFrame, plainFrame);
    ok('aberration shifts colour without dimming the picture',
      shift.changedFrac > 0.004 && Math.abs(abLuma.meanLuma - plainLuma.meanLuma) < 0.02,
      'changed=' + shift.changedFrac + '%, luma ' + plainLuma.meanLuma + ' -> ' + abLuma.meanLuma);
    /* The tableau also has to survive its own flash. An impact that white-outs
       the arena stops being a picture of a fight: the titan, the blade and the
       floor all dissolve into one blob. Measured rather than eyeballed — how
       bright the middle of the frame is, and how much of it has clipped.
       The budget is the one a heavy blow already spent before any of the juice
       existed (luma 0.62, 42% of the middle clipped): a hit may flash, but it
       may not cost the player the frame he is reading. */
    const holdLum = lumaProbe();
    const holdEdges = edgeProbe();
    /* The same frame with the bloom pass off, as a diagnostic: the gap between
       this number and the one above is how much of the glow is the bloom pass
       rather than the lighting. */
    bloom.enabled = false; draw();
    const flatHold = lumaProbe();
    bloom.enabled = true; draw();
    ok('the frozen impact is bright without washing the arena out',
      holdLum.meanLuma < 0.62 && holdLum.brightFrac < 0.42,
      'luma=' + holdLum.meanLuma + ' clipped=' + holdLum.brightFrac);
    /* ...and it still has to read as *brighter* than the fight around it, or
       the fix above would be indistinguishable from switching the hit off.
       `restLum` is the same arena, same camera, half a minute earlier with no
       blow in the air. */
    ok('and the blow is unmistakably brighter than the resting arena',
      holdLum.brightFrac > restLum.brightFrac + 0.1,
      'clipped ' + restLum.brightFrac + ' at rest -> ' + holdLum.brightFrac + ' on the hit');
    /* Bright and clipped is only half of it: the frame still has to be a
       *picture*. Edge energy is the average jump between neighbouring pixels, so
       a white-out — where every pixel holds the same value — measures close to
       zero, while a frame that still shows the titan, the blade and the grid
       keeps its edges. */
    ok('the frozen frame still reads as a picture',
      holdEdges > restEdges * 0.5,
      'edges ' + restEdges + ' at rest -> ' + holdEdges + ' on the hit');

    report({ checks, passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      luma: { ...holdLum, rest: restLum.meanLuma, restClip: restLum.brightFrac },
      vfx: { idleFloor: floor, restEdges, holdEdges, trail: { samples: trail.trailSamples, core: trail.trailCore,
        halo: trail.trailHalo }, heavy: hit, bolt: boom, quietAfter: quiet,
        held: held2, trough, drained, chromaShift: shift.changedFrac,
        holdLuma: holdLum.meanLuma, holdClip: holdLum.brightFrac, bloomOff: flatHold.meanLuma,
        calls: [calls0, renderer.info.render.calls] } });
    /* Hold the frozen impact on screen: this mode's picture is the hit itself. */
    requestAnimationFrame(function hold() { draw(); requestAnimationFrame(hold); });
    return true;
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
  const edges = edgeProbe();
  /* The same frame with the bloom pass switched off. The difference is the proof
     that post-processing is really on — and it says how much of the glow in this
     picture is the bloom rather than the lighting. */
  bloom.enabled = false; draw();
  const flat = lumaProbe();
  bloom.enabled = true; draw();
  if (['gfx', 'idle', 'demon', 'ice', 'strike'].includes(mode)) {
    ok('bloom is spreading the highlights', lum.brightFrac >= flat.brightFrac,
      flat.brightFrac + ' -> ' + lum.brightFrac);
    ok('the frame is dark but not black', lum.meanLuma > 0.01 && lum.meanLuma < 0.6, 'luma=' + lum.meanLuma);
    ok('the frame has colour in it', lum.meanSat > 0.04, 'sat=' + lum.meanSat);
  }
  report(Object.assign({ checks, passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length, lumaOff: flat.meanLuma,
    brightOff: flat.brightFrac, edges },
    fog ? { worst: fog } : {}, lum));
  /* Keep presenting the frozen frame. A capture renders once, and a canvas that
     never draws again does not always survive the trip to a screenshot — so the
     tableau is re-presented every frame without advancing any simulation. */
  requestAnimationFrame(function hold() { draw(); requestAnimationFrame(hold); });
}


