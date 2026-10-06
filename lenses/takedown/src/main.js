import {
  Application,
  BLEND_ADDITIVE,
  CameraFrame,
  Color,
  Entity,
  FILLMODE_NONE,
  FOG_LINEAR,
  RESOLUTION_AUTO,
  StandardMaterial,
  TONEMAP_ACES2,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource/barlow-condensed/800-italic.css';
import { sfx } from './audio.js';
import { PLAYER_LOOK, RIVAL_LOOKS, SIZES, TRAFFIC_LOOKS, createCar } from './cars.js';
import { LANES, RAIL_X, createWorld } from './world.js';

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

// --- TUNING (metres, m/s; the player drives at z = 0 and everything else moves relative to it) ---
const SPEED_START = 40;
const SPEED_RAMP = 0.12; // m/s gained per second of driving
const SPEED_RAMP_MAX = 14;
const BOOST_SPEED = 24; // added while boosting
const BOOST_DRAIN = 0.34; // meter per second
const STEER_LIMIT = RAIL_X - 1.05;
const LIVES = 3;
const RESPAWN_GHOST = 2.2;
const CREDIT_WINDOW = 3; // seconds after a player hit that a rival's crash still counts as a takedown
const SPAWN_Z = -280;

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
camera.addComponent('camera', { fov: 52, horizontalFov: true, nearClip: 0.2, farClip: 1200, clearColor: new Color(0.04, 0.035, 0.07) });
app.root.addChild(camera);

const frame = new CameraFrame(app, camera.camera);
frame.rendering.toneMapping = TONEMAP_ACES2;
frame.rendering.samples = 1;
frame.bloom.intensity = 0.028;
frame.bloom.blurLevel = 14;
frame.vignette.intensity = 0.4;
frame.vignette.inner = 0.5;
frame.vignette.outer = 1.15;
frame.update();

app.scene.fog.type = FOG_LINEAR;
app.scene.fog.color = new Color(0.16, 0.08, 0.13);
app.scene.fog.start = 60;
app.scene.fog.end = 320;
app.scene.ambientLight = new Color(0.2, 0.18, 0.26);

const key = new Entity('key'); // low sun ahead, warm
key.addComponent('light', { type: 'directional', intensity: 1.3, color: new Color(1, 0.72, 0.5) });
key.lookAt(new Vec3(0.2, -0.35, 1));
key.rotateLocal(90, 0, 0);
app.root.addChild(key);
const fill = new Entity('fill'); // cool sky fill from behind the camera
fill.addComponent('light', { type: 'directional', intensity: 0.9, color: new Color(0.55, 0.62, 1) });
fill.lookAt(new Vec3(-0.3, -0.8, -0.5));
fill.rotateLocal(90, 0, 0);
app.root.addChild(fill);

const world = createWorld(app);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// --- CARS ---
/** @typedef {{ role: 'player'|'rival'|'traffic', kind: string, root: Entity, visual: Entity, x: number, z: number,
 *  speed: number, vx: number, hw: number, hl: number, wreck: object|null, hp: number, lastHit: number }} Car */
const cars = [];
let player = null;

function addCar(role, kind, look, x, z, speed) {
  const { root, visual } = createCar(app, kind, look.paint ?? look[0], look.stripe ?? look[1]);
  const car = { role, kind, root, visual, x, z, speed, vx: 0, ...SIZES[kind], wreck: null, hp: 3, lastHit: -99, yaw: 0, laneX: x, aiTimer: rand(0.5, 2), offset: rand(-2, 5), brain: rand(0, 10) };
  if (speed < 0) root.setLocalEulerAngles(0, 180, 0); // oncoming
  cars.push(car);
  return car;
}

function removeCar(car) {
  car.root.destroy();
  cars.splice(cars.indexOf(car), 1);
}

// --- STATE ---
let state = 'menu';
let elapsed = 0;
let lives = LIVES;
let takedowns = 0;
let streak = 0;
let score = 0;
let scoreRemainder = 0;
let boost = 0.35;
let boostHeld = false;
let boosting = false;
let nearMisses = 0;
let topSpeed = 0;
let distance = 0;
let ghost = 0; // player invulnerable after a respawn
let steerTarget = 1.6;
let spawnTimer = 0;
let timeScale = 1;
let slowmoTimer = 0;
let crashCam = null; // { car, t, side }
let respawnTimer = 0;
let countdown = 0;
let shake = 0;
let menuTime = 0;
let autopilot = null; // dev capture only
let godMode = null; // dev capture only
let cameraOverride = null; // dev capture only: (camera) => void

const saved = { bestTakedowns: 0, bestScore: 0 };

// --- DOM ---
const $ = (id) => document.getElementById(id);
const ui = {
  takedowns: $('takedowns'),
  score: $('score'),
  speed: $('speed'),
  boostFill: $('boost-fill'),
  boostBtn: $('btn-boost'),
  lives: $('lives'),
  callouts: $('callouts'),
  flash: $('flash'),
  menu: $('menu'),
  over: $('over'),
  menuBest: $('menu-best'),
  driverLine: $('driver-line'),
  rTakedowns: $('r-takedowns'),
  rScore: $('r-score'),
  rTop: $('r-top'),
  rNear: $('r-near'),
  rKm: $('r-km'),
  newBest: $('new-best'),
  toast: $('toast'),
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const HELMET_SVG = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1b1d2a"/><circle cx="20" cy="21" r="12" fill="#1f6bff"/><rect x="10" y="17" width="20" height="7" rx="3" fill="#111"/><rect x="18" y="9" width="4" height="24" fill="#f4f6fb"/></svg>'
)}")`;
const setPortraits = (css) => document.querySelectorAll('[data-avatar]').forEach((el) => (el.style.backgroundImage = css));
setPortraits(HELMET_SVG);

function setScreen(name) {
  container.classList.toggle('is-menu', name === 'menu');
  container.classList.toggle('is-over', name === 'over');
  ui.menu.classList.toggle('hidden', name !== 'menu');
  ui.over.classList.toggle('hidden', name !== 'over');
}

function callout(text, cls = '') {
  const el = document.createElement('div');
  el.className = `callout ${cls}`;
  el.textContent = text;
  ui.callouts.appendChild(el);
  setTimeout(() => el.remove(), cls.includes('big') ? 1700 : 1100);
}

function flash() {
  ui.flash.classList.add('show');
  setTimeout(() => ui.flash.classList.remove('show'), 80);
}

let toastTimer = 0;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function renderLives() {
  [...ui.lives.children].forEach((pip, i) => pip.classList.toggle('off', i >= lives));
}

function renderMenu() {
  ui.menuBest.textContent = saved.bestTakedowns > 0 ? `Best ${saved.bestTakedowns} takedowns` : '';
}

// --- SPARKS ---
const sparkMat = new StandardMaterial();
sparkMat.useLighting = false;
sparkMat.diffuse = new Color(0, 0, 0);
sparkMat.emissive = new Color(1, 0.75, 0.35);
sparkMat.emissiveIntensity = 6;
sparkMat.blendType = BLEND_ADDITIVE;
sparkMat.depthWrite = false;
sparkMat.update();
const sparks = [];
function sparkBurst(x, y, z, count, power = 1) {
  for (let i = 0; i < count; i++) {
    const e = new Entity('spark');
    e.addComponent('render', { type: 'box', material: sparkMat });
    e.setLocalScale(0.05, 0.05, rand(0.2, 0.5));
    e.setPosition(x, y, z);
    app.root.addChild(e);
    sparks.push({ e, vel: new Vec3(rand(-6, 6) * power, rand(2, 8) * power, rand(0, 14) * power), life: rand(0.25, 0.6), age: 0 });
  }
}

// --- EVENTS ---
function slowmo(car, seconds = 1.15) {
  timeScale = 0.22;
  slowmoTimer = seconds;
  crashCam = { car, t: 0, side: car.x < player.x ? -1 : 1 };
}

function startWreck(car, impact, push = 0) {
  car.wreck = {
    y: 0,
    vy: 4 + impact * 0.18,
    rot: new Vec3(0, car.speed < 0 ? 180 : 0, 0),
    spin: new Vec3(rand(-1, 1) * impact * 9, rand(-1, 1) * impact * 14, rand(-1, 1) * impact * 12 + push * 40),
    bounces: 0,
  };
  car.vx += push * 6;
  sparkBurst(car.x, 0.6, car.z, 18, 1.2);
}

function takedown(car, how) {
  if (car.wreck) return;
  startWreck(car, 30, Math.sign(car.vx) || 1);
  takedowns += 1;
  streak += 1;
  const points = Math.round(1000 * (1 + (streak - 1) * 0.25));
  score += points;
  boost = Math.min(1, boost + 0.5);
  sfx.takedown();
  flash();
  shake = 0.6;
  callout('TAKEDOWN!', 'big');
  callout(`${how} +${fmt(points)}`);
  try {
    navigator.vibrate?.([30, 40, 60]);
  } catch {}
  slowmo(car);
}

function wreckPlayer(impact, cause) {
  if (player.wreck || ghost > 0 || state !== 'playing') return;
  if (godMode) {
    godMode(performance.now() / 1000, cause);
    return;
  }
  startWreck(player, impact, 0);
  lives -= 1;
  streak = 0;
  boostHeld = false;
  renderLives();
  sfx.wreck();
  flash();
  shake = 0.9;
  callout('WRECKED', 'big red');
  try {
    navigator.vibrate?.(140);
  } catch {}
  slowmo(player, 1.5);
  respawnTimer = 2.2;
}

function respawn() {
  player.wreck = null;
  player.visual.setLocalEulerAngles(0, 0, 0);
  player.visual.setLocalPosition(0, 0, 0);
  player.x = LANES[2];
  player.vx = 0;
  steerTarget = LANES[2];
  player.speed = Math.max(SPEED_START, player.speed * 0.6);
  ghost = RESPAWN_GHOST;
  // Clear the road around the respawn point
  for (const car of [...cars]) if (car !== player && car.z > -40 && car.z < 20 && car.role === 'traffic') removeCar(car);
}

// --- SPAWNING ---
function laneFree(x, z, gap = 34) {
  return !cars.some((c) => c !== player && Math.abs(c.x - x) < 2 && Math.abs(c.z - z) < gap);
}

function spawnTraffic() {
  const lane = pick(LANES);
  if (!laneFree(lane, SPAWN_Z)) return;
  const oncoming = lane < 0;
  const roll = Math.random();
  const kind = roll < 0.18 ? 'truck' : roll < 0.36 ? 'van' : 'sedan';
  const look = kind === 'truck' ? pick(TRAFFIC_LOOKS.truck) : { paint: pick(TRAFFIC_LOOKS[kind]), stripe: '#ffffff' };
  const speed = oncoming ? -rand(20, 28) : rand(18, 28) * (kind === 'truck' ? 0.8 : 1);
  addCar('traffic', kind, look, lane + rand(-0.3, 0.3), SPAWN_Z, speed);
}

function spawnRival(z = 30) {
  const x = pick([LANES[2], LANES[3]]);
  const look = pick(RIVAL_LOOKS);
  const rival = addCar('rival', 'sport', look, x, z, player.speed + 9);
  rival.hp = 3;
  return rival;
}

function rivalCount() {
  return cars.filter((c) => c.role === 'rival' && !c.wreck).length;
}

// --- SIMULATION ---
function overlap(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ox = a.hw + b.hw - Math.abs(dx);
  const oz = a.hl + b.hl - Math.abs(dz);
  return ox > 0 && oz > 0 ? { dx, dz, ox, oz } : null;
}

function updateRival(r, dt) {
  // Hang around the player: catch up from behind, ease off when far ahead
  r.brain += dt;
  let desired = player.speed + r.offset + Math.sin(r.brain * 0.7) * 3;
  if (r.z > 18) desired = player.speed + 10;
  if (r.z < -70) desired = player.speed - 8;
  r.speed += Math.max(-10 * dt, Math.min(10 * dt, desired - r.speed));

  // Pick the clearest lane ahead (same-direction lanes preferred), now and then go for the player
  r.aiTimer -= dt;
  if (r.aiTimer <= 0) {
    r.aiTimer = rand(0.8, 2);
    let best = r.laneX;
    let bestScore = -Infinity;
    for (const lane of LANES) {
      let clear = 80;
      for (const c of cars) {
        if (c === r || c.role === 'player' || c.wreck || Math.abs(c.x - lane) > 1.8) continue;
        const ahead = r.z - c.z;
        if (ahead > -4 && ahead < clear) clear = ahead;
      }
      const s = clear - Math.abs(lane - r.x) * 4 + (lane > 0 ? 8 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = lane;
      }
    }
    r.laneX = best;
    if (Math.abs(r.z) < 7 && Math.abs(r.x - player.x) < 5 && Math.random() < 0.45) r.laneX = player.x; // ram!
  }
  const targetVx = Math.max(-9, Math.min(9, (r.laneX - r.x) * 3));
  r.vx += (targetVx - r.vx) * Math.min(1, dt * 4);
}

function step(dt) {
  if (autopilot) autopilot(dt);
  elapsed += dt;

  // --- Player ---
  if (!player.wreck) {
    boosting = boostHeld && boost > 0.02;
    if (boosting) boost = Math.max(0, boost - BOOST_DRAIN * dt);
    const cruise = SPEED_START + Math.min(SPEED_RAMP_MAX, elapsed * SPEED_RAMP);
    const target = cruise + (boosting ? BOOST_SPEED : 0);
    player.speed += Math.max(-14 * dt, Math.min((boosting ? 22 : 9) * dt, target - player.speed));
    steerTarget = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, steerTarget));
    const targetVx = Math.max(-16, Math.min(16, (steerTarget - player.x) * 7));
    player.vx += (targetVx - player.vx) * Math.min(1, dt * 10);
    // Driving against traffic charges boost
    if (player.x < -0.4) {
      boost = Math.min(1, boost + 0.16 * dt);
      scoreRemainder += 60 * dt;
    }
  } else {
    player.speed *= 1 - 1.2 * dt;
  }
  topSpeed = Math.max(topSpeed, player.speed * 3.6);
  const dzPlayer = player.speed * dt;
  distance += dzPlayer;
  scoreRemainder += dzPlayer * 0.5;
  score += Math.floor(scoreRemainder);
  scoreRemainder -= Math.floor(scoreRemainder);
  ghost = Math.max(0, ghost - dt);

  // --- Everyone moves ---
  for (const c of cars) {
    if (c.role === 'rival' && !c.wreck) updateRival(c, dt);
    if (c.role === 'traffic' && !c.wreck) c.vx *= 1 - 3 * dt;
    if (c.wreck) {
      c.speed *= 1 - 0.45 * dt; // wrecks keep sliding, so they don't fly back past the camera
      c.vx *= 1 - 1.5 * dt;
    }
    const prevZ = c.z;
    if (c !== player) c.z += (player.speed - c.speed) * dt;
    c.x += c.vx * dt;

    // Guardrails
    if (Math.abs(c.x) > RAIL_X - c.hw) {
      const side = Math.sign(c.x);
      const hitSpeed = Math.abs(c.vx);
      c.x = side * (RAIL_X - c.hw);
      if (c.role === 'rival' && !c.wreck && hitSpeed > 5 && elapsed - c.lastHit < CREDIT_WINDOW) {
        takedown(c, 'GRINDED');
      } else if (hitSpeed > 2) {
        sparkBurst(c.x, 0.5, c.z, 6, 0.6);
        if (c === player) sfx.scrape(side);
      }
      c.vx = -c.vx * 0.25;
    }

    // Near misses: traffic slipping past the player's flank
    if (c.role === 'traffic' && !c.wreck && !player.wreck && prevZ < 0 && c.z >= 0 && !c.touched) {
      const gap = Math.abs(c.x - player.x) - c.hw - player.hw;
      if (gap > 0 && gap < 1.1) {
        nearMisses += 1;
        const oncoming = c.speed < 0;
        score += oncoming ? 150 : 100;
        boost = Math.min(1, boost + (oncoming ? 0.14 : 0.08));
        sfx.nearMiss(Math.sign(c.x - player.x));
        callout(oncoming ? 'ONCOMING NEAR MISS' : 'NEAR MISS');
      } else if (gap > 0 && gap < 3) {
        sfx.whoosh(Math.sign(c.x - player.x));
      }
    }
  }

  // --- Collisions ---
  const now = elapsed;
  for (const c of cars) {
    if (c === player || c.wreck || player.wreck || ghost > 0) continue;
    const hit = overlap(player, c);
    if (!hit) continue;
    c.touched = true;
    const side = Math.sign(hit.dx) || 1;
    if (hit.ox < hit.oz * 0.55) {
      // Side contact
      player.x -= side * hit.ox * 0.5;
      c.x += side * hit.ox * 0.5;
      const into = Math.max(0, player.vx * side);
      if (c.role === 'rival') {
        c.vx = side * (8 + into * 0.9 + (boosting ? 5 : 0));
        c.lastHit = now;
        c.hp -= into > 3 || boosting ? 1 : 0.4;
        player.vx = -side * 3;
        sfx.slam(Math.min(1.4, 0.6 + into / 10), side);
        sparkBurst(player.x + side * player.hw, 0.6, 0, 10, 0.8);
        shake = Math.max(shake, 0.25);
        if (c.hp <= 0) takedown(c, 'SLAM');
      } else {
        c.vx = side * 3;
        player.vx = -side * 4;
        sfx.scrape(side);
        sparkBurst(player.x + side * player.hw, 0.5, 0, 6, 0.5);
      }
    } else if (hit.dz < 0) {
      // Something ahead of us
      const closing = player.speed - c.speed;
      if (c.role === 'rival') {
        if (closing > 3 || boosting) {
          c.speed = player.speed + 12;
          takedown(c, 'SHUNT');
        } else {
          c.speed = player.speed + 3;
          sfx.slam(0.6);
        }
      } else if (c.speed < 0 || closing > 15) {
        startWreck(c, 20, 0);
        wreckPlayer(closing, c.speed < 0 ? 'head-on' : 'rear-end');
      } else {
        player.speed = c.speed - 2;
        player.z = 0;
        c.z = -(player.hl + c.hl + 0.1);
        sfx.slam(0.5);
      }
    } else {
      // Something behind us (a rival ramming)
      player.speed += 3;
      c.speed = player.speed - 4;
      c.z = player.hl + c.hl + 0.1;
      sfx.slam(0.7);
      shake = Math.max(shake, 0.3);
    }
  }

  // Rivals vs traffic (and each other): this is where most takedowns happen
  for (const r of cars) {
    if (r.role !== 'rival' || r.wreck) continue;
    for (const c of cars) {
      if (c === r || c === player || c.wreck) continue;
      const hit = overlap(r, c);
      if (!hit) continue;
      const credited = elapsed - r.lastHit < CREDIT_WINDOW;
      if (hit.ox < hit.oz * 0.55) {
        const side = Math.sign(hit.dx) || 1;
        r.x -= side * hit.ox * 0.6;
        c.x += side * hit.ox * 0.4;
        if (credited && Math.abs(r.vx) > 5) takedown(r, 'TRAFFIC CHECK');
        else r.vx = -side * 3;
      } else {
        const closing = Math.abs(r.speed - c.speed);
        if (c.speed < 0 || closing > 12) {
          startWreck(c, 14, 0);
          if (credited) takedown(r, c.speed < 0 ? 'HEAD-ON' : 'TRAFFIC CHECK');
          else startWreck(r, 24, 0);
        } else {
          r.speed = c.speed - 1;
        }
      }
    }
  }

  // --- Wreck physics: hop, tumble, bounce ---
  for (const c of cars) {
    if (!c.wreck) continue;
    const w = c.wreck;
    w.vy -= 26 * dt;
    w.y += w.vy * dt;
    if (w.y < 0) {
      w.y = 0;
      if (Math.abs(w.vy) > 2) {
        w.bounces += 1;
        sparkBurst(c.x, 0.3, c.z, 8, 0.7);
      }
      w.vy = -w.vy * 0.35;
      w.spin.mulScalar(0.65);
    }
    w.rot.add(w.spin.clone().mulScalar(dt));
  }

  // --- Spawning and cleanup ---
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = Math.max(0.28, 0.62 - elapsed * 0.003);
    spawnTraffic();
  }
  const wantRivals = elapsed > 60 ? 3 : 2;
  if (rivalCount() < wantRivals && !crashCam) spawnRival();
  // Wrecks are cleared once they drop behind us: otherwise they tumble back through the chase camera
  for (const c of [...cars]) if (c !== player && (c.z > 45 || c.z < SPAWN_Z - 60 || (c.wreck && c.z > 3.5 && !crashCam))) removeCar(c);

  // --- Respawn / game over ---
  if (respawnTimer > 0) {
    respawnTimer -= dt / Math.max(timeScale, 0.22);
    if (respawnTimer <= 0) {
      if (lives > 0) respawn();
      else gameOver();
    }
  }

  return dzPlayer;
}

// --- RENDER SYNC ---
function syncCar(c) {
  const w = c.wreck;
  c.root.setPosition(c.x, w ? w.y : 0, c.z);
  if (w) {
    c.visual.setLocalEulerAngles(w.rot.x, w.rot.y - (c.speed < 0 ? 180 : 0), w.rot.z);
  } else {
    // Yaw into the steer, roll slightly against it
    const dir = c.speed < 0 ? -1 : 1;
    c.yaw += (-c.vx * 2.2 * dir - c.yaw) * 0.2;
    c.visual.setLocalEulerAngles(0, c.yaw, c.vx * 0.5);
  }
}

// --- GAME FLOW ---
function clearCars() {
  for (const c of [...cars]) removeCar(c);
  player = null;
}

function startGame() {
  sfx.init();
  clearCars();
  player = addCar('player', 'sport', PLAYER_LOOK, LANES[2], 0, SPEED_START);
  steerTarget = LANES[2];
  elapsed = 0;
  lives = LIVES;
  takedowns = 0;
  streak = 0;
  score = 0;
  scoreRemainder = 0;
  boost = 0.35;
  boostHeld = false;
  nearMisses = 0;
  topSpeed = 0;
  distance = 0;
  ghost = 0;
  timeScale = 1;
  slowmoTimer = 0;
  crashCam = null;
  respawnTimer = 0;
  spawnTimer = 0;
  // A road already full of traffic, and two rivals right beside you
  for (let z = -60; z > SPAWN_Z; z -= 22) {
    const lane = pick(LANES);
    if (laneFree(lane, z, 20)) {
      const oncoming = lane < 0;
      addCar('traffic', 'sedan', { paint: pick(TRAFFIC_LOOKS.sedan), stripe: '#fff' }, lane, z, oncoming ? -rand(20, 28) : rand(18, 26));
    }
  }
  spawnRival(-8).x = LANES[3];
  spawnRival(6).x = LANES[1];
  renderLives();
  setScreen('play');
  state = 'countdown';
  countdown = 2.2;
  sfx.engine(true, 0.2);
}

async function gameOver() {
  state = 'over';
  sfx.engine(false);
  sfx.totaled();
  const isBest = takedowns > saved.bestTakedowns || (takedowns === saved.bestTakedowns && score > saved.bestScore);
  if (isBest) {
    saved.bestTakedowns = takedowns;
    saved.bestScore = Math.max(saved.bestScore, score);
  }
  ui.rTakedowns.textContent = String(takedowns);
  ui.rScore.textContent = fmt(score);
  ui.rTop.textContent = fmt(topSpeed);
  ui.rNear.textContent = String(nearMisses);
  ui.rKm.textContent = (distance / 1000).toFixed(1);
  ui.newBest.classList.toggle('show', isBest && takedowns > 0);
  renderMenu();
  loadBitmoji();
  setScreen('over');

  if (snapchatReady) {
    if (snapchat.isSupported('leaderboards')) {
      try {
        await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score });
      } catch (e) {
        console.warn('[WebLens] Leaderboard submit failed:', e);
      }
    }
    if (isBest && snapchat.isSupported('storage')) {
      try {
        await snapchat.storage.set('best', { ...saved });
      } catch {}
    }
  }
}

async function loadBitmoji() {
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'large' }); // expires in ~5 min: use now
    const img = new Image();
    img.onload = () => setPortraits(`url("${url}")`);
    img.src = url;
    ui.driverLine.textContent = 'Your Bitmoji is driving';
  } catch (e) {
    console.warn('[WebLens] No Bitmoji:', e?.message);
  }
}

async function loadSave() {
  await snapchatInit;
  if (!snapchatReady || !snapchat.isSupported('storage')) return;
  try {
    const { found, value } = await snapchat.storage.get('best');
    if (found && value) Object.assign(saved, value);
    renderMenu();
  } catch {}
}

// --- INPUT: drag anywhere to steer; hold the button to boost (two thumbs work together) ---
let steerId = null;
let lastX = 0;
container.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .screen:not(.hidden)')) return;
  if (state !== 'playing' && state !== 'countdown') return;
  sfx.init();
  steerId = e.pointerId;
  lastX = e.clientX;
});
container.addEventListener('pointermove', (e) => {
  if (e.pointerId !== steerId) return;
  const { width } = container.getBoundingClientRect();
  steerTarget += ((e.clientX - lastX) / width) * 16;
  lastX = e.clientX;
});
const endSteer = (e) => e.pointerId === steerId && (steerId = null);
container.addEventListener('pointerup', endSteer);
container.addEventListener('pointercancel', endSteer);

ui.boostBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  ui.boostBtn.setPointerCapture?.(e.pointerId);
  if (!boostHeld && boost > 0.05) sfx.boostStart();
  boostHeld = true;
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.boostBtn.addEventListener(type, () => (boostHeld = false));

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space' && !boostHeld && boost > 0.05) {
    sfx.boostStart();
    boostHeld = true;
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') boostHeld = false;
});

$('btn-start').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-share').addEventListener('click', async () => {
  const text = `I took down ${takedowns} rivals in Takedown Rush (score ${fmt(score)}). Think you can drive dirtier?`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Takedown Rush', text });
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
  showToast('Screenshot your result and send it');
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
const camPos = new Vec3(4, 1.6, -6);
const camLook = new Vec3();
const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
let fov = 52;
let cutToChase = false;

app.on('update', (realDt) => {
  realDt = Math.min(realDt, 1 / 20);

  // Slow motion eases back to full speed
  if (slowmoTimer > 0) {
    slowmoTimer -= realDt;
    if (slowmoTimer <= 0) {
      crashCam = null;
      cutToChase = true; // hard cut back, rather than gliding through the wreck
    }
  }
  timeScale = smooth(timeScale, slowmoTimer > 0 ? 0.22 : 1, slowmoTimer > 0 ? 30 : 4, realDt);
  const dt = realDt * timeScale;

  let dz = 0;
  if (state === 'countdown') {
    const before = countdown;
    countdown -= realDt;
    for (const mark of [2, 1.4, 0.8]) {
      if (before > mark && countdown <= mark) {
        callout(String(Math.round((mark - 0.2) / 0.6)), 'big');
        sfx.countdown(false);
      }
    }
    if (countdown <= 0.2) {
      state = 'playing';
      callout('GO!', 'big');
      sfx.countdown(true);
    }
    player.speed = SPEED_START * 0.5;
    dz = player.speed * dt;
    for (const c of cars) if (c !== player) c.z += (player.speed - c.speed) * dt;
  } else if (state === 'playing') {
    dz = step(dt);
  } else if (state === 'menu') {
    menuTime += realDt;
    dz = 0;
  } else if (state === 'over') {
    dz = (player?.speed ?? 0) * dt;
    if (player) player.speed *= 1 - 1.5 * dt;
  }

  for (const c of cars) syncCar(c);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    s.vel.y -= 20 * dt;
    const p = s.e.getPosition();
    s.e.setPosition(p.x + s.vel.x * dt, Math.max(0.02, p.y + s.vel.y * dt), p.z + s.vel.z * dt + dz);
    if (s.age > s.life) {
      s.e.destroy();
      sparks.splice(i, 1);
    }
  }
  world.update(dz, camera.getPosition());

  // --- Camera ---
  shake = Math.max(0, shake - realDt * 1.5);
  const jitter = () => (Math.random() - 0.5) * shake * 0.5;
  if (state === 'menu') {
    // Hero orbit around the car
    const a = 0.6 + Math.sin(menuTime * 0.25) * 0.5;
    camPos.set(LANES[2] + Math.sin(a) * 6.5, 1.5, -Math.cos(a) * 6.5);
    camLook.set(LANES[2], 0.7, 0);
  } else if (crashCam) {
    // Crash cam: low, beside the action, slowly tracking
    const c = crashCam.car;
    crashCam.t += realDt;
    const tx = c.x + crashCam.side * (6.5 - crashCam.t * 1.2);
    camPos.set(smooth(camPos.x, tx, 6, realDt), smooth(camPos.y, 1.8, 6, realDt), smooth(camPos.z, c.z + 7, 6, realDt));
    camLook.set(c.x, (c.wreck?.y ?? 0) + 0.8, c.z);
  } else if (player) {
    const tx = player.x * 0.72;
    if (cutToChase) camPos.set(tx, 3.3, 8.4);
    cutToChase = false;
    camPos.set(smooth(camPos.x, tx, 8, realDt), smooth(camPos.y, 3.3, 6, realDt), smooth(camPos.z, 8.4, 6, realDt));
    camLook.set(player.x * 0.85, 0.6, -16);
  }
  camera.setPosition(camPos.x + jitter(), camPos.y + jitter(), camPos.z);
  camera.lookAt(camLook);
  if (cameraOverride) cameraOverride(camera);
  const speedFov = player && state !== 'menu' ? Math.max(0, (player.speed - SPEED_START) * 0.35) : 0;
  fov = smooth(fov, 52 + speedFov + (boosting && state === 'playing' ? 9 : 0), 4, realDt);
  if (!cameraOverride) camera.camera.fov = fov;

  // --- HUD ---
  if (player && (state === 'playing' || state === 'countdown')) {
    ui.takedowns.textContent = String(takedowns);
    ui.score.textContent = fmt(score);
    ui.speed.textContent = fmt(player.speed * 3.6);
    ui.boostFill.style.width = `${(boost * 100).toFixed(1)}%`;
    ui.boostBtn.classList.toggle('ready', boost > 0.05);
    ui.boostBtn.classList.toggle('active', boosting);
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steerTarget -= 10 * realDt;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steerTarget += 10 * realDt;
    sfx.engine(true, Math.min(1, (player.speed - 20) / 60), boosting);
    // Ghost flicker after a respawn
    player.visual.enabled = ghost <= 0 || Math.floor(ghost * 12) % 2 === 0;
  }
});

// --- BOOT: menu shows the car parked on the road at dusk ---
function showMenuCar() {
  clearCars();
  player = addCar('player', 'sport', PLAYER_LOOK, LANES[2], 0, 0);
  state = 'menu';
}
showMenuCar();
renderMenu();
renderLives();
loadSave();
loadBitmoji();
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
      camera,
      cars,
      addCar,
      removeCar,
      clearCars,
      startGame,
      gameOver,
      player: () => player,
      setState: (s) => (state = s),
      setSteer: (x) => (steerTarget = x),
      setBoostHeld: (b) => (boostHeld = b),
      setBoost: (b) => (boost = b),
      setScore: (s) => (score = s),
      setTakedowns: (n) => (takedowns = n),
      setGodMode: (fn) => (godMode = fn),
      setCameraOverride: (fn) => (cameraOverride = fn),
      setAutopilot: (fn) => (autopilot = fn),
      stopSpawning: () => (spawnTimer = 1e9),
      setScreen,
      LANES,
      PLAYER_LOOK,
      RIVAL_LOOKS,
      TRAFFIC_LOOKS,
    })
  );
}

app.start();
