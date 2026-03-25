/**
 * Arcade Empire — tycoon (room, cabinet upgrades, daily claw).
 */
const SAVE_KEY = 'arcade-empire-v2';
const UI_TAB_KEY = 'arcade-ui-tab';

function getActiveTab() {
  try {
    const t = sessionStorage.getItem(UI_TAB_KEY);
    if (t === 'home' || t === 'floor' || t === 'shop') return t;
  } catch (_) {}
  return 'home';
}

function setActiveTab(tab) {
  try {
    sessionStorage.setItem(UI_TAB_KEY, tab);
  } catch (_) {}
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

function defaultState() {
  return {
    coins: 120,
    tickets: 2,
    hype: 52,
    comfort: 72,
    slotCount: 4,
    machines: [],
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
  for (const m of merged.machines) {
    if (m.level == null || m.level < 1) m.level = 1;
    if (m.level > CABINET_MAX_LEVEL) m.level = CABINET_MAX_LEVEL;
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
  el.className = err ? 'toast err' : 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
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
    toast(`Battle pass tier ${state.bp.tier}!`);
  }

  if (Math.random() < 0.012 * dt && !rush) {
    state.tickets += 1;
    toast('Bonus ticket!');
  }

  state.hype = Math.max(20, Math.min(100, state.hype + (rush ? 0.04 : -0.02) * dt));
  state.comfort = Math.max(35, Math.min(100, state.comfort - 0.014 * dt * state.machines.filter((m) => !m.broken).length));
  saveState(state);
}

const CLAW_PIT_COLORS = ['#ec4899', '#f59e0b', '#10b981'];
/** viewBox 0–360 wide: gantry horizontal travel. */
const CLAW_SVG_X_MIN = 88;
const CLAW_SVG_X_MAX = 272;
const CLAW_BALL_CX = [108, 180, 252];
/** Prize pile sits ~this depth (0 = front glass, 1 = back wall). */
const CLAW_Z_ORB_PLANE = 0.5;
/** How many horizontal SVG units one unit of Z “error” counts as. */
const CLAW_DEPTH_TO_PX = 34;
/** Max combined (side + depth) miss distance before a grab attempt fails outright. */
const CLAW_GRAB_MAX_DIST = 34;
/** Gantry Y at front / back of travel (taller cabinet; smaller Y = deeper into box). */
const CLAW_GANTRY_Y_FRONT = 66;
const CLAW_GANTRY_Y_BACK = 38;
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
  const pSuccess = 0.08 + 0.78 * align ** 1.35;
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
    <svg class="claw-svg" viewBox="0 0 360 340" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="clawCabFront" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#3f3f46"/><stop offset="40%" stop-color="#27272a"/><stop offset="100%" stop-color="#1c1917"/>
        </linearGradient>
        <linearGradient id="clawCabSideL" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#18181b"/><stop offset="100%" stop-color="#0f0f10"/>
        </linearGradient>
        <linearGradient id="clawCabSideR" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#18181b"/><stop offset="100%" stop-color="#0f0f10"/>
        </linearGradient>
        <linearGradient id="clawBackWall" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1a1816"/><stop offset="100%" stop-color="#0c0a09"/>
        </linearGradient>
        <linearGradient id="clawFloorPersp" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#292524"/><stop offset="100%" stop-color="#1c1917"/>
        </linearGradient>
        <linearGradient id="clawRail" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#a1a1aa"/><stop offset="100%" stop-color="#3f3f46"/>
        </linearGradient>
        <linearGradient id="clawGlassGlare" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.14)"/><stop offset="35%" stop-color="rgba(255,255,255,0.02)"/><stop offset="70%" stop-color="rgba(255,255,255,0.08)"/><stop offset="100%" stop-color="rgba(255,255,255,0.03)"/>
        </linearGradient>
        <radialGradient id="clawMarqueeGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.35"/><stop offset="100%" stop-color="#78350f" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="clawOrb0" cx="35%" cy="30%" r="65%"><stop offset="0%" stop-color="#f9a8d4"/><stop offset="45%" stop-color="${c0}"/><stop offset="100%" stop-color="#9d174d"/></radialGradient>
        <radialGradient id="clawOrb1" cx="35%" cy="30%" r="65%"><stop offset="0%" stop-color="#fcd34d"/><stop offset="45%" stop-color="${c1}"/><stop offset="100%" stop-color="#b45309"/></radialGradient>
        <radialGradient id="clawOrb2" cx="35%" cy="30%" r="65%"><stop offset="0%" stop-color="#6ee7b7"/><stop offset="45%" stop-color="${c2}"/><stop offset="100%" stop-color="#047857"/></radialGradient>
        <linearGradient id="clawCordGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#57534e"/><stop offset="50%" stop-color="#e7e5e4"/><stop offset="100%" stop-color="#57534e"/>
        </linearGradient>
        <filter id="clawSoftShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" flood-opacity="0.5"/>
        </filter>
        <filter id="clawInnerGlow">
          <feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- Base / plinth -->
      <path d="M 12 292 L 348 292 L 352 326 L 8 326 Z" fill="#0c0a09" stroke="#292524" stroke-width="1"/>
      <rect x="24" y="300" width="312" height="18" rx="3" fill="#1c1917" stroke="#3f3f46" stroke-width="0.6" opacity="0.9"/>
      <!-- Outer shell -->
      <path d="M 18 32 L 342 32 L 356 58 L 356 286 L 4 286 L 4 58 Z" fill="url(#clawCabFront)" stroke="#52525b" stroke-width="1.2"/>
      <!-- Side depth panels -->
      <path d="M 4 58 L 18 32 L 18 286 L 4 286 Z" fill="url(#clawCabSideL)" stroke="#27272a" stroke-width="0.8"/>
      <path d="M 356 58 L 342 32 L 342 286 L 356 286 Z" fill="url(#clawCabSideR)" stroke="#27272a" stroke-width="0.8"/>
      <!-- Marquee -->
      <rect x="48" y="38" width="264" height="28" rx="6" fill="#18181b" stroke="#f59e0b" stroke-width="0.8" opacity="0.95"/>
      <text x="180" y="56" text-anchor="middle" fill="#fde68a" font-size="13" font-weight="700" font-family="system-ui,sans-serif" opacity="0.9">PRIZE CLAW</text>
      <ellipse cx="180" cy="52" rx="140" ry="20" fill="url(#clawMarqueeGlow)" pointer-events="none"/>
      <!-- Inner cavity (trapezoid = perspective) -->
      <path d="M 44 88 L 316 88 L 328 104 L 328 270 L 32 270 Z" fill="url(#clawBackWall)" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>
      <!-- Back wall edge highlight -->
      <path d="M 52 96 L 308 96 L 314 102 L 314 240 L 46 240 Z" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
      <!-- Pit floor (perspective quad + ellipse) -->
      <path d="M 56 248 L 304 248 L 316 262 L 44 262 Z" fill="url(#clawFloorPersp)" opacity="0.95"/>
      <ellipse cx="180" cy="252" rx="128" ry="22" fill="#1c1917" opacity="0.88"/>
      <ellipse cx="180" cy="246" rx="112" ry="16" fill="rgba(255,255,255,0.04)"/>
      <!-- Prize row (slightly elevated toward back) -->
      <g class="claw-orbs" filter="url(#clawSoftShadow)">
        <g transform="translate(108,208)"><ellipse cx="0" cy="12" rx="20" ry="9" fill="#000" opacity="0.4"/><circle r="19" fill="url(#clawOrb0)"/><ellipse cx="-6" cy="-7" rx="8" ry="5" fill="rgba(255,255,255,0.38)"/></g>
        <g transform="translate(180,208)"><ellipse cx="0" cy="12" rx="20" ry="9" fill="#000" opacity="0.4"/><circle r="19" fill="url(#clawOrb1)"/><ellipse cx="-6" cy="-7" rx="8" ry="5" fill="rgba(255,255,255,0.38)"/></g>
        <g transform="translate(252,208)"><ellipse cx="0" cy="12" rx="20" ry="9" fill="#000" opacity="0.4"/><circle r="19" fill="url(#clawOrb2)"/><ellipse cx="-6" cy="-7" rx="8" ry="5" fill="rgba(255,255,255,0.38)"/></g>
      </g>
      <!-- Overhead rail (3D slant) -->
      <path d="M 62 76 L 298 76 L 294 86 L 66 86 Z" fill="#52525b"/>
      <path d="M 62 74 L 298 74 L 298 76 L 62 76 Z" fill="#71717a" opacity="0.9"/>
      <rect x="64" y="77" width="232" height="5" rx="1.5" fill="url(#clawRail)" opacity="0.95"/>
      <!-- Claw assembly (drawn above pit, below glass) -->
      <g id="clawGantry" transform="translate(180, 52)">
        <g id="clawGantryScale">
          <rect x="-24" y="-10" width="48" height="17" rx="4" fill="url(#clawRail)" stroke="#3f3f46" stroke-width="0.9" filter="url(#clawInnerGlow)"/>
          <rect x="-9" y="7" width="18" height="5" rx="1" fill="#44403c"/>
          <g id="clawRig" transform="translate(0, 12)">
            <g id="clawCordPack" style="transform-origin: 0 0">
              <line x1="0" y1="0" x2="0" y2="122" stroke="url(#clawCordGrad)" stroke-width="4" stroke-linecap="round"/>
              <g id="clawGrabber" transform="translate(0, 122)">
                <rect x="-11" y="-5" width="22" height="9" rx="2" fill="#57534e" stroke="#44403c" stroke-width="0.5"/>
                <g id="clawHookL" style="transform-origin: -11px 4px">
                  <path d="M -11 4 L -11 24 Q -11 28 -5 26" fill="none" stroke="#d6d3d1" stroke-width="3.2" stroke-linecap="round"/>
                </g>
                <g id="clawHookR" style="transform-origin: 11px 4px">
                  <path d="M 11 4 L 11 24 Q 11 28 5 26" fill="none" stroke="#d6d3d1" stroke-width="3.2" stroke-linecap="round"/>
                </g>
                <circle id="clawCaughtOrb" r="0" cx="0" cy="18" opacity="0" fill="url(#clawOrb1)"/>
              </g>
            </g>
          </g>
        </g>
      </g>
      <!-- Front glass + bezel -->
      <path d="M 38 84 L 322 84 L 334 98 L 322 274 L 38 274 L 26 98 Z" fill="url(#clawGlassGlare)" stroke="rgba(255,255,255,0.12)" stroke-width="1.2" pointer-events="none" opacity="0.85">
        <animate attributeName="opacity" values="0.8;0.9;0.8" dur="5.5s" repeatCount="indefinite"/>
      </path>
      <path d="M 32 82 L 328 82 L 340 100 L 340 276 L 20 276 L 20 100 Z" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2" pointer-events="none"/>
    </svg>`;
}

function openClawMachine(state, rerender) {
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
        <p class="claw-sub">${CLAW_UNLIMITED_TEST ? `Play ${played} today (test) · move <strong>side</strong> &amp; <strong>depth</strong> so the hook lines up with a sphere — misses &amp; slips happen` : `Play ${played} of ${CLAW_PLAYS_PER_DAY} today · 3D aim: side + toward you / back — prizes sit mid-depth; misaligned depth counts as a miss`}</p>
        <div class="claw-stage-wrap claw-stage-3d">
          ${clawSvgMarkup()}
        </div>
        <div class="claw-controls">
          <div class="claw-controls-row">
            <span class="claw-axis-label">Side</span>
            <button type="button" class="btn-secondary claw-nudge claw-nudge-x" data-x="-1" aria-label="Move claw left">◀</button>
            <input type="range" class="claw-slider" id="clawSliderX" min="${CLAW_SVG_X_MIN}" max="${CLAW_SVG_X_MAX}" value="${Math.round(clawX)}" step="1" aria-label="Claw left-right"/>
            <button type="button" class="btn-secondary claw-nudge claw-nudge-x" data-x="1" aria-label="Move claw right">▶</button>
          </div>
          <div class="claw-controls-row">
            <span class="claw-axis-label">Depth</span>
            <button type="button" class="btn-secondary claw-nudge claw-nudge-z" data-z="-1" aria-label="Toward you (front)">Front</button>
            <input type="range" class="claw-slider claw-slider-z" id="clawSliderZ" min="0" max="100" value="${Math.round(clawZ * 100)}" step="1" aria-label="Depth toward back"/>
            <button type="button" class="btn-secondary claw-nudge claw-nudge-z" data-z="1" aria-label="Toward back">Back</button>
          </div>
          <button type="button" class="btn-primary claw-drop-wide" id="clawDrop">Drop claw</button>
        </div>
        <p class="claw-hint-keys" style="font-size:0.75rem;color:var(--text-secondary);margin-top:8px">Keys: <kbd>←</kbd><kbd>→</kbd> side · <kbd>↑</kbd><kbd>↓</kbd> depth · <kbd>Space</kbd> drop</p>
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

  const gantry = overlay.querySelector('#clawGantry');
  const gantryScale = overlay.querySelector('#clawGantryScale');
  const cordPack = overlay.querySelector('#clawCordPack');
  const hookL = overlay.querySelector('#clawHookL');
  const hookR = overlay.querySelector('#clawHookR');
  const caughtOrbEl = overlay.querySelector('#clawCaughtOrb');
  const orbGroups = overlay.querySelectorAll('.claw-orbs > g');
  const sliderX = overlay.querySelector('#clawSliderX');
  const sliderZ = overlay.querySelector('#clawSliderZ');
  const dropBtn = overlay.querySelector('#clawDrop');
  const statusEl = overlay.querySelector('.claw-status');
  const resultBox = overlay.querySelector('.claw-result');
  const doneBtn = overlay.querySelector('#clawDone');

  if (!gantry || !cordPack || !hookL || !hookR || !caughtOrbEl || !sliderX || !sliderZ || !dropBtn) {
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

  const CORD_SCALE_RETRACT = 0.22;
  const CORD_SCALE_FULL = 1;
  const CORD_SCALE_RAISED = 0.32;
  const easeDrop = 'cubic-bezier(0.22, 1, 0.32, 1)';
  const easeLift = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const easeGrab = 'cubic-bezier(0.34, 1.25, 0.64, 1)';

  function applyClawPose() {
    clawX = Math.max(CLAW_SVG_X_MIN, Math.min(CLAW_SVG_X_MAX, clawX));
    clawZ = Math.max(0, Math.min(1, clawZ));
    const gy =
      CLAW_GANTRY_Y_FRONT -
      clawZ * (CLAW_GANTRY_Y_FRONT - CLAW_GANTRY_Y_BACK);
    const gs =
      CLAW_GANTRY_SCALE_FRONT -
      clawZ * (CLAW_GANTRY_SCALE_FRONT - CLAW_GANTRY_SCALE_BACK);
    gantry.setAttribute('transform', `translate(${clawX}, ${gy})`);
    if (gantryScale) gantryScale.setAttribute('transform', `scale(${gs})`);
    sliderX.value = String(Math.round(clawX));
    sliderZ.value = String(Math.round(clawZ * 100));
  }

  applyClawPose();

  function closeModal() {
    if (!finished) return;
    overlay.remove();
    rerender();
  }

  doneBtn?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && finished) closeModal();
  });

  sliderX.addEventListener('input', () => {
    clawX = Number(sliderX.value);
    applyClawPose();
  });
  sliderZ.addEventListener('input', () => {
    clawZ = Number(sliderZ.value) / 100;
    applyClawPose();
  });
  overlay.querySelectorAll('.claw-nudge-x').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.getAttribute('data-x'));
      clawX += d * 6;
      applyClawPose();
    });
  });
  overlay.querySelectorAll('.claw-nudge-z').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.getAttribute('data-z'));
      clawZ += d * 0.07;
      applyClawPose();
    });
  });

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

  cordPack.style.transform = `scaleY(${CORD_SCALE_RETRACT})`;

  dropBtn.addEventListener('click', () => {
    if (phase !== 'aim') return;
    phase = 'dropping';
    sliderX.disabled = true;
    sliderZ.disabled = true;
    dropBtn.disabled = true;
    overlay.querySelectorAll('.claw-nudge').forEach((b) => {
      b.disabled = true;
    });

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
  ensureClawDay(state);
  const rush = Date.now() < state.rushEnd;
  const rushCd = Date.now() < state.rushCooldownUntil;
  const setMult = setMultiplier(state.machines);

  const clawLeft = CLAW_UNLIMITED_TEST
    ? Number.POSITIVE_INFINITY
    : Math.max(0, CLAW_PLAYS_PER_DAY - state.claw.plays);
  const clawExhausted = !CLAW_UNLIMITED_TEST && clawLeft === 0;
  const clawLabel = CLAW_UNLIMITED_TEST
    ? 'Prize claw · Unlimited (test)'
    : clawLeft === 0
      ? 'Prize claw · Available tomorrow (UTC)'
      : `Prize claw · ${clawLeft} of ${CLAW_PLAYS_PER_DAY} plays remaining`;

  const floorSlots = [];
  for (let i = 0; i < state.slotCount; i++) {
    const m = state.machines.find((x) => x.slot === i);
    if (!m) {
      floorSlots.push(
        `<div class="slot" data-slot="${i}">Open space<br><span style="font-size:0.6875rem;font-weight:500;opacity:0.85">Add a cabinet below</span></div>`,
      );
      continue;
    }
    const t = typeById(m.typeId);
    const rc = repairCost(m.typeId);
    const lv = m.level || 1;
    const inc = machineBaseIncome(m);
    const uc = upgradeCost(m);
    const maxed = lv >= CABINET_MAX_LEVEL;
    floorSlots.push(`
      <div class="cabinet ${m.broken ? 'broken' : ''} ${rush ? 'rush' : ''}" data-mid="${m.id}">
        <div class="cab-art">${machineImageHtml(t, 'floor')}</div>
        <div class="name">${t?.name || 'Unknown'}</div>
        <div class="meta">${m.broken ? '<span style="color:#fecaca;font-weight:600">Out of order</span>' : `<strong>Lv ${lv}</strong> · ${inc.toFixed(1)} ¢/s`}${setMult > 1 ? `<br>Set ×${setMult.toFixed(2)}` : ''}</div>
        <div class="actions">
          ${!m.broken && !maxed ? `<button type="button" class="btn-upgrade" data-upgrade="${m.id}">Upgrade (${uc}¢)</button>` : ''}
          ${!m.broken && maxed ? `<span style="font-size:0.6875rem;color:var(--text-secondary);text-align:center">Max level</span>` : ''}
          ${m.broken ? `<button type="button" class="btn-repair" data-repair="${m.id}">Repair ${rc}¢</button>` : ''}
        </div>
      </div>
    `);
  }

  const shop = MACHINE_TYPES.map((t) => {
    const full = state.machines.length >= state.slotCount;
    const can = !full && state.coins >= t.cost;
    return `
      <div class="shop-item">
        <div class="ico">${machineImageHtml(t, 'shop')}</div>
        <div class="info">
          <div class="n">${t.name}</div>
          <div class="d">${t.income.toFixed(1)}¢/s base · ${t.tag} · place in your room</div>
        </div>
        <button type="button" data-buy="${t.id}" ${can ? '' : 'disabled'}>${t.cost}¢</button>
      </div>
    `;
  }).join('');

  const expandCost = SLOT_EXPAND_COST(state.slotCount);
  const canExpand = state.slotCount < SLOT_MAX && state.coins >= expandCost;

  const clawHandler = () => openClawMachine(state, () => render(state, root));
  const activeTab = getActiveTab();
  const isHome = activeTab === 'home';
  const isFloor = activeTab === 'floor';
  const isShop = activeTab === 'shop';

  root.innerHTML = `
    <div class="app-shell">
      <div class="main-scroll">
        <div class="top">
          <div class="top-row">
            <div>
              <h1>Arcade Empire</h1>
              <p class="subtitle">Venue operations — use tabs below on mobile.</p>
            </div>
            <a href="https://github.com/jonaskroeger26/Arcade" target="_blank" rel="noopener noreferrer">Source</a>
          </div>
        </div>
        <div class="live-strip">
          <div class="live-strip-inner">
            <div class="cell"><label>Credits</label><strong data-stat="coins">${Math.floor(state.coins)}¢</strong></div>
            <div class="cell tickets"><label>Tickets</label><strong data-stat="tickets">${state.tickets}</strong></div>
            <div class="cell hype"><label>Traffic</label><strong data-stat="hype">${Math.round(state.hype)}%</strong></div>
            <div class="cell"><label>Comfort</label><strong data-stat="comfort">${Math.round(state.comfort)}%</strong></div>
          </div>
        </div>
        <div class="tab-panel${isHome ? ' active' : ''}" data-panel="home" role="tabpanel" aria-hidden="${isHome ? 'false' : 'true'}">
          <div class="hud">
            <div class="stat"><div class="lbl">Floor credits</div><div class="val" data-stat="coins">${Math.floor(state.coins)}¢</div></div>
            <div class="stat tickets"><div class="lbl">Tickets</div><div class="val" data-stat="tickets">${state.tickets}</div></div>
            <div class="stat hype"><div class="lbl">Foot traffic</div><div class="val" data-stat="hype">${Math.round(state.hype)}%</div></div>
            <div class="stat"><div class="lbl">Ambience</div><div class="val" data-stat="comfort">${Math.round(state.comfort)}%</div></div>
            <div class="stat token" style="grid-column:1/-1;">
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
                <div class="floor-grid">${floorSlots.join('')}</div>
              </div>
            </div>
          </section>
          <p class="tab-context" style="margin-top:14px;margin-bottom:0">Full claw booth: <strong>Floor</strong> tab · New cabinets: <strong>Shop</strong>.</p>
        </div>
        <div class="tab-panel${isFloor ? ' active' : ''}" data-panel="floor" role="tabpanel" aria-hidden="${isFloor ? 'false' : 'true'}">
          <p class="tab-context">Floor layout, upgrades, and the daily prize claw. Buy new cabinets in <strong>Shop</strong>.</p>
          <section>
            <h2>Floor layout</h2>
            <div class="arcade-room">
              <div class="room-wall">
                <div class="strip">Live floor preview</div>
              </div>
              <div class="room-floor">
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
                      <p class="claw-hint">${CLAW_UNLIMITED_TEST ? 'Unlimited plays (test). ' : `${CLAW_PLAYS_PER_DAY} free plays per day (UTC). `}Animated pickup sequence.</p>
                      <button type="button" class="btn-secondary" id="clawBoothBtn" style="margin-top:10px;width:100%" ${clawExhausted ? 'disabled' : ''}>Run prize claw</button>
                    </div>
                  </div>
                </div>
                <div class="floor-grid">${floorSlots.join('')}</div>
              </div>
            </div>
          </section>
        </div>
        <div class="tab-panel${isShop ? ' active' : ''}" data-panel="shop" role="tabpanel" aria-hidden="${isShop ? 'false' : 'true'}">
          <p class="tab-context">Equipment is placed automatically into the next open slot on your floor (expand capacity from <strong>Home</strong>).</p>
          <section>
            <h2>Equipment catalog</h2>
            <div class="shop">${shop}</div>
          </section>
          <p class="footer-note">
            Progress stored locally. Devnet mint <span style="color:#38bdf8">${ARCADE_DEVNET.mint.slice(0, 8)}…</span>
          </p>
        </div>
      </div>
      <nav class="tab-bar" role="tablist" aria-label="Sections">
        <button type="button" class="tab-btn${isHome ? ' active' : ''}" role="tab" aria-selected="${isHome ? 'true' : 'false'}" data-tab="home">
          <span class="tab-ico" aria-hidden="true">◇</span>
          Home
        </button>
        <button type="button" class="tab-btn${isFloor ? ' active' : ''}" role="tab" aria-selected="${isFloor ? 'true' : 'false'}" data-tab="floor">
          <span class="tab-ico" aria-hidden="true">▦</span>
          Floor
        </button>
        <button type="button" class="tab-btn${isShop ? ' active' : ''}" role="tab" aria-selected="${isShop ? 'true' : 'false'}" data-tab="shop">
          <span class="tab-ico" aria-hidden="true">◈</span>
          Shop
        </button>
      </nav>
    </div>
  `;

  root.querySelectorAll('.tab-bar .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-tab');
      if (t === 'home' || t === 'floor' || t === 'shop') {
        setActiveTab(t);
        render(state, root);
      }
    });
  });

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
    toast(`Room expanded — ${state.slotCount} spots`);
    saveState(state);
    render(state, root);
  });

  root.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-buy');
      const t = typeById(id);
      if (!t || state.coins < t.cost) return;
      if (state.machines.length >= state.slotCount) {
        toast('Room full — expand first', true);
        return;
      }
      const occ = new Set(state.machines.map((m) => m.slot));
      let slot = -1;
      for (let i = 0; i < state.slotCount; i++) {
        if (!occ.has(i)) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return;
      state.coins -= t.cost;
      state.machines.push({
        id: uid(),
        typeId: id,
        slot,
        broken: false,
        level: 1,
      });
      toast(`${t.name} placed in your room`);
      saveState(state);
      render(state, root);
    });
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
      toast('Cabinet fixed');
      saveState(state);
      render(state, root);
    });
  });

  if (getSolana()?.publicKey) refreshWalletArcade(state);
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
  initDaily(state);

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

  try {
    const s = getSolana();
    if (s && typeof s.on === 'function') {
      s.on('accountChanged', () => refreshWalletArcade(state));
    }
  } catch (_) {}
}

boot();
