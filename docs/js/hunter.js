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

    // -- Swing arc: a translucent arc that flashes visible during a
    //    swing so the attack reads even before the damage number pops. ---
    this.arc = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.4),
      new THREE.MeshBasicMaterial({
        color: 0xbfd8ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.arc.position.set(0, 1.1, 0.9); // in front of the hunter (+Z is forward)
    this.arc.rotation.x = -0.4;

    for (const m of [this.torso, this.head, band, this.legL, this.legR, this.armL, armMesh, blade]) {
      m.castShadow = true;
    }
    this.group.add(this.torso, this.head, band, this.legL, this.legR, this.armL, this.armR, this.arc);
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
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }

  _spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0;
  }

  // Start a light swing. Called on a click; if we are mid-swing it queues
  // the next combo hit instead, which is how the 3-hit combo chains.
  tryLight() {
    if (!this.alive || this.state === 'dodge' || this.state === 'heal') return;
    if (this.state === 'attack') {
      if (this.attackKind === 'light' && this.stateT > 0.18) this.comboQueued = true;
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
    this.sfx.swing();
  }

  tryDodge(dir) {
    if (!this.alive || this.state === 'dodge') return;
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
      const sin = Math.sin(input.camYaw), cos = Math.cos(input.camYaw);
      const wx = move.x * cos - move.z * sin;
      const wz = move.x * sin + move.z * cos;
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
        ctx.onAttackHit(dmg, range);
      }
      if (this.stateT >= dur) {
        if (this.attackKind === 'light' && this.comboQueued && this.attackIndex < 2) {
          // Chain into the next combo hit.
          this.comboQueued = false;
          this.attackIndex++;
          this._spendStamina(CONFIG.lightCost);
          this.stateT = 0;
          this.hitDone = false;
          this.sfx.swing();
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

    // -- Animation: walk cycle, sword pose, swing arc. ----------------------
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
      // The sword arm sweeps from raised-right across to the left.
      const dur = this.attackKind === 'light' ? CONFIG.lightComboTime : CONFIG.heavyTime;
      const p = Math.min(1, this.stateT / dur);
      const sweep = this.attackIndex % 2 === 0 ? 1 : -1;
      this.armR.rotation.z = sweep * (1.2 - p * 2.4);
      this.armR.rotation.x = -0.6 + p * 0.5;
      this.arc.material.opacity = 0.45 * (1 - p);
      this.arc.rotation.z = sweep * (p * 2 - 1) * 1.2;
    } else if (this.state === 'heal') {
      this.armR.rotation.x = -2.2; // raise the sword hand while drinking
      this.armR.rotation.z = 0;
      this.arc.material.opacity = 0;
    } else {
      this.armR.rotation.z *= 0.8;
      this.armR.rotation.x *= 0.8;
      this.arc.material.opacity = 0;
    }

    // Flash the hunter white briefly after taking a hit (readability).
    const flash = this.hurtInvuln > 0.55;
    this.torso.material.emissive.setHex(flash ? 0x882222 : 0x000000);
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
