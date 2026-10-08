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
| `R` | Restart, once you are dead |

On a phone the same moves appear as touch buttons: a dodge pad bottom-left, the
three attacks bottom-right. They show up automatically on a coarse pointer.

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

## How it is put together

`index.html` is the whole game, organised as one file with signposts:
interface → the pure rules → renderer/post-processing → arena → effects →
player → cape → ribbon → boss → fight → input → HUD → camera/loop, then a small
block of instrumentation.

A few decisions worth naming:

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

Two independent layers, because "it looks fine in a screenshot" is not a
verification method.

```
node tests/logic.test.js
```

113 checks, no browser, no three.js. It lifts the marked pure-logic block
straight out of `index.html` and exercises it: damage and crit ranges, the combo
window and its cap, cooldown arithmetic, boss selection (never twice in a row,
both bosses get used, 12% scaling), and the attack state machine run at both
60fps and 240fps to prove the warning is 1.5 seconds of *game* time whatever the
frame rate is doing. It ends with sixty complete waves played end to end by a
bot, asserting that health never leaves its legal range and that every hit which
lands costs exactly the boss's damage.

The second layer is in-browser. A `#cap=` URL runs a scripted, seeded,
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

```
http://localhost:8000/index.html#cap=dodge
```

All fourteen modes pass together — 51 in-browser checks, 0 uncaught errors. What
they measure on this machine (software GL in headless Chrome; a real GPU is far
quicker): ~150-166 draw calls and ~4.5-5.5k triangles per frame, 0 NaNs anywhere
in the scene graph, and a frame at mean luma ~0.22 where bloom raises the
bright-pixel fraction from 0.009 to 0.020 on the very same frame.

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

## Known limitations

- No audio. Nothing in the brief asked for it; WebAudio is the obvious next step.
- No pause. It is a boss fight, not a document.
- Both bosses share one skeleton and one animation set, and differ in geometry,
  materials, particle behaviour and strike effects. That is a deliberate budget
  choice, and it is why the second boss was cheap to build.
- The capture modes need the folder served over HTTP, since they import a module.
- Verified in Chrome. The code sticks to standard three.js and CSS, but Safari
  and Firefox have not been walked through by hand.

## Layout

```
index.html           the game (single file)
tests/logic.test.js  113 headless checks over the extracted rules block
tests/capture.js     optional in-page capture harness, loaded by #cap= only
```
