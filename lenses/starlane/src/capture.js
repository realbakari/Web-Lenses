// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds. Contract: see the template's
// src/capture.js (config, begin(), failures(), icon(), sfxLog, sfxPrototype).

import { Vec3 } from 'playcanvas';

const SFX_NAMES = ['laser', 'explosion', 'ring', 'shieldHit', 'pickup', 'warp', 'gameOver', 'launch', 'engineBed'];
const CANNON_X = 2.0; // wing cannons sit this far either side of the ship's centre

// Preview: mid-flight in sector 1, threading a ring lane while the cannons clear rocks and a drone
// pair in their lines of fire, then a hyperspace jump into sector 2 (blue → red nebula).
const RINGS = [
  { x: 0.4, y: 0.2, z: -48 },
  { x: 1.2, y: 0.6, z: -70 },
  { x: 1.6, y: 0.2, z: -92 },
  { x: 0.9, y: -0.4, z: -114 },
];
const WARP_AFTER = 3.05; // seconds after begin()

export function install(api) {
  const sfxLog = [];
  const hits = [];
  api.sfx.init = () => {};
  api.sfx.engine = () => {}; // continuous; the video uses a steady engineBed() instead
  for (const name of SFX_NAMES) {
    api.sfx[name] = (...args) => sfxLog.push({ name, args, t: performance.now() / 1000 });
  }

  // Steer for the next ring ahead; hold position once they're all behind
  function flyRings(dt) {
    const next = api.rings
      .map((r) => r.e.getPosition())
      .filter((p) => p.z < -2)
      .sort((a, b) => b.z - a.z)[0];
    if (!next) return;
    const k = Math.min(1, dt * 4);
    api.shipTarget.x += (next.x - api.shipTarget.x) * k;
    api.shipTarget.y += (next.y - api.shipTarget.y) * k;
  }

  window.__capture = {
    config: { leadSeconds: 0.5, iconSettleFrames: 3 },
    sfxLog,
    hits,
    sfxPrototype: Object.getPrototypeOf(api.sfx), // real SoundFX methods, for offline rendering

    begin() {
      api.startGame();
      api.skipLaunch(); // open in the chase view, not mid camera swing
      api.stopSpawning();
      api.clearWorld();
      api.setScore(8420);
      api.setDistance(18.6);
      api.setSectorTime(32 - WARP_AFTER);
      api.shipTarget.set(0.2, 0.1, 0);
      api.shipPos.set(0.2, 0.1, 0);

      for (const r of RINGS) api.spawnRingLane(r.z, 1, r.x, r.y);
      // Rocks in the cannons' lines of fire (they follow the ship along the ring lane)
      [[-30, 0.4, 0.3, 0.9], [-58, 1.2, 0.5, 1.3], [-80, 1.6, 0.3, 0.8], [-104, 0.9, -0.3, 1.6], [-126, 0.9, -0.4, 1.0]].forEach(
        ([z, x, y, size], i) => api.spawnAsteroid(x + (i % 2 ? CANNON_X : -CANNON_X), y, z, size)
      );
      api.spawnDrone(1.6 - CANNON_X, 0.4, -95);
      api.spawnDrone(1.6 + CANNON_X, 0.6, -100);
      // Scenery outside the lane
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1;
        api.spawnAsteroid(side * (5 + Math.random() * 6), (Math.random() - 0.5) * 7, -20 - Math.random() * 160, 0.6 + Math.random() * 1.6);
      }
      for (const h of api.hazards) if (h.kind === 'drone') h.fireIn = 99; // keep the clip clean

      api.setGodMode((t) => hits.push(t));
      api.setAutopilot(flyRings);
      sfxLog.length = 0;
      const t0 = performance.now() / 1000;
      api.sfx.engineBed(8);
      return t0;
    },

    // Dev check of the mission report: lose all shields now
    crash() {
      api.setGodMode(null);
      for (let i = 0; i < 3; i++) {
        api.damageShip();
        api.resetInvulnerable?.();
      }
    },

    failures() {
      return hits.map((t) => ({ t, reason: 'ship hit' }));
    },

    // Icon: three-quarter front view of the ship banking, inside a glowing ring, nebula behind
    icon() {
      for (const el of document.querySelectorAll('#game-container > :not(canvas)')) el.style.display = 'none';
      document.getElementById('game-container').style.cssText = 'max-width:none;max-height:none;height:100%;border-radius:0';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.applySector(0);
      api.setState('icon');
      api.ship.root.setPosition(0, 0, 0);
      // Rear three-quarter: glowing engines, banking into a gold ring just ahead
      api.ship.body.setLocalEulerAngles(4, 0, -28);
      for (const { core, plume } of api.ship.exhaust) {
        core.setLocalScale(0.34, 0.34, 0.34);
        plume.setLocalScale(0.34, 1.8, 0.34);
      }
      // Ring behind the ship along the camera's line of sight, so it frames the ship
      api.spawnRingLane(-5.2, 1, 1.25, -1.15);
      api.rings[0].e.setLocalScale(1.45, 1.45, 1.45);
      api.app.root.findByName('stars').enabled = false; // near streaks read as stray marks
      api.setCameraOverride((camera) => {
        camera.setPosition(-1.75, 1.6, 7.2);
        camera.lookAt(new Vec3(0.12, -0.12, -0.3));
        camera.camera.fov = 44;
      });
    },
  };
}
