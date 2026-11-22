# Hunter

A Souls-like / Monster Hunter-like 3D third-person bossing game, built with
Three.js. One arena, one hunter, one boss — the prototype answers a single
question: does the 1v1 fight feel good?

Play it: https://treebearcode.github.io/hunter/ (GitHub Pages, served from `docs/`)

## The prototype

- **Arena:** a circular stone ring, ~40 m across, with rocks and pillars for cover.
- **Hunter:** the KayKit Knight (CC0, see Models below) — armored, red
  cape, longsword in hand — third-person camera, lock-on.
- **Weapon:** Longsword only — fast, low damage, dodge-friendly.
  - Light attack (click / J / F): 3-hit combo, 8 / 8 / 12 damage, 8 stamina each.
    Forehand, backhand, two-handed slice finisher — each with its own wind-up,
    a small lunge forward, and a sword-trail ribbon that follows the
    blade. Pressing attack early buffers the next hit; a press up to
    0.3 s after a swing ends still chains instead of restarting.
    Each swing plays only the strike portion of its clip at
    near-natural speed (0.55 s a swing), with an exaggerated lean per
    hit, and a 1/2/3 combo counter under the stamina bar.
  - Heavy attack (right-click / K / G): 18 damage, slower windup, 15 stamina.
    A two-handed overhead slam with dust where it lands.
  - Thrust (F+G together, or LMB+RMB while pointer-locked): 14 damage,
    0.45 s, 12 stamina, 4.2 m reach — a long poke that can hit the boss
    from outside contact range. Standalone, never part of the combo.
  - Dodge roll (Shift / Space): i-frames for the whole 0.35 s roll, 20 stamina.
    A swing can be cancelled into a dodge once its hit has landed.
    The roll reads now: dust at takeoff and landing, fading afterimages
    along the path, a small camera FOV kick, a louder whoosh, and the
    Knight leans into the roll.
  - Heal (R): 3 per attempt, +40 HP over a 1.2 s channel, interrupted by a hit.
  - Stamina 100, regenerates ~25/s after 0.8 s without spending.
  - Hit-stop fires only on a landed hit — a whiff never freezes the game.
- **Boss:** the Skeleton (Quaternius Ultimate Monsters, CC0, see Models
  below) — a 4 m undead brute, 600 HP.
  - Charge (telegraphed, hits the wall → stagger), bone-club sweep
    (25 dmg), stomp shockwave (20 dmg, roll through the ring), leap
    slam (22 dmg — crouches, jumps an arc onto the hunter, lands with
    a shockwave) and spin sweep (20 dmg — a full 360° turn with the
    club out, hits all around). Sweep is a low twist, stomp a high
    rear-up, each with its own sound cue and dust during the windup.
  - The boss body is solid: it pushes the hunter out to 2.0 m, no
    damage. Contact damage exists only during a charge. Light range
    is 3.8 m, so the hunter can hit from a step further out.
  - A landed hit flashes the skeleton WHITE, briefly — the only flash
    in the game. Tells are pose, sound and dust only: no red glow on
    windups, ever. Enrage keeps a slow red pulse, dimmed further.
  - Poise: enough damage staggers it for ~2.5 s. Head hits damage the
    skull; after 150 head damage the skull cracks (longer stagger,
    shorter sweep) — the old horn-break mechanic, re-skinned: the
    skeleton has no horns, so the break reads through the "SKULL
    CRACK!" banner, the crack sound, bone sparks, the stagger and the
    shorter sweep.
  - Enrages under 30% HP: attacks ~25% faster, red pulse.
- **Win / lose:** boss HP to 0 → victory screen with clear time;
  hunter HP to 0 → defeat screen. Retry restarts instantly.
- **Polish Pass 1:** the boss telegraphs with its body, not floor
  markers — crouched low, leaning forward and kicking up dust before
  a charge, twisted to one side before a sweep, reared back before a
  stomp. Landed hits have a brief hit-stop, impact sparks and a
  heavier thud; damage numbers pop. The camera eases to its spot and
  is pulled in instead of clipping through the boss, pillars or the
  wall. Pause with P or the ⏸ button (frozen overlay, Resume /
  Restart); Esc only releases the mouse.

## Controls

WASD move · mouse looks around once captured (click the canvas, Esc to
release) · Q / E or right-drag orbits the camera · wheel zooms · Tab or
middle-click toggles lock-on · click / J / F light attack · right-click /
K / G heavy attack · F+G (or LMB+RMB while pointer-locked) thrust ·
Shift / Space dodge roll · R heal · P pause.

Left click is only ever an attack — it never orbits the camera, so
orbiting can no longer trigger a swing (and swinging can no longer
swing the camera around).

## Running locally

Dev directly in `docs/` — ES modules, no build step. Modules do not work by
double-clicking (file:// blocks imports); serve the folder over HTTP:

```sh
cd docs
python3 -m http.server
```

then open http://localhost:8000.

## Layout

- `docs/index.html` — page, HUD, overlays, Three.js import map (r160 via CDN)
- `docs/style.css` — HUD and overlay styling
- `docs/js/main.js` — boot, render loop, camera, input, win/lose state
- `docs/js/config.js` — every tuning number, in one place
- `docs/js/hunter.js` — hunter mesh, movement, dodge, attacks, heal
- `docs/js/boss.js` — Skeleton model, AI state machine, moves, stagger, skull crack
- `docs/assets/` — the models: Knight.glb + sword_1handed.glb (KayKit),
  Skeleton.glb (Quaternius, converted from FBX), and the four
  Rig_Medium animation packs (KayKit Character Animations)
- `docs/js/arena.js` — ground, wall, rocks, pillars, collision
- `docs/js/effects.js` — dust puffs and impact sparks (pooled particles)
- `docs/js/audio.js` — Web Audio blips (no audio files)
- `docs/js/ui.js` — HUD bars, damage numbers, overlays

Three.js r160 is loaded from the jsDelivr CDN via an import map (the
GLTFLoader comes from the same CDN's `examples/jsm/` addons path).
Sounds are synthesized with Web Audio.

## Models

The hunter and the boss are real models now, not primitives — both
CC0, no attribution required:

- **Hunter:** the Knight from KayKit's *Character Pack: Adventurers*
  2.0, with KayKit's `sword_1handed`. Movement and attack clips come
  from KayKit's *Character Animations* 1.1 pack — same Rig_Medium
  skeleton, so the clips retarget onto the Knight directly. The clips
  run 1.0–1.6 s against the game's 0.45–0.7 s swing windows, so
  each light swing and the stab play only the strike portion of their
  clip at near-natural speed (the heavy still plays its whole clip
  sped up); hit timing (damage lands halfway through the swing) is
  unchanged.
- **Boss:** the Skeleton from Quaternius's *Ultimate Monsters* pack
  (itch mirror, 4 monsters), converted FBX → GLB with all five takes
  (Attack, Death, Idle, Running, Spawn). It has no walk or hit clip:
  walking uses Running at low speed, and a landed hit flashes the
  skeleton white. Charge runs on Running; the sweep, the stomp slam,
  the leap slam and the spin all use Attack.

The arena, sky, lighting, rocks and pillars are still procedural
primitives — this pass was player + monster only.
