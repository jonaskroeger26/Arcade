/**
 * WebGL claw machine scene (Three.js). Keeps gameplay coords in sync with arcade-game CLAW_* constants.
 */
import * as THREE from 'three';

function svgXToWorld(svgX, svgMin, svgMax) {
  const t = (svgX - svgMin) / (svgMax - svgMin);
  return (t - 0.5) * 1.32;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t) {
  return t * t * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function tween(ms, fn, ease = easeOutCubic) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    function frame(now) {
      const u = Math.min(1, (now - t0) / ms);
      fn(ease(u));
      if (u < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function emissiveBulb(color, warm = false) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: warm ? 0xffaa33 : 0xffffff,
    emissiveIntensity: warm ? 1.1 : 0.95,
    toneMapped: true,
  });
}

/**
 * @param {HTMLElement} host
 * @param {{ colors: string[]; ballCx: number[]; svgMin: number; svgMax: number }} opts
 * @returns {null | {
 *   setClawFromUi: (clawX: number, clawZ: number) => void,
 *   setCordRetracted: () => void,
 *   runDropAnimation: (catchRes: { caught: boolean; prizeIdx: number; kind: string }) => Promise<void>,
 *   resetAfterMiss: () => void,
 *   playChuteDrop: () => Promise<void>,
 *   returnArmToStart: (targetClawX: number, targetClawZ: number) => Promise<void>,
 *   dispose: () => void,
 * }}
 */
export function createClawScene3D(host, opts) {
  const { colors, ballCx, svgMin, svgMax } = opts;
  const cssW = host.clientWidth || 400;
  const cssH = Math.max(260, Math.round(cssW * 0.72));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07040a);
  scene.fog = new THREE.Fog(0x120818, 2.2, 5.8);

  const cameraMain = new THREE.PerspectiveCamera(40, cssW / cssH, 0.05, 50);
  cameraMain.position.set(-0.02, 0.95, 2.18);
  cameraMain.lookAt(0, 0.2, -0.12);

  const pitLook = new THREE.Vector3(0, 0.16, -0.08);
  const cameraLeft = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
  cameraLeft.position.set(-2.42, 0.46, -0.04);
  cameraLeft.lookAt(pitLook);

  const cameraRight = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
  cameraRight.position.set(2.42, 0.46, -0.04);
  cameraRight.lookAt(pitLook);

  function layoutSizes() {
    const w = Math.max(320, host.clientWidth || cssW);
    const h = Math.max(260, Math.round(w * 0.72));
    const sideW = Math.max(56, Math.floor(w * 0.14));
    const mainW = Math.max(180, w - 2 * sideW);
    return { w, h, sideW, mainW };
  }

  function updateCameraAspects() {
    const { h, sideW, mainW } = layoutSizes();
    cameraMain.aspect = mainW / h;
    cameraMain.updateProjectionMatrix();
    cameraLeft.aspect = sideW / h;
    cameraLeft.updateProjectionMatrix();
    cameraRight.aspect = sideW / h;
    cameraRight.updateProjectionMatrix();
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    updateCameraAspects();
    const { w, h } = layoutSizes();
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const canvas = renderer.domElement;
  canvas.className = 'claw-three-canvas';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.verticalAlign = 'top';
  host.appendChild(canvas);

  // —— Lights ——
  scene.add(new THREE.AmbientLight(0xffe8d0, 0.42));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(1.8, 3.2, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 8;
  sun.shadow.camera.left = -2;
  sun.shadow.camera.right = 2;
  sun.shadow.camera.top = 2;
  sun.shadow.camera.bottom = -1;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb4c6ff, 0.35);
  fill.position.set(-1.5, 1.2, 1);
  scene.add(fill);
  const pitLight = new THREE.PointLight(0x67e8f9, 0.55, 3.5);
  pitLight.position.set(0, 0.85, 0.35);
  scene.add(pitLight);

  // —— Pit floor ——
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(2.35, 0.07, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x3d2618, roughness: 0.9 }),
  );
  floor.position.set(0, -0.035, -0.08);
  floor.receiveShadow = true;
  scene.add(floor);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.12, 0.022, 8, 48, Math.PI * 0.98),
    new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0x7c3aed,
      emissiveIntensity: 0.65,
      roughness: 0.35,
    }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0.012, 0.42);
  scene.add(rim);

  const rim2 = rim.clone();
  rim2.material = rim.material.clone();
  rim2.material.color.setHex(0x38bdf8);
  rim2.material.emissive.setHex(0x0ea5e9);
  rim2.scale.setScalar(0.94);
  rim2.position.z = 0.38;
  scene.add(rim2);

  // —— Red pillars ——
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd92525, roughness: 0.42, metalness: 0.12 });
  const pillarGeo = new THREE.BoxGeometry(0.22, 1.42, 0.38);
  const pL = new THREE.Mesh(pillarGeo, pillarMat);
  pL.position.set(-1.06, 0.55, 0.08);
  pL.castShadow = true;
  scene.add(pL);
  const pR = pL.clone();
  pR.position.x = 1.06;
  scene.add(pR);

  // Marquee bulbs along inner pillar edges
  for (let i = 0; i < 10; i++) {
    const warm = i % 2 === 1;
    const bL = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), emissiveBulb(warm ? 0xfbbf24 : 0xffffff, warm));
    bL.position.set(-0.935, 0.16 + i * 0.115, 0.2);
    scene.add(bL);
    const bR = bL.clone();
    bR.position.x = 0.935;
    scene.add(bR);
  }

  // Back wall
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.92 }),
  );
  back.position.set(0, 0.35, -0.75);
  scene.add(back);

  // Chute (left)
  const chute = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.26, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x292524, roughness: 0.6 }),
  );
  chute.position.set(-0.88, 0.14, 0.18);
  chute.rotation.y = 0.2;
  scene.add(chute);
  const chuteFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.19, 0.29, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x991b1b, emissive: 0x450a0a, emissiveIntensity: 0.35 }),
  );
  chuteFrame.position.copy(chute.position);
  chuteFrame.position.z += 0.02;
  scene.add(chuteFrame);

  // Blue ball bed (instanced)
  const ballGeo = new THREE.SphereGeometry(1, 12, 10);
  const ballCount = 52;
  const blues = new THREE.InstancedMesh(
    ballGeo,
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.08 }),
    ballCount,
  );
  blues.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < ballCount; i++) {
    const rx = (Math.random() - 0.5) * 1.65;
    const rz = -0.05 + (Math.random() - 0.5) * 0.55;
    const sc = 0.045 + Math.random() * 0.038;
    p.set(rx, sc * 0.92, rz);
    e.set(0, Math.random() * Math.PI * 2, 0);
    q.setFromEuler(e);
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    blues.setMatrixAt(i, m);
  }
  scene.add(blues);

  // Decorative plush lumps (low poly)
  function plushBody(x, z, color, scale = 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
    );
    body.scale.set(1.1, 0.85, 1);
    body.position.y = 0.06;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
    );
    head.position.set(0, 0.14, 0.02);
    head.castShadow = true;
    g.add(head);
    g.position.set(x, 0.045, z);
    g.scale.setScalar(scale);
    return g;
  }
  scene.add(plushBody(-0.38, -0.02, 0xf472b6, 0.95));
  scene.add(plushBody(0.42, 0.02, 0x34d399, 0.9));
  scene.add(plushBody(0.12, -0.18, 0xfbbf24, 0.85));
  scene.add(plushBody(-0.22, -0.2, 0xc084fc, 0.78));

  // —— Playable prize spheres (match claw collision indices) ——
  const pitCol = colors.map((c) => new THREE.Color(c));
  const prizeMeshes = [];
  const ORB_Y = 0.12;
  const ORB_Z = -0.09;
  ballCx.forEach((cx, i) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 28, 24),
      new THREE.MeshStandardMaterial({
        color: pitCol[i],
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 1,
      }),
    );
    mesh.position.set(svgXToWorld(cx, svgMin, svgMax), ORB_Y, ORB_Z);
    mesh.castShadow = true;
    mesh.userData.prizeIndex = i;
    scene.add(mesh);
    prizeMeshes.push(mesh);
  });

  // Frosted glass panel (simple transmissive look without heavy cost)
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.35),
    new THREE.MeshStandardMaterial({
      color: 0x9fb0c4,
      metalness: 0.2,
      roughness: 0.18,
      transparent: true,
      opacity: 0.28,
    }),
  );
  glass.position.set(0, 0.38, 0.62);
  glass.rotation.x = -0.08;
  scene.add(glass);

  // —— Claw rig ——
  const GANTRY_Y = 0.92;
  const handLow = -0.78;
  const handRaised = -0.4;
  const prongAngleGrab = 0.52;

  const gantryRoot = new THREE.Group();
  scene.add(gantryRoot);

  const railBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.05, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.65, roughness: 0.28 }),
  );
  railBar.position.set(0, 0.04, 0);
  railBar.castShadow = true;
  gantryRoot.add(railBar);

  const cyanMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.55, roughness: 0.22 });
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 10), new THREE.MeshStandardMaterial({ color: 0x164e63, roughness: 0.55 }));
  cable.castShadow = true;
  gantryRoot.add(cable);

  const hand = new THREE.Group();
  gantryRoot.add(hand);

  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 14), cyanMat);
  hub.castShadow = true;
  hand.add(hub);

  const prongGeo = new THREE.ConeGeometry(0.026, 0.11, 8);
  const prongs = [];
  for (let i = 0; i < 3; i++) {
    const pr = new THREE.Mesh(prongGeo, cyanMat);
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    pr.position.set(Math.cos(a) * 0.045, -0.06, Math.sin(a) * 0.045);
    pr.rotation.z = Math.PI;
    pr.rotation.y = -a;
    hand.add(pr);
    prongs.push(pr);
  }

  const caughtMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 20, 16),
    new THREE.MeshStandardMaterial({ color: pitCol[1], roughness: 0.35, transparent: true, opacity: 1 }),
  );
  caughtMesh.visible = false;
  caughtMesh.position.set(0, -0.1, 0);
  hand.add(caughtMesh);

  function updateCable() {
    const len = Math.max(0.07, -hand.position.y);
    cable.scale.y = len;
    cable.position.y = -len / 2;
  }

  function worldZFromClawZ(clawZ) {
    return 0.24 - clawZ * 0.48;
  }

  function setClawFromUi(clawX, clawZ) {
    gantryRoot.position.set(svgXToWorld(clawX, svgMin, svgMax), GANTRY_Y, worldZFromClawZ(clawZ));
    const depth = 1 - clawZ * 0.08;
    gantryRoot.scale.set(depth, 1, depth);
    hand.position.y = handRaised;
    updateCable();
  }

  function setCordRetracted() {
    hand.position.y = handRaised;
    updateCable();
  }

  /** @param {number} u 0 = open, 1 = closed */
  function setProngClose(u) {
    prongs.forEach((pr, i) => {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const tilt = u * prongAngleGrab;
      pr.rotation.x = Math.PI + Math.cos(a) * tilt;
      pr.rotation.z = Math.sin(a) * tilt;
    });
  }

  setProngClose(0);
  setClawFromUi((svgMin + svgMax) / 2, 0.5);

  let raf = 0;
  function tick() {
    const { w, h, sideW, mainW } = layoutSizes();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setClearColor(0x07040a, 1);

    const drawView = (x, vw, cam) => {
      renderer.setViewport(x, 0, vw, h);
      renderer.setScissor(x, 0, vw, h);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
    };

    drawView(0, sideW, cameraLeft);
    drawView(sideW, mainW, cameraMain);
    drawView(sideW + mainW, sideW, cameraRight);

    renderer.setScissorTest(false);
    renderer.autoClear = prevAuto;
    raf = requestAnimationFrame(tick);
  }
  tick();

  const ro = new ResizeObserver(() => {
    const { w, h } = layoutSizes();
    updateCameraAspects();
    renderer.setSize(w, h, false);
  });
  ro.observe(host);

  const api = {
    setClawFromUi,
    setCordRetracted,

    async runDropAnimation(catchRes) {
      const { caught, prizeIdx } = catchRes;

      await tween(1050, (u) => {
        hand.position.y = THREE.MathUtils.lerp(handRaised, handLow, u);
        updateCable();
      });

      await tween(340, (u) => setProngClose(u));

      if (!caught) {
        await delay(catchRes.kind === 'wide' ? 420 : 520);
        await tween(260, (u) => setProngClose(1 - u));
        await tween(920, (u) => {
          hand.position.y = THREE.MathUtils.lerp(handLow, handRaised, easeInOutCubic(u));
          updateCable();
        });
        return;
      }

      caughtMesh.material.color.copy(pitCol[prizeIdx]);
      caughtMesh.visible = true;
      prizeMeshes[prizeIdx].visible = false;
      prizeMeshes.forEach((m, i) => {
        if (i !== prizeIdx) m.material.opacity = 0.38;
      });

      await tween(920, (u) => {
        hand.position.y = THREE.MathUtils.lerp(handLow, handRaised, easeInOutCubic(u));
        updateCable();
      });
    },

    resetAfterMiss() {
      caughtMesh.visible = false;
      prizeMeshes.forEach((m) => {
        m.visible = true;
        m.material.opacity = 1;
      });
      setProngClose(0);
      setCordRetracted();
    },

    async playChuteDrop() {
      if (!caughtMesh.visible) return;
      caughtMesh.updateWorldMatrix(true, true);
      scene.attach(caughtMesh);
      const p0 = caughtMesh.position.clone();
      const p1 = new THREE.Vector3(-0.9, -0.28, 0.36);
      await tween(920, (u) => {
        const e = easeInCubic(u);
        caughtMesh.position.lerpVectors(p0, p1, e);
        const s = 1 - 0.5 * e;
        caughtMesh.scale.setScalar(s);
        caughtMesh.material.opacity = Math.max(0, 1 - 0.94 * e);
      });
      caughtMesh.visible = false;
      caughtMesh.scale.setScalar(1);
      caughtMesh.material.opacity = 1;
      hand.attach(caughtMesh);
      caughtMesh.position.set(0, -0.1, 0);
    },

    async returnArmToStart(targetClawX, targetClawZ) {
      const tx = svgXToWorld(targetClawX, svgMin, svgMax);
      const tz = worldZFromClawZ(targetClawZ);
      const targetSc = 1 - targetClawZ * 0.08;
      const sx = gantryRoot.position.x;
      const sz = gantryRoot.position.z;
      const ss = gantryRoot.scale.x;
      await tween(680, (u) => {
        const e = easeOutCubic(u);
        gantryRoot.position.x = THREE.MathUtils.lerp(sx, tx, e);
        gantryRoot.position.z = THREE.MathUtils.lerp(sz, tz, e);
        const sc = THREE.MathUtils.lerp(ss, targetSc, e);
        gantryRoot.scale.set(sc, 1, sc);
      });
    },

    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (canvas.parentNode === host) host.removeChild(canvas);
    },
  };

  return api;
}
