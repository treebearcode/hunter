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
  // Light attack: a 3-hit combo. Heavy: one slow, hard hit. Stab: a
  // chord-move thrust (Q+E or LMB+RMB), longer reach, single poke.
  // Light swings play only the strike portion of each clip at
  // near-natural speed, so each swing lasts 0.55 s instead of the old
  // 0.35 s whole-clip sprint.
  lightComboDmg: [8, 8, 12],
  lightComboTime: 0.55,     // duration of each light swing (strike portion)
  lightCost: 8,
  lightRange: 3.8,
  comboGrace: 0.3,          // after a swing ends, a late press still chains
  heavyDmg: 18,
  heavyTime: 0.7,           // windup + swing; the hit lands halfway through
  heavyCost: 15,
  heavyRange: 3.6,
  stabDmg: 14,
  stabTime: 0.45,           // the hit lands halfway through (0.225 s)
  stabCost: 12,
  stabRange: 4.2,           // a thrust reaches further — its whole identity
  hitStopStab: 0.07,
  stabShake: 0.3,
  stabPitch: 0.85,

  // -- The Skeleton, the boss ------------------------------------------------
  bossMaxHp: 600,
  bossEnrageHp: 180,        // below this the boss enrages (30% of max)
  bossSpeed: 4.5,           // walk speed while closing in / wandering
  // There is NO standing contact damage: the boss body is solid and
  // pushes the hunter out to 2.0 m instead of hurting. Contact damage
  // exists only during a charge, where it is a real telegraphed attack.
  bossContactDmg: 8,        // charge-only body damage
  bossContactCooldown: 1.0, // seconds between contact hits (charge only)
  bossBodyRadius: 2.0,      // solid-body push-out distance
  chargeSpeed: 18,          // m/s during a charge
  chargeWindup: 0.8,        // telegraph time before the charge
  sweepDmg: 25,
  sweepRange: 4.0,          // shrinks to 2.8 after the skull cracks
  sweepRangeBroken: 2.8,
  sweepWindup: 0.75,
  stompDmg: 20,
  stompWindup: 0.85,
  leapDmg: 22,              // leap slam: landing shockwave damage
  leapWindup: 0.9,          // crouch telegraph before the jump
  leapTime: 0.6,            // time spent in the air
  leapHeight: 2.5,          // arc peak above the ground
  leapHitRadius: 3.0,       // landing shockwave hits this far out
  spinDmg: 20,              // 360-degree club spin, hits all around
  spinWindup: 0.8,          // twist telegraph before the spin
  spinTime: 0.7,            // one full turn
  shockwaveMaxRadius: 9,    // the stomp ring expands this far
  shockwaveSpeed: 9,        // m/s the ring expands
  poiseMax: 100,            // accumulated damage that forces a stagger
  staggerTime: 2.5,
  skullBreakDmg: 150,       // head damage before the break triggers —
                            // the skull for the Skeleton, the bear hat
                            // for the Barbarian (same threshold both)
  skullBreakStagger: 3.5,   // longer stagger when the break triggers
  enrageSpeedMult: 1.25,    // attacks ~25% faster while enraged

  // -- Hit feel -------------------------------------------------------------
  hitStopLight: 0.06,       // freeze on a landed light hit (seconds)
  hitStopHeavy: 0.09,       // freeze on a landed heavy hit
  sparkCount: 14,           // impact sparks per landed hit
  dustPuffCount: 8,         // dust puffs per paw stamp / stomp burst
  dodgeDustCount: 10,       // dust kicked up at dodge start and landing
  dodgeFovKick: 7,          // extra camera FOV (degrees) during a dodge
  afterimageLife: 0.45,     // seconds a dodge afterimage lingers

  // -- Player attacks -------------------------------------------------------
  // The lunge is a short step forward during the strike part of a swing,
  // so attacks close the last step of distance instead of whiffing.
  lungeLightSpeed: 3.0,     // m/s during the lunge window of a light swing
  lungeHeavySpeed: 3.5,     // m/s during the lunge window of a heavy swing
  lungeStabSpeed: 3.0,      // m/s during the lunge window of a stab thrust
  lungeStart: 0.12,         // swing fraction where the lunge starts
  lungeEnd: 0.65,           // swing fraction where the lunge ends
  // Light lunge ≈ 3.0 m/s × (0.53 × 0.55s) ≈ 0.9 m; heavy ≈ 1.3 m;
  // stab ≈ 3.0 m/s × (0.53 × 0.45s) ≈ 0.7 m.
  attackBufferStart: 0.08,  // earliest into a swing a queued combo hit counts
  trailMaxAge: 0.18,        // seconds a sword-trail sample lives
  lightShake: 0.2,          // camera shake on a landed light hit
  heavyShake: 0.5,          // camera shake on a landed heavy hit
  heavyDustCount: 10,       // dust kicked up where a heavy slam lands

  // -- Camera ---------------------------------------------------------------
  cameraSmooth: 12,         // how fast the camera eases to its spot (per second)
  cameraMinDist: 2.5,       // closest the camera is ever pulled in
};
