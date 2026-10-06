// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when the
// URL has ?capture. Exposes window.__capture, logs sound effects instead of playing them (the
// recorder renders them offline into the video's audio track), and drives drops with an autopilot.

const SFX_NAMES = ['place', 'slice', 'perfect', 'grow', 'miss', 'start'];

// Preview clip: opens mid-climb on a pre-built tower (mostly clean, a few cuts for character),
// then drops on a plan of offsets (0 = perfect): one big slice, then a perfect streak with rising
// chimes, ripples and the block growing back
const PREBUILT = [0, 0.3, 0, 0, -0.25, 0, 0, 0, 0.2, 0, 0, -0.15, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, -0.2, 0, 0];
const PLAN = [0.45, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0];

// Icon: a short tower and one big slice, so the offcut tumbling off the edge tells the whole game
const ICON_PREBUILT = [0, 0.2, 0, 0, -0.15, 0, 0, 0.1, 0, 0];
const ICON_SLICE = 0.8;

export function install(api) {
  const sfxLog = [];
  api.sfx.init = () => {};
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  // Drops each block when its offset from the tower crosses the next planned offset
  // (0 = perfect). The plan loops.
  function dropOnPlan(plan) {
    let index = 0;
    let lastError = null;
    let lastBlock = null;
    return () => {
      const moving = api.moving();
      const tower = api.tower();
      const top = tower[tower.length - 1];
      if (moving !== lastBlock) {
        lastBlock = moving;
        lastError = null;
      }
      const error = moving[moving.axis] - top[moving.axis] - plan[index % plan.length];
      if (lastError !== null && Math.sign(error) !== Math.sign(lastError)) {
        // Snap exactly onto the planned offset so the result doesn't depend on frame timing
        moving[moving.axis] -= error;
        index += 1;
        api.place();
        return;
      }
      lastError = error;
    };
  }

  // Build a tower instantly: sets each block's offset then drops it
  function prebuild(offsets) {
    for (const offset of offsets) {
      const moving = api.moving();
      const tower = api.tower();
      moving[moving.axis] = tower[tower.length - 1][moving.axis] + offset;
      api.place();
    }
    api.clearEffects();
    api.tower().at(-1).flash = 0;
  }

  window.__capture = {
    config: {
      leadSeconds: 0.3, // a few frames for the camera to settle on the pre-built tower
      iconSettleFrames: 5, // let the offcut fall clear of the tower and start to tip
    },
    sfxLog,
    sfxPrototype: Object.getPrototypeOf(api.sfx), // real SoundFX methods, for offline rendering

    begin() {
      api.startGame();
      prebuild(PREBUILT);
      api.setAutopilot(dropOnPlan(PLAN));
      sfxLog.length = 0;
      return performance.now() / 1000;
    },

    // Poses the tower top mid-slice for the 512 × 512 Lens icon: no DOM, no text.
    icon() {
      document.getElementById('game-container').style.cssText =
        'max-width:none;max-height:none;height:100%;border-radius:0';
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.startGame();
      prebuild(ICON_PREBUILT);
      const moving = api.moving();
      const top = api.tower()[api.tower().length - 1];
      moving[moving.axis] = top[moving.axis] + ICON_SLICE;
      api.place();
      api.moving().entity.enabled = false; // only the sliced block and its offcut

      // Square close-up on the top of the tower, applied immediately rather than eased
      const focusY = api.tower().at(-1).y - 1.6;
      api.setFocusTarget(focusY, 4.9);
      api.camFocus.y = focusY;
      api.camera.camera.orthoHeight = 4.9;
    },
  };
}
