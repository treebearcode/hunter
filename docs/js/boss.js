// boss.js — two bosses, one state machine. The Barbarian (KayKit
// Adventurers, CC0) is the main boss; the Skeleton (Quaternius Ultimate
// Monsters, CC0) stays as the second option, picked on the start screen
// and saved in localStorage. The AI is shared — idle / walk, pick a move
// by distance, telegraph it (wind-up pose + sound + dust), then do it —
// and only the model, the clips and the break skin change per boss.
// Every big move is dodgeable on purpose: deaths should feel like a
// mistimed dodge, not a surprise.
//
// The Barbarian is a Rig_Medium KayKit character, so he plays the real
// KayKit clips already shipped in the game: the sweep is a 2H Slice,
// the stomp a 2H Chop, the spin a full 2H Spinning turn, the charge a
// run, the leap a jump into a chop slam, the entrance a Spawn_Ground
// eruption. His axe is the pack's axe_2handed, parented to his right
// handslot like the hunter's sword. The Skeleton keeps its five takes
// (Idle/Running/Attack/Spawn/Death), sweep+stomp sharing Attack, exactly
// as before. Telegraphs stay body language: the boss leans and twists
// into each move, kicks up dust, and plays a distinct sound cue per
// move — no glow, no floor markers, and never a red flicker. Enrage
// keeps a slow red pulse, dimmed so it does not flicker.
//
// The boss body is solid: it pushes the hunter out to 2.0 m, no damage.
// The only contact damage left is during a charge, where the body
// itself is the telegraphed attack.
//
// Break: the old horn-break mechanic, re-skinned per boss. The Skeleton
// has no horns, so head hits damage its skull; after 150 head damage
// the skull cracks — longer stagger, shorter sweep. The Barbarian wears
// no helm, he wears a bearskin hat: head hits damage the hat, and after
// 150 the BEAR HAT BREAKS (same threshold, same longer stagger, same
// shorter sweep). Neither model loses a visible piece (both are single
// meshes for the break target), so the break reads through the banner,
// the crack sound, sparks, the stagger and the shorter sweep.
//
// Two measured caveats on the Barbarian's axe, from the probe
// (hunter-verify/barbarian-report.md): the 2H Slice tip passes at
// 2.65–3.17 m, over the 1.9 m hunter's head, so the sweep state leans
// the Barbarian forward and dips him (rotation.x 0.3, y −0.35) to bring
// the blade down to chest height at the front pass; and the spin's
// blades sweep at 2.26–3.63 m, clearing the hunter's head by ~0.35 m —
// the spin is a real 360° turn, so it still reads as a whirlwind, but
// the height is the first thing to check in playtest.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { collide } from './arena.js';
import { turnTowards } from './hunter.js';

// Clip files for a Rig_Medium boss: the same four animation GLBs the
// hunter loads. Only the clips the boss plays are listed per kind.
const RIG_MEDIUM_ANIM_FILES = [
  'assets/Rig_Medium_CombatMelee.glb',
  'assets/Rig_Medium_General.glb',
  'assets/Rig_Medium_MovementBasic.glb',
  'assets/Rig_Medium_MovementAdvanced.glb',
];

// Strike windows for the Barbarian's axe, as fractions of the clip:
// the KayKit 2H clips strike in a portion of their length, so each
// boss attack plays only its strike part at near-natural speed — the
// same trick the hunter's swings use. Measured from the axe-tip
// trajectory (barbarian-report.md §6): the Slice's blade crosses the
// front centre ~13% in, the Chop's lowest point lands ~47% in.
const BARB_STRIKE_WINDOWS = {
  'Melee_2H_Attack_Slice': [0.09, 0.42],
  'Melee_2H_Attack_Chop': [0.30, 0.75],
};

// Per-boss data. `rates` are playback rates (clip seconds / state
// seconds): the sweep state lasts 0.45 s, the spin 0.7 s, the shockwave
// ring ~1.0 s, the leap 0.6 s in the air. `sweepLean` pitches the body
// forward and dips it during the sweep so the axe comes down to the
// hunter instead of passing over their head (see the header note).
const KINDS = {
  barbarian: {
    displayName: 'THE BARBARIAN',
    winTitle: 'BARBARIAN FELLED',
    breakLabel: 'BEAR HAT BREAK!',
    file: 'assets/Barbarian.glb',
    animFiles: RIG_MEDIUM_ANIM_FILES,
    weaponFile: 'assets/axe_2handed.glb',
    // Barbarian is 2.40 m in the file; at this scale he stands 4.0 m —
    // clearly larger than the 1.9 m hunter, the same presence as the
    // Skeleton, so arena, camera and hitbox numbers all stay as they are.
    scale: 1.67,
    // His bind pose plants the feet on the floor: no sink, unlike the
    // Skeleton's 0.08 m float.
    feetSink: 0,
    headBone: 'head',
    // The head bone sits low in the head (2.07 m); the visual head mesh
    // spans 1.89–3.65 m, centre 2.77 m. The head-hit radius (3.0 m in
    // main.js) is measured from the hunter's feet, so the low bone
    // makes head hits land within ~2.2 m horizontally — the break
    // target is the bear hat, 2.36–4.00 m up.
    headFallbackY: 2.07,
    starsY: 3.2, // stagger stars orbit the bear hat
    starsR: 1.0,
    introClip: 'Spawn_Ground',
    introDur: 1.3, // the eruption clip, played at natural speed
    clips: {
      idle: 'Idle_A',
      approach: 'Running_A',
      charge: 'Running_A',
      sweep: 'Melee_2H_Attack_Slice_strike',
      stomp: 'Melee_2H_Attack_Chop_strike',
      leapFlight: 'Jump_Full_Short',
      leapSlam: 'Melee_2H_Attack_Chop_strike',
      spin: 'Melee_2H_Attack_Spinning',
      death: 'Death_A',
      hit: 'Hit_A',
    },
    rates: {
      intro: 1, approach: 0.7, charge: 1.8,
      sweep: 0.8, stomp: 0.75, leapFlight: 1.95, leapSlam: 0.75,
      spin: 0.95, death: 1, hit: 1,
    },
    sweepLean: { rotX: 0.3, dip: -0.35 },
  },
  skeleton: {
    displayName: 'THE SKELETON',
    winTitle: 'SKELETON SHATTERED',
    breakLabel: 'SKULL CRACK!',
    file: 'assets/Skeleton.glb',
    animFiles: null, // its five takes live in the one file
    weaponFile: null, // the club is part of the model
    // The converted GLB is 4.999 m tall; at this scale the skeleton
    // stands 4.0 m — clearly larger than the 1.9 m hunter, in the same
    // ballpark as the old boss, so arena, camera and hitbox numbers
    // all stay as they are.
    scale: 0.8,
    // The bind pose floats ~0.08 m above the floor at this scale; sink
    // the model inside its group so the feet plant on the ground.
    feetSink: -0.08,
    headBone: 'Head',
    headFallbackY: 3.0,
    starsY: 3.1, // stagger stars orbit the head
    starsR: 0.9,
    introClip: 'Skeleton_Spawn',
    introDur: 2.9 / 1.5,
    clips: {
      idle: 'Skeleton_Idle',
      approach: 'Skeleton_Running',
      charge: 'Skeleton_Running',
      sweep: 'Skeleton_Attack',
      stomp: 'Skeleton_Attack',
      leapFlight: 'Skeleton_Attack',
      leapSlam: null, // the Attack clip just keeps playing through the landing
      spin: 'Skeleton_Attack',
      death: 'Skeleton_Death',
      hit: null, // no hit clip: a hit flashes the skeleton WHITE instead
    },
    rates: {
      intro: 1.5, approach: 0.7, charge: 1.8,
      sweep: 2.6, stomp: 1.6, leapFlight: 1.5, leapSlam: 1,
      spin: 1.4, death: 1, hit: 1,
    },
    sweepLean: null,
  },
};

const BOSS_KEY = 'hunter.boss';

export class Boss {
  constructor(scene, sfx, kind) {
    this.sfx = sfx;
    this.kind = KINDS[kind] || KINDS[Boss.selectedKind()];
    this.group = new THREE.Group(); // position = centre of the body
    this.group.position.set(0, 0, -10); // start at the north edge

    // Stagger stars: small yellow spheres that orbit the head while the
    // boss is staggered, so the punish window is obvious. Repositioned
    // per boss by _layoutStars (the Barbarian's hat sits higher).
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffdd33 });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), starMat);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.group.add(this.stars);
    this._layoutStars();

    // Shockwave ring for the stomp: a flat ring of kicked-up dust that
    // grows outward with the shockwave. Muted tan, not a bright warning
    // colour — it is the attack itself, ground being disturbed, not a
    // UI marker drawn in advance.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x9a7b4f, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    scene.add(this.ring);

    scene.add(this.group);

    // -- Model loading (async). The game state machine runs regardless,
    //    so the Start button stays disabled until the model lands
    //    (main.js handles that via `ready`).
    this.modelLoaded = false;
    this.loadError = null;
    this.mixer = null;
    this.clips = {};
    this._flashMats = []; // materials the white hit flash / enrage pulse own
    this.headBone = null; // head bone, for head hits + the stars
    this._currentClip = null;
    this._currentAction = null;
    this._switching = false;
    this.ready = this._loadModel(this.kind);

    // The start screen picks the boss: the menu dispatches this event
    // and the Boss does the model swap itself.
    window.addEventListener('hunter:boss-select', (e) => {
      if (e.detail && e.detail.kind) this.switchTo(e.detail.kind);
    });

    this._dustT = 0;          // time since the last paw dust puff
    this._chargeSnorted = false;
    this._flashT = 0;         // seconds left of the white hit flash
    this._hitFlashSeen = false; // sticky: a hit flashed white (test hook)
    this._spinHitDone = false;
    this._leapFrom = null;    // leap start / target, set at windup end
    this._leapTo = null;
    this.reset();
  }

  // The saved boss choice, defaulting to the Barbarian (the main boss).
  static selectedKind() {
    try {
      const k = window.localStorage && localStorage.getItem(BOSS_KEY);
      return k === 'skeleton' ? 'skeleton' : 'barbarian';
    } catch (_) {
      return 'barbarian';
    }
  }

  // True while a menu boss switch is loading a new model.
  get switching() { return this._switching; }
  get displayName() { return this.kind.displayName; }
  get winTitle() { return this.kind.winTitle; }
  get breakLabel() { return this.kind.breakLabel; }

  _layoutStars() {
    const K = this.kind;
    this.stars.children.forEach((s, i) => {
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * K.starsR, K.starsY, Math.sin(a) * K.starsR);
    });
  }

  // Swap to the other boss from the start menu: unload the current
  // model, load the new one, and reset the fight. The Start button is
  // disabled while the new model loads, so a fight can never start
  // against a half-loaded boss.
  async switchTo(kind) {
    const K = KINDS[kind];
    if (!K || K === this.kind || this._switching) return false;
    this._switching = true;
    const startBtn = document.getElementById('start-button');
    try {
      await this.ready; // let any in-flight initial load finish first
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'LOADING…'; }
      await this._loadModel(K);
      this.reset();
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'ENTER THE ARENA'; }
      return true;
    } catch (e) {
      this.loadError = e;
      console.error('Boss switch failed:', e);
      if (startBtn) startBtn.textContent = 'FAILED TO LOAD — RELOAD THE PAGE';
      return false;
    } finally {
      this._switching = false;
    }
  }

  // Remove the current model (and its weapon) from the scene, freeing
  // its geometry and materials so repeated menu switches don't leak.
  _unloadModel() {
    if (this.model) {
      this.group.remove(this.model);
      this.model.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m) m.dispose();
        }
      });
      this.model = null;
    }
    this.mixer = null;
    this.clips = {};
    this._flashMats = [];
    this.headBone = null;
    this._currentClip = null;
    this._currentAction = null;
    this.modelLoaded = false;
  }

  async _loadModel(kind) {
    const K = kind;
    this.kind = K;
    this._layoutStars();
    this._unloadModel();
    const load = (async () => {
      const loader = new GLTFLoader();
      const files = [K.file, ...(K.animFiles || [])];
      if (K.weaponFile) files.push(K.weaponFile);
      const gltfs = await Promise.all(files.map((f) => loader.loadAsync(f)));
      const modelGltf = gltfs[0];
      for (const g of gltfs.slice(1, 1 + (K.animFiles || []).length)) {
        for (const clip of g.animations) this.clips[clip.name] = clip;
      }
      // Strike portions for the Barbarian's axe: trim each attack clip
      // to its strike window and store it under `<name>_strike`, so the
      // state machine can play it like any other clip.
      if (K === KINDS.barbarian) {
        for (const [name, [a, b]] of Object.entries(BARB_STRIKE_WINDOWS)) {
          const clip = this.clips[name];
          if (!clip) continue;
          const fps = 30;
          this.clips[name + '_strike'] = THREE.AnimationUtils.subclip(
            clip, name + '_strike',
            Math.round(a * clip.duration * fps),
            Math.round(b * clip.duration * fps), fps);
        }
      } else {
        // The Skeleton's takes live in its own file.
        for (const clip of modelGltf.animations) this.clips[clip.name] = clip;
      }
      const model = modelGltf.scene;
      model.scale.setScalar(K.scale);
      model.position.y = K.feetSink;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (!this._flashMats.includes(m)) this._flashMats.push(m);
          }
        }
      });
      // The axe parents to the right handslot with a quarter-turn, the
      // same transform as the hunter's sword: the KayKit weapons run
      // along local +Y with the grip at the origin, and the handslot
      // bone points the grip forward.
      if (K.weaponFile) {
        const weaponGltf = gltfs[gltfs.length - 1];
        const hand = model.getObjectByName('handslotr');
        const weapon = weaponGltf.scene;
        weapon.rotation.x = Math.PI / 2;
        if (hand) hand.add(weapon);
        else model.add(weapon);
        this.weapon = weapon;
      } else {
        this.weapon = null;
      }
      this.group.add(model);
      this.model = model;
      this.headBone = model.getObjectByName(K.headBone);
      this.mixer = new THREE.AnimationMixer(model);
      this.modelLoaded = true;
      this.loadError = null;
      // reset() already ran in the constructor and put the boss in its
      // entrance state — play the intro clip for it, not the idle.
      if (this.state === 'intro') {
        this._replayClip(K.introClip, { loop: false, clamp: true, fade: 0.1, rate: K.rates.intro });
      } else {
        this._playClip(K.clips.idle, { loop: true, rate: 1 });
      }
    })();
    this.ready = load;
    return load;
  }

  reset() {
    this.group.position.set(0, 0, -10);
    this.group.rotation.set(0, 0, 0);
    this.hp = CONFIG.bossMaxHp;
    this.state = 'intro'; // intro | idle | windup-charge | charge |
                          // windup-sweep | sweep | windup-stomp | stomp |
                          // windup-leap | leap | leap-shock |
                          // windup-spin | spin | staggered | dead
    this.stateT = 0;
    this.decideT = 1.0;  // idle time before the first move is picked
    this.poise = 0;
    this.breakHp = CONFIG.skullBreakDmg;
    this.breakBroken = false;
    this.enraged = false;
    this.chargeDir = new THREE.Vector3(0, 0, 1);
    this.contactT = 0;
    this.shock = null; // { radius, hitDone, dmg } while a shockwave expands
    this.facing = 0;
    this.stars.visible = false;
    this.ring.material.opacity = 0;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this._chargeSnorted = false;
    this._dustT = 0;
    this._flashT = 0;
    this._hitFlashSeen = false;
    this._spinHitDone = false;
    this._leapFrom = null;
    this._leapTo = null;
    this._resetPose();
    this._setEmissive(0x000000);
    // The entrance: the Skeleton rises (Spawn clip), the Barbarian
    // erupts from the ground (Spawn_Ground); then the fight starts.
    if (this.mixer) {
      this._replayClip(this.kind.introClip, { loop: false, clamp: true, fade: 0.1, rate: this.kind.rates.intro });
    }
  }

  // Wind-up poses bend the whole group out of its neutral shape; this
  // puts everything back so the next move starts clean.
  _resetPose() {
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.group.position.y = 0;
  }

  // The white hit flash / enrage pulse own every material on the model.
  _setEmissive(hex) {
    for (const m of this._flashMats) if (m.emissive) m.emissive.setHex(hex);
  }
  _setEmissiveRGB(r, g, b) {
    for (const m of this._flashMats) if (m.emissive) m.emissive.setRGB(r, g, b);
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }
  // World position of the head — hits landing here damage the break
  // target (skull / bear hat).
  get headPos() {
    if (this.headBone) {
      this.group.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(this.headBone.matrixWorld);
    }
    return this.position.clone().setY(this.kind.headFallbackY);
  }
  get sweepRange() {
    return this.breakBroken ? CONFIG.sweepRangeBroken : CONFIG.sweepRange;
  }
  // Sticky, for headless checks: true once a hit has flashed white.
  get hitFlashSeen() { return this._hitFlashSeen; }
  // Test hook kept from the old single-material boss: the Barbarian
  // has several materials, all flashed together by _setEmissive, so
  // the first one stands in for the set (emissive is uniform across
  // them). The refine suite reads the windup glow / enrage pulse here.
  get bodyMat() { return this._flashMats[0] || null; }
  // Enrage makes every windup ~25% shorter.
  get speedMult() { return this.enraged ? CONFIG.enrageSpeedMult : 1; }
  // Which clip is playing, for headless checks.
  get currentClip() { return this._currentClip; }

  // Play a clip, fading out whatever was playing. A no-op if the clip
  // is already the one running, so per-frame selection never restarts
  // a loop.
  _playClip(name, { loop = true, rate = 1, fade = 0.1, clamp = false } = {}) {
    if (!this.mixer || !name) return;
    const clip = this.clips[name];
    if (!clip) return;
    if (this._currentClip === name && this._currentAction && this._currentAction.isRunning()) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = clamp;
    action.setEffectiveTimeScale(rate);
    action.fadeIn(fade).play();
    if (this._currentAction && this._currentAction !== action) this._currentAction.fadeOut(fade);
    this._currentAction = action;
    this._currentClip = name;
  }

  _replayClip(name, opts) {
    this._currentClip = null;
    this._playClip(name, opts);
  }

  // Called by main.js when a hunter swing connects. `isHead` is true when
  // the hunter was close to the head at the moment of the hit.
  // Returns a small report main.js uses for damage numbers and sounds.
  takeDamage(dmg, isHead) {
    if (!this.alive) return null;
    this.hp = Math.max(0, this.hp - dmg);
    this.poise += dmg;
    // A hit flashes the boss WHITE, briefly — the only flash in the
    // game. Tells are body language, never a glow, so a white flash
    // can only ever mean "your sword connected".
    this._flashT = 0.12;
    this._hitFlashSeen = true;
    let broke = false;
    if (isHead && !this.breakBroken) {
      this.breakHp -= dmg;
      if (this.breakHp <= 0) {
        this.breakBroken = true;
        broke = true;
        this.sfx.skullCrack(); // the crack sound serves both breaks
      }
    }
    if (!this.enraged && this.hp <= CONFIG.bossEnrageHp && this.hp > 0) {
      this.enraged = true;
      this.sfx.roar();
    }
    let staggered = false;
    if (broke) {
      this._startStagger(CONFIG.skullBreakStagger);
      staggered = true;
    } else if (this.poise >= CONFIG.poiseMax) {
      this.poise = 0;
      this._startStagger(CONFIG.staggerTime);
      staggered = true;
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.stateT = 0;
      this.stars.visible = false;
      this.ring.material.opacity = 0;
      this._resetPose(); // never die mid-lean, mid-dip or mid-air
      this._replayClip(this.kind.clips.death, { loop: false, clamp: true, fade: 0.1, rate: this.kind.rates.death });
      this.sfx.defeat();
    }
    return { dmg, isHead, broke, breakLabel: this.kind.breakLabel, staggered, killed: this.hp <= 0 };
  }

  _startStagger(dur) {
    if (this.state === 'dead') return;
    this.state = 'staggered';
    this.stateT = 0;
    this.staggerDur = dur;
    this.stars.visible = true;
    this._setEmissive(0x000000);
    this._resetPose();
    // The Barbarian has a real hit reaction: flinch first, then slump.
    // The Skeleton has no hit clip, so it just dips.
    if (this.kind.clips.hit) {
      this._replayClip(this.kind.clips.hit, { loop: false, clamp: true, fade: 0.05, rate: this.kind.rates.hit });
    }
    this.sfx.stagger();
  }

  // Telegraph cue: one distinct sound per move, so the tell is audible
  // as well as visible. No glow — the old red emissive is gone, it read
  // as a random damage flash. Kept as one method so the move picker
  // and the debug hook cue the same way.
  _cue(move) {
    if (move === 'charge') this.sfx.cueCharge();
    else if (move === 'sweep') this.sfx.cueSweep();
    else if (move === 'stomp') this.sfx.cueStomp();
    else if (move === 'leap') this.sfx.cueLeap();
    else if (move === 'spin') this.sfx.cueSpin();
  }

  // Dust at the boss's feet: `fwd` metres in front of the body,
  // `side` metres to the side.
  _footDust(ctx, fwd, side) {
    const f = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const p = this.position.clone().addScaledVector(f, fwd).addScaledVector(r, side);
    ctx.effects?.dust(new THREE.Vector3(p.x, 0.15, p.z), 4);
  }

  update(dt, hunter, ctx) {
    this.stateT += dt;
    this.contactT = Math.max(0, this.contactT - dt);
    if (this.mixer) this.mixer.update(dt);
    // The white hit flash owns the emissive while it runs; otherwise
    // the enraged pulse (dimmed further, so it never flickers) or
    // plain bone. Nothing here ever glows red on a windup. The timer
    // is decremented BEFORE the emissive is picked, so the frame that
    // ends the flash already shows the pulse/black — otherwise the
    // boss would sit white for a whole extra frame.
    if (this._flashT > 0) this._flashT -= dt;
    if (this._flashT > 0) {
      this._setEmissive(0xffffff);
    } else if (this.enraged && this.state !== 'staggered' && this.state !== 'dead') {
      const pulse = 0.10 + 0.06 * Math.sin(this.stateT * 6);
      this._setEmissiveRGB(pulse, pulse * 0.15, 0);
    } else {
      this._setEmissive(0x000000);
    }
    if (this.state === 'dead') {
      // The Death clip plays the collapse; the body lies still after.
      return;
    }

    const K = this.kind;
    const toHunter = new THREE.Vector3().subVectors(hunter.position, this.position);
    toHunter.y = 0;
    const dist = toHunter.length();
    // Both bosses face +Z: no extra rotation.
    const faceHunter = Math.atan2(toHunter.x, toHunter.z);

    switch (this.state) {
      case 'intro': {
        // Rising / erupting; the fight starts when it is done.
        if (this.stateT >= K.introDur) this._toIdle(1.0);
        break;
      }

      case 'idle': {
        // Turn to face the hunter, close in slowly, then pick a move.
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 2.5);
        this.decideT -= dt;
        if (dist > 3.5) {
          const dir = toHunter.clone().normalize();
          this.position.addScaledVector(dir, CONFIG.bossSpeed * dt);
          this._playClip(K.clips.approach, { loop: true, rate: K.rates.approach, fade: 0.2 });
        } else {
          this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.2 });
        }
        if (this.decideT <= 0) this._pickMove(dist);
        break;
      }

      case 'windup-charge': {
        // The charge telegraph is the body itself: the boss crouches
        // low and leans forward, feet stamping the ground and kicking up
        // dust. The snort sounded once when the move was picked (_cue).
        this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.chargeWindup / this.speedMult));
        this.group.rotation.x = 0.14 * p;
        this.group.position.y = -0.25 * p;
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          this._footDust(ctx, 0.6, -0.4);
          this._footDust(ctx, 0.6, 0.4);
        }
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 1.5);
        if (this.stateT >= CONFIG.chargeWindup / this.speedMult) {
          this.chargeDir.copy(toHunter).normalize();
          this.state = 'charge';
          this.stateT = 0;
          this._dustT = 0;
          this.group.position.y = 0;
          this._replayClip(K.clips.charge, { loop: true, rate: K.rates.charge, fade: 0.1 });
        }
        break;
      }

      case 'charge': {
        // Headlong run, dust kicking up behind.
        this.group.rotation.x = 0.1;
        this._dustT += dt;
        if (this._dustT >= 0.15) {
          this._dustT = 0;
          this._footDust(ctx, -0.6, 0);
        }
        this.position.addScaledVector(this.chargeDir, CONFIG.chargeSpeed * dt);
        // Hitting the wall ends the charge in a stagger — the classic
        // "bait the charge" punish. Also ends after ~1.6s of running.
        const d = Math.hypot(this.position.x, this.position.z);
        if (d > CONFIG.arenaBound - 1 || this.stateT > 1.6) {
          this.position.x *= (CONFIG.arenaBound - 1) / Math.max(d, 0.001);
          this.position.z *= (CONFIG.arenaBound - 1) / Math.max(d, 0.001);
          this._startStagger(1.5);
          this.sfx.stomp();
          ctx.onShake(0.5);
        }
        break;
      }

      case 'windup-sweep': {
        // Sweep = LOW twist: the boss twists away to one side, weapon
        // dragging low behind it, then a fast horizontal swing. The
        // twist is roughly double the old one, so it reads.
        this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.sweepWindup / this.speedMult));
        this.group.rotation.z = 0.24 * p;
        this.group.rotation.x = -0.12 * p;
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter - 1.2 * p, dt * 1.5);
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          this._footDust(ctx, 0.6, -0.4);
          this._footDust(ctx, 0.6, 0.4);
        }
        if (this.stateT >= CONFIG.sweepWindup / this.speedMult) {
          this.group.rotation.y = faceHunter;
          this.group.rotation.z = 0;
          this.group.rotation.x = 0;
          this.state = 'sweep';
          this.stateT = 0;
          this._dustT = 0;
          this._replayClip(K.clips.sweep, { loop: false, clamp: true, fade: 0.05, rate: K.rates.sweep });
          // The hit is checked once, at the moment the weapon sweeps through.
          const inFront = Math.abs(angleDiff(this.group.rotation.y, faceHunter)) < 1.9;
          if (dist < this.sweepRange && inFront) {
            ctx.damageHunter(CONFIG.sweepDmg, this.position);
          }
          this.sfx.swing();
        }
        break;
      }

      case 'sweep': {
        // The weapon plays its swing through; recover shortly after.
        // The Barbarian leans forward and dips as the swing comes
        // through, so the axe comes down to the hunter instead of
        // passing over their head — eased in over 0.15 s, not snapped.
        if (K.sweepLean) {
          const q = Math.min(1, this.stateT / 0.15);
          this.group.rotation.x = K.sweepLean.rotX * q;
          this.group.position.y = K.sweepLean.dip * q;
        }
        if (this.stateT >= 0.45) {
          this._toIdle(1.2);
        }
        break;
      }

      case 'windup-stomp': {
        // Stomp = HIGH rear-up: the boss rears back, arms rising,
        // before slamming down. Roughly double the old rear-up, so the
        // stomp never looks like the sweep's low twist.
        this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.stompWindup / this.speedMult));
        this.group.rotation.x = -0.7 * p;
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          this._footDust(ctx, 0.6, -0.4);
          this._footDust(ctx, 0.6, 0.4);
        }
        if (this.stateT >= CONFIG.stompWindup / this.speedMult) {
          this.group.rotation.x = 0;
          this.state = 'stomp';
          this.stateT = 0;
          this._dustT = 0;
          this._replayClip(K.clips.stomp, { loop: false, clamp: true, fade: 0.05, rate: K.rates.stomp });
          this.shock = { radius: 0, hitDone: false, dmg: CONFIG.stompDmg };
          this.ring.position.set(this.position.x, 0.06, this.position.z);
          ctx.effects?.dust(new THREE.Vector3(this.position.x, 0.3, this.position.z), CONFIG.dustPuffCount);
          this.sfx.stomp();
          ctx.onShake(0.6);
        }
        break;
      }

      case 'stomp': {
        // The ring expands; the hunter is hit once, the moment the ring
        // passes under them — roll through it, don't outrun it.
        if (this._updateShock(dt, dist, ctx)) this._toIdle(1.4);
        break;
      }

      case 'windup-leap': {
        // Leap slam: a deep crouch, lower than the charge's, coiling
        // down before the jump. Dust kicks up from the feet.
        this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.leapWindup / this.speedMult));
        this.group.rotation.x = 0.28 * p;
        this.group.position.y = -0.45 * p;
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          this._footDust(ctx, 0.6, -0.4);
          this._footDust(ctx, 0.6, 0.4);
        }
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 1.5);
        if (this.stateT >= CONFIG.leapWindup / this.speedMult) {
          // Aim at where the hunter is standing as the jump starts.
          this._leapFrom = this.position.clone();
          this._leapTo = hunter.position.clone().setY(0);
          this.state = 'leap';
          this.stateT = 0;
          this._dustT = 0;
          this.group.position.y = 0;
          this.group.rotation.x = 0;
          this._replayClip(K.clips.leapFlight, { loop: false, clamp: true, fade: 0.05, rate: K.rates.leapFlight });
        }
        break;
      }

      case 'leap': {
        // An arc towards the hunter: up, over, and down on top of them.
        const t = Math.min(1, this.stateT / CONFIG.leapTime);
        if (this._leapFrom && this._leapTo) {
          this.position.lerpVectors(this._leapFrom, this._leapTo, t);
        }
        this.group.position.y = CONFIG.leapHeight * 4 * t * (1 - t);
        if (t >= 1) {
          this.group.position.y = 0;
          this.state = 'leap-shock';
          this.stateT = 0;
          this.shock = { radius: 0, hitDone: false, dmg: CONFIG.leapDmg };
          this.ring.position.set(this.position.x, 0.06, this.position.z);
          ctx.effects?.dust(new THREE.Vector3(this.position.x, 0.3, this.position.z), CONFIG.dustPuffCount + 4);
          // The Barbarian brings the axe down on landing; the Skeleton
          // just lets its Attack clip finish.
          if (K.clips.leapSlam) {
            this._replayClip(K.clips.leapSlam, { loop: false, clamp: true, fade: 0.05, rate: K.rates.leapSlam });
          }
          this.sfx.stomp();
          ctx.onShake(0.6);
        }
        break;
      }

      case 'leap-shock': {
        // The landing shockwave, same ring as the stomp.
        if (this._updateShock(dt, dist, ctx)) this._toIdle(1.4);
        break;
      }

      case 'windup-spin': {
        // Spin sweep: the boss twists hard away, weapon out wide,
        // winding up for a full 360-degree turn.
        this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.spinWindup / this.speedMult));
        this.group.rotation.z = 0.2 * p;
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter - 1.2 * p, dt * 1.5);
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          this._footDust(ctx, 0.6, -0.4);
          this._footDust(ctx, 0.6, 0.4);
        }
        if (this.stateT >= CONFIG.spinWindup / this.speedMult) {
          this.group.rotation.z = 0;
          this.state = 'spin';
          this.stateT = 0;
          this._dustT = 0;
          this._spinHitDone = false;
          this._replayClip(K.clips.spin, { loop: false, clamp: true, fade: 0.05, rate: K.rates.spin });
          this.sfx.swing();
        }
        break;
      }

      case 'spin': {
        // One full turn with the weapon out, hits all around. The hit is
        // checked once, halfway through the turn, when the weapon comes
        // around to the hunter's side.
        this.group.rotation.y += (Math.PI * 2 / CONFIG.spinTime) * dt;
        if (!this._spinHitDone && this.stateT >= CONFIG.spinTime * 0.5) {
          this._spinHitDone = true;
          if (dist < this.sweepRange) ctx.damageHunter(CONFIG.spinDmg, this.position);
        }
        if (this.stateT >= CONFIG.spinTime) {
          this._toIdle(1.2);
        }
        break;
      }

      case 'staggered': {
        // Kneel: body dips, stars orbit the head. A free punish window.
        // The Barbarian's hit flinch plays first, then he slumps into
        // his idle while the stars keep orbiting.
        this.group.position.y = -0.35;
        this.stars.rotation.y += dt * 4;
        if (K.clips.hit && this.stateT >= 0.7 && this._currentClip !== K.clips.idle) {
          this._playClip(K.clips.idle, { loop: true, rate: 1, fade: 0.2 });
        }
        if (this.stateT >= (this.staggerDur || CONFIG.staggerTime)) {
          this.group.position.y = 0;
          this.stars.visible = false;
          this._toIdle(0.8);
        }
        break;
      }
    }

    // Contact damage exists ONLY during a charge, where the body itself
    // is the telegraphed attack. Everywhere else the body is solid: it
    // pushes the hunter out to 2.0 m, no damage — standing next to the
    // boss is never a damage-over-time trap. No push-out while the
    // boss is staggered (that is the punish window), mid-charge, or
    // mid-leap (it is airborne and moving fast).
    if (this.alive && this.state === 'charge' && dist < 2.2 && this.contactT <= 0) {
      this.contactT = CONFIG.bossContactCooldown;
      ctx.damageHunter(CONFIG.bossContactDmg, this.position);
    }
    const noPush = ['charge', 'leap', 'staggered', 'dead', 'intro'].includes(this.state);
    if (this.alive && !noPush && dist > 0.01 && dist < CONFIG.bossBodyRadius) {
      const push = toHunter.clone().normalize().multiplyScalar(CONFIG.bossBodyRadius - dist);
      hunter.position.add(push);
      collide(hunter.position, 0.5);
    }

    collide(this.position, 1.8);
  }

  // Expand a shockwave ring (stomp landing or leap landing): the hunter
  // is hit once, the moment the ring passes under them. Returns true
  // when the ring has finished expanding.
  _updateShock(dt, dist, ctx) {
    if (!this.shock) return true;
    this.shock.radius += CONFIG.shockwaveSpeed * dt;
    const r = this.shock.radius;
    this.ring.scale.set(r, r, 1);
    this.ring.material.opacity = Math.max(0, 0.55 * (1 - r / CONFIG.shockwaveMaxRadius));
    if (!this.shock.hitDone && dist > r - 1.2 && dist < r + 1.2) {
      this.shock.hitDone = true;
      ctx.damageHunter(this.shock.dmg, this.position);
    }
    if (r >= CONFIG.shockwaveMaxRadius) {
      this.shock = null;
      this.ring.material.opacity = 0;
      return true;
    }
    return false;
  }

  _pickMove(dist) {
    // Far away: charge in. Mid range: leap in, or charge, or stomp.
    // Close: spin (all around), sweep, or stomp. Never attack twice in
    // a row without a breather — the cooldown is the player's opening.
    const roll = Math.random();
    let move;
    if (dist > 9) {
      move = 'charge';
    } else if (dist >= 5) {
      move = roll < 0.5 ? 'leap' : roll < 0.8 ? 'charge' : 'stomp';
    } else {
      move = roll < 0.3 ? 'spin' : roll < 0.65 ? 'sweep' : 'stomp';
    }
    this.state = 'windup-' + move;
    this.stateT = 0;
    this._dustT = 0;
    this._cue(move);
  }

  _toIdle(cooldown) {
    this.state = 'idle';
    this.stateT = 0;
    this.decideT = cooldown;
    this._chargeSnorted = false;
    this._resetPose();
    this._playClip(this.kind.clips.idle, { loop: true, rate: 1, fade: 0.15 });
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
