// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds. Contract: see the template's
// src/capture.js (config, begin(), failures(), icon(), sfxLog, sfxPrototype).

import { Vec3 } from 'playcanvas';

const SFX_NAMES = ['whoosh', 'slam', 'scrape', 'takedown', 'wreck', 'boostStart', 'nearMiss', 'countdown', 'totaled', 'engineBed'];

// Preview: boosting at speed, the player dives into the oncoming lane for a string of near misses,
// then cuts back and slams a rival into the guardrail: TAKEDOWN in slow motion.
const STEER_PLAN = [
  [0.0, 1.6],
  [0.35, -2.55], // into oncoming traffic, threading past lane −4.8
  [1.75, -2.55],
  [2.15, 4.6], // hard right into the rival
];

export function install(api) {
  const sfxLog = [];
  const hits = [];
  api.sfx.init = () => {};
  api.sfx.engine = () => {}; // continuous; the video uses a steady engineBed() instead
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  function steerPlan(plan) {
    let t = 0;
    return (dt) => {
      t += dt;
      let target = plan[0][1];
      for (const [at, x] of plan) if (t >= at) target = x;
      api.setSteer(target);
      api.setBoostHeld(true);
      api.setBoost(0.9);
    };
  }

  window.__capture = {
    config: { leadSeconds: 0.35, iconSettleFrames: 2 },
    sfxLog,
    hits,
    sfxPrototype: Object.getPrototypeOf(api.sfx),

    begin() {
      api.startGame();
      api.stopSpawning();
      // Straight into the action: no countdown, already at boost speed
      const player = api.player();
      player.speed = 60;
      api.setState('playing');
      api.setScore(18450);
      api.setTakedowns(3);
      for (const c of [...api.cars]) if (c !== player) api.removeCar(c);

      // Oncoming traffic in the far lane, plus a few same-direction cars for life
      const L = api.LANES;
      for (const z of [-55, -105, -150]) api.addCar('traffic', 'sedan', { paint: api.TRAFFIC_LOOKS.sedan[z % 3 === 0 ? 0 : 4], stripe: '#fff' }, L[0], z, -24);
      api.addCar('traffic', 'truck', api.TRAFFIC_LOOKS.truck[0], L[0], -210, -20);
      // Same-direction traffic far enough ahead that the clip ends before we reach it
      api.addCar('traffic', 'van', { paint: api.TRAFFIC_LOOKS.van[0], stripe: '#fff' }, L[2], -260, 26);
      api.addCar('traffic', 'sedan', { paint: api.TRAFFIC_LOOKS.sedan[3], stripe: '#fff' }, L[3], -330, 24);

      // The rival pacing us on the right, holding its lane
      const rival = api.addCar('rival', 'sport', api.RIVAL_LOOKS[0], 5.2, 1.5, 60);
      rival.hp = 2;
      rival.offset = 0;
      rival.aiTimer = 1e9;
      rival.laneX = 5.2;
      rival.brain = 0;

      api.setGodMode((t, cause) => hits.push({ t, reason: `player wreck (${cause})` }));
      api.setAutopilot(steerPlan(STEER_PLAN));
      sfxLog.length = 0;
      const t0 = performance.now() / 1000;
      api.sfx.engineBed(8);
      return t0;
    },

    failures() {
      return hits;
    },

    // Icon: low front three-quarter of the hero car, headlights blazing, sunset behind
    icon() {
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      document.getElementById('game-container').style.cssText = 'max-width:none;max-height:none;height:100%;border-radius:0';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.setState('icon');
      api.setCameraOverride((camera) => {
        camera.setPosition(-4.6, 1.5, -8.8);
        camera.lookAt(new Vec3(1.45, 0.55, 0.15));
        camera.camera.fov = 34;
      });
    },
  };
}
