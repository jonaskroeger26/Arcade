/**
 * Lightweight Web Audio SFX — no external assets.
 * Requires AudioContext resume after a user gesture (tap / key).
 */

let ctx = null;
let muted = false;

function loadMute() {
  try {
    muted = localStorage.getItem('arcade-mute') === '1';
  } catch {
    muted = false;
  }
}

loadMute();

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  try {
    localStorage.setItem('arcade-mute', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function resumeAudioContext() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') return ctx.resume();
  } catch {
    /* ignore */
  }
  return Promise.resolve();
}

function beep(freq, dur, type = 'sine', vol = 0.07, freqEnd) {
  if (muted || !ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (freqEnd != null) o.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), ctx.currentTime + dur);
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur + 0.02);
}

export function sfxUi() {
  beep(520, 0.04, 'sine', 0.05);
}

export function sfxCoin() {
  beep(740, 0.05, 'sine', 0.06);
  setTimeout(() => beep(990, 0.05, 'sine', 0.045), 45);
}

export function sfxPlace() {
  beep(196, 0.09, 'triangle', 0.09);
  setTimeout(() => beep(294, 0.11, 'triangle', 0.07), 70);
}

export function sfxError() {
  beep(140, 0.12, 'sawtooth', 0.05);
  setTimeout(() => beep(110, 0.14, 'sawtooth', 0.045), 90);
}

export function sfxRush() {
  beep(330, 0.08, 'square', 0.04);
  setTimeout(() => beep(440, 0.1, 'square', 0.035), 60);
  setTimeout(() => beep(550, 0.12, 'square', 0.03), 140);
}

export function sfxTier() {
  beep(523, 0.07, 'sine', 0.06);
  setTimeout(() => beep(659, 0.07, 'sine', 0.055), 80);
  setTimeout(() => beep(784, 0.1, 'sine', 0.05), 160);
}

export function sfxRepair() {
  beep(400, 0.06, 'triangle', 0.055);
  setTimeout(() => beep(600, 0.08, 'triangle', 0.045), 55);
}

export function sfxTicket() {
  beep(880, 0.03, 'sine', 0.04);
  setTimeout(() => beep(1200, 0.04, 'sine', 0.035), 35);
}
