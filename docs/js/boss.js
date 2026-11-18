// boss.js — Gorehorn, a big horned quadruped brute. Original design, not
// a copy of any Monster Hunter monster. The boss is a small state machine:
// it idles / wanders, picks a move based on how far away the hunter is,
// telegraphs the move (wind-up pose + glow + sound), then does it.
// Every big move is dodgeable on purpose — deaths should feel like a
// mistimed dodge, not a surprise.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { collide } from './arena.js';
import { turnTowards } from './hunter.js';

export class Boss {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.group = new THREE.Group(); // position = centre of the body
    this.group.position.set(0, 0, -10); // start at the north edge

    // -- Body: dark red-brown, big and unmistakable next to the hunter. ---
    const hide = new THREE.MeshStandardMaterial({ color: 0x6e2f24, roughness: 0.9 });
    const darkHide = new THREE.MeshStandardMaterial({ color: 0x4a2018, roughness: 0.9 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 });
    this.bodyMat = hide;

    this.body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), hide);
    this.body.scale.set(1.5, 1.0, 1.1);
    this.body.position.y = 1.6;
    this.head = new THREE.Group();
    this.head.position.set(0, 1.9, -1.9); // head at the front (-Z is forward)
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.0), darkHide);
    skull.position.z = -0.2;
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.7), darkHide);
    snout.position.set(0, -0.15, -0.8);
    // Eyes glow faintly so the head reads in the dusk light.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
    eyeL.position.set(-0.3, 0.15, -0.65);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.3;
    this.head.add(skull, snout, eyeL, eyeR);

    // Horns: long cones swept up and back, so their pale tips break the
    // body silhouette from behind as well as from the front. The left
    // one is the breakable one.
    this.hornL = new THREE.Group();
    this.hornL.position.set(-0.55, 0.35, -0.2);
    const hornGeo = new THREE.ConeGeometry(0.17, 1.8, 8);
    const hornLMesh = new THREE.Mesh(hornGeo, bone);
    hornLMesh.rotation.set(0.55, 0, 0.85);
    hornLMesh.position.set(-0.45, 0.5, 0.1);
    this.hornL.add(hornLMesh);
    this.hornR = new THREE.Group();
    this.hornR.position.set(0.55, 0.35, -0.2);
    const hornRMesh = new THREE.Mesh(hornGeo, bone);
    hornRMesh.rotation.set(0.55, 0, -0.85);
    hornRMesh.position.set(0.45, 0.5, 0.1);
    this.hornR.add(hornRMesh);
    // Broken-horn stub, hidden until the horn snaps off.
    this.hornStub = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), bone);
    this.hornStub.rotation.z = 0.7;
    this.hornStub.position.set(-0.85, 0.25, -0.2);
    this.hornStub.visible = false;
    this.head.add(this.hornL, this.hornR, this.hornStub);

    // Four legs, set wide so they stand clear of the body from behind,
    // with dark hooves so each leg reads as its own limb.
    this.legs = [];
    for (const [x, z] of [[-1.15, -1.3], [1.15, -1.3], [-1.15, 1.3], [1.15, 1.3]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.4, 8), darkHide);
      leg.position.set(x, 0.7, z);
      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.25, 0.48), bone);
      hoof.position.set(0, -0.72, 0);
      leg.add(hoof);
      this.legs.push(leg);
      this.group.add(leg);
    }
    // Tail raised and tipped up, so it reads from behind instead of
    // disappearing under the body.
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 8), darkHide);
    tail.rotation.x = Math.PI / 2 - 0.5;
    tail.position.set(0, 1.9, 2.2);
    // A tall back ridge with bone spikes along the spine — the topmost
    // part of the silhouette from every angle.
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 2.2), darkHide);
    ridge.position.set(0, 2.75, 0.3);
    this.group.add(this.body, this.head, tail, ridge);
    this.spikes = [];
    for (const z of [-0.6, 0.3, 1.2]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 6), bone);
      spike.position.set(0, 3.35, z);
      spike.rotation.x = 0.35; // lean back, following the spine
      this.spikes.push(spike);
      this.group.add(spike);
    }
    // Shoulder humps at the front, so the body is not one smooth ball
    // from the side.
    this.shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), darkHide);
    this.shoulderL.position.set(-1.0, 2.2, -1.2);
    this.shoulderR = this.shoulderL.clone();
    this.shoulderR.position.x = 1.0;
    this.group.add(this.shoulderL, this.shoulderR);

    // Stagger stars: small yellow spheres that orbit the head while the
    // boss is staggered, so the punish window is obvious.
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffdd33 });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), starMat);
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.9, 2.9, Math.sin(a) * 0.9 - 1.9);
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

    for (const m of [this.body, skull, snout, ...this.legs, tail, ridge, this.shoulderL, this.shoulderR, ...this.spikes]) m.castShadow = true;
    scene.add(this.group);

    this._dustT = 0;          // time since the last paw dust puff
    this._chargeSnorted = false;
    this.reset();
  }

  reset() {
    this.group.position.set(0, 0, -10);
    this.group.rotation.set(0, 0, 0);
    this.hp = CONFIG.bossMaxHp;
    this.state = 'idle'; // idle | windup-charge | charge | windup-sweep |
                         // sweep | windup-stomp | stomp | staggered | dead
    this.stateT = 0;
    this.decideT = 1.0;  // idle time before the first move is picked
    this.poise = 0;
    this.hornHp = CONFIG.hornBreakDmg;
    this.hornBroken = false;
    this.enraged = false;
    this.chargeDir = new THREE.Vector3(0, 0, 1);
    this.contactT = 0;
    this.shock = null; // { radius, hitDone } while a shockwave is expanding
    this.walkPhase = 0;
    this.facing = 0;
    this.bodyMat.emissive.setHex(0x000000);
    this.hornL.visible = true;
    this.hornStub.visible = false;
    this.stars.visible = false;
    this.ring.material.opacity = 0;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this._chargeSnorted = false;
    this._dustT = 0;
    this._resetPose();
  }

  // Wind-up poses bend the head, body and legs out of their neutral
  // shape; this puts everything back so the next move starts clean.
  _resetPose() {
    this.head.position.y = 1.9;
    this.head.rotation.set(0, 0, 0);
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
  }

  get alive() { return this.state !== 'dead'; }
  get position() { return this.group.position; }
  // World position of the head — hits landing here damage the horn.
  get headPos() {
    return new THREE.Vector3().setFromMatrixPosition(this.head.matrixWorld);
  }
  get sweepRange() {
    return this.hornBroken ? CONFIG.sweepRangeBroken : CONFIG.sweepRange;
  }
  // Enrage makes every windup ~25% shorter.
  get speedMult() { return this.enraged ? CONFIG.enrageSpeedMult : 1; }

  // Called by main.js when a hunter swing connects. `isHead` is true when
  // the hunter was close to the head at the moment of the hit.
  // Returns a small report main.js uses for damage numbers and sounds.
  takeDamage(dmg, isHead) {
    if (!this.alive) return null;
    this.hp = Math.max(0, this.hp - dmg);
    this.poise += dmg;
    let hornBroke = false;
    if (isHead && !this.hornBroken) {
      this.hornHp -= dmg;
      if (this.hornHp <= 0) {
        this.hornBroken = true;
        hornBroke = true;
        this.hornL.visible = false;
        this.hornStub.visible = true;
        this.sfx.hornBreak();
      }
    }
    if (!this.enraged && this.hp <= CONFIG.bossEnrageHp && this.hp > 0) {
      this.enraged = true;
      this.sfx.roar();
    }
    let staggered = false;
    if (hornBroke) {
      this._startStagger(CONFIG.hornBreakStagger);
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
      this.sfx.defeat();
    }
    return { dmg, isHead, hornBroke, staggered, killed: this.hp <= 0 };
  }

  _startStagger(dur) {
    if (this.state === 'dead') return;
    this.state = 'staggered';
    this.stateT = 0;
    this.staggerDur = dur;
    this.stars.visible = true;
    this.bodyMat.emissive.setHex(0x000000);
    this._resetPose();
    this.sfx.stagger();
  }

  // Telegraph: glow the body + play the cue so the player knows a big
  // move is coming and can get ready to dodge.
  _telegraph() {
    this.bodyMat.emissive.setHex(0xaa2200);
    this.sfx.telegraph();
  }

  update(dt, hunter, ctx) {
    this.stateT += dt;
    this.contactT = Math.max(0, this.contactT - dt);
    if (this.state === 'dead') {
      // Topple over slowly, then lie still.
      const p = Math.min(1, this.stateT / 0.8);
      this.group.rotation.z = p * (Math.PI / 2) * 0.9;
      this.group.position.y = -p * 0.4;
      return;
    }

    const toHunter = new THREE.Vector3().subVectors(hunter.position, this.position);
    toHunter.y = 0;
    const dist = toHunter.length();
    const faceHunter = Math.atan2(toHunter.x, toHunter.z) + Math.PI; // model faces -Z

    // Enraged bosses pulse red — readable at a glance, even mid-fight.
    if (this.enraged && this.state !== 'staggered') {
      const pulse = 0.25 + 0.2 * Math.sin(this.stateT * 6);
      this.bodyMat.emissive.setHex(0x000000);
      this.bodyMat.emissive.setRGB(pulse, pulse * 0.15, 0);
    }

    switch (this.state) {
      case 'idle': {
        // Turn to face the hunter, close in slowly, then pick a move.
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 2.5);
        this.decideT -= dt;
        if (dist > 3.5) {
          const dir = toHunter.clone().normalize();
          this.position.addScaledVector(dir, CONFIG.bossSpeed * dt);
          this.walkPhase += dt * 6;
        }
        if (this.decideT <= 0) this._pickMove(dist);
        break;
      }

      case 'windup-charge': {
        // The charge telegraph is the body itself: head drops low with
        // the horns levelled at the hunter, the body leans forward, and
        // the front legs paw the ground in turn, kicking up dust. A
        // snort sounds once at the start of the wind-up.
        if (!this._chargeSnorted) { this._chargeSnorted = true; this.sfx.snort(); }
        const p = Math.min(1, this.stateT / (CONFIG.chargeWindup / this.speedMult));
        this.head.position.y = 1.9 - 0.55 * p;
        this.head.rotation.x = 0.45 * p;
        this.group.rotation.x = 0.14 * p;
        this.legs[0].rotation.x = Math.sin(this.stateT * 9) * 0.8;
        this.legs[1].rotation.x = Math.sin(this.stateT * 9 + Math.PI) * 0.8;
        this._dustT += dt;
        if (this._dustT >= 0.28) {
          this._dustT = 0;
          for (const leg of [this.legs[0], this.legs[1]]) {
            const wp = new THREE.Vector3();
            leg.getWorldPosition(wp);
            ctx.effects?.dust(new THREE.Vector3(wp.x, 0.15, wp.z), 4);
          }
        }
        this.group.rotation.y = turnTowards(this.group.rotation.y, faceHunter, dt * 1.5);
        if (this.stateT >= CONFIG.chargeWindup / this.speedMult) {
          this.chargeDir.copy(toHunter).normalize();
          this.state = 'charge';
          this.stateT = 0;
          this._dustT = 0;
          this.bodyMat.emissive.setHex(0x000000);
        }
        break;
      }

      case 'charge': {
        // Head stays low and the legs gallop; dust kicks up behind.
        this.head.position.y = 1.5;
        this.head.rotation.x = 0.35;
        this.group.rotation.x = 0.1;
        const g = Math.sin(this.stateT * 14);
        this.legs[0].rotation.x = g * 0.7;
        this.legs[3].rotation.x = g * 0.7;
        this.legs[1].rotation.x = -g * 0.7;
        this.legs[2].rotation.x = -g * 0.7;
        this._dustT += dt;
        if (this._dustT >= 0.15) {
          this._dustT = 0;
          const wp = new THREE.Vector3();
          this.legs[2].getWorldPosition(wp);
          ctx.effects?.dust(new THREE.Vector3(wp.x, 0.15, wp.z), 4);
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
        // The head rears back and the whole body twists to one side
        // before the horns come through — the twist is the warning.
        const p = Math.min(1, this.stateT / (CONFIG.sweepWindup / this.speedMult));
        this.head.position.y = 1.9 + 0.45 * p;
        this.head.rotation.y = -1.0 * p;
        this.head.rotation.x = -0.25 * p;
        this.group.rotation.z = 0.12 * p;
        this.group.rotation.x = -0.06 * p;
        if (this.stateT >= CONFIG.sweepWindup / this.speedMult) {
          this.state = 'sweep';
          this.stateT = 0;
          this.bodyMat.emissive.setHex(0x000000);
          // The hit is checked once, at the moment the horns sweep through.
          const inFront = Math.abs(angleDiff(this.group.rotation.y, faceHunter)) < 1.9;
          if (dist < this.sweepRange && inFront) {
            ctx.damageHunter(CONFIG.sweepDmg, this.position);
          }
          this.sfx.swing();
        }
        break;
      }

      case 'sweep': {
        // The sweep itself is a fast head swing; recover shortly after.
        this.head.position.y = 1.9;
        this.head.rotation.x = 0;
        this.head.rotation.y = Math.sin(Math.min(1, this.stateT / 0.3) * Math.PI) * 1.2;
        this.group.rotation.z *= 0.8;
        if (this.stateT >= 0.45) {
          this.head.rotation.y = 0;
          this._toIdle(1.2);
        }
        break;
      }

      case 'windup-stomp': {
        // Rears up on the hind legs, front legs visibly raised, before
        // slamming down.
        const p = Math.min(1, this.stateT / (CONFIG.stompWindup / this.speedMult));
        this.group.rotation.x = -0.38 * p;
        this.head.position.y = 1.9 + 0.3 * p;
        this.head.rotation.x = -0.3 * p;
        this.legs[0].rotation.x = -1.0 * p;
        this.legs[1].rotation.x = -1.0 * p;
        if (this.stateT >= CONFIG.stompWindup / this.speedMult) {
          this.group.rotation.x = 0;
          this.state = 'stomp';
          this.stateT = 0;
          this.bodyMat.emissive.setHex(0x000000);
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

    // Walk-cycle leg swing while moving; idle breathing otherwise.
    // Wind-up, charge, sweep and stomp poses own their leg angles, so
    // the decay below only runs when the boss is idle or staggered.
    if (this.state === 'idle' && dist > 3.5) {
      const s = Math.sin(this.walkPhase);
      this.legs[0].rotation.x = s * 0.4;
      this.legs[3].rotation.x = s * 0.4;
      this.legs[1].rotation.x = -s * 0.4;
      this.legs[2].rotation.x = -s * 0.4;
    } else if (this.state === 'idle' || this.state === 'staggered') {
      for (const leg of this.legs) leg.rotation.x *= 0.85;
      this.body.position.y = 1.6 + Math.sin(this.stateT * 2) * 0.03;
    }
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
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
