// arena.js — builds the fighting ground: floor, sky, lights, rocks,
// pillars and the low stone wall that rings the arena. Everything here is
// a Three.js primitive (circle, box, cylinder, dodecahedron) with a plain
// colour — no downloaded models or textures in this prototype.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Fixed obstacle layout, so the arena is the same every attempt.
// { x, z, r } — position on the ground and the collision radius.
export const OBSTACLES = [
  { x: -8, z: -6, r: 2.2 },
  { x: 9, z: -8, r: 1.8 },
  { x: -11, z: 7, r: 1.6 },
  { x: 7, z: 9, r: 2.4 },
  { x: 0, z: -13, r: 1.5 },
];

export function buildArena(scene) {
  // Sky colour + fog: things far away fade into the dusk haze.
  scene.background = new THREE.Color(0x1a2233);
  scene.fog = new THREE.Fog(0x1a2233, 30, 70);

  // Lights: a soft ambient fill, a warm "sun" that casts shadows,
  // and a cool rim light from the opposite side so silhouettes read.
  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x3a2f22, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  sun.shadow.camera.far = 60;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6f8fff, 0.5);
  rim.position.set(-10, 8, -12);
  scene.add(rim);

  // Ground: a big disc of packed earth, plus a slightly darker inner
  // disc that marks the fighting area at a glance.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(CONFIG.arenaRadius + 6, 48),
    new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(CONFIG.arenaRadius, 48),
    new THREE.MeshStandardMaterial({ color: 0x7d6b4f, roughness: 1 })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  inner.receiveShadow = true;
  scene.add(inner);

  // A thin ring on the floor showing exactly where the wall is.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.arenaRadius - 0.3, CONFIG.arenaRadius, 64),
    new THREE.MeshBasicMaterial({ color: 0xd8c48a, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // The wall itself: a ring of rough stone blocks. It is decoration —
  // the real boundary is the radius check in `collide()`.
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });
  const blockGeo = new THREE.BoxGeometry(2.2, 1.4, 1.0);
  const blocks = Math.floor((Math.PI * 2 * CONFIG.arenaRadius) / 2.2);
  for (let i = 0; i < blocks; i++) {
    const a = (i / blocks) * Math.PI * 2;
    const block = new THREE.Mesh(blockGeo, stoneMat);
    block.position.set(Math.cos(a) * CONFIG.arenaRadius, 0.7, Math.sin(a) * CONFIG.arenaRadius);
    block.rotation.y = -a + Math.PI / 2;
    block.castShadow = true;
    block.receiveShadow = true;
    scene.add(block);
  }

  // Rocks and pillars: grey boulders (squashed dodecahedrons) and two
  // standing pillars. They block movement and line of sight.
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1, flatShading: true });
  for (const o of OBSTACLES) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r, 0), rockMat);
    rock.position.set(o.x, o.r * 0.55, o.z);
    rock.scale.y = 0.75;
    rock.rotation.y = o.x * 1.7 + o.z;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9a917e, roughness: 0.9 });
  for (const [x, z] of [[-4, 11], [11, 2]]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 5, 8), pillarMat);
    pillar.position.set(x, 2.5, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
    OBSTACLES.push({ x, z, r: 1.3 });
  }
}

// Push a position out of the arena wall and out of every obstacle.
// `pos` is a THREE.Vector3 (only x/z are changed); `radius` is the
// thing's own body radius. Returns nothing — it edits `pos` in place.
export function collide(pos, radius) {
  const d = Math.hypot(pos.x, pos.z);
  const maxD = CONFIG.arenaBound - radius;
  if (d > maxD) {
    pos.x *= maxD / d;
    pos.z *= maxD / d;
  }
  for (const o of OBSTACLES) {
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const dist = Math.hypot(dx, dz);
    const min = o.r + radius;
    if (dist < min && dist > 0.001) {
      pos.x = o.x + (dx / dist) * min;
      pos.z = o.z + (dz / dist) * min;
    }
  }
}
