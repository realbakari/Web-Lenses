import {
  Application,
  Color,
  Entity,
  FILLMODE_NONE,
  MeshInstance,
  PROJECTION_ORTHOGRAPHIC,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';
import '@fontsource-variable/unbounded/wght.css';
import { sfx } from './audio.js';
import { PALETTE, PALETTE_EMOJI, createBeveledBox, createBlockMaterials, createFlatMaterial } from './blocks.js';
import { COMBO_GRACE, Game, SIZE, canPlace, fitsAnywhere, hashString, linesCompletedBy, mulberry32 } from './logic.js';

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

// --- LAYOUT (world units; one board cell = 1) ---
const BLOCK_HALF = [0.46, 0.22, 0.46];
const BLOCK_Y = BLOCK_HALF[1];
const TRAY_Z = 6.9;
const TRAY_SLOTS = [-3, 0, 3];
const TRAY_SCALE = 0.52;
const DRAG_LIFT = new Vec3(0, 0.7, -2.6); // the dragged piece floats above the finger, not under it
const TILT = (20 * Math.PI) / 180; // camera tilt from straight down, so block fronts show

const DAILY_EPOCH = new Date(2026, 9, 6); // Daily #1
const PRAISE = ['', 'Nice!', 'Great!', 'Amazing!', 'Unbelievable!'];

// --- ENGINE ---
const canvas = document.getElementById('app');
const container = document.getElementById('game-container');
const app = new Application(canvas, { graphicsDeviceOptions: { alpha: true, antialias: true } });
app.setCanvasFillMode(FILLMODE_NONE);
app.setCanvasResolution(RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const device = app.graphicsDevice;

container.style.background = 'radial-gradient(120% 70% at 50% 40%, #1b2558 0%, #0a0f26 62%)';

const camera = new Entity('camera');
camera.addComponent('camera', {
  projection: PROJECTION_ORTHOGRAPHIC,
  clearColor: new Color(0, 0, 0, 0),
  nearClip: 0.1,
  farClip: 100,
});
app.root.addChild(camera);
const camTarget = new Vec3();
let shake = 0;
let viewLocked = false; // dev capture only: keep a hand-framed camera through resizes

// Fit the board to the width, with its top edge ~22% down the screen (room for the HUD)
function fitView() {
  const { width, height } = container.getBoundingClientRect();
  app.resizeCanvas(Math.round(width), Math.round(height));
  if (viewLocked) return;
  const aspect = width / height;
  const ortho = Math.max(9.2 / (2 * aspect), 8.4);
  camera.camera.orthoHeight = ortho;
  camTarget.set(0, 0, -4.3 + (0.56 * ortho) / Math.cos(TILT));
}
new ResizeObserver(fitView).observe(container);
fitView();

const sun = new Entity('sun');
sun.addComponent('light', { type: 'directional', color: new Color(1, 0.97, 0.92), intensity: 1.15 });
sun.lookAt(new Vec3(0.45, -1, -0.4));
sun.rotateLocal(90, 0, 0);
app.root.addChild(sun);
const fill = new Entity('fill');
fill.addComponent('light', { type: 'directional', color: new Color(0.55, 0.65, 1), intensity: 0.35 });
fill.lookAt(new Vec3(-0.5, -0.6, 0.6));
fill.rotateLocal(90, 0, 0);
app.root.addChild(fill);
app.scene.ambientLight = new Color(0.3, 0.32, 0.42);

// --- MESHES & MATERIALS ---
const blockMesh = createBeveledBox(device, BLOCK_HALF, 0.09);
const shardMesh = createBeveledBox(device, [0.12, 0.12, 0.12], 0.035);
const tileMesh = createBeveledBox(device, [0.47, 0.03, 0.47], 0.03);
const plateMesh = createBeveledBox(device, [4.32, 0.3, 4.32], 0.22);

const blockMats = createBlockMaterials();
const deadMat = createFlatMaterial('#39406e', { emissive: 0.1 });
// Ghosts are flat, darker tiles in the piece's colour: its footprint, waiting to be filled.
// (Translucency muddied yellows and oranges into olive on the navy board.)
const ghostMats = PALETTE.map((hex) => createFlatMaterial(hex, { brightness: 0.55, emissive: 0.08 }));

function meshEntity(name, mesh, material, parent = app.root) {
  const e = new Entity(name);
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
  parent.addChild(e);
  return e;
}
const setMat = (e, m) => (e.render.meshInstances[0].material = m);

const cellX = (c) => c - (SIZE - 1) / 2;
const cellZ = (r) => r - (SIZE - 1) / 2;

// Board: a bevelled plate with a recessed tile per cell
meshEntity('plate', plateMesh, createFlatMaterial('#161e48')).setPosition(0, -0.3, 0);
const tileMat = createFlatMaterial('#202a60');
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) meshEntity('tile', tileMesh, tileMat).setPosition(cellX(c), -0.02, cellZ(r));
}

// --- TWEENS ---
const tweens = [];
function tween(duration, onUpdate, { delay = 0, onDone } = {}) {
  tweens.push({ elapsed: -delay, duration, onUpdate, onDone });
}
const easeOutCubic = (p) => 1 - (1 - p) ** 3;
const easeOutBack = (p) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;
const wait = (seconds) => new Promise((resolve) => tween(seconds, () => {}, { onDone: resolve }));

// --- STATE ---
let game = null;
let mode = { daily: true, number: 1, key: '' };
let busy = false; // true while a move resolves; input waits
let autopilot = null; // dev capture only
/** cells[r][c] = { entity, color } or null */
let cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
/** tray[slot] = { root, blocks, piece, home } or null */
let tray = [null, null, null];
let drag = null; // { slot, pointerId, target: {row, col} | null, previewed: [] }
const ghosts = [];
const shards = [];
let shownScore = 0;

const saved = { bestEndless: 0, dailyKey: '', dailyBest: 0 };

// --- DOM ---
const $ = (id) => document.getElementById(id);
const ui = {
  hudMode: $('hud-mode'),
  hudBest: $('hud-best'),
  hudScore: $('hud-score'),
  combo: $('combo'),
  comboLabel: $('combo-label'),
  comboPips: $('combo-pips'),
  praise: $('praise'),
  praiseWord: $('praise-word'),
  praisePoints: $('praise-points'),
  menu: $('menu'),
  over: $('over'),
  dailyName: $('daily-name'),
  dailySide: $('daily-side'),
  endlessSide: $('endless-side'),
  avatar: $('avatar'),
  overMode: $('over-mode'),
  overDate: $('over-date'),
  overScore: $('over-score'),
  newBest: $('new-best'),
  miniBoard: $('mini-board'),
  overLines: $('over-lines'),
  overCombo: $('over-combo'),
  overPieces: $('over-pieces'),
  overNote: $('over-note'),
  toast: $('toast'),
};
ui.miniBoard.innerHTML = '<i></i>'.repeat(SIZE * SIZE);
const fmt = (n) => n.toLocaleString('en-US');

function today() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const key = `${midnight.getFullYear()}-${String(midnight.getMonth() + 1).padStart(2, '0')}-${String(midnight.getDate()).padStart(2, '0')}`;
  const number = Math.round((midnight - DAILY_EPOCH) / 86400000) + 1;
  return { key, number, label: midnight.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
}

function renderMenu() {
  const t = today();
  ui.dailyName.textContent = `Daily #${t.number}`;
  const playedToday = saved.dailyKey === t.key;
  ui.dailySide.innerHTML = playedToday ? `${fmt(saved.dailyBest)}<small>today</small>` : '<small>New</small>';
  ui.endlessSide.innerHTML = saved.bestEndless ? `${fmt(saved.bestEndless)}<small>best</small>` : '';
}

let toastTimer = 0;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function renderCombo() {
  const show = game && game.streak >= 2;
  ui.combo.classList.toggle('show', !!show);
  if (!show) return;
  ui.comboLabel.textContent = `Combo ×${game.streak}`;
  const left = COMBO_GRACE - game.sinceClear;
  ui.comboPips.innerHTML = Array.from({ length: COMBO_GRACE }, (_, i) => `<i class="${i < left ? '' : 'off'}"></i>`).join('');
}

function showPraise(word, points) {
  ui.praiseWord.textContent = word;
  ui.praiseWord.style.display = word ? '' : 'none';
  ui.praisePoints.textContent = `+${fmt(points)}`;
  ui.praise.classList.remove('show');
  void ui.praise.offsetWidth;
  ui.praise.classList.add('show');
}

// --- BOARD BLOCKS ---
function addBoardBlock(r, c, color, { drop = true } = {}) {
  const e = meshEntity('block', blockMesh, blockMats[color]);
  e.setPosition(cellX(c), BLOCK_Y, cellZ(r));
  cells[r][c] = { entity: e, color };
  if (drop) {
    e.setLocalScale(1.12, 1.12, 1.12);
    tween(0.18, (p) => {
      const s = 1.12 - 0.12 * easeOutCubic(p);
      e.setLocalScale(s, s, s);
    });
  }
}

function clearBoardVisuals() {
  for (const row of cells) for (const cell of row) cell?.entity.destroy();
  cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function spawnShards(x, z, color) {
  for (let i = 0; i < 4; i++) {
    const e = meshEntity('shard', shardMesh, blockMats[color]);
    e.setPosition(x + (Math.random() - 0.5) * 0.5, BLOCK_Y + 0.2, z + (Math.random() - 0.5) * 0.5);
    const a = Math.random() * Math.PI * 2;
    const speed = 2.5 + Math.random() * 3;
    shards.push({
      e,
      vel: new Vec3(Math.cos(a) * speed, 5 + Math.random() * 4, Math.sin(a) * speed - 1.5),
      spin: new Vec3((Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900, 0),
      life: 0.75 + Math.random() * 0.3,
      age: 0,
    });
  }
}

/** Blocks pop in a wave spreading from where the piece landed. */
function animateClear(cleared, origin) {
  let last = 0;
  for (const { r, c, color } of cleared) {
    const cell = cells[r][c];
    cells[r][c] = null;
    if (!cell) continue;
    const delay = Math.hypot(r - origin[0], c - origin[1]) * 0.035;
    last = Math.max(last, delay);
    const e = cell.entity;
    tween(
      0.22,
      (p) => {
        const s = p < 0.35 ? 1 + 0.25 * (p / 0.35) : 1.25 * (1 - easeOutCubic((p - 0.35) / 0.65));
        e.setLocalScale(s, s, s);
        e.setPosition(e.getPosition().x, BLOCK_Y + p * 0.5, e.getPosition().z);
      },
      {
        delay,
        onDone: () => {
          spawnShards(cellX(c), cellZ(r), color);
          e.destroy();
        },
      }
    );
  }
  return last + 0.22;
}

// --- TRAY ---
function buildPieceEntity(piece) {
  const root = new Entity('piece');
  app.root.addChild(root);
  const blocks = piece.cells.map(([r, c]) => {
    const b = meshEntity('piece-block', blockMesh, blockMats[piece.color], root);
    b.setLocalPosition(c - (piece.cols - 1) / 2, BLOCK_Y, r - (piece.rows - 1) / 2);
    return b;
  });
  return { root, blocks };
}

function dealTrayVisuals(animate) {
  tray.forEach((t) => t?.root.destroy());
  tray = game.tray.map((piece, slot) => {
    if (!piece) return null;
    const { root, blocks } = buildPieceEntity(piece);
    const home = new Vec3(TRAY_SLOTS[slot], 0, TRAY_Z);
    root.setLocalScale(TRAY_SCALE, TRAY_SCALE, TRAY_SCALE);
    if (animate) {
      root.setPosition(home.x + 9, 0, home.z);
      tween(0.32, (p) => root.setPosition(home.x + 9 * (1 - easeOutCubic(p)), 0, home.z), { delay: slot * 0.06 });
    } else {
      root.setPosition(home);
    }
    return { root, blocks, piece, home };
  });
  refreshTrayFit();
}

// Pieces that fit nowhere go grey, so the player can see trouble coming
function refreshTrayFit() {
  for (const t of tray) {
    if (!t) continue;
    const mat = fitsAnywhere(game.board, t.piece) ? blockMats[t.piece.color] : deadMat;
    t.blocks.forEach((b) => setMat(b, mat));
  }
}

// --- DRAG & DROP ---
const rayFrom = new Vec3();
const rayTo = new Vec3();
/** Screen point (CSS px, relative to the canvas) → point on the y = 0 plane. */
function screenToBoard(x, y) {
  camera.camera.screenToWorld(x, y, camera.camera.nearClip, rayFrom);
  camera.camera.screenToWorld(x, y, camera.camera.farClip, rayTo);
  const t = rayFrom.y / (rayFrom.y - rayTo.y);
  return new Vec3(rayFrom.x + (rayTo.x - rayFrom.x) * t, 0, rayFrom.z + (rayTo.z - rayFrom.z) * t);
}

function slotAt(point) {
  return tray.findIndex((t, slot) => t && Math.abs(point.x - TRAY_SLOTS[slot]) < 1.5 && Math.abs(point.z - TRAY_Z) < 1.9);
}

function beginDrag(slot, pointerId = null) {
  const t = tray[slot];
  if (!t || busy || game.over) return false;
  drag = { slot, pointerId, target: null, previewed: [] };
  sfx.pickup();
  tween(0.12, (p) => {
    const s = TRAY_SCALE + (1 - TRAY_SCALE) * easeOutCubic(p);
    t.root.setLocalScale(s, s, s);
  });
  return true;
}

function clearPreview() {
  ghosts.forEach((g) => (g.enabled = false));
  for (const { r, c } of drag?.previewed ?? []) {
    const cell = cells[r][c];
    if (cell) {
      setMat(cell.entity, blockMats[cell.color]);
    }
  }
  if (drag) drag.previewed = [];
}

/** Move the dragged piece so the finger sits at (x, z) on the board plane. */
function moveDrag(fingerX, fingerZ) {
  if (!drag) return;
  const t = tray[drag.slot];
  const piece = t.piece;
  const x = fingerX + DRAG_LIFT.x;
  const z = fingerZ + DRAG_LIFT.z;
  t.root.setPosition(x, DRAG_LIFT.y, z);

  // The piece's top-left cell decides where it lands
  const col = Math.round(x - (piece.cols - 1) / 2 + (SIZE - 1) / 2);
  const row = Math.round(z - (piece.rows - 1) / 2 + (SIZE - 1) / 2);
  const valid = canPlace(game.board, piece, row, col);
  if (drag.target && valid && drag.target.row === row && drag.target.col === col) return;

  clearPreview();
  drag.target = valid ? { row, col } : null;
  if (!valid) return;

  piece.cells.forEach(([r, c], i) => {
    let g = ghosts[i];
    if (!g) g = ghosts[i] = meshEntity('ghost', blockMesh, ghostMats[0]);
    setMat(g, ghostMats[piece.color]);
    g.enabled = true;
    g.setLocalScale(0.94, 0.3, 0.94);
    g.setPosition(cellX(col + c), BLOCK_Y * 0.3, cellZ(row + r));
  });

  // Lines this drop would complete light up in the piece's colour
  const { rows, cols } = linesCompletedBy(game.board, piece, row, col);
  for (const rr of rows) for (let c = 0; c < SIZE; c++) drag.previewed.push({ r: rr, c });
  for (const cc of cols) for (let r = 0; r < SIZE; r++) drag.previewed.push({ r, c: cc });
  for (const { r, c } of drag.previewed) {
    if (cells[r][c]) setMat(cells[r][c].entity, blockMats[piece.color]);
  }
}

async function endDrag() {
  if (!drag) return;
  const { slot, target } = drag;
  const t = tray[slot];
  clearPreview();
  drag = null;

  if (!target) {
    // Snap back to the tray
    const from = t.root.getPosition().clone();
    const fromScale = t.root.getLocalScale().x;
    if (from.z < TRAY_Z - 2) sfx.invalid();
    tween(0.18, (p) => {
      const e = easeOutCubic(p);
      t.root.setPosition(from.x + (t.home.x - from.x) * e, from.y * (1 - e), from.z + (t.home.z - from.z) * e);
      const s = fromScale + (TRAY_SCALE - fromScale) * e;
      t.root.setLocalScale(s, s, s);
    });
    return;
  }

  busy = true;
  const result = game.place(slot, target.row, target.col);
  t.root.destroy();
  tray[slot] = null;
  for (const [r, c] of result.placedCells) addBoardBlock(r, c, result.piece.color);
  sfx.place(result.placedCells.length);

  if (result.lines > 0) {
    const origin = result.placedCells.reduce((a, [r, c]) => [a[0] + r / result.placedCells.length, a[1] + c / result.placedCells.length], [0, 0]);
    const duration = animateClear(result.cleared, origin);
    sfx.clear(result.lines, result.streak);
    shake = 0.05 + 0.06 * result.lines;
    showPraise(result.allClear ? 'All clear!' : PRAISE[Math.min(result.lines, PRAISE.length - 1)], result.points);
    if (result.allClear) sfx.allClear();
    try {
      navigator.vibrate?.(result.lines >= 2 ? [18, 30, 18] : 14);
    } catch {}
    await wait(Math.min(duration, 0.35));
  }
  renderCombo();

  if (result.dealt) {
    dealTrayVisuals(true);
    sfx.deal();
  } else {
    refreshTrayFit();
  }
  busy = false;

  if (game.over) gameOver();
}

// --- POINTER INPUT ---
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

container.addEventListener('pointerdown', (e) => {
  if (!game || game.over || drag || e.target.closest('button, .screen:not(.hidden)')) return;
  sfx.init();
  const point = screenToBoard(...canvasPoint(e));
  const slot = slotAt(point);
  if (slot < 0 || !beginDrag(slot, e.pointerId)) return;
  container.setPointerCapture?.(e.pointerId);
  moveDrag(point.x, point.z);
});

container.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const point = screenToBoard(...canvasPoint(e));
  moveDrag(point.x, point.z);
});

const release = (e) => {
  if (drag && e.pointerId === drag.pointerId) endDrag();
};
container.addEventListener('pointerup', release);
container.addEventListener('pointercancel', release);

// --- GAME FLOW ---
function setScreen(name) {
  container.classList.toggle('is-menu', name === 'menu');
  ui.menu.classList.toggle('hidden', name !== 'menu');
  ui.over.classList.toggle('hidden', name !== 'over');
}

function startGame(daily) {
  sfx.init();
  sfx.start();
  const t = today();
  mode = { daily, number: t.number, key: t.key, label: t.label };
  const seed = daily ? hashString(`gridlock:${t.key}`) : Math.floor(Math.random() * 2 ** 32);
  game = new Game({ seed, daily });
  clearBoardVisuals();
  dealTrayVisuals(true);
  shownScore = 0;
  ui.hudScore.textContent = '0';
  ui.hudMode.textContent = daily ? `Daily #${t.number}` : 'Endless';
  ui.hudBest.textContent = fmt(daily ? (saved.dailyKey === t.key ? saved.dailyBest : 0) : saved.bestEndless);
  renderCombo();
  setScreen('play');
}

function renderMiniBoard() {
  const tiles = ui.miniBoard.children;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = game.board[r][c];
      tiles[r * SIZE + c].style.background = v >= 0 ? PALETTE[v] : '';
    }
  }
}

async function loadAvatar() {
  ui.avatar.hidden = true;
  await snapchatInit;
  if (!snapchatReady || snapchat.isStub || !snapchat.isSupported('bitmoji')) return;
  try {
    const { hasAvatar } = await snapchat.bitmoji.getAvatarInfo();
    if (!hasAvatar) return;
    // URLs expire after ~5 minutes, so fetch a fresh one for every result card
    const { url } = await snapchat.bitmoji.get2DAvatar({ size: 'large' });
    ui.avatar.onload = () => (ui.avatar.hidden = false);
    ui.avatar.src = url;
  } catch (e) {
    console.warn('[WebLens] No Bitmoji for the result card:', e?.message);
  }
}

async function gameOver() {
  busy = true;
  sfx.gameOver();
  loadAvatar();

  // Board greys out row by row
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = cells[r][c];
      if (cell) tween(0.01, () => setMat(cell.entity, deadMat), { delay: 0.25 + r * 0.06 });
    }
  }
  tray.forEach((t) => t && t.blocks.forEach((b) => setMat(b, deadMat)));

  const score = game.score;
  let isBest = false;
  if (mode.daily) {
    if (saved.dailyKey !== mode.key) {
      saved.dailyKey = mode.key;
      saved.dailyBest = 0;
    }
    isBest = score > saved.dailyBest;
    if (isBest) saved.dailyBest = score;
  } else {
    isBest = score > saved.bestEndless;
    if (isBest) saved.bestEndless = score;
  }

  ui.overMode.textContent = mode.daily ? `Gridlock Daily #${mode.number}` : 'Gridlock Endless';
  ui.overDate.textContent = mode.daily ? mode.label : `Best ${fmt(saved.bestEndless)}`;
  ui.overScore.textContent = fmt(score);
  ui.newBest.textContent = mode.daily ? 'Best today' : 'New best';
  ui.newBest.classList.toggle('show', isBest && score > 0);
  ui.overLines.textContent = fmt(game.linesCleared);
  ui.overCombo.textContent = game.bestStreak > 1 ? `×${game.bestStreak}` : '–';
  ui.overPieces.textContent = fmt(game.placed);
  ui.overNote.textContent = mode.daily
    ? `Everyone gets the same pieces today. Daily #${mode.number + 1} unlocks at midnight.`
    : 'No moves left. The board is locked.';
  renderMiniBoard();
  renderMenu();

  await wait(1.1);
  setScreen('over');
  busy = false;

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
        await snapchat.storage.set('save', { ...saved });
      } catch {}
    }
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

function shareText() {
  const grid = game.board.map((row) => row.map((v) => (v >= 0 ? PALETTE_EMOJI[v] : '⬛')).join('')).join('\n');
  const head = mode.daily ? `Gridlock Daily #${mode.number}` : 'Gridlock Endless';
  return `${head}: ${fmt(game.score)}\n${grid}\nCan you beat it?`;
}

$('btn-daily').addEventListener('click', () => startGame(true));
$('btn-endless').addEventListener('click', () => startGame(false));
$('btn-again').addEventListener('click', () => startGame(mode.daily));
$('btn-menu').addEventListener('click', () => {
  showAttractBoard();
  setScreen('menu');
});
$('btn-share').addEventListener('click', async () => {
  const text = shareText();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Gridlock', text });
      return;
    } catch {}
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied');
      return;
    } catch {}
  }
  showToast('Screenshot your card and send it');
});

// Menu backdrop: a half-built board in the day's colours
function showAttractBoard() {
  clearBoardVisuals();
  tray.forEach((t) => t?.root.destroy());
  tray = [null, null, null];
  const rng = mulberry32(hashString(`attract:${today().key}`));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (rng() < 0.55 - r * 0.04) addBoardBlock(r, c, Math.floor(rng() * PALETTE.length), { drop: false });
    }
  }
}

// --- FRAME LOOP ---
app.on('update', (dt) => {
  if (autopilot) autopilot(dt);

  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    t.elapsed += dt;
    if (t.elapsed < 0) continue;
    const p = Math.min(1, t.elapsed / t.duration);
    t.onUpdate(p);
    if (p >= 1) {
      tweens.splice(i, 1);
      t.onDone?.();
    }
  }

  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.age += dt;
    s.vel.y -= 22 * dt;
    const p = s.e.getPosition();
    s.e.setPosition(p.x + s.vel.x * dt, p.y + s.vel.y * dt, p.z + s.vel.z * dt);
    s.e.rotate(s.spin.x * dt, s.spin.y * dt, 0);
    const k = Math.max(0, 1 - s.age / s.life);
    s.e.setLocalScale(k, k, k);
    if (s.age >= s.life) {
      s.e.destroy();
      shards.splice(i, 1);
    }
  }

  // Score counts up instead of jumping
  if (game && shownScore !== game.score) {
    shownScore = Math.min(game.score, shownScore + Math.max(1, Math.ceil((game.score - shownScore) * Math.min(1, dt * 10))));
    ui.hudScore.textContent = fmt(shownScore);
    if (!mode.daily || saved.dailyKey === mode.key) {
      const best = mode.daily ? saved.dailyBest : saved.bestEndless;
      if (shownScore > best) ui.hudBest.textContent = fmt(shownScore);
    }
  }

  // Camera, with a little shake on big clears
  shake = Math.max(0, shake - dt * 0.6);
  const jx = (Math.random() - 0.5) * shake;
  const jz = (Math.random() - 0.5) * shake;
  camera.setPosition(camTarget.x + jx, camTarget.y + 20 * Math.cos(TILT), camTarget.z + jz + 20 * Math.sin(TILT));
  camera.lookAt(camTarget.x + jx, camTarget.y, camTarget.z + jz);
});

renderMenu();
showAttractBoard();
loadSave();

// Dev-only preview video / icon hooks (npm run record-preview, npm run render-icon).
// Stripped from production builds. See src/capture.js for the contract.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) =>
    install({
      app,
      sfx,
      camera,
      camTarget,
      game: () => game,
      tray: () => tray,
      cells: () => cells,
      busy: () => busy || !!drag,
      startGame,
      gameOver,
      beginDrag,
      moveDrag,
      endDrag,
      addBoardBlock,
      dealTrayVisuals,
      clearBoardVisuals,
      setScreen,
      setAutopilot: (fn) => (autopilot = fn),
      lockView: () => (viewLocked = true),
      layout: { TRAY_SLOTS, TRAY_Z, DRAG_LIFT, cellX, cellZ },
    })
  );
}

app.start();
