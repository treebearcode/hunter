// effects.js — short-lived in-world particles: dust puffs kicked up by
// Gorehorn's paws and the stomp, and bright impact sparks where a sword
// lands. One pooled THREE.Points cloud, no textures or files: each
// particle has a position, a velocity, a lifetime and a base colour, and
// dead particles are parked far below the floor. Nothing here is a UI
// element or a warning marker — dust and sparks are the world reacting.

import * as THREE from 'three';

const MAX = 240;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);     // seconds left
    this.maxLife = new Float32Array(MAX);  // seconds at spawn
    this.base = new Float32Array(MAX * 3); // colour at spawn
    this.grav = new Float32Array(MAX);     // downward pull per particle
    this.next = 0;
    this.lastSparkCount = 0; // sticky, for headless checks
    this.lastDustCount = 0;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -100; // parked
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; // positions move every frame
    scene.add(this.points);
  }

  _spawn(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.grav[i] = grav;
  }

  // A burst of bright sparks at a hit point: fast, short-lived, falls.
  sparks(p, count) {
    this.lastSparkCount = count;
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      this._spawn(
        p.x, p.y, p.z,
        Math.cos(a) * sp, 1 + Math.random() * 3.5, Math.sin(a) * sp,
        0.22 + Math.random() * 0.12,
        1.0, 0.85 + Math.random() * 0.15, 0.4, 9
      );
    }
  }

  // A soft puff of kicked-up dust: slow, drifts up and out, lingers.
  dust(p, count) {
    this.lastDustCount = count;
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 1.2;
      this._spawn(
        p.x + (Math.random() - 0.5) * 0.6, p.y + Math.random() * 0.2, p.z + (Math.random() - 0.5) * 0.6,
        Math.cos(a) * sp, 0.6 + Math.random() * 0.9, Math.sin(a) * sp,
        0.6 + Math.random() * 0.4,
        0.62, 0.52, 0.38, -0.5 // dust rises slightly instead of falling
      );
    }
  }

  get aliveCount() {
    let n = 0;
    for (let i = 0; i < MAX; i++) if (this.life[i] > 0) n++;
    return n;
  }

  update(dt) {
    if (dt <= 0) return;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100; // park it below the floor
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) this.pos[i * 3 + 1] = 0.05;
      const f = this.life[i] / this.maxLife[i]; // fade by darkening
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
