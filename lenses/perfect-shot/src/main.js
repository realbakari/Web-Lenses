import {
  Application,
  Asset,
  BLEND_NORMAL,
  CameraFrame,
  Color,
  Entity,
  FILLMODE_NONE,
  FOG_LINEAR,
  RESOLUTION_AUTO,
  StandardMaterial,
  TONEMAP_NEUTRAL,
  Texture,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource/caveat/700.css';
import '@fontsource-variable/dm-sans/wght.css';
import { sfx } from './audio.js';
import { SCENE_ORDER, createScene } from './scenes.js';

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

// --- TUNING ---
const SHOTS = 6;
const REVIEW_SECONDS = 1.9;
const YAW_LIMIT = 16;
const PITCH_LIMIT = 10;
const PHOTOBOMB_BONUS = 25;
const DUO_BONUS = 15;
const DAILY_EPOCH = new Date(2026, 9, 6); // Daily Shoot #1

// --- RANDOM ---
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function today() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(midnight.getTime() - 86400000);
  return { key: dayKey(midnight), yesterday: dayKey(yesterday), number: Math.round((midnight - DAILY_EPOCH) / 86400000) + 1 };
}

// --- ENGINE ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
// preserveDrawingBuffer: the shutter copies the last rendered frame into the photo
const app = new Application(canvas, { graphicsDeviceOptions: { antialias: false, preserveDrawingBuffer: true } });
app.setCanvasFillMode(FILLMODE_NONE);
app.setCanvasResolution(RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

function fitCanvas() {
  const { width, height } = container.getBoundingClientRect();
  app.resizeCanvas(Math.round(width), Math.round(height));
}
new ResizeObserver(fitCanvas).observe(container);
fitCanvas();

const camera = new Entity('camera');
camera.addComponent('camera', { fov: 52, horizontalFov: true, nearClip: 0.1, farClip: 600, clearColor: new Color(0.08, 0.07, 0.06) });
app.root.addChild(camera);

const frame = new CameraFrame(app, camera.camera);
frame.rendering.toneMapping = TONEMAP_NEUTRAL; // keeps the toy-like colours saturated
frame.rendering.samples = 1;
frame.bloom.intensity = 0.02;
frame.bloom.blurLevel = 12;
frame.vignette.intensity = 0.3;
frame.update();

app.scene.fog.type = FOG_LINEAR;
app.scene.fog.start = 70;
app.scene.fog.end = 300;

const sun = new Entity('sun');
sun.addComponent('light', { type: 'directional', intensity: 1.4 });
app.root.addChild(sun);

function applyLight(def) {
  const { key, ambient, dir } = def.light;
  sun.light.color = new Color(...key);
  sun.setRotation(0, 0, 0, 1);
  sun.lookAt(new Vec3(...dir));
  sun.rotateLocal(90, 0, 0);
  app.scene.ambientLight = new Color(...ambient);
  app.scene.fog.color = new Color(...def.fog);
}

// --- PHOTOBOMB BILLBOARD (your Bitmoji, or a cheerful stand-in) ---
const bombTextures = [];
function fallbackBombTexture() {
  // Stand-in photobomber when there's no Bitmoji: a round buddy throwing a peace sign
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d');
  const ink = '#2b2118';
  g.lineWidth = 9;
  g.strokeStyle = ink;
  g.lineJoin = 'round';
  // Body
  g.fillStyle = '#4d7cff';
  g.beginPath();
  g.roundRect(64, 196, 128, 120, 40);
  g.fill();
  g.stroke();
  // Raised arm with a peace sign
  g.fillStyle = '#ffd7b0';
  g.beginPath();
  g.roundRect(186, 120, 30, 96, 15);
  g.fill();
  g.stroke();
  for (const [x, a] of [[194, -0.25], [212, 0.25]]) {
    g.save();
    g.translate(x, 122);
    g.rotate(a);
    g.beginPath();
    g.roundRect(-8, -54, 16, 58, 8);
    g.fill();
    g.stroke();
    g.restore();
  }
  // Head
  g.beginPath();
  g.arc(124, 132, 74, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#3b2a1f';
  g.beginPath();
  g.arc(124, 112, 74, Math.PI * 1.08, Math.PI * 1.92);
  g.fill();
  g.fillStyle = ink;
  for (const x of [98, 150]) {
    g.beginPath();
    g.ellipse(x, 136, 9, 13, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(124, 152, 30, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  const t = new Texture(app.graphicsDevice, { width: 256, height: 320 });
  t.setSource(c);
  return t;
}
const bombFallback = fallbackBombTexture();

const bombMat = new StandardMaterial();
bombMat.useLighting = false;
bombMat.useFog = false;
bombMat.diffuse = new Color(0, 0, 0);
bombMat.emissive = new Color(1, 1, 1);
bombMat.emissiveMap = bombFallback;
bombMat.opacityMap = bombFallback;
bombMat.opacityMapChannel = 'a';
bombMat.alphaTest = 0.4;
bombMat.blendType = BLEND_NORMAL;
bombMat.update();

const bomb = new Entity('photobomb');
const bombQuad = new Entity('photobomb-quad');
bombQuad.addComponent('render', { type: 'plane', material: bombMat });
bombQuad.setLocalEulerAngles(90, 180, 0); // stand the plane up, facing the parent's +z
bomb.addChild(bombQuad);
app.root.addChild(bomb);
bomb.enabled = false;

function setBombTexture(tex) {
  bombMat.emissiveMap = tex;
  bombMat.opacityMap = tex;
  bombMat.update();
}

// --- STATE ---
let state = 'menu';
let mode = { daily: true, number: 1, key: '' };
let roll = []; // scene ids for this roll
let rollRng = Math.random;
let shotIndex = 0;
let scene = null;
let t = 0;
let shot = null; // result of the current round's shot
let reviewTimer = 0;
let yaw = 0;
let pitch = 0;
let bombPlan = null; // { pos, appear, float } when this round has a photobomb
let results = [];
let total = 0;
let menuScene = null;
let autopilot = null; // dev capture only
let cameraOverride = null; // dev capture only
let devFreeze = null; // dev capture only: hold the scene at this time
let noBombs = false; // dev capture only

const saved = { streak: 0, lastDaily: '', dailyKey: '', dailyBest: 0, bestFree: 0 };

// --- DOM ---
const $ = (id) => document.getElementById(id);
const ui = {
  vfMode: $('vf-mode'),
  vfCount: $('vf-count'),
  vfScore: $('vf-score'),
  prompt: $('prompt'),
  frame: $('frame'),
  reticle: $('reticle'),
  roll: $('roll'),
  shutter: $('shutter'),
  timerRing: $('timer-ring'),
  flash: $('flash'),
  review: $('review'),
  reviewImg: $('review-img'),
  reviewCap: $('review-cap'),
  reviewScore: $('review-score'),
  rating: $('rating'),
  breakdown: $('breakdown'),
  menu: $('menu'),
  over: $('over'),
  streak: $('streak'),
  dailyName: $('daily-name'),
  dailySide: $('daily-side'),
  freeSide: $('free-side'),
  overTitle: $('over-title'),
  overSub: $('over-sub'),
  overTotal: $('over-total'),
  newBest: $('new-best'),
  scrapbook: $('scrapbook'),
  toast: $('toast'),
};
const RING = 2 * Math.PI * 45;
ui.timerRing.style.strokeDasharray = `${RING}`;

function setScreen(name) {
  container.classList.toggle('is-menu', name === 'menu');
  container.classList.toggle('is-over', name === 'over');
  ui.menu.classList.toggle('hidden', name !== 'menu');
  ui.over.classList.toggle('hidden', name !== 'over');
}

let toastTimer = 0;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function renderMenu() {
  const d = today();
  ui.dailyName.textContent = `Daily Shoot #${d.number}`;
  ui.dailySide.textContent = saved.dailyKey === d.key ? String(saved.dailyBest) : 'New';
  ui.freeSide.textContent = saved.bestFree ? String(saved.bestFree) : '';
  const streakAlive = saved.lastDaily === d.key || saved.lastDaily === d.yesterday;
  ui.streak.innerHTML = saved.streak > 0 && streakAlive ? `🔥 <b>${saved.streak}-day streak</b> · keep it going` : 'Your camera is ready';
}

// --- SCENES ---
function loadScene(id, rng) {
  if (scene) scene.root.destroy();
  scene = createScene(app, id, rng, sfx);
  applyLight(scene.def);
  t = 0;
  yaw = (rng() - 0.5) * 10; // start a little off the action, so aiming matters
  pitch = 0;
}

function placeCamera(dt) {
  const { pos, look, fov } = scene.camera;
  camera.camera.fov = fov;
  camera.setPosition(...pos);
  camera.lookAt(new Vec3(...look));
  // A touch of handheld sway
  const sway = state === 'shoot' ? 0.35 : 0.15;
  const time = performance.now() / 1000;
  camera.rotateLocal(pitch + Math.sin(time * 1.3) * sway, yaw + Math.sin(time * 0.9) * sway, 0);
  void dt;
}

// --- FRAME GEOMETRY (the 4:5 photo area, in canvas CSS pixels) ---
function frameRect() {
  const c = canvas.getBoundingClientRect();
  const f = ui.frame.getBoundingClientRect();
  return { x: f.left - c.left, y: f.top - c.top, w: f.width, h: f.height, cx: f.left - c.left + f.width / 2, cy: f.top - c.top + f.height / 2 };
}

const tmp = new Vec3();
const screen = new Vec3();
/** Where a world point lands in the frame: normalised so ±1 is the frame's half width. */
function frameCoords(world) {
  const r = frameRect();
  camera.camera.worldToScreen(world, screen);
  const toCam = tmp.copy(world).sub(camera.getPosition());
  const ahead = toCam.dot(camera.forward) > 0;
  const nx = (screen.x - r.cx) / (r.w / 2);
  const ny = (screen.y - r.cy) / (r.w / 2);
  const inside = ahead && Math.abs(screen.x - r.cx) <= r.w / 2 && Math.abs(screen.y - r.cy) <= r.h / 2;
  return { nx, ny, inside, ahead };
}

// --- PHOTO ---
const photoCanvas = document.createElement('canvas');
photoCanvas.width = 480;
photoCanvas.height = 600;
function takePhoto() {
  try {
    const r = frameRect();
    const k = canvas.width / canvas.getBoundingClientRect().width;
    const g = photoCanvas.getContext('2d');
    g.drawImage(canvas, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, photoCanvas.width, photoCanvas.height);
    return photoCanvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[PerfectShot] Photo capture failed:', e);
    return null;
  }
}

// --- SCORING ---
function scoreShot() {
  const dt = t - scene.peak;
  const timing = Math.round(100 * Math.exp(-((dt / (scene.tolerance * 2.2)) ** 2)));
  const subject = frameCoords(scene.focus(new Vec3()));
  const d = Math.hypot(subject.nx, subject.ny);
  let framing = subject.ahead ? Math.round(100 * Math.max(0, Math.min(1, 1 - Math.max(0, d - 0.12) / 0.75))) : 0;
  if (!subject.inside) framing = Math.round(framing * 0.3);

  const bonuses = [];
  if (scene.extras) {
    const both = scene.extras().every((p) => frameCoords(p).inside);
    if (both) bonuses.push({ label: 'Both in frame', points: DUO_BONUS });
  }
  if (bomb.enabled && bomb.getLocalScale().y > 0.6 && frameCoords(bomb.getPosition().clone().add(new Vec3(0, 0.7, 0))).inside) {
    bonuses.push({ label: 'Photobomb!', points: PHOTOBOMB_BONUS });
  }
  const base = Math.round(timing * 0.6 + framing * 0.4);
  const points = base + bonuses.reduce((s, b) => s + b.points, 0);

  let rating;
  let tier;
  if (timing < 50) {
    rating = dt < 0 ? 'Too early!' : 'Too late!';
    tier = 0;
  } else if (framing < 45) {
    rating = 'Off-centre';
    tier = 0;
  } else if (base >= 90) {
    rating = 'Perfect shot!';
    tier = 3;
  } else if (base >= 75) {
    rating = 'Great shot';
    tier = 2;
  } else {
    rating = 'Nice';
    tier = 1;
  }
  return { timing, framing, bonuses, points, rating, tier, dt };
}

// --- ROUND FLOW ---
function renderRoll() {
  ui.roll.innerHTML = Array.from({ length: SHOTS }, (_, i) => `<i class="${i < results.length ? 'used' : ''}"></i>`).join('');
}

function startRound() {
  loadScene(roll[shotIndex], rollRng);
  shot = null;
  // About half the rounds that have a hiding spot get a photobomb
  bombPlan = scene.bomb && !noBombs && rollRng() < 0.6 ? scene.bomb : null;
  bomb.enabled = false;
  if (bombPlan && bombTextures.length) setBombTexture(bombTextures[shotIndex % bombTextures.length]);
  ui.prompt.textContent = scene.prompt;
  ui.prompt.style.opacity = '1';
  ui.vfCount.textContent = `SHOT ${shotIndex + 1}/${SHOTS}`;
  ui.vfScore.textContent = String(total);
  renderRoll();
  state = 'shoot';
  sfx.cue();
}

function pressShutter() {
  if (state !== 'shoot' || shot) return;
  sfx.init();
  const photo = takePhoto(); // the frame the player was looking at
  const result = scoreShot();
  shot = { ...result, photo };
  sfx.shutter();
  ui.flash.classList.add('show');
  setTimeout(() => ui.flash.classList.remove('show'), 60);
  try {
    navigator.vibrate?.(15);
  } catch {}
  showReview();
}

function missRound() {
  shot = { timing: 0, framing: 0, bonuses: [], points: 0, rating: 'Missed it', tier: 0, photo: null, missed: true };
  sfx.missed();
  showReview();
}

function showReview() {
  state = 'review';
  reviewTimer = REVIEW_SECONDS;
  results.push({ id: scene.id, caption: scene.caption, ...shot });
  total += shot.points;
  ui.vfScore.textContent = String(total);
  renderRoll();
  if (shot.photo) {
    ui.reviewImg.src = shot.photo;
    ui.reviewImg.style.visibility = 'visible';
  } else {
    ui.reviewImg.removeAttribute('src');
    ui.reviewImg.style.visibility = 'hidden';
  }
  ui.reviewCap.textContent = scene.caption;
  ui.reviewScore.textContent = String(shot.points);
  ui.rating.textContent = shot.rating;
  ui.rating.classList.toggle('perfect', shot.tier === 3);
  ui.breakdown.innerHTML = shot.missed
    ? ''
    : `<span>Timing <b>${shot.timing}</b></span><span>Framing <b>${shot.framing}</b></span>` +
      shot.bonuses.map((b) => `<span class="bonus">${b.label} +${b.points}</span>`).join('');
  ui.review.classList.add('show');
  if (!shot.missed) {
    sfx.rating(shot.tier);
    if (shot.bonuses.some((b) => b.label === 'Photobomb!')) sfx.photobomb();
  }
}

function endReview() {
  ui.review.classList.remove('show');
  shotIndex += 1;
  if (shotIndex < SHOTS) startRound();
  else finishRoll();
}

function startRoll(daily, forcedRoll = null) {
  sfx.init();
  const d = today();
  mode = { daily, number: d.number, key: d.key };
  const seed = daily ? hashString(`perfect-shot:${d.key}`) : Math.floor(Math.random() * 2 ** 32);
  rollRng = mulberry32(seed);
  // Every scene once, in a seeded order
  roll = [...SCENE_ORDER];
  for (let i = roll.length - 1; i > 0; i--) {
    const j = Math.floor(rollRng() * (i + 1));
    [roll[i], roll[j]] = [roll[j], roll[i]];
  }
  roll = forcedRoll ?? roll.slice(0, SHOTS);
  if (menuScene) {
    menuScene.root.destroy();
    menuScene = null;
  }
  shotIndex = 0;
  results = [];
  total = 0;
  ui.vfMode.textContent = daily ? `DAILY #${d.number}` : 'FREE SHOOT';
  setScreen('play');
  loadBitmojiVariants();
  startRound();
}

async function finishRoll() {
  state = 'over';
  sfx.rollDone();
  const d = today();
  let isBest = false;
  if (mode.daily) {
    if (saved.dailyKey !== d.key) {
      saved.dailyKey = d.key;
      saved.dailyBest = 0;
    }
    isBest = total > saved.dailyBest;
    if (isBest) saved.dailyBest = total;
    if (saved.lastDaily !== d.key) {
      saved.streak = saved.lastDaily === d.yesterday ? saved.streak + 1 : 1;
      saved.lastDaily = d.key;
    }
  } else {
    isBest = total > saved.bestFree;
    if (isBest) saved.bestFree = total;
  }

  ui.overTitle.textContent = mode.daily ? `Daily Shoot #${mode.number}` : 'Free Shoot';
  const perfects = results.filter((r) => r.tier === 3).length;
  ui.overSub.textContent = mode.daily
    ? `🔥 ${saved.streak}-day streak · ${perfects} perfect ${perfects === 1 ? 'shot' : 'shots'}`
    : `${perfects} perfect ${perfects === 1 ? 'shot' : 'shots'}`;
  ui.overTotal.textContent = String(total);
  ui.newBest.textContent = mode.daily ? 'Best today' : 'New best';
  ui.newBest.classList.toggle('show', isBest && total > 0);
  ui.scrapbook.innerHTML = results
    .map(
      (r) =>
        `<div class="polaroid">${r.photo ? `<img src="${r.photo}" alt="">` : '<div class="blank"></div>'}<div class="cap"><span>${r.caption}</span><span>${r.points}</span></div></div>`
    )
    .join('');
  setScreen('over');
  renderMenu();

  if (snapchatReady) {
    if (snapchat.isSupported('leaderboards')) {
      try {
        await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score: total });
      } catch (e) {
        console.warn('[WebLens] Leaderboard submit failed:', e);
      }
    }
    if (snapchat.isSupported('storage')) {
      try {
        await snapchat.storage.set('save', { ...saved });
      } catch {}
    }
  }
}

// --- BITMOJI ---
function loadTexture(name, url) {
  return new Promise((resolve, reject) => {
    const asset = new Asset(name, 'texture', { url }, { crossOrigin: 'anonymous' });
    asset.ready(() => resolve(asset.resource));
    asset.once('error', (err) => {
      app.assets.remove(asset);
      reject(err);
    });
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

async function loadPortrait() {
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return false;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return false;
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'medium' });
    const img = new Image();
    img.onload = () => {
      document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = `url("${url}")`));
      document.body.classList.add('has-avatar');
    };
    img.src = url;
    return true;
  } catch {
    return false;
  }
}

// Photobombs use the server-curated Bitmoji variants, so each one strikes a different pose
async function loadBitmojiVariants() {
  if (bombTextures.length) return;
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    const { variants } = await snapchat.bitmoji.getVariants();
    const picks = variants.slice(0, 3);
    const urls = await Promise.all(
      (picks.length ? picks : [undefined]).map((variant) => snapchat.bitmoji.get2DAvatar(variant ? { variant, size: 'medium' } : { size: 'medium' }))
    );
    // Load immediately: the URLs expire after ~5 minutes
    for (const [i, { url }] of urls.entries()) {
      try {
        bombTextures.push(await loadTexture(`bitmoji-${i}`, url));
      } catch {}
    }
  } catch (e) {
    console.warn('[WebLens] Bitmoji photobombs unavailable:', e?.message);
  }
}

async function loadSave() {
  await snapchatInit;
  if (!snapchatReady || !snapchat.isSupported('storage')) return;
  try {
    const { found, value } = await snapchat.storage.get('save');
    if (found && value) Object.assign(saved, value);
    renderMenu();
  } catch {}
}

// --- INPUT: drag to aim, tap the shutter ---
let aimId = null;
let lastX = 0;
let lastY = 0;
container.addEventListener('pointerdown', (e) => {
  if (state !== 'shoot' || e.target.closest('button, .screen:not(.hidden)')) return;
  sfx.init();
  aimId = e.pointerId;
  lastX = e.clientX;
  lastY = e.clientY;
});
container.addEventListener('pointermove', (e) => {
  if (e.pointerId !== aimId) return;
  const { width } = container.getBoundingClientRect();
  const k = 70 / width; // degrees per screen width
  yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, yaw - (e.clientX - lastX) * k));
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - (e.clientY - lastY) * k));
  lastX = e.clientX;
  lastY = e.clientY;
});
const endAim = (e) => e.pointerId === aimId && (aimId = null);
container.addEventListener('pointerup', endAim);
container.addEventListener('pointercancel', endAim);
ui.shutter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pressShutter();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') pressShutter();
});

$('btn-daily').addEventListener('click', () => startRoll(true));
$('btn-free').addEventListener('click', () => startRoll(false));
$('btn-again').addEventListener('click', () => startRoll(mode.daily));
$('btn-menu').addEventListener('click', () => showMenu());
$('btn-share').addEventListener('click', async () => {
  const head = mode.daily ? `Perfect Shot Daily #${mode.number}` : 'Perfect Shot';
  const line = results.map((r) => (r.tier === 3 ? '🟨' : r.tier === 2 ? '🟩' : r.points > 0 ? '⬜' : '⬛')).join('');
  const text = `${head}: ${total} 📸\n${line}\nCan you catch the moment better?`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Perfect Shot', text });
      return;
    } catch {}
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Roll copied');
      return;
    } catch {}
  }
  showToast('Screenshot your roll and send it');
});
$('btn-board').addEventListener('click', async () => {
  try {
    await snapchat.leaderboards.show();
  } catch {
    showToast('Leaderboard unavailable');
  }
});

// --- FRAME LOOP ---
app.on('update', (dt) => {
  dt = Math.min(dt, 1 / 20);
  if (autopilot) autopilot(dt);

  if (state === 'menu' && menuScene) {
    t = (t + dt) % menuScene.duration;
    menuScene.update(t);
    const { pos, look, fov } = menuScene.camera;
    camera.camera.fov = fov;
    camera.setPosition(pos[0] + Math.sin(performance.now() / 4000) * 1.2, pos[1], pos[2]);
    camera.lookAt(new Vec3(...look));
  } else if (scene && (state === 'shoot' || state === 'review')) {
    if (devFreeze !== null) {
      t = devFreeze;
    } else if (state === 'shoot') {
      t += dt;
      if (t > 1.3) ui.prompt.style.opacity = '0';
      ui.timerRing.style.strokeDashoffset = `${RING * Math.min(1, t / scene.duration)}`;
      if (t >= scene.duration) missRound();
    } else {
      t += dt * 0.35; // the moment carries on in slow motion behind the polaroid
      reviewTimer -= dt;
      if (reviewTimer <= 0) endReview();
    }
    scene.update(t);
    placeCamera(dt);

    // Photobomb: pops up beside the action for ~1.5 s
    if (bombPlan) {
      const k = t - bombPlan.appear;
      const visible = k > 0 && k < 1.6;
      bomb.enabled = visible;
      if (visible) {
        const up = Math.min(1, k / 0.18) * Math.min(1, (1.6 - k) / 0.18);
        bomb.setLocalPosition(bombPlan.pos[0], bombPlan.pos[1] + (bombPlan.float ? Math.sin(k * 6) * 0.1 : 0), bombPlan.pos[2]);
        bomb.setLocalScale(1.5, 1.5 * up, 1.5);
        const cp = camera.getPosition();
        bomb.lookAt(new Vec3(cp.x, bomb.getPosition().y, cp.z));
      }
    }

    // Reticle locks when the subject is near the centre of the frame
    const f = frameCoords(scene.focus(new Vec3()));
    ui.reticle.classList.toggle('locked', state === 'shoot' && f.inside && Math.hypot(f.nx, f.ny) < 0.2);
  }
  if (cameraOverride) cameraOverride(camera);
});

// --- MENU ---
function showMenu() {
  state = 'menu';
  if (scene) {
    scene.root.destroy();
    scene = null;
  }
  bomb.enabled = false;
  if (!menuScene) {
    menuScene = createScene(app, 'whale', mulberry32(7), { ...sfx, splash() {}, boom() {} });
    applyLight(menuScene.def);
  }
  t = 0;
  setScreen('menu');
  renderMenu();
}

snapchatInit.then(() => {
  $('btn-board').hidden = !(snapchatReady && !snapchat.isStub && snapchat.isSupported('leaderboards'));
});
showMenu();
loadSave();
loadPortrait();

// Dev-only preview video / icon hooks (npm run record-preview, npm run render-icon).
// Stripped from production builds. See src/capture.js for the contract.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      app,
      sfx,
      camera,
      startRoll,
      pressShutter,
      takePhoto,
      container,
      showMenu,
      setScreen,
      scene: () => scene,
      time: () => t,
      state: () => state,
      setAim: (y, p) => {
        if (!Number.isFinite(y) || !Number.isFinite(p)) return;
        yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, y));
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));
      },
      setRoll: (ids) => (roll = ids),
      setAutopilot: (fn) => (autopilot = fn),
      setCameraOverride: (fn) => (cameraOverride = fn),
      frameCoords,
      setState: (s) => (state = s),
      aim: () => ({ yaw, pitch }),
      loadSceneForDev: (id) => {
        loadScene(id, rollRng);
        bombPlan = scene.bomb;
        state = 'shoot';
        shot = null;
      },
      freezeAt: (time) => (devFreeze = time),
      setNoBombs: (v) => (noBombs = v),
    })
  );
}

app.start();
