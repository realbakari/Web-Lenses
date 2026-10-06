import {
  Application,
  Color,
  Entity,
  FILLMODE_FILL_WINDOW,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';
import snapchat from '@snap/web-lens-api';

// Initialize Snapchat Web Lens API (falls back gracefully to built-in stubs in dev)
let snapchatReady = false;
async function initSnapchat() {
  try {
    await snapchat.init();
    snapchatReady = true;
    console.log('[WebLens] Snapchat Web Lens API initialized. isStub:', snapchat.isStub);
  } catch (err) {
    console.warn('[WebLens] Snapchat API initialization notice:', err);
  }
}
initSnapchat();

// PlayCanvas App Setup
const canvas = document.getElementById('app');
const app = new Application(canvas);

app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
// Cap max pixel ratio to 2 for optimal battery and performance on mobile devices
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

window.addEventListener('resize', () => {
  app.resizeCanvas();
});

// Scene Camera - clearColor matches html/body background #0b0c10
const camera = new Entity('camera');
camera.addComponent('camera', {
  clearColor: new Color(0.043, 0.047, 0.063),
  fov: 50,
});
camera.setPosition(0, 1.2, 4.5);
camera.lookAt(0, 0.2, 0);
app.root.addChild(camera);

// Directional Light
const light = new Entity('directionalLight');
light.addComponent('light', {
  type: 'directional',
  color: new Color(1, 0.95, 0.9),
  intensity: 1.2,
});
light.setEulerAngles(45, 35, 0);
app.root.addChild(light);

// Soft Ambient Light
const ambientLight = new Entity('ambientLight');
ambientLight.addComponent('light', {
  type: 'omni',
  color: new Color(0.2, 0.5, 0.8),
  range: 10,
  intensity: 0.8,
});
ambientLight.setPosition(0, 3, 0);
app.root.addChild(ambientLight);

// Interactive Central Entity (Stylized Gem / Cube)
const coreMesh = new Entity('coreMesh');
coreMesh.addComponent('render', {
  type: 'box',
});

const coreMaterial = new StandardMaterial();
coreMaterial.diffuse = new Color(0.0, 0.8, 0.9);
coreMaterial.useMetalness = true;
coreMaterial.metalness = 0.8;
coreMaterial.gloss = 0.85;
coreMaterial.update();

if (coreMesh.render && coreMesh.render.meshInstances[0]) {
  coreMesh.render.meshInstances[0].material = coreMaterial;
}
coreMesh.setPosition(0, 0.2, 0);
app.root.addChild(coreMesh);

// State
let score = 0;
let rotationSpeed = 35;
const scoreDisplay = document.getElementById('score-display');

// Tap / Pointer interaction
window.addEventListener('pointerdown', () => tap());

async function tap() {
  score += 1;
  rotationSpeed = 160; // Spin burst on tap

  if (scoreDisplay) {
    scoreDisplay.textContent = String(score);
  }

  // Randomize color tone
  coreMaterial.diffuse = new Color(
    0.3 + Math.random() * 0.7,
    0.3 + Math.random() * 0.7,
    0.3 + Math.random() * 0.7
  );
  coreMaterial.update();

  // Submit score to Snapchat leaderboards if available
  if (snapchatReady && snapchat.isSupported('leaderboards')) {
    try {
      await snapchat.leaderboards.submitScore({
        leaderboardId: 'main',
        score: score,
      });
    } catch (e) {
      console.warn('[WebLens] Failed to submit score:', e);
    }
  }
}

// Update Loop
app.on('update', (dt) => {
  // Smoothly decay rotation speed back to base
  rotationSpeed = rotationSpeed + (35 - rotationSpeed) * Math.min(dt * 3, 1);
  coreMesh.rotate(15 * dt, rotationSpeed * dt, 10 * dt);

  // Subtle floating oscillation
  const time = performance.now() * 0.002;
  coreMesh.setPosition(0, 0.2 + Math.sin(time) * 0.08, 0);
});

// Dev-only preview video / icon hooks (npm run record-preview, npm run render-icon).
// Stripped from production builds. See src/capture.js for the contract.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
  import('./capture.js').then(({ install }) => install({ app, tap }));
}

// Start engine
app.start();
