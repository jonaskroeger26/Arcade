/**
 * Shared arcade hall (house interior) bounds — world XZ, Y up.
 * Cabinets are placed only on this floor; the player walks the yard and enters through the door.
 */
export const HOUSE = {
  cx: 0,
  cz: -12,
  hw: 7,
  hd: 5,
  /** Free strip at the south wall so the door stays clear */
  doorClearance: 2.8,
  wallT: 0.38,
  /** Door half-width (gap in south wall) */
  doorHalfW: 2.6,
};

const PLACE_MARGIN = 1.05;

/**
 * @param {number} wx
 * @param {number} wz
 * @param {number} [extraMargin=0]
 */
export function isInsideHouseFloor(wx, wz, extraMargin = 0) {
  const m = PLACE_MARGIN + extraMargin;
  const { cx, cz, hw, hd, doorClearance } = HOUSE;
  const xMin = cx - hw + m;
  const xMax = cx + hw - m;
  const zMin = cz - hd + m;
  const zMax = cz + hd - doorClearance - m;
  return wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax;
}

/** @param {{ wx?: number, wz?: number }} m */
export function clampMachineToHouseFloor(m) {
  const { cx, cz, hw, hd, doorClearance } = HOUSE;
  const margin = 1.1;
  const xMin = cx - hw + margin;
  const xMax = cx + hw - margin;
  const zMin = cz - hd + margin;
  const zMax = cz + hd - doorClearance - margin;
  m.wx = Math.max(xMin, Math.min(xMax, m.wx ?? cx));
  m.wz = Math.max(zMin, Math.min(zMax, m.wz ?? cz));
}

/** @param {number} slot
 * @param {number} slotCount */
export function defaultMachinePositionForSlot(slot, slotCount) {
  const { cx, cz, hw, hd, doorClearance } = HOUSE;
  const margin = 1.35;
  const xMin = cx - hw + margin;
  const xMax = cx + hw - margin;
  const zMin = cz - hd + margin;
  const zMax = cz + hd - doorClearance - margin;
  const n = Math.max(4, slotCount);
  const cols = Math.ceil(Math.sqrt(n));
  const row = Math.floor(slot / cols);
  const col = slot % cols;
  const sx = cols > 1 ? (xMax - xMin) / (cols - 1 || 1) : 0;
  const sz = cols > 1 ? (zMax - zMin) / (cols - 1 || 1) : 0;
  return {
    wx: xMin + col * sx,
    wz: zMin + row * sz,
  };
}

/** Axis-aligned wall boxes in XZ for circle collision (full height implied). */
export function getHouseWallSegments() {
  const { cx, cz, hw, hd, wallT, doorHalfW } = HOUSE;
  const zN = cz - hd;
  const zS = cz + hd;
  const xW = cx - hw;
  const xE = cx + hw;
  const t = wallT;
  return [
    { minX: xW - t, maxX: xE + t, minZ: zN - t, maxZ: zN + t * 0.45 },
    { minX: xE - t * 0.45, maxX: xE + t, minZ: zN, maxZ: zS },
    { minX: xW - t, maxX: xW + t * 0.45, minZ: zN, maxZ: zS },
    { minX: xW - t, maxX: cx - doorHalfW, minZ: zS - t * 0.45, maxZ: zS + t },
    { minX: cx + doorHalfW, maxX: xE + t, minZ: zS - t * 0.45, maxZ: zS + t },
  ];
}

/**
 * Push a circle (player) out of axis-aligned wall segments.
 * @param {number} px
 * @param {number} pz
 * @param {number} r
 * @param {Array<{ minX: number, maxX: number, minZ: number, maxZ: number }>} segments
 */
/**
 * Whether the avatar is physically in the hall floor (for initial load / save restore).
 * @param {number} px
 * @param {number} pz
 */
export function computeInteriorModeFromPosition(px, pz) {
  const { cx, cz, hw, hd } = HOUSE;
  const zS = cz + hd;
  const zN = cz - hd;
  return (
    Math.abs(px - cx) < hw - 0.12 &&
    pz < zS - 0.12 &&
    pz > zN + 0.12
  );
}

/**
 * Pokémon-style door hysteresis: interior camera only flips after crossing the threshold,
 * with different enter/exit lines so the view does not flicker at the door.
 * @param {number} px
 * @param {number} pz
 * @param {boolean} wasInside
 */
export function nextInteriorMode(px, pz, wasInside) {
  const { cx, cz, hw, hd, doorHalfW } = HOUSE;
  const zS = cz + hd;
  const zN = cz - hd;
  const enterZ = zS - 0.28;
  const exitZ = zS + 0.08;
  const inHallX = Math.abs(px - cx) < hw - 0.18;
  const inDoorX = Math.abs(px - cx) < doorHalfW + 1.35;

  if (wasInside) {
    if (pz > exitZ && inDoorX) return false;
    if (pz > zS + 0.55) return false;
    if (pz < zN - 0.25) return false;
    if (!inHallX) return false;
    return true;
  }
  if (pz < enterZ && pz > zN + 0.12 && inHallX) return true;
  return false;
}

export function resolveCircleWallSegments(px, pz, r, segments) {
  let x = px;
  let z = pz;
  for (let iter = 0; iter < 4; iter++) {
    for (const box of segments) {
      const qx = Math.max(box.minX, Math.min(box.maxX, x));
      const qz = Math.max(box.minZ, Math.min(box.maxZ, z));
      let dx = x - qx;
      let dz = z - qz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-8) {
        const push = (r - d) / d;
        x += dx * push;
        z += dz * push;
      } else if (d < r && d <= 1e-8) {
        const cx = (box.minX + box.maxX) / 2;
        const cz = (box.minZ + box.maxZ) / 2;
        dx = x - cx;
        dz = z - cz;
        const dd = Math.hypot(dx, dz) || 1;
        x += (dx / dd) * r;
        z += (dz / dd) * r;
      }
    }
  }
  return { x, z };
}
