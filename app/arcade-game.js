/**
 * Arcade Empire — idle tycoon prototype.
 * Sync ARCADE mint with scripts/arcade-token.devnet.json if you remint.
 */
const SAVE_KEY = 'arcade-empire-v1';

/** @type {{ mint: string, decimals: number, cluster: string }} */
export const ARCADE_DEVNET = {
  mint: 'G6V72JHHinX2JVRetdGuZzE4kdB7v6andgAZTYSAtH1i',
  decimals: 6,
  cluster: 'devnet',
};

const MACHINE_TYPES = [
  {
    id: 'pixelpit',
    name: 'Pixel Pit',
    emoji: '🕹️',
    cost: 45,
    income: 0.7,
    breakdown: 0.00018,
    tag: 'retro',
  },
  {
    id: 'thunderpin',
    name: 'Thunder Pinball',
    emoji: '📌',
    cost: 110,
    income: 1.35,
    breakdown: 0.00032,
    tag: 'retro',
  },
  {
    id: 'neonracer',
    name: 'Neon Racer',
    emoji: '🏎️',
    cost: 220,
    income: 2.2,
    breakdown: 0.0004,
    tag: 'racing',
  },
  {
    id: 'rhythm',
    name: 'Beat Cab',
    emoji: '🎵',
    cost: 380,
    income: 3.1,
    breakdown: 0.00038,
    tag: 'rhythm',
  },
  {
    id: 'crane',
    name: 'Prize Crane',
    emoji: '🦀',
    cost: 650,
    income: 4.8,
    breakdown: 0.0005,
    tag: 'casual',
  },
  {
    id: 'vector',
    name: 'Vector Legends',
    emoji: '✨',
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

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
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
  return {
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
}

function typeById(id) {
  return MACHINE_TYPES.find((t) => t.id === id);
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

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = err ? 'toast err' : 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/** @type {import('@solana/web3.js').Connection | null} */
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
    income += t.income * hypeMult * rushMult * setMult;
    if (Math.random() < t.breakdown * comfortFactor * dt) {
      m.broken = true;
      toast(`${t.name} jammed — repair it!`, true);
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

  if (Math.random() < 0.015 * dt && !rush) {
    state.tickets += 1;
    toast('Bonus ticket dropped!');
  }

  state.hype = Math.max(20, Math.min(100, state.hype + (rush ? 0.04 : -0.02) * dt));
  state.comfort = Math.max(35, Math.min(100, state.comfort - 0.015 * dt * state.machines.filter((m) => !m.broken).length));
  saveState(state);
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
      <h3>Season 1 — Neon Pass</h3>
      <p style="font-size:0.7rem;color:var(--muted);line-height:1.5;">
        Earn pass XP from arcade income. Claim rewards when you reach each tier.
        Premium track is a UI placeholder until you hook payments or NFT gate.
      </p>
      <div class="progress"><i style="width:${Math.min(100, (state.bp.tier / BP_MAX_TIER) * 100)}%"></i></div>
      <p style="font-size:0.65rem;color:var(--muted);">Tier ${state.bp.tier} / ${BP_MAX_TIER} · XP ${Math.floor(state.bp.xp)}</p>
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
      <span style="flex:1;color:var(--muted)">Rewards scale with your empire</span>
      <button type="button" data-free="${t}">Free</button>
      <button type="button" data-prem="${t}" ${state.bp.premium ? '' : 'disabled'}>Premium</button>
    `;
    trackEl.appendChild(row);
  }
  if (!state.bp.premium) {
    const hint = document.createElement('p');
    hint.style.cssText = 'margin-top:12px;font-size:0.65rem;color:var(--muted)';
    hint.textContent =
      'Premium track unlocks later (payment / NFT). Test locally: localStorage key arcade-empire-v1 → bp.premium = true.';
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
  const rush = Date.now() < state.rushEnd;
  const rushCd = Date.now() < state.rushCooldownUntil;
  const setMult = setMultiplier(state.machines);
  const occupied = new Set(state.machines.map((m) => m.slot));

  const floorSlots = [];
  for (let i = 0; i < state.slotCount; i++) {
    const m = state.machines.find((x) => x.slot === i);
    if (!m) {
      floorSlots.push(`<div class="slot" data-slot="${i}">Empty booth<br><span style="font-size:0.6rem">Buy below</span></div>`);
      continue;
    }
    const t = typeById(m.typeId);
    const rc = repairCost(m.typeId);
    floorSlots.push(`
      <div class="machine ${m.broken ? 'broken' : ''} ${rush ? 'rush' : ''}" data-mid="${m.id}">
        <div class="emoji">${t?.emoji || '❔'}</div>
        <div class="name">${t?.name || 'Unknown'}</div>
        <div class="meta">${m.broken ? 'OUT OF ORDER' : `${t?.income.toFixed(1)} ¢/s`}${setMult > 1 ? ` · ×${setMult.toFixed(2)} set` : ''}</div>
        <div class="actions">
          ${m.broken ? `<button type="button" class="btn-repair" data-repair="${m.id}">Fix ${rc}¢</button>` : `<span style="font-size:0.6rem;color:var(--muted);text-align:center;width:100%;align-self:center;">Running</span>`}
        </div>
      </div>
    `);
  }

  const shop = MACHINE_TYPES.map((t) => {
    const full = state.machines.length >= state.slotCount;
    const can = !full && state.coins >= t.cost;
    return `
      <div class="shop-item">
        <div class="ico">${t.emoji}</div>
        <div class="info">
          <div class="n">${t.name}</div>
          <div class="d">${t.income.toFixed(1)}¢/s · ${t.tag} tag · jam risk ${(t.breakdown * 1000).toFixed(2)}</div>
        </div>
        <button type="button" data-buy="${t.id}" ${can ? '' : 'disabled'}>${t.cost}¢</button>
      </div>
    `;
  }).join('');

  const expandCost = SLOT_EXPAND_COST(state.slotCount);
  const canExpand = state.slotCount < SLOT_MAX && state.coins >= expandCost;

  root.innerHTML = `
    <div class="top">
      <h1>ARCADE EMPIRE</h1>
      <a href="https://github.com/jonaskroeger26/Arcade" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
    <div class="hud">
      <div class="stat"><div class="lbl">Credits</div><div class="val" id="coinsDisp">${Math.floor(state.coins)}¢</div></div>
      <div class="stat tickets"><div class="lbl">Tickets</div><div class="val" id="ticketsDisp">${state.tickets}</div></div>
      <div class="stat hype"><div class="lbl">Hype</div><div class="val" id="hypeDisp">${Math.round(state.hype)}%</div></div>
      <div class="stat"><div class="lbl">Comfort</div><div class="val" id="comfortDisp">${Math.round(state.comfort)}%</div></div>
      <div class="stat token" style="grid-column:1/-1;">
        <div class="lbl">ARCADE token (devnet wallet)</div>
        <div class="val" id="walletArcadeBal">—</div>
      </div>
    </div>
    <div class="row-btns">
      <button type="button" class="btn-wallet" id="btnWallet">${getSolana()?.publicKey ? 'Refresh wallet' : 'Connect wallet'}</button>
      <button type="button" class="btn-rush" id="btnRush" ${rush || rushCd || state.tickets < 1 ? 'disabled' : ''}>
        ${rush ? 'RUSH LIVE' : rushCd ? 'Rush cooling…' : 'Rush hour (1 ticket)'}
      </button>
      <button type="button" class="btn-bp" id="btnBp">Battle pass</button>
      <button type="button" class="btn-neon" id="btnExpand" ${canExpand ? '' : 'disabled'}>
        Expand floor (${expandCost}¢) ${state.slotCount}/${SLOT_MAX}
      </button>
    </div>
    <section>
      <h2>Your floor · Set bonus ×${setMult.toFixed(2)}</h2>
      <div class="floor">${floorSlots.join('')}</div>
    </section>
    <section>
      <h2>Shop — place into next free booth</h2>
      <div class="shop">${shop}</div>
    </section>
    <p style="font-size:0.65rem;color:var(--muted);text-align:center;line-height:1.5;margin-top:8px;">
      Prototype: progress saves locally. ARCADE mint: <span style="color:var(--cyan)">${ARCADE_DEVNET.mint.slice(0, 6)}…</span> (Solscan devnet)
    </p>
  `;

  root.querySelector('#btnWallet').onclick = async () => {
    const s = getSolana();
    if (!s) {
      toast('No wallet (open in Phantom / Seeker browser)', true);
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
    toast('Wallet balance refreshed');
  };

  root.querySelector('#btnRush').onclick = () => {
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
    toast('RUSH HOUR — double credits!');
    saveState(state);
    render(state, root);
  };

  root.querySelector('#btnBp').onclick = () => openBattlePassModal(state, () => render(state, root));

  root.querySelector('#btnExpand').onclick = () => {
    if (state.slotCount >= SLOT_MAX) return;
    const cost = SLOT_EXPAND_COST(state.slotCount);
    if (state.coins < cost) return;
    state.coins -= cost;
    state.slotCount += 1;
    toast(`Floor expanded — ${state.slotCount} booths`);
    saveState(state);
    render(state, root);
  };

  root.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-buy');
      const t = typeById(id);
      if (!t || state.coins < t.cost) return;
      if (state.machines.length >= state.slotCount) {
        toast('Floor full — expand first', true);
        return;
      }
      let slot = -1;
      const occ = new Set(state.machines.map((m) => m.slot));
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
      });
      toast(`${t.name} installed`);
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
      toast('Back online');
      saveState(state);
      render(state, root);
    });
  });

  if (getSolana()?.publicKey) refreshWalletArcade(state);
}

function initDaily(state) {
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
    toast(`Day ${state.bp.streak} streak — bonus ticket`);
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
      const coinsEl = document.getElementById('coinsDisp');
      if (coinsEl) coinsEl.textContent = `${Math.floor(state.coins)}¢`;
      const hypeEl = document.getElementById('hypeDisp');
      const comfortEl = document.getElementById('comfortDisp');
      const tickEl = document.getElementById('ticketsDisp');
      if (hypeEl) hypeEl.textContent = `${Math.round(state.hype)}%`;
      if (comfortEl) comfortEl.textContent = `${Math.round(state.comfort)}%`;
      if (tickEl) tickEl.textContent = String(state.tickets);
      const rush = Date.now() < state.rushEnd;
      document.querySelectorAll('.machine').forEach((el) => {
        if (rush) el.classList.add('rush');
        else el.classList.remove('rush');
      });
      const rushBtn = document.getElementById('btnRush');
      if (rushBtn) {
        const cd = Date.now() < state.rushCooldownUntil;
        const need = state.tickets < 1;
        rushBtn.disabled = rush || cd || need;
        rushBtn.textContent = rush ? 'RUSH LIVE' : cd ? 'Rush cooling…' : 'Rush hour (1 ticket)';
      }
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
