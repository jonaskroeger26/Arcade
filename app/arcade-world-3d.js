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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'world-three-canvas';
  host.appendChild(renderer.domElement);

  // —— Ground (flat XZ park) ——
  const groundGeo = new THREE.PlaneGeometry(WORLD_HALF * 2.2, WORLD_HALF * 2.2, 1, 1);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: 0x4a8f5c,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD_HALF * 2, 44, 0x3d7a4a, 0x2d5c38);
  grid.position.y = 0.03;
  scene.add(grid);

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
  scene.add(player);

  const keys = new Set();
  let lastPlayerSave = 0;
  let active = true;

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

  function tick() {
    const state = getState();
    if (!state) {
      requestAnimationFrame(tick);
      return;
    }

    syncMachines(state);
    ensureGhost(state);

    const dt = Math.min(0.05, 1 / 60);
    if (active && isWorldTabActive()) {
      let fwd = 0;
      let turn = 0;
      if (keys.has('w') || keys.has('arrowup')) fwd += 1;
      if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
      if (keys.has('a') || keys.has('arrowleft')) turn += 1;
      if (keys.has('d') || keys.has('arrowright')) turn -= 1;

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
    },
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
