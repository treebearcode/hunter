// audio.js — tiny Web Audio sound effects, no audio files needed.
// Every sound is an oscillator (a pure tone) shaped by a volume envelope,
// so the whole game stays self-contained. The AudioContext is created
// lazily on the first user gesture (the Start click), because browsers
// block audio until the player has interacted with the page.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.lastSwingPitch = 0; // sticky, for headless checks (set even with no audio)
  }

  // Call from a click handler. Safe to call more than once.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25; // keep all blips quiet
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null; // no audio is fine — the game must not depend on it
    }
  }

  // One short tone: frequency slides from `from` to `to` over `dur` seconds.
  _tone(from, to, dur, type = 'sine', volume = 1) {
    if (!this.ctx || !this.enabled) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* ignore audio errors */ }
  }

  // A burst of noise-ish sound: several detuned tones at once.
  _thud(freq, dur, volume = 1) {
    this._tone(freq, freq * 0.5, dur, 'triangle', volume);
    this._tone(freq * 0.5, freq * 0.25, dur, 'sine', volume * 0.8);
  }

  // Whoosh, pitched per swing so the combo rises: light hits 1.0 / 1.15 /
  // 1.3, heavy 0.7 (low and deep). Recorded even when there is no audio
  // context, so headless checks can read the pitch.
  swing(pitch = 1) {
    this.lastSwingPitch = pitch;
    this._tone(500 * pitch, 180 * pitch, 0.12, 'sine', 0.5);
  }
  // Sword connects: a low thud under a short metallic bite, louder and
  // much heavier than the swing whoosh so a landed hit reads by ear.
  hit()    { this._thud(160, 0.14, 1.0); this._tone(320, 140, 0.08, 'square', 0.55); }
  // The skeleton snorts before a charge: a rough descending growl.
  snort()  { this._tone(280, 90, 0.35, 'sawtooth', 0.55); this._tone(140, 70, 0.3, 'square', 0.35); }
  hurt()   { this._tone(160, 60, 0.25, 'sawtooth', 0.7); }       // hunter takes a hit
  heal()   { this._tone(400, 900, 0.4, 'sine', 0.5); }           // heal chime
  dodge()  { this._tone(300, 500, 0.12, 'sine', 0.3); }
  roar()   { this._tone(90, 220, 0.7, 'sawtooth', 0.9); }        // boss roar / enrage
  telegraph() { this._tone(120, 120, 0.25, 'square', 0.4); }    // "big move coming" cue
  stomp()  { this._thud(70, 0.35, 1); }                          // ground slam
  stagger(){ this._tone(600, 200, 0.4, 'triangle', 0.6); }
  skullCrack() { this._tone(900, 150, 0.5, 'square', 0.7); }    // bone crack + snap
  victory(){ this._tone(440, 440, 0.15, 'sine', 0.5); this._tone(660, 660, 0.3, 'sine', 0.5); }
  defeat() { this._tone(220, 110, 0.6, 'sawtooth', 0.5); }
  click()  { this._tone(700, 700, 0.05, 'sine', 0.4); }
}
