// main.js — boots the game, owns the render loop, the camera, the input,
// and the win/lose state machine. The hunter and the boss each own their
// own rules (hunter.js, boss.js); this file is the glue between them.
//
// How to run it: ES modules do NOT work by double-clicking the file
// (file:// blocks imports). Serve the docs/ folder over HTTP, e.g.
// `python3 -m http.server` inside docs/, or VSCode Live Server.
// GitHub Pages serves these files as-is, no build step.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { SoundFX } from './audio.js';
import { buildArena } from './arena.js';
import { Hunter } from './hunter.js';
import { Boss } from './boss.js';
import { UI } from './ui.js';

// -- Renderer / scene --------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);

const sfx = new SoundFX();
const ui = new UI();
buildArena(scene);
const hunter = new Hunter(scene, sfx);
const boss = new Boss(scene, sfx);

// -- Game state ---------------------------------------------------------------
// phase: 'menu' | 'playing' | 'won' | 'lost'. The overlays in index.html
// are the only thing that changes phase — the loop always runs, so the
// arena is visible (and slowly orbiting) behind the start screen.
let phase = 'menu';
let elapsed = 0;
let endTimer = 0; // delay before the win/lose overlay appears

// -- Third-person camera: orbits the hunter. Drag to orbit, wheel to zoom.
//    Lock-on (Tab / middle click) swings the camera behind the hunter so
//    the boss stays framed. ---------------------------------------------------
let camYaw = 0;        // horizontal orbit angle
let camPitch = 0.35;   // vertical angle, radians above horizontal
let camDist = 9;       // metres from the hunter
let locked = false;
let shake = 0;

function updateCamera(dt) {
  if (locked && boss.alive) {
    // Swing the orbit yaw around until the camera sits behind the hunter
    // relative to the boss — i.e. the boss is straight ahead on screen.
    const dx = boss.position.x - hunter.position.x;
    const dz = boss.position.z - hunter.position.z;
    const wantYaw = Math.atan2(dx, dz) + Math.PI;
    let diff = wantYaw - camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    camYaw += diff * Math.min(1, dt * 5);
  }
  const target = hunter.position.clone();
  target.y += 1.6; // look at the hunter's chest, not their feet
  const off = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  ).multiplyScalar(camDist);
  camera.position.copy(target).add(off);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 2);
  }
  // When locked on, aim slightly towards the boss so it stays framed.
  const look = target.clone();
  if (locked && boss.alive) look.lerp(boss.position.clone().setY(1.6), 0.35);
  camera.lookAt(look);
}

// -- Input --------------------------------------------------------------------
const keys = new Set();
let dragging = false;
let dragMoved = 0;
let dragStartT = 0;
let lastX = 0, lastY = 0;

const input = { forward: false, back: false, left: false, right: false, camYaw: 0 };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); toggleLock(); return; }
  if (phase !== 'playing') return;
  keys.add(e.code);
  if (e.code === 'KeyR') hunter.tryHeal();
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
    e.preventDefault();
    hunter.tryDodge(currentMoveDir());
  }
  if (e.code === 'KeyJ') hunter.tryLight();
  if (e.code === 'KeyK') hunter.tryHeavy();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function toggleLock() {
  if (phase !== 'playing' || !boss.alive) return;
  locked = !locked;
  sfx.click();
}

// Mouse: drag orbits the camera. A quick click (short, barely moved) is
// a light attack; right click is a heavy attack; middle click locks on.
canvas.addEventListener('mousedown', (e) => {
  if (phase !== 'playing') return;
  if (e.button === 0) {
    dragging = true;
    dragMoved = 0;
    dragStartT = performance.now();
    lastX = e.clientX; lastY = e.clientY;
  } else if (e.button === 2) {
    hunter.tryHeavy();
  } else if (e.button === 1) {
    e.preventDefault();
    toggleLock();
  }
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  camYaw -= dx * 0.005;
  camPitch = Math.max(0.08, Math.min(1.1, camPitch + dy * 0.004));
  if (dragMoved > 6) locked = false; // manual orbit breaks lock-on
});
window.addEventListener('mouseup', (e) => {
  if (dragging && e.button === 0) {
    // A click, not a drag: this is a light attack.
    if (dragMoved < 6 && performance.now() - dragStartT < 300) hunter.tryLight();
  }
  dragging = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = Math.max(5, Math.min(14, camDist + Math.sign(e.deltaY) * 1));
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch: one finger drag orbits; two-finger tap is a light attack.
// (Minimal support — this prototype is PC-first.)
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!touchStart) return;
  const t = e.touches[0];
  camYaw -= (t.clientX - touchStart.x) * 0.008;
  camPitch = Math.max(0.08, Math.min(1.1, camPitch + (t.clientY - touchStart.y) * 0.006));
  touchStart = { x: t.clientX, y: t.clientY, t: touchStart.t };
  locked = false;
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (touchStart && performance.now() - touchStart.t < 250 && phase === 'playing') hunter.tryLight();
  touchStart = null;
}, { passive: true });

// Camera-relative movement direction, for dodge rolls (roll where the
// player is steering, or backwards if standing still).
function currentMoveDir() {
  const m = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) m.z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) m.z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) m.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) m.x += 1;
  if (m.lengthSq() > 0) {
    m.normalize();
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = m.x * cos - m.z * sin;
    const wz = m.x * sin + m.z * cos;
    return new THREE.Vector3(wx, 0, wz).normalize();
  }
  // Standing still: roll backwards, away from where we face.
  return new THREE.Vector3(-Math.sin(hunter.group.rotation.y), 0, -Math.cos(hunter.group.rotation.y));
}

// -- Combat glue --------------------------------------------------------------
// The hunter reports a swing; this decides whether it hit the boss, and
// whether the hit was on the head (horn damage) or the body.
function onAttackHit(dmg, range) {
  if (!boss.alive) return;
  const toBoss = new THREE.Vector3().subVectors(boss.position, hunter.position);
  toBoss.y = 0;
  const dist = toBoss.length();
  if (dist > range + 1.8) return; // boss body radius — out of reach
  // The swing only counts if the boss is roughly in front of the hunter.
  const facing = new THREE.Vector3(Math.sin(hunter.group.rotation.y), 0, Math.cos(hunter.group.rotation.y));
  if (toBoss.normalize().dot(facing) < 0.1) return;
  // Head hit? Compare the hunter's position to the boss's head: if the
  // hunter is standing near the head end of the boss, the swing hits horn.
  const headDist = hunter.position.distanceTo(boss.headPos);
  const isHead = headDist < 3.0;
  const result = boss.takeDamage(dmg, isHead);
  if (!result) return;
  sfx.hit();
  ui.damageNumber(boss.headPos, camera, String(dmg), isHead ? 'head' : 'hit');
  if (result.hornBroke) {
    ui.damageNumber(boss.headPos, camera, 'HORN BREAK!', 'break');
  }
  if (result.killed) {
    phase = 'won';
    endTimer = 1.2; // let the topple play out before the overlay
    sfx.victory();
  }
}

function damageHunter(dmg, fromPos) {
  if (phase !== 'playing') return;
  if (hunter.takeDamage(dmg, fromPos)) {
    ui.flash();
    shake = Math.max(shake, 0.35);
    if (!hunter.alive) {
      phase = 'lost';
      endTimer = 1.2;
      locked = false;
    }
  }
}

// -- Start / retry ------------------------------------------------------------
function startGame() {
  sfx.unlock();
  sfx.click();
  hunter.reset();
  boss.reset();
  locked = false;
  elapsed = 0;
  endTimer = 0;
  camYaw = 0;
  camPitch = 0.35;
  camDist = 9;
  phase = 'playing';
  ui.showGame();
}

document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('retry-button').addEventListener('click', startGame);
document.getElementById('start-screen').addEventListener('click', (e) => {
  if (e.target.id === 'start-screen') startGame();
});

// -- Main loop ----------------------------------------------------------------
const clock = new THREE.Clock();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp huge steps (tab switches)
  frames++;

  input.forward = keys.has('KeyW') || keys.has('ArrowUp');
  input.back = keys.has('KeyS') || keys.has('ArrowDown');
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  input.camYaw = camYaw;

  if (phase === 'playing') {
    elapsed += dt;
    hunter.update(dt, input, {
      locked,
      bossPos: boss.position,
      onAttackHit,
      onHeal: () => {},
    });
    boss.update(dt, hunter, {
      damageHunter,
      onShake: (n) => { shake = Math.max(shake, n); },
    });
    ui.update(hunter, boss, elapsed, locked);
  } else if (phase === 'won' || phase === 'lost') {
    // Keep the world animating behind the end overlay.
    boss.update(dt, hunter, { damageHunter: () => {}, onShake: () => {} });
    endTimer -= dt;
    if (endTimer <= 0 && document.getElementById('end-screen').hidden) {
      ui.showEnd(phase === 'won', elapsed);
    }
  } else {
    // Menu: slow orbit around the arena so the start screen has life.
    camYaw += dt * 0.05;
    boss.update(dt, hunter, { damageHunter: () => {}, onShake: () => {} });
  }

  updateCamera(dt);
  renderer.render(scene, camera);
  if (frames === 2) window.__hunterReady = true; // boot signal for tests
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

ui.showStart();
animate();

// -- Test hook ---------------------------------------------------------------
// Exposed for headless checks (and for Victor to poke at from the console).
// It is not part of the game itself — the game never reads it.
window.__hunter = {
  CONFIG,
  get phase() { return phase; },
  get elapsed() { return elapsed; },
  get locked() { return locked; },
  hunter,
  boss,
  start: startGame,
  toggleLock,
  debug: {
    damageBoss(dmg, isHead = false) {
      const r = boss.takeDamage(dmg, isHead);
      if (r && r.killed) { phase = 'won'; endTimer = 1.2; }
      return r;
    },
    damageHunter(dmg) {
      const landed = hunter.takeDamage(dmg, boss.position);
      if (landed && !hunter.alive) { phase = 'lost'; endTimer = 1.2; locked = false; }
      return landed;
    },
    setBossHp(n) { boss.hp = n; },
    setHunterHp(n) { hunter.hp = n; },
    forceBossMove(move) {
      // 'charge' | 'sweep' | 'stomp' — jump straight to the windup.
      if (!boss.alive) return false;
      boss.state = 'windup-' + move;
      boss.stateT = 0;
      boss._telegraph();
      return true;
    },
    teleportHunter(x, z) {
      hunter.position.set(x, 0, z);
    },
    pressKey(code) {
      keys.add(code);
      if (code === 'KeyR') hunter.tryHeal();
      if (code === 'ShiftLeft') hunter.tryDodge(currentMoveDir());
      if (code === 'KeyJ') hunter.tryLight();
      if (code === 'KeyK') hunter.tryHeavy();
    },
    releaseKey(code) { keys.delete(code); },
  },
};
