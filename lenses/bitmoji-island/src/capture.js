// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds. Contract: see the template's
// src/capture.js (config, begin(), failures(), icon(), sfxLog, sfxPrototype).

const SFX_NAMES = ['plant', 'water', 'harvest', 'buy', 'nope', 'levelUp', 'order', 'gift', 'chirp'];

/** A well-loved island: level 4, ten plots, a windmill, pond, tree, fence and lanterns. */
function grownIsland(E, now) {
  const s = E.newSave(now);
  s.level = 4;
  s.xp = E.xpForLevel(4) - 12; // the harvests in the clip tip it into level 5
  s.coins = 486;
  s.decor = ['tree', 'fence', 'windmill', 'pond', 'bench'];
  s.daily = { last: '', streak: 6 };
  s.stats = { harvested: 212, earned: 3480, started: now };
  const crops = ['sunflower', 'tomato', 'carrot', 'sunflower', 'tomato', 'carrot', 'tomato', 'sunflower', 'carrot', 'tomato'];
  E.PLOT_ORDER.slice(0, 10).forEach((i, k) => {
    s.plots[i].unlocked = true;
    const id = crops[k];
    // Most are ready (sparkling); a couple are still growing
    const done = k < 7;
    Object.assign(s.plots[i], { crop: id, grow: E.CROPS[id].grow, plantedAt: now - E.CROPS[id].grow * (done ? 1.05 : 0.55), watered: false });
  });
  s.orders = [{ crop: 'tomato', need: 3, have: 1, coins: 38, xp: 15 }, { crop: 'sunflower', need: 2, have: 0, coins: 54, xp: 20 }];
  return s;
}

export function install(api) {
  const sfxLog = [];
  api.sfx.init = () => {};
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  // A scripted session: harvest a row, replant, water, shop, harvest again, show the island off.
  // The first ~5 s are the lens preview; the full timeline is the 30 s challenge demo.
  function session(steps) {
    let t = 0;
    let k = 0;
    return (dt) => {
      t += dt;
      while (k < steps.length && t >= steps[k][0]) {
        steps[k][1]();
        k += 1;
      }
    };
  }
  const click = (sel) => document.querySelector(sel)?.click();

  window.__capture = {
    config: { leadSeconds: 0.3, iconSettleFrames: 3 },
    sfxLog,
    sfxPrototype: Object.getPrototypeOf(api.sfx),

    begin() {
      const E = api.E;
      api.setSave(grownIsland(E, Date.now()));
      api.hideWelcome();
      api.hideHint();
      api.setYaw(-18);
      api.changed();
      const p = E.PLOT_ORDER;
      const harvest = [p[0], p[1], p[4], p[2], p[3], p[5], p[6]];
      const steps = harvest.map((i, k) => [0.35 + k * 0.6, () => api.tapPlot(i)]);
      // Replant carrots on the freshly harvested plots, then water them
      [p[0], p[1], p[4], p[2]].forEach((i, k) => steps.push([5.0 + k * 0.5, () => api.tapPlot(i)]));
      [p[0], p[1], p[4], p[2]].forEach((i, k) => steps.push([7.4 + k * 0.45, () => api.tapPlot(i)]));
      // Shop: open Build, buy lanterns (new at level 5)
      steps.push([10.2, () => click('#btn-build')]);
      steps.push([11.6, () => click('[data-buy="lanterns"]')]);
      // Tomatoes on the rest, then harvest the watered carrots when they sparkle
      steps.push([13.4, () => click('[data-crop="tomato"]')]);
      [p[3], p[5], p[6]].forEach((i, k) => steps.push([13.8 + k * 0.5, () => api.tapPlot(i)]));
      [p[0], p[1], p[4], p[2]].forEach((i, k) => steps.push([20.5 + k * 0.6, () => api.tapPlot(i)]));
      // Finally a slow spin to show the island off
      steps.push([24, () => ((spin = true), api.setCameraOverride(null))]); // wider camera for the spin
      let spin = false;
      let yaw = -18;
      const run = session(steps);
      api.setAutopilot((dt) => {
        run(dt);
        if (spin) api.setYaw((yaw += dt * 22));
      });
      // A slightly closer framing than the default, so the harvest reads on a small preview
      api.setCameraOverride((camera) => {
        camera.setPosition(0, 4.6, 10.2);
        camera.lookAt(0, -0.9, 0.4);
        camera.camera.fov = 56;
      });
      sfxLog.length = 0;
      return performance.now() / 1000;
    },

    // Icon: the island on its own, a little closer, with the windmill and cottage, no UI
    icon() {
      const E = api.E;
      const s = grownIsland(E, Date.now());
      s.decor = ['tree', 'windmill', 'pond', 'cottage', 'fence', 'lanterns'];
      api.setSave(s);
      api.hideWelcome();
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      document.getElementById('game-container').style.cssText = 'max-width:none;max-height:none;height:100%;border-radius:0';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.setYaw(-25);
      api.changed();
      api.setCameraOverride((camera) => {
        camera.setPosition(0, 6.5, 15.5);
        camera.lookAt(0, -1.2, 0);
        camera.camera.fov = 62;
      });
    },
  };
}
