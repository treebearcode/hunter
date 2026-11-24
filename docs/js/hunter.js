// hunter.js — the player character: the KayKit Knight, with a longsword,
// plus all of the hunter's own rules (movement, dodge, the 3-hit light
// combo, the heavy swing, healing). The hunter does NOT know about the
// boss's internals — it calls back into main.js through `ctx` when a
// swing connects, and main.js decides what the swing hit.
//
// Models: Knight.glb (KayKit Adventurers, CC0) on the shared Rig_Medium
// skeleton; the sword is KayKit's sword_1handed, parented to the right
// handslot bone. Movement and attack clips come from the KayKit
// Character Animations pack (same Rig_Medium rig, so the clips retarget
// onto the Knight with no edits). The attack clips run 1.0–1.6 s
// against the game's 0.45–0.7 s swing windows, so each swing plays
// only the strike portion of its clip (built with
// THREE.AnimationUtils.subclip) at near-natural speed — the wind-up
// and follow-through are trimmed, not fast-forwarded. Hit timing is
// unchanged: damage still lands halfway through the swing, so combat
// feels identical to before.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { collide } from './arena.js';

const UP = new THREE.Vector3(0, 1, 0);

// Knight is 2.543 m tall in the file; at this scale he stands ~1.91 m,
// the same height as the old procedural hunter, so movement speed,
// camera distance and hitboxes all feel the same.
const KNIGHT_SCALE = 0.75;

// Clip file -> which clips we take from it. The animation GLBs each
// carry a whole set on the Rig_Medium skeleton; we only play these.
const ANIM_FILES = [
  'assets/Rig_Medium_CombatMelee.glb',
  'assets/Rig_Medium_MovementBasic.glb',
  'assets/Rig_Medium_MovementAdvanced.glb',
  'assets/Rig_Medium_General.glb',
];

// Light combo, one distinct swing per hit: horizontal slice,
// diagonal slice, two-handed horizontal slice finisher. Heavy: the
// big 2H chop. Stab: the 1H thrust, a chord move (F+G / LMB+RMB),
// never part of the combo.
// STRIKE_WINDOWS trims each clip to its strike portion, as a fraction
// of the clip's duration: wind-up and follow-through are cut, the
// strike plays at near-natural speed. Measured from the clips' keyframe
// motion: the KayKit slices strike FAST at the START (the blade raises
// through the front in the first ~15% of the clip) and then hover — so
// the windows start at 0.00, not mid-clip. The stab's thrust is
// [0.15, 0.50]: pull-back first, full extension at ~0.30, retract after.
//
// WIDEN bakes a torso/shoulder yaw sweep into each strike clip so the
// blade sweeps the WHOLE frontal width, not just the sword-arm side:
// the KayKit swings never take the blade past the hunter's centre line
// (measured tip lateral span: light1 -1.45..-0.18, light2 -1.45..-0.73,
// light3 -0.59..-0.17, heavy -1.17..-0.49, stab -1.28..-0.98 — all on
// the right), while the hitbox is the full width in front. Each number
// is a peak yaw in radians for that bone's rotation track, 0 at both
// ends of the clip and peaking in the middle (the hit moment), so the
// clip still starts/ends at the rest pose. The twist distributes across
// root, spine, chest and sword shoulder — the model itself never
// rotates, so the facing and the hitbox never move, only the blade's
// arc widens. The root yaw is the whole-body turn into the cut (hips
// and feet turn with it, as in a real slash); two-handed swings get
// less shoulder yaw so both hands stay on the grip.
const WIDEN = {
  // light1: the horizontal slice's blade is high and close to the body
  // axis at the hit moment, so a big whole-body (root) yaw swings it
  // around the axis instead of across the front and kills its forward
  // reach — keep the root small, lean on spine + shoulder instead.
  'Melee_1H_Attack_Slice_Horizontal': { root: 0.10, spine: 0.45, chest: 0.20, upperarmr: 0.50 },
  'Melee_1H_Attack_Slice_Diagonal': { root: 0.55, spine: 0.40, chest: 0.40, upperarmr: 0.60 },
  'Melee_2H_Attack_Slice': { root: 0.60, spine: 0.40, chest: 0.40, upperarmr: 0.30 },
  // Heavy: the chop already descends leftwards on its own, so less yaw
  // lands it down the middle instead of past it.
  'Melee_2H_Attack_Chop': { root: 0.40, spine: 0.30, chest: 0.30, upperarmr: 0.25 },
  // Stab: the thrust is a line, not an arc — centre it with the root
  // turn (a true vertical axis) and keep the tilted torso/shoulder
  // yaw minimal, or the blade drops and stabs low instead of at the
  // boss's chest.
  'Melee_1H_Attack_Stab': { root: 0.80, spine: 0.10, chest: 0.05, upperarmr: 0.10 },
};

// Bake the yaw sweep from WIDEN into a clip: the root, spine, chest
// and sword-shoulder rotation tracks are rebuilt on a 30fps grid, each
// keyframe premultiplied by a yaw about the parent's vertical axis, so
// the whole upper body turns as one unit and carries the blade across
// the front. The grid rebuild matters: the KayKit clips leave unmoving
// bones out entirely, or with a single keyframe at the clip start —
// editing those in place would be a no-op (the sweep is 0 at both
// ends), so the base pose is sampled (slerp between the track's own
// keyframes) and the sweep is written at every grid point. A track
// missing from the strike subclip is sampled from the SOURCE clip at
// the matching time — the subclip drops tracks with no keyframe inside
// its window, but the bone still moves there by interpolation, so the
// bone's rest pose would be the wrong base. Returns the clip.
function _widenClip(clip, amps, model, source, windowFrac) {
  const yaw = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const dur = clip.duration;
  const fps = 30;
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const [wa, wb] = windowFrac || [0, 1];
  const srcDur = source ? source.duration : dur;
  // Quaternion at time t of a track (slerp between its keyframes), or
  // null when the track has no usable keyframes.
  const sampleTrack = (track, t) => {
    const times = track.times, vals = track.values;
    if (!times.length) return null;
    let k = 0;
    while (k < times.length - 2 && times[k + 1] <= t) k++;
    const a = new THREE.Quaternion().set(vals[k * 4], vals[k * 4 + 1], vals[k * 4 + 2], vals[k * 4 + 3]);
    const t1 = times[k + 1];
    if (t1 === undefined || t1 <= times[k]) return a;
    const b = new THREE.Quaternion().set(vals[(k + 1) * 4], vals[(k + 1) * 4 + 1], vals[(k + 1) * 4 + 2], vals[(k + 1) * 4 + 3]);
    return new THREE.Quaternion().slerpQuaternions(a, b, (t - times[k]) / (t1 - times[k]));
  };
  for (const [bone, amp] of Object.entries(amps)) {
    if (!amp) continue;
    let track = clip.tracks.find((t) => t.name === bone + '.quaternion');
    const base = [];
    for (let i = 0; i < n; i++) {
      const t = (i === n - 1) ? dur : i / fps;
      let q = null;
      if (track) q = sampleTrack(track, t);
      if (!q && source) {
        // Missing from the subclip: sample the source clip at the
        // matching time (subclip time t is fraction t/dur of the
        // window [wa, wb] of the source clip).
        const srcTrack = source.tracks.find((s) => s.name === bone + '.quaternion');
        if (srcTrack) q = sampleTrack(srcTrack, (wa + (wb - wa) * (t / dur)) * srcDur);
      }
      if (!q) {
        const boneObj = model ? model.getObjectByName(bone) : null;
        q = boneObj ? boneObj.quaternion.clone() : new THREE.Quaternion();
      }
      base.push(q);
    }
    if (!track) {
      track = new THREE.QuaternionKeyframeTrack(bone + '.quaternion', new Float32Array(n), new Float32Array(n * 4));
      clip.tracks.push(track);
    } else {
      track.times = new Float32Array(n);
      track.values = new Float32Array(n * 4);
    }
    for (let i = 0; i < n; i++) {
      const t = (i === n - 1) ? dur : i / fps;
      const phi = amp * Math.sin(Math.PI * (t / dur));
      const q = base[i];
      if (Math.abs(phi) > 1e-6) {
        yaw.setFromAxisAngle(Y, phi);
        q.premultiply(yaw);
      }
      track.times[i] = t;
      track.values[i * 4] = q.x; track.values[i * 4 + 1] = q.y;
      track.values[i * 4 + 2] = q.z; track.values[i * 4 + 3] = q.w;
    }
  }
  return clip;
}
const LIGHT_CLIPS = [
  'Melee_1H_Attack_Slice_Horizontal',
  'Melee_1H_Attack_Slice_Diagonal',
  'Melee_2H_Attack_Slice',
];
const HEAVY_CLIP = 'Melee_2H_Attack_Chop';
const STAB_CLIP = 'Melee_1H_Attack_Stab';
const STRIKE_WINDOWS = {
  'Melee_1H_Attack_Slice_Horizontal': [0.00, 0.30],
  'Melee_1H_Attack_Slice_Diagonal': [0.00, 0.40],
  'Melee_2H_Attack_Slice': [0.15, 0.55],
  'Melee_1H_Attack_Stab': [0.15, 0.50],
};

export class Hunter {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.group = new THREE.Group(); // the whole hunter; position = feet
    this.group.position.set(0, 0, 12); // start at the south edge, facing in
    scene.add(this.group);

    // -- Sword trail: a ribbon swept by the blade through a swing. It is
    //    rebuilt every frame from recent blade-tip / blade-base pairs
    //    (world space, so the ribbon stays where the cut happened even
    //    as the hunter lunges). Samples older than trailMaxAge drop off.
    this.trailSamples = [];
    const TRAIL_MAX = 14;
    this._trailMax = TRAIL_MAX;
    this._trailPos = new Float32Array(TRAIL_MAX * 2 * 3);
    this._trailCol = new Float32Array(TRAIL_MAX * 2 * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 3));
    const trailIdx = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const a = i * 2;
      trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    trailGeo.setIndex(trailIdx);
    this.trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.trailMesh.frustumCulled = false;
    this.trailMesh.visible = false;
    scene.add(this.trailMesh);

    // -- Model loading (async): the Knight, his sword, and the clips.
    //    The game state machine runs regardless — until the model lands
    //    the hunter is just an invisible position — so the Start button
    //    stays disabled until `ready` resolves (main.js handles that).
    this.modelLoaded = false;
    this.loadError = null;
    this.mixer = null;
    this.clips = {};        // clip name -> AnimationClip
    this._currentClip = null;
    this._currentAction = null;
    this._hitT = 0;         // seconds left of the hurt-flinch clip
    this._materials = [];   // Knight materials, for the hurt flash
    this._swordTip = null;  // Object3D markers on the blade, for the trail
    this._swordBase = null;
    this._scene = scene;    // kept for dodge afterimages
    this._fx = null;        // effects, picked up from ctx each frame
    this._dodgeFov = 0;     // 1 at dodge start, decays after — camera kick
    this._afterimages = []; // { mesh, life } fading dodge ghosts
    this._dodgeGhostT = 0;  // time since the last ghost was spawned
    this._dodgeLean = { x: 0, z: 0 }; // model lean into the dodge
    this.ready = this._loadModel(scene);

    this.reset();
  }

  async _loadModel(scene) {
    try {
      const loader = new GLTFLoader();
      const [knight, sword, ...animGltfs] = await Promise.all([
        loader.loadAsync('assets/Knight.glb'),
        loader.loadAsync('assets/sword_1handed.glb'),
        ...ANIM_FILES.map((f) => loader.loadAsync(f)),
      ]);
      for (const g of animGltfs) {
        for (const clip of g.animations) this.clips[clip.name] = clip;
      }
      // Strike portions: trim each light/stab clip to its strike window
      // and store it under `<name>_strike`, so _playClip can use it
      // like any other clip. Played at subclip.duration / swing time —
      // near-natural speed, not a 3x fast-forward.
      for (const [name, [a, b]] of Object.entries(STRIKE_WINDOWS)) {
        const clip = this.clips[name];
        if (!clip) continue;
        const fps = 30;
        const strike = THREE.AnimationUtils.subclip(
          clip, name + '_strike',
          Math.round(a * clip.duration * fps),
          Math.round(b * clip.duration * fps), fps);
        this.clips[name + '_strike'] = strike;
      }
      const model = knight.scene;
      model.scale.setScalar(KNIGHT_SCALE);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (!this._materials.includes(m)) this._materials.push(m);
          }
        }
      });
      this.group.add(model);
      this.model = model;
      // Widen the strike portions (and the heavy's full clip, cloned so
      // the source clip is untouched) so the blade sweeps the whole
      // frontal width instead of staying on the sword-arm side. Needs
      // this.model and the source clips: tracks missing from a strike
      // subclip are sampled from the source clip at the matching time.
      for (const name of Object.keys(STRIKE_WINDOWS)) {
        const strike = this.clips[name + '_strike'];
        if (strike && WIDEN[name]) _widenClip(strike, WIDEN[name], this.model, this.clips[name], STRIKE_WINDOWS[name]);
      }
      if (this.clips[HEAVY_CLIP] && WIDEN[HEAVY_CLIP]) {
        this.clips[HEAVY_CLIP] = _widenClip(this.clips[HEAVY_CLIP].clone(), WIDEN[HEAVY_CLIP], this.model, this.clips[HEAVY_CLIP], [0, 1]);
      }

      // The sword's blade runs along its local +Y with the grip at the
      // origin, so it parents to the hand with no offset — but the
      // handslot bone points the grip forward, so the blade needs a
      // quarter-turn to stand up from the fist like a held longsword.
      // (Bone names lose their dots in three.js: handslot.r -> handslotr.)
      const hand = model.getObjectByName('handslotr');
      const swordMesh = sword.scene;
      swordMesh.rotation.x = Math.PI / 2;
      hand.add(swordMesh);
      this.sword = swordMesh;
      // Trail markers on the blade, in sword-local space: tip near the
      // point of the blade, base just above the crossguard.
      this._swordTip = new THREE.Object3D();
      this._swordTip.position.set(0, 1.41, 0);
      this._swordBase = new THREE.Object3D();
      this._swordBase.position.set(0, 0.2, 0);
      swordMesh.add(this._swordTip, this._swordBase);

      this.mixer = new THREE.AnimationMixer(model);
      this.modelLoaded = true;
      this._playClip('Idle_A', { loop: true, rate: 1 });
    } catch (e) {
      this.loadError = e;
      console.error('Hunter model failed to load:', e);
    }
  }

  reset() {
    this.group.position.set(0, 0, 12);
    this.group.rotation.set(0, Math.PI, 0); // facing the arena centre
    this.hp = CONFIG.hunterMaxHp;
    this.stamina = CONFIG.staminaMax;
    this.heals = CONFIG.healCount;
    this.state = 'idle'; // idle | attack | dodge | heal | dead
    this.stateT = 0;     // time spent in the current state
    this.attackKind = null; // 'light' | 'heavy' | 'stab'
    this.attackIndex = 0;   // which hit of the light combo (0, 1, 2)
    this.hitDone = false;   // the swing has already applied its damage
    this.comboQueued = false;
    this.comboGrace = 0;    // seconds left of the post-swing chain window
    this.iframes = 0;       // > 0 while a dodge roll is protecting us
    this.hurtInvuln = 0;    // brief protection right after taking a hit
    this.staminaDelay = 0;  // time since stamina was last spent
    this.facing = Math.PI;  // yaw the hunter is turning towards
    this.rollDir = new THREE.Vector3(0, 0, -1);
    this.moving = false;
    this.attackFacingSnapped = false; // facing locked in at swing start
    this._hitT = 0;
    this.trailSamples = [];
    this.trailMesh.visible = false;
    this._dodgeFov = 0;
    this._dodgeGhostT = 0;
    this._dodgeLean = { x: 0, z: 0 };
    this._setFlash(false);
    for (const g of this._afterimages) this._scene.remove(g.mesh);
    this._afterimages = [];
    if (this.model) { this.model.rotation.x = 0; this.model.rotation.z = 0; }
    if (this.mixer) this._playClip('Idle_A', { loop: true, rate: 1 });
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }
  // Trail state, for headless checks.
  get trailAlive() { return this.trailSamples.length; }
  get trailVisible() { return this.trailMesh.visible; }
  // Which clip is playing, for headless checks.
  get currentClip() { return this._currentClip; }
  // FOV kick (0..1) for the camera while dodging, for headless checks.
  get dodgeFov() { return this._dodgeFov; }
  // Live dodge afterimages, for headless checks.
  get afterimageCount() { return this._afterimages.length; }
  // Combo counter for the HUD: 1/2/3 while swinging or inside the
  // grace window after a light swing, 0 otherwise.
  get comboDisplay() {
    if (this.attackKind !== 'light') return 0;
    if (this.state === 'attack') return this.attackIndex + 1;
    if (this.comboGrace > 0) return this.attackIndex + 1;
    return 0;
  }
  // World position of the sword hand, for headless pose checks.
  get handWorldPos() {
    if (!this.model) return null;
    const hand = this.model.getObjectByName('handr');
    if (!hand) return null;
    const p = new THREE.Vector3();
    hand.getWorldPosition(p);
    return { x: p.x, y: p.y, z: p.z };
  }

  _spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0;
  }

  // -- Animation ------------------------------------------------------------
  // Play a clip, fading out whatever was playing. A no-op if the clip
  // is already the one running, so the per-frame clip selection in
  // update() never restarts a loop.
  _playClip(name, { loop = true, rate = 1, fade = 0.1, clamp = false } = {}) {
    if (!this.mixer) return;
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

  // Force a clip switch even if it is the one already playing — used
  // when a combo chains into the same clip name again (it never does
  // for the light combo, but the guard keeps the helper honest).
  _replayClip(name, opts) {
    this._currentClip = null;
    this._playClip(name, opts);
  }

  // Flash the hunter red briefly after taking a hit (readability).
  _setFlash(on) {
    for (const m of this._materials) {
      if (m.emissive) m.emissive.setHex(on ? 0x882222 : 0x000000);
    }
  }

  // Which swing is playing, and how long it lasts. Light and stab use
  // their strike-portion clips (near-natural speed); heavy plays the
  // whole 2H chop sped up to its 0.7 s window, as before.
  _attackClip() {
    if (this.attackKind === 'heavy') {
      const clip = this.clips[HEAVY_CLIP];
      return { name: HEAVY_CLIP, rate: clip ? clip.duration / CONFIG.heavyTime : 1 };
    }
    if (this.attackKind === 'stab') {
      const clip = this.clips[STAB_CLIP + '_strike'];
      return { name: STAB_CLIP + '_strike', rate: clip ? clip.duration / CONFIG.stabTime : 1 };
    }
    const name = LIGHT_CLIPS[this.attackIndex] + '_strike';
    const clip = this.clips[name];
    return { name, rate: clip ? clip.duration / CONFIG.lightComboTime : 1 };
  }
  _attackDur() {
    if (this.attackKind === 'heavy') return CONFIG.heavyTime;
    if (this.attackKind === 'stab') return CONFIG.stabTime;
    return CONFIG.lightComboTime;
  }
  // Exaggerated lean for the current swing, applied to the model (not
  // the group — the group yaw is the facing). The lean follows the
  // swing's plane — forward, into the cut — instead of tipping the
  // model sideways: a heavy z-lean pushed the whole blade arc off to
  // the hunter's right, so the swing read as a side flourish while
  // the hit landed in front.
  _attackLean() {
    if (this.attackKind === 'heavy') return { x: 0.35, z: 0.05 };
    // Stab: a shallower lean than the swings — the widened thrust reaches
    // much further forward, so the old 0.22 pitch dropped the tip low
    // (y 0.64); 0.12 keeps the thrust level at chest height.
    if (this.attackKind === 'stab') return { x: 0.12, z: 0 };
    return [{ x: 0.12, z: 0.10 }, { x: 0.20, z: 0.10 }, { x: 0.25, z: 0.05 }][this.attackIndex];
  }

  // Start a light swing. Called on a click; if we are mid-swing it queues
  // the next combo hit instead, which is how the 3-hit combo chains.
  // The buffer opens early (attackBufferStart into the swing), so a
  // press slightly before the current swing ends still chains — presses
  // before that are dropped, not held forever. A press up to comboGrace
  // AFTER a swing ends also still chains, so a slightly late click does
  // not restart the combo at swing 1.
  tryLight() {
    if (!this.alive || this.state === 'dodge' || this.state === 'heal') return;
    if (this.state === 'attack') {
      if (this.attackKind === 'light' && this.stateT > CONFIG.attackBufferStart) this.comboQueued = true;
      return;
    }
    if (this.stamina < CONFIG.lightCost) return;
    // Inside the grace window after a light swing: chain to the next
    // hit instead of restarting at swing 1.
    if (this.comboGrace > 0 && this.attackKind === 'light' && this.attackIndex < 2) {
      this.comboGrace = 0;
      this.attackIndex++;
      this._spendStamina(CONFIG.lightCost);
      this._beginAttack();
      return;
    }
    this._spendStamina(CONFIG.lightCost);
    this.attackKind = 'light';
    this.attackIndex = 0;
    this.comboGrace = 0;
    this._beginAttack();
  }

  tryHeavy() {
    if (!this.alive || this.state !== 'idle') return;
    if (this.stamina < CONFIG.heavyCost) return;
    this._spendStamina(CONFIG.heavyCost);
    this.attackKind = 'heavy';
    this.comboGrace = 0;
    this._beginAttack();
  }

  // The stab thrust: a standalone chord move, never part of the light
  // combo. Only from idle — it is a deliberate poke, not a combo link.
  // Returns true when the stab actually starts.
  tryStab() {
    if (!this.alive || this.state !== 'idle') return false;
    if (this.stamina < CONFIG.stabCost) return false;
    this._spendStamina(CONFIG.stabCost);
    this.attackKind = 'stab';
    this.comboGrace = 0;
    this._beginAttack();
    return true;
  }

  // Chord conversion: the second half of a light+heavy chord (F+G /
  // LMB+RMB) lands while a light or heavy swing is still before its
  // hit — turn that swing into a stab instead of starting a new one.
  // The first press already fired a swing immediately (no input delay),
  // so the chord has to convert it, not wait for it. Returns false if
  // there is nothing to convert (too late, wrong state, no stamina).
  tryConvertStab() {
    if (!this.alive || this.state !== 'attack' || this.hitDone) return false;
    if (this.attackKind !== 'light' && this.attackKind !== 'heavy') return false;
    const spent = this.attackKind === 'light' ? CONFIG.lightCost : CONFIG.heavyCost;
    const extra = CONFIG.stabCost - spent;
    if (extra > 0 && this.stamina < extra) return false;
    if (extra > 0) this._spendStamina(extra);
    this.attackKind = 'stab';
    this.stateT = 0;
    this.hitDone = false;
    this.attackFacingSnapped = false;
    this.comboQueued = false;
    this.comboGrace = 0;
    const { name, rate } = this._attackClip();
    this._replayClip(name, { loop: false, clamp: true, fade: 0.05, rate });
    this._swingSound();
    return true;
  }

  _beginAttack() {
    this.state = 'attack';
    this.stateT = 0;
    this.hitDone = false;
    this.attackFacingSnapped = false;
    const { name, rate } = this._attackClip();
    this._replayClip(name, { loop: false, clamp: true, fade: 0.05, rate });
    this._swingSound();
  }

  // One whoosh per swing, pitched by which swing it is: the light combo
  // rises 1.0 / 1.15 / 1.3, the heavy is low and deep at 0.7, the stab
  // is lower and sharper than the combo at 0.85.
  _swingSound() {
    const pitch = this.attackKind === 'heavy' ? 0.7
      : this.attackKind === 'stab' ? CONFIG.stabPitch
      : [1.0, 1.15, 1.3][this.attackIndex];
    this.sfx.swing(pitch);
  }

  tryDodge(dir) {
    if (!this.alive || this.state === 'dodge') return;
    // Dodge-cancel: a swing can only be cancelled into a dodge AFTER its
    // hit has landed (stateT past the hit point). Cancelling earlier
    // would let the hunter bail on the commitment of every swing.
    if (this.state === 'attack' && !this.hitDone) return;
    if (this.state === 'attack') this.comboQueued = false;
    if (this.stamina < CONFIG.dodgeCost) return;
    this._spendStamina(CONFIG.dodgeCost);
    // Roll in the direction we are moving, or backwards if standing still.
    this.rollDir.copy(dir.lengthSq() > 0.01 ? dir : new THREE.Vector3(0, 0, 1));
    this.rollDir.y = 0;
    this.rollDir.normalize();
    this.state = 'dodge';
    this.stateT = 0;
    this.iframes = CONFIG.dodgeTime;
    this.comboGrace = 0;
    this._dodgeFov = 1; // camera FOV kick: the dodge should feel fast
    this._dodgeGhostT = 0;
    // Lean the model into the dodge direction: forward component tips
    // it forward, sideways component tips it sideways.
    const fwd0 = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right0 = new THREE.Vector3(fwd0.z, 0, -fwd0.x);
    this._dodgeLean = {
      x: 0.25 * this.rollDir.dot(fwd0),
      z: -0.25 * this.rollDir.dot(right0),
    };
    // Dust burst at the dodge start, so the roll reads from the feet.
    if (this._fx) this._fx.dust(this.position.clone().setY(0.15), CONFIG.dodgeDustCount);
    this._spawnAfterimage();
    // The dodge clips are quick steps, not rolls: pick the one that
    // matches the roll direction relative to where we face.
    const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const f = this.rollDir.dot(fwd);
    const r = this.rollDir.dot(right);
    const clipName = Math.abs(f) >= Math.abs(r)
      ? (f >= 0 ? 'Dodge_Forward' : 'Dodge_Backward')
      : (r >= 0 ? 'Dodge_Right' : 'Dodge_Left');
    const clip = this.clips[clipName];
    this._replayClip(clipName, {
      loop: false, clamp: true, fade: 0.05,
      rate: clip ? clip.duration / CONFIG.dodgeTime : 1,
    });
    this.sfx.dodge();
  }

  tryHeal() {
    if (!this.alive || this.state !== 'idle' || this.heals <= 0) return;
    if (this.hp >= CONFIG.hunterMaxHp) return;
    this.state = 'heal';
    this.stateT = 0;
    this.comboGrace = 0;
    const clip = this.clips['Use_Item'];
    this._replayClip('Use_Item', {
      loop: false, clamp: true, fade: 0.1,
      rate: clip ? clip.duration / CONFIG.healTime : 1,
    });
  }

  // A fading ghost of the Knight at the dodge position: a clone of the
  // model with transparent materials, gone after afterimageLife.
  _spawnAfterimage() {
    if (!this.model || !this._scene) return;
    const ghost = this.model.clone(true);
    ghost.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = mats.map((m) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = 0.3;
          c.depthWrite = false;
          return c;
        });
        if (!Array.isArray(o.material)) o.material = o.material[0];
      }
    });
    ghost.position.copy(this.group.position);
    ghost.rotation.y = this.group.rotation.y;
    ghost.scale.copy(this.model.scale);
    this._scene.add(ghost);
    this._afterimages.push({ mesh: ghost, life: CONFIG.afterimageLife });
  }

  _updateAfterimages(dt) {
    for (let i = this._afterimages.length - 1; i >= 0; i--) {
      const g = this._afterimages[i];
      g.life -= dt;
      if (g.life <= 0) {
        this._scene.remove(g.mesh);
        g.mesh.traverse((o) => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) m.dispose();
          }
        });
        this._afterimages.splice(i, 1);
      } else {
        const f = g.life / CONFIG.afterimageLife;
        g.mesh.traverse((o) => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) m.opacity = 0.3 * f;
          }
        });
      }
    }
  }
  takeDamage(dmg, fromPos) {
    if (!this.alive || this.iframes > 0 || this.hurtInvuln > 0) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtInvuln = 0.8;
    if (this.state === 'heal') { this.state = 'idle'; this.stateT = 0; } // heal interrupted
    // Knockback: shove the hunter away from whatever hit them.
    const away = new THREE.Vector3().subVectors(this.position, fromPos);
    away.y = 0;
    if (away.lengthSq() > 0.001) {
      away.normalize();
      this.position.addScaledVector(away, 0.8);
      collide(this.position, 0.5);
    }
    this.sfx.hurt();
    // Flinch, but only if we are standing around — never yank the hunter
    // out of a swing, a dodge or a heal that is already playing.
    if (this.state === 'idle' && this.clips['Hit_A']) {
      this._hitT = 0.33;
      this._replayClip('Hit_A', { loop: false, clamp: true, fade: 0.05, rate: 2 });
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.stateT = 0;
      this._hitT = 0;
      this._replayClip('Death_A', { loop: false, clamp: true, fade: 0.1, rate: 1 });
      this.sfx.defeat();
    }
    return true;
  }

  update(dt, input, ctx) {
    this.stateT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtInvuln = Math.max(0, this.hurtInvuln - dt);
    this.staminaDelay += dt;
    if (this.staminaDelay > CONFIG.staminaRegenDelay && this.state !== 'dodge') {
      this.stamina = Math.min(CONFIG.staminaMax, this.stamina + CONFIG.staminaRegen * dt);
    }
    this._hitT = Math.max(0, this._hitT - dt);
    if (ctx.effects) this._fx = ctx.effects;
    // Dodge FOV kick decays back to normal shortly after the roll.
    this._dodgeFov = Math.max(0, this._dodgeFov - dt * 3);
    this._updateAfterimages(dt);
    // The grace window only runs while standing around, not mid-swing.
    if (this.state !== 'attack') this.comboGrace = Math.max(0, this.comboGrace - dt);
    if (this.mixer) this.mixer.update(dt);

    if (!this.alive) return;

    // -- Movement direction, relative to where the camera looks. --------
    const move = new THREE.Vector3();
    if (input.forward) move.z -= 1;
    if (input.back) move.z += 1;
    if (input.left) move.x -= 1;
    if (input.right) move.x += 1;
    if (move.lengthSq() > 0) {
      move.normalize();
      // Rotate the camera-relative input into world space.
      // The camera sits at hunter + (sin yaw, cos yaw) * dist, so the
      // direction the camera looks (screen-up / W) is
      //   forward F = (-sin yaw, -cos yaw)
      // and screen-right (D) is
      //   right   R = ( cos yaw, -sin yaw)
      // W is input (0,-1), D is (+1,0), so world = mx*R + (-mz)*F, i.e.
      //   wx = mx*cos + mz*sin,  wz = -mx*sin + mz*cos.
      const sin = Math.sin(input.camYaw), cos = Math.cos(input.camYaw);
      const wx = move.x * cos + move.z * sin;
      const wz = -move.x * sin + move.z * cos;
      move.set(wx, 0, wz).normalize();
    }
    this.moving = move.lengthSq() > 0;

    // -- Facing: locked-on we face the boss; otherwise we face our run. ---
    if (ctx.locked && ctx.bossPos) {
      // Face the boss: direction FROM the hunter TO the boss.
      this.facing = Math.atan2(ctx.bossPos.x - this.position.x, ctx.bossPos.z - this.position.z);
    } else if (this.moving && this.state !== 'attack') {
      this.facing = Math.atan2(move.x, move.z);
    }
    this.group.rotation.y = turnTowards(this.group.rotation.y, this.facing, dt * 12);

    // Face the target at the START of a swing, not mid-swing: locked-on
    // we snap to the boss, otherwise to the direction we are running.
    // Without this a swing started just after a dodge went sideways.
    if (this.state === 'attack' && !this.attackFacingSnapped) {
      if (ctx.locked && ctx.bossPos) {
        this.facing = Math.atan2(ctx.bossPos.x - this.position.x, ctx.bossPos.z - this.position.z);
      } else if (this.moving) {
        this.facing = Math.atan2(move.x, move.z);
      }
      this.group.rotation.y = this.facing;
      this.attackFacingSnapped = true;
    }

    // -- State machine ------------------------------------------------------
    if (this.state === 'dodge') {
      this.position.addScaledVector(this.rollDir, CONFIG.dodgeSpeed * dt);
      // A second ghost halfway through the roll, so the afterimage
      // stretches along the whole dodge path, not just its start.
      this._dodgeGhostT += dt;
      if (this._dodgeGhostT >= 0.17) {
        this._dodgeGhostT = 0;
        this._spawnAfterimage();
      }
      // Lean into the roll while it lasts.
      if (this.model) {
        this.model.rotation.x = this._dodgeLean.x;
        this.model.rotation.z = this._dodgeLean.z;
      }
      if (this.stateT >= CONFIG.dodgeTime) {
        // Landing dust + a final ghost at the end of the path.
        if (this._fx) this._fx.dust(this.position.clone().setY(0.15), CONFIG.dodgeDustCount);
        this._spawnAfterimage();
        this.state = 'idle';
        this.stateT = 0;
      }
    } else if (this.state === 'attack') {
      const dur = this._attackDur();
      const hitAt = dur * 0.5; // the hit lands halfway through the swing
      if (!this.hitDone && this.stateT >= hitAt) {
        this.hitDone = true;
        const dmg = this.attackKind === 'light' ? CONFIG.lightComboDmg[this.attackIndex]
          : this.attackKind === 'stab' ? CONFIG.stabDmg : CONFIG.heavyDmg;
        const range = this.attackKind === 'light' ? CONFIG.lightRange
          : this.attackKind === 'stab' ? CONFIG.stabRange : CONFIG.heavyRange;
        ctx.onAttackHit(dmg, range, this.attackKind);
      }
      // Lunge: a short step forward during the strike part of the swing,
      // so the attack closes the last step of distance. It stops short
      // of the boss's body — no lunging through it — and the arena
      // bounds (collide, below) stop it leaving the ring.
      const p = this.stateT / dur;
      if (p >= CONFIG.lungeStart && p <= CONFIG.lungeEnd) {
        const speed = this.attackKind === 'heavy' ? CONFIG.lungeHeavySpeed
          : this.attackKind === 'stab' ? CONFIG.lungeStabSpeed : CONFIG.lungeLightSpeed;
        const dir = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
        const next = this.position.clone().addScaledVector(dir, speed * dt);
        const bossXZ = ctx.bossPos ? new THREE.Vector3(ctx.bossPos.x, 0, ctx.bossPos.z) : null;
        if (!bossXZ || next.distanceTo(bossXZ) >= 2.0) this.position.copy(next);
      }
      // Exaggerated lean for this swing, so the three combo hits read
      // as three different moves even at a glance.
      if (this.model) {
        const lean = this._attackLean();
        this.model.rotation.x = lean.x;
        this.model.rotation.z = lean.z;
      }
      if (this.stateT >= dur) {
        if (this.attackKind === 'light' && this.comboQueued && this.attackIndex < 2) {
          // Chain into the next combo hit.
          this.comboQueued = false;
          this.attackIndex++;
          this._spendStamina(CONFIG.lightCost);
          this.stateT = 0;
          this.hitDone = false;
          this.attackFacingSnapped = false;
          const { name, rate } = this._attackClip();
          this._replayClip(name, { loop: false, clamp: true, fade: 0.05, rate });
          this._swingSound();
        } else {
          this.comboQueued = false;
          // A light swing leaves a short grace window to chain late;
          // heavy and stab just end the combo.
          if (this.attackKind === 'light' && this.attackIndex < 2) {
            this.comboGrace = CONFIG.comboGrace;
          } else {
            this.comboGrace = 0;
          }
          this.state = 'idle';
          this.stateT = 0;
        }
      }
    } else if (this.state === 'heal') {
      if (this.stateT >= CONFIG.healTime) {
        this.hp = Math.min(CONFIG.hunterMaxHp, this.hp + CONFIG.healAmount);
        this.heals--;
        this.state = 'idle';
        this.stateT = 0;
        this.sfx.heal();
        ctx.onHeal();
      }
    } else {
      // Idle: normal running. Attacks freeze movement (handled above by
      // the state machine — only idle and dodge move the hunter).
      if (this.moving) {
        this.position.addScaledVector(move, CONFIG.hunterSpeed * dt);
      }
    }

    collide(this.position, 0.5);

    // -- Animation: which clip should be playing. Attacks, dodges, heals
    //    and death set their own clip at the moment they start; idle and
    //    run are picked here every frame, and the hurt flinch overrides
    //    them briefly. _playClip is a no-op when the clip is already
    //    running, so this never restarts a loop.
    if (this.state === 'idle') {
      if (this._hitT > 0) {
        this._playClip('Hit_A', { loop: false, clamp: true, fade: 0.05, rate: 2 });
      } else if (this.moving) {
        this._playClip('Running_A', { loop: true, rate: 1, fade: 0.15 });
      } else {
        this._playClip('Idle_A', { loop: true, rate: 1, fade: 0.15 });
      }
      // Standing around again: the swing lean is over, stand straight.
      if (this.model) {
        this.model.rotation.x = 0;
        this.model.rotation.z = 0;
      }
    } else if (this.state === 'attack') {
      // Self-healing guard: if the model finished loading mid-swing
      // (or a debug hook started the swing before load), make sure the
      // right swing clip is playing. _playClip no-ops when it already is.
      const { name, rate } = this._attackClip();
      this._playClip(name, { loop: false, clamp: true, fade: 0.05, rate });
    } else if (this.state !== 'dodge' && this.model) {
      // No swing and no dodge (heal, flinch): stand straight again.
      // Dodge is excluded on purpose — its lean is set in the state
      // machine above and must survive this section.
      this.model.rotation.x = 0;
      this.model.rotation.z = 0;
    }

    // Sword trail, sampled from the blade markers while swinging.
    if (this.state === 'attack') this._sampleTrail(dt);
    this._rebuildTrail(dt);

    // Flash the hunter red briefly after taking a hit (readability).
    const flash = this.hurtInvuln > 0.55;
    this._setFlash(flash);
  }

  // -- Sword trail ----------------------------------------------------------
  // Record one blade-tip / blade-base pair per frame while swinging.
  _sampleTrail(dt) {
    if (!this._swordTip || !this._swordBase) return;
    this.group.updateMatrixWorld(true);
    const tip = new THREE.Vector3();
    const base = new THREE.Vector3();
    this._swordTip.getWorldPosition(tip);
    this._swordBase.getWorldPosition(base);
    this.trailSamples.push({ tip, base, age: 0 });
    if (this.trailSamples.length > this._trailMax) this.trailSamples.shift();
    for (const s of this.trailSamples) s.age += dt;
    while (this.trailSamples.length && this.trailSamples[0].age > CONFIG.trailMaxAge) {
      this.trailSamples.shift();
    }
  }

  // Rebuild the ribbon from the live samples; hide it when empty.
  _rebuildTrail(dt) {
    if (this.state !== 'attack') {
      // After a swing the ribbon fades with its samples instead of
      // vanishing on the frame the swing ends.
      for (const s of this.trailSamples) s.age += dt;
      while (this.trailSamples.length && this.trailSamples[0].age > CONFIG.trailMaxAge) {
        this.trailSamples.shift();
      }
    }
    const n = this.trailSamples.length;
    if (n < 2) { this.trailMesh.visible = false; return; }
    for (let i = 0; i < n; i++) {
      const s = this.trailSamples[i];
      const f = Math.max(0, 1 - s.age / CONFIG.trailMaxAge);
      this._trailPos[i * 6] = s.tip.x; this._trailPos[i * 6 + 1] = s.tip.y; this._trailPos[i * 6 + 2] = s.tip.z;
      this._trailPos[i * 6 + 3] = s.base.x; this._trailPos[i * 6 + 4] = s.base.y; this._trailPos[i * 6 + 5] = s.base.z;
      this._trailCol[i * 6] = 0.75 * f; this._trailCol[i * 6 + 1] = 0.85 * f; this._trailCol[i * 6 + 2] = 1.0 * f;
      this._trailCol[i * 6 + 3] = 0.4 * f; this._trailCol[i * 6 + 4] = 0.5 * f; this._trailCol[i * 6 + 5] = 0.7 * f;
    }
    // Pad the unused tail of the buffer with the last sample so the
    // index (built for the full buffer) never reads stale vertices.
    for (let i = n; i < this._trailMax; i++) {
      for (let c = 0; c < 6; c++) {
        this._trailPos[i * 6 + c] = this._trailPos[(n - 1) * 6 + c];
        this._trailCol[i * 6 + c] = 0;
      }
    }
    this.trailMesh.geometry.setDrawRange(0, (n - 1) * 6);
    this.trailMesh.geometry.attributes.position.needsUpdate = true;
    this.trailMesh.geometry.attributes.color.needsUpdate = true;
    this.trailMesh.visible = true;
  }
}

// Turn `current` towards `target` by at most `maxStep` radians, taking the
// short way around the circle. Angles wrap, so plain subtraction misfires.
export function turnTowards(current, target, maxStep) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
