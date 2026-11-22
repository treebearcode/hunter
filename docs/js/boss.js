// boss.js — the Skeleton, a big undead brute (Quaternius Ultimate
// Monsters, CC0). The boss is a small state machine: it idles / walks,
// picks a move based on how far away the hunter is, telegraphs the move
// (wind-up pose + sound + dust), then does it. Every big move is
// dodgeable on purpose — deaths should feel like a mistimed dodge,
// not a surprise.
//
// The skeleton is bipedal, so the moveset maps onto its clips: charge
// runs on Skeleton_Running, the sweep, the stomp slam, the leap slam
// and the spin all use Skeleton_Attack, the entrance is Skeleton_Spawn,
// death is Skeleton_Death, and idle/walk use Skeleton_Idle /
// Skeleton_Running. It has no walk clip (Running at low speed covers
// it) and no hit clip — a hit flashes the skeleton WHITE, briefly, so
// a landed hit never looks like a telegraph. Telegraphs stay body
// language, as before: the skeleton leans and twists into each move,
// kicks up dust, and plays a distinct sound cue per move — no glow,
// no floor markers, and never a red flicker: the old red telegraph
// glow is gone entirely. Enrage keeps a slow red pulse, dimmed so it
// does not flicker.
//
// The boss body is solid: it pushes the hunter out to 2.0 m, no
// damage. The only contact damage left is during a charge, where the
// body itself is the telegraphed attack.
//
// Skull crack: the old horn-break mechanic, re-skinned honestly. The
// skeleton has no horns, so head hits damage its skull; after 150 head
// damage the skull cracks — longer stagger, shorter sweep. The skeleton
// is a single mesh, so there is no horn to snap off: the break reads
// through the "SKULL CRACK!" banner, the crack sound, a burst of bone
// sparks, the stagger and the shorter sweep.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { collide } from './arena.js';
import { turnTowards } from './hunter.js';

// The converted GLB is 4.999 m tall; at this scale the skeleton stands
// 4.0 m — clearly larger than the 1.9 m hunter, in the same ballpark as
// the old boss, so arena, camera and hitbox numbers all stay as they are.
const SKELETON_SCALE = 0.8;
// The bind pose floats ~0.08 m above the floor at this scale; sink the
// model inside its group so the feet plant on the ground.
const FEET_SINK = -0.08;

export class Boss {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.group = new THREE.Group(); // position = centre of the body
    this.group.position.set(0, 0, -10); // start at the north edge

    // Stagger stars: small yellow spheres that orbit the head while the
    // boss is staggered, so the punish window is obvious. The head sits
    // ~3.05 m up on the scaled skeleton.
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffdd33 });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), starMat);
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.9, 3.1, Math.sin(a) * 0.9);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.group.add(this.stars);

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

    // -- Model loading (async): Skeleton.glb with its five clips. ----
    this.modelLoaded = false;
    this.loadError = null;
    this.mixer = null;
    this.clips = {};
    this.bodyMat = null;  // the skeleton's flat bone-tan material
    this.headBone = null; // 'Head' bone, for head hits + the stars
    this._currentClip = null;
    this._currentAction = null;
    this.ready = this._loadModel(scene);

    this._dustT = 0;          // time since the last paw dust puff
    this._chargeSnorted = false;
    this._flashT = 0;         // seconds left of the white hit flash
    this._hitFlashSeen = false; // sticky: a hit flashed white (test hook)
    this._spinHitDone = false;
    this._leapFrom = null;    // leap start / target, set at windup end
    this._leapTo = null;
    this.reset();
  }

  async _loadModel(scene) {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('assets/Skeleton.glb');
      for (const clip of gltf.animations) this.clips[clip.name] = clip;
      const model = gltf.scene;
      model.scale.setScalar(SKELETON_SCALE);
      model.position.y = FEET_SINK;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          if (!this.bodyMat && o.material) this.bodyMat = o.material;
        }
      });
      this.group.add(model);
      this.model = model;
      this.headBone = model.getObjectByName('Head');
      this.mixer = new THREE.AnimationMixer(model);
      this.modelLoaded = true;
      // reset() already ran in the constructor and put the boss in its
      // entrance state — play the Spawn clip for it, not the idle.
      if (this.state === 'intro') {
        this._replayClip('Skeleton_Spawn', { loop: false, clamp: true, fade: 0.1, rate: 1.5 });
      } else {
        this._playClip('Skeleton_Idle', { loop: true, rate: 1 });
      }
    } catch (e) {
      this.loadError = e;
      console.error('Boss model failed to load:', e);
    }
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
    this.skullHp = CONFIG.skullBreakDmg;
    this.skullBroken = false;
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
    if (this.bodyMat) this.bodyMat.emissive.setHex(0x000000);
    // The entrance: the skeleton rises (Spawn clip), then the fight starts.
    if (this.mixer) {
      this._replayClip('Skeleton_Spawn', { loop: false, clamp: true, fade: 0.1, rate: 1.5 });
    }
  }

  // Wind-up poses bend the whole group out of its neutral shape; this
  // puts everything back so the next move starts clean.
  _resetPose() {
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }
  // World position of the head — hits landing here damage the skull.
  get headPos() {
    if (this.headBone) {
      this.group.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(this.headBone.matrixWorld);
    }
    return this.position.clone().setY(3.0);
  }
  get sweepRange() {
    return this.skullBroken ? CONFIG.sweepRangeBroken : CONFIG.sweepRange;
  }
  // Sticky, for headless checks: true once a hit has flashed white.
  get hitFlashSeen() { return this._hitFlashSeen; }
  // Enrage makes every windup ~25% shorter.
  get speedMult() { return this.enraged ? CONFIG.enrageSpeedMult : 1; }
  // Which clip is playing, for headless checks.
  get currentClip() { return this._currentClip; }

  // Play a clip, fading out whatever was playing. A no-op if the clip
  // is already the one running, so per-frame selection never restarts
  // a loop.
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
    // A hit flashes the skeleton WHITE, briefly — the only flash in
    // the game. Tells are body language, never a glow, so a white
    // flash can only ever mean "your sword connected".
    this._flashT = 0.12;
    this._hitFlashSeen = true;
    let skullBroke = false;
    if (isHead && !this.skullBroken) {
      this.skullHp -= dmg;
      if (this.skullHp <= 0) {
        this.skullBroken = true;
        skullBroke = true;
        this.sfx.skullCrack();
      }
    }
    if (!this.enraged && this.hp <= CONFIG.bossEnrageHp && this.hp > 0) {
      this.enraged = true;
      this.sfx.roar();
    }
    let staggered = false;
    if (skullBroke) {
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
      this._replayClip('Skeleton_Death', { loop: false, clamp: true, fade: 0.1, rate: 1 });
      this.sfx.defeat();
    }
    return { dmg, isHead, skullBroke, staggered, killed: this.hp <= 0 };
  }

  _startStagger(dur) {
    if (this.state === 'dead') return;
    this.state = 'staggered';
    this.stateT = 0;
    this.staggerDur = dur;
    this.stars.visible = true;
    if (this.bodyMat) this.bodyMat.emissive.setHex(0x000000);
    this._resetPose();
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

  // Dust at the skeleton's feet: `fwd` metres in front of the body,
  // `side` metres to the side. The old boss kicked dust from its paws;
  // the skeleton kicks it from its feet.
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
    // skeleton would sit white for a whole extra frame.
    if (this._flashT > 0) this._flashT -= dt;
    if (this.bodyMat) {
      if (this._flashT > 0) {
        this.bodyMat.emissive.setHex(0xffffff);
      } else if (this.enraged && this.state !== 'staggered' && this.state !== 'dead') {
        const pulse = 0.10 + 0.06 * Math.sin(this.stateT * 6);
        this.bodyMat.emissive.setRGB(pulse, pulse * 0.15, 0);
      } else {
        this.bodyMat.emissive.setHex(0x000000);
      }
    }
    if (this.state === 'dead') {
      // The Death clip plays the collapse; the body lies still after.
      return;
    }

    const toHunter = new THREE.Vector3().subVectors(hunter.position, this.position);
    toHunter.y = 0;
    const dist = toHunter.length();
    // The skeleton faces +Z, same as the hunter: no extra rotation.
    const faceHunter = Math.atan2(toHunter.x, toHunter.z);

    switch (this.state) {
      case 'intro': {
        // Rising from the ground; the fight starts when it is done.
        if (this.stateT >= 2.9 / 1.5) this._toIdle(1.0);
        break;
      }

      case 'idle': {
        // Turn to face the hunter, close in slowly, then pick a move.
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 2.5);
        this.decideT -= dt;
        if (dist > 3.5) {
          const dir = toHunter.clone().normalize();
          this.position.addScaledVector(dir, CONFIG.bossSpeed * dt);
          this._playClip('Skeleton_Running', { loop: true, rate: 0.7, fade: 0.2 });
        } else {
          this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.2 });
        }
        if (this.decideT <= 0) this._pickMove(dist);
        break;
      }

      case 'windup-charge': {
        // The charge telegraph is the body itself: the skeleton crouches
        // low and leans forward, feet stamping the ground and kicking up
        // dust. The snort sounded once when the move was picked (_cue).
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
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
          this._replayClip('Skeleton_Running', { loop: true, rate: 1.8, fade: 0.1 });
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
        // Sweep = LOW twist: the skeleton twists away to one side, bone
        // club dragging low behind it, then a fast horizontal swing.
        // The twist is roughly double the old one, so it reads.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
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
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 2.6 });
          // The hit is checked once, at the moment the club sweeps through.
          const inFront = Math.abs(angleDiff(this.group.rotation.y, faceHunter)) < 1.9;
          if (dist < this.sweepRange && inFront) {
            ctx.damageHunter(CONFIG.sweepDmg, this.position);
          }
          this.sfx.swing();
        }
        break;
      }

      case 'sweep': {
        // The Attack clip plays the swing through; recover shortly after.
        if (this.stateT >= 0.45) {
          this._toIdle(1.2);
        }
        break;
      }

      case 'windup-stomp': {
        // Stomp = HIGH rear-up: the skeleton rears back, arms rising,
        // before slamming down. Roughly double the old rear-up, so the
        // stomp never looks like the sweep's low twist.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
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
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 1.6 });
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
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
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
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 1.5 });
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
        // Spin sweep: the skeleton twists hard away, club out wide,
        // winding up for a full 360-degree turn.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
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
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 1.4 });
          this.sfx.swing();
        }
        break;
      }

      case 'spin': {
        // One full turn with the club out, hits all around. The hit is
        // checked once, halfway through the turn, when the club comes
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
        this.group.position.y = -0.35;
        this.stars.rotation.y += dt * 4;
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
    // skeleton is never a damage-over-time trap. No push-out while the
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
    this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
