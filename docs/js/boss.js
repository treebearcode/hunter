// boss.js — the Skeleton, a big undead brute (Quaternius Ultimate
// Monsters, CC0). The boss is a small state machine: it idles / walks,
// picks a move based on how far away the hunter is, telegraphs the move
// (wind-up pose + glow + sound), then does it. Every big move is
// dodgeable on purpose — deaths should feel like a mistimed dodge,
// not a surprise.
//
// The skeleton is bipedal, so the moveset maps onto its clips: charge
// runs on Skeleton_Running, the sweep and the stomp slam both use
// Skeleton_Attack, the entrance is Skeleton_Spawn, death is
// Skeleton_Death, and idle/walk use Skeleton_Idle / Skeleton_Running.
// It has no walk clip (Running at low speed covers it) and no hit
// clip — a hit just flashes the material, the skeleton does not flinch.
// Telegraphs stay body language, as before: the skeleton leans and
// twists into each move, kicks up dust, and glows — no floor markers.
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
                          // staggered | dead
    this.stateT = 0;
    this.decideT = 1.0;  // idle time before the first move is picked
    this.poise = 0;
    this.skullHp = CONFIG.skullBreakDmg;
    this.skullBroken = false;
    this.enraged = false;
    this.chargeDir = new THREE.Vector3(0, 0, 1);
    this.contactT = 0;
    this.shock = null; // { radius, hitDone } while a shockwave is expanding
    this.facing = 0;
    this.stars.visible = false;
    this.ring.material.opacity = 0;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this._chargeSnorted = false;
    this._dustT = 0;
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

  // Telegraph: glow the body + play the cue so the player knows a big
  // move is coming and can get ready to dodge. Kept dimmer than the old
  // boss's glow — the pale bone-tan material picks up emissive much
  // harder than Gorehorn's dark hide did, and a full-strength glow
  // turned the whole skeleton bright red.
  _telegraph() {
    if (this.bodyMat) this.bodyMat.emissive.setHex(0x771500);
    this.sfx.telegraph();
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
    if (this.state === 'dead') {
      // The Death clip plays the collapse; the body lies still after.
      return;
    }

    const toHunter = new THREE.Vector3().subVectors(hunter.position, this.position);
    toHunter.y = 0;
    const dist = toHunter.length();
    // The skeleton faces +Z, same as the hunter: no extra rotation.
    const faceHunter = Math.atan2(toHunter.x, toHunter.z);

    // Enraged bosses pulse red — readable at a glance, even mid-fight.
    // Same note as the telegraph: kept dim, the bone picks it up hard.
    if (this.bodyMat && this.enraged && this.state !== 'staggered') {
      const pulse = 0.18 + 0.12 * Math.sin(this.stateT * 6);
      this.bodyMat.emissive.setHex(0x000000);
      this.bodyMat.emissive.setRGB(pulse, pulse * 0.15, 0);
    }

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
        // dust. A snort sounds once at the start of the wind-up.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
        if (!this._chargeSnorted) { this._chargeSnorted = true; this.sfx.snort(); }
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
          if (this.bodyMat) this.bodyMat.emissive.setHex(0x000000);
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
        // The skeleton twists away to one side, bone club winding up
        // behind it — the twist is the warning.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.sweepWindup / this.speedMult));
        this.group.rotation.z = 0.12 * p;
        this.group.rotation.x = -0.06 * p;
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter - 0.9 * p, dt * 1.5);
        if (this.stateT >= CONFIG.sweepWindup / this.speedMult) {
          this.group.rotation.y = faceHunter;
          this.state = 'sweep';
          this.stateT = 0;
          if (this.bodyMat) this.bodyMat.emissive.setHex(0x000000);
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 2.0 });
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
        // Rears back, arms rising, before slamming down.
        this._playClip('Skeleton_Idle', { loop: true, rate: 1, fade: 0.15 });
        const p = Math.min(1, this.stateT / (CONFIG.stompWindup / this.speedMult));
        this.group.rotation.x = -0.38 * p;
        if (this.stateT >= CONFIG.stompWindup / this.speedMult) {
          this.group.rotation.x = 0;
          this.state = 'stomp';
          this.stateT = 0;
          if (this.bodyMat) this.bodyMat.emissive.setHex(0x000000);
          this._replayClip('Skeleton_Attack', { loop: false, clamp: true, fade: 0.05, rate: 2.0 });
          this.shock = { radius: 0, hitDone: false };
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
        if (this.shock) {
          this.shock.radius += CONFIG.shockwaveSpeed * dt;
          const r = this.shock.radius;
          this.ring.scale.set(r, r, 1);
          this.ring.material.opacity = Math.max(0, 0.55 * (1 - r / CONFIG.shockwaveMaxRadius));
          if (!this.shock.hitDone && dist > r - 1.2 && dist < r + 1.2) {
            this.shock.hitDone = true;
            ctx.damageHunter(CONFIG.stompDmg, this.position);
          }
          if (r >= CONFIG.shockwaveMaxRadius) {
            this.shock = null;
            this.ring.material.opacity = 0;
            this._toIdle(1.4);
          }
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

    // Contact damage: brushing the body hurts a little, so standing
    // inside the boss is never free. Cooldown keeps it from melting HP.
    if (this.alive && this.state !== 'staggered' && dist < 2.2 && this.contactT <= 0) {
      this.contactT = CONFIG.bossContactCooldown;
      ctx.damageHunter(CONFIG.bossContactDmg, this.position);
    }

    collide(this.position, 1.8);
  }

  _pickMove(dist) {
    // Far away: charge in. Close: sweep or stomp. Never attack twice in
    // a row without a breather — the cooldown is the player's opening.
    const roll = Math.random();
    if (dist > 9) {
      this.state = 'windup-charge';
      this._telegraph();
    } else if (dist < 4.5 && roll < 0.55) {
      this.state = 'windup-sweep';
      this._telegraph();
    } else if (roll < 0.75) {
      this.state = 'windup-stomp';
      this._telegraph();
    } else {
      this.state = 'windup-charge';
      this._telegraph();
    }
    this.stateT = 0;
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
