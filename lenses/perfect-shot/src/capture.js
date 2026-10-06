// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds. Contract: see the template's
// src/capture.js (config, begin(), failures(), icon(), sfxLog, sfxPrototype).

import { Vec3 } from 'playcanvas';

const SFX_NAMES = ['shutter', 'rating', 'photobomb', 'missed', 'splash', 'boom', 'whoosh', 'cue', 'rollDone'];

export function install(api) {
  const sfxLog = [];
  api.sfx.init = () => {};
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  // Aim at the subject and fire at the peak (plus an optional timing error)
  function perfectShooter({ timingError = 0 } = {}) {
    return () => {
      const scene = api.scene();
      if (!scene || api.state() !== 'shoot') return;
      const f = api.frameCoords(scene.focus(new Vec3()));
      if (!f.ahead || !Number.isFinite(f.nx) || !Number.isFinite(f.ny)) return;
      const aim = api.aim();
      api.setAim(aim.yaw - f.nx * 3, aim.pitch - f.ny * 3);
      if (api.time() >= scene.peak + timingError) api.pressShutter();
    };
  }

  window.__capture = {
    config: { leadSeconds: 0.25, iconSettleFrames: 24 },
    sfxLog,
    sfxPrototype: Object.getPrototypeOf(api.sfx),

    begin() {
      // Preview: open on the whale breach, snap it at the peak, the polaroid develops: the whole hook
      api.startRoll(true, ['whale', 'fireworks', 'cat', 'skater', 'pizza', 'dolphins']);
      api.setAutopilot(perfectShooter());
      sfxLog.length = 0;
      return performance.now() / 1000;
    },

    // Dev inspection: jump to a scene at a given time
    peek(id, time) {
      api.startRoll(false);
      api.loadSceneForDev(id);
      const scene = api.scene();
      api.freezeAt(time === 'peak' ? scene.peak : time);
      // Re-aim a little every frame (the camera only moves between frames)
      api.setAutopilot(() => {
        const f = api.frameCoords(scene.focus(new Vec3()));
        if (!f.ahead || !Number.isFinite(f.nx) || !Number.isFinite(f.ny)) return;
        const aim = api.aim();
        api.setAim(aim.yaw - f.nx * 3, aim.pitch - f.ny * 3);
      });
    },

    // Icon: a real in-game photo of a firework at full bloom, as a tilted polaroid on a dark ground
    icon() {
      api.setNoBombs(true);
      document.getElementById('frame').style.width = '58%'; // the 4:5 frame must fit the square icon canvas
      api.startRoll(false, ['fireworks']);
      const scene = api.scene();
      scene.camera.fov = 34; // zoom in so the burst fills the photo
      api.freezeAt(scene.peak);
      let frames = 0;
      api.setAutopilot(() => {
        frames += 1;
        const f = api.frameCoords(scene.focus(new Vec3()));
        if (f.ahead && Number.isFinite(f.nx)) {
          const aim = api.aim();
          api.setAim(aim.yaw - f.nx * 3, aim.pitch - f.ny * 3);
        }
        if (frames !== 18) return;
        const photo = api.takePhoto();
        for (const el of document.querySelectorAll('#game-container > *')) el.style.display = 'none';
        const c = api.container;
        c.style.cssText = 'max-width:none;max-height:none;height:100%;border-radius:0;background:#14211f';
        const card = document.createElement('div');
        card.style.cssText =
          'position:absolute;left:50%;top:50%;width:47%;padding:3.2% 3.2% 9.5%;background:#f7f1e6;border-radius:4px;' +
          'transform:translate(-50%,-50%) rotate(-7deg);box-shadow:0 18px 40px rgba(0,0,0,.5)';
        card.innerHTML = `<img src="${photo}" style="display:block;width:100%;aspect-ratio:4/5;object-fit:cover">`;
        c.appendChild(card);
      });
    },
  };
}
