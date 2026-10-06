// tools/render-icon.mjs — Renders the My Lenses icon from the real game engine.
//
// Spec (https://developers.snap.com/web-lenses/publishing): 512 × 512 PNG, opaque, background fills
// the square, subject centred within ~80% of the inscribed circle's radius, no text.
//
// The pose lives in the game: src/capture.js defines window.__capture.icon() (hide the DOM, frame
// the subject) and optionally config.iconSettleFrames (frames to advance before the shot).
// Renders at 1024 × 1024 and downsamples for clean edges. Also writes icon-check.png: the icon as
// the Snapcode crops it (with the 80% safe ring) next to how it looks at ~100 px.
//
// Usage: npm run render-icon [-- --seed 1]

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { openCapturePage } from './lib/capture-page.mjs';

const seedArg = process.argv.lastIndexOf('--seed');
const SEED = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : 1;

const OUT_DIR = resolve(process.cwd(), 'submission');
const RAW = join(OUT_DIR, '.icon-raw.png');
const ICON = join(OUT_DIR, 'icon.png');
const CHECK = join(OUT_DIR, 'icon-check.png');

function run(args) {
  const res = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
}

mkdirSync(OUT_DIR, { recursive: true });
const { page, close } = await openCapturePage({
  viewport: { width: 400, height: 400 },
  deviceScaleFactor: 2.56,
  seed: SEED,
});
try {
  const frames = await page.evaluate(() => {
    window.__capture.icon();
    return window.__capture.config?.iconSettleFrames ?? 1;
  });
  for (let i = 0; i < frames; i++) await page.evaluate(() => window.__advance(1000 / 30));
  await page.screenshot({ path: RAW });
} finally {
  await close();
}

run(['-i', RAW, '-vf', 'scale=512:512:flags=lanczos,format=rgb24', ICON]);

// Snapcode crop preview: outside the circle darkened, safe ring (80% radius) drawn in white
const d = 'hypot(X-W/2,Y-H/2)';
const ch = (c) => `if(gt(${d},W/2),18,if(between(${d},W*0.4-1.5,W*0.4+1.5),255,${c}(X,Y)))`;
run([
  '-i', ICON,
  '-filter_complex',
  `[0]split[a][b];[a]geq=r='${ch('r')}':g='${ch('g')}':b='${ch('b')}'[crop];` +
    `[b]scale=100:100:flags=area,pad=512:512:206:206:color=0x121212[small];[crop][small]hstack`,
  CHECK,
]);
spawnSync('rm', [RAW]);

console.log(`✅ ${ICON}\n✅ ${CHECK} (crop + safe ring, and ~100 px view)`);
