# Web Lens Games

Seven games for [Snapchat Web Lenses](https://developers.snap.com/web-lenses/home), built with [PlayCanvas](https://playcanvas.com/) and [Vite](https://vite.dev/), plus the tooling to scaffold, test, record and package them for [My Lenses](https://my-lenses.snapchat.com/).

Every game uses the three Web Lens APIs (Bitmoji, Leaderboards, Persistent Storage), runs fully offline, and ships as a zip well under the 8 MB limit.

## The games

| Lens | Folder | What it is | Snap APIs |
|---|---|---|---|
| Perfect Shot | `lenses/perfect-shot` | A camera-timing game: six fleeting 3D moments (a whale breach, fireworks, a cat mid-leap…), one shot each, scored on timing and framing. Your photos develop into a polaroid scrapbook. | Bitmoji photobombs using avatar variants, daily shoot with streak, leaderboard |
| Bitmoji Island | `lenses/bitmoji-island` | A cozy floating-island garden. Crops grow in real time while you're away; harvest, fill orders, buy land and decorations. Your Bitmoji lives on the island. | Bitmoji character and expressions, full save in storage, daily gift and streak, leaderboard |
| Gridlock | `lenses/gridlock` | An 8×8 block puzzle with a Daily Puzzle: the same pieces for everyone each day. | Bitmoji result card, daily best in storage, leaderboard |
| Takedown Rush | `lenses/takedown` | An arcade highway racer: drive against traffic for boost, slam rivals into the barriers for slow-motion takedowns. | Bitmoji driver card, best in storage, leaderboard |
| Starlane | `lenses/starlane` | A space flight through asteroid lanes and gold rings, with hyperspace jumps between sectors. Your 3D Bitmoji sits in the cockpit. | 3D and 2D Bitmoji, best in storage, leaderboard |
| How High Can You Stack? | `lenses/stack-tower` | Stack sliding blocks; perfect drops chain a rising melody and grow the block back. | Bitmoji portrait, best in storage, leaderboard |
| Only 1% Can Pass | `lenses/only-1-percent` | An eight-level reflex dodger that gets faster every eight seconds. | Bitmoji portrait, best in storage, leaderboard |

## Getting started

Requirements: Node.js 20 or newer. Each lens is its own npm project.

```bash
cd lenses/perfect-shot
npm install
npm run dev        # http://localhost:3000 (or the port Vite prints)
```

To try a lens on your phone, run `npm run preview` (it serves the production build on your network) and open the printed network URL in portrait. Outside Snapchat the Web Lens API falls back to its desktop stub, so Bitmoji shows a stand-in character and the native leaderboard button stays hidden.

## Scripts (in every lens)

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` on your network for phone testing |
| `npm run pack` | Build, check the platform rules, write `submission/<lens>-v<version>.zip` |
| `npm run record-preview` | Record the 5 s preview video from the real game: `submission/preview.mp4` and a contact sheet |
| `npm run record-preview -- --seconds 30 --out demo-30s.mp4` | A longer cut, for example a challenge demo video |
| `npm run render-icon` | Render the 512 × 512 icon from the game: `submission/icon.png`, plus `icon-check.png` showing the Snapcode crop and a 100 px view |

The recorders need Chromium once per machine: `npx playwright-core install chromium`.

## How the recorders work

The preview video and icon come from the game itself, not mockups.

- Headless Chromium runs the dev build on a virtual clock, so every frame is exactly 1/30 s of game time: a true constant 30 fps with no dropped frames, and identical output on every run. `-- --seed N` picks a different run.
- Sound effects are logged during the recording and re-rendered offline with the game's own audio code into the AAC track.
- What gets recorded is defined per lens in `src/capture.js` (`window.__capture` with `begin()`, `icon()`, `failures()` and `config`). It loads only in dev with `?capture` and is stripped from production builds. `failures()` lets a lens reject a take, for example if the player crashed during the clip.

## Creating a new lens

```bash
npm run new-lens my-game      # from the workspace root
```

This copies `templates/starter-lens` into `lenses/my-game`: a PlayCanvas app with the Web Lens API wired up, relative asset paths, the packaging checks and both recorders. Edit `src/capture.js` so the preview shows your game's best moment.

## Platform rules

Snap's [platform requirements](https://developers.snap.com/web-lenses/requirements), which `npm run pack` checks:

- `index.html` at the root of the zip, every asset path relative (`./…`), forward slashes in the zip.
- Zip at most 8 MB, `index.html` at most 1 MB.
- No network access: everything ships in the zip. No camera, microphone or motion sensors.

Submission assets ([publishing guide](https://developers.snap.com/web-lenses/publishing)):

- Icon: 512 × 512 PNG, opaque, subject inside the inscribed circle (80% safe radius), no text.
- Preview video: 720 × 1280, 5 s, constant 30 fps, H.264 + AAC, MP4 with `+faststart`.

Persistent Storage is currently iOS only; on Android, saves last for the session.

## Workspace layout

```
lenses/<name>/          one Web Lens per folder
  src/                  game code (main.js, capture.js for the recorders, …)
  tools/                pack, path check, preview recorder, icon renderer
  submission/           generated zip, icon and videos (not committed)
templates/starter-lens/ what `npm run new-lens` copies
tools/create-lens.mjs   the scaffolder
.agents/rules/          constraints every lens follows
.agents/skills/         PlayCanvas agent skills (also mirrored in .claude/ and agent/)
```

## Reference

- Snap: [Get started](https://developers.snap.com/web-lenses/get-started) · [Capabilities](https://developers.snap.com/web-lenses/capabilities) · [Runtime environment](https://developers.snap.com/web-lenses/runtime-environment) · [Web Lens API](https://developers.snap.com/web-lenses/web-lens-api) · [Bitmoji](https://developers.snap.com/web-lenses/bitmoji) · [Publishing](https://developers.snap.com/web-lenses/publishing)
- PlayCanvas: [Engine API](https://api.playcanvas.com/) · [Agent skills](https://github.com/playcanvas/skills)
