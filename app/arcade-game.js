/**
 * Arcade Empire — tycoon (room, cabinet upgrades, daily claw).
 */
import * as gameAudio from './game-audio.js';

const SAVE_KEY = 'arcade-empire-v2';
const UI_TAB_KEY = 'arcade-ui-tab';

function getActiveTab() {
  try {
    const t = sessionStorage.getItem(UI_TAB_KEY);
    if (t === 'home' || t === 'world' || t === 'shop') return t;
    if (t === 'floor') return 'world';
  } catch (_) {}
  return 'world';
}

function setActiveTab(tab) {
  try {
    sessionStorage.setItem(UI_TAB_KEY, tab);
  } catch (_) {}
}

/** Latest game state for the 3D world module (survives async init). */
const gameStateBag = { current: null };
let appRoot = null;
let world3dApi = null;

function nextFreeSlot(state) {
  const occ = new Set(state.machines.map((m) => m.slot));
  for (let i = 0; i < state.slotCount; i++) {
    if (!occ.has(i)) return i;
  }
  return state.machines.length;
}

function cancelPlacement(state, root) {
  if (!state.placementPending) return;
  state.placementPending = null;
  saveState(state);
  render(state, root);
}

function commitPlacement(state, root) {
  const pend = state.placementPending;
  if (!pend) return;
  const t = typeById(pend.typeId);
  if (!t || state.coins < t.cost) {
    toast('Not enough credits', true);
    return;
  }
  if (state.machines.length >= state.slotCount) {
    toast('Capacity full — expand in Home', true);
    return;
  }
  if (!world3dApi) {
    toast('3D world still loading — try again in a moment', true);
    return;
  }
  const g = world3dApi.getPlacementGhost?.();
  if (!g?.valid) {
    toast('Invalid spot — aim on open grass, away from other cabinets', true);
    return;
  }
  const slot = nextFreeSlot(state);
  state.coins -= t.cost;
  state.machines.push({
    id: uid(),
    typeId: pend.typeId,
    slot,
    wx: g.wx,
    wz: g.wz,
    broken: false,
    level: 1,
  });
  state.placementPending = null;
  saveState(state);
  gameAudio.sfxPlace();
  world3dApi?.placeBurst?.(g.wx, g.wz);
  toast(`${t.name} placed`);
  render(state, root);
}

async function ensureWorld3d() {
  const host = document.getElementById('world3dHost');
  if (!host) return;
  if (!world3dApi) {
    const { createArcadeWorld } = await import('./arcade-world-3d.js');
    world3dApi = createArcadeWorld(host, {
      getState: () => gameStateBag.current,
      getTagForTypeId: (id) => typeById(id)?.tag ?? 'casual',
      isWorldTabActive: () => getActiveTab() === 'world',
      onPlayerMoved: (p) => {
        const s = gameStateBag.current;
        if (!s) return;
        s.player = { x: p.x, z: p.z, ry: p.ry };
        saveState(s);
      },
    });
  }
  world3dApi.sync(gameStateBag.current);
  world3dApi.setActive(getActiveTab() === 'world');
  const joyHost = document.getElementById('worldTouchControls');
  if (joyHost && world3dApi.attachTouchJoystick) {
    world3dApi.attachTouchJoystick(joyHost);
  }
}

function formatShortNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(Math.floor(x));
}

function formatGdtWeekLine() {
  const d = new Date();
  const y = d.getUTCFullYear() % 100;
  const m = d.getUTCMonth() + 1;
  const w = Math.min(4, Math.ceil(d.getUTCDate() / 7));
  return `Y${y} M${m} W${w}`;
}

function fanCountFromState(state) {
  return Math.round(state.hype * 200 + state.machines.length * 400 + 800);
}

function syncHudStats(state) {
  const coins = `${Math.floor(state.coins)}¢`;
  document.querySelectorAll('[data-stat="coins"]').forEach((el) => {
    el.textContent = coins;
  });
  document.querySelectorAll('[data-stat="tickets"]').forEach((el) => {
    el.textContent = String(state.tickets);
  });
  document.querySelectorAll('[data-stat="hype"]').forEach((el) => {
    el.textContent = `${Math.round(state.hype)}%`;
  });
  document.querySelectorAll('[data-stat="comfort"]').forEach((el) => {
    el.textContent = `${Math.round(state.comfort)}%`;
  });
  document.querySelectorAll('[data-stat="coins-short"]').forEach((el) => {
    el.textContent = formatShortNumber(state.coins);
  });
  document.querySelectorAll('[data-stat="fans"]').forEach((el) => {
    el.textContent = formatShortNumber(fanCountFromState(state));
  });
  document.querySelectorAll('[data-stat="gdt-time"]').forEach((el) => {
    el.textContent = formatGdtWeekLine();
  });
  document.querySelectorAll('[data-stat="machines-n"]').forEach((el) => {
    el.textContent = String(state.machines.length);
  });
  document.querySelectorAll('[data-stat="bp-tier"]').forEach((el) => {
    el.textContent = String(state.bp.tier);
  });
  const bpPct = Math.min(100, (state.bp.tier / BP_MAX_TIER) * 100);
  document.querySelectorAll('[data-bp-bar]').forEach((el) => {
    el.style.width = `${bpPct}%`;
  });
}

export const ARCADE_DEVNET = {
  mint: 'G6V72JHHinX2JVRetdGuZzE4kdB7v6andgAZTYSAtH1i',
  decimals: 6,
  cluster: 'devnet',
};

function assetBase() {
  const b =
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL != null
      ? import.meta.env.BASE_URL
      : '/';
  return b.endsWith('/') ? b : `${b}/`;
}

/** @param {{ id: string, name: string } | undefined} t @param {'floor' | 'shop'} context */
function machineImageHtml(t, context) {
  if (!t?.id)
    return '<span class="machine-fallback" aria-hidden="true">?</span>';
  const src = `${assetBase()}machines/${t.id}.svg`;
  if (context === 'shop') {
    return `<img class="machine-thumb" src="${src}" alt="${escapeHtml(t.name)}" width="56" height="70" loading="lazy" decoding="async" />`;
  }
  return `<img class="machine-img" src="${src}" alt="${escapeHtml(t.name)}" width="76" height="92" loading="lazy" decoding="async" />`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MACHINE_TYPES = [
  {
    id: 'pixelpit',
    name: 'Pixel Pit',
    cost: 45,
    income: 0.7,
    breakdown: 0.00018,
    tag: 'retro',
  },
  {
    id: 'thunderpin',
    name: 'Thunder Pinball',
    cost: 110,
    income: 1.35,
    breakdown: 0.00032,
    tag: 'retro',
  },
  {
    id: 'neonracer',
    name: 'Neon Racer',
    cost: 220,
    income: 2.2,
    breakdown: 0.0004,
    tag: 'racing',
  },
  {
    id: 'rhythm',
    name: 'Beat Cab',
    cost: 380,
    income: 3.1,
    breakdown: 0.00038,
    tag: 'rhythm',
  },
  {
    id: 'crane',
    name: 'Prize Crane',
    cost: 650,
    income: 4.8,
    breakdown: 0.0005,
    tag: 'casual',
  },
  {
    id: 'vector',
    name: 'Vector Legends',
    cost: 1200,
    income: 8.5,
    breakdown: 0.00055,
    tag: 'retro',
  },
];

const SET_BONUS = {
  retro: { need: 3, mult: 1.12 },
  racing: { need: 2, mult: 1.08 },
};

const SLOT_MAX = 8;
const SLOT_EXPAND_COST = (n) => Math.floor(180 * Math.pow(1.75, n - 4));
const BP_XP_PER_TIER = 400;
const BP_MAX_TIER = 40;
const RUSH_DURATION_MS = 45_000;
const RUSH_COOLDOWN_MS = 120_000;
const CABINET_MAX_LEVEL = 10;
const LEVEL_INCOME_PER_LVL = 0.12;
const CLAW_PLAYS_PER_DAY = 5;
/** Set `false` for production — removes the daily claw cap. */
const CLAW_UNLIMITED_TEST = true;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    let raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem('arcade-empire-v1');
      if (legacy) {
        raw = legacy;
        try {
          localStorage.setItem(SAVE_KEY, legacy);
        } catch (_) {}
      }
    }
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function defaultWorldPosForSlot(slot, slotCount) {
  const n = Math.max(4, slotCount);
  const cols = Math.ceil(Math.sqrt(n));
  const row = Math.floor(slot / cols);
  const col = slot % cols;
  const spacing = 6.5;
  const ox = (-(cols - 1) * spacing) / 2;
  const oz = -6;
  return { wx: ox + col * spacing, wz: oz + row * spacing };
}

function defaultState() {
  return {
    coins: 120,
    tickets: 2,
    hype: 52,
    comfort: 72,
    slotCount: 4,
    machines: [],
    /** Third-person avatar position on the open map */
    player: { x: 0, z: 14, ry: 0 },
    /** When set, shop purchase waits for a spot on the ground */
    placementPending: null,
    lastTick: Date.now(),
    rushEnd: 0,
    rushCooldownUntil: 0,
    claw: { day: todayStr(), plays: 0 },
    bp: {
      xp: 0,
      tier: 0,
      premium: false,
      claimedFree: {},
      claimedPremium: {},
      lastLoginDay: '',
      streak: 0,
    },
    lifetimeEarned: 0,
  };
}

function mergeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const bpIn = raw.bp || {};
  const merged = {
    ...d,
    ...raw,
    bp: {
      ...d.bp,
      ...bpIn,
      claimedFree: { ...d.bp.claimedFree, ...(bpIn.claimedFree || {}) },
      claimedPremium: { ...d.bp.claimedPremium, ...(bpIn.claimedPremium || {}) },
    },
    machines: Array.isArray(raw.machines) ? raw.machines : [],
  };
  if (!merged.claw || typeof merged.claw !== 'object')
    merged.claw = { day: todayStr(), plays: 0 };
  if (typeof merged.claw.plays !== 'number')
    merged.claw.plays = merged.claw.uses ?? 0;
  if (!merged.player || typeof merged.player !== 'object')
    merged.player = { x: 0, z: 14, ry: 0 };
  if (merged.placementPending != null && typeof merged.placementPending !== 'object')
    merged.placementPending = null;
  for (const m of merged.machines) {
    if (m.level == null || m.level < 1) m.level = 1;
    if (m.level > CABINET_MAX_LEVEL) m.level = CABINET_MAX_LEVEL;
    if (m.wx == null || m.wz == null) {
      const slot = typeof m.slot === 'number' ? m.slot : 0;
      const p = defaultWorldPosForSlot(slot, merged.slotCount);
      m.wx = p.wx;
      m.wz = p.wz;
    }
  }
  return merged;
}

function ensureClawDay(state) {
  const d = todayStr();
  if (!state.claw) state.claw = { day: d, plays: 0 };
  if (state.claw.day !== d) {
    state.claw.day = d;
    state.claw.plays = 0;
  }
}

function typeById(id) {
  return MACHINE_TYPES.find((t) => t.id === id);
}

function levelMultiplier(level) {
  const lv = Math.max(1, Math.min(CABINET_MAX_LEVEL, level || 1));
  return 1 + (lv - 1) * LEVEL_INCOME_PER_LVL;
}

function machineBaseIncome(m) {
  const t = typeById(m.typeId);
  if (!t) return 0;
  return t.income * levelMultiplier(m.level);
}

function setMultiplier(machines) {
  const tags = {};
  for (const m of machines) {
    if (m.broken) continue;
    const t = typeById(m.typeId);
    if (t) tags[t.tag] = (tags[t.tag] || 0) + 1;
  }
  let mult = 1;
  for (const [tag, cfg] of Object.entries(SET_BONUS)) {
    if ((tags[tag] || 0) >= cfg.need) mult *= cfg.mult;
  }
  return mult;
}

function repairCost(typeId) {
  const t = typeById(typeId);
  return t ? Math.max(8, Math.floor(t.cost * 0.14)) : 10;
}

function upgradeCost(m) {
  const t = typeById(m.typeId);
  if (!t) return 999999;
  const lv = Math.min(CABINET_MAX_LEVEL, m.level || 1);
  if (lv >= CABINET_MAX_LEVEL) return 999999;
  return Math.floor(t.cost * (0.32 + lv * 0.14));
}

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = err ? 'toast toast--err' : 'toast toast--ok';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  if (err) gameAudio.sfxError();
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

let devnetConnection = null;

function getSolana() {
  return typeof window !== 'undefined' ? window.solana : null;
}

function getWeb3() {
  return typeof window !== 'undefined' ? window.solanaWeb3 : null;
}

async function refreshWalletArcade(state) {
  const w3 = getWeb3();
  const s = getSolana();
  const el = document.getElementById('walletArcadeBal');
  if (!el) return;
  if (!w3 || !s?.publicKey) {
    el.textContent = '—';
    return;
  }
  try {
    if (!devnetConnection)
      devnetConnection = new w3.Connection(w3.clusterApiUrl('devnet'), 'confirmed');
    const mint = new w3.PublicKey(ARCADE_DEVNET.mint);
    const accounts = await devnetConnection.getParsedTokenAccountsByOwner(
      s.publicKey,
      { mint },
      'confirmed',
    );
    let total = 0n;
    for (const { account } of accounts.value) {
      const amt = account.data.parsed?.info?.tokenAmount?.amount;
      if (amt != null) total += BigInt(amt);
    }
    const div = 10n ** BigInt(ARCADE_DEVNET.decimals);
    const whole = total / div;
    const frac = total % div;
    const fracStr = frac.toString().padStart(ARCADE_DEVNET.decimals, '0').replace(/0+$/, '') || '0';
    el.textContent =
      total === 0n
        ? '0'
        : frac === 0n
          ? whole.toString()
          : `${whole}.${fracStr.slice(0, 4)}`;
  } catch {
    el.textContent = '?';
  }
}

function tick(state) {
  ensureClawDay(state);
  const now = Date.now();
  let dt = (now - state.lastTick) / 1000;
  if (dt > 120) dt = 120;
  if (dt <= 0) {
    state.lastTick = now;
    return;
  }
  state.lastTick = now;

  const rush = now < state.rushEnd;
  const rushMult = rush ? 2.1 : 1;
  const hypeMult = 0.55 + (state.hype / 100) * 0.95;
  const comfortFactor = 1 + ((100 - state.comfort) / 250);
  const setMult = setMultiplier(state.machines);

  let income = 0;
  for (const m of state.machines) {
    if (m.broken) continue;
    const t = typeById(m.typeId);
    if (!t) continue;
    const lvMult = levelMultiplier(m.level);
    income += t.income * lvMult * hypeMult * rushMult * setMult;
    const br = t.breakdown / Math.max(0.85, Math.sqrt(lvMult));
    if (Math.random() < br * comfortFactor * dt) {
      m.broken = true;
      toast(`${t.name} needs service`, true);
    }
  }

  const gained = income * dt;
  state.coins += gained;
  state.lifetimeEarned += gained;

  state.bp.xp += gained * 0.22;
  while (state.bp.tier < BP_MAX_TIER && state.bp.xp >= BP_XP_PER_TIER * (state.bp.tier + 1)) {
    state.bp.tier += 1;
    gameAudio.sfxTier();
    toast(`Battle pass tier ${state.bp.tier}!`);
  }

  if (Math.random() < 0.012 * dt && !rush) {
    state.tickets += 1;
    gameAudio.sfxTicket();
    toast('Bonus ticket!');
  }

  state.hype = Math.max(20, Math.min(100, state.hype + (rush ? 0.04 : -0.02) * dt));
  state.comfort = Math.max(35, Math.min(100, state.comfort - 0.014 * dt * state.machines.filter((m) => !m.broken).length));
  saveState(state);
}

const CLAW_PIT_COLORS = ['#ec4899', '#f59e0b', '#10b981'];
/** Gantry travel (matches perspective rail; viewBox 360 wide). */
const CLAW_SVG_X_MIN = 84;
const CLAW_SVG_X_MAX = 276;
/** Orb centers on the perspective prize row (SVG X). */
const CLAW_BALL_CX = [112, 180, 248];
/** Prize pile sits ~this depth (0 = front glass, 1 = back wall). */
const CLAW_Z_ORB_PLANE = 0.5;
/** Max combined (side + depth) miss distance before a grab attempt fails outright. */
const CLAW_GRAB_MAX_DIST = 40;
/** How many horizontal SVG units one unit of Z “error” counts as (slightly forgiving). */
const CLAW_DEPTH_TO_PX = 28;
/** Gantry Y at front / back (viewBox coords; smaller Y = deeper into cabinet). */
const CLAW_GANTRY_Y_FRONT = 64;
const CLAW_GANTRY_Y_BACK = 44;
/** Subtle depth scale so the claw reads smaller toward the back wall. */
const CLAW_GANTRY_SCALE_FRONT = 1;
const CLAW_GANTRY_SCALE_BACK = 0.88;

/**
 * Realistic grab: side + depth must line up with the orb plane; still not guaranteed.
 * @returns {{ caught: boolean, prizeIdx: number, dist: number, kind: 'win' | 'slip' | 'wide' }}
 */
function resolveClawCatch(clawX, clawZ) {
  let prizeIdx = 0;
  let horiz = Infinity;
  CLAW_BALL_CX.forEach((cx, i) => {
    const d = Math.abs(clawX - cx);
    if (d < horiz) {
      horiz = d;
      prizeIdx = i;
    }
  });
  const depthMiss = Math.abs(clawZ - CLAW_Z_ORB_PLANE);
  const effectiveDist = Math.hypot(horiz, depthMiss * CLAW_DEPTH_TO_PX);
  if (effectiveDist > CLAW_GRAB_MAX_DIST) {
    return { caught: false, prizeIdx, dist: effectiveDist, kind: 'wide' };
  }
  const align = 1 - effectiveDist / CLAW_GRAB_MAX_DIST;
  const pSuccess = 0.1 + 0.8 * align ** 1.25;
  if (Math.random() < pSuccess) {
    return { caught: true, prizeIdx, dist: effectiveDist, kind: 'win' };
  }
  return { caught: false, prizeIdx, dist: effectiveDist, kind: 'slip' };
}

function rollClawReward(prizeIdx) {
  const prizeBall = CLAW_PIT_COLORS[prizeIdx];
  const r = Math.random();
  if (r < 0.28) {
    const credits = 55 + Math.floor(Math.random() * 280);
    return {
      prizeIdx,
      prizeBall,
      apply(s) {
        s.coins += credits;
      },
      title: 'Credit bundle',
      detail: `${credits} credits were added to your floor operating balance.`,
      chip: 'Economy',
    };
  }
  if (r < 0.52) {
    const n = 1 + Math.floor(Math.random() * 3);
    return {
      prizeIdx,
      prizeBall,
      apply(s) {
        s.tickets += n;
      },
      title: 'Admission tickets',
      detail: `${n} ticket${n > 1 ? 's are' : ' is'} now available for rush events and upgrades.`,
      chip: 'Access',
    };
  }
  if (r < 0.68) {
    const bump = 6 + Math.floor(Math.random() * 8);
    return {
      prizeIdx,
      prizeBall,
      apply(s) {
        s.hype = Math.min(100, s.hype + bump);
      },
      title: 'Crowd pull',
      detail: `Foot traffic interest increased by ${bump} points. Revenue modifiers improved.`,
      chip: 'Marketing',
    };
  }
  if (r < 0.84) {
    const bump = 5 + Math.floor(Math.random() * 8);
    return {
      prizeIdx,
      prizeBall,
      apply(s) {
        s.comfort = Math.min(100, s.comfort + bump);
      },
      title: 'Facility upgrade kit',
      detail: `Guest comfort rose ${bump} points. Equipment stress scales down slightly.`,
      chip: 'Operations',
    };
  }
  if (r < 0.94) {
    const credits = 120 + Math.floor(Math.random() * 200);
    return {
      prizeIdx,
      prizeBall,
      apply(s) {
        s.coins += credits;
        s.tickets += 1;
      },
      title: 'Premium pull',
      detail: `${credits} credits plus one bonus ticket — strong session outcome.`,
      chip: 'Jackpot',
    };
  }
  return {
    prizeIdx,
    prizeBall,
    apply(s) {
      s.tickets += 4;
      s.bp.xp += 120;
    },
    title: 'Limited collectible',
    detail: 'Rare prize: four tickets and a season-pass XP boost.',
    chip: 'Rare',
  };
}

function clawSvgMarkup() {
  const [c0, c1, c2] = CLAW_PIT_COLORS;
  return `
    <svg class="claw-svg" viewBox="0 0 412 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="clawPillarL" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#7f1d1d"/><stop offset="38%" stop-color="#f87171"/><stop offset="100%" stop-color="#b91c1c"/>
        </linearGradient>
        <linearGradient id="clawPillarR" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#7f1d1d"/><stop offset="38%" stop-color="#f87171"/><stop offset="100%" stop-color="#b91c1c"/>
        </linearGradient>
        <linearGradient id="clawArchGrad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#ef4444"/><stop offset="100%" stop-color="#991b1b"/>
        </linearGradient>
        <linearGradient id="clawVoid" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#1c1917"/><stop offset="55%" stop-color="#0f0e0d"/><stop offset="100%" stop-color="#050403"/>
        </linearGradient>
        <linearGradient id="clawWallLeft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#3d2525"/><stop offset="100%" stop-color="#1c1212"/>
        </linearGradient>
        <linearGradient id="clawWallRight" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#3d2525"/><stop offset="100%" stop-color="#1c1212"/>
        </linearGradient>
        <linearGradient id="clawFloor3d" x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" stop-color="#4a3d32"/><stop offset="45%" stop-color="#2d241c"/><stop offset="100%" stop-color="#1a1512"/>
        </linearGradient>
        <linearGradient id="clawCeil3d" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#2a2420"/><stop offset="100%" stop-color="#151210"/>
        </linearGradient>
        <radialGradient id="clawInteriorVignette" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stop-color="rgba(40,35,32,0.45)"/><stop offset="70%" stop-color="rgba(10,8,8,0.2)"/><stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
        </radialGradient>
        <clipPath id="clawChamberClip">
          <rect x="30" y="82" width="300" height="202" rx="9"/>
        </clipPath>
        <linearGradient id="clawRailMetal" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#f4f4f5"/><stop offset="45%" stop-color="#a1a1aa"/><stop offset="100%" stop-color="#52525b"/>
        </linearGradient>
        <linearGradient id="clawChromeClaw" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ecfeff"/><stop offset="45%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#0e7490"/>
        </linearGradient>
        <linearGradient id="clawCordGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#164e63"/><stop offset="35%" stop-color="#67e8f9"/><stop offset="50%" stop-color="#a5f3fc"/><stop offset="65%" stop-color="#67e8f9"/><stop offset="100%" stop-color="#164e63"/>
        </linearGradient>
        <radialGradient id="clawBallBlue" cx="32%" cy="28%" r="68%">
          <stop offset="0%" stop-color="#bae6fd"/><stop offset="45%" stop-color="#0284c7"/><stop offset="100%" stop-color="#0c4a6e"/>
        </radialGradient>
        <linearGradient id="clawAcrylicSheen" x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.14)"/><stop offset="25%" stop-color="rgba(255,255,255,0.02)"/><stop offset="55%" stop-color="rgba(255,255,255,0)"/><stop offset="85%" stop-color="rgba(180,200,230,0.06)"/><stop offset="100%" stop-color="rgba(255,255,255,0.05)"/>
        </linearGradient>
        <radialGradient id="clawOrb0" cx="30%" cy="26%" r="72%"><stop offset="0%" stop-color="#fff1f2"/><stop offset="35%" stop-color="${c0}"/><stop offset="85%" stop-color="#881337"/><stop offset="100%" stop-color="#4c0519"/></radialGradient>
        <radialGradient id="clawOrb1" cx="30%" cy="26%" r="72%"><stop offset="0%" stop-color="#fffbeb"/><stop offset="35%" stop-color="${c1}"/><stop offset="85%" stop-color="#b45309"/><stop offset="100%" stop-color="#78350f"/></radialGradient>
        <radialGradient id="clawOrb2" cx="30%" cy="26%" r="72%"><stop offset="0%" stop-color="#ecfdf5"/><stop offset="35%" stop-color="${c2}"/><stop offset="85%" stop-color="#047857"/><stop offset="100%" stop-color="#022c22"/></radialGradient>
        <filter id="clawOrbShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="5" stdDeviation="3" flood-opacity="0.55"/>
        </filter>
        <filter id="clawCabShadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="10" stdDeviation="8" flood-opacity="0.5"/>
        </filter>
        <filter id="clawLedGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="clawBulbW" cx="35%" cy="35%" r="55%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#94a3b8"/>
        </radialGradient>
        <radialGradient id="clawBulbA" cx="35%" cy="35%" r="55%">
          <stop offset="0%" stop-color="#fef9c3"/><stop offset="50%" stop-color="#fbbf24"/><stop offset="100%" stop-color="#d97706"/>
        </radialGradient>
        <filter id="clawMarqueeGlow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="clawNeonStrip" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#c084fc"/><stop offset="45%" stop-color="#818cf8"/><stop offset="100%" stop-color="#38bdf8"/>
        </linearGradient>
        <filter id="clawNeonGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="clawBackFog" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#9ca3af"/><stop offset="55%" stop-color="#64748b"/><stop offset="100%" stop-color="#475569"/>
        </linearGradient>
      </defs>
      <!-- Arcade booth shell (reference: candy-red pillars + vertical marquee strands) -->
      <rect width="412" height="320" fill="#0a0610"/>
      <g filter="url(#clawCabShadow)">
        <path d="M 0 320 L 46 52 L 72 52 L 12 320 Z" fill="url(#clawPillarL)" stroke="#450a0a" stroke-width="0.5"/>
        <path d="M 412 320 L 366 52 L 340 52 L 400 320 Z" fill="url(#clawPillarR)" stroke="#450a0a" stroke-width="0.5"/>
        <path d="M 46 52 L 366 52 L 352 36 L 60 36 Z" fill="url(#clawArchGrad)" stroke="#7f1d1d" stroke-width="0.75"/>
      </g>
      <g filter="url(#clawMarqueeGlow)">
        <circle cx="54" cy="98" r="3.2" fill="url(#clawBulbW)"/><circle cx="54" cy="122" r="3.2" fill="url(#clawBulbA)"/><circle cx="54" cy="146" r="3.2" fill="url(#clawBulbW)"/><circle cx="54" cy="170" r="3.2" fill="url(#clawBulbA)"/>
        <circle cx="54" cy="194" r="3.2" fill="url(#clawBulbW)"/><circle cx="54" cy="218" r="3.2" fill="url(#clawBulbA)"/><circle cx="54" cy="242" r="3.2" fill="url(#clawBulbW)"/><circle cx="54" cy="266" r="3.2" fill="url(#clawBulbA)"/>
        <circle cx="66" cy="110" r="2.6" fill="url(#clawBulbA)"/><circle cx="66" cy="134" r="2.6" fill="url(#clawBulbW)"/><circle cx="66" cy="158" r="2.6" fill="url(#clawBulbA)"/><circle cx="66" cy="182" r="2.6" fill="url(#clawBulbW)"/>
        <circle cx="66" cy="206" r="2.6" fill="url(#clawBulbA)"/><circle cx="66" cy="230" r="2.6" fill="url(#clawBulbW)"/><circle cx="66" cy="254" r="2.6" fill="url(#clawBulbA)"/>
        <circle cx="358" cy="98" r="3.2" fill="url(#clawBulbW)"/><circle cx="358" cy="122" r="3.2" fill="url(#clawBulbA)"/><circle cx="358" cy="146" r="3.2" fill="url(#clawBulbW)"/><circle cx="358" cy="170" r="3.2" fill="url(#clawBulbA)"/>
        <circle cx="358" cy="194" r="3.2" fill="url(#clawBulbW)"/><circle cx="358" cy="218" r="3.2" fill="url(#clawBulbA)"/><circle cx="358" cy="242" r="3.2" fill="url(#clawBulbW)"/><circle cx="358" cy="266" r="3.2" fill="url(#clawBulbA)"/>
        <circle cx="346" cy="110" r="2.6" fill="url(#clawBulbA)"/><circle cx="346" cy="134" r="2.6" fill="url(#clawBulbW)"/><circle cx="346" cy="158" r="2.6" fill="url(#clawBulbA)"/><circle cx="346" cy="182" r="2.6" fill="url(#clawBulbW)"/>
        <circle cx="346" cy="206" r="2.6" fill="url(#clawBulbA)"/><circle cx="346" cy="230" r="2.6" fill="url(#clawBulbW)"/><circle cx="346" cy="254" r="2.6" fill="url(#clawBulbA)"/>
      </g>
      <!-- Window gasket -->
      <rect x="18" y="74" width="318" height="222" rx="12" fill="#171717"/>
      <rect x="22" y="82" width="310" height="210" rx="10" fill="#0a0a0a" stroke="#27272a" stroke-width="1"/>
      <!-- Perspective chamber inside glass (fixed eye point — not a tilted texture) -->
      <g clip-path="url(#clawChamberClip)">
        <rect x="30" y="82" width="300" height="202" fill="url(#clawVoid)"/>
        <!-- Ceiling plane (recedes toward back) -->
        <path d="M 84 90 L 276 90 L 268 102 L 92 102 Z" fill="url(#clawCeil3d)" opacity="0.92"/>
        <path d="M 84 90 L 276 90" stroke="rgba(255,255,255,0.08)" stroke-width="0.75"/>
        <!-- Back wall: dark + frosted gray “glass depth” -->
        <path d="M 92 102 L 268 102 L 264 174 L 96 174 Z" fill="#0f1218"/>
        <path d="M 92 102 L 268 102 L 264 174 L 96 174 Z" fill="url(#clawBackFog)" opacity="0.38"/>
        <!-- Side walls (box corners) -->
        <path d="M 32 86 L 92 102 L 96 174 L 48 258 L 34 246 Z" fill="url(#clawWallLeft)"/>
        <path d="M 328 86 L 268 102 L 264 174 L 312 258 L 326 246 Z" fill="url(#clawWallRight)"/>
        <path d="M 30 86 L 92 102" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
        <path d="M 328 86 L 268 102" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
        <!-- Floor plane (trapezoid — wide toward player) -->
        <path d="M 40 262 L 320 262 L 264 174 L 96 174 Z" fill="url(#clawFloor3d)"/>
        <path d="M 96 174 L 264 174 L 320 262" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" opacity="0.7"/>
        <!-- Prize drop chute (left wall — draw after floor so it stays visible) -->
        <path d="M 40 232 L 58 227 L 60 256 L 44 262 Z" fill="#292524" stroke="#dc2626" stroke-width="2" stroke-linejoin="round"/>
        <path d="M 46 236 L 54 234 L 55 248 L 48 251 Z" fill="#1c1917" opacity="0.85"/>
        <!-- Neon rim (purple / blue, reference) -->
        <path d="M 40 262 L 320 262" fill="none" stroke="url(#clawNeonStrip)" stroke-width="5" stroke-linecap="round" filter="url(#clawNeonGlow)" opacity="0.85"/>
        <path d="M 42 258 L 318 258" fill="none" stroke="url(#clawNeonStrip)" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
        <path d="M 46 258 L 48 236 L 34 246" fill="none" stroke="#a855f7" stroke-width="2" opacity="0.5" filter="url(#clawNeonGlow)"/>
        <path d="M 314 258 L 312 236 L 326 246" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.5" filter="url(#clawNeonGlow)"/>
        <!-- Carpet / pile mass -->
        <ellipse cx="180" cy="232" rx="118" ry="22" fill="#2d241c" transform="skewX(-6)"/>
        <ellipse cx="180" cy="225" rx="108" ry="17" fill="#393028" opacity="0.92" transform="skewX(-5)"/>
        <ellipse cx="180" cy="218" rx="92" ry="11" fill="#4a3f36" opacity="0.7" transform="skewX(-4)"/>
        <ellipse cx="180" cy="212" rx="76" ry="7" fill="rgba(168,85,247,0.07)" transform="skewX(-3)"/>
        <!-- Dense blue prize bed -->
        <g opacity="0.92">
          <ellipse cx="58" cy="254" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="58" cy="247" r="8" fill="url(#clawBallBlue)"/>
          <ellipse cx="88" cy="258" rx="11" ry="5" fill="#0c4a6e"/><circle cx="88" cy="250" r="9" fill="url(#clawBallBlue)"/>
          <ellipse cx="118" cy="259" rx="11" ry="5" fill="#0c4a6e"/><circle cx="118" cy="251" r="9" fill="url(#clawBallBlue)"/>
          <ellipse cx="148" cy="260" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="148" cy="252" r="8.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="178" cy="261" rx="11" ry="5" fill="#0c4a6e"/><circle cx="178" cy="253" r="9" fill="url(#clawBallBlue)"/>
          <ellipse cx="208" cy="260" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="208" cy="252" r="8.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="238" cy="259" rx="11" ry="5" fill="#0c4a6e"/><circle cx="238" cy="251" r="9" fill="url(#clawBallBlue)"/>
          <ellipse cx="268" cy="258" rx="11" ry="5" fill="#0c4a6e"/><circle cx="268" cy="250" r="9" fill="url(#clawBallBlue)"/>
          <ellipse cx="298" cy="256" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="298" cy="248" r="8" fill="url(#clawBallBlue)"/>
          <ellipse cx="328" cy="252" rx="9" ry="4" fill="#0c4a6e"/><circle cx="328" cy="246" r="7.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="72" cy="242" rx="9" ry="4" fill="#0c4a6e"/><circle cx="72" cy="236" r="7.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="102" cy="246" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="102" cy="239" r="8" fill="url(#clawBallBlue)"/>
          <ellipse cx="134" cy="248" rx="9" ry="4" fill="#0c4a6e"/><circle cx="134" cy="242" r="7.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="196" cy="249" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="196" cy="242" r="8" fill="url(#clawBallBlue)"/>
          <ellipse cx="254" cy="247" rx="9" ry="4" fill="#0c4a6e"/><circle cx="254" cy="241" r="7.5" fill="url(#clawBallBlue)"/>
          <ellipse cx="286" cy="244" rx="10" ry="4.5" fill="#0c4a6e"/><circle cx="286" cy="238" r="8" fill="url(#clawBallBlue)"/>
          <ellipse cx="314" cy="240" rx="8" ry="3.5" fill="#0c4a6e"/><circle cx="314" cy="235" r="6.5" fill="url(#clawBallBlue)"/>
        </g>
        <!-- Decor plush pile (reference-style heap) -->
        <g class="claw-decor-plush" opacity="0.95">
          <g transform="translate(96,218)">
            <ellipse cx="0" cy="12" rx="13" ry="11" fill="#78350f"/><circle cx="0" cy="-1" r="10" fill="#b45309"/>
            <polygon points="-8,-11 -5,-20 -2,-11" fill="#b45309"/><polygon points="8,-11 5,-20 2,-11" fill="#b45309"/>
            <circle cx="-3" cy="-3" r="1.8" fill="#1f2937"/><circle cx="3" cy="-3" r="1.8" fill="#1f2937"/>
          </g>
          <g transform="translate(138,224)">
            <ellipse cx="0" cy="11" rx="14" ry="12" fill="#be185d"/><circle cx="0" cy="-2" r="11" fill="#f472b6"/>
            <polygon points="-9,-12 -6,-22 -2,-12" fill="#f472b6"/><polygon points="9,-12 6,-22 2,-12" fill="#f472b6"/>
            <circle cx="-4" cy="-4" r="2" fill="#1f2937"/><circle cx="4" cy="-4" r="2" fill="#1f2937"/>
          </g>
          <g transform="translate(220,220)">
            <ellipse cx="0" cy="12" rx="14" ry="11" fill="#047857"/><circle cx="0" cy="-1" r="10" fill="#34d399"/>
            <polygon points="-7,-10 -5,-18 -2,-10" fill="#34d399"/><polygon points="7,-10 5,-18 2,-10" fill="#34d399"/>
            <circle cx="-3" cy="-3" r="1.8" fill="#1f2937"/><circle cx="3" cy="-3" r="1.8" fill="#1f2937"/>
          </g>
          <g transform="translate(258,222)">
            <ellipse cx="0" cy="10" rx="12" ry="10" fill="#a16207"/><circle cx="0" cy="-2" r="9" fill="#facc15"/>
            <polygon points="-7,-11 -4,-19 -2,-11" fill="#facc15"/><polygon points="7,-11 4,-19 2,-11" fill="#facc15"/>
            <circle cx="-3" cy="-4" r="1.6" fill="#1f2937"/><circle cx="3" cy="-4" r="1.6" fill="#1f2937"/>
          </g>
          <g transform="translate(274,228) scale(0.85)">
            <ellipse cx="0" cy="10" rx="12" ry="10" fill="#5b21b6"/><circle cx="0" cy="-2" r="9" fill="#c084fc"/>
            <circle cx="-3" cy="-4" r="1.5" fill="#1f2937"/><circle cx="3" cy="-4" r="1.5" fill="#1f2937"/>
          </g>
          <g transform="translate(118,232) scale(0.78)">
            <ellipse cx="0" cy="9" rx="11" ry="9" fill="#0e7490"/><circle cx="0" cy="-1" r="8" fill="#22d3ee"/>
            <circle cx="-2.5" cy="-3" r="1.4" fill="#1f2937"/><circle cx="2.5" cy="-3" r="1.4" fill="#1f2937"/>
          </g>
        </g>
        <!-- Playable prize spheres -->
        <g class="claw-orbs" filter="url(#clawOrbShadow)">
          <g transform="translate(112,196) scale(0.94)"><ellipse cx="0" cy="14" rx="22" ry="10" fill="#1a1008" opacity="0.65"/><circle r="20" fill="url(#clawOrb0)"/><ellipse cx="-7" cy="-8" rx="9" ry="5" fill="rgba(255,255,255,0.5)"/></g>
          <g transform="translate(180,197)"><ellipse cx="0" cy="14" rx="22" ry="10" fill="#1a1008" opacity="0.65"/><circle r="20" fill="url(#clawOrb1)"/><ellipse cx="-7" cy="-8" rx="9" ry="5" fill="rgba(255,255,255,0.5)"/></g>
          <g transform="translate(248,196) scale(0.94)"><ellipse cx="0" cy="14" rx="22" ry="10" fill="#1a1008" opacity="0.65"/><circle r="20" fill="url(#clawOrb2)"/><ellipse cx="-7" cy="-8" rx="9" ry="5" fill="rgba(255,255,255,0.5)"/></g>
        </g>
        <rect x="30" y="82" width="300" height="202" fill="rgba(226,232,240,0.1)" pointer-events="none"/>
      </g>
      <rect x="30" y="82" width="300" height="202" rx="9" fill="url(#clawInteriorVignette)" pointer-events="none"/>
      <!-- Rail in perspective (narrower toward back) -->
      <path d="M 66 82 L 294 82 L 288 93 L 72 93 Z" fill="#1c1917" stroke="#44403c" stroke-width="0.75"/>
      <path d="M 70 84.5 L 290 84.5 L 285 90.5 L 75 90.5 Z" fill="url(#clawRailMetal)"/>
      <path d="M 72 86.5 L 286 86.5" stroke="rgba(255,255,255,0.4)" stroke-width="0.85"/>
      <!-- Claw (chrome, lit — draw above prizes) -->
      <g id="clawGantry" transform="translate(180, 56)">
        <g id="clawGantryScale">
          <ellipse cx="0" cy="140" rx="20" ry="6" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.55)" stroke-width="1"/>
          <rect x="-28" y="-12" width="56" height="20" rx="6" fill="url(#clawRailMetal)" stroke="#3f3f46" stroke-width="1"/>
          <circle cx="-16" cy="-4" r="2" fill="#27272a" stroke="#52525b" stroke-width="0.5"/>
          <circle cx="16" cy="-4" r="2" fill="#27272a" stroke="#52525b" stroke-width="0.5"/>
          <rect x="-14" y="8" width="28" height="7" rx="2" fill="#262626" stroke="#18181b" stroke-width="0.75"/>
          <circle cx="12" cy="-4" r="2.5" fill="#22d3ee" filter="url(#clawLedGlow)" opacity="0.95"/>
          <g id="clawRig" transform="translate(0, 14)">
            <g id="clawCordPack" style="transform-origin: 0 0">
              <line x1="-1.5" y1="0" x2="-1.5" y2="104" stroke="#44403c" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
              <line x1="1.5" y1="0" x2="1.5" y2="104" stroke="#44403c" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
              <line x1="0" y1="0" x2="0" y2="104" stroke="url(#clawCordGrad)" stroke-width="4.5" stroke-linecap="round"/>
              <g id="clawGrabber" transform="translate(0, 104)">
                <circle cx="0" cy="2" r="9" fill="url(#clawChromeClaw)" stroke="#64748b" stroke-width="0.75"/>
                <ellipse cx="-3" cy="-1" rx="3" ry="2" fill="rgba(255,255,255,0.35)"/>
                <rect x="-13" y="-2" width="26" height="11" rx="3" fill="#0e7490" stroke="url(#clawChromeClaw)" stroke-width="0.85"/>
                <g id="clawHookL" style="transform-origin: -13px 6px">
                  <path d="M -13 6 L -14 24 Q -14 29 -6 27 L -3 22" fill="none" stroke="url(#clawChromeClaw)" stroke-width="3.8" stroke-linecap="round"/>
                  <path d="M -13 6 L -14 24 Q -14 29 -6 27" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-linecap="round"/>
                </g>
                <g id="clawHookR" style="transform-origin: 13px 6px">
                  <path d="M 13 6 L 14 24 Q 14 29 6 27 L 3 22" fill="none" stroke="url(#clawChromeClaw)" stroke-width="3.8" stroke-linecap="round"/>
                  <path d="M 13 6 L 14 24 Q 14 29 6 27" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-linecap="round"/>
                </g>
                <circle id="clawCaughtOrb" r="0" cx="0" cy="19" opacity="0" fill="url(#clawOrb1)"/>
              </g>
            </g>
          </g>
        </g>
      </g>
      <!-- Acrylic / glass (reference: gray reflective panel) -->
      <rect x="30" y="82" width="300" height="202" rx="9" fill="rgba(148,163,184,0.09)" pointer-events="none"/>
      <rect x="30" y="82" width="300" height="202" rx="9" fill="url(#clawAcrylicSheen)" pointer-events="none"/>
      <rect x="30" y="82" width="300" height="202" rx="9" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.5" pointer-events="none"/>
      <path d="M 38 88 L 118 88 L 108 118 L 38 118 Z" fill="rgba(255,255,255,0.1)" pointer-events="none"/>
      <line x1="44" y1="92" x2="300" y2="198" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" pointer-events="none"/>
      <line x1="260" y1="95" x2="140" y2="205" stroke="rgba(255,255,255,0.05)" stroke-width="2.2" pointer-events="none"/>
    </svg>`;
}

async function openClawMachine(state, rerender) {
  ensureClawDay(state);
  if (!CLAW_UNLIMITED_TEST && state.claw.plays >= CLAW_PLAYS_PER_DAY) {
    toast('Daily claw plays are exhausted. Resets at midnight UTC.', true);
    return;
  }
  state.claw.plays += 1;
  saveState(state);
  rerender();

  const played = state.claw.plays;
  const overlay = document.createElement('div');
  overlay.className = 'modal-bg';
  let finished = false;
  let phase = 'aim';
  let clawX = (CLAW_SVG_X_MIN + CLAW_SVG_X_MAX) / 2;
  let clawZ = CLAW_Z_ORB_PLANE;

  overlay.innerHTML = `
    <div class="modal claw-modal" role="dialog" aria-modal="true" aria-labelledby="claw-heading">
      <div class="modal-inner">
        <h3 id="claw-heading">Prize claw</h3>
        <p class="claw-sub">${CLAW_UNLIMITED_TEST ? `Test play ${played} · 3/4 view shows depth in one shot. Optional edge taps for a straight side look; Front returns.` : `Play ${played} / ${CLAW_PLAYS_PER_DAY} · 3/4 view; edge taps optional; then GRAB.`}</p>
        <div class="claw-cabinet">
          <div class="claw-cabinet-bezel">
            <div class="claw-stage-wrap claw-stage-3d">
              <div class="claw-three-host" role="img" aria-label="3D claw machine: isometric-style view; optional side peeks on edges">
                <button type="button" class="claw-three-peek claw-three-peek-l" aria-label="Left depth view (pit from the side)">⟨</button>
                <button type="button" class="claw-three-peek claw-three-peek-r" aria-label="Right depth view (pit from the side)">⟩</button>
                <button type="button" class="claw-three-front" id="clawThreeViewFront" hidden aria-label="Return to front view">Front</button>
              </div>
            </div>
          </div>
          <div class="claw-cabinet-plate">
        <div class="claw-deck">
          <div class="claw-deck-row">
            <div class="claw-joystick" id="clawJoystick" role="application" aria-label="Drag to move the claw. Up and down: depth. Left and right: side.">
              <div class="claw-joystick-rim" aria-hidden="true"></div>
              <div class="claw-joystick-base" aria-hidden="true"></div>
              <div class="claw-joystick-movable">
                <div class="claw-joystick-arm">
                  <div class="claw-joystick-stick" aria-hidden="true"></div>
                  <div class="claw-joystick-knob" aria-hidden="true"></div>
                </div>
              </div>
              <div class="claw-joystick-hit" aria-hidden="true"></div>
            </div>
            <button type="button" class="claw-arcade-grab" id="clawDrop"><span class="claw-arcade-grab-ring" aria-hidden="true"></span><span class="claw-arcade-grab-face">GRAB</span></button>
          </div>
        </div>
          </div>
        </div>
        <p class="claw-hint-keys" style="font-size:0.75rem;color:var(--text-secondary);margin-top:8px">Joystick: drag to move · Keys: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> · <kbd>Space</kbd> / <kbd>Enter</kbd> GRAB</p>
        <p class="claw-status" style="min-height:1.2em;font-size:0.8125rem;color:var(--text-secondary);margin-top:10px"></p>
        <div class="claw-result">
          <div class="result-title"></div>
          <div class="result-body"></div>
          <span class="result-chip"></span>
        </div>
        <div class="claw-actions">
          <button type="button" class="btn-secondary" id="clawDone" disabled style="flex:1">Close</button>
        </div>
      </div>
    </div>
  `;

  const threeHost = overlay.querySelector('.claw-three-host');
  const peekL = threeHost?.querySelector?.('.claw-three-peek-l') ?? null;
  const peekR = threeHost?.querySelector?.('.claw-three-peek-r') ?? null;
  const peekFront = threeHost?.querySelector?.('#clawThreeViewFront') ?? null;
  let sceneApi = null;
  if (threeHost) {
    try {
      const { createClawScene3D } = await import('./claw-scene-3d.js');
      sceneApi = createClawScene3D(threeHost, {
        colors: CLAW_PIT_COLORS,
        ballCx: CLAW_BALL_CX,
        svgMin: CLAW_SVG_X_MIN,
        svgMax: CLAW_SVG_X_MAX,
        onViewMode(mode) {
          peekL?.classList.toggle('is-active', mode === 'left');
          peekR?.classList.toggle('is-active', mode === 'right');
          if (peekFront) peekFront.hidden = mode === 'front';
        },
      });
    } catch (_) {
      sceneApi = null;
    }
    if (!sceneApi) {
      threeHost.innerHTML = clawSvgMarkup();
    }
  }

  function clawPeekOk() {
    return sceneApi && phase !== 'dropping';
  }
  peekL?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clawPeekOk()) return;
    const m = sceneApi.getViewMode();
    sceneApi.setViewMode(m === 'left' ? 'front' : 'left');
  });
  peekR?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clawPeekOk()) return;
    const m = sceneApi.getViewMode();
    sceneApi.setViewMode(m === 'right' ? 'front' : 'right');
  });
  peekFront?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clawPeekOk()) return;
    sceneApi.setViewMode('front');
  });

  const gantry = overlay.querySelector('#clawGantry');
  const gantryScale = overlay.querySelector('#clawGantryScale');
  const cordPack = overlay.querySelector('#clawCordPack');
  const hookL = overlay.querySelector('#clawHookL');
  const hookR = overlay.querySelector('#clawHookR');
  const caughtOrbEl = overlay.querySelector('#clawCaughtOrb');
  const orbGroups = overlay.querySelectorAll('.claw-orbs > g');
  const dropBtn = overlay.querySelector('#clawDrop');
  const joyBase = overlay.querySelector('#clawJoystick');
  const joyHit = overlay.querySelector('.claw-joystick-hit');
  const joyArm = overlay.querySelector('.claw-joystick-arm');
  const statusEl = overlay.querySelector('.claw-status');
  const resultBox = overlay.querySelector('.claw-result');
  const doneBtn = overlay.querySelector('#clawDone');

  const svgReady =
    gantry &&
    cordPack &&
    hookL &&
    hookR &&
    caughtOrbEl &&
    orbGroups.length === 3 &&
    dropBtn;
  const mode3d = !!sceneApi;
  if (!mode3d && !svgReady) {
    const cr = resolveClawCatch(clawX, clawZ);
    if (cr.caught) {
      const fallback = rollClawReward(cr.prizeIdx);
      fallback.apply(state);
      saveState(state);
      toast(`Prize applied: ${fallback.title}`);
    } else {
      toast(cr.kind === 'wide' ? 'Claw missed (no prize).' : 'Prize slipped (no reward).', true);
    }
    rerender();
    return;
  }
  if (mode3d && !dropBtn) {
    sceneApi?.dispose();
    const cr = resolveClawCatch(clawX, clawZ);
    if (cr.caught) {
      const fallback = rollClawReward(cr.prizeIdx);
      fallback.apply(state);
      saveState(state);
      toast(`Prize applied: ${fallback.title}`);
    } else {
      toast('Claw UI failed to load.', true);
    }
    rerender();
    return;
  }

  const CORD_SCALE_RETRACT = 0.22;
  const CORD_SCALE_FULL = 1;
  const CORD_SCALE_RAISED = 0.32;
  const easeDrop = 'cubic-bezier(0.22, 1, 0.32, 1)';
  const easeLift = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const easeGrab = 'cubic-bezier(0.34, 1.25, 0.64, 1)';

  function applyClawPose() {
    clawX = Math.max(CLAW_SVG_X_MIN, Math.min(CLAW_SVG_X_MAX, clawX));
    clawZ = Math.max(0, Math.min(1, clawZ));
    if (mode3d) {
      sceneApi.setClawFromUi(clawX, clawZ);
    } else {
      const gy =
        CLAW_GANTRY_Y_FRONT -
        clawZ * (CLAW_GANTRY_Y_FRONT - CLAW_GANTRY_Y_BACK);
      const gs =
        CLAW_GANTRY_SCALE_FRONT -
        clawZ * (CLAW_GANTRY_SCALE_FRONT - CLAW_GANTRY_SCALE_BACK);
      gantry.setAttribute('transform', `translate(${clawX}, ${gy})`);
      if (gantryScale) gantryScale.setAttribute('transform', `scale(${gs})`);
    }
  }

  applyClawPose();

  function closeModal() {
    if (!finished) return;
    sceneApi?.dispose();
    overlay.remove();
    rerender();
  }

  doneBtn?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && finished) closeModal();
  });

  const JOY_RADIUS = 38;
  const joyMiddleX = (CLAW_SVG_X_MIN + CLAW_SVG_X_MAX) / 2;
  const joyHalfRangeX = (CLAW_SVG_X_MAX - CLAW_SVG_X_MIN) / 2;
  let joyActive = false;
  let joyCaptureEl = null;

  function joyRectCenter() {
    const el = joyHit || joyBase;
    if (!el) return { cx: 0, cy: 0 };
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  function applyJoyFromClient(clientX, clientY) {
    const { cx, cy } = joyRectCenter();
    let dx = clientX - cx;
    let dy = clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    const nx = JOY_RADIUS > 0 ? dx / JOY_RADIUS : 0;
    const ny = JOY_RADIUS > 0 ? dy / JOY_RADIUS : 0;
    clawX = joyMiddleX + nx * joyHalfRangeX * 0.94;
    clawZ = CLAW_Z_ORB_PLANE - ny * 0.44;
    applyClawPose();
    if (joyArm) {
      const angle = Math.atan2(dx, -dy);
      joyArm.style.transition = 'none';
      joyArm.style.transform = `rotate(${angle}rad)`;
    }
  }

  function joySnapCenter() {
    if (joyArm) {
      joyArm.style.transition =
        'transform 0.28s cubic-bezier(0.34, 1.45, 0.64, 1)';
      joyArm.style.transform = 'rotate(0rad)';
    }
  }

  function joyEnd(ev) {
    if (!joyActive) return;
    joyActive = false;
    try {
      if (ev && ev.pointerId != null && joyCaptureEl) {
        joyCaptureEl.releasePointerCapture(ev.pointerId);
      }
    } catch (_) {}
    joyCaptureEl = null;
    joySnapCenter();
  }

  const joySurface = joyHit || joyBase;
  if (joySurface && joyArm) {
    joySurface.addEventListener('pointerdown', (ev) => {
      if (phase !== 'aim' || finished) return;
      ev.preventDefault();
      joyActive = true;
      joyCaptureEl = joySurface;
      try {
        joySurface.setPointerCapture(ev.pointerId);
      } catch (_) {}
      applyJoyFromClient(ev.clientX, ev.clientY);
    });
    joySurface.addEventListener('pointermove', (ev) => {
      if (!joyActive) return;
      applyJoyFromClient(ev.clientX, ev.clientY);
    });
    joySurface.addEventListener('pointerup', joyEnd);
    joySurface.addEventListener('pointercancel', joyEnd);
    joySurface.addEventListener('lostpointercapture', () => {
      joyActive = false;
      joyCaptureEl = null;
      joySnapCenter();
    });
  }

  function onKey(ev) {
    if (phase !== 'aim') return;
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      clawX -= 5;
      applyClawPose();
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      clawX += 5;
      applyClawPose();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      clawZ -= 0.05;
      applyClawPose();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      clawZ += 0.05;
      applyClawPose();
    } else if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      dropBtn.click();
    }
  }
  window.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  dropBtn.focus();

  if (mode3d) {
    sceneApi.setCordRetracted();
  } else {
    cordPack.style.transform = `scaleY(${CORD_SCALE_RETRACT})`;
  }

  dropBtn.addEventListener('click', () => {
    if (phase !== 'aim') return;
    phase = 'dropping';
    if (mode3d) sceneApi.setViewMode('front');
    dropBtn.disabled = true;
    if (joyBase) joyBase.classList.add('claw-joystick--disabled');

    const catchRes = resolveClawCatch(clawX, clawZ);
    const prizeIdx = catchRes.prizeIdx;
    const outcome = catchRes.caught ? rollClawReward(prizeIdx) : null;

    (async () => {
      const showResult = (title, detail, chip) => {
        statusEl.textContent = '';
        resultBox.querySelector('.result-title').textContent = title;
        resultBox.querySelector('.result-body').textContent = detail;
        resultBox.querySelector('.result-chip').textContent = chip;
        resultBox.classList.add('visible');
        if (doneBtn) doneBtn.disabled = false;
        finished = true;
        phase = 'done';
        window.removeEventListener('keydown', onKey);
        rerender();
      };

      try {
        if (mode3d) {
          statusEl.textContent = 'Lowering claw…';
          await sceneApi.runDropAnimation(catchRes);
          if (!catchRes.caught) {
            sceneApi.resetAfterMiss();
            clawX = (CLAW_SVG_X_MIN + CLAW_SVG_X_MAX) / 2;
            clawZ = CLAW_Z_ORB_PLANE;
            statusEl.textContent = 'Returning home…';
            await sceneApi.returnArmToStart(clawX, clawZ);
            const missTitle = catchRes.kind === 'wide' ? 'Complete miss' : 'Slipped free';
            const missBody =
              catchRes.kind === 'wide'
                ? 'Off in side-to-side, depth, or both — the pile sits around mid-depth. Line up over a sphere in 3D before you drop.'
                : 'You had contact but the orb rolled out — classic claw behavior. Tighter alignment improves odds but never guarantees a win.';
            showResult(missTitle, missBody, 'No prize');
            return;
          }
          statusEl.textContent = 'Dispensing prize…';
          await sceneApi.playChuteDrop();
          statusEl.textContent = '';
          outcome.apply(state);
          saveState(state);
          showResult(outcome.title, outcome.detail, outcome.chip);
          return;
        }

        statusEl.textContent = 'Lowering claw…';
        await cordPack.animate(
          [
            { transform: `scaleY(${CORD_SCALE_RETRACT})` },
            { transform: `scaleY(${CORD_SCALE_FULL})` },
          ],
          { duration: 1050, easing: easeDrop, fill: 'forwards' },
        ).finished;
        cordPack.style.transform = `scaleY(${CORD_SCALE_FULL})`;

        statusEl.textContent = 'Closing grabber…';
        await Promise.all([
          hookL.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(22deg)' }],
            { duration: 340, easing: easeGrab, fill: 'forwards' },
          ).finished,
          hookR.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)' }],
            { duration: 340, easing: easeGrab, fill: 'forwards' },
          ).finished,
        ]);
        hookL.style.transform = 'rotate(22deg)';
        hookR.style.transform = 'rotate(-22deg)';

        if (!catchRes.caught) {
          statusEl.textContent =
            catchRes.kind === 'wide'
              ? 'Nothing solid under the claw…'
              : 'Almost… slipping…';
          await new Promise((r) => setTimeout(r, catchRes.kind === 'wide' ? 420 : 520));
          statusEl.textContent =
            catchRes.kind === 'wide' ? 'Lifting out empty.' : 'Lost the grip.';
          await Promise.all([
            hookL.animate(
              [{ transform: 'rotate(22deg)' }, { transform: 'rotate(6deg)' }],
              { duration: 260, easing: easeLift, fill: 'forwards' },
            ).finished,
            hookR.animate(
              [{ transform: 'rotate(-22deg)' }, { transform: 'rotate(-6deg)' }],
              { duration: 260, easing: easeLift, fill: 'forwards' },
            ).finished,
          ]);
          hookL.style.transform = 'rotate(6deg)';
          hookR.style.transform = 'rotate(-6deg)';
          caughtOrbEl.setAttribute('r', '0');
          caughtOrbEl.setAttribute('opacity', '0');
          orbGroups.forEach((g) => {
            g.style.opacity = '1';
          });
          statusEl.textContent = 'Retracting…';
          await cordPack.animate(
            [
              { transform: `scaleY(${CORD_SCALE_FULL})` },
              { transform: `scaleY(${CORD_SCALE_RAISED})` },
            ],
            { duration: 920, easing: easeLift, fill: 'forwards' },
          ).finished;
          cordPack.style.transform = `scaleY(${CORD_SCALE_RAISED})`;
          clawX = (CLAW_SVG_X_MIN + CLAW_SVG_X_MAX) / 2;
          clawZ = CLAW_Z_ORB_PLANE;
          applyClawPose();
          const missTitle = catchRes.kind === 'wide' ? 'Complete miss' : 'Slipped free';
          const missBody =
            catchRes.kind === 'wide'
              ? 'Off in side-to-side, depth, or both — the pile sits around mid-depth. Line up over a sphere in 3D before you drop.'
              : 'You had contact but the orb rolled out — classic claw behavior. Tighter alignment improves odds but never guarantees a win.';
          showResult(missTitle, missBody, 'No prize');
          return;
        }

        const gradId = `clawOrb${prizeIdx}`;
        caughtOrbEl.setAttribute('fill', `url(#${gradId})`);
        caughtOrbEl.setAttribute('r', '14');
        caughtOrbEl.setAttribute('opacity', '1');

        orbGroups.forEach((g, i) => {
          g.style.opacity = i === prizeIdx ? '1' : '0.38';
        });

        statusEl.textContent = 'Raising prize…';
        await cordPack.animate(
          [
            { transform: `scaleY(${CORD_SCALE_FULL})` },
            { transform: `scaleY(${CORD_SCALE_RAISED})` },
          ],
          { duration: 920, easing: easeLift, fill: 'forwards' },
        ).finished;
        cordPack.style.transform = `scaleY(${CORD_SCALE_RAISED})`;

        outcome.apply(state);
        saveState(state);

        showResult(outcome.title, outcome.detail, outcome.chip);
      } catch (err) {
        if (outcome) {
          outcome.apply(state);
          saveState(state);
          showResult(outcome.title, outcome.detail, outcome.chip);
        } else {
          finished = true;
          phase = 'done';
          window.removeEventListener('keydown', onKey);
          if (doneBtn) doneBtn.disabled = false;
          statusEl.textContent = '';
          rerender();
        }
      }
    })();
  });
}

function claimBp(state, tier, track) {
  const key = String(tier);
  if (track === 'premium' && !state.bp.premium) {
    toast('Premium not enabled (placeholder).', true);
    return;
  }
  const bag = track === 'premium' ? state.bp.claimedPremium : state.bp.claimedFree;
  if (bag[key]) {
    toast('Already claimed.', true);
    return;
  }
  if (state.bp.tier < tier) {
    toast('Tier not reached yet.', true);
    return;
  }
  bag[key] = true;
  const freeRewards = {
    1: () => {
      state.coins += 200;
      state.tickets += 2;
    },
    3: () => {
      state.tickets += 4;
      state.hype = Math.min(100, state.hype + 8);
    },
    5: () => {
      state.coins += 600;
      state.comfort = Math.min(100, state.comfort + 10);
    },
    8: () => {
      state.tickets += 8;
    },
    10: () => {
      state.coins += 2000;
    },
    15: () => {
      state.hype = 100;
      state.tickets += 5;
    },
    20: () => {
      state.coins += 8000;
    },
  };
  const premRewards = {
    1: () => {
      state.coins += 500;
      state.tickets += 5;
    },
    5: () => {
      state.coins += 3500;
    },
    10: () => {
      state.tickets += 25;
    },
    15: () => {
      state.comfort = 100;
    },
  };
  if (track === 'free' && freeRewards[tier]) freeRewards[tier]();
  if (track === 'premium') {
    if (premRewards[tier]) premRewards[tier]();
    else {
      state.coins += tier * 80;
      state.tickets += 2;
    }
  }
  toast(track === 'premium' ? `Premium tier ${tier} claimed` : `Free tier ${tier} claimed`);
  saveState(state);
}

function openBattlePassModal(state, rerender) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const tiers = [1, 3, 5, 8, 10, 15, 20];
  bg.innerHTML = `
    <div class="modal">
      <button class="close" type="button">Close</button>
      <h3>Season pass</h3>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;">
        Earn XP from floor revenue. Unlock tiers to claim structured rewards.
      </p>
      <div class="progress"><i style="width:${Math.min(100, (state.bp.tier / BP_MAX_TIER) * 100)}%"></i></div>
      <p style="font-size:0.75rem;color:var(--text-secondary);">Tier ${state.bp.tier} / ${BP_MAX_TIER} · XP ${Math.floor(state.bp.xp)}</p>
      <div class="bp-track" id="bpTrack"></div>
    </div>
  `;
  const trackEl = bg.querySelector('#bpTrack');
  for (const t of tiers) {
    const row = document.createElement('div');
    const freeClaimed = state.bp.claimedFree[String(t)];
    row.className =
      'bp-tier' + (state.bp.tier >= t ? ' active' : '') + (freeClaimed ? ' claimed' : '');
    row.innerHTML = `
      <span>T${t}</span>
      <span style="flex:1;color:var(--text-secondary)">Credits, tickets & room buffs</span>
      <button type="button" data-free="${t}">Free</button>
      <button type="button" data-prem="${t}" ${state.bp.premium ? '' : 'disabled'}>Premium</button>
    `;
    trackEl.appendChild(row);
  }
  if (!state.bp.premium) {
    const hint = document.createElement('p');
    hint.style.cssText = 'margin-top:12px;font-size:0.75rem;color:var(--text-secondary)';
    hint.textContent =
      'Premium track will connect to checkout or NFT gate. Enable bp.premium in save data for QA.';
    bg.querySelector('.modal').appendChild(hint);
  }
  bg.querySelector('.close').onclick = () => bg.remove();
  bg.addEventListener('click', (e) => {
    if (e.target === bg) bg.remove();
  });
  bg.querySelector('.modal').addEventListener('click', (e) => {
    const f = e.target.getAttribute('data-free');
    const p = e.target.getAttribute('data-prem');
    if (f) claimBp(state, Number(f), 'free');
    if (p) claimBp(state, Number(p), 'premium');
    if (f || p) {
      bg.remove();
      rerender();
    }
  });
  document.body.appendChild(bg);
}

function render(state, root) {
  gameStateBag.current = state;
  appRoot = root;
  ensureClawDay(state);
  const rush = Date.now() < state.rushEnd;
  const rushCd = Date.now() < state.rushCooldownUntil;
  const setMult = setMultiplier(state.machines);

  const preservedWorldHost = (() => {
    const el = document.getElementById('world3dHost');
    return el?.parentNode ? el.parentNode.removeChild(el) : null;
  })();

  const clawLeft = CLAW_UNLIMITED_TEST
    ? Number.POSITIVE_INFINITY
    : Math.max(0, CLAW_PLAYS_PER_DAY - state.claw.plays);
  const clawExhausted = !CLAW_UNLIMITED_TEST && clawLeft === 0;
  const clawLabel = CLAW_UNLIMITED_TEST
    ? 'Prize claw · Unlimited (test)'
    : clawLeft === 0
      ? 'Prize claw · Available tomorrow (UTC)'
      : `Prize claw · ${clawLeft} of ${CLAW_PLAYS_PER_DAY} plays remaining`;

  const machineCards = state.machines
    .map((m) => {
      const t = typeById(m.typeId);
      const rc = repairCost(m.typeId);
      const lv = m.level || 1;
      const inc = machineBaseIncome(m);
      const uc = upgradeCost(m);
      const maxed = lv >= CABINET_MAX_LEVEL;
      return `
      <div class="cabinet ${m.broken ? 'broken' : ''} ${rush ? 'rush' : ''}" data-mid="${m.id}">
        <div class="cab-art">${machineImageHtml(t, 'floor')}</div>
        <div class="name">${t?.name || 'Unknown'}</div>
        <div class="meta">${m.broken ? '<span style="color:#fecaca;font-weight:600">Out of order</span>' : `<strong>Lv ${lv}</strong> · ${inc.toFixed(1)} ¢/s`}${setMult > 1 ? `<br>Set ×${setMult.toFixed(2)}` : ''}</div>
        <div class="actions">
          ${!m.broken && !maxed ? `<button type="button" class="btn-upgrade" data-upgrade="${m.id}">Upgrade (${uc}¢)</button>` : ''}
          ${!m.broken && maxed ? `<span style="font-size:0.6875rem;color:var(--text-secondary);text-align:center">Max level</span>` : ''}
          ${m.broken ? `<button type="button" class="btn-repair" data-repair="${m.id}">Repair ${rc}¢</button>` : ''}
        </div>
      </div>`;
    })
    .join('');

  const openCapacity = Math.max(0, state.slotCount - state.machines.length);
  const pend = state.placementPending;
  const shop = MACHINE_TYPES.map((t) => {
    const full = state.machines.length >= state.slotCount;
    const can =
      !full && state.coins >= t.cost && !pend;
    return `
      <div class="shop-item">
        <div class="ico">${machineImageHtml(t, 'shop')}</div>
        <div class="info">
          <div class="n">${t.name}</div>
          <div class="d">${t.income.toFixed(1)}¢/s base · ${t.tag} · place on the 3D map</div>
        </div>
        <button type="button" data-buy="${t.id}" ${can ? '' : 'disabled'}>${pend ? 'Busy' : `${t.cost}¢`}</button>
      </div>
    `;
  }).join('');

  const expandCost = SLOT_EXPAND_COST(state.slotCount);
  const canExpand = state.slotCount < SLOT_MAX && state.coins >= expandCost;

  const clawHandler = () => {
    void openClawMachine(state, () => render(state, root)).catch(() => {
      toast('Could not open claw machine.', true);
    });
  };
  const activeTab = getActiveTab();
  const isHome = activeTab === 'home';
  const isWorld = activeTab === 'world';
  const isShop = activeTab === 'shop';
  const pendType = pend ? typeById(pend.typeId) : null;

  const bpPct = Math.min(100, (state.bp.tier / BP_MAX_TIER) * 100);
  let hintDismissed = false;
  try {
    hintDismissed = localStorage.getItem('arcade-hint-dismissed') === '1';
  } catch {
    hintDismissed = false;
  }
  const muted = gameAudio.isMuted();
  root.innerHTML = `
    <div class="app-shell gdt-shell">
      <header class="gdt-top-hud" aria-label="Studio status">
        <div class="gdt-hud-left">
          <button type="button" class="gdt-icon-btn" id="gdtMenuBtn" aria-label="Menu">☰</button>
          <button type="button" class="gdt-icon-btn gdt-mute-btn" id="btnMute" aria-label="${muted ? 'Unmute sound' : 'Mute sound'}">${muted ? '🔇' : '🔊'}</button>
          <div class="gdt-bubble gdt-bubble-orange" title="Tickets">
            <span class="gdt-bubble-ico" aria-hidden="true">◆</span>
            <span data-stat="tickets">${state.tickets}</span>
          </div>
          <div class="gdt-bubble gdt-bubble-yellow" title="Ambience">
            <span class="gdt-bubble-ico" aria-hidden="true">◎</span>
            <span data-stat="comfort">${Math.round(state.comfort)}</span>
          </div>
        </div>
        <div class="gdt-hud-center">
          <div class="gdt-project-card">
            <div class="gdt-project-title">Arcade Empire</div>
            <div class="gdt-project-genre">Simulation / Venue ops</div>
            <div class="gdt-progress-block">
              <div class="gdt-progress-label">Season pass · Tier <span data-stat="bp-tier">${state.bp.tier}</span></div>
              <div class="gdt-progress-bar"><i data-bp-bar style="width:${bpPct}%"></i></div>
            </div>
            <div class="gdt-hype-pill">Hype <strong data-stat="hype">${Math.round(state.hype)}%</strong></div>
          </div>
        </div>
        <div class="gdt-hud-right">
          <div class="gdt-bubble gdt-bubble-blue" title="Credits">
            <span class="gdt-bubble-ico" aria-hidden="true">⬡</span>
            <span data-stat="coins-short">${formatShortNumber(state.coins)}</span>
          </div>
          <div class="gdt-bubble gdt-bubble-teal" title="Machines on floor">
            <span class="gdt-bubble-ico" aria-hidden="true">▣</span>
            <span data-stat="machines-n">${state.machines.length}</span>
          </div>
          <div class="gdt-hud-stack">
            <div class="gdt-hud-line"><span class="gdt-hud-ico" aria-hidden="true">🕐</span> <span data-stat="gdt-time">${formatGdtWeekLine()}</span></div>
            <div class="gdt-hud-line"><span class="gdt-hud-ico" aria-hidden="true">♥</span> <span data-stat="fans">${formatShortNumber(fanCountFromState(state))}</span> Fans</div>
            <div class="gdt-hud-line gdt-money"><span class="gdt-hud-ico" aria-hidden="true">$</span> <span data-stat="coins-short">${formatShortNumber(state.coins)}</span></div>
          </div>
          <a class="gdt-source-pill" href="https://github.com/jonaskroeger26/Arcade" target="_blank" rel="noopener noreferrer" title="Source">src</a>
        </div>
      </header>
      <div class="gdt-main gdt-main-world">
        <div class="world-gl-loading" id="worldGlLoading" aria-live="polite" aria-busy="true">
          <div class="world-gl-loading-inner">
            <div class="world-gl-spinner" aria-hidden="true"></div>
            <span>Loading park…</span>
          </div>
        </div>
        <div id="world3dSlot"></div>
        <button type="button" class="gdt-info-fab" id="gdtInfoFab" aria-label="Season pass">i</button>
        <div class="world-ui-layer${isWorld ? ' world-ui-layer--world' : ''}">
          <div class="main-scroll gdt-room-scroll">
        <div class="tab-panel${isHome ? ' active' : ''}" data-panel="home" role="tabpanel" aria-hidden="${isHome ? 'false' : 'true'}">
          ${!hintDismissed ? `
          <div class="game-welcome-banner">
            <p><strong>Welcome.</strong> Build income from cabinets on the <strong>World</strong> map, expand capacity here, and run the <strong>prize claw</strong> when you are ready.</p>
            <button type="button" class="btn-dismiss-hint" id="btnDismissHint">Got it</button>
          </div>` : ''}
          <div class="gdt-token-strip">
            <div class="stat token gdt-token-stat">
              <div class="lbl">ARCADE token (Devnet)</div>
              <div class="val" id="walletArcadeBal">—</div>
            </div>
          </div>
          <p class="toolbar-label">Actions</p>
          <div class="row-btns">
            <button type="button" class="btn-secondary" id="btnWallet">${getSolana()?.publicKey ? 'Refresh wallet' : 'Connect wallet'}</button>
            <button type="button" class="btn-amber" id="btnRush" ${rush || rushCd || state.tickets < 1 ? 'disabled' : ''}>
              ${rush ? 'Rush active' : rushCd ? 'Rush cooling…' : 'Rush hour (1 ticket)'}
            </button>
            <button type="button" class="btn-muted" id="btnBp">Season pass</button>
            <button type="button" class="btn-primary" id="btnExpand" ${canExpand ? '' : 'disabled'}>
              Expand floor · ${expandCost}¢ (${state.slotCount}/${SLOT_MAX})
            </button>
            <button type="button" class="btn-claw" id="btnClaw" ${clawExhausted ? 'disabled' : ''}>${clawLabel}</button>
          </div>
          <section class="home-machines-section">
            <h2>Your machines</h2>
            <div class="arcade-room">
              <div class="room-wall">
                <div class="strip">Active floor</div>
              </div>
              <div class="room-floor room-floor--home">
                <div class="floor-grid">${machineCards || `<div class="slot">No cabinets yet — <strong>Shop</strong> to buy, then place on the <strong>World</strong> map.</div>`}</div>
              </div>
            </div>
          </section>
          <p class="tab-context" style="margin-top:14px;margin-bottom:0">${openCapacity} placement slots left · Claw: <strong>World</strong> tab · Gear: <strong>Shop</strong>.</p>
        </div>
        <div class="tab-panel${isWorld ? ' active' : ''}" data-panel="world" role="tabpanel" aria-hidden="${isWorld ? 'false' : 'true'}">
          <p class="tab-context">Open park in 3D — <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · move pointer to aim the green ghost · <strong>Place</strong> or <strong>Space</strong> to build.</p>
          <div class="world-walk-mascot" aria-hidden="true">
            <object data="${assetBase()}character-walk.svg" type="image/svg+xml" width="72" height="96" title=""></object>
          </div>
          ${pend && pendType ? `
          <div class="placement-bar">
            <span class="placement-bar-txt">Placing <strong>${escapeHtml(pendType.name)}</strong> — ${pendType.cost}¢ on confirm</span>
            <button type="button" class="btn-primary" id="btnPlaceCommit">Place here</button>
            <button type="button" class="btn-secondary" id="btnPlaceCancel">Cancel</button>
          </div>` : ''}
          <section>
            <h2>Prize claw</h2>
            <div class="claw-booth">
              <div class="claw-booth-inner">
                <svg class="claw-mini" viewBox="0 0 64 64" aria-hidden="true">
                  <rect x="8" y="10" width="48" height="4" rx="1" fill="#52525b"/>
                  <rect x="30" y="14" width="4" height="14" fill="#71717a"/>
                  <path d="M26 30 L32 38 L38 30" fill="#52525b"/>
                  <rect x="10" y="42" width="44" height="14" rx="2" fill="rgba(14,165,233,0.12)" stroke="#3f3f46"/>
                  <circle cx="24" cy="50" r="5" fill="#ec4899" opacity="0.85"/>
                  <circle cx="40" cy="50" r="5" fill="#f59e0b" opacity="0.85"/>
                </svg>
                <div style="flex:1;min-width:0">
                  <div class="claw-label">Lobby prize claw</div>
                  <p class="claw-hint">${CLAW_UNLIMITED_TEST ? 'Unlimited plays (test). ' : `${CLAW_PLAYS_PER_DAY} free plays per day (UTC). `}Full-screen 3D cabinet.</p>
                  <button type="button" class="btn-secondary" id="clawBoothBtn" style="margin-top:10px;width:100%" ${clawExhausted ? 'disabled' : ''}>Run prize claw</button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div class="tab-panel${isShop ? ' active' : ''}" data-panel="shop" role="tabpanel" aria-hidden="${isShop ? 'false' : 'true'}">
          <p class="tab-context">Buy a cabinet, then switch to <strong>World</strong> to place it on the map (expand capacity from <strong>Home</strong>).</p>
          <section>
            <h2>Equipment catalog</h2>
            <div class="shop">${shop}</div>
          </section>
          <p class="footer-note">
            Progress stored locally. Devnet mint <span style="color:#38bdf8">${ARCADE_DEVNET.mint.slice(0, 8)}…</span>
          </p>
        </div>
          </div>
        </div>
        <div class="world-touch-controls${isWorld ? '' : ' world-touch-controls--hidden'}" id="worldTouchControls" aria-hidden="${isWorld ? 'false' : 'true'}">
          <span class="touch-hint">Drag</span>
          <div class="touch-joystick" aria-hidden="true">
            <div class="touch-joystick-base"></div>
            <div class="touch-joystick-stick"></div>
          </div>
        </div>
      </div>
      <nav class="tab-bar gdt-tab-bar" role="tablist" aria-label="Sections">
        <button type="button" class="tab-btn${isHome ? ' active' : ''}" role="tab" aria-selected="${isHome ? 'true' : 'false'}" data-tab="home">
          <span class="tab-ico" aria-hidden="true">◇</span>
          Home
        </button>
        <button type="button" class="tab-btn${isWorld ? ' active' : ''}" role="tab" aria-selected="${isWorld ? 'true' : 'false'}" data-tab="world">
          <span class="tab-ico" aria-hidden="true">▦</span>
          World
        </button>
        <button type="button" class="tab-btn${isShop ? ' active' : ''}" role="tab" aria-selected="${isShop ? 'true' : 'false'}" data-tab="shop">
          <span class="tab-ico" aria-hidden="true">◈</span>
          Shop
        </button>
      </nav>
    </div>
  `;

  const wSlot = root.querySelector('#world3dSlot');
  if (preservedWorldHost && wSlot) {
    wSlot.replaceWith(preservedWorldHost);
  } else if (wSlot) {
    wSlot.id = 'world3dHost';
    wSlot.classList.add('world-3d-host');
  }

  root.querySelectorAll('.tab-bar .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-tab');
      if (t === 'home' || t === 'world' || t === 'shop') {
        setActiveTab(t);
        render(state, root);
      }
    });
  });

  root.querySelector('#gdtMenuBtn')?.addEventListener('click', () => {
    toast('Studio: Home (actions), World (3D park), Shop (cabinets).');
  });
  root.querySelector('#gdtInfoFab')?.addEventListener('click', () =>
    openBattlePassModal(state, () => render(state, root)),
  );

  root.querySelector('#btnClaw')?.addEventListener('click', clawHandler);
  const boothBtn = root.querySelector('#clawBoothBtn');
  if (boothBtn) boothBtn.onclick = clawHandler;

  root.querySelector('#btnWallet')?.addEventListener('click', async () => {
    const s = getSolana();
    if (!s) {
      toast('No wallet (open in Phantom / Seeker)', true);
      return;
    }
    if (!s.publicKey) {
      try {
        await s.connect();
      } catch {
        toast('Connect rejected', true);
        return;
      }
    }
    await refreshWalletArcade(state);
    toast('Wallet refreshed');
  });

  root.querySelector('#btnRush')?.addEventListener('click', () => {
    const now = Date.now();
    if (now < state.rushEnd || now < state.rushCooldownUntil) return;
    if (state.tickets < 1) {
      toast('Need a ticket', true);
      return;
    }
    state.tickets -= 1;
    state.rushEnd = now + RUSH_DURATION_MS;
    state.rushCooldownUntil = now + RUSH_DURATION_MS + RUSH_COOLDOWN_MS;
    state.hype = Math.min(100, state.hype + 12);
    gameAudio.sfxRush();
    toast('Rush hour — double credits!');
    saveState(state);
    render(state, root);
  });

  root.querySelector('#btnBp')?.addEventListener('click', () =>
    openBattlePassModal(state, () => render(state, root)),
  );

  root.querySelector('#btnExpand')?.addEventListener('click', () => {
    if (state.slotCount >= SLOT_MAX) return;
    const cost = SLOT_EXPAND_COST(state.slotCount);
    if (state.coins < cost) return;
    state.coins -= cost;
    state.slotCount += 1;
    gameAudio.sfxCoin();
    toast(`Room expanded — ${state.slotCount} spots`);
    saveState(state);
    render(state, root);
  });

  root.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-buy');
      const t = typeById(id);
      if (!t || state.coins < t.cost) return;
      if (state.placementPending) {
        toast('Finish or cancel the current placement first', true);
        return;
      }
      if (state.machines.length >= state.slotCount) {
        toast('Park full — expand in Home', true);
        return;
      }
      state.placementPending = { typeId: id };
      setActiveTab('world');
      saveState(state);
      gameAudio.sfxUi();
      toast(`${t.name} — aim ghost on grass, then Place`);
      render(state, root);
    });
  });

  root.querySelector('#btnPlaceCommit')?.addEventListener('click', () => {
    commitPlacement(state, root);
  });
  root.querySelector('#btnPlaceCancel')?.addEventListener('click', () => {
    cancelPlacement(state, root);
  });

  root.querySelectorAll('[data-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-upgrade');
      const m = state.machines.find((x) => x.id === id);
      if (!m || m.broken) return;
      const c = upgradeCost(m);
      if ((m.level || 1) >= CABINET_MAX_LEVEL) return;
      if (state.coins < c) {
        toast(`Need ${c}¢ to upgrade`, true);
        return;
      }
      state.coins -= c;
      m.level = (m.level || 1) + 1;
      gameAudio.sfxCoin();
      toast(`Upgraded to Lv ${m.level}`);
      saveState(state);
      render(state, root);
    });
  });

  root.querySelectorAll('[data-repair]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-repair');
      const m = state.machines.find((x) => x.id === id);
      if (!m || !m.broken) return;
      const c = repairCost(m.typeId);
      if (state.coins < c) {
        toast(`Need ${c}¢ to repair`, true);
        return;
      }
      state.coins -= c;
      m.broken = false;
      state.comfort = Math.min(100, state.comfort + 3);
      gameAudio.sfxRepair();
      toast('Cabinet fixed');
      saveState(state);
      render(state, root);
    });
  });

  root.querySelector('#btnMute')?.addEventListener('click', () => {
    gameAudio.setMuted(!gameAudio.isMuted());
    render(state, root);
  });

  root.querySelector('#btnDismissHint')?.addEventListener('click', () => {
    try {
      localStorage.setItem('arcade-hint-dismissed', '1');
    } catch {
      /* ignore */
    }
    render(state, root);
  });

  if (getSolana()?.publicKey) refreshWalletArcade(state);

  queueMicrotask(() => {
    void ensureWorld3d().then(() => {
      document.getElementById('worldGlLoading')?.classList.add('world-gl-loading--hidden');
    });
  });
}

function initDaily(state) {
  ensureClawDay(state);
  const d = todayStr();
  if (state.bp.lastLoginDay !== d) {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const y = yest.toISOString().slice(0, 10);
    if (state.bp.lastLoginDay === y) state.bp.streak = (state.bp.streak || 0) + 1;
    else state.bp.streak = 1;
    state.bp.lastLoginDay = d;
    state.tickets += 1 + Math.min(3, Math.floor((state.bp.streak || 1) / 3));
    state.bp.xp += 50;
    toast(`Day ${state.bp.streak} — login bonus`);
    saveState(state);
  }
}

function boot() {
  const root = document.getElementById('app');
  let state = mergeState(loadState());
  gameStateBag.current = state;
  initDaily(state);

  document.addEventListener('keydown', (ev) => {
    if (ev.code !== 'Space') return;
    const el = ev.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const s = gameStateBag.current;
    if (!s?.placementPending || getActiveTab() !== 'world') return;
    ev.preventDefault();
    commitPlacement(s, document.getElementById('app'));
  });

  let lastTickUi = performance.now() - 501;
  function loop(ts) {
    if (ts - lastTickUi >= 500) {
      lastTickUi = ts;
      tick(state);
      syncHudStats(state);
      const rush = Date.now() < state.rushEnd;
      document.querySelectorAll('.cabinet').forEach((el) => {
        if (rush) el.classList.add('rush');
        else el.classList.remove('rush');
      });
      const rushBtn = document.getElementById('btnRush');
      if (rushBtn) {
        const cd = Date.now() < state.rushCooldownUntil;
        const need = state.tickets < 1;
        rushBtn.disabled = rush || cd || need;
        rushBtn.textContent = rush ? 'Rush active' : cd ? 'Rush cooling…' : 'Rush hour (1 ticket)';
      }
      ensureClawDay(state);
      const left = CLAW_UNLIMITED_TEST
        ? Number.POSITIVE_INFINITY
        : Math.max(0, CLAW_PLAYS_PER_DAY - state.claw.plays);
      const clawDead = !CLAW_UNLIMITED_TEST && left === 0;
      const clawBtn = document.getElementById('btnClaw');
      if (clawBtn) {
        clawBtn.disabled = clawDead;
        clawBtn.textContent = CLAW_UNLIMITED_TEST
          ? 'Prize claw · Unlimited (test)'
          : left === 0
            ? 'Prize claw · Available tomorrow (UTC)'
            : `Prize claw · ${left} of ${CLAW_PLAYS_PER_DAY} plays remaining`;
      }
      const boothClaw = document.getElementById('clawBoothBtn');
      if (boothClaw) boothClaw.disabled = clawDead;
    }
    requestAnimationFrame(loop);
  }

  render(state, root);
  requestAnimationFrame(loop);

  function resumeAudioOnGesture() {
    void gameAudio.resumeAudioContext();
    document.removeEventListener('pointerdown', resumeAudioOnGesture);
    document.removeEventListener('keydown', resumeAudioOnGesture);
  }
  document.addEventListener('pointerdown', resumeAudioOnGesture);
  document.addEventListener('keydown', resumeAudioOnGesture);

  try {
    const s = getSolana();
    if (s && typeof s.on === 'function') {
      s.on('accountChanged', () => refreshWalletArcade(state));
    }
  } catch (_) {}
}

boot();
