// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when the URL has ?capture.
// Exposes window.__capture, logs sound effects instead of playing them (the recorder renders
// them offline into the video's audio track), and steers the head with a dodging autopilot.

import { Color, Entity } from 'playcanvas';

const SFX_NAMES = ['playWhoosh', 'playHit', 'playLevelUp', 'playClutch', 'playStart'];
// Tighter than the game's own limits so the head stays fully in frame at 9:16
const BOUNDS = { minX: -1.05, maxX: 1.05, minY: -0.45, maxY: 1.2 };
const PLAYER_RADIUS = 0.52;

export function install(api) {
  const sfxLog = [];
  const hits = [];
  api.sfx.init = () => {};
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  // Pick the reachable spot with the most clearance from hazards about to arrive,
  // preferring small moves so the head glides instead of teleporting.
  function steer(dt) {
    const cur = api.playerCurrentPos;
    let best = null;
    let bestScore = -Infinity;

    for (let ix = 0; ix <= 10; ix++) {
      const x = BOUNDS.minX + ((BOUNDS.maxX - BOUNDS.minX) * ix) / 10;
      for (let iy = 0; iy <= 7; iy++) {
        const y = BOUNDS.minY + ((BOUNDS.maxY - BOUNDS.minY) * iy) / 7;
        let clearance = 1.4;
        for (const obs of api.obstacles) {
          const z = obs.entity.getPosition().z;
          if (z < -18 || z > 1.2) continue;
          const timeToImpact = Math.max(0, -z / obs.speed);
          const gap = api.obstacleDistance(obs, x, y) - obs.radius - PLAYER_RADIUS;
          clearance = Math.min(clearance, gap + timeToImpact * 2.2);
        }
        const move = Math.hypot(x - cur.x, y - cur.y);
        const score = clearance - move * 0.35 - Math.hypot(x, y - 0.35) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }

    const k = Math.min(1, dt * 9);
    api.playerTargetPos.x += (best.x - api.playerTargetPos.x) * k;
    api.playerTargetPos.y += (best.y - api.playerTargetPos.y) * k;
  }

  // Preview: open mid-run on level 6, with the LEVEL 7 banner landing 0.6 s into the clip
  const LEAD_SECONDS = 2.4; // lets hazards fill the tunnel before the clip starts
  const LEVEL_UP_AT = 0.6;

  window.__capture = {
    config: { leadSeconds: LEAD_SECONDS, iconSettleFrames: 1 },
    sfxLog,
    hits,
    sfxPrototype: Object.getPrototypeOf(api.sfx), // real SoundFX methods, for offline rendering
    failures: () => hits.map((t) => ({ t, reason: 'autopilot touched a hazard' })),
    begin() {
      api.startGame(6, false);
      api.setLevelTimer(api.levelDuration - (LEAD_SECONDS + LEVEL_UP_AT));
      api.setScore(3180);
      // Safety net only: the recorder fails if anything actually touches the head
      api.setGodMode(() => hits.push(performance.now() / 1000));
      api.setAutopilot(steer);
      sfxLog.length = 0;
      hits.length = 0;
      return performance.now() / 1000;
    },

    // Poses a close-up of the head dodging a hazard for the 512 × 512 Lens icon: no DOM, no text.
    icon() {
      const { app, materials } = api;
      const root = app.root;
      document.getElementById('game-container').style.cssText = 'max-width:none;max-height:none;height:100%';
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      app.resizeCanvas();

      const camera = root.findByName('camera');
      camera.camera.fov = 50;
      api.cameraBasePos.set(0.08, 0.5, 2.85);
      camera.setPosition(api.cameraBasePos);
      camera.lookAt(0, 0.36, 0);

      const head = root.findByName('playerRoot');
      head.setPosition(0, 0.28, 0);
      head.setEulerAngles(-6, 14, 14); // leaning out of the way

      // Panic face, as in-game when a hazard is close
      root.findByName('mouth').setLocalScale(0.34, 0.26, 0.14);
      root.findByName('leftEye').setLocalScale(0.24, 0.26, 0.17);
      root.findByName('rightEye').setLocalScale(0.24, 0.26, 0.17);

      materials.headband.diffuse = new Color(1, 0.85, 0.1);
      materials.headband.emissive = new Color(1, 0.85, 0.1);
      materials.headband.update();

      const prop = (name, type, material, pos, scale, euler = [0, 0, 0]) => {
        const e = new Entity(name);
        e.addComponent('render', { type });
        e.render.meshInstances[0].material = material;
        e.setPosition(...pos);
        e.setLocalScale(...scale);
        e.setEulerAngles(...euler);
        root.addChild(e);
      };
      prop('icon_hazard', 'sphere', materials.hazard, [-0.66, 1.0, -0.15], [0.36, 0.36, 0.36]);
      prop('icon_laser', 'cylinder', materials.laser, [0.35, -0.55, -1.6], [0.09, 3.4, 0.09], [0, 0, 68]);
    },
  };
}
