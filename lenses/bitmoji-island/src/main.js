import {
  Application,
  Asset,
  BLEND_NORMAL,
  CameraFrame,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  SHADOW_PCF3_32F,
  StandardMaterial,
  TONEMAP_NEUTRAL,
  Texture,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource-variable/nunito/wght.css';
import { sfx } from './audio.js';
import * as E from './economy.js';
import { SPACING, createIsland, plotPos } from './island.js';

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

const CROP_EMOJI = { carrot: '🥕', tomato: '🍅', sunflower: '🌻', pumpkin: '🎃', strawberry: '🍓' };
const DECOR_EMOJI = { tree: '🌳', fence: '🪵', bench: '🪑', pond: '🪷', windmill: '🌬️', lanterns: '🏮', cottage: '🏡', balloon: '🎈' };
const SAVE_KEY = 'island';

// --- ENGINE ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
const app = new Application(canvas, { graphicsDeviceOptions: { antialias: false } });
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
camera.addComponent('camera', { fov: 60, horizontalFov: true, nearClip: 0.3, farClip: 500, clearColor: new Color(0.66, 0.84, 0.97) });
app.root.addChild(camera);
const CAM_POS = new Vec3(0, 5.8, 12.6);
const CAM_LOOK = new Vec3(0, -1.6, 0);

const frame = new CameraFrame(app, camera.camera);
frame.rendering.toneMapping = TONEMAP_NEUTRAL;
frame.rendering.samples = 1;
frame.bloom.intensity = 0.012;
frame.vignette.intensity = 0.18;
frame.update();

const sun = new Entity('sun');
sun.addComponent('light', {
  type: 'directional',
  color: new Color(1, 0.94, 0.84),
  intensity: 1.15,
  castShadows: true,
  shadowType: SHADOW_PCF3_32F,
  shadowResolution: 1024,
  shadowDistance: 30,
  shadowBias: 0.3,
  normalOffsetBias: 0.04,
});
sun.lookAt(new Vec3(-0.45, -1, -0.55));
sun.rotateLocal(90, 0, 0);
app.root.addChild(sun);
app.scene.ambientLight = new Color(0.46, 0.48, 0.58);

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

const world = createIsland(app, mulberry32(42));
let islandYaw = -12;

// --- YOUR BITMOJI, living on the island ---
function buddyTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d');
  const ink = '#3b2f28';
  g.lineWidth = 9;
  g.strokeStyle = ink;
  g.lineJoin = 'round';
  g.fillStyle = '#5aa9ff';
  g.beginPath();
  g.roundRect(64, 196, 128, 120, 40);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd7b0';
  g.beginPath();
  g.arc(128, 132, 74, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#e9c46a'; // straw hat
  g.beginPath();
  g.ellipse(128, 76, 104, 26, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.roundRect(78, 30, 100, 50, 22);
  g.fill();
  g.stroke();
  g.fillStyle = ink;
  for (const x of [100, 156]) {
    g.beginPath();
    g.ellipse(x, 136, 8, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(128, 154, 26, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  const t = new Texture(app.graphicsDevice, { width: 256, height: 320 });
  t.setSource(c);
  // The same character is the HUD portrait until a Bitmoji arrives
  const url = c.toDataURL();
  document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = `url("${url}")`));
  return t;
}

const buddyMat = new StandardMaterial();
buddyMat.useLighting = false;
buddyMat.useFog = false;
buddyMat.diffuse = new Color(0, 0, 0);
buddyMat.emissive = new Color(1, 1, 1);
buddyMat.alphaTest = 0.4;
buddyMat.opacityMapChannel = 'a';
buddyMat.blendType = BLEND_NORMAL;
function setBuddyTexture(tex) {
  buddyMat.emissiveMap = tex;
  buddyMat.opacityMap = tex;
  buddyMat.update();
}
const defaultBuddy = buddyTexture();
setBuddyTexture(defaultBuddy);

const buddy = new Entity('buddy');
world.island.addChild(buddy);
const buddyCard = new Entity('buddy-card');
buddyCard.addComponent('render', { type: 'plane', material: buddyMat, castShadows: true });
buddyCard.setLocalEulerAngles(90, 180, 0);
buddyCard.setLocalScale(1.5, 1, 1.85);
buddyCard.setLocalPosition(0, 0.95, 0);
const buddyPivot = new Entity('buddy-pivot'); // faces the camera
buddy.addChild(buddyPivot);
buddyPivot.addChild(buddyCard);
const shadowMat = new StandardMaterial();
shadowMat.useLighting = false;
shadowMat.diffuse = new Color(0, 0, 0);
shadowMat.emissive = new Color(0.1, 0.12, 0.05);
shadowMat.opacity = 0.28;
shadowMat.blendType = BLEND_NORMAL;
shadowMat.depthWrite = false;
shadowMat.update();
const buddyShadow = new Entity('buddy-shadow');
buddyShadow.addComponent('render', { type: 'cylinder', material: shadowMat, castShadows: false });
buddyShadow.setLocalScale(0.9, 0.01, 0.55);
buddyShadow.setLocalPosition(0, 0.02, 0);
buddy.addChild(buddyShadow);

const buddyState = { pos: new Vec3(2.6, 0, 3.6), target: new Vec3(2.6, 0, 3.6), hop: 0, cheer: 0 };
const expressions = []; // Bitmoji variant textures
let expressionIndex = 0;

// --- STATE ---
let save = E.newSave(Date.now());
let selectedCrop = 'carrot';
let lastScoreSubmit = 0;
let saveTimer = 0;
let autopilot = null; // dev capture only
let cameraOverride = null; // dev capture only
let chirpIn = 5;
const decorPop = {};

// --- DOM ---
const $ = (id) => document.getElementById(id);
const ui = {
  coins: $('coins'),
  level: $('level'),
  xpRing: $('xp-ring'),
  streak: $('streak'),
  streakPill: $('streak-pill'),
  orders: $('orders'),
  seeds: $('seeds'),
  floats: $('floats'),
  hint: $('hint'),
  banner: $('banner'),
  bannerTitle: $('banner-title'),
  bannerSub: $('banner-sub'),
  build: $('build'),
  buildList: $('build-list'),
  welcome: $('welcome'),
  welcomeTitle: $('welcome-title'),
  welcomeLines: $('welcome-lines'),
  toast: $('toast'),
};
const RING = 2 * Math.PI * 23.5;
ui.xpRing.style.strokeDasharray = `${RING}`;

let toastTimer = 0;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

let bannerTimer = 0;
function showBanner(title, sub) {
  ui.bannerTitle.textContent = title;
  ui.bannerSub.textContent = sub;
  ui.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('show'), 1800);
}

const fmtTime = (ms) => {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

function renderHud() {
  ui.coins.textContent = save.coins.toLocaleString('en-US');
  ui.level.textContent = String(save.level);
  ui.xpRing.style.strokeDashoffset = `${RING * (1 - save.xp / E.xpForLevel(save.level))}`;
  ui.streak.textContent = String(Math.max(1, save.daily.streak));
  ui.orders.innerHTML = save.orders
    .map(
      (o) =>
        `<div class="order"><div class="icon">${CROP_EMOJI[o.crop]}</div><div>${o.have}/${o.need} ${E.CROPS[o.crop].name.toLowerCase()}s<small>+${o.coins} coins</small><div class="bar"><i style="width:${(o.have / o.need) * 100}%"></i></div></div></div>`
    )
    .join('');
}

function renderSeeds() {
  ui.seeds.innerHTML = E.CROP_IDS.map((id) => {
    const c = E.CROPS[id];
    const locked = c.level > save.level;
    return `<button class="seed ${id === selectedCrop ? 'selected' : ''} ${locked ? 'locked' : ''}" data-crop="${id}">
      <span class="emoji">${CROP_EMOJI[id]}</span>
      ${locked ? `<span>Lv ${c.level}</span><span class="time">locked</span>` : `<span class="cost"><span class="coin"></span>${c.cost}</span><span class="time">${fmtTime(c.grow)}</span>`}
    </button>`;
  }).join('');
}

ui.seeds.addEventListener('click', (e) => {
  const btn = e.target.closest('.seed');
  if (!btn) return;
  const id = btn.dataset.crop;
  if (E.CROPS[id].level > save.level) {
    sfx.nope();
    showToast(`${E.CROPS[id].name}s unlock at level ${E.CROPS[id].level}`);
    return;
  }
  selectedCrop = id;
  renderSeeds();
});

function renderBuild() {
  const items = [];
  const next = E.nextPlot(save);
  if (next !== null) {
    const cost = E.plotCost(E.unlockedCount(save));
    items.push(`<button class="item ${save.coins < cost ? 'cant' : ''}" data-buy="plot"><div class="icon">🟫</div><div><div class="name">New garden plot</div><div class="desc">${E.unlockedCount(save)} of ${E.GRID * E.GRID} plots</div></div><span class="price"><span class="coin"></span>${cost}</span></button>`);
  }
  for (const id of E.DECOR_IDS) {
    const d = E.DECOR[id];
    const owned = save.decor.includes(id);
    const locked = d.level > save.level;
    const cls = owned ? 'owned' : locked ? 'locked' : save.coins < d.cost ? 'cant' : '';
    const price = owned ? 'Placed ✓' : locked ? `Level ${d.level}` : `<span class="coin"></span>${d.cost}`;
    items.push(`<button class="item ${cls}" data-buy="${id}"><div class="icon">${DECOR_EMOJI[id]}</div><div><div class="name">${d.name}</div><div class="desc">Decoration</div></div><span class="price">${price}</span></button>`);
  }
  ui.buildList.innerHTML = items.join('');
}

ui.buildList.addEventListener('click', (e) => {
  const btn = e.target.closest('.item');
  if (!btn) return;
  const what = btn.dataset.buy;
  if (what === 'plot') {
    const i = E.buyPlot(save);
    if (i === null) return (sfx.nope(), showToast('Not enough coins yet'));
    sfx.buy();
    popEntity(world.plots[i].root);
  } else {
    if (save.decor.includes(what)) return;
    if (!E.buyDecor(save, what)) {
      sfx.nope();
      return showToast(E.DECOR[what].level > save.level ? `Unlocks at level ${E.DECOR[what].level}` : 'Not enough coins yet');
    }
    sfx.buy();
    world.decor[what].enabled = true;
    popEntity(world.decor[what]);
    setTimeout(() => closeBuild(), 450);
  }
  changed();
  renderBuild();
});

function openBuild() {
  renderBuild();
  ui.build.classList.remove('hidden');
}
function closeBuild() {
  ui.build.classList.add('hidden');
}
$('btn-build').addEventListener('click', () => {
  sfx.init();
  openBuild();
});
$('btn-close').addEventListener('click', closeBuild);
ui.build.addEventListener('click', (e) => e.target === ui.build && closeBuild());

// --- FEEDBACK ---
const tmp = new Vec3();
function screenOf(local) {
  // island-local → world → screen
  tmp.copy(local);
  world.island.getWorldTransform().transformPoint(tmp, tmp);
  const s = camera.camera.worldToScreen(tmp, new Vec3());
  const c = canvas.getBoundingClientRect();
  const k = container.getBoundingClientRect();
  return { x: s.x + c.left - k.left, y: s.y + c.top - k.top };
}

function floatText(local, html, cls = '') {
  const { x, y } = screenOf(local);
  const el = document.createElement('div');
  el.className = `float ${cls}`;
  el.innerHTML = html;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  ui.floats.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

const pops = [];
function popEntity(e) {
  const base = e.getLocalScale().clone();
  pops.push({ e, base, t: 0 });
}

function cheer() {
  buddyState.cheer = 0.6;
  if (expressions.length > 1) {
    expressionIndex = (expressionIndex + 1) % expressions.length;
    setBuddyTexture(expressions[expressionIndex]);
  }
}

// --- SAVE / LOAD ---
function changed() {
  renderHud();
  renderSeeds();
  saveTimer = 0.8;
}

async function persist() {
  const data = JSON.parse(JSON.stringify(save));
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
  if (snapchatReady && snapchat.isSupported('storage')) {
    try {
      await snapchat.storage.set(SAVE_KEY, data);
    } catch (e) {
      console.warn('[WebLens] Save failed:', e?.message);
    }
  }
  const now = Date.now();
  if (snapchatReady && snapchat.isSupported('leaderboards') && now - lastScoreSubmit > 20_000) {
    lastScoreSubmit = now;
    try {
      await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score: E.islandScore(save) });
    } catch {}
  }
}

async function load() {
  await snapchatInit;
  let data = null;
  if (snapchatReady && snapchat.isSupported('storage')) {
    try {
      const { found, value } = await snapchat.storage.get(SAVE_KEY);
      if (found) data = value;
    } catch {}
  }
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch {}
  }
  if (data && data.v === 1) save = data;
  return !!data;
}

// --- PLAY ---
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function walkTo(i) {
  const [x, , z] = plotPos(i);
  buddyState.target.set(x + 0.95, 0, z + 0.75);
}

function tapPlot(i) {
  const plot = save.plots[i];
  const now = Date.now();
  const [x, , z] = plotPos(i);
  const above = new Vec3(x, 1.4, z);
  if (!plot.unlocked) {
    if (i === E.nextPlot(save)) openBuild();
    else sfx.nope();
    return;
  }
  walkTo(i);
  if (E.isReady(plot, now)) {
    const cropIndex = E.CROP_IDS.indexOf(plot.crop);
    const r = E.harvest(save, i, now);
    sfx.harvest(cropIndex * 2);
    floatText(above, `<span class="coin"></span>+${r.coins}`);
    setTimeout(() => floatText(new Vec3(x, 2.1, z), `+${r.xp} XP`, 'xp'), 120);
    popEntity(world.plots[i].root);
    cheer();
    if (r.orderDone) {
      setTimeout(() => {
        sfx.order();
        showBanner('Order complete!', `+${r.orderDone.coins} coins for ${r.orderDone.need} ${E.CROPS[r.orderDone.crop].name.toLowerCase()}s`);
      }, 250);
    }
    if (r.levelsGained) {
      const unlocked = E.CROP_IDS.find((id) => E.CROPS[id].level === save.level);
      const decor = E.DECOR_IDS.filter((id) => E.DECOR[id].level === save.level).map((id) => E.DECOR[id].name);
      setTimeout(
        () => {
          sfx.levelUp();
          showBanner(`Level ${save.level}!`, unlocked ? `${E.CROPS[unlocked].name}s unlocked` : decor.length ? `${decor[0]} unlocked` : 'Your island is growing');
        },
        r.orderDone ? 1900 : 300
      );
    }
    E.refillOrders(save, Math.random);
    hintStep(2);
  } else if (!plot.crop) {
    if (!E.plant(save, i, selectedCrop, now)) {
      sfx.nope();
      const c = E.CROPS[selectedCrop];
      showToast(save.coins < c.cost ? `You need ${c.cost} coins for a ${c.name.toLowerCase()}` : 'Pick a seed below');
      return;
    }
    sfx.plant();
    floatText(above, `<span class="coin"></span>−${E.CROPS[selectedCrop].cost}`);
    hintStep(1);
  } else if (E.water(save, i, now)) {
    sfx.water();
    floatText(above, '💧 Faster!');
  } else {
    showToast(`${E.CROPS[plot.crop].name} ready in ${fmtTime(plot.plantedAt + plot.grow - now)}`);
  }
  changed();
}

let hintAt = 0;
function hintStep(step) {
  if (step <= hintAt) return;
  hintAt = step;
  if (step === 1) ui.hint.textContent = 'It sparkles when ready. Tap to harvest!';
  if (step >= 2) ui.hint.classList.add('hidden');
}

// --- INPUT: tap a plot; drag to spin the island ---
let downX = 0;
let downY = 0;
let lastX = 0;
let dragging = false;
let pointerId = null;
container.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .scrim:not(.hidden), #seeds')) return;
  sfx.init();
  pointerId = e.pointerId;
  downX = lastX = e.clientX;
  downY = e.clientY;
  dragging = false;
});
container.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) dragging = true;
  if (dragging) islandYaw += (e.clientX - lastX) * 0.35;
  lastX = e.clientX;
});
container.addEventListener('pointerup', (e) => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  if (dragging) return;
  const rect = canvas.getBoundingClientRect();
  const i = plotAt(e.clientX - rect.left, e.clientY - rect.top);
  if (i !== null) tapPlot(i);
});

const rayA = new Vec3();
const rayB = new Vec3();
function plotAt(sx, sy) {
  camera.camera.screenToWorld(sx, sy, camera.camera.nearClip, rayA);
  camera.camera.screenToWorld(sx, sy, camera.camera.farClip, rayB);
  const y = 0.2;
  const t = (rayA.y - y) / (rayA.y - rayB.y);
  const hit = new Vec3(rayA.x + (rayB.x - rayA.x) * t, y, rayA.z + (rayB.z - rayA.z) * t);
  // Into the island's (rotated) space
  const inv = world.island.getWorldTransform().clone().invert();
  inv.transformPoint(hit, hit);
  const col = Math.round(hit.x / SPACING + (E.GRID - 1) / 2);
  const row = Math.round(hit.z / SPACING + (E.GRID - 1) / 2);
  if (col < 0 || row < 0 || col >= E.GRID || row >= E.GRID) return null;
  const [px, , pz] = plotPos(row * E.GRID + col);
  if (Math.abs(hit.x - px) > 0.9 || Math.abs(hit.z - pz) > 0.9) return null;
  return row * E.GRID + col;
}

$('btn-share').addEventListener('click', async () => {
  const decor = save.decor.length ? ` and a ${E.DECOR[save.decor[save.decor.length - 1]].name.toLowerCase()}` : '';
  const text = `My Bitmoji Island is level ${save.level} with ${E.unlockedCount(save)} garden plots${decor} 🌻 Come grow yours!`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Bitmoji Island', text });
      return;
    } catch {}
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied: send it to a friend');
      return;
    } catch {}
  }
  showToast('Screenshot your island and send it');
});
$('btn-board').addEventListener('click', async () => {
  try {
    await snapchat.leaderboards.show();
  } catch {
    showToast('Leaderboard unavailable');
  }
});

// --- FRAME LOOP ---
const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
let time = 0;
app.on('update', (dt) => {
  dt = Math.min(dt, 1 / 20);
  time += dt;
  if (autopilot) autopilot(dt);
  const now = Date.now();

  world.island.setLocalEulerAngles(0, islandYaw, 0);
  world.island.setLocalPosition(0, Math.sin(time * 0.6) * 0.12, 0);

  // Plots and crops
  const next = E.nextPlot(save);
  save.plots.forEach((p, i) => {
    const v = world.plots[i];
    v.soil.enabled = p.unlocked;
    v.sign.enabled = !p.unlocked && i === next;
    if (!p.unlocked || !p.crop) {
      world.setPlantMesh(v, null);
      v.sparkle.enabled = false;
      return;
    }
    const progress = E.cropProgress(p, now);
    if (progress < 0.25) {
      world.setPlantMesh(v, 'sprout');
      const s = 0.6 + progress * 1.6;
      v.plant.setLocalScale(s, s, s);
    } else {
      world.setPlantMesh(v, p.crop);
      const ready = progress >= 1;
      const s = ready ? 1 + Math.sin(time * 5 + i) * 0.04 : 0.45 + progress * 0.5;
      v.plant.setLocalScale(s, s, s);
    }
    v.sparkle.enabled = progress >= 1;
    if (progress >= 1) v.sparkle.setLocalEulerAngles(0, time * 60 + i * 20, 0);
  });

  // Decorations, clouds, windmill, balloon
  for (const id of E.DECOR_IDS) world.decor[id].enabled = save.decor.includes(id);
  world.blades.setLocalEulerAngles(0, 0, time * 40);
  world.decor.balloon.setLocalPosition(-7.5, 5.5 + Math.sin(time * 0.8) * 0.4, -5.5);
  for (const c of world.clouds) {
    const p = c.e.getLocalPosition();
    c.e.setLocalPosition(p.x + c.speed * dt, p.y, p.z);
    if (p.x > 26) c.e.setLocalPosition(-26, p.y, p.z);
  }

  // Pop-in bounce for anything just bought or harvested
  for (let k = pops.length - 1; k >= 0; k--) {
    const pop = pops[k];
    pop.t += dt;
    const p = Math.min(1, pop.t / 0.45);
    const s = 1 + Math.sin(p * Math.PI) * 0.25 * (1 - p) - (p < 0.2 ? (0.2 - p) * 2 : 0);
    pop.e.setLocalScale(pop.base.x * s, pop.base.y * s, pop.base.z * s);
    if (p >= 1) {
      pop.e.setLocalScale(pop.base);
      pops.splice(k, 1);
    }
  }

  // Bitmoji: walks with a hop, bobs when idle, jumps when cheering
  const b = buddyState;
  const toTarget = b.target.clone().sub(b.pos);
  const dist = toTarget.length();
  if (dist > 0.05) {
    b.pos.add(toTarget.mulScalar(Math.min(1, (5.5 * dt) / dist)));
    b.hop += dt * 14;
  }
  b.cheer = Math.max(0, b.cheer - dt);
  const hopY = dist > 0.05 ? Math.abs(Math.sin(b.hop)) * 0.18 : 0;
  const cheerY = b.cheer > 0 ? Math.sin((1 - b.cheer / 0.6) * Math.PI) * 0.55 : 0;
  buddy.setLocalPosition(b.pos.x, 0.16, b.pos.z);
  buddyPivot.setLocalPosition(0, hopY + cheerY + Math.sin(time * 2.2) * 0.03, 0);
  const cp = camera.getPosition();
  const bp = buddyPivot.getPosition();
  buddyPivot.lookAt(new Vec3(cp.x, bp.y, cp.z));

  // Camera (gently breathing)
  camera.setPosition(CAM_POS.x + Math.sin(time * 0.2) * 0.3, CAM_POS.y, CAM_POS.z);
  camera.lookAt(CAM_LOOK);
  if (cameraOverride) cameraOverride(camera);
  world.sky.setPosition(camera.getPosition());

  // Life: birds now and then
  chirpIn -= dt;
  if (chirpIn <= 0) {
    chirpIn = 6 + Math.random() * 9;
    sfx.chirp();
  }

  if (saveTimer > 0) {
    saveTimer -= dt;
    if (saveTimer <= 0) persist();
  }
});

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

async function loadBitmoji() {
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    // Portrait for the HUD, then a few server-curated poses for the character on the island.
    // URLs expire after ~5 minutes, so each is loaded as soon as it arrives.
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'medium' });
    document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = `url("${url}")`));
    const { variants } = await snapchat.bitmoji.getVariants();
    for (const [i, variant] of [undefined, ...variants.slice(0, 3)].entries()) {
      try {
        const media = await snapchat.bitmoji.get2DAvatar(variant ? { variant, size: 'large' } : { size: 'large' });
        expressions.push(await loadTexture(`bitmoji-${i}`, media.url));
        if (expressions.length === 1) setBuddyTexture(expressions[0]);
      } catch {}
    }
  } catch (e) {
    console.warn('[WebLens] Using the default islander:', e?.message);
  }
}

// --- BOOT ---
async function boot() {
  const returning = await load();
  E.refillOrders(save, Math.random);
  const d = new Date();
  const today = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  const yesterday = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  const gift = E.claimDaily(save, today, yesterday);
  const now = Date.now();
  const ready = save.plots.filter((p) => E.isReady(p, now)).length;
  if (gift || !returning) {
    ui.welcomeTitle.textContent = returning ? 'Welcome back!' : 'Welcome to your island!';
    const lines = [];
    if (!returning) lines.push('Plant seeds, harvest crops and grow your island. <b>Crops keep growing while you’re away.</b>');
    if (gift) lines.push(`Day ${gift.streak} visit 🔥 <b>+${gift.coins} coins</b>`);
    if (ready) lines.push(`<b>${ready} ${ready === 1 ? 'crop is' : 'crops are'} ready</b> to harvest`);
    ui.welcomeLines.innerHTML = lines.join('<br>');
    ui.welcome.classList.remove('hidden');
  }
  if (returning) ui.hint.classList.add('hidden'), (hintAt = 2);
  for (const id of save.decor) world.decor[id].enabled = true;
  changed();
}
$('btn-welcome').addEventListener('click', () => {
  sfx.init();
  sfx.gift();
  ui.welcome.classList.add('hidden');
});

snapchatInit.then(() => {
  $('btn-board').hidden = !(snapchatReady && !snapchat.isStub && snapchat.isSupported('leaderboards'));
});
renderSeeds();
renderHud();
boot();
loadBitmoji();

// Dev-only preview video / icon hooks (npm run record-preview, npm run render-icon).
// Stripped from production builds. See src/capture.js for the contract.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      app,
      sfx,
      camera,
      world,
      E,
      tapPlot,
      changed,
      getSave: () => save,
      setSave: (s) => (save = s),
      setYaw: (y) => (islandYaw = y),
      setAutopilot: (fn) => (autopilot = fn),
      setCameraOverride: (fn) => (cameraOverride = fn),
      hideWelcome: () => ui.welcome.classList.add('hidden'),
      hideHint: () => ui.hint.classList.add('hidden'),
    })
  );
}

app.start();
