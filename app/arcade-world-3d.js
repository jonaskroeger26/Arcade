/**
 * Open-world arcade park: third-person camera, walk the floor, place cabinets on the ground.
 */
import * as THREE from 'three';

export const WORLD_HALF = 44;
const CAM_DIST = 12;
const CAM_HEIGHT = 6.5;
const MOVE_SPEED = 16;
const ROT_SPEED = 2.4;
const MIN_MACHINE_GAP = 3.4;
const PLACE_RADIUS = 2.2;

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

/**
 * @param {HTMLElement} host
 * @param {{
 *   getState: () => object,
 *   getTagForTypeId: (typeId: string) => string,
 *   isWorldTabActive: () => boolean,
 *   onPlayerMoved: (p: { x: number; z: number; ry: number }) => void,
 * }} opts
 */
export function createArcadeWorld(host, opts) {
  const { getState, getTagForTypeId, isWorldTabActive, onPlayerMoved } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b8e8);
  scene.fog = new THREE.Fog(0xb8d4f0, 28, 110);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.2, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'world-three-canvas';
  host.appendChild(renderer.domElement);

  // —— Ground: subtle height + vertex tint for grass variation ——
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
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.04,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD_HALF * 2, 44, 0x3d7a4a, 0x2d5c38);
  grid.position.y = 0.04;
  scene.add(grid);

  // —— Decorative path (lighter strip through park) ——
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(8, WORLD_HALF * 2.05, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xc9b896,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
    }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.045, 0);
  path.receiveShadow = true;
  scene.add(path);

  // —— Simple trees ——
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d6a3e, roughness: 0.85 });
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

  // —— Distant blocks (simple “city” silhouette) ——
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
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

  scene.add(new THREE.AmbientLight(0xd4e8ff, 0.52));
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.05);
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
  const hemi = new THREE.HemisphereLight(0x9ec8f0, 0x3d6b4a, 0.38);
  scene.add(hemi);

  // —— Player ——
  const player = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.85, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.45, metalness: 0.1 }),
  );
  body.position.y = 0.85;
  body.castShadow = true;
  player.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 }),
  );
  head.position.y = 1.65;
  head.castShadow = true;
  player.add(head);
  const playerShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 28),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.position.y = 0.025;
  playerShadow.renderOrder = -1;
  player.add(playerShadow);
  scene.add(player);

  const keys = new Set();
  /** Virtual joystick -1..1 (screen: up = +forward) */
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
    const w = Math.max(280, host.clientWidth || 300);
    const ph = host.parentElement?.clientHeight;
    const h = Math.max(220, host.clientHeight || ph || Math.min(520, window.innerHeight * 0.55));
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
  }

  function clampToWorld(x, z) {
    const lim = WORLD_HALF - 1.2;
    return {
      x: Math.max(-lim, Math.min(lim, x)),
      z: Math.max(-lim, Math.min(lim, z)),
    };
  }

  function canPlaceAt(wx, wz, state) {
    if (Math.abs(wx) > WORLD_HALF - PLACE_RADIUS || Math.abs(wz) > WORLD_HALF - PLACE_RADIUS)
      return false;
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
    const cx = px - Math.sin(ry) * CAM_DIST;
    const cz = pz - Math.cos(ry) * CAM_DIST;
    camera.position.set(cx, CAM_HEIGHT, cz);
    camera.lookAt(px, 1.3, pz);
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
        new THREE.MeshStandardMaterial({
          color: col,
          transparent: true,
          opacity: 0.42,
          roughness: 0.6,
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

  /** Sync machine meshes from game state */
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
          new THREE.MeshStandardMaterial({
            color: m.broken ? 0x57534e : col,
            roughness: 0.55,
            metalness: 0.12,
          }),
        );
        box.position.y = 1.3;
        box.castShadow = true;
        g.add(box);
        const top = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.35, 1.2),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 }),
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
    if (active && isWorldTabActive()) {
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
      player.position.x = c.x;
      player.position.z = c.z;

      const now = performance.now();
      if (now - lastPlayerSave > 600) {
        lastPlayerSave = now;
        onPlayerMoved({
          x: player.position.x,
          z: player.position.z,
          ry: player.rotation.y,
        });
      }
    }

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
    if (!isWorldTabActive()) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k))
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

  /** @type {HTMLElement | null} */
  let joystickEl = null;
  /** @type {HTMLElement | null} */
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
        if (!isWorldTabActive()) return;
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
