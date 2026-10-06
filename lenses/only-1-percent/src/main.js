import {
  Application,
  Color,
  Entity,
  FILLMODE_FILL_WINDOW,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource/anton/latin-400.css';
import { sfx } from './audio.js';

// --- SNAPCHAT WEB LENS API INITIALIZATION ---
let snapchatReady = false;
async function initSnapchat() {
  try {
    await snapchat.init();
    snapchatReady = true;
    console.log('[WebLens] Snap API initialized. isStub:', snapchat.isStub);
  } catch (err) {
    console.warn('[WebLens] Snap API note:', err);
  }
}
const snapchatInit = initSnapchat();

// Bitmoji portrait on the start and result screens (2D; URLs expire after ~5 min, so fetch fresh)
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

// --- PLAYCANVAS ENGINE BOOTSTRAP ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
const app = new Application(canvas);

app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
// Cap max pixel ratio to 2 for optimal battery and mobile performance
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

function resizeGame() {
  app.resizeCanvas();
}
window.addEventListener('resize', resizeGame);
resizeGame();

// --- CAMERA SETUP ---
// Clear color matches html/body #080911 background to avoid white flashes
const camera = new Entity('camera');
camera.addComponent('camera', {
  clearColor: new Color(0.031, 0.035, 0.067),
  fov: 56,
});
camera.setPosition(0, 1.25, 5.2);
camera.lookAt(0, 0.35, 0);
app.root.addChild(camera);

let cameraBasePos = new Vec3(0, 1.25, 5.2);
let screenShakeIntensity = 0;

// --- LIGHTING ---
const dirLight = new Entity('dirLight');
dirLight.addComponent('light', {
  type: 'directional',
  color: new Color(0.95, 0.98, 1.0),
  intensity: 1.5,
});
dirLight.setEulerAngles(45, 30, 0);
app.root.addChild(dirLight);

const ambientPointLight = new Entity('ambientPointLight');
ambientPointLight.addComponent('light', {
  type: 'omni',
  color: new Color(0.0, 0.85, 1.0),
  range: 16,
  intensity: 1.1,
});
ambientPointLight.setPosition(0, 3.2, 2.5);
app.root.addChild(ambientPointLight);

// --- CYBER TUNNEL & SPEED RIBBONS ---
const tunnelRibbons = [];
const ribbonCount = 22;
const ribbonMat = new StandardMaterial();
ribbonMat.diffuse = new Color(0.02, 0.08, 0.2);
ribbonMat.emissive = new Color(0.0, 0.35, 0.7);
ribbonMat.update();

for (let i = 0; i < ribbonCount; i++) {
  const ribbon = new Entity(`ribbon_${i}`);
  ribbon.addComponent('render', { type: 'box' });
  ribbon.setLocalScale(4.2, 0.035, 0.25);
  ribbon.setPosition(0, -1.8, -i * 2.2);
  if (ribbon.render && ribbon.render.meshInstances[0]) {
    ribbon.render.meshInstances[0].material = ribbonMat;
  }
  app.root.addChild(ribbon);
  tunnelRibbons.push(ribbon);
}

// Neon Speed Particles (Floating stars/cubes hurtling backwards)
const speedParticles = [];
const speedPartMat = new StandardMaterial();
speedPartMat.diffuse = new Color(0, 1, 0.9);
speedPartMat.emissive = new Color(0, 0.9, 0.8);
speedPartMat.update();

for (let i = 0; i < 25; i++) {
  const sp = new Entity(`sp_${i}`);
  sp.addComponent('render', { type: 'box' });
  sp.setLocalScale(0.04, 0.04, 0.4);
  sp.setPosition(
    (Math.random() - 0.5) * 4.4,
    (Math.random() - 0.5) * 3.2 + 0.5,
    -Math.random() * 30
  );
  if (sp.render && sp.render.meshInstances[0]) {
    sp.render.meshInstances[0].material = speedPartMat;
  }
  app.root.addChild(sp);
  speedParticles.push(sp);
}

// Side Guide Pillars
const pillars = [];
for (let i = 0; i < 14; i++) {
  const leftPillar = new Entity(`pillar_l_${i}`);
  leftPillar.addComponent('render', { type: 'cylinder' });
  leftPillar.setLocalScale(0.09, 3.8, 0.09);
  leftPillar.setPosition(-2.2, 0.2, -i * 3.2);
  app.root.addChild(leftPillar);
  pillars.push(leftPillar);

  const rightPillar = new Entity(`pillar_r_${i}`);
  rightPillar.addComponent('render', { type: 'cylinder' });
  rightPillar.setLocalScale(0.09, 3.8, 0.09);
  rightPillar.setPosition(2.2, 0.2, -i * 3.2);
  app.root.addChild(rightPillar);
  pillars.push(rightPillar);
}

// --- PLAYER AVATAR (STYLIZED 3D HEAD) ---
const playerRoot = new Entity('playerRoot');
playerRoot.setPosition(0, 0.35, 0);
app.root.addChild(playerRoot);

// Head Base
const headMesh = new Entity('headMesh');
headMesh.addComponent('render', { type: 'sphere' });
headMesh.setLocalScale(1.05, 1.2, 1.0);

const headMaterial = new StandardMaterial();
headMaterial.diffuse = new Color(0.18, 0.28, 0.5);
headMaterial.emissive = new Color(0.06, 0.12, 0.25);
headMaterial.useMetalness = true;
headMaterial.metalness = 0.55;
headMaterial.gloss = 0.85;
headMaterial.update();

if (headMesh.render && headMesh.render.meshInstances[0]) {
  headMesh.render.meshInstances[0].material = headMaterial;
}
playerRoot.addChild(headMesh);

// Glowing Cyber Headband
const headband = new Entity('headband');
headband.addComponent('render', { type: 'cylinder' });
headband.setLocalScale(1.1, 0.14, 1.05);
headband.setPosition(0, 0.26, 0);

const headbandMat = new StandardMaterial();
headbandMat.diffuse = new Color(0.0, 0.95, 1.0);
headbandMat.emissive = new Color(0.0, 0.9, 1.0);
headbandMat.update();

if (headband.render && headband.render.meshInstances[0]) {
  headband.render.meshInstances[0].material = headbandMat;
}
playerRoot.addChild(headband);

// Eyes
const eyeMat = new StandardMaterial();
eyeMat.diffuse = new Color(0, 1, 0.95);
eyeMat.emissive = new Color(0, 1, 0.95);
eyeMat.update();

const leftEye = new Entity('leftEye');
leftEye.addComponent('render', { type: 'sphere' });
leftEye.setLocalScale(0.19, 0.21, 0.14);
leftEye.setPosition(-0.28, 0.06, 0.46);
if (leftEye.render && leftEye.render.meshInstances[0]) {
  leftEye.render.meshInstances[0].material = eyeMat;
}
playerRoot.addChild(leftEye);

const rightEye = new Entity('rightEye');
rightEye.addComponent('render', { type: 'sphere' });
rightEye.setLocalScale(0.19, 0.21, 0.14);
rightEye.setPosition(0.28, 0.06, 0.46);
if (rightEye.render && rightEye.render.meshInstances[0]) {
  rightEye.render.meshInstances[0].material = eyeMat;
}
playerRoot.addChild(rightEye);

// Expressive Mouth
const mouthMat = new StandardMaterial();
mouthMat.diffuse = new Color(1, 0.1, 0.45);
mouthMat.emissive = new Color(0.85, 0.05, 0.35);
mouthMat.update();

const mouth = new Entity('mouth');
mouth.addComponent('render', { type: 'box' });
mouth.setLocalScale(0.28, 0.08, 0.12);
mouth.setPosition(0, -0.28, 0.46);
if (mouth.render && mouth.render.meshInstances[0]) {
  mouth.render.meshInstances[0].material = mouthMat;
}
playerRoot.addChild(mouth);

// --- GAME STATE ---
const STATE_MENU = 'MENU';
const STATE_PLAYING = 'PLAYING';
const STATE_GAMEOVER = 'GAMEOVER';

let gameState = STATE_MENU;
let onGodModeHit = null; // dev capture only: when set, hits are reported here instead of ending the run
let autopilot = null; // dev capture only: (dt) => void, steers playerTargetPos
let score = 0;
let scoreRemainder = 0; // fractional time-based points carried between frames
let currentLevel = 1;
let levelTimer = 0;
const LEVEL_DURATION = 8.5;

// Player Physics State
const playerTargetPos = new Vec3(0, 0.35, 0);
const playerCurrentPos = new Vec3(0, 0.35, 0);
let playerVelocityX = 0;
let playerVelocityY = 0;

// Levels Configuration
const LEVELS_CONFIG = [
  {
    lvl: 1,
    name: 'THE WARMUP',
    passRate: '99% PASS',
    pass: 99,
    speed: 17,
    spawnInterval: 1.15,
    color: new Color(0.0, 0.95, 1.0),
    roast: 'You barely started!',
  },
  {
    lvl: 2,
    name: 'DOUBLE TROUBLE',
    passRate: '83% PASS',
    pass: 83,
    speed: 22,
    spawnInterval: 0.92,
    color: new Color(0.2, 0.8, 1.0),
    roast: 'Warming up, but still basic.',
  },
  {
    lvl: 3,
    name: 'GOALKEEPER DIVER',
    passRate: '61% PASS',
    pass: 61,
    speed: 27,
    spawnInterval: 0.78,
    color: new Color(0.2, 1.0, 0.4),
    roast: 'Penalty saved? Not quite.',
  },
  {
    lvl: 4,
    name: 'FIT IN THE HOLE',
    passRate: '38% PASS',
    pass: 38,
    speed: 32,
    spawnInterval: 0.68,
    color: new Color(1.0, 0.85, 0.1),
    roast: 'Top 38% is average human reflexes.',
  },
  {
    lvl: 5,
    name: 'BRAINROT BLITZ',
    passRate: '19% PASS',
    pass: 19,
    speed: 38,
    spawnInterval: 0.58,
    color: new Color(1.0, 0.4, 0.1),
    roast: 'Certified speed, but lost in the chaos!',
  },
  {
    lvl: 6,
    name: 'LASER SLICE',
    passRate: '8% PASS',
    pass: 8,
    speed: 44,
    spawnInterval: 0.5,
    color: new Color(1.0, 0.1, 0.6),
    roast: 'Elite 8%! So close to the impossible.',
  },
  {
    lvl: 7,
    name: 'HYPER NEEDLE',
    passRate: '3% PASS',
    pass: 3,
    speed: 51,
    spawnInterval: 0.42,
    color: new Color(0.8, 0.0, 1.0),
    roast: 'Top 3% godlike reflexes! Almost immortal.',
  },
  {
    lvl: 8,
    name: 'IMPOSSIBLE 1%',
    passRate: '1% PASS',
    pass: 1,
    speed: 59,
    spawnInterval: 0.35,
    color: new Color(1.0, 0.0, 0.2),
    roast: 'You made it to the last level. Almost nobody does.',
  },
];

// --- OBSTACLES POOL & SPAWNING ---
const activeObstacles = [];
let spawnCooldown = 0;

// Shared obstacle materials
const obstacleMatDefault = new StandardMaterial();
obstacleMatDefault.diffuse = new Color(1.0, 0.2, 0.4);
obstacleMatDefault.emissive = new Color(0.55, 0.05, 0.2);
obstacleMatDefault.useMetalness = true;
obstacleMatDefault.metalness = 0.85;
obstacleMatDefault.gloss = 0.9;
obstacleMatDefault.update();

const obstacleMatLaser = new StandardMaterial();
obstacleMatLaser.diffuse = new Color(0.0, 1.0, 0.85);
obstacleMatLaser.emissive = new Color(0.0, 0.9, 0.75);
obstacleMatLaser.update();

function spawnObstacle() {
  const cfg = LEVELS_CONFIG[currentLevel - 1] || LEVELS_CONFIG[0];
  const typeRoll = Math.random();

  let entity;
  let radius = 0.42;
  let axis = null; // lasers collide as a segment along this axis
  let halfLen = 0;

  if (currentLevel >= 6 && typeRoll > 0.6) {
    // Laser rod obstacle (horizontal or vertical sweeping bar)
    entity = new Entity('laser_bar');
    entity.addComponent('render', { type: 'cylinder' });

    if (Math.random() > 0.5) {
      entity.setLocalScale(0.16, 2.5, 0.16);
      entity.setEulerAngles(0, 0, 90);
      entity.setPosition(0, (Math.random() - 0.5) * 1.8 + 0.35, -30);
      axis = 'x';
      halfLen = 1.25;
      radius = 0.1;
    } else {
      entity.setLocalScale(0.16, 2.8, 0.16);
      entity.setEulerAngles(0, 0, 0);
      entity.setPosition((Math.random() - 0.5) * 2.8, 0.35, -30);
      axis = 'y';
      halfLen = 1.4;
      radius = 0.1;
    }

    if (entity.render && entity.render.meshInstances[0]) {
      entity.render.meshInstances[0].material = obstacleMatLaser;
    }
  } else if (currentLevel >= 4 && typeRoll > 0.7) {
    // Narrow Wall Gate
    entity = new Entity('hazard_box');
    entity.addComponent('render', { type: 'box' });
    const size = 0.95 + Math.random() * 0.5;
    entity.setLocalScale(size, size, size);
    entity.setPosition(
      (Math.random() - 0.5) * 2.8,
      (Math.random() - 0.5) * 2.0 + 0.35,
      -30
    );
    radius = size * 0.48;

    if (entity.render && entity.render.meshInstances[0]) {
      entity.render.meshInstances[0].material = obstacleMatDefault;
    }
  } else {
    // Spherical projectile
    entity = new Entity('hazard_sphere');
    entity.addComponent('render', { type: 'sphere' });
    const scale = 0.7 + Math.random() * 0.28;
    entity.setLocalScale(scale, scale, scale);
    entity.setPosition(
      (Math.random() - 0.5) * 3.0,
      (Math.random() - 0.5) * 2.2 + 0.35,
      -30
    );
    radius = scale * 0.48;

    if (entity.render && entity.render.meshInstances[0]) {
      entity.render.meshInstances[0].material = obstacleMatDefault;
    }
  }

  app.root.addChild(entity);
  activeObstacles.push({
    entity,
    radius,
    axis,
    halfLen,
    speed: cfg.speed * (0.92 + Math.random() * 0.16),
    rotSpeedX: axis ? 0 : (Math.random() - 0.5) * 220,
    rotSpeedY: axis ? 0 : (Math.random() - 0.5) * 220,
    clutchTriggered: false,
  });
}

// Distance in the XY plane from (x, y) to an obstacle's centre, or to the nearest point on a laser
function obstacleDistance(obs, x, y) {
  const p = obs.entity.getPosition();
  let dx = x - p.x;
  let dy = y - p.y;
  if (obs.axis === 'x') dx = Math.max(0, Math.abs(dx) - obs.halfLen);
  if (obs.axis === 'y') dy = Math.max(0, Math.abs(dy) - obs.halfLen);
  return Math.sqrt(dx * dx + dy * dy);
}

function clearObstacles() {
  for (const obs of activeObstacles) {
    obs.entity.destroy();
  }
  activeObstacles.length = 0;
}

// --- DOM ELEMENTS & HUD ---
const hudLevelNum = document.getElementById('hud-level-num');
const hudLevelName = document.getElementById('hud-level-name');
const hudPassRate = document.getElementById('hud-pass-rate');
const hudScore = document.getElementById('hud-score');
const levelProgress = document.getElementById('level-progress');
const clutchToast = document.getElementById('clutch-toast');
const levelAnnouncement = document.getElementById('level-announcement');
const annTitle = document.getElementById('ann-title');
const annSub = document.getElementById('ann-sub');

const startModal = document.getElementById('start-modal');
const gameoverModal = document.getElementById('gameover-modal');
const btnStart = document.getElementById('btn-start');
const btnRestart = document.getElementById('btn-restart');
const btnChallenge = document.getElementById('btn-challenge');

const goTitle = document.getElementById('go-title');
const goPercentile = document.getElementById('go-percentile');
const goRoast = document.getElementById('go-roast');
const goScore = document.getElementById('go-score');
const goLevel = document.getElementById('go-level');
const toastMessage = document.getElementById('toast-message');
const goMeta = document.getElementById('go-meta');
const goBest = document.getElementById('go-best');
const goNewBest = document.getElementById('go-new-best');
const startBest = document.getElementById('start-best');
const startLadder = document.getElementById('start-ladder');
const goLadder = document.getElementById('go-ladder');

const TOTAL_LEVELS = LEVELS_CONFIG.length;
const pad2 = (n) => String(n).padStart(2, '0');

// Build the progress segments and the pass-rate ladders from the level config
levelProgress.innerHTML = LEVELS_CONFIG.map(() => '<div class="level-seg"></div>').join('');

function renderLadder(el, outLevel = null) {
  el.innerHTML = LEVELS_CONFIG.map((cfg) => {
    const cls = ['rung'];
    if (cfg.lvl === TOTAL_LEVELS) cls.push('is-final');
    if (outLevel !== null) {
      if (cfg.lvl < outLevel) cls.push('is-passed');
      else if (cfg.lvl === outLevel) cls.push('is-out');
      else cls.push('is-locked');
    }
    const label = outLevel === cfg.lvl ? (cfg.lvl === TOTAL_LEVELS ? 'You' : 'Out') : `${cfg.pass}%`;
    return `<li class="${cls.join(' ')}">
      <span class="rung-n">${pad2(cfg.lvl)}</span>
      <span class="rung-name">${cfg.name}</span>
      <span class="rung-bar"><i style="--p:${cfg.pass / 100}"></i></span>
      <span class="rung-pct">${label}</span>
    </li>`;
  }).join('');
}
renderLadder(startLadder);

// Best score: session value, upgraded from Snap storage when available
let bestScore = 0;
let bestLevel = 0;
function renderStartBest() {
  startBest.textContent = bestScore > 0 ? `Best ${bestScore} · LV ${pad2(bestLevel)}` : '8 levels';
}
renderStartBest();

async function loadBest() {
  await snapchatInit;
  if (!snapchatReady || !snapchat.isSupported('storage')) return;
  try {
    const { found, value } = await snapchat.storage.get('best');
    if (found && value && value.score > bestScore) {
      bestScore = value.score;
      bestLevel = value.level;
      renderStartBest();
    }
  } catch {}
}
loadBest();

function setHudLevel(cfg) {
  hudLevelNum.textContent = pad2(cfg.lvl);
  hudLevelName.textContent = cfg.name;
  hudPassRate.textContent = `${cfg.pass}% pass`;
}

function updateProgressBar(lvl) {
  if (!levelProgress) return;
  const segs = levelProgress.querySelectorAll('.level-seg');
  segs.forEach((seg, index) => {
    if (index + 1 <= lvl) {
      seg.classList.add('active');
    } else {
      seg.classList.remove('active');
    }
  });
}

function showClutchToast(points) {
  clutchToast.textContent = `CLUTCH +${points}`;
  clutchToast.classList.add('show');
  setTimeout(() => {
    clutchToast.classList.remove('show');
  }, 420);
}

function showLevelAnnouncement(lvl) {
  const cfg = LEVELS_CONFIG[lvl - 1] || LEVELS_CONFIG[0];
  annTitle.textContent = cfg.lvl === TOTAL_LEVELS ? 'FINAL LEVEL' : `LEVEL ${cfg.lvl}`;
  annSub.textContent = `${cfg.name} — ${cfg.pass}% MAKE IT`;
  levelAnnouncement.classList.toggle('final', cfg.lvl === TOTAL_LEVELS);
  levelAnnouncement.classList.remove('leave');
  levelAnnouncement.classList.add('show');
  sfx.playLevelUp();

  clearTimeout(showLevelAnnouncement.timer);
  showLevelAnnouncement.timer = setTimeout(() => {
    levelAnnouncement.classList.add('leave');
    levelAnnouncement.classList.remove('show');
  }, 1300);
}

function showToast(msg) {
  toastMessage.textContent = msg;
  toastMessage.classList.add('show');
  setTimeout(() => {
    toastMessage.classList.remove('show');
  }, 2200);
}

// --- INPUT HANDLING (TIED TO CONTAINER DIMENSIONS) ---
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

window.addEventListener('pointerdown', (e) => {
  sfx.init();
  if (gameState !== STATE_PLAYING) return;
  isDragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  if (!isDragging || gameState !== STATE_PLAYING) return;
  const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  const deltaX = (e.clientX - lastPointerX) / (rect.width || 400);
  const deltaY = (e.clientY - lastPointerY) / (rect.height || 800);

  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  // Clamped responsive boundaries inside the 9:16 mobile frame
  playerTargetPos.x = Math.max(-1.55, Math.min(1.55, playerTargetPos.x + deltaX * 4.6));
  playerTargetPos.y = Math.max(-0.75, Math.min(1.45, playerTargetPos.y - deltaY * 4.6));
});

window.addEventListener('pointerup', () => {
  isDragging = false;
});
window.addEventListener('pointercancel', () => {
  isDragging = false;
});

// --- GAME LIFECYCLE ---
function applyLevel(cfg) {
  setHudLevel(cfg);
  headbandMat.emissive = cfg.color;
  headbandMat.diffuse = cfg.color;
  headbandMat.update();
  updateProgressBar(cfg.lvl);
}

function startGame(startLevel = 1, announce = true) {
  sfx.init();
  sfx.playStart();
  startModal.classList.add('hidden');
  gameoverModal.classList.add('hidden');

  score = 0;
  scoreRemainder = 0;
  currentLevel = startLevel;
  levelTimer = 0;
  spawnCooldown = 0.5;
  clearObstacles();

  playerTargetPos.set(0, 0.35, 0);
  playerCurrentPos.set(0, 0.35, 0);
  playerRoot.setPosition(0, 0.35, 0);
  playerRoot.setEulerAngles(0, 0, 0);

  hudScore.textContent = '0';
  applyLevel(LEVELS_CONFIG[startLevel - 1]);

  gameState = STATE_PLAYING;
  container.classList.add('is-playing');
  if (announce) showLevelAnnouncement(startLevel);
}

async function gameOver() {
  gameState = STATE_GAMEOVER;
  container.classList.remove('is-playing');
  screenShakeIntensity = 0.45;
  sfx.playHit();

  // Knock head back
  playerRoot.rotate(40, 0, 25);

  const cfg = LEVELS_CONFIG[currentLevel - 1] || LEVELS_CONFIG[0];
  const reachedFinal = currentLevel === TOTAL_LEVELS;
  // You beat everyone who failed before your level: rank = pass rate of the last level you cleared
  const cleared = LEVELS_CONFIG[currentLevel - 2];
  goPercentile.textContent = cleared ? `Top ${cleared.pass}%` : 'Bottom 1%';
  goMeta.textContent = `Out on LV ${pad2(currentLevel)}/${pad2(TOTAL_LEVELS)}`;
  goTitle.textContent = reachedFinal ? 'Top 1%' : 'Failed';
  goTitle.classList.toggle('win', reachedFinal);
  goRoast.textContent = cfg.roast;
  goScore.textContent = String(score);
  goLevel.textContent = `${currentLevel}/${TOTAL_LEVELS}`;
  renderLadder(goLadder, currentLevel);

  const isNewBest = score > bestScore;
  if (isNewBest) {
    bestScore = score;
    bestLevel = currentLevel;
    renderStartBest();
  }
  goBest.textContent = String(bestScore);
  goNewBest.classList.toggle('show', isNewBest);
  gameoverModal.classList.remove('hidden');
  loadBitmoji(); // fresh URL for the result screen

  // Submit to Snapchat Leaderboard & Storage
  if (snapchatReady) {
    if (snapchat.isSupported('leaderboards')) {
      try {
        await snapchat.leaderboards.submitScore({
          leaderboardId: 'main',
          score: score,
        });
      } catch (e) {
        console.warn('[WebLens] Failed to submit score to Snap leaderboard:', e);
      }
    }
    if (snapchat.isSupported('storage')) {
      if (isNewBest) {
        try {
          await snapchat.storage.set('best', { score: bestScore, level: bestLevel });
        } catch {}
      }
    }
  }
}

btnStart.addEventListener('click', () => startGame());

// Snapchat's own leaderboard panel, where the host supports it
const btnBoard = document.getElementById('btn-board');
snapchatInit.then(() => {
  btnBoard.hidden = !(snapchatReady && !snapchat.isStub && snapchat.isSupported('leaderboards'));
});
btnBoard.addEventListener('click', async () => {
  try {
    await snapchat.leaderboards.show();
  } catch {
    showToast('Leaderboard unavailable');
  }
});
btnRestart.addEventListener('click', () => startGame());

btnChallenge.addEventListener('click', async () => {
  const cfg = LEVELS_CONFIG[currentLevel - 1] || LEVELS_CONFIG[0];
  const shareText = `I reached Level ${currentLevel} (${cfg.passRate}) with ${score} PTS in "ONLY 1% CAN PASS"! Can you beat my reflexes?`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'ONLY 1% CAN PASS',
        text: shareText,
      });
      return;
    } catch {}
  }

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('Challenge copied');
      return;
    } catch {}
  }

  showToast('Screenshot this and send it');
});

// --- MAIN UPDATE LOOP ---
app.on('update', (dt) => {
  // Screen shake decay
  if (screenShakeIntensity > 0) {
    camera.setPosition(
      cameraBasePos.x + (Math.random() - 0.5) * screenShakeIntensity,
      cameraBasePos.y + (Math.random() - 0.5) * screenShakeIntensity,
      cameraBasePos.z
    );
    screenShakeIntensity = Math.max(0, screenShakeIntensity - dt * 1.6);
  } else {
    camera.setPosition(cameraBasePos.x, cameraBasePos.y, cameraBasePos.z);
  }

  // Animate Tunnel Floor Ribbons
  const tunnelSpeed = gameState === STATE_PLAYING ? (LEVELS_CONFIG[currentLevel - 1]?.speed || 16) * 0.75 : 8;
  for (const ribbon of tunnelRibbons) {
    ribbon.translate(0, 0, tunnelSpeed * dt);
    if (ribbon.getPosition().z > 4) {
      ribbon.setPosition(ribbon.getPosition().x, ribbon.getPosition().y, -ribbonCount * 2.2 + 4);
    }
  }

  // Animate Speed Particles
  for (const sp of speedParticles) {
    sp.translate(0, 0, (tunnelSpeed * 1.5) * dt);
    if (sp.getPosition().z > 5) {
      sp.setPosition(
        (Math.random() - 0.5) * 4.4,
        (Math.random() - 0.5) * 3.2 + 0.5,
        -30
      );
    }
  }

  if (gameState !== STATE_PLAYING) {
    // Idle gentle bobbing
    const time = performance.now() * 0.002;
    headMesh.setPosition(0, Math.sin(time) * 0.04, 0);
    return;
  }

  if (autopilot) autopilot(dt);

  // Smooth player movement with spring interpolation
  const lerpFactor = Math.min(1, dt * 18);
  playerVelocityX = (playerTargetPos.x - playerCurrentPos.x) * 12;
  playerVelocityY = (playerTargetPos.y - playerCurrentPos.y) * 12;

  playerCurrentPos.x += (playerTargetPos.x - playerCurrentPos.x) * lerpFactor;
  playerCurrentPos.y += (playerTargetPos.y - playerCurrentPos.y) * lerpFactor;
  playerRoot.setPosition(playerCurrentPos.x, playerCurrentPos.y, 0);

  // Dynamic head banking / tilting based on movement velocity
  const targetRoll = -playerVelocityX * 2.0;
  const targetPitch = playerVelocityY * 1.6;
  playerRoot.setEulerAngles(targetPitch, 0, targetRoll);

  // Level Progression Timer
  levelTimer += dt;
  scoreRemainder += dt * 15 * currentLevel;
  const earned = Math.floor(scoreRemainder);
  scoreRemainder -= earned;
  score += earned;
  hudScore.textContent = String(score);

  if (levelTimer >= LEVEL_DURATION && currentLevel < LEVELS_CONFIG.length) {
    currentLevel += 1;
    levelTimer = 0;
    applyLevel(LEVELS_CONFIG[currentLevel - 1]);
    showLevelAnnouncement(currentLevel);
  }

  // Spawning Hazards
  const cfg = LEVELS_CONFIG[currentLevel - 1];
  spawnCooldown -= dt;
  if (spawnCooldown <= 0) {
    spawnObstacle();
    spawnCooldown = cfg.spawnInterval * (0.85 + Math.random() * 0.3);
  }

  // Update Obstacles & Collision / Near-Miss Checks
  const playerPos = playerRoot.getPosition();
  const playerRadius = 0.52;
  let hazardVeryClose = false;

  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const obs = activeObstacles[i];
    obs.entity.translate(0, 0, obs.speed * dt);
    obs.entity.rotate(obs.rotSpeedX * dt, obs.rotSpeedY * dt, 0);

    const obsPos = obs.entity.getPosition();

    // Collision Check when obstacle crosses player plane
    if (obsPos.z > -1.1 && obsPos.z < 1.1) {
      const dist2D = obstacleDistance(obs, playerPos.x, playerPos.y);

      // Impact Collision!
      if (dist2D < obs.radius + playerRadius) {
        if (!onGodModeHit) {
          gameOver();
          return;
        }
        if (!obs.hitReported) onGodModeHit((obs.hitReported = true));
      }

      // Clutch / Near-miss detection!
      if (!obs.clutchTriggered && dist2D < obs.radius + playerRadius + 0.55) {
        obs.clutchTriggered = true;
        score += 50 * currentLevel;
        hudScore.textContent = String(score);
        sfx.playClutch();
        sfx.playWhoosh();
        showClutchToast(50 * currentLevel);
      }

      if (dist2D < obs.radius + playerRadius + 1.1) {
        hazardVeryClose = true;
      }
    }

    // Despawn past camera
    if (obsPos.z > 6.0) {
      obs.entity.destroy();
      activeObstacles.splice(i, 1);
    }
  }

  // Reactive facial expression
  if (hazardVeryClose) {
    mouth.setLocalScale(0.34, 0.26, 0.14); // Drop jaw in panic
    leftEye.setLocalScale(0.24, 0.26, 0.17);
    rightEye.setLocalScale(0.24, 0.26, 0.17);
  } else {
    mouth.setLocalScale(0.28, 0.08, 0.12); // Confident smile
    leftEye.setLocalScale(0.19, 0.21, 0.14);
    rightEye.setLocalScale(0.19, 0.21, 0.14);
  }
});

// Dev-only preview recorder hooks (tools/record-preview.mjs); stripped from production builds
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      sfx,
      app,
      cameraBasePos, // the update loop re-applies this every frame
      materials: { hazard: obstacleMatDefault, laser: obstacleMatLaser, headband: headbandMat },
      obstacles: activeObstacles,
      playerTargetPos,
      playerCurrentPos,
      obstacleDistance,
      levelDuration: LEVEL_DURATION,
      startGame,
      setGodMode: (fn) => (onGodModeHit = fn),
      setAutopilot: (fn) => (autopilot = fn),
      setLevelTimer: (t) => (levelTimer = t),
      setScore: (v) => {
        score = v;
        hudScore.textContent = String(v);
      },
    })
  );
}

// Start the engine
app.start();
