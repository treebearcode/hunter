// config.js — every tuning number for the prototype, in one place.
// Change the game here, not scattered through the code. All times are in
// seconds, all distances in metres, all damage in plain hit points.

// The arena is a circle; the hunter and the boss are both kept inside it.
export const CONFIG = {
  arenaRadius: 20,          // playable circle radius
  arenaBound: 18.5,         // where the invisible wall stops the hunter/boss

  // -- Hunter ---------------------------------------------------------------
  hunterMaxHp: 100,
  hunterSpeed: 7,           // m/s while running
  staminaMax: 100,
  staminaRegen: 25,         // per second, after a short delay
  staminaRegenDelay: 0.8,   // wait this long after spending stamina
  healCount: 3,             // heals per attempt
  healAmount: 40,
  healTime: 1.2,            // channel time; taking a hit interrupts it
  dodgeCost: 20,
  dodgeTime: 0.35,          // roll duration; i-frames last the whole roll
  dodgeSpeed: 13,           // m/s during the roll

  // -- Longsword (the only weapon in this prototype) ------------------------
  // Light attack: a 3-hit combo. Heavy: one slow, hard hit.
  lightComboDmg: [8, 8, 12],
  lightComboTime: 0.35,     // duration of each light swing
  lightCost: 8,
  lightRange: 3.4,
  heavyDmg: 18,
  heavyTime: 0.7,           // windup + swing; the hit lands halfway through
  heavyCost: 15,
  heavyRange: 3.6,

  // -- Gorehorn, the boss ----------------------------------------------------
  bossMaxHp: 600,
  bossEnrageHp: 180,        // below this the boss enrages (30% of max)
  bossSpeed: 4.5,           // walk speed while closing in / wandering
  bossContactDmg: 8,        // bumping into the boss body (low on purpose)
  bossContactCooldown: 1.0, // seconds between contact hits
  chargeSpeed: 18,          // m/s during a charge
  chargeWindup: 0.8,        // telegraph time before the charge
  sweepDmg: 25,
  sweepRange: 4.0,          // shrinks to 2.8 after the horn breaks
  sweepRangeBroken: 2.8,
  sweepWindup: 0.6,
  stompDmg: 20,
  stompWindup: 0.7,
  shockwaveMaxRadius: 9,    // the stomp ring expands this far
  shockwaveSpeed: 9,        // m/s the ring expands
  poiseMax: 100,            // accumulated damage that forces a stagger
  staggerTime: 2.5,
  hornBreakDmg: 150,        // damage dealt to the head before a horn breaks
  hornBreakStagger: 3.5,    // longer stagger when the horn snaps off
  enrageSpeedMult: 1.25,    // attacks ~25% faster while enraged

  // -- Hit feel -------------------------------------------------------------
  hitStopLight: 0.06,       // freeze on a landed light hit (seconds)
  hitStopHeavy: 0.09,       // freeze on a landed heavy hit
  sparkCount: 14,           // impact sparks per landed hit
  dustPuffCount: 8,         // dust puffs per paw stamp / stomp burst

  // -- Player attacks -------------------------------------------------------
  // The lunge is a short step forward during the strike part of a swing,
  // so attacks close the last step of distance instead of whiffing.
  lungeLightSpeed: 4.5,     // m/s during the lunge window of a light swing
  lungeHeavySpeed: 3.5,     // m/s during the lunge window of a heavy swing
  lungeStart: 0.12,         // swing fraction where the lunge starts
  lungeEnd: 0.65,           // swing fraction where the lunge ends
  // Light lunge ≈ 4.5 m/s × (0.53 × 0.35s) ≈ 0.8 m; heavy ≈ 1.3 m.
  attackBufferStart: 0.08,  // earliest into a swing a queued combo hit counts
  trailMaxAge: 0.18,        // seconds a sword-trail sample lives
  lightShake: 0.2,          // camera shake on a landed light hit
  heavyShake: 0.5,          // camera shake on a landed heavy hit
  heavyDustCount: 10,       // dust kicked up where a heavy slam lands

  // -- Camera ---------------------------------------------------------------
  cameraSmooth: 12,         // how fast the camera eases to its spot (per second)
  cameraMinDist: 2.5,       // closest the camera is ever pulled in
};
