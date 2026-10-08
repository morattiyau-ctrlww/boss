# NEON DUEL

A stylized low-poly 3D boss fight in **one HTML file**. Two bosses, three
attacks, a cloth-simulated cape, and a warning zone you have exactly 1.5 seconds
to get out of.

Three.js r160 (pinned) is pulled from a CDN through an import map. There is no
build step, no bundler, no `node_modules`, and no external model, texture or
audio file — every shape, glow and gradient in the game is generated in code.

```
open index.html through a local server, e.g.
    python3 -m http.server 8000
    http://localhost:8000/index.html
```

## Play

| Key | Action |
| --- | --- |
| `←` `→` or `A` `D` | Dodge to the left or right slot |
| `J` (or `Space`) | **Quick Slash** — fast, 9 damage, 0.42s cooldown |
| `K` | **Heavy Strike** — 26 damage, 3.2s cooldown, shockwave + debris |
| `L` | **Magic Bolt** — 14 damage, ranged, 1.3s cooldown |
| `M` | Mute / unmute (the ♪ button, top-left, does the same) |
| `R` | Restart, once you are dead |

On a phone the same moves appear as touch buttons: a dodge pad bottom-left, the
three attacks bottom-right. They show up automatically on a coarse pointer.

Browsers refuse to make noise before you touch the page, so the music starts on
your first key or tap. Until then the ♪ button breathes rather than lying to you.

## The rules

- The arena is split down the middle. The boss picks a **side**, and a red
  hazard zone covers that half of the floor for **1.5 seconds**. At the end of
  it, that half is hit. Standing in the other half costs you nothing.
- A dodge commits you the moment you press it — the feet catch up afterwards.
  What the strike tests is the side you *chose*, not the pixels you are standing
  on, which is why a dodge never feels stolen.
- Consecutive hits inside 2.5s build a combo worth up to +30% damage, and it
  resets the moment you are hit.
- 18% of hits crit for 1.9x, with slow-motion and a harder shake.
- Killing a boss heals you 28 HP and walks in the *other* boss, 12% tougher with
  a shorter recovery. The 1.5s warning never shrinks — difficulty is more
  swings, not less warning.
- Drop to 0 HP and you get a DEFEATED screen with your run in numbers.

## Sound

There is no audio file in this project either. Every sound is built at run time
out of oscillators and filtered noise — the same way the arena builds its
geometry — through one Web Audio graph: a soft-clip saturator into a compressor,
with a two-tap damped-delay room as the send.

**The score** is a 132 BPM synthwave loop, four bars of *i–VI–III–VII* in D
minor, played by five voices: kick (sine drop plus a beater click), snare, hats,
a saw bass with a sub, a stereo-detuned arp lead, and a pad that holds each bar.
The boss picks the key: the Flame Demon plays it in D, the Ice Titan a fifth
above with a glassier lead and a bell on top. Waves add layers — an extra kick,
sixteenth-note hats, the lead on every sixteenth — and the lead gets louder each
time, so a late wave sounds late.

**The effects** are all riffs on the same handful of primitives. The bolt is
frequency modulation, which is why it spits. The warning is three rising blips
panned to the *side that is about to be lit up*, plus a riser that swells all the
way into the strike. A hit is a crack, a body thud and a sub; a hit on the titan
adds a glassy partial. Killing a boss ducks the music under the explosion, and
slow motion pulls the loop back rather than slowing it down — the fight runs on
scaled time, the music does not.

## How it is put together

`index.html` is the whole game, organised as one file with signposts:
interface → the pure rules → renderer/post-processing → arena → effects →
player → cape → ribbon → boss → fight → sound → input → HUD → camera/loop, then
a small block of instrumentation.

A few decisions worth naming:

- **The score is data before it is sound.** `stepPlan(k)` turns a sixteenth index
  into a list of notes, and it is a pure function of `k` — no running random
  state, no `Math.random` anywhere in the signal path. That is what makes the
  music reviewable in Node (`tests/audio.test.js` reads the harmony and the drum
  grid) *and* reproducible enough to render off-line and measure sample by
  sample (`#cap=audio`). The same `voiceStep` call drives the live pump and the
  off-line render, so the thing being measured is the thing being played.
- **The rules and the renderer do not know about each other.** Everything that
  decides the fight — sides, damage, crits, combos, cooldowns, and the boss's
  whole attack state machine — lives in a marked block of pure functions with no
  DOM and no three.js in it. The 3D code only *reacts* to the events that block
  emits. That is what makes the interesting half of the game testable in Node.
- **One particle system for everything.** A single additive `Points` cloud of
  1500 slots serves sparks, embers, debris, fire, frost, bolt trails and boss
  deaths. Dead slots are given size 0.
- **The cape is a 5x8 verlet lattice** pinned at the shoulders, solved in
  player-local space, so it lags behind a dodge and settles by itself.
- **The blade trail is a ribbon threaded through the last 16 samples of the
  sword's world matrix** rather than spawned geometry.
- **Every glow is emissive + bloom.** UnrealBloomPass at 0.82/0.62/0.60, under
  an ACES filmic curve so the highlights roll off instead of clipping.
- **Screen furniture runs on real time, the fight runs on scaled time.** Slow
  motion and hit-stop stretch the fight, never the HUD or the flashes.


## Verifying it

Three independent layers, because "it looks fine in a screenshot" is not a
verification method.

```
node tests/logic.test.js     # the rules
node tests/audio.test.js     # the score
node tests/sweep.mjs         # the pictures and the signal, in a real browser
```

113 checks, no browser, no three.js. It lifts the marked pure-logic block
straight out of `index.html` and exercises it: damage and crit ranges, the combo
window and its cap, cooldown arithmetic, boss selection (never twice in a row,
both bosses get used, 12% scaling), and the attack state machine run at both
60fps and 240fps to prove the warning is 1.5 seconds of *game* time whatever the
frame rate is doing. It ends with sixty complete waves played end to end by a
bot, asserting that health never leaves its legal range and that every hit which
lands costs exactly the boss's damage.

58 more, also in Node, over the score: the tempo and the sixteen-sixteenth bar,
the four chords and their roots, that every chord tone is really in D natural
minor (and A minor once transposed for the titan), that the bass only ever plays
the root of the bar it is in, that the lead stays on chord tones, the drum grid,
the fill on the eighth bar, the layers that arrive as the waves climb, and that
the whole thing is deterministic — the same sixteenth names the same notes every
time. No audio is rendered; this is the theory.

The third layer is in-browser. A `#cap=` URL runs a scripted, seeded,
fixed-step slice of the real game, renders one frame, reads pixels back out of
it, and writes a JSON report with its own pass/fail checks into `#probe` (and
`window.__probe`, and the page title). The harness lives in `tests/capture.js`
and is imported *only* when a URL asks for it, so the game itself never ships
it. Modes:

| Mode | What it proves |
| --- | --- |
| `idle` | The boss cycles on its own and lands its strikes |
| `telegraph` | The warning shows, on the correct side, with the boss winding up |
| `strike` | The warning lasts 1.5s, and standing in it costs exactly its damage |
| `dodge` | Dodging the armed side costs nothing and puts you on the other side |
| `heavy` / `bolt` / `combo` | Each attack reaches the boss, cooldowns hold, combos multiply |
| `win` | A lethal hit wins the wave, heals you, and spawns the other, tougher boss |
| `lose` | Death shows DEFEATED, health never goes negative, restart resets |
| `demon` / `ice` | Both bosses stand up and render |
| `gfx` | Bloom measurably does something; the frame is dark but not black, and has colour |
| `bench` | Frames complete and the draw-call count stays modest |
| `autoplay` | A minute of bot play across several waves: no crash, no NaN, no stall |
| `audio` | Every sound is rendered off-line and measured: levels, spectrum, stereo, determinism |

```
http://localhost:8000/index.html#cap=dodge
```

`tests/sweep.mjs` runs every one of those in headless Chrome (it serves the
folder itself and drives the browser over the DevTools protocol — `--shots` also
writes a PNG per mode). All fifteen modes pass together on this machine: 69
in-browser checks, 0 uncaught errors, 0 NaNs. What they measure (software GL in
headless Chrome; a real GPU is far quicker): ~150-168 draw calls and ~4-5.5k
triangles per frame, a frame at mean luma ~0.22 where bloom raises the
bright-pixel fraction from 0.009 to 0.020 on the very same frame, and — for the
audio — a loop at 0.154 RMS peaking at 0.68 with nothing clipping, kick energy at
60Hz, hats landing measurably on the beat, a left and a right channel that
differ, 17 sound effects that are all audible and none of them a click, and two
renders of the same bar agreeing to within 3e-7 (float32 rounding, i.e. there is
no unseeded noise in the signal path).

`#cap=audio` needs real time rather than virtual time, which is why the sweep
drives the browser itself: an `OfflineAudioContext` render is not something
`--virtual-time-budget` can hurry along, and the probe would still be mid-render
when the clock expired.

### Bugs this caught that the eye did not

- The entire second half of the CSS was sitting **outside** `</style>` and being
  rendered as page text. Every capture probe passed; only a screenshot showed it.
- A full-screen white flash overlay was **stuck on at 85% opacity**. A frame
  delta can arrive as zero or negative, and the decay was running backwards
  because of it. The fix was to clamp the delta and run screen furniture on real
  time — which also stopped slow motion from stretching a flash.
- The camera orbited at radius 10.8 while the pillars stood at 8.8, so a pillar
  could slide between the lens and the fight.
- Both bosses read as featureless blobs until their limbs were moved *outside*
  the torso silhouette and the stacked additive shells were pulled back from
  full-body blowouts.
- The warning's tail was **78 times too quiet** where it mattered most. Rendering
  the cue off-line and measuring its last 100 ms reported 0.0002 RMS: the three
  blips were long gone and the drone had decayed under the strike. Replacing the
  drone's slow fade with a riser that *swells into* the hit measures 0.0274 RMS at
  the same moment — the sound now builds exactly where the danger is.
- The hats were inaudible at 8.2kHz, and the hats' *beat* was only checkable once
  the probe was right: a single Goertzel bin over two seconds reports nothing for
  a broadband 45 ms transient, so the test measures broadband brightness on the
  beat against the same window off it (0.018 vs 0.010) instead.

## Known limitations

- The score is one eight-bar loop. It has heat and two keys, but it is a loop,
  not a soundtrack — no transitions, no boss-specific tempo.
- No pause. It is a boss fight, not a document.
- Both bosses share one skeleton and one animation set, and differ in geometry,
  materials, particle behaviour, strike effects and key. That is a deliberate
  budget choice, and it is why the second boss was cheap to build.
- The capture modes need the folder served over HTTP, since they import a module.
  `tests/sweep.mjs` serves it for you.
- Verified in Chrome. The code sticks to standard three.js, CSS and Web Audio,
  but Safari and Firefox have not been walked through by hand — Safari in
  particular has needed a `webkitAudioContext` fallback (present) and a real
  gesture (also the case in Chrome).

## Layout

```
index.html            the game (single file)
tests/logic.test.js   113 headless checks over the extracted rules block
tests/audio.test.js   58 headless checks over the extracted score
tests/capture.js      optional in-page capture harness, loaded by #cap= only
tests/sweep.mjs       runs every capture mode in headless Chrome
```
