// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds. Contract: see the template's
// src/capture.js (config, begin(), failures(), icon(), sfxLog, sfxPrototype).

import { PIECES, SIZE } from './logic.js';

const SFX_NAMES = ['pickup', 'place', 'invalid', 'clear', 'allClear', 'deal', 'gameOver', 'start'];

// Preview: escalating clears on a rising combo, verified against logic.js:
// row 4 (Nice!, ×1) → rows 6–7 (Great!, ×2) → rows 0–2 (Amazing!, ×3). Filler rows 3 and 5 keep a
// hole in every column, so no column ever completes by accident. -1 = empty, else a colour.
const BOARD = [
  [4, 5, -1, 2, 1, 6, 4, 1],
  [2, 2, -1, 4, 2, 7, 1, 7],
  [1, 1, -1, 1, 2, 4, 6, 0],
  [-1, -1, -1, -1, 7, -1, 4, -1],
  [4, 5, 7, 4, 7, -1, -1, -1],
  [-1, 6, -1, 0, -1, 1, -1, -1],
  [2, 3, 0, -1, 0, 6, 2, 3],
  [3, 7, 5, -1, 5, 2, 2, 1],
];
const pieceOf = (cells) => PIECES.find((p) => JSON.stringify(p.cells) === JSON.stringify(cells));
const HAND = [
  { ...pieceOf([[0, 0], [0, 1], [0, 2]]), color: 0 },
  { ...pieceOf([[0, 0], [1, 0]]), color: 5 },
  { ...pieceOf([[0, 0], [1, 0], [2, 0]]), color: 2 },
];
// The hand dealt after the third move: scripted, so the clip doesn't depend on the date's seed
const NEXT_HAND = [
  { ...pieceOf([[0, 0], [0, 1], [0, 2], [0, 3]]), color: 4 },
  { ...pieceOf([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]), color: 1 },
  { ...pieceOf([[0, 0]]), color: 5 },
];
const MOVES = [
  { slot: 0, row: 4, col: 5 },
  { slot: 1, row: 6, col: 3 },
  { slot: 2, row: 0, col: 2 },
  { slot: 0, row: 7, col: 0 }, // keeps the clip moving after the big clear
];

export function install(api) {
  const sfxLog = [];
  api.sfx.init = () => {};
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  const { TRAY_SLOTS, TRAY_Z, DRAG_LIFT, cellX, cellZ } = api.layout;

  function fillBoard(layout) {
    const game = api.game();
    api.clearBoardVisuals();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        game.board[r][c] = layout[r][c];
        if (layout[r][c] >= 0) api.addBoardBlock(r, c, layout[r][c], { drop: false });
      }
    }
  }

  // Plays MOVES like a person would: pause, pick up, glide over, settle, drop
  function playMoves(moves) {
    let index = 0;
    let phase = 'idle';
    let t = 0;
    let from = null;
    let to = null;
    return (dt) => {
      if (index >= moves.length) return;
      t += dt;
      const move = moves[index];
      if (phase === 'idle' && t > (index === 0 ? 0.15 : 0.4) && !api.busy()) {
        const piece = api.tray()[move.slot].piece;
        from = { x: TRAY_SLOTS[move.slot], z: TRAY_Z };
        to = {
          x: cellX(move.col) + (piece.cols - 1) / 2 - DRAG_LIFT.x,
          z: cellZ(move.row) + (piece.rows - 1) / 2 - DRAG_LIFT.z,
        };
        api.beginDrag(move.slot);
        api.moveDrag(from.x, from.z);
        phase = 'drag';
        t = 0;
      } else if (phase === 'drag') {
        const p = Math.min(1, t / 0.65);
        const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
        // A slight arc, as a thumb would make
        const arc = Math.sin(p * Math.PI) * 0.6;
        api.moveDrag(from.x + (to.x - from.x) * e + arc, from.z + (to.z - from.z) * e);
        if (p >= 1 && t > 0.82) {
          api.endDrag();
          phase = 'idle';
          t = 0;
          index += 1;
        }
      }
    };
  }

  window.__capture = {
    config: { leadSeconds: 0.6, iconSettleFrames: 2 }, // open mid-drag on the first move
    sfxLog,
    sfxPrototype: Object.getPrototypeOf(api.sfx), // real SoundFX methods, for offline rendering

    begin() {
      api.startGame(true);
      const game = api.game();
      fillBoard(BOARD);
      game.tray = HAND.map((p) => ({ ...p }));
      game.score = 2840;
      game.deal = () => (game.tray = NEXT_HAND.map((p) => ({ ...p })));
      api.dealTrayVisuals(false);
      api.setAutopilot(playMoves(MOVES));
      sfxLog.length = 0;
      return performance.now() / 1000;
    },

    // Dev check of the results card: a played-looking board, then game over
    endGame() {
      const game = api.game();
      fillBoard(BOARD);
      Object.assign(game, { score: 6420, linesCleared: 23, bestStreak: 5, placed: 41, over: true });
      api.gameOver();
    },

    failures() {
      return api.game().over ? [{ t: performance.now() / 1000, reason: 'game over during the clip' }] : [];
    },

    // Icon: a tight shot of a glossy block cluster with one piece hovering, about to drop in
    icon() {
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      document.getElementById('game-container').style.cssText = 'max-width:none;max-height:none;height:100%;border-radius:0';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.startGame(true);
      const game = api.game();
      // A 3×3 cluster with an L-shaped gap, and the yellow L hovering above it, ghost glowing below
      const pattern = [
        '........',
        '........',
        '........',
        '..A.....',
        '..CD....',
        '..EFG...',
        '........',
        '........',
      ];
      const colors = { A: 7, C: 1, D: 5, E: 4, F: 0, G: 6 };
      api.clearBoardVisuals();
      pattern.forEach((row, r) =>
        [...row].forEach((ch, c) => {
          if (ch === '.') return;
          game.board[r][c] = colors[ch];
          api.addBoardBlock(r, c, colors[ch], { drop: false });
        })
      );
      // The gap is (3,3), (3,4), (4,4): exactly this L
      const piece = pieceOf([[0, 0], [0, 1], [1, 1]]);
      game.tray = [{ ...piece, color: 2 }, null, null];
      api.dealTrayVisuals(false);
      api.beginDrag(0);
      const target = { row: 3, col: 3 };
      api.moveDrag(
        cellX(target.col) + (piece.cols - 1) / 2 - DRAG_LIFT.x,
        cellZ(target.row) + (piece.rows - 1) / 2 - DRAG_LIFT.z
      );
      // Lift it higher and nudge it up-right, so it clearly floats above its slot
      const root = api.tray()[0].root;
      const p = root.getPosition();
      root.setPosition(p.x + 0.2, p.y + 0.45, p.z - 0.3);
      root.setLocalScale(1, 1, 1);

      api.lockView();
      api.camera.camera.orthoHeight = 3.0;
      api.camTarget.set(cellX(3.2), 0, cellZ(3.85));
    },
  };
}
