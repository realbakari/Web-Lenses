import {
  Application,
  CameraFrame,
  Color,
  Entity,
  FILLMODE_NONE,
  FOG_LINEAR,
  Mesh,
  MeshInstance,
  RESOLUTION_AUTO,
  StandardMaterial,
  TONEMAP_ACES2,
  TorusGeometry,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource-variable/space-grotesk/wght.css';
import { sfx } from './audio.js';
import { createAsteroid } from './meshes.js';
import { createShip, glow, loadContainer, seatAvatar } from './ship.js';
import { SECTORS, createDistantStars, createSky, createStarfield } from './world.js';

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

// --- TUNING (world units; the ship flies at z = 0 and the world streams toward +z) ---
const BOUNDS = { x: 3.1, y: 1.8 };
const SPAWN_Z = -190;
const SPEED_BASE = 42;
const SPEED_PER_SECTOR = 5;
const SPEED_MAX = 72;
const RING_BOOST = 1.28;
const SECTOR_SECONDS = 32;
const WARP_SECONDS = 2.4;
const FIRE_INTERVAL = 0.15;
const BOLT_SPEED = 150;
const SHIELDS = 3;
const INVULNERABLE = 1.4;
const RING_RADIUS = 1.7;
const LY_PER_UNIT = 1 / 420;

// --- ENGINE ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
const app = new Application(canvas, { graphicsDeviceOptions: { antialias: false } });
app.setCanvasFillMode(FILLMODE_NONE);
app.setCanvasResolution(RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const device = app.graphicsDevice;

function fitCanvas() {
  const { width, height } = container.getBoundingClientRect();
  app.resizeCanvas(Math.round(width), Math.round(height));
}
new ResizeObserver(fitCanvas).observe(container);
fitCanvas();

const camera = new Entity('camera');
// Horizontal FOV: the ship is framed the same on tall and short phones
camera.addComponent('camera', { fov: 50, horizontalFov: true, nearClip: 0.1, farClip: 900, clearColor: new Color(0.016, 0.02, 0.047) });
app.root.addChild(camera);

// HDR pipeline: ACES tone mapping and bloom so lasers, exhausts and rings actually glow
const frame = new CameraFrame(app, camera.camera);
frame.rendering.toneMapping = TONEMAP_ACES2;
frame.rendering.samples = 1;
frame.bloom.intensity = 0.03;
frame.bloom.blurLevel = 14;
frame.vignette.intensity = 0.45;
frame.vignette.inner = 0.45;
frame.vignette.outer = 1.1;
frame.update();

app.scene.fog.type = FOG_LINEAR;
app.scene.fog.start = 70;
app.scene.fog.end = 185;

const key = new Entity('key');
key.addComponent('light', { type: 'directional', intensity: 1.6 });
key.lookAt(new Vec3(-0.4, -0.7, -0.6));
key.rotateLocal(90, 0, 0);
app.root.addChild(key);
const rim = new Entity('rim');
rim.addComponent('light', { type: 'directional', intensity: 1.1 });
rim.lookAt(new Vec3(0.6, 0.2, 0.8));
rim.rotateLocal(90, 0, 0);
app.root.addChild(rim);

// --- RANDOM (Math.random is seeded by the preview recorder) ---
const rand = (a, b) => a + Math.random() * (b - a);

// --- WORLD ---
const sky = createSky(app);
const stars = createStarfield(app, 260, Math.random);
const distantStars = createDistantStars(app, 700, Math.random);
const ship = createShip(app);
const rockMeshes = Array.from({ length: 4 }, () => createAsteroid(device, Math.random));
let rockMat = new StandardMaterial();

const torus = Mesh.fromGeometry(device, new TorusGeometry({ tubeRadius: 0.07, ringRadius: RING_RADIUS, segments: 56, sides: 10 }));
torus.incRefCount();
const ringMat = glow('#ffc35a', 2.4);
const ringHitMat = glow('#ffffff', 3);
const boltMat = glow('#8ff6ff', 4);
const enemyBoltMat = glow('#ff4d5e', 4);
const droneHull = new StandardMaterial();
droneHull.diffuse = new Color(0.12, 0.13, 0.17);
droneHull.useMetalness = true;
droneHull.metalness = 0.7;
droneHull.gloss = 0.6;
droneHull.update();
const droneEye = glow('#ff3b4e', 3);
const shieldOrbMat = glow('#5ad1ff', 2.5);

function applySector(index) {
  const sector = SECTORS[index % SECTORS.length];
  sky.paint(sector, Math.random);
  const base = sector.colors.map((h) => new Color(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255));
  app.scene.fog.color = new Color(base[0].r * 0.12, base[0].g * 0.12, base[0].b * 0.14);
  app.scene.ambientLight = new Color(0.1 + base[1].r * 0.15, 0.1 + base[1].g * 0.15, 0.12 + base[1].b * 0.15);
  key.light.color = new Color(1, 0.94, 0.86);
  rim.light.color = new Color(0.4 + base[1].r * 0.6, 0.4 + base[1].g * 0.6, 0.5 + base[1].b * 0.5);
  rockMat = new StandardMaterial();
  rockMat.diffuse = new Color(parseInt(sector.rock.slice(1, 3), 16) / 255, parseInt(sector.rock.slice(3, 5), 16) / 255, parseInt(sector.rock.slice(5, 7), 16) / 255);
  rockMat.gloss = 0.25;
  rockMat.update();
  return sector;
}

// --- STATE ---
const STATE_MENU = 'menu';
const STATE_PLAYING = 'playing';
const STATE_OVER = 'over';
let state = STATE_MENU;

const shipPos = new Vec3(0, 0, 0);
const shipTarget = new Vec3(0, 0, 0);
const shipVel = new Vec3();
let speed = SPEED_BASE;
let boost = 0;
let distance = 0;
let score = 0;
let scoreRemainder = 0; // fractional distance points carried between frames
let shields = SHIELDS;
let invulnerable = 0;
let sector = 0;
let sectorTime = 0;
let warp = 0; // seconds left in a hyperspace jump
let fireCooldown = 0;
let cannonSide = 0;
let spawnTimer = 0;
let ringTimer = 3;
let droneTimer = 8;
let chain = 0;
let bestChain = 0;
let dronesDown = 0;
let shake = 0;
let menuTime = 0;
let launchT = 1; // 0 → 1 camera swing from the menu shot to the chase cam
let autopilot = null; // dev capture only
let onGodModeHit = null; // dev capture only
let cameraOverride = null; // dev capture only: (camera) => void, for the icon shot

const hazards = []; // asteroids and drones: { kind, e, r, hp, spin?, vz, ... }
const rings = [];
const bolts = [];
const enemyBolts = [];
const pickups = [];
const fx = [];

let bestDistance = 0;
const fmtLy = (ly) => `${ly.toFixed(1)} ly`;

// --- DOM ---
const $ = (id) => document.getElementById(id);
const ui = {
  score: $('score'),
  chain: $('chain'),
  shields: $('shields'),
  hudSector: $('hud-sector'),
  distance: $('distance'),
  hitFlash: $('hit-flash'),
  callout: $('callout'),
  sectorCard: $('sector-card'),
  sectorNum: $('sector-num'),
  sectorName: $('sector-name'),
  menu: $('menu'),
  over: $('over'),
  menuBest: $('menu-best'),
  pilotLine: $('pilot-line'),
  reportSub: $('report-sub'),
  reportDistance: $('report-distance'),
  newBest: $('new-best'),
  rScore: $('r-score'),
  rSector: $('r-sector'),
  rDrones: $('r-drones'),
  rChain: $('r-chain'),
  toast: $('toast'),
};

// Default portrait: a simple pilot helmet, until (or unless) the Bitmoji arrives
const HELMET_SVG = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#12203a"/><circle cx="20" cy="21" r="12" fill="#d9dde4"/><rect x="11" y="17" width="18" height="8" rx="4" fill="#ff9a3a"/></svg>'
)}")`;
const setPortraits = (css) => document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = css));
setPortraits(HELMET_SVG);

function setScreen(name) {
  container.classList.toggle('is-menu', name === 'menu');
  container.classList.toggle('is-over', name === 'over');
  ui.menu.classList.toggle('hidden', name !== 'menu');
  ui.over.classList.toggle('hidden', name !== 'over');
}

function renderShields() {
  [...ui.shields.children].forEach((pip, i) => pip.classList.toggle('off', i >= shields));
  ui.shields.classList.toggle('low', shields === 1);
}

function callout(text) {
  ui.callout.textContent = text;
  ui.callout.classList.remove('show');
  void ui.callout.offsetWidth;
  ui.callout.classList.add('show');
}

let toastTimer = 0;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function renderMenu() {
  ui.menuBest.textContent = bestDistance > 0 ? `Best ${fmtLy(bestDistance)}` : '';
}

// --- SPAWNING ---
function spawnAsteroid(x = rand(-BOUNDS.x - 4, BOUNDS.x + 4), y = rand(-BOUNDS.y - 2.5, BOUNDS.y + 2.5), z = SPAWN_Z, size = rand(0.55, 1.9)) {
  const e = new Entity('asteroid');
  e.addComponent('render', { meshInstances: [new MeshInstance(rockMeshes[Math.floor(Math.random() * rockMeshes.length)], rockMat)] });
  e.setLocalScale(size * rand(0.85, 1.15), size * rand(0.8, 1.1), size * rand(0.85, 1.2));
  e.setPosition(x, y, z);
  e.setEulerAngles(rand(0, 360), rand(0, 360), rand(0, 360));
  app.root.addChild(e);
  hazards.push({ kind: 'rock', e, r: size * 0.95, hp: size > 1.5 ? 3 : size > 1.05 ? 2 : 1, spin: new Vec3(rand(-40, 40), rand(-40, 40), rand(-40, 40)), vz: 0, hitFlash: 0 });
}

function spawnDrone(x, y, z = SPAWN_Z) {
  const e = new Entity('drone');
  const core = new Entity('drone-core');
  core.addComponent('render', { type: 'sphere', material: droneHull });
  core.setLocalScale(0.9, 0.9, 0.9);
  e.addChild(core);
  const eye = new Entity('drone-eye');
  eye.addComponent('render', { type: 'sphere', material: droneEye });
  eye.setLocalScale(0.42, 0.42, 0.2);
  eye.setLocalPosition(0, 0, 0.42);
  e.addChild(eye);
  for (const side of [-1, 1]) {
    const wing = new Entity('drone-wing');
    wing.addComponent('render', { type: 'cylinder', material: droneHull });
    wing.setLocalScale(1.6, 0.06, 1.6);
    wing.setLocalEulerAngles(0, 0, 90);
    wing.setLocalPosition(side * 0.85, 0, 0);
    e.addChild(wing);
    const strut = new Entity('drone-strut');
    strut.addComponent('render', { type: 'box', material: droneHull });
    strut.setLocalScale(0.8, 0.12, 0.12);
    strut.setLocalPosition(side * 0.45, 0, 0);
    e.addChild(strut);
  }
  e.setPosition(x, y, z);
  app.root.addChild(e);
  hazards.push({ kind: 'drone', e, r: 1.0, hp: 2, vz: -speed * 0.45, phase: rand(0, Math.PI * 2), baseX: x, baseY: y, fireIn: rand(0.6, 1.4), hitFlash: 0 });
}

/** A lane of rings along a gentle curve: fly through them all to build the chain. */
function spawnRingLane(z0 = SPAWN_Z, count = 5, startX = rand(-BOUNDS.x * 0.7, BOUNDS.x * 0.7), startY = rand(-BOUNDS.y * 0.6, BOUNDS.y * 0.6)) {
  const ax = rand(-1, 1) * 1.6;
  const ay = rand(-1, 1) * 0.9;
  const freq = rand(0.5, 1.1);
  for (let i = 0; i < count; i++) {
    const x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, startX + Math.sin(i * freq) * ax));
    // Offsets are relative to the first ring, so a lane starts exactly at (startX, startY)
    const y = Math.max(-BOUNDS.y, Math.min(BOUNDS.y, startY + (Math.sin(i * freq + 1) - Math.sin(1)) * ay));
    const e = new Entity('ring');
    const mi = new MeshInstance(torus, ringMat);
    e.addComponent('render', { meshInstances: [mi] });
    e.setPosition(x, y, z0 - i * 22);
    e.setEulerAngles(90, 0, 0);
    app.root.addChild(e);
    rings.push({ e, mi, passed: false });
  }
}

function spawnShieldOrb() {
  const e = new Entity('shield-orb');
  e.addComponent('render', { type: 'sphere', material: shieldOrbMat });
  e.setLocalScale(0.6, 0.6, 0.6);
  e.setPosition(rand(-BOUNDS.x, BOUNDS.x) * 0.8, rand(-BOUNDS.y, BOUNDS.y) * 0.8, SPAWN_Z);
  app.root.addChild(e);
  pickups.push({ e });
}

function nearRingLane(x, y, z) {
  return rings.some((ring) => {
    const p = ring.e.getPosition();
    return Math.abs(p.z - z) < 30 && Math.hypot(p.x - x, p.y - y) < RING_RADIUS + 2.4;
  });
}

function updateSpawning(dt) {
  if (warp > 0) return;
  const intensity = Math.min(1, sector / 4);
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = 0.42 - intensity * 0.17 + rand(0, 0.2);
    for (let tries = 0; tries < 5; tries++) {
      const x = rand(-BOUNDS.x - 4, BOUNDS.x + 4);
      const y = rand(-BOUNDS.y - 2.5, BOUNDS.y + 2.5);
      if (!nearRingLane(x, y, SPAWN_Z)) {
        spawnAsteroid(x, y);
        break;
      }
    }
  }
  ringTimer -= dt;
  if (ringTimer <= 0) {
    ringTimer = rand(5.5, 8);
    spawnRingLane();
  }
  if (sector >= 1) {
    droneTimer -= dt;
    if (droneTimer <= 0) {
      droneTimer = rand(4.5, 7) - intensity * 1.5;
      const n = 2 + Math.floor(Math.random() * Math.min(3, sector + 1));
      const cx = rand(-BOUNDS.x, BOUNDS.x) * 0.6;
      const cy = rand(-BOUNDS.y, BOUNDS.y) * 0.5;
      for (let i = 0; i < n; i++) spawnDrone(cx + (i - (n - 1) / 2) * 2.4, cy + (i % 2) * 0.8, SPAWN_Z - i * 6);
    }
  }
  if (shields < SHIELDS && Math.random() < dt / 22) spawnShieldOrb();
}

// --- EFFECTS ---
function explode(pos, size, color = '#ffb35a') {
  const flash = new Entity('flash');
  const mat = glow(color, 9);
  flash.addComponent('render', { type: 'sphere', material: mat });
  flash.setPosition(pos);
  app.root.addChild(flash);
  fx.push({ kind: 'flash', e: flash, mat, age: 0, life: 0.26, size });
  const chunks = Math.round(4 + size * 4);
  for (let i = 0; i < chunks; i++) {
    const e = new Entity('chunk');
    e.addComponent('render', { meshInstances: [new MeshInstance(rockMeshes[i % rockMeshes.length], rockMat)] });
    const s = rand(0.12, 0.3) * size;
    e.setLocalScale(s, s, s);
    e.setPosition(pos);
    app.root.addChild(e);
    const a = rand(0, Math.PI * 2);
    const v = rand(4, 11) * Math.sqrt(size);
    fx.push({ kind: 'chunk', e, age: 0, life: rand(0.6, 1.1), vel: new Vec3(Math.cos(a) * v, Math.sin(a) * v, rand(-4, 6)), spin: new Vec3(rand(-500, 500), rand(-500, 500), 0), s });
  }
}

function updateFx(dt, worldDz) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.age += dt;
    const p = f.age / f.life;
    if (f.kind === 'flash') {
      const s = f.size * (0.5 + 1.6 * (1 - (1 - p) ** 3));
      f.e.setLocalScale(s, s, s);
      f.mat.emissiveIntensity = 9 * (1 - p) ** 3;
      f.mat.update();
      f.e.translate(0, 0, worldDz);
    } else {
      const pos = f.e.getPosition();
      f.e.setPosition(pos.x + f.vel.x * dt, pos.y + f.vel.y * dt, pos.z + f.vel.z * dt + worldDz);
      f.e.rotate(f.spin.x * dt, f.spin.y * dt, 0);
      const k = f.s * Math.max(0, 1 - p);
      f.e.setLocalScale(k, k, k);
    }
    if (p >= 1) {
      f.e.destroy();
      fx.splice(i, 1);
    }
  }
}

// --- DAMAGE ---
function damageShip() {
  if (invulnerable > 0 || state !== STATE_PLAYING) return;
  if (onGodModeHit) {
    onGodModeHit(performance.now() / 1000);
    return;
  }
  shields -= 1;
  invulnerable = INVULNERABLE;
  shake = 0.5;
  chain = 0;
  renderShields();
  renderChain();
  sfx.shieldHit();
  ui.hitFlash.classList.add('show');
  setTimeout(() => ui.hitFlash.classList.remove('show'), 120);
  try {
    navigator.vibrate?.(60);
  } catch {}
  if (shields <= 0) gameOver();
}

/** Distance from (x, y) to the ship's wing line: hits use a capsule, not a sphere. */
function shipDistance(x, y) {
  const dx = Math.max(0, Math.abs(x - shipPos.x) - 1.15);
  return Math.hypot(dx, y - shipPos.y);
}

function renderChain() {
  ui.chain.textContent = `RING CHAIN ×${chain}`;
  ui.chain.classList.toggle('show', chain >= 2);
}

// --- GAME FLOW ---
function clearWorld() {
  for (const list of [hazards, rings, bolts, enemyBolts, pickups, fx]) {
    for (const item of list) item.e.destroy();
    list.length = 0;
  }
}

function startGame() {
  sfx.init();
  sfx.launch();
  sfx.engine(true, 0);
  clearWorld();
  sector = 0;
  const s = applySector(0);
  shipPos.set(0, 0, 0);
  shipTarget.set(0, 0, 0);
  speed = SPEED_BASE;
  boost = 0;
  distance = 0;
  score = 0;
  scoreRemainder = 0;
  shields = SHIELDS;
  invulnerable = 0;
  sectorTime = 0;
  warp = 0;
  spawnTimer = 0.6;
  ringTimer = 2.5;
  droneTimer = 6;
  chain = 0;
  bestChain = 0;
  dronesDown = 0;
  launchT = 0;
  ship.root.enabled = true;
  renderShields();
  renderChain();
  ui.hudSector.textContent = 'Sector 1';
  void s;
  setScreen('play');
  state = STATE_PLAYING;
}

function beginWarp() {
  warp = WARP_SECONDS;
  sfx.warp();
}

function arriveInSector() {
  sector += 1;
  const s = applySector(sector);
  score += 500 * sector;
  ui.hudSector.textContent = `Sector ${sector + 1}`;
  ui.sectorNum.textContent = `SECTOR ${sector + 1}`;
  ui.sectorName.textContent = s.name;
  ui.sectorCard.classList.add('show');
  setTimeout(() => ui.sectorCard.classList.remove('show'), 1800);
}

async function gameOver() {
  state = STATE_OVER;
  sfx.engine(false);
  sfx.explosion(true);
  sfx.gameOver();
  explode(ship.root.getPosition().clone(), 2.2, '#ffd28a');
  ship.root.enabled = false;
  shake = 0.9;

  const ly = distance * LY_PER_UNIT;
  const isBest = ly > bestDistance;
  if (isBest) bestDistance = ly;
  ui.reportSub.textContent = `Shields down in ${SECTORS[sector % SECTORS.length].name}`;
  ui.reportDistance.innerHTML = `${ly.toFixed(1)}<small>ly</small>`;
  ui.newBest.classList.toggle('show', isBest && ly > 0.5);
  ui.rScore.textContent = score.toLocaleString('en-US');
  ui.rSector.textContent = String(sector + 1);
  ui.rDrones.textContent = String(dronesDown);
  ui.rChain.textContent = bestChain > 1 ? `×${bestChain}` : '–';
  renderMenu();
  loadBitmoji(); // fresh 2D URL for the report card (they expire after ~5 min)

  setTimeout(() => setScreen('over'), 1400);

  if (snapchatReady) {
    if (snapchat.isSupported('leaderboards')) {
      try {
        await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score: Math.round(ly * 10) });
      } catch (e) {
        console.warn('[WebLens] Leaderboard submit failed:', e);
      }
    }
    if (isBest && snapchat.isSupported('storage')) {
      try {
        await snapchat.storage.set('best', bestDistance);
      } catch {}
    }
  }
}

// --- BITMOJI ---
let avatar3D = null;
async function loadBitmoji({ with3D = false } = {}) {
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'large' });
    const img = new Image();
    img.onload = () => setPortraits(`url("${url}")`);
    img.src = url;
    ui.pilotLine.textContent = 'Your Bitmoji is flying';
    if (with3D && !avatar3D) {
      // Load right away: the URL expires after ~5 minutes
      const asset = await loadContainer(app, 'bitmoji', (await snapchat.bitmoji.get3DAvatar()).url);
      avatar3D = seatAvatar(ship, asset);
    }
  } catch (e) {
    console.warn('[WebLens] Using the default pilot:', e?.message);
  }
}

async function loadBest() {
  await snapchatInit;
  if (!snapchatReady || !snapchat.isSupported('storage')) return;
  try {
    const { found, value } = await snapchat.storage.get('best');
    if (found && Number(value) > bestDistance) bestDistance = Number(value);
    renderMenu();
  } catch {}
}

// --- INPUT: relative drag, so the thumb never covers the ship ---
let dragId = null;
let lastX = 0;
let lastY = 0;
container.addEventListener('pointerdown', (e) => {
  if (state !== STATE_PLAYING || e.target.closest('button')) return;
  sfx.init();
  dragId = e.pointerId;
  lastX = e.clientX;
  lastY = e.clientY;
});
container.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId || state !== STATE_PLAYING) return;
  const { width } = container.getBoundingClientRect();
  const k = 9 / width;
  shipTarget.x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, shipTarget.x + (e.clientX - lastX) * k));
  shipTarget.y = Math.max(-BOUNDS.y, Math.min(BOUNDS.y, shipTarget.y - (e.clientY - lastY) * k));
  lastX = e.clientX;
  lastY = e.clientY;
});
const endDrag = (e) => e.pointerId === dragId && (dragId = null);
container.addEventListener('pointerup', endDrag);
container.addEventListener('pointercancel', endDrag);

$('btn-launch').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-share').addEventListener('click', async () => {
  const text = `I flew ${fmtLy(distance * LY_PER_UNIT)} into the galaxy in Starlane (sector ${sector + 1}). Can you go further?`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Starlane', text });
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
  showToast('Screenshot your report and send it');
});
for (const id of ['btn-board', 'btn-board-2']) {
  $(id).addEventListener('click', async () => {
    try {
      await snapchat.leaderboards.show();
    } catch {
      showToast('Leaderboard unavailable');
    }
  });
}

// --- FRAME LOOP ---
const camPos = new Vec3();
const camLook = new Vec3();
const menuCam = new Vec3(2.0, 1.3, -5.4);
const menuLook = new Vec3(0, 0.05, 0.2);
const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

function updateFlight(dt) {
  if (autopilot) autopilot(dt);

  // Ship eases toward the steering target; banking follows its velocity
  const px = shipPos.x;
  const py = shipPos.y;
  shipPos.x = smooth(shipPos.x, shipTarget.x, 10, dt);
  shipPos.y = smooth(shipPos.y, shipTarget.y, 10, dt);
  shipVel.set((shipPos.x - px) / dt, (shipPos.y - py) / dt, 0);
  ship.root.setPosition(shipPos);
  ship.body.setLocalEulerAngles(Math.max(-25, Math.min(25, shipVel.y * 4)), 0, Math.max(-50, Math.min(50, -shipVel.x * 7)));

  // Sectors and hyperspace
  sectorTime += dt;
  if (warp <= 0 && sectorTime >= SECTOR_SECONDS) beginWarp();
  if (warp > 0) {
    const before = warp;
    warp -= dt;
    if (before > WARP_SECONDS / 2 && warp <= WARP_SECONDS / 2) arriveInSector();
    if (warp <= 0) sectorTime = 0;
  }
  const warpK = warp > 0 ? Math.sin((1 - warp / WARP_SECONDS) * Math.PI) : 0;

  boost = Math.max(0, boost - dt);
  const cruise = Math.min(SPEED_MAX, SPEED_BASE + sector * SPEED_PER_SECTOR) * (boost > 0 ? RING_BOOST : 1);
  speed = smooth(speed, cruise, 3, dt);
  const worldSpeed = speed * (1 + warpK * 5);
  const dz = worldSpeed * dt;
  distance += dz;
  scoreRemainder += dz * 0.5;
  score += Math.floor(scoreRemainder);
  scoreRemainder -= Math.floor(scoreRemainder);

  // Auto-fire, alternating wing cannons
  fireCooldown -= dt;
  if (fireCooldown <= 0 && warp <= 0) {
    fireCooldown = FIRE_INTERVAL;
    cannonSide = 1 - cannonSide;
    const muzzle = ship.cannons[cannonSide].getPosition();
    const e = new Entity('bolt');
    e.addComponent('render', { type: 'box', material: boltMat });
    e.setLocalScale(0.07, 0.07, 2.2);
    e.setPosition(muzzle);
    app.root.addChild(e);
    bolts.push({ e, age: 0 });
    sfx.laser(cannonSide ? 1 : -1);
  }

  // Bolts (swept against hazards: both move fast along z)
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.age += dt;
    const p = b.e.getPosition();
    const zPrev = p.z;
    const zNow = zPrev - BOLT_SPEED * dt;
    b.e.setPosition(p.x, p.y, zNow);
    let hit = false;
    for (const h of hazards) {
      const hp = h.e.getPosition();
      const hzNow = hp.z + dz + h.vz * dt;
      const crossed = (zPrev - hp.z) * (zNow - hzNow) <= 0 || Math.abs(zNow - hzNow) < h.r;
      if (crossed && Math.hypot(p.x - hp.x, p.y - hp.y) < h.r + 0.25) {
        h.hp -= 1;
        h.hitFlash = 1;
        hit = true;
        if (h.hp <= 0) destroyHazard(h);
        break;
      }
    }
    if (hit || b.age > 1.3) {
      b.e.destroy();
      bolts.splice(i, 1);
    }
  }

  // Hazards
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    if (h.dead) {
      hazards.splice(i, 1);
      continue;
    }
    const p = h.e.getPosition();
    let x = p.x;
    let y = p.y;
    if (h.kind === 'drone') {
      h.phase += dt * 1.6;
      x = h.baseX + Math.sin(h.phase) * 1.4;
      y = h.baseY + Math.cos(h.phase * 0.7) * 0.6;
      h.e.setLocalEulerAngles(0, 0, Math.cos(h.phase) * 25);
      h.fireIn -= dt;
      if (h.fireIn <= 0 && p.z > -110 && p.z < -25 && warp <= 0) {
        h.fireIn = rand(1.3, 2.2);
        fireEnemyBolt(new Vec3(x, y, p.z + 0.6));
      }
    } else {
      h.e.rotate(h.spin.x * dt, h.spin.y * dt, h.spin.z * dt);
    }
    const zPrev = p.z;
    const zNow = p.z + dz + h.vz * dt;
    h.e.setPosition(x, y, zNow);

    // Collision as it crosses the ship's plane
    if (zPrev < 1.2 && zNow > -1.6 && state === STATE_PLAYING) {
      if (shipDistance(x, y) < h.r * 0.85 + 0.35) {
        destroyHazard(h, false);
        damageShip();
        continue;
      }
    }
    if (zNow > 14) {
      h.e.destroy();
      hazards.splice(i, 1);
    }
  }

  // Enemy bolts
  for (let i = enemyBolts.length - 1; i >= 0; i--) {
    const b = enemyBolts[i];
    const p = b.e.getPosition();
    const n = p.clone().add(b.vel.clone().mulScalar(dt));
    n.z += dz;
    b.e.setPosition(n);
    if (p.z < 0.6 && n.z > -0.6 && shipDistance(n.x, n.y) < 0.45 && state === STATE_PLAYING) {
      damageShip();
      b.e.destroy();
      enemyBolts.splice(i, 1);
      continue;
    }
    if (n.z > 12) {
      b.e.destroy();
      enemyBolts.splice(i, 1);
    }
  }

  // Rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i];
    const p = ring.e.getPosition();
    const zNow = p.z + dz;
    ring.e.setPosition(p.x, p.y, zNow);
    if (!ring.passed && p.z <= 0 && zNow > 0 && state === STATE_PLAYING) {
      ring.passed = true;
      if (Math.hypot(p.x - shipPos.x, p.y - shipPos.y) < RING_RADIUS - 0.25) {
        chain += 1;
        bestChain = Math.max(bestChain, chain);
        score += 100 * chain;
        boost = 1.2;
        ring.mi.material = ringHitMat;
        sfx.ring(chain);
        renderChain();
        if (chain >= 3 && chain % 2 === 1) callout(`RING CHAIN ×${chain}`);
      } else {
        chain = 0;
        renderChain();
      }
    }
    if (zNow > 14) {
      ring.e.destroy();
      rings.splice(i, 1);
    }
  }

  // Shield orbs
  for (let i = pickups.length - 1; i >= 0; i--) {
    const o = pickups[i];
    const p = o.e.getPosition();
    const zNow = p.z + dz;
    o.e.setPosition(p.x, p.y, zNow);
    if (p.z <= 0.5 && zNow > -0.8 && shipDistance(p.x, p.y) < 0.9 && state === STATE_PLAYING) {
      shields = Math.min(SHIELDS, shields + 1);
      renderShields();
      sfx.pickup();
      callout('SHIELD +1');
      o.e.destroy();
      pickups.splice(i, 1);
      continue;
    }
    if (zNow > 14) {
      o.e.destroy();
      pickups.splice(i, 1);
    }
  }

  updateSpawning(dt);
  updateFx(dt, dz);

  invulnerable = Math.max(0, invulnerable - dt);
  ship.body.enabled = invulnerable <= 0 || Math.floor(invulnerable * 14) % 2 === 0;

  // Engines: plume grows with thrust and boost
  const thrust = Math.min(1, (speed - SPEED_BASE) / 30 + (boost > 0 ? 0.4 : 0) + warpK);
  for (const { core, plume } of ship.exhaust) {
    const flicker = 0.92 + Math.random() * 0.16;
    const c = 0.26 * flicker * (1 + thrust * 0.4);
    core.setLocalScale(c, c, c);
    plume.setLocalScale(0.3 * flicker, (0.9 + thrust * 1.6 + warpK * 3) * flicker, 0.3 * flicker);
  }
  sfx.engine(true, thrust);

  stars.update(dt, worldSpeed, 0.006 + warpK * 0.09, shipPos.x, shipPos.y);

  // HUD
  ui.score.textContent = score.toLocaleString('en-US');
  ui.distance.textContent = fmtLy(distance * LY_PER_UNIT);
  return warpK;
}

function fireEnemyBolt(from) {
  const e = new Entity('enemy-bolt');
  e.addComponent('render', { type: 'capsule', material: enemyBoltMat });
  e.setLocalScale(0.16, 0.9, 0.16);
  e.setEulerAngles(90, 0, 0);
  e.setPosition(from);
  app.root.addChild(e);
  // Aimed where the ship is now, travelling a bit faster than the world
  const t = -from.z / 60;
  const vel = new Vec3((shipPos.x - from.x) / t, (shipPos.y - from.y) / t, 60 - speed);
  enemyBolts.push({ e, vel });
}

function destroyHazard(h, scored = true) {
  const p = h.e.getPosition().clone();
  if (h.kind === 'drone') {
    explode(p, 1.3, '#ffd2a0');
    sfx.explosion(true);
    if (scored) {
      dronesDown += 1;
      score += 150;
      callout('+150 DRONE DOWN');
    }
  } else {
    explode(p, h.r, '#ffe0b0');
    sfx.explosion(h.r > 1.3);
    if (scored) score += h.r > 1.3 ? 60 : 25;
  }
  h.e.destroy();
  h.dead = true;
}

app.on('update', (dt) => {
  dt = Math.min(dt, 1 / 20);
  let warpK = 0;

  if (state === STATE_PLAYING) {
    warpK = updateFlight(dt);
  } else {
    // Menu and report: drift through the stars; the ship idles facing the camera
    menuTime += dt;
    stars.update(dt, state === STATE_MENU ? 18 : 6, 0.006, 0, 0);
    updateFx(dt, state === STATE_OVER ? 6 * dt : 0);
    if (state === STATE_MENU) {
      ship.root.setPosition(0, Math.sin(menuTime * 1.3) * 0.08, 0);
      ship.body.setLocalEulerAngles(Math.sin(menuTime * 0.9) * 3, 0, Math.sin(menuTime * 0.7) * 6);
      const thrust = 0.15;
      for (const { core, plume } of ship.exhaust) {
        const f = 0.92 + Math.random() * 0.16;
        core.setLocalScale(0.26 * f, 0.26 * f, 0.26 * f);
        plume.setLocalScale(0.3 * f, (0.9 + thrust) * f, 0.3 * f);
      }
    }
  }

  // Camera: the menu shot looks at the pilot; launching swings it round behind the ship
  launchT = Math.min(1, launchT + dt / 1.3);
  const chaseCam = new Vec3(shipPos.x * 0.55, shipPos.y * 0.55 + 1.55, 6.4);
  const chaseLook = new Vec3(shipPos.x * 0.75, shipPos.y * 0.7 + 0.35, -14);
  const e = launchT < 1 ? 1 - (1 - launchT) ** 3 : 1;
  const inMenu = state === STATE_MENU;
  camPos.lerp(menuCam, chaseCam, inMenu ? 0 : e);
  // Swing out and over on the way round, rather than straight through the ship
  if (!inMenu && e < 1) {
    const arc = Math.sin(e * Math.PI);
    camPos.x += arc * 4.5;
    camPos.y += arc * 1.6;
  }
  camLook.lerp(menuLook, chaseLook, inMenu ? 0 : e);
  if (state === STATE_MENU) {
    const a = menuTime * 0.12;
    camPos.set(Math.sin(a) * 2.2 + 1.2, 1.3, -5.4 + Math.cos(a) * 0.5);
  }
  shake = Math.max(0, shake - dt * 1.4);
  camera.setPosition(camPos.x + (Math.random() - 0.5) * shake * 0.4, camPos.y + (Math.random() - 0.5) * shake * 0.4, camPos.z);
  camera.lookAt(camLook);
  const targetFov = 50 + warpK * 28 + (boost > 0 ? 4 : 0);
  camera.camera.fov = smooth(camera.camera.fov, targetFov, 5, dt);

  if (cameraOverride) cameraOverride(camera);
  sky.entity.setPosition(camera.getPosition());
  distantStars.setPosition(camera.getPosition());
});

// --- BOOT ---
applySector(0);
renderMenu();
renderShields();
loadBest();
loadBitmoji({ with3D: true });
snapchatInit.then(() => {
  const canShow = snapchatReady && snapchat.isSupported('leaderboards') && !snapchat.isStub;
  $('btn-board').hidden = !canShow;
  $('btn-board-2').hidden = !canShow;
});

// Dev-only preview video / icon hooks (npm run record-preview, npm run render-icon).
// Stripped from production builds. See src/capture.js for the contract.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      app,
      sfx,
      ship,
      camera,
      frame,
      startGame,
      spawnAsteroid,
      spawnDrone,
      spawnRingLane,
      clearWorld,
      hazards,
      rings,
      shipPos,
      shipTarget,
      BOUNDS,
      setSectorTime: (t) => (sectorTime = t),
      setAutopilot: (fn) => (autopilot = fn),
      setGodMode: (fn) => (onGodModeHit = fn),
      setCameraOverride: (fn) => (cameraOverride = fn),
      applySector,
      setScore: (v) => (score = v),
      damageShip,
      resetInvulnerable: () => (invulnerable = 0),
      skipLaunch: () => (launchT = 1),
      setDistance: (v) => (distance = v / LY_PER_UNIT),
      stopSpawning: () => {
        spawnTimer = ringTimer = droneTimer = 1e9;
      },
      setState: (s) => (state = s),
      setScreen,
    })
  );
}

app.start();
