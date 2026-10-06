// Pure game rules: no rendering, no DOM. Board cells hold a colour index (0..COLORS-1) or -1.

export const SIZE = 8;
export const COLORS = 8;
export const TRAY_SIZE = 3;
export const COMBO_GRACE = 3; // placements without a clear before the combo streak breaks

// --- RANDOM ---
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- PIECES ---
// Base shapes as rows of '#'. Every distinct rotation/mirror becomes its own piece, with the
// shape's weight split across them so variety doesn't skew the odds.
const SHAPES = [
  { rows: ['#'], weight: 3 },
  { rows: ['##'], weight: 5 },
  { rows: ['###'], weight: 6 },
  { rows: ['####'], weight: 6 },
  { rows: ['#####'], weight: 4 },
  { rows: ['##', '##'], weight: 6 },
  { rows: ['###', '###', '###'], weight: 2 },
  { rows: ['##', '##', '##'], weight: 3 },
  { rows: ['#.', '##'], weight: 6 },
  { rows: ['#.', '#.', '##'], weight: 7 },
  { rows: ['###', '.#.'], weight: 5 },
  { rows: ['##.', '.##'], weight: 4 },
  { rows: ['#..', '#..', '###'], weight: 4 },
];

function normalize(cells) {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function variants(cells) {
  const seen = new Map();
  let cur = cells;
  for (let mirror = 0; mirror < 2; mirror++) {
    for (let rot = 0; rot < 4; rot++) {
      const norm = normalize(cur);
      seen.set(JSON.stringify(norm), norm);
      cur = cur.map(([r, c]) => [c, -r]); // rotate 90°
    }
    cur = cells.map(([r, c]) => [r, -c]); // mirror
  }
  return [...seen.values()];
}

export const PIECES = SHAPES.flatMap(({ rows, weight }) => {
  const base = rows.flatMap((row, r) => [...row].flatMap((ch, c) => (ch === '#' ? [[r, c]] : [])));
  const all = variants(base);
  return all.map((cells) => ({
    cells,
    weight: weight / all.length,
    rows: Math.max(...cells.map(([r]) => r)) + 1,
    cols: Math.max(...cells.map(([, c]) => c)) + 1,
  }));
});
const TOTAL_WEIGHT = PIECES.reduce((sum, p) => sum + p.weight, 0);

function randomPiece(rng) {
  let roll = rng() * TOTAL_WEIGHT;
  for (const piece of PIECES) {
    roll -= piece.weight;
    if (roll <= 0) return { ...piece };
  }
  return { ...PIECES[0] };
}

// --- BOARD ---
export const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));

export function canPlace(board, piece, row, col) {
  return piece.cells.every(([r, c]) => {
    const rr = row + r;
    const cc = col + c;
    return rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === -1;
  });
}

export function fitsAnywhere(board, piece) {
  for (let r = 0; r <= SIZE - piece.rows; r++) {
    for (let c = 0; c <= SIZE - piece.cols; c++) {
      if (canPlace(board, piece, r, c)) return true;
    }
  }
  return false;
}

/** Rows and columns that would be full if piece were placed at (row, col). */
export function linesCompletedBy(board, piece, row, col) {
  const filled = new Set(piece.cells.map(([r, c]) => (row + r) * SIZE + (col + c)));
  const isFull = (r, c) => board[r][c] !== -1 || filled.has(r * SIZE + c);
  const rows = [];
  const cols = [];
  for (let i = 0; i < SIZE; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < SIZE; j++) {
      if (!isFull(i, j)) rowFull = false;
      if (!isFull(j, i)) colFull = false;
    }
    if (rowFull) rows.push(i);
    if (colFull) cols.push(i);
  }
  return { rows, cols };
}

export function scoreForClear(lines, streak) {
  if (lines === 0) return 0;
  // 1 line 80, 2 lines 240, 3 lines 480, 4 lines 800… then × the combo streak
  return 40 * lines * (lines + 1) * Math.max(1, streak);
}

export const ALL_CLEAR_BONUS = 500;

// --- GAME ---
export class Game {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {boolean} opts.daily  Daily deals are a pure seeded sequence, identical for everyone.
   *   Endless deals reroll (a little) so a fresh hand usually has a move.
   */
  constructor({ seed, daily }) {
    this.rng = mulberry32(seed);
    this.daily = daily;
    this.board = emptyBoard();
    this.tray = [];
    this.score = 0;
    this.streak = 0;
    this.sinceClear = 0;
    this.bestStreak = 0;
    this.linesCleared = 0;
    this.placed = 0;
    this.over = false;
    this.deal();
  }

  deal() {
    let hand;
    for (let attempt = 0; attempt < (this.daily ? 1 : 12); attempt++) {
      hand = Array.from({ length: TRAY_SIZE }, () => randomPiece(this.rng));
      // Three different colours per hand: easier to tell apart, and the board stays colourful
      const palette = [...Array(COLORS).keys()];
      for (const piece of hand) piece.color = palette.splice(Math.floor(this.rng() * palette.length), 1)[0];
      if (hand.some((p) => fitsAnywhere(this.board, p))) break;
    }
    this.tray = hand;
  }

  hasMove() {
    return this.tray.some((p) => p && fitsAnywhere(this.board, p));
  }

  /**
   * Places tray[slot] at (row, col). Returns what happened so the renderer can animate it, or
   * null if the move is illegal.
   */
  place(slot, row, col) {
    const piece = this.tray[slot];
    if (this.over || !piece || !canPlace(this.board, piece, row, col)) return null;

    const placedCells = piece.cells.map(([r, c]) => [row + r, col + c]);
    for (const [r, c] of placedCells) this.board[r][c] = piece.color;
    this.tray[slot] = null;
    this.placed += 1;

    const { rows, cols } = linesCompletedBy(this.board, { cells: [] }, 0, 0);
    const lines = rows.length + cols.length;
    const cleared = [];
    if (lines > 0) {
      const seen = new Set();
      for (const r of rows) for (let c = 0; c < SIZE; c++) seen.add(r * SIZE + c);
      for (const c of cols) for (let r = 0; r < SIZE; r++) seen.add(r * SIZE + c);
      for (const key of seen) {
        const r = Math.floor(key / SIZE);
        const c = key % SIZE;
        cleared.push({ r, c, color: this.board[r][c] });
        this.board[r][c] = -1;
      }
      this.streak += 1;
      this.sinceClear = 0;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.linesCleared += lines;
    } else {
      this.sinceClear += 1;
      if (this.sinceClear >= COMBO_GRACE) this.streak = 0;
    }

    const allClear = lines > 0 && this.board.every((row) => row.every((v) => v === -1));
    const points = placedCells.length + scoreForClear(lines, this.streak) + (allClear ? ALL_CLEAR_BONUS : 0);
    this.score += points;

    const dealt = this.tray.every((p) => p === null);
    if (dealt) this.deal();
    this.over = !this.hasMove();

    return { piece, placedCells, rows, cols, lines, cleared, points, streak: this.streak, allClear, dealt };
  }
}
