// hunter.js — the player character: a low-poly humanoid with a longsword,
// plus all of the hunter's own rules (movement, dodge roll, the 3-hit
// light combo, the heavy swing, healing). The hunter does NOT know about
// the boss's internals — it calls back into main.js through `ctx` when a
// swing connects, and main.js decides what the swing hit.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { collide } from './arena.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Hunter {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.group = new THREE.Group(); // the whole hunter; position = feet
    this.group.position.set(0, 0, 12); // start at the south edge, facing in

    // -- Body, built from boxes. Blue tunic so the hunter reads as
    //    different from the red-brown boss at a glance. -------------------
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3a6fd8, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.35, metalness: 0.7 });

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.36), cloth);
    this.torso.position.y = 1.15;
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
    this.head.position.y = 1.72;
    // A headband so the head reads from behind, where the camera sits.
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.36),
      new THREE.MeshStandardMaterial({ color: 0xd8b13a }));
    band.position.y = 1.82;
    // Forward markers, on the hunter's front (+Z is forward): eyes and a
    // nose on the face, and a gold buckle on the chest. The model used to
    // be near-symmetric front-to-back, so from the camera you could not
    // tell which way the hunter faced — these make forward obvious.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02), eyeMat);
    eyeL.position.set(-0.08, 1.75, 0.18);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.08;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), skin);
    nose.position.set(0, 1.68, 0.18);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.6, roughness: 0.4 }));
    buckle.position.set(0, 0.95, 0.19);
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.24), dark);
    this.legL.position.set(-0.16, 0.38, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.16;
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), cloth);
    this.armL.position.set(-0.42, 1.2, 0);

    // -- Right arm + longsword. The sword hangs from a pivot at the hand
    //    so a swing is just rotating the pivot. ---------------------------
    this.armR = new THREE.Group();
    this.armR.position.set(0.42, 1.45, 0);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), cloth);
    armMesh.position.y = -0.25;
    this.armR.add(armMesh);
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.set(0, -0.55, 0.1);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 0.015), steel);
    blade.position.y = -0.75;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.6, roughness: 0.4 }));
    guard.position.y = -0.18;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), dark);
    grip.position.y = -0.05;
    this.swordPivot.add(blade, guard, grip);
    this.armR.add(this.swordPivot);

    // -- Sword trail: a ribbon swept by the blade through a swing. The
    //    old flat arc plane is gone — the trail follows the blade's real
    //    path, so it reads as a cut instead of a pasted-on shape. It is
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

    for (const m of [this.torso, this.head, band, this.legL, this.legR, this.armL, armMesh, blade]) {
      m.castShadow = true;
    }
    this.group.add(this.torso, this.head, band, eyeL, eyeR, nose, buckle, this.legL, this.legR, this.armL, this.armR);
    scene.add(this.group);

    this.reset();
  }

  reset() {
    this.group.position.set(0, 0, 12);
    this.group.rotation.set(0, Math.PI, 0); // facing the arena centre
    this.hp = CONFIG.hunterMaxHp;
    this.stamina = CONFIG.staminaMax;
    this.heals = CONFIG.healCount;
    this.state = 'idle'; // idle | attack | dodge | heal | dead
    this.stateT = 0;     // time spent in the current state
    this.attackKind = null; // 'light' | 'heavy'
    this.attackIndex = 0;   // which hit of the light combo (0, 1, 2)
    this.hitDone = false;   // the swing has already applied its damage
    this.comboQueued = false;
    this.iframes = 0;       // > 0 while a dodge roll is protecting us
    this.hurtInvuln = 0;    // brief protection right after taking a hit
    this.staminaDelay = 0;  // time since stamina was last spent
    this.walkPhase = 0;     // drives the leg-swing walk animation
    this.facing = Math.PI;  // yaw the hunter is turning towards
    this.rollDir = new THREE.Vector3(0, 0, -1);
    this.moving = false;
    this.attackFacingSnapped = false; // facing locked in at swing start
    this.trailSamples = [];
    this.trailMesh.visible = false;
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }
  // Trail state, for headless checks.
  get trailAlive() { return this.trailSamples.length; }
  get trailVisible() { return this.trailMesh.visible; }

  _spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0;
  }

  // Start a light swing. Called on a click; if we are mid-swing it queues
  // the next combo hit instead, which is how the 3-hit combo chains.
  // The buffer opens early (attackBufferStart into the swing), so a
  // press slightly before the current swing ends still chains — presses
  // before that are dropped, not held forever.
  tryLight() {
    if (!this.alive || this.state === 'dodge' || this.state === 'heal') return;
    if (this.state === 'attack') {
      if (this.attackKind === 'light' && this.stateT > CONFIG.attackBufferStart) this.comboQueued = true;
      return;
    }
    if (this.stamina < CONFIG.lightCost) return;
    this._spendStamina(CONFIG.lightCost);
    this.attackKind = 'light';
    this.attackIndex = 0;
    this._beginAttack();
  }

  tryHeavy() {
    if (!this.alive || this.state !== 'idle') return;
    if (this.stamina < CONFIG.heavyCost) return;
    this._spendStamina(CONFIG.heavyCost);
    this.attackKind = 'heavy';
    this._beginAttack();
  }

  _beginAttack() {
    this.state = 'attack';
    this.stateT = 0;
    this.hitDone = false;
    this.attackFacingSnapped = false;
    this._swingSound();
  }

  // One whoosh per swing, pitched by which swing it is: the light combo
  // rises 1.0 / 1.15 / 1.3, the heavy is low and deep at 0.7.
  _swingSound() {
    const pitch = this.attackKind === 'heavy' ? 0.7 : [1.0, 1.15, 1.3][this.attackIndex];
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
    this.sfx.dodge();
  }

  tryHeal() {
    if (!this.alive || this.state !== 'idle' || this.heals <= 0) return;
    if (this.hp >= CONFIG.hunterMaxHp) return;
    this.state = 'heal';
    this.stateT = 0;
  }

  // The boss (via main.js) calls this when a boss move connects.
  // Returns true if the hit actually landed.
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
    if (this.hp <= 0) {
      this.state = 'dead';
      this.stateT = 0;
      this.group.rotation.x = -Math.PI / 2; // fall flat on our back
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
      // (The old code had the signs flipped — a rotation by +yaw instead
      // of -yaw — so at yaw 0 it was correct, but as soon as the camera
      // orbited, W drifted sideways, up to 90 degrees off at yaw 45 deg
      // and fully backwards at yaw 90 deg.)
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
      // Tuck into a roll: the whole body spins once around its local X.
      const p = this.stateT / CONFIG.dodgeTime;
      this.group.rotation.x = p * Math.PI * 2;
      if (this.stateT >= CONFIG.dodgeTime) {
        this.state = 'idle';
        this.stateT = 0;
        this.group.rotation.x = 0;
      }
    } else if (this.state === 'attack') {
      const dur = this.attackKind === 'light' ? CONFIG.lightComboTime : CONFIG.heavyTime;
      const hitAt = dur * 0.5; // the hit lands halfway through the swing
      if (!this.hitDone && this.stateT >= hitAt) {
        this.hitDone = true;
        const dmg = this.attackKind === 'light'
          ? CONFIG.lightComboDmg[this.attackIndex]
          : CONFIG.heavyDmg;
        const range = this.attackKind === 'light' ? CONFIG.lightRange : CONFIG.heavyRange;
        ctx.onAttackHit(dmg, range, this.attackKind);
      }
      // Lunge: a short step forward during the strike part of the swing,
      // so the attack closes the last step of distance. It stops short
      // of the boss's body — no lunging through it — and the arena
      // bounds (collide, below) stop it leaving the ring.
      const p = this.stateT / dur;
      if (p >= CONFIG.lungeStart && p <= CONFIG.lungeEnd) {
        const speed = this.attackKind === 'heavy' ? CONFIG.lungeHeavySpeed : CONFIG.lungeLightSpeed;
        const dir = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
        const next = this.position.clone().addScaledVector(dir, speed * dt);
        const bossXZ = ctx.bossPos ? new THREE.Vector3(ctx.bossPos.x, 0, ctx.bossPos.z) : null;
        if (!bossXZ || next.distanceTo(bossXZ) >= 2.0) this.position.copy(next);
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
          this._swingSound();
        } else {
          this.comboQueued = false;
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

    // -- Animation: walk cycle, sword pose, sword trail. --------------------
    if (this.moving && this.state === 'idle') {
      this.walkPhase += dt * 11;
      const s = Math.sin(this.walkPhase);
      this.legL.rotation.x = s * 0.6;
      this.legR.rotation.x = -s * 0.6;
      this.armL.rotation.x = -s * 0.4;
    } else if (this.state !== 'attack') {
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
      this.armL.rotation.x *= 0.8;
    }

    if (this.state === 'attack') {
      // Each swing has its own pose, driven by keyframes: a wind-up
      // (torso twisted away, sword cocked back), the strike (torso
      // driving through, sword across/down), and a follow-through.
      // Light 1 forehand, light 2 backhand, light 3 + heavy overhead.
      const dur = this.attackKind === 'light' ? CONFIG.lightComboTime : CONFIG.heavyTime;
      const p = Math.min(1, this.stateT / dur);
      const pose = this._attackPose(p);
      this.armR.rotation.x = pose.armX;
      this.armR.rotation.z = pose.armZ;
      this.swordPivot.rotation.x = pose.swordX;
      this.torso.rotation.y = pose.torsoY;
      this.torso.rotation.x = pose.torsoX;
      this.legL.rotation.x = pose.legL;
      this.legR.rotation.x = pose.legR;
      this.armL.rotation.x = pose.armLX;
      this._sampleTrail(dt);
    } else if (this.state === 'heal') {
      this.armR.rotation.x = -2.2; // raise the sword hand while drinking
      this.armR.rotation.z = 0;
      this._decayPose();
    } else {
      this._decayPose();
    }
    this._rebuildTrail(dt);

    // Flash the hunter white briefly after taking a hit (readability).
    const flash = this.hurtInvuln > 0.55;
    this.torso.material.emissive.setHex(flash ? 0x882222 : 0x000000);
  }

  // -- Attack poses ---------------------------------------------------------
  // Keyframes per swing: [time, pose]. armX/armZ = sword arm, swordX =
  // blade pivot, torsoY/X = torso twist/lean, legL/R = stance, armLX =
  // left arm (reaches up to the grip on overhead swings).
  _attackPose(p) {
    const keys = this.attackKind === 'heavy' ? [
      [0.00, { armX: -0.2, armZ: 0.2, swordX: 0.0, torsoY: 0.00, torsoX: 0.00, legL: 0.00, legR: 0.00, armLX: 0.0 }],
      [0.30, { armX: -2.7, armZ: 0.2, swordX: -1.5, torsoY: -0.30, torsoX: -0.35, legL: -0.50, legR: 0.55, armLX: -1.8 }],
      [0.55, { armX: 0.9, armZ: 0.0, swordX: 0.6, torsoY: 0.15, torsoX: 0.55, legL: 0.55, legR: -0.45, armLX: 0.6 }],
      [1.00, { armX: 0.5, armZ: 0.0, swordX: 0.3, torsoY: 0.00, torsoX: 0.30, legL: 0.30, legR: -0.25, armLX: 0.3 }],
    ] : this.attackIndex === 2 ? [
      [0.00, { armX: -0.2, armZ: 0.2, swordX: 0.0, torsoY: 0.00, torsoX: 0.00, legL: 0.00, legR: 0.00, armLX: 0.0 }],
      [0.30, { armX: -2.4, armZ: 0.3, swordX: -1.2, torsoY: -0.15, torsoX: -0.25, legL: -0.40, legR: 0.40, armLX: -1.2 }],
      [0.55, { armX: 0.7, armZ: 0.0, swordX: 0.5, torsoY: 0.10, torsoX: 0.40, legL: 0.45, legR: -0.35, armLX: 0.4 }],
      [1.00, { armX: 0.3, armZ: 0.1, swordX: 0.2, torsoY: 0.00, torsoX: 0.20, legL: 0.20, legR: -0.20, armLX: 0.2 }],
    ] : this.attackIndex === 1 ? [
      // Backhand: mirror of the forehand, across the other way.
      [0.00, { armX: -0.2, armZ: -0.2, swordX: 0.0, torsoY: 0.00, torsoX: 0.00, legL: 0.00, legR: 0.00, armLX: 0.0 }],
      [0.30, { armX: -0.5, armZ: -1.5, swordX: -0.6, torsoY: 0.55, torsoX: -0.08, legL: 0.35, legR: -0.30, armLX: -0.3 }],
      [0.55, { armX: -0.4, armZ: 1.5, swordX: 0.4, torsoY: -0.55, torsoX: 0.12, legL: -0.30, legR: 0.35, armLX: 0.3 }],
      [1.00, { armX: -0.3, armZ: 0.7, swordX: 0.2, torsoY: -0.25, torsoX: 0.05, legL: -0.15, legR: 0.15, armLX: 0.1 }],
    ] : [
      // Forehand: cocked up-right, driven across to the left.
      [0.00, { armX: -0.2, armZ: 0.2, swordX: 0.0, torsoY: 0.00, torsoX: 0.00, legL: 0.00, legR: 0.00, armLX: 0.0 }],
      [0.30, { armX: -0.5, armZ: 1.5, swordX: -0.6, torsoY: -0.55, torsoX: -0.08, legL: -0.30, legR: 0.35, armLX: 0.3 }],
      [0.55, { armX: -0.4, armZ: -1.5, swordX: 0.4, torsoY: 0.55, torsoX: 0.12, legL: 0.35, legR: -0.30, armLX: -0.3 }],
      [1.00, { armX: -0.3, armZ: -0.7, swordX: 0.2, torsoY: 0.25, torsoX: 0.05, legL: 0.15, legR: -0.15, armLX: -0.1 }],
    ];
    // Find the surrounding keyframes and lerp between them.
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    const f = t1 > t0 ? Math.max(0, Math.min(1, (p - t0) / (t1 - t0))) : 1;
    const out = {};
    for (const k of Object.keys(a)) out[k] = a[k] + (b[k] - a[k]) * f;
    return out;
  }

  // Ease the attack pose back to neutral once a swing / heal ends.
  _decayPose() {
    this.armR.rotation.z *= 0.8;
    this.armR.rotation.x *= 0.8;
    this.swordPivot.rotation.x *= 0.8;
    this.torso.rotation.y *= 0.8;
    this.torso.rotation.x *= 0.8;
    this.armL.rotation.x *= 0.8;
  }

  // -- Sword trail ----------------------------------------------------------
  // Record one blade-tip / blade-base pair per frame while swinging.
  _sampleTrail(dt) {
    this.group.updateMatrixWorld(true);
    const tip = this.swordPivot.localToWorld(new THREE.Vector3(0, -1.35, 0));
    const base = this.swordPivot.localToWorld(new THREE.Vector3(0, -0.15, 0));
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
