// =====================================================================
// 3D LOBBY  (script/lobby.js)
// ---------------------------------------------------------------------
// Draws the player's character standing idle BEHIND the main menu
// (index.html), like the Mobile Legends / CODM lobby: character on the
// left, buttons on the right.
//
//  - Same toon shading, black outline and colours as the in-game player.
//  - Transparent canvas: the sky / grass backdrop is plain CSS in
//    index.html. Only the character and its shadow are 3D.
//  - Rendering pauses while the game iframe is open.
//  - Loaded with a dynamic import() from index.html, so if WebGL or the
//    FBX fails the menu still works on the flat backdrop.
//
// Tune the framing in LOBBY below (screenX / feetY / heightFrac).
// =====================================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CHARACTER_PATHS } from './common.js';

const LOBBY = {
  targetHeight: 1.8,       // same as CONFIG.character.targetHeight in game.html
  fov: 30,

  /* Where the character stands on screen (fractions of the viewport).
     screenX     0 = left edge, 1 = right edge (centre of the character)
     feetY       0 = top edge,  1 = bottom edge (where the feet are)
     heightFrac  how much of the screen height the character fills */
  screenX: 0.38,
  feetY: 0.89,
  heightFrac: 0.575,

  /* 0 = facing the camera. Positive turns the character toward the right
     side of the screen (where the buttons are). */
  facingAngle: 0,

  outlineThickness: 0.012,
  outlineColor: 0x000000,
  gradientSteps: 3,
  shadowOpacity: 0.3,

  /* Keep in sync with CONFIG.character in game.html. */
  colors: {
    hair:     0x2b1d16,
    body:     0xe8b48c,
    shirt:    0x3a7bd5,
    shorts:   0x2f3542,
    slippers: 0xd94f4f,
  },
  colorParts: [
    { key: 'slippers', words: ['slipper', 'slip', 'shoe', 'sandal', 'boot'] },
    { key: 'shorts',   words: ['short', 'pant', 'trouser', 'jean'] },
    { key: 'shirt',    words: ['shirt', 'tshirt', 'top', 'jacket', 'hoodie'] },
    { key: 'hair',     words: ['hair', 'beard', 'brow'] },
    { key: 'body',     words: ['body', 'skin', 'head', 'arm', 'leg', 'hand', 'face'] },
  ],
};

/* ---- Helpers (compact copies of the game.html versions) -------------- */
const ROOT_BONE_RE = /(root|hips|pelvis|bip01)/;

function stripHorizontalRootMotion(clip) {
  if (!clip || !clip.tracks) return;
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    if (track.name.slice(dot + 1) !== 'position') continue;
    const boneName = track.name.slice(0, dot).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ROOT_BONE_RE.test(boneName)) continue;
    const v = track.values;
    if (!v || v.length < 6) continue;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}

function makeToonGradientMap(steps) {
  const n = Math.max(2, Math.floor(steps));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round((i / (n - 1)) * 255);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function normalizePartName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectPart(mesh, material) {
  const candidates = [
    normalizePartName(mesh.name),
    normalizePartName(material && material.name),
    normalizePartName(mesh.parent && mesh.parent.name),
  ].filter(Boolean);
  for (const part of LOBBY.colorParts) {
    for (const word of part.words) {
      if (candidates.some((n) => n.includes(word))) return part.key;
    }
  }
  return null;
}

function applyColors(model, gradientMap) {
  model.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    obj.visible = true;
    obj.castShadow = true;
    obj.receiveShadow = false;
    obj.frustumCulled = false;

    const isArray = Array.isArray(obj.material);
    const mats = isArray ? obj.material : [obj.material];
    const out = mats.map((mat) => {
      if (!mat) return mat;
      const part = detectPart(obj, mat);
      const hex = part
        ? LOBBY.colors[part]
        : (mat.color ? mat.color.getHex() : 0xffffff);
      const toon = new THREE.MeshToonMaterial({
        color: hex,
        gradientMap,
        side: THREE.FrontSide,
      });
      if (mat.map) toon.map = mat.map;
      return toon;
    });
    obj.material = isArray ? out : out[0];
  });
}

function computeBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const bad = box.isEmpty() ||
    ![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(isFinite);
  if (bad) {
    box.makeEmpty();
    root.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        if (obj.geometry.boundingBox) {
          box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
        }
      }
    });
  }
  return box;
}

/* Scales the FBX to targetHeight, centres it on X / Z and puts its feet on
   y = 0. Returns the final height in metres. */
function normalizeCharacter(model) {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const rawSize = computeBounds(model).getSize(new THREE.Vector3());
  let scale = 0.01;
  if (isFinite(rawSize.y) && rawSize.y > 1e-6) {
    scale = THREE.MathUtils.clamp(LOBBY.targetHeight / rawSize.y, 1e-6, 1e6);
  }
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const box = computeBounds(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.updateMatrixWorld(true);

  return Math.max(computeBounds(model).getSize(new THREE.Vector3()).y, 0.0001);
}

/* ---- Toon outline (same inverted-hull trick as game.html) ------------ */
function createOutlineMaterial(thickness) {
  const mat = new THREE.MeshBasicMaterial({
    color: LOBBY.outlineColor,
    side: THREE.BackSide,
    toneMapped: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineThickness = { value: thickness };
    shader.vertexShader = 'uniform float uOutlineThickness;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_vertex>',
      [
        '#include <skinning_vertex>',
        '#ifdef USE_SKINNING',
        '  transformed += normalize( objectNormal ) * uOutlineThickness;',
        '#else',
        '  transformed += normalize( normal ) * uOutlineThickness;',
        '#endif',
      ].join('\n')
    );
  };
  mat.customProgramCacheKey = () => 'lobby-toon-outline-v1';
  return mat;
}

function addOutline(mesh, worldThickness) {
  if (!mesh || !mesh.parent) return;
  const ws = new THREE.Vector3();
  mesh.getWorldScale(ws);
  const avgScale = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;

  const outline = mesh.clone(false);
  outline.material = createOutlineMaterial(worldThickness / avgScale);
  outline.name = (mesh.name || 'mesh') + '_outline';
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.frustumCulled = false;
  outline.userData.__isOutline = true;
  mesh.parent.add(outline);
}

function loadFBX(path) {
  return new Promise((resolve, reject) => {
    new FBXLoader().load(
      path,
      resolve,
      undefined,
      (err) => reject(new Error('Failed to load ' + path + ': ' + ((err && err.message) || err)))
    );
  });
}

/* ---- Public entry point ---------------------------------------------- */
let startPromise = null;

/* Safe to call more than once (the RETRY button re-runs the menu boot). */
export function startLobby() {
  if (!startPromise) {
    startPromise = buildLobby().catch((err) => {
      startPromise = null;
      throw err;
    });
  }
  return startPromise;
}

async function buildLobby() {
  const idleFbx = await loadFBX(CHARACTER_PATHS.idle);

  const canvas = document.createElement('canvas');
  canvas.id = 'lobby-canvas';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;' +
    'z-index:0;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    canvas.remove();
    throw err;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(LOBBY.fov, 1, 0.1, 100);

  /* Same light rig as the game so the character looks identical. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x4a6b3a, 0.85));

  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  scene.add(sun);

  /* Invisible ground that only shows the character's shadow. */
  const shadowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: LOBBY.shadowOpacity })
  );
  shadowGround.rotation.x = -Math.PI / 2;
  shadowGround.receiveShadow = true;
  scene.add(shadowGround);

  /* Character */
  const model = idleFbx;
  const gradientMap = makeToonGradientMap(LOBBY.gradientSteps);
  applyColors(model, gradientMap);
  const charHeight = normalizeCharacter(model);

  const pivot = new THREE.Group();
  pivot.name = 'LobbyCharacter';
  pivot.rotation.y = LOBBY.facingAngle;
  pivot.add(model);
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  sun.target = pivot;

  const meshes = [];
  model.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && !o.userData.__isOutline) meshes.push(o);
  });
  for (const m of meshes) addOutline(m, LOBBY.outlineThickness);

  /* Idle animation */
  let mixer = null;
  if (idleFbx.animations && idleFbx.animations.length > 0) {
    const clip = idleFbx.animations[0];
    stripHorizontalRootMotion(clip);
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
  }

  /* Framing: places the character at screenX / feetY / heightFrac of the
     viewport whatever the aspect ratio is. */
  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    camera.fov = LOBBY.fov;
    camera.updateProjectionMatrix();

    const ndcFeet = 1 - 2 * LOBBY.feetY;
    const ndcHead = 1 - 2 * (LOBBY.feetY - LOBBY.heightFrac);
    const halfH = charHeight / (ndcHead - ndcFeet);      // half view height at the character
    const halfW = halfH * camera.aspect;
    const dist = halfH / Math.tan(THREE.MathUtils.degToRad(LOBBY.fov / 2));
    const camY = -ndcFeet * halfH;

    camera.position.set(0, camY, dist);
    camera.lookAt(0, camY, 0);

    pivot.position.x = (LOBBY.screenX * 2 - 1) * halfW;
    sun.position.set(pivot.position.x + 5, 10, 3);
  }
  layout();

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => {
    setTimeout(layout, 60);
    setTimeout(layout, 350);
  });

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const delta = Math.min(clock.getDelta(), 0.1);
    /* The game runs in a full-screen iframe on top of this page: no need
       to draw the lobby underneath it. */
    if (document.getElementById('game-frame')) return;
    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
  }
  frame();

  return { canvas, renderer, scene, camera };
}