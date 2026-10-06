import {
  Application,
  BLEND_NORMAL,
  Color,
  Entity,
  FILLMODE_NONE,
  PROJECTION_ORTHOGRAPHIC,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import { sfx } from './audio.js';

// --- SNAPCHAT WEB LENS API ---
let snapchatReady = false;
const snapchatInit = (async () => {
  try {
    await snapchat.init();
    snapchatReady = true;
  } catch (err) {
    console.warn('[WebLens] Snap API unavailable:', err);
  }
})();

// Bitmoji portrait on the menu and results (2D; URLs expire after ~5 min, so fetch fresh each time)
async function loadBitmoji() {
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'medium' });
    const img = new Image();
    img.onload = () => {
      document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = `url("${url}")`));
      document.body.classList.add('has-avatar');
    };
    img.src = url;
  } catch (e) {
    console.warn('[WebLens] No Bitmoji:', e?.message);
  }
}
loadBitmoji();

// --- TUNING ---
const BLOCK_H = 0.5;
const BASE_SIZE = 3;
const SLIDE = 4.4; // how far from the tower's centre a block slides before turning back
const SPEED_START = 3.3; // world units per second
const SPEED_STEP = 0.075; // added per block stacked
const SPEED_MAX = 7.6;
const PERFECT_TOL = 0.11; // drops within this distance snap into place
const GROW_FROM_COMBO = 3; // from this streak length, perfect drops grow the block back
const GROW_STEP = 0.2;
const HUE_STEP = 5; // degrees of hue drift per block
const ORTHO_PLAY = 8.6; // half the visible height, in world units, while playing
const CAM_OFFSET = new Vec3(10, 8.6, 10); // isometric-ish view from the +X/+Z corner
const GRAVITY = 24;

const OVER_LINES = [
  [0, 'Shaky start. Your thumb is still warming up.'],
  [10, 'Solid tower. The good ones go past 25.'],
  [25, "Now that's a tower. Who do you know that can beat it?"],
  [50, 'Skyscraper territory. Screenshot this.'],
  [100, 'Absolutely unhinged precision.'],
];

// --- ENGINE ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
const app = new Application(canvas, {
  graphicsDeviceOptions: { alpha: true, antialias: true },
});
app.setCanvasFillMode(FILLMODE_NONE);
app.setCanvasResolution(RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

// The canvas tracks the phone-shaped container, not the window
function fitCanvas() {
  const { width, height } = container.getBoundingClientRect();
  app.resizeCanvas(Math.round(width), Math.round(height));
}
new ResizeObserver(fitCanvas).observe(container);
fitCanvas();

// Transparent clear: the CSS gradient behind the canvas is the sky
const camera = new Entity('camera');
camera.addComponent('camera', {
  projection: PROJECTION_ORTHOGRAPHIC,
  orthoHeight: ORTHO_PLAY,
  clearColor: new Color(0, 0, 0, 0),
  nearClip: 0.1,
  farClip: 400,
});
app.root.addChild(camera);

// Light travels along (-0.3, -1, -0.6): tops brightest, +Z faces mid, +X faces darkest
const sun = new Entity('sun');
sun.addComponent('light', { type: 'directional', color: new Color(1, 0.98, 0.95), intensity: 1.05 });
sun.lookAt(new Vec3(-0.3, -1, -0.6));
sun.rotateLocal(90, 0, 0);
app.root.addChild(sun);
app.scene.ambientLight = new Color(0.26, 0.26, 0.32);

// --- HELPERS ---
function hsl(h, s, l, out = new Color()) {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return out.set(f(0), f(8), f(4), 1);
}

const blockColor = (hue) => hsl(hue, 0.72, 0.62);

function makeBlockMaterial(hue) {
  const mat = new StandardMaterial();
  mat.diffuse = blockColor(hue);
  mat.specular = new Color(0.04, 0.04, 0.04);
  mat.gloss = 0.2;
  mat.emissive = new Color(0, 0, 0);
  mat.update();
  return mat;
}

function makeBox(name, material) {
  const e = new Entity(name);
  e.addComponent('render', { type: 'box' });
  e.render.meshInstances[0].material = material;
  app.root.addChild(e);
  return e;
}

// --- GAME STATE ---
const STATE_MENU = 'menu';
const STATE_PLAYING = 'playing';
const STATE_OVER = 'over';

let state = STATE_MENU;
let runHue = 0;
let combo = 0;
let perfects = 0;
let bestScore = 0;
let autopilot = null; // dev capture only: (dt) => void, may call place()

/** Placed blocks, bottom first. y is the block's centre. tower[0] is the pedestal's top slab. */
let tower = [];
/** The block currently sliding over the tower. */
let moving = null;
const debris = [];
const ripples = [];

const camFocus = new Vec3(0, 0, 0);
let orthoTarget = ORTHO_PLAY;
let focusTargetY = 0;

const pedestalMat = makeBlockMaterial(0);
const pedestal = makeBox('pedestal', pedestalMat);
pedestal.setLocalScale(BASE_SIZE, 30, BASE_SIZE);
pedestal.setPosition(0, -15, 0);

const score = () => tower.length - 1;
const speed = () => Math.min(SPEED_MAX, SPEED_START + score() * SPEED_STEP);

// --- DOM ---
const $ = (id) => document.getElementById(id);
const scoreEl = $('score');
const comboEl = $('combo');
const menuBest = $('menu-best');
const overScore = $('over-score');
const overBest = $('over-best');
const overPerfects = $('over-perfects');
const overLine = $('over-line');
const newBest = $('new-best');
const toast = $('toast');

function setScreen(next) {
  state = next;
  container.classList.toggle('is-menu', next === STATE_MENU);
  container.classList.toggle('is-over', next === STATE_OVER);
}

function renderBest() {
  menuBest.textContent = bestScore > 0 ? `Best ${bestScore}` : '';
}

function bumpScore() {
  scoreEl.textContent = String(score());
  scoreEl.classList.remove('bump');
  void scoreEl.offsetWidth; // restart the animation
  scoreEl.classList.add('bump');
}

let comboTimer = 0;
function showCombo() {
  comboEl.innerHTML = combo > 1 ? `Perfect<b>×${combo}</b>` : 'Perfect';
  comboEl.classList.add('show');
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => comboEl.classList.remove('show'), 900);
}

let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// --- TOWER ---
function clearEffects() {
  for (const d of debris) d.entity.destroy();
  for (const r of ripples) r.root.destroy();
  debris.length = 0;
  ripples.length = 0;
}

function resetTower() {
  for (const b of tower) b.entity?.destroy();
  if (moving) moving.entity.destroy();
  clearEffects();
  moving = null;
  combo = 0;
  perfects = 0;

  runHue = Math.random() * 360;
  pedestalMat.diffuse = hsl(runHue, 0.5, 0.42);
  pedestalMat.update();

  // The pedestal's top slab acts as block 0, so the first drop has something to land on
  tower = [{ x: 0, z: 0, w: BASE_SIZE, d: BASE_SIZE, y: -BLOCK_H / 2, hue: runHue, entity: null }];
  focusTargetY = 2.2;
  camFocus.y = focusTargetY;
  orthoTarget = ORTHO_PLAY;
  camera.camera.orthoHeight = ORTHO_PLAY;
  scoreEl.textContent = '0';
}

function placeEntity(block) {
  block.entity.setPosition(block.x, block.y, block.z);
  block.entity.setLocalScale(block.w, BLOCK_H, block.d);
}

function spawnMoving() {
  const top = tower[tower.length - 1];
  const axis = tower.length % 2 === 1 ? 'x' : 'z';
  const hue = runHue + tower.length * HUE_STEP;
  const material = makeBlockMaterial(hue);
  moving = {
    axis,
    x: top.x,
    z: top.z,
    w: top.w,
    d: top.d,
    y: top.y + BLOCK_H,
    dir: 1,
    hue,
    material,
    flash: 0,
    entity: makeBox('block', material),
  };
  moving[axis] = top[axis] - SLIDE;
  placeEntity(moving);
}

function spawnDebris(block, axis, center, length) {
  const piece = { ...block };
  piece[axis] = center;
  piece[axis === 'x' ? 'w' : 'd'] = length;
  piece.entity = makeBox('debris', block.material);
  placeEntity(piece);

  const sign = Math.sign(center - block[axis]) || 1;
  debris.push({
    entity: piece.entity,
    vel: new Vec3(axis === 'x' ? sign * 1.4 : 0, 0.6, axis === 'z' ? sign * 1.4 : 0),
    // Tip over the cut edge: rotate about the axis perpendicular to the slide
    spin: new Vec3(axis === 'z' ? sign * 160 : 0, 0, axis === 'x' ? -sign * 160 : 0),
    age: 0,
  });
}

function spawnRipple(block, delay) {
  const material = new StandardMaterial();
  material.useLighting = false;
  material.diffuse = new Color(0, 0, 0);
  material.emissive = new Color(1, 1, 1);
  material.opacity = 0;
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.update();

  const root = new Entity('ripple');
  root.setPosition(block.x, block.y + BLOCK_H / 2 + 0.01, block.z);
  const bars = [0, 1, 2, 3].map(() => {
    const bar = new Entity('ripple-bar');
    bar.addComponent('render', { type: 'box' });
    bar.render.meshInstances[0].material = material;
    root.addChild(bar);
    return bar;
  });
  app.root.addChild(root);
  ripples.push({ root, bars, material, w: block.w, d: block.d, t: -delay });
}

function updateRipples(dt) {
  const DURATION = 0.6;
  const T = 0.1; // bar thickness
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.t += dt;
    if (r.t >= DURATION) {
      r.root.destroy();
      ripples.splice(i, 1);
      continue;
    }
    const p = Math.max(0, r.t) / DURATION;
    const pad = 0.08 + (1 - (1 - p) ** 3) * 0.75;
    const w = r.w + pad * 2;
    const d = r.d + pad * 2;
    const [a, b, c, e] = r.bars;
    a.setLocalPosition(0, 0, d / 2);
    a.setLocalScale(w + T, 0.02, T);
    b.setLocalPosition(0, 0, -d / 2);
    b.setLocalScale(w + T, 0.02, T);
    c.setLocalPosition(w / 2, 0, 0);
    c.setLocalScale(T, 0.02, d);
    e.setLocalPosition(-w / 2, 0, 0);
    e.setLocalScale(T, 0.02, d);
    r.material.opacity = r.t < 0 ? 0 : 1 - p * p;
    r.material.update();
  }
}

function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.age += dt;
    d.vel.y -= GRAVITY * dt;
    const p = d.entity.getPosition();
    d.entity.setPosition(p.x + d.vel.x * dt, p.y + d.vel.y * dt, p.z + d.vel.z * dt);
    d.entity.rotate(d.spin.x * dt, 0, d.spin.z * dt);
    if (d.age > 4) {
      d.entity.destroy();
      debris.splice(i, 1);
    }
  }
}

// --- CORE MOVE: drop the sliding block ---
function place() {
  if (state !== STATE_PLAYING || !moving) return;
  const top = tower[tower.length - 1];
  const axis = moving.axis;
  const sizeKey = axis === 'x' ? 'w' : 'd';
  const delta = moving[axis] - top[axis];
  const overlap = moving[sizeKey] - Math.abs(delta);

  if (overlap <= 0) {
    // Missed the tower completely: the whole block falls
    spawnDebris(moving, axis, moving[axis], moving[sizeKey]);
    moving.entity.destroy();
    moving = null;
    sfx.miss();
    gameOver();
    return;
  }

  if (Math.abs(delta) <= PERFECT_TOL) {
    moving[axis] = top[axis];
    combo += 1;
    perfects += 1;
    moving.flash = 1;
    sfx.perfect(combo);
    spawnRipple(moving, 0);
    if (combo >= GROW_FROM_COMBO) {
      moving[sizeKey] = Math.min(BASE_SIZE, moving[sizeKey] + GROW_STEP);
      spawnRipple(moving, 0.12);
      sfx.grow();
    }
    showCombo();
    try {
      navigator.vibrate?.(12);
    } catch {}
  } else {
    combo = 0;
    const center = top[axis] + delta / 2;
    const cut = Math.abs(delta);
    spawnDebris(moving, axis, center + Math.sign(delta) * (overlap + cut) / 2, cut);
    moving[sizeKey] = overlap;
    moving[axis] = center;
    sfx.slice();
  }

  sfx.place();
  placeEntity(moving);
  tower.push(moving);
  moving = null;
  focusTargetY = tower[tower.length - 1].y + 2.2;
  bumpScore();
  spawnMoving();
}

// --- GAME FLOW ---
function startGame() {
  sfx.init();
  sfx.start();
  resetTower();
  setScreen(STATE_PLAYING);
  spawnMoving();
}

async function gameOver() {
  setScreen(STATE_OVER);
  const final = score();

  // Pull the camera back so the whole tower fits above the results sheet
  const topY = tower[tower.length - 1].y + BLOCK_H / 2;
  const height = topY + 1.5;
  orthoTarget = Math.max(ORTHO_PLAY, (height * 0.82 + 3.6) / 1.15);
  focusTargetY = topY - height / 2 - orthoTarget * 0.36;

  const isNewBest = final > bestScore;
  if (isNewBest) {
    bestScore = final;
    renderBest();
  }
  overScore.textContent = String(final);
  overBest.textContent = String(bestScore);
  overPerfects.textContent = String(perfects);
  newBest.classList.toggle('show', isNewBest && final > 0);
  overLine.textContent = OVER_LINES.filter(([min]) => final >= min).pop()[1];
  loadBitmoji(); // fresh URL for the results sheet

  if (snapchatReady) {
    if (snapchat.isSupported('leaderboards')) {
      try {
        await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score: final });
      } catch (e) {
        console.warn('[WebLens] Leaderboard submit failed:', e);
      }
    }
    if (isNewBest && snapchat.isSupported('storage')) {
      try {
        await snapchat.storage.set('best', bestScore);
      } catch {}
    }
  }
}

async function loadBest() {
  await snapchatInit;
  if (!snapchatReady || !snapchat.isSupported('storage')) return;
  try {
    const { found, value } = await snapchat.storage.get('best');
    if (found && Number(value) > bestScore) {
      bestScore = Number(value);
      renderBest();
    }
  } catch {}
}

// --- INPUT ---
container.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  sfx.init();
  if (state === STATE_MENU) startGame();
  else if (state === STATE_PLAYING) place();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  e.preventDefault();
  if (state === STATE_PLAYING) place();
  else startGame();
});

$('btn-again').addEventListener('click', startGame);

// Snapchat's own leaderboard panel, where the host supports it
snapchatInit.then(() => {
  $('btn-board').hidden = !(snapchatReady && !snapchat.isStub && snapchat.isSupported('leaderboards'));
});
$('btn-board').addEventListener('click', async () => {
  try {
    await snapchat.leaderboards.show();
  } catch {
    showToast('Leaderboard unavailable');
  }
});

$('btn-challenge').addEventListener('click', async () => {
  const text = `I stacked ${score()} blocks. How high can you stack?`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'How High Can You Stack?', text });
      return;
    } catch {}
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Challenge copied');
      return;
    } catch {}
  }
  showToast('Screenshot your tower and send it');
});

// --- FRAME LOOP ---
let shownHue = null;
const tmpColor = new Color();

function updateSky(dt) {
  const target = runHue + tower.length * HUE_STEP;
  shownHue = shownHue === null ? target : shownHue + (target - shownHue) * Math.min(1, dt * 3);
  const h = shownHue.toFixed(1);
  // The sky stays in a deep blue-to-violet band (never muddy olive or brown), drifting with the
  // complement of the blocks' hue so the tower always stands out against it
  const complement = (((shownHue + 180) % 360) + 360) % 360;
  const sky = 205 + (complement / 360) * 95;
  container.style.setProperty('--bg-top', `hsl(${sky.toFixed(1)} 44% 27%)`);
  container.style.setProperty('--bg-bot', `hsl(${(sky + 25).toFixed(1)} 52% 9%)`);
  container.style.setProperty('--accent', `hsl(${h} 60% 40%)`);
}

app.on('update', (dt) => {
  if (state === STATE_PLAYING && moving) {
    if (autopilot) autopilot(dt);
  }
  if (state === STATE_PLAYING && moving) {
    const top = tower[tower.length - 1];
    const axis = moving.axis;
    moving[axis] += moving.dir * speed() * dt;
    if (moving[axis] > top[axis] + SLIDE) {
      moving[axis] = top[axis] + SLIDE;
      moving.dir = -1;
    } else if (moving[axis] < top[axis] - SLIDE) {
      moving[axis] = top[axis] - SLIDE;
      moving.dir = 1;
    }
    placeEntity(moving);
  }

  // Perfect-drop flash on the newest block
  const newest = tower[tower.length - 1];
  if (newest?.flash > 0) {
    newest.flash = Math.max(0, newest.flash - dt * 4);
    const f = newest.flash * 0.55;
    newest.material.emissive = tmpColor.set(f, f, f);
    newest.material.update();
  }

  updateDebris(dt);
  updateRipples(dt);
  updateSky(dt);

  // Camera: ease toward the focus point and zoom
  const k = 1 - Math.exp(-dt * (state === STATE_OVER ? 2.6 : 7));
  camFocus.y += (focusTargetY - camFocus.y) * k;
  const cam = camera.camera;
  cam.orthoHeight += (orthoTarget - cam.orthoHeight) * k;
  camera.setPosition(camFocus.x + CAM_OFFSET.x, camFocus.y + CAM_OFFSET.y, camFocus.z + CAM_OFFSET.z);
  camera.lookAt(camFocus);
});

resetTower();
renderBest();
loadBest();

// Dev-only preview/icon recorder hooks (tools/record-preview.mjs); stripped from production builds
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      app,
      sfx,
      camera,
      camFocus,
      tower: () => tower,
      moving: () => moving,
      speed,
      place,
      startGame,
      clearEffects,
      perfectTolerance: PERFECT_TOL,
      setAutopilot: (fn) => (autopilot = fn),
      setFocusTarget: (y, ortho) => {
        focusTargetY = y;
        orthoTarget = ortho;
      },
    })
  );
}

app.start();
