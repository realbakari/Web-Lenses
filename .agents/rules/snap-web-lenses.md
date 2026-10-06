# Snap Web Lenses & PlayCanvas Multi-Lens Workspace Rules

## 1. Multi-Lens Architecture
- This workspace (`/Users/realbakari/Documents/Web Lens`) contains multiple independent Web Lens projects.
- Each lens project lives in its own dedicated directory (e.g. `lenses/<lens-name>/` or `<lens-name>/`).
- Every lens project must be self-contained with its own:
  - `package.json` (with `"type": "module"`)
  - `vite.config.js`
  - `index.html`
  - `src/` (PlayCanvas game logic and assets)
  - `dist/` (build output)
  - Build/package scripts producing `<lens-name>.zip`

---

## 2. Platform Requirements & Strict Constraints

### Packaging & Zip Requirements
- **Root Entry Point:** `index.html` MUST sit at the root of the `.zip` archive, never inside a `dist/` or nested folder.
- **Zip Size Limit:** The compressed zip must be **8 MB or smaller**.
- **index.html Size Limit:** `index.html` must be **1 MB or smaller**. Do NOT inline large bundle chunks or base64 assets into `index.html`.
- **Zip Path Separators:** Every path inside the zip archive MUST use forward slashes (`/`), never Windows backslashes (`\`). Use `zip -r ../<name>.zip .` from inside `dist/` or `archiver` in Node.

### Relative Paths (Crucial)
- Snap Web Lenses load from arbitrary private URL schemes.
- **Every single asset reference MUST be relative:** `./assets/...`, never `/assets/...`.
- In `vite.config.js`, always set `base: './'`.
- Verify before packaging: `grep -E 'src="/|href="/' dist/index.html` must return 0 results.
- Dynamic `fetch()` calls must also use relative paths: `fetch('./data/level.json')`.

### Offline & Content Security Policy (CSP)
- **Everything ships in the zip:** No external scripts, stylesheets, fonts, audio, video, or images.
- No network access: `fetch`/`XHR` only reach files inside the zip. WebSockets and WebRTC are completely blocked.
- Blocked device APIs: Camera, microphone, motion sensors (accelerometer/gyroscope), geolocation, USB, MIDI, and iframes are blocked.
- Design exclusively for **touch and pointer input**.

---

## 3. Runtime Environment & Viewport
- **Viewport meta:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`.
- **Full bleed styling:**
  ```css
  html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: #111122; /* Must match PlayCanvas scene clearColor */
    touch-action: none;
    overscroll-behavior: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  ```
- **Avoid white flash:** Always set the CSS `background` of `html, body` to match the PlayCanvas camera `clearColor`.
- **Safe Area Insets:** Respect top and bottom system insets via CSS `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` or runtime padding.

---

## 4. PlayCanvas Engine Conventions
Use the installed PlayCanvas skills (`.agents/skills/`):
- **Named imports:** Always use named imports (e.g. `import { Application, Entity, Color } from 'playcanvas'`) to allow Vite tree-shaking and keep zip size minimal.
- **Current APIs:**
  - Use `render` and `anim` components (avoid deprecated `model` / `animation`).
  - Use ESM script classes: `class MyScript extends Script { static scriptName = 'myScript'; }`.
  - Use `Mesh.fromGeometry(device, new BoxGeometry())` instead of legacy creation helpers.
- **Coordinates & Lighting:**
  - Right-handed, +Y up, metres. `camera` and `lookAt` use -Z.
  - Directional and spot lights point down local -Y. Aim using `setEulerAngles`.
- **PixelRatio:** Cap `graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2)` to preserve mobile performance and thermals.

---

## 5. Snapchat Web Lens API (`@snap/web-lens-api`)
- Install as project dependency: `npm install @snap/web-lens-api`.
- Always initialize and check feature support before using:
  ```javascript
  import snapchat from '@snap/web-lens-api';

  await snapchat.init();

  if (snapchat.isSupported('leaderboards')) {
    await snapchat.leaderboards.submitScore({ leaderboardId: 'main', score: scoreValue });
  }

  if (snapchat.isSupported('storage')) {
    await snapchat.storage.set('highScore', scoreValue);
  }
  ```
- **Graceful degradation:** The game must remain completely playable even if optional capabilities (Bitmoji, Leaderboards, persistent storage) are unsupported on the user's host or device.
- Outside Snapchat, the API automatically uses built-in development stubs (`snapchat.isStub === true`).

---

## 6. Packaging & Publishing Specifications
- **Lens Icon:** 512 × 512 PNG, subject centered within circle (80% safe radius), solid/opaque background, NO text.
- **Preview Video:** 720 × 1280 (9:16 portrait), 5 seconds, 30 FPS, H.264 video with AAC audio in MP4, encoded with `+faststart`.
- **Production Verification Checklist:**
  1. `npm run build` succeeds without warnings.
  2. `grep -E 'src="/|href="/' dist/index.html` is empty.
  3. Zip created from inside `dist/` (so `index.html` is at the zip root).
  4. Zip size <= 8 MB, `index.html` <= 1 MB.
  5. `unzip -l <lens-name>.zip` verifies forward slash path separators.
