// ui.js — all of the 2D interface: health/stamina bars, the boss bar,
// heal pips, damage numbers that float up from where a hit landed, and
// the start / victory / defeat overlays. The 3D world never draws text;
// the DOM does, which keeps the HUD crisp at any resolution.

import { CONFIG } from './config.js';

export class UI {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.hpFill = this.el('hp-fill');
    this.hpText = this.el('hp-text');
    this.stFill = this.el('st-fill');
    this.comboRow = this.el('combo-row');
    this.comboCount = this.el('combo-count');
    this.healPips = this.el('heal-pips');
    this.bossFill = this.el('boss-fill');
    this.bossWrap = this.el('boss-bar');
    this.lockEl = this.el('lock-indicator');
    this.hud = this.el('hud');
    this.timeEl = this.el('time-text');
    this.dmgLayer = this.el('damage-layer');
    this.flashEl = this.el('damage-flash');
    this.enrageEl = this.el('enrage-banner');
    this._enrageShown = false;
    this._bossName = 'THE BARBARIAN'; // cached from boss.displayName each frame
    this._bossWinTitle = 'BARBARIAN FELLED';
    this._bossNameEl = this.el('boss-name');

    // Boss select (start screen): two buttons, plain <button>s so they
    // work with mouse and keyboard alike. The choice is saved in
    // localStorage and read back by the Boss when it loads; the Boss
    // itself does the model swap, via the hunter:boss-select event, so
    // the menu never has to know how a boss is built.
    this._bossButtons = {
      barbarian: this.el('boss-select-barbarian'),
      skeleton: this.el('boss-select-skeleton'),
    };
    this._bossDescs = {
      barbarian: this.el('boss-desc-barbarian'),
      skeleton: this.el('boss-desc-skeleton'),
    };
    const savedBoss = (window.localStorage && localStorage.getItem('hunter.boss')) || 'barbarian';
    this._applyBossChoice(savedBoss === 'skeleton' ? 'skeleton' : 'barbarian');
    for (const [kind, btn] of Object.entries(this._bossButtons)) {
      if (!btn) continue;
      btn.addEventListener('click', () => this._selectBoss(kind));
    }
  }

  // Show the saved/chosen boss as selected in the menu. The actual
  // model swap is the Boss's job (it listens for the event below).
  _applyBossChoice(kind) {
    for (const [k, btn] of Object.entries(this._bossButtons)) {
      if (!btn) continue;
      const on = k === kind;
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const [k, desc] of Object.entries(this._bossDescs)) {
      if (desc) desc.hidden = k !== kind;
    }
  }

  _selectBoss(kind) {
    if (window.localStorage) localStorage.setItem('hunter.boss', kind);
    this._applyBossChoice(kind);
    window.dispatchEvent(new CustomEvent('hunter:boss-select', { detail: { kind } }));
  }

  update(hunter, boss, elapsedSec, locked) {
    const hpPct = Math.max(0, hunter.hp / CONFIG.hunterMaxHp * 100);
    this.hpFill.style.width = hpPct + '%';
    this.hpText.textContent = `${Math.ceil(hunter.hp)} / ${CONFIG.hunterMaxHp}`;
    this.stFill.style.width = Math.max(0, hunter.stamina / CONFIG.staminaMax * 100) + '%';
    // Light-combo counter (1/2/3) under the stamina bar; hidden when
    // no combo is running.
    const combo = hunter.comboDisplay || 0;
    if (this.comboRow) {
      this.comboRow.hidden = combo === 0;
      if (combo > 0) this.comboCount.textContent = combo;
    }
    this.healPips.textContent = '✚'.repeat(hunter.heals) + '○'.repeat(CONFIG.healCount - hunter.heals);
    this.bossFill.style.width = Math.max(0, boss.hp / CONFIG.bossMaxHp * 100) + '%';
    this.bossWrap.classList.toggle('enraged', boss.enraged);
    // The boss name / win title follow whichever boss is selected —
    // the HUD never hard-codes a boss.
    if (boss.displayName && boss.displayName !== this._bossName) {
      this._bossName = boss.displayName;
      if (this._bossNameEl) this._bossNameEl.textContent = boss.displayName;
    }
    if (boss.winTitle) this._bossWinTitle = boss.winTitle;
    this.lockEl.hidden = !locked;
    this.timeEl.textContent = fmtTime(elapsedSec);
    if (boss.enraged && !this._enrageShown) {
      this._enrageShown = true;
      this.enrageEl.textContent = `${this._bossName} IS ENRAGED`;
      this.enrageEl.hidden = false;
      setTimeout(() => { this.enrageEl.hidden = true; }, 2000);
    }
    if (!boss.enraged) this._enrageShown = false;
  }

  // A floating damage number at a 3D position. `camera` projects the
  // world position onto the screen; the number then floats up and fades
  // via CSS, and removes itself when the animation ends.
  damageNumber(worldPos, camera, text, kind = 'hit') {
    const v = worldPos.clone().project(camera);
    if (v.z > 1) return; // behind the camera — nothing to show
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const div = document.createElement('div');
    div.className = 'dmg-num ' + kind;
    div.textContent = text;
    div.style.left = x + 'px';
    div.style.top = y + 'px';
    this.dmgLayer.appendChild(div);
    div.addEventListener('animationend', () => div.remove());
    setTimeout(() => div.remove(), 1200); // safety net if animationend misses
  }

  // Full-screen red flash when the hunter is hurt.
  flash() {
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth; // restart the CSS animation
    this.flashEl.classList.add('show');
  }

  showPause() {
    this.el('pause-screen').hidden = false;
  }

  hidePause() {
    this.el('pause-screen').hidden = true;
  }

  showStart() {
    this.hud.hidden = true;
    this.hidePause();
    this.el('start-screen').hidden = false;
    this.el('end-screen').hidden = true;
  }

  showGame() {
    this.hud.hidden = false;
    this.hidePause();
    this.el('start-screen').hidden = true;
    this.el('end-screen').hidden = true;
  }

  showEnd(won, elapsedSec) {
    this.hud.hidden = true;
    const end = this.el('end-screen');
    end.hidden = false;
    this.el('end-title').textContent = won ? this._bossWinTitle : 'YOU DIED';
    this.el('end-title').className = won ? 'win' : 'lose';
    this.el('end-stats').textContent = won
      ? `Clear time: ${fmtTime(elapsedSec)}`
      : `You survived ${fmtTime(elapsedSec)} — the hunt continues.`;
  }
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
