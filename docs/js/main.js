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
import { buildArena, OBSTACLES } from './arena.js';
import { Effects } from './effects.js';
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
const effects = new Effects(scene);
const hunter = new Hunter(scene, sfx);
const boss = new Boss(scene, sfx);

// The models load asynchronously; the fight cannot start until the
// Knight and the Skeleton are both in the scene, so the Start button
// stays disabled (showing LOADING…) until both are ready.
const startButton = document.getElementById('start-button');
startButton.disabled = true;
startButton.textContent = 'LOADING…';
Promise.allSettled([hunter.ready, boss.ready]).then(() => {
  if (hunter.loadError || boss.loadError) {
    startButton.textContent = 'FAILED TO LOAD — RELOAD THE PAGE';
    return;
  }
  startButton.disabled = false;
  startButton.textContent = 'ENTER THE ARENA';
});

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
let camDist = 9;       // metres from the hunter (wheel target)
let locked = false;
let shake = 0;
// Smoothed camera position / look point: the camera eases towards where
// it wants to be instead of snapping there, so lock-on swings, dodges
// and zoom steps all glide.
let camPosS = null;
let camLookS = null;

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
  const dir = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  );
  // Camera collision: walk from the hunter towards the wanted spot in
  // small steps and stop before the first thing in the way — the boss
  // body, a pillar or rock tall enough to block the view, or the arena
  // wall. The camera is pulled in instead of clipping through.
  let freeDist = camDist;
  const step = 0.5;
  const bossC = boss.position.clone().setY(1.6);
  for (let d = step; d <= camDist; d += step) {
    const p = target.clone().addScaledVector(dir, d);
    let blocked = false;
    if (p.distanceTo(bossC) < 2.6) blocked = true; // boss body sphere
    if (!blocked && Math.hypot(p.x, p.z) > CONFIG.arenaRadius - 0.5) blocked = true;
    if (!blocked) {
      for (const o of OBSTACLES) {
        if (p.y < o.h && Math.hypot(p.x - o.x, p.z - o.z) < o.r + 0.5) { blocked = true; break; }
      }
    }
    if (blocked) { freeDist = Math.max(CONFIG.cameraMinDist, d - step - 0.3); break; }
  }
  const desired = target.clone().addScaledVector(dir, freeDist);
  if (!camPosS) { camPosS = desired.clone(); camLookS = target.clone(); }
  const k = 1 - Math.exp(-CONFIG.cameraSmooth * Math.max(0, dt));
  camPosS.lerp(desired, dt > 0 ? k : 0);
  // When locked on, aim slightly towards the boss so it stays framed.
  const look = target.clone();
  if (locked && boss.alive) look.lerp(boss.position.clone().setY(1.6), 0.35);
  camLookS.lerp(look, dt > 0 ? k : 0);
  camera.position.copy(camPosS);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 2);
  }
  camera.lookAt(camLookS);
}

// -- Input --------------------------------------------------------------------
const keys = new Set();
let lastX = 0, lastY = 0;

const input = { forward: false, back: false, left: false, right: false, camYaw: 0 };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); toggleLock(); return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (phase !== 'playing' || paused) return;
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

// Mouse — the old scheme overloaded the left button: drag orbited the
// camera AND a quick click attacked, so every orbit risked a swing and
// every swing risked moving the camera. The new scheme gives each
// button exactly one job:
//   * Pointer lock (click the canvas once to capture the mouse) is the
//     primary camera: moving the mouse orbits, no button held.
//     While locked, left click is ONLY a light attack, right click ONLY
//     a heavy attack. Esc releases the mouse.
//   * Right-drag is the fallback orbit (e.g. if pointer lock is denied):
//     hold right mouse and drag to orbit; a quick right-click is heavy.
//   * Q / E orbit the camera from the keyboard, no mouse needed.
//   * Middle click still toggles lock-on. Touch is unchanged (drag
//     orbits, tap attacks) — it never had the conflict, taps are taps.
let pointerLocked = false;
let rightDragging = false;
let rightDragMoved = 0;
let rightDragStartT = 0;

const lockHint = document.getElementById('lock-hint');
function updateLockHint() {
  if (lockHint) lockHint.hidden = !(phase === 'playing' && !paused && !pointerLocked);
}
function applyMouseLook(dx, dy) {
  // Same orbit math the old drag used: mouse right turns the view
  // right, mouse up looks up. Ignored while lock-on frames the boss.
  if (locked && boss.alive) return;
  camYaw -= dx * 0.003;
  camPitch = Math.max(0.08, Math.min(1.1, camPitch + dy * 0.003));
}
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  updateLockHint();
});
canvas.addEventListener('mousedown', (e) => {
  if (phase !== 'playing') return;
  if (e.button === 0) {
    if (!pointerLocked) {
      // First click captures the mouse; it is NOT an attack.
      // (Chrome rejects a re-lock for ~1s after Esc — swallow that
      // rejection; the hint stays up and the next click retries.)
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    hunter.tryLight();
  } else if (e.button === 2) {
    rightDragging = true;
    rightDragMoved = 0;
    rightDragStartT = performance.now();
    lastX = e.clientX; lastY = e.clientY;
  } else if (e.button === 1) {
    e.preventDefault();
    toggleLock();
  }
});
window.addEventListener('mousemove', (e) => {
  if (pointerLocked) {
    applyMouseLook(e.movementX || 0, e.movementY || 0);
    return;
  }
  if (!rightDragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  rightDragMoved += Math.abs(dx) + Math.abs(dy);
  applyMouseLook(dx * 1.6, dy * 1.3); // right-drag uses the old drag scale
  if (rightDragMoved > 6) locked = false; // manual orbit breaks lock-on
});
window.addEventListener('mouseup', (e) => {
  if (rightDragging && e.button === 2) {
    // A quick right-click, not a drag: this is a heavy attack.
    if (rightDragMoved < 6 && performance.now() - rightDragStartT < 300) hunter.tryHeavy();
  }
  rightDragging = false;
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
    // Same camera-relative rotation as hunter.js: W must go along the
    // camera's forward (-sin yaw, -cos yaw), D along its right
    // (cos yaw, -sin yaw). See hunter.js for the derivation — the old
    // signs here rotated the input the wrong way round.
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = m.x * cos + m.z * sin;
    const wz = -m.x * sin + m.z * cos;
    return new THREE.Vector3(wx, 0, wz).normalize();
  }
  // Standing still: roll backwards, away from where we face.
  return new THREE.Vector3(-Math.sin(hunter.group.rotation.y), 0, -Math.cos(hunter.group.rotation.y));
}

// -- Pause --------------------------------------------------------------------
// P key or the HUD pause button, only while a fight is running. While
// paused the game freezes completely — hunter, boss, timer, animations.
// Esc does NOT pause: it only releases the mouse, which is how the
// player reaches the pause button in the first place.
let paused = false;
let hitStop = 0;      // seconds of freeze left on a landed hit
let lastHitStop = 0;  // sticky copy, for headless checks

function togglePause() {
  if (paused) {
    paused = false;
    ui.hidePause();
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* lock hint covers it */ }
    updateLockHint();
    return;
  }
  if (phase !== 'playing') return;
  paused = true;
  keys.clear(); // no stuck movement keys while frozen
  if (pointerLocked) document.exitPointerLock();
  ui.showPause();
  sfx.click();
  updateLockHint();
}

// -- Combat glue --------------------------------------------------------------
// The hunter reports a swing; this decides whether it hit the boss, and
// whether the hit was on the head (skull damage) or the body.
function onAttackHit(dmg, range, kind) {
  if (!boss.alive) return;
  const toBoss = new THREE.Vector3().subVectors(boss.position, hunter.position);
  toBoss.y = 0;
  const dist = toBoss.length();
  if (dist > range + 1.8) return; // boss body radius — out of reach
  // The swing only counts if the boss is roughly in front of the hunter.
  const facing = new THREE.Vector3(Math.sin(hunter.group.rotation.y), 0, Math.cos(hunter.group.rotation.y));
  if (toBoss.normalize().dot(facing) < 0.1) return;
  // Head hit? Compare the hunter's position to the boss's head: if the
  // hunter is standing near the head end of the boss, the swing hits the skull.
  const headDist = hunter.position.distanceTo(boss.headPos);
  const isHead = headDist < 3.0;
  const result = boss.takeDamage(dmg, isHead);
  if (!result) return;
  sfx.hit();
  // Hit-stop: freeze the game for a beat so the connect has weight.
  // This only runs on a landed hit — a whiff returns above, so a miss
  // never freezes the game.
  hitStop = kind === 'heavy' ? CONFIG.hitStopHeavy : CONFIG.hitStopLight;
  lastHitStop = hitStop;
  // Impact sparks at the hit point, in the world, not on the HUD.
  const hitPoint = isHead ? boss.headPos : boss.position.clone().setY(1.6);
  effects.sparks(hitPoint, CONFIG.sparkCount);
  // Heavier connect, heavier feel: the heavy slam shakes the camera
  // more and kicks dust up where it lands; a light hit just shudders.
  shake = Math.max(shake, kind === 'heavy' ? CONFIG.heavyShake : CONFIG.lightShake);
  if (kind === 'heavy') {
    effects.dust(new THREE.Vector3(boss.position.x, 0.1, boss.position.z), CONFIG.heavyDustCount);
  }
  ui.damageNumber(boss.headPos, camera, String(dmg), isHead ? 'head' : 'hit');
  if (result.skullBroke) {
    ui.damageNumber(boss.headPos, camera, 'SKULL CRACK!', 'break');
    effects.sparks(boss.headPos, 20); // bone shards bursting from the skull
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
  paused = false;
  hitStop = 0;
  elapsed = 0;
  endTimer = 0;
  camYaw = 0;
  camPitch = 0.35;
  camDist = 9;
  camPosS = null; // snap the camera back behind the hunter
  camLookS = null;
  phase = 'playing';
  ui.showGame();
  // Capture the mouse straight away (this is a user gesture, so the
  // browser allows it). If it is refused, the lock hint tells the
  // player to click the canvas, and right-drag still orbits.
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* hint covers it */ }
  updateLockHint();
}

document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('retry-button').addEventListener('click', startGame);
document.getElementById('pause-button').addEventListener('click', togglePause);
document.getElementById('resume-button').addEventListener('click', togglePause);
document.getElementById('pause-restart-button').addEventListener('click', startGame);
document.getElementById('start-screen').addEventListener('click', (e) => {
  if (e.target.id === 'start-screen') startGame();
});

// -- Main loop ----------------------------------------------------------------
const clock = new THREE.Clock();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05); // clamp huge steps (tab switches)
  // Hit-stop: a landed hit freezes the game for a beat. The renderer
  // still runs, so the frame is shown — nothing advances.
  let dt = rawDt;
  if (hitStop > 0) { hitStop -= rawDt; dt = 0; }
  frames++;

  input.forward = keys.has('KeyW') || keys.has('ArrowUp');
  input.back = keys.has('KeyS') || keys.has('ArrowDown');
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  input.camYaw = camYaw;

  // Q / E orbit the camera from the keyboard (breaks lock-on, like a drag).
  if (!paused && keys.has('KeyQ')) { camYaw += dt * 1.8; locked = false; }
  if (!paused && keys.has('KeyE')) { camYaw -= dt * 1.8; locked = false; }
  // Release the mouse when the fight is not running (menu / end screens).
  if (phase !== 'playing' && pointerLocked) document.exitPointerLock();
  updateLockHint();

  if (paused) {
    // Frozen: nothing advances — not the timer, not the hunter, not
    // the boss, not the particles. The frame still renders.
  } else if (phase === 'playing') {
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
      effects,
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

  effects.update(paused ? 0 : dt);
  updateCamera(paused ? 0 : dt);
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
  get camYaw() { return camYaw; },
  get pointerLocked() { return pointerLocked; },
  get paused() { return paused; },
  get lastHitStop() { return lastHitStop; },
  get modelsReady() { return hunter.modelLoaded && boss.modelLoaded; },
  get lastSwingPitch() { return sfx.lastSwingPitch; },
  get particlesAlive() { return effects.aliveCount; },
  get lastSparkCount() { return effects.lastSparkCount; },
  get cameraPos() {
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  },
  togglePause,
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
    setCamYaw(yaw) { camYaw = yaw; },
    // Drive the pointer-lock orbit math without a real pointer lock
    // (headless Chromium cannot lock the pointer the same way).
    simulateMouseLook(dx, dy) { applyMouseLook(dx, dy); },
    // Start one specific swing from idle, for headless pose checks:
    // a real chained combo is too fast for screenshots under
    // SwiftShader (a screenshot alone advances ~0.85s of game time).
    // Bypasses the stamina cost — test-only, the game never calls these.
    startLightHit(i) {
      if (hunter.state !== 'idle' || !hunter.alive) return false;
      hunter.attackIndex = i;
      hunter.attackKind = 'light';
      hunter._beginAttack();
      return true;
    },
    startHeavy() {
      if (hunter.state !== 'idle' || !hunter.alive) return false;
      hunter.attackKind = 'heavy';
      hunter._beginAttack();
      return true;
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
