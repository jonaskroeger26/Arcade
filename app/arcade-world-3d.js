/**
 * Third-person arcade yard + enterable hall: walk outside, place cabinets on the indoor floor only.
 */
import * as THREE from 'three';
import {
  HOUSE,
  getHouseWallSegments,
  isInsideHouseFloor,
  resolveCircleWallSegments,
  nextInteriorMode,
  computeInteriorModeFromPosition,
} from './arcade-house.js';

export const WORLD_HALF = 180;
const CAM_OUT = { dist: 13, height: 6.8, fov: 50, lookY: 1.35, roomBlend: 0 };
/** Pokémon-style room: higher, closer, slight pull toward room center */
const CAM_IN = { dist: 6.5, height: 9.8, fov: 54, lookY: 1.02, roomBlend: 0.2 };
const FADE_OUT_MS = 220;
const FADE_IN_MS = 260;
const MOVE_SPEED = 16;
const ROT_SPEED = 2.4;
const MIN_MACHINE_GAP = 3.4;
const PLACE_RADIUS = 2.2;
const PLAYER_R = 0.42;
const BUS_INTERACT_RADIUS = 4.2;

const TAG_COLOR = {
  retro: 0x8b5cf6,
  racing: 0xef4444,
  rhythm: 0xec4899,
  casual: 0x22c55e,
  default: 0x64748b,
};

function colorForTag(tag) {
  return TAG_COLOR[tag] ?? TAG_COLOR.default;
}

function toon(color) {
  return new THREE.MeshToonMaterial({ color });
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getState: () => object,
 *   getTagForTypeId: (typeId: string) => string,
 *   onPlayerMoved: (p: { x: number; z: number; ry: number }) => void,
 * }} opts
 */
export function createArcadeWorld(host, opts) {
  const { getState, getTagForTypeId, onPlayerMoved } = opts;

  const wallSegs = getHouseWallSegments();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b8e8);
  scene.fog = new THREE.Fog(0xb8d4f0, 32, 118);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.2, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'world-three-canvas';
  host.style.position = 'relative';
  host.appendChild(renderer.domElement);

  const overlayEl = document.createElement('div');
  overlayEl.className = 'world-transition-overlay';
  overlayEl.setAttribute('aria-hidden', 'true');
  overlayEl.style.opacity = '0';
  host.appendChild(overlayEl);

  function setOverlayAlpha(a) {
    overlayEl.style.opacity = String(Math.max(0, Math.min(1, a)));
  }

  function applySceneMode(inside) {
    if (inside) {
      scene.fog = new THREE.Fog(0xe6d7c5, 3.5, 23);
      scene.background = new THREE.Color(0xc8d7e8);
    } else {
      scene.fog = new THREE.Fog(0xc8dcf5, 34, 122);
      scene.background = new THREE.Color(0x95c4ef);
    }
  }

  const gSeg = 48;
  const groundGeo = new THREE.PlaneGeometry(WORLD_HALF * 2.2, WORLD_HALF * 2.2, gSeg, gSeg);
  const posAttr = groundGeo.attributes.position;
  const colors = [];
  const c1 = new THREE.Color(0x3d7a4e);
  const c2 = new THREE.Color(0x4f9a5c);
  const c3 = new THREE.Color(0x5cb86e);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const h = Math.sin(x * 0.11) * Math.cos(y * 0.09) * 0.28 + Math.sin(x * 0.31 + y * 0.27) * 0.08;
    posAttr.setZ(i, h);
    const t = 0.5 + 0.5 * Math.sin(x * 0.05) * Math.cos(y * 0.05);
    const mix = c1.clone().lerp(c2, t).lerp(c3, Math.random() * 0.15);
    colors.push(mix.r, mix.g, mix.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshToonMaterial({
      vertexColors: true,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD_HALF * 2, 44, 0x3d7a4a, 0x2d5c38);
  grid.position.y = 0.04;
  scene.add(grid);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(8, WORLD_HALF * 2.05, 1, 1),
    new THREE.MeshToonMaterial({
      color: 0xdac4a1,
      transparent: true,
      opacity: 0.48,
    }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.045, 0);
  path.receiveShadow = true;
  scene.add(path);

  function overlapsHouse(tx, tz) {
    return Math.abs(tx - HOUSE.cx) < HOUSE.hw + 3 && Math.abs(tz - HOUSE.cz) < HOUSE.hd + 3;
  }

  const trunkMat = toon(0x6d4b37);
  const leafMat = toon(0x3a7f49);
  const treePositions = [
    [-32, -18],
    [28, -22],
    [-24, 24],
    [34, 18],
    [-38, 8],
    [22, 32],
    [-12, -36],
    [8, -34],
    [38, -8],
    [-18, -30],
  ];
  for (const [tx, tz] of treePositions) {
    if (Math.abs(tx) > WORLD_HALF - 4 || Math.abs(tz) > WORLD_HALF - 4) continue;
    if (overlapsHouse(tx, tz)) continue;
    const tg = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 8), trunkMat);
    trunk.position.y = 1.1;
    trunk.castShadow = true;
    tg.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 10), leafMat);
    leaves.position.y = 3.8;
    leaves.castShadow = true;
    tg.add(leaves);
    tg.position.set(tx, 0, tz);
    scene.add(tg);
  }

  const blockMat = toon(0xa5b3c8);
  for (let i = 0; i < 24; i++) {
    const h = 4 + Math.random() * 14;
    const w = 2 + Math.random() * 4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), blockMat);
    const ang = (i / 24) * Math.PI * 2;
    const r = WORLD_HALF * 1.55 + Math.random() * 8;
    mesh.position.set(Math.cos(ang) * r, h / 2, Math.sin(ang) * r);
    mesh.castShadow = true;
    scene.add(mesh);
  }

  const roadMat = toon(0x5f6678);
  const laneMat = toon(0xffdf85);
  const sideMat = toon(0xbec8d7);
  const houseBodyMat = toon(0xe8edf6);
  const houseRoofMat = toon(0xbd7058);

  function addRoad(cx, cz, w, d) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), roadMat);
    road.position.set(cx, 0.02, cz);
    road.receiveShadow = true;
    scene.add(road);
  }
  function addLane(cx, cz, w, d) {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), laneMat);
    lane.position.set(cx, 0.045, cz);
    scene.add(lane);
  }
  function addSidewalk(cx, cz, w, d) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), sideMat);
    s.position.set(cx, 0.04, cz);
    s.receiveShadow = true;
    scene.add(s);
  }
  function addCityHouse(cx, cz, sx, sz, h, color = 0xe8edf6) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), toon(color));
    base.position.set(cx, h / 2, cz);
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(sx, sz) * 0.66, Math.max(1, h * 0.48), 4),
      houseRoofMat,
    );
    roof.position.set(cx, h + Math.max(0.7, h * 0.22), cz);
    roof.rotation.y = Math.PI * 0.25;
    roof.castShadow = true;
    scene.add(roof);
  }

  // Arcade district roads / props
  addRoad(0, 20, 22, 124);
  addLane(0, 20, 0.6, 110);
  addRoad(0, -44, 74, 18);
  addSidewalk(12.6, 12, 2.4, 96);
  addSidewalk(-12.6, 12, 2.4, 96);
  addCityHouse(-22, -28, 8, 8, 6.4, 0xdce5f0);
  addCityHouse(-25, -10, 7, 6, 5.6, 0xf0e8db);
  addCityHouse(23, -24, 8, 7, 6.7, 0xe5efe0);
  addCityHouse(24, -2, 6.5, 6.5, 5.3, 0xf2e3e1);
  addCityHouse(-28, 20, 7, 8, 6, 0xe3edf8);
  addCityHouse(27, 18, 8, 8, 6.2, 0xe8e2f1);

  // Downtown district (2nd zone destination)
  const downtownCenter = new THREE.Vector3(118, 0, -20);
  addRoad(downtownCenter.x, downtownCenter.z, 26, 126);
  addLane(downtownCenter.x, downtownCenter.z, 0.7, 110);
  addRoad(downtownCenter.x, downtownCenter.z + 30, 82, 16);
  addSidewalk(downtownCenter.x - 14.5, downtownCenter.z, 2.6, 108);
  addSidewalk(downtownCenter.x + 14.5, downtownCenter.z, 2.6, 108);
  for (let i = 0; i < 8; i++) {
    const sx = 7 + Math.random() * 4;
    const sz = 7 + Math.random() * 4;
    const h = 9 + Math.random() * 12;
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    addCityHouse(
      downtownCenter.x + side * (22 + Math.random() * 7),
      downtownCenter.z - 42 + row * 22 + (Math.random() * 3 - 1.5),
      sx,
      sz,
      h,
      0xd7e1ef,
    );
  }

  // —— Arcade hall (walk-in building) ——
  const hallFloor = new THREE.Mesh(
    new THREE.BoxGeometry(HOUSE.hw * 2 - 0.15, 0.1, HOUSE.hd * 2 - 0.15),
    toon(0xae7c58),
  );
  hallFloor.position.set(HOUSE.cx, 0.05, HOUSE.cz);
  hallFloor.receiveShadow = true;
  scene.add(hallFloor);

  const wallMat = toon(0xf0e5d5);
  const wallH = 3.25;
  for (const seg of wallSegs) {
    const sx = seg.maxX - seg.minX;
    const sz = seg.maxZ - seg.minZ;
    const wx = (seg.minX + seg.maxX) / 2;
    const wz = (seg.minZ + seg.maxZ) / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.15), wallH, Math.max(sz, 0.15)), wallMat);
    mesh.position.set(wx, wallH / 2, wz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(HOUSE.hw * 2 + 0.55, 0.28, HOUSE.hd * 2 + 0.55),
    toon(0x785c48),
  );
  roof.position.set(HOUSE.cx, wallH + 0.12, HOUSE.cz);
  roof.castShadow = true;
  scene.add(roof);

  scene.add(new THREE.AmbientLight(0xe3eeff, 0.62));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.18);
  sun.position.set(38, 56, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbad8ff, 0x5b8c62, 0.52);
  scene.add(hemi);
  const hallLight = new THREE.PointLight(0xffe5c4, 1.35, 24, 1.8);
  hallLight.position.set(HOUSE.cx, 2.5, HOUSE.cz);
  scene.add(hallLight);

  const BUS_STOPS = {
    arcade: new THREE.Vector3(-6, 0, 35),
    downtown: new THREE.Vector3(112, 0, 34),
  };
  let currentDistrict = 'arcade';

  function makeBusStop(pos, labelColor = 0x5d8bff) {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.1, 20), toon(0x2f3e5f));
    pad.position.y = 0.05;
    g.add(pad);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.8, 10), toon(0xd9dee8));
    pole.position.y = 1.95;
    g.add(pole);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.12), toon(labelColor));
    sign.position.set(0, 3.3, 0);
    g.add(sign);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 1.2), toon(0x7f8a9a));
    cap.position.set(0, 3.75, 0);
    g.add(cap);
    g.position.copy(pos);
    scene.add(g);
    return g;
  }
  makeBusStop(BUS_STOPS.arcade, 0x5d8bff);
  makeBusStop(BUS_STOPS.downtown, 0xf59e0b);

  /** @type {Array<{mesh: THREE.Group, path: Array<THREE.Vector3>, speed: number, t: number}>} */
  const trafficCars = [];
  function makeCar(color, path, speed, offset = 0) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), toon(color));
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1), toon(0xd8e6ff));
    roof.position.y = 1.3;
    g.add(roof);
    const wheelMat = toon(0x222b3a);
    for (const [x, z] of [
      [-0.86, -0.58],
      [0.86, -0.58],
      [-0.86, 0.58],
      [0.86, 0.58],
    ]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.2, 12), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.34, z);
      g.add(wheel);
    }
    scene.add(g);
    trafficCars.push({ mesh: g, path, speed, t: offset });
  }
  const arcadeLoop = [
    new THREE.Vector3(-4.6, 0, 44),
    new THREE.Vector3(-4.6, 0, -48),
    new THREE.Vector3(4.6, 0, -48),
    new THREE.Vector3(4.6, 0, 44),
  ];
  const downtownLoop = [
    new THREE.Vector3(113.2, 0, 44),
    new THREE.Vector3(113.2, 0, -64),
    new THREE.Vector3(122.8, 0, -64),
    new THREE.Vector3(122.8, 0, 44),
  ];
  makeCar(0x5aa0ff, arcadeLoop, 0.06, 0);
  makeCar(0xff7f66, arcadeLoop, 0.05, 0.5);
  makeCar(0x34c38f, downtownLoop, 0.055, 0.2);
  makeCar(0xe7b94f, downtownLoop, 0.06, 0.72);

  // —— Player avatar (simple humanoid + walk cycle) ——
  const player = new THREE.Group();
  const avatar = new THREE.Group();
  const matTorso = toon(0x4fb2ff);
  const matSkin = toon(0xf1c99e);
  const matPants = toon(0x324e79);
  const matShoe = toon(0x2b3446);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.54, 0.28), matTorso);
  torso.position.y = 1.04;
  torso.castShadow = true;
  avatar.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 14), matSkin);
  head.position.y = 1.44;
  head.castShadow = true;
  avatar.add(head);

  const hipY = 0.74;
  const legGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.44, 8);
  function makeLeg(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.15, hipY, 0);
    const leg = new THREE.Mesh(legGeo, matPants);
    leg.position.y = -0.22;
    leg.castShadow = true;
    g.add(leg);
    const shoe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.09, 8), matShoe);
    shoe.position.y = -0.48;
    shoe.castShadow = true;
    g.add(shoe);
    return g;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  avatar.add(legL, legR);

  const armGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.36, 8);
  const armL = new THREE.Mesh(armGeo, matTorso);
  armL.position.set(-0.33, 1.1, 0);
  armL.rotation.z = 0.4;
  armL.castShadow = true;
  const armR = new THREE.Mesh(armGeo, matTorso);
  armR.position.set(0.33, 1.1, 0);
  armR.rotation.z = -0.4;
  armR.castShadow = true;
  avatar.add(armL, armR);

  const playerShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 28),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  );
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.position.y = 0.025;
  playerShadow.renderOrder = -1;
  player.add(avatar);
  player.add(playerShadow);
  scene.add(player);

  let walkPhase = 0;
  let interiorMode = false;
  /**
   * @type {{
   *   start: number,
   *   phase: 'fadeOut' | 'fadeIn',
   *   mode: 'door' | 'bus',
   *   pendingInside: boolean,
   *   toDistrict?: 'arcade' | 'downtown',
   *   targetPos?: THREE.Vector3,
   *   targetRotY?: number
   * } | null}
   */
  let doorTransition = null;
  let interactLatch = false;

  const keys = new Set();
  let joyX = 0;
  let joyY = 0;
  let lastPlayerSave = 0;
  let active = true;
  let docHidden = false;
  document.addEventListener('visibilitychange', () => {
    docHidden = document.hidden;
  });

  /** @type {Map<string, THREE.Group>} */
  const machineGroups = new Map();
  /** @type {THREE.Group | null} */
  let ghostGroup = null;

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  function layoutSize() {
    const w = Math.max(320, host.clientWidth || 400);
    const ph = host.parentElement?.clientHeight;
    const h = Math.max(260, host.clientHeight || ph || window.innerHeight * 0.65);
    return { w, h };
  }

  function resize() {
    const { w, h } = layoutSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function syncPlayerFromState(s) {
    const p = s.player;
    if (p && typeof p.x === 'number' && typeof p.z === 'number') {
      player.position.x = p.x;
      player.position.z = p.z;
      player.rotation.y = typeof p.ry === 'number' ? p.ry : 0;
    }
    if (!doorTransition) {
      interiorMode = computeInteriorModeFromPosition(player.position.x, player.position.z);
      applySceneMode(interiorMode);
    }
  }

  function clampToWorld(x, z) {
    const lim = WORLD_HALF - 1.2;
    return {
      x: Math.max(-lim, Math.min(lim, x)),
      z: Math.max(-lim, Math.min(lim, z)),
    };
  }

  function canPlaceAt(wx, wz, state) {
    if (!isInsideHouseFloor(wx, wz)) return false;
    for (const m of state.machines) {
      const mx = m.wx ?? 0;
      const mz = m.wz ?? 0;
      if (Math.hypot(mx - wx, mz - wz) < MIN_MACHINE_GAP) return false;
    }
    return true;
  }

  function updateCamera() {
    const ry = player.rotation.y;
    const px = player.position.x;
    const pz = player.position.z;
    const cam = interiorMode ? CAM_IN : CAM_OUT;
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    const { cx: hcx, cz: hcz } = HOUSE;
    const blend = cam.roomBlend;
    const tx = px * (1 - blend) + hcx * blend;
    const tz = pz * (1 - blend) + hcz * blend;
    const cxCam = tx - Math.sin(ry) * cam.dist;
    const czCam = tz - Math.cos(ry) * cam.dist;
    camera.position.set(cxCam, cam.height, czCam);
    camera.lookAt(tx, cam.lookY, tz);
  }

  function ensureGhost(state) {
    const pend = state.placementPending;
    if (!pend) {
      if (ghostGroup) {
        scene.remove(ghostGroup);
        ghostGroup = null;
      }
      return;
    }
    const tag = getTagForTypeId(pend.typeId);
    const col = colorForTag(tag);
    if (!ghostGroup) {
      ghostGroup = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.8, 1.6),
        new THREE.MeshToonMaterial({
          color: col,
          transparent: true,
          opacity: 0.42,
        }),
      );
      base.position.y = 1.4;
      base.castShadow = false;
      ghostGroup.add(base);
      scene.add(ghostGroup);
    }
    ghostGroup.visible = true;
  }

  function setGhostPos(x, z, state) {
    if (!ghostGroup) return;
    const ok = canPlaceAt(x, z, state);
    ghostGroup.position.set(x, 0, z);
    const base = ghostGroup.children[0];
    if (base && base.material) {
      base.material.opacity = ok ? 0.48 : 0.22;
      base.material.color.setHex(ok ? colorForTag(getTagForTypeId(state.placementPending.typeId)) : 0xdc2626);
    }
  }

  function syncMachines(state) {
    const seen = new Set();
    for (const m of state.machines) {
      seen.add(m.id);
      let g = machineGroups.get(m.id);
      if (!g) {
        g = new THREE.Group();
        const tag = getTagForTypeId(m.typeId);
        const col = colorForTag(tag);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(2, 2.6, 1.5),
          new THREE.MeshToonMaterial({
            color: m.broken ? 0x57534e : col,
          }),
        );
        box.position.y = 1.3;
        box.castShadow = true;
        g.add(box);
        const top = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.35, 1.2),
          toon(0x2d3850),
        );
        top.position.y = 2.75;
        g.add(top);
        machineGroups.set(m.id, g);
        scene.add(g);
      }
      const wx = m.wx ?? 0;
      const wz = m.wz ?? 0;
      g.position.set(wx, 0, wz);
      g.rotation.y = (m.slot ?? 0) * 0.31;
      const box = g.children[0];
      if (box && box.material) {
        const tag = getTagForTypeId(m.typeId);
        box.material.color.setHex(m.broken ? 0x57534e : colorForTag(tag));
      }
    }
    for (const [id, g] of machineGroups) {
      if (!seen.has(id)) {
        scene.remove(g);
        machineGroups.delete(id);
      }
    }
  }

  let ghostX = 0;
  let ghostZ = 0;
  ndc.set(0, 0);

  function spawnPlaceBurst(x, z) {
    const n = 56;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const velocities = [];
    for (let i = 0; i < n; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.6;
      positions[i * 3 + 2] = z;
      const u = Math.random() * Math.PI * 2;
      const sp = Math.random() * 0.55 + 0.45;
      velocities.push(
        new THREE.Vector3(Math.cos(u) * sp * 0.35, Math.random() * 0.5 + 0.35, Math.sin(u) * sp * 0.35),
      );
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x4ade80,
      size: 0.16,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    let frame = 0;
    function animParticles() {
      frame += 1;
      const pos = geo.attributes.position;
      for (let i = 0; i < n; i++) {
        pos.array[i * 3] += velocities[i].x;
        pos.array[i * 3 + 1] += velocities[i].y;
        pos.array[i * 3 + 2] += velocities[i].z;
        velocities[i].y -= 0.028;
      }
      pos.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - frame * 0.028);
      if (frame < 36) requestAnimationFrame(animParticles);
      else {
        scene.remove(pts);
        geo.dispose();
        mat.dispose();
      }
    }
    requestAnimationFrame(animParticles);
  }

  function updateTraffic(dt) {
    for (const c of trafficCars) {
      c.t = (c.t + c.speed * dt) % 1;
      const n = c.path.length;
      const segF = c.t * n;
      const i0 = Math.floor(segF) % n;
      const i1 = (i0 + 1) % n;
      const lt = segF - Math.floor(segF);
      const p0 = c.path[i0];
      const p1 = c.path[i1];
      c.mesh.position.lerpVectors(p0, p1, lt);
      c.mesh.position.y = 0;
      c.mesh.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    }
  }

  function nearestBusStop() {
    const p = player.position;
    const da = Math.hypot(p.x - BUS_STOPS.arcade.x, p.z - BUS_STOPS.arcade.z);
    const dd = Math.hypot(p.x - BUS_STOPS.downtown.x, p.z - BUS_STOPS.downtown.z);
    if (da < dd) return { id: 'arcade', dist: da };
    return { id: 'downtown', dist: dd };
  }

  function tick() {
    const state = getState();
    if (!state) {
      requestAnimationFrame(tick);
      return;
    }

    if (docHidden) {
      requestAnimationFrame(tick);
      return;
    }

    syncMachines(state);
    ensureGhost(state);

    const dt = Math.min(0.05, 1 / 60);
    const now = performance.now();
    updateTraffic(dt);
    const inputFrozen = doorTransition != null;

    if (doorTransition) {
      const tr = doorTransition;
      const elapsed = now - tr.start;
      if (tr.phase === 'fadeOut') {
        setOverlayAlpha(Math.min(1, elapsed / FADE_OUT_MS));
        if (elapsed >= FADE_OUT_MS) {
          if (tr.mode === 'bus' && tr.targetPos) {
            player.position.copy(tr.targetPos);
            if (typeof tr.targetRotY === 'number') player.rotation.y = tr.targetRotY;
            if (tr.toDistrict) currentDistrict = tr.toDistrict;
          }
          interiorMode = tr.pendingInside;
          applySceneMode(interiorMode);
          doorTransition = {
            start: now,
            phase: 'fadeIn',
            mode: tr.mode,
            pendingInside: tr.pendingInside,
            toDistrict: tr.toDistrict,
            targetPos: tr.targetPos,
            targetRotY: tr.targetRotY,
          };
        }
      } else {
        const e2 = now - tr.start;
        setOverlayAlpha(Math.max(0, 1 - e2 / FADE_IN_MS));
        if (e2 >= FADE_IN_MS) {
          setOverlayAlpha(0);
          doorTransition = null;
        }
      }
    }

    if (active && !inputFrozen) {
      let fwd = joyY;
      let turn = -joyX;
      if (keys.has('w') || keys.has('arrowup')) fwd += 1;
      if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
      if (keys.has('a') || keys.has('arrowleft')) turn += 1;
      if (keys.has('d') || keys.has('arrowright')) turn -= 1;
      fwd = Math.max(-1, Math.min(1, fwd));
      turn = Math.max(-1, Math.min(1, turn));

      player.rotation.y += turn * ROT_SPEED * dt;
      const ry = player.rotation.y;
      const nx = player.position.x + Math.sin(ry) * fwd * MOVE_SPEED * dt;
      const nz = player.position.z + Math.cos(ry) * fwd * MOVE_SPEED * dt;
      const c = clampToWorld(nx, nz);
      const resolved = resolveCircleWallSegments(c.x, c.z, PLAYER_R, wallSegs);
      player.position.x = resolved.x;
      player.position.z = resolved.z;

      const moving = Math.abs(fwd) > 0.08 || Math.abs(turn) > 0.12;
      walkPhase += dt * (moving ? 10 : 0);
      const swing = Math.sin(walkPhase) * 0.55;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.35;
      armR.rotation.x = swing * 0.35;
      avatar.position.y = moving ? Math.abs(Math.sin(walkPhase * 2)) * 0.05 : 0;

      if (!doorTransition) {
        const nextInside = nextInteriorMode(player.position.x, player.position.z, interiorMode);
        if (nextInside !== interiorMode) {
          doorTransition = { start: now, phase: 'fadeOut', mode: 'door', pendingInside: nextInside };
        }
      }

      const interactPressed = keys.has('e');
      if (interactPressed && !interactLatch) {
        const near = nearestBusStop();
        if (near.dist <= BUS_INTERACT_RADIUS) {
          if (near.id === 'arcade' && currentDistrict === 'arcade') {
            doorTransition = {
              start: now,
              phase: 'fadeOut',
              mode: 'bus',
              pendingInside: false,
              toDistrict: 'downtown',
              targetPos: new THREE.Vector3(112, 0, 28),
              targetRotY: Math.PI,
            };
          } else if (near.id === 'downtown' && currentDistrict === 'downtown') {
            doorTransition = {
              start: now,
              phase: 'fadeOut',
              mode: 'bus',
              pendingInside: false,
              toDistrict: 'arcade',
              targetPos: new THREE.Vector3(-6, 0, 28),
              targetRotY: Math.PI,
            };
          }
        }
      }
      interactLatch = interactPressed;

      if (now - lastPlayerSave > 600) {
        lastPlayerSave = now;
        onPlayerMoved({
          x: player.position.x,
          z: player.position.z,
          ry: player.rotation.y,
        });
      }
    }
    if (!keys.has('e')) interactLatch = false;

    if (state.placementPending && ghostGroup) {
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(plane, target);
      if (hit != null) {
        const c = clampToWorld(target.x, target.z);
        ghostX = c.x;
        ghostZ = c.z;
        setGhostPos(ghostX, ghostZ, state);
      }
    }

    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k))
      keys.add(k);
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    keys.delete(k);
  }

  function onPointerMove(ev) {
    const state = getState();
    if (!state?.placementPending) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(ev) {
    const state = getState();
    if (!state?.placementPending) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  let joystickEl = null;
  let joystickStick = null;
  let joyPointerId = null;
  const JOY_MAX = 44;

  function attachTouchJoystick(container) {
    if (!container || container.dataset.joystickBound === '1') return;
    container.dataset.joystickBound = '1';
    joystickEl = container.querySelector('.touch-joystick');
    joystickStick = container.querySelector('.touch-joystick-stick');
    const base = container.querySelector('.touch-joystick-base');
    if (!base || !joystickStick) return;

    function setStick(dx, dy) {
      const r = Math.min(JOY_MAX, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx);
      const mx = Math.cos(ang) * r;
      const my = Math.sin(ang) * r;
      joystickStick.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`;
      joyX = mx / JOY_MAX;
      joyY = -my / JOY_MAX;
    }
    function resetStick() {
      joystickStick.style.transform = 'translate(-50%, -50%)';
      joyX = 0;
      joyY = 0;
    }

    base.addEventListener(
      'pointerdown',
      (ev) => {
        ev.preventDefault();
        joyPointerId = ev.pointerId;
        base.setPointerCapture(ev.pointerId);
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        setStick(ev.clientX - cx, ev.clientY - cy);
      },
      { passive: false },
    );
    base.addEventListener('pointermove', (ev) => {
      if (joyPointerId !== ev.pointerId) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setStick(ev.clientX - cx, ev.clientY - cy);
    });
    base.addEventListener('pointerup', (ev) => {
      if (joyPointerId !== ev.pointerId) return;
      joyPointerId = null;
      resetStick();
    });
    base.addEventListener('pointercancel', () => {
      joyPointerId = null;
      resetStick();
    });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  syncPlayerFromState(getState());
  tick();

  return {
    sync(state) {
      syncMachines(state);
      ensureGhost(state);
      syncPlayerFromState(state);
    },
    setActive(v) {
      active = v;
      keys.clear();
      joyX = 0;
      joyY = 0;
      if (joystickStick) joystickStick.style.transform = 'translate(-50%, -50%)';
    },
    attachTouchJoystick,
    placeBurst: spawnPlaceBurst,
    getPlacementGhost() {
      const s = getState();
      if (!s?.placementPending) return null;
      return { wx: ghostX, wz: ghostZ, valid: canPlaceAt(ghostX, ghostZ, s) };
    },
    dispose() {
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.dispose();
      host.innerHTML = '';
    },
  };
}
