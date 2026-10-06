// tools/record-preview.mjs — Records the My Lenses preview video from the real game.
//
// Spec (https://developers.snap.com/web-lenses/publishing): 720 × 1280, 5 s, constant 30 fps,
// H.264 + AAC in MP4 with +faststart.
//
// How it works: serves the lens with Vite in dev mode (?capture loads src/capture.js), drives
// headless Chromium on a virtual clock so every frame is exactly 1/30 s of game time, screenshots
// each frame (canvas + DOM HUD composited), renders the logged sound effects offline into the
// audio track, then trims and encodes with ffmpeg.
//
// The scenario lives in the game, not here: src/capture.js defines window.__capture with
//   config     { leadSeconds }  frames recorded before the clip starts (trimmed off)
//   begin()    sets up the moment to show (autopilot, pre-built state…) and returns the start time
//   failures() optional: [{ t, reason }] for anything that must not appear in the clip
//   sfxLog / sfxPrototype  optional: logged sound effects and the class that plays them
//
// Usage: npm run record-preview [-- --seed 1]   (seeds Math.random, so each seed is a different run)
//        npm run record-preview -- --seconds 45 --out demo.mp4   (longer cut, e.g. a challenge demo video)

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openCapturePage } from './lib/capture-page.mjs';
import ffmpeg from 'ffmpeg-static';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.lastIndexOf(`--${name}`); // last wins, so `npm run x -- --seed N` overrides
  return i >= 0 ? args[i + 1] : fallback;
};

const SEED = Number(argValue('seed', 1));
const FPS = 30;
const CLIP_SECONDS = Number(argValue('seconds', 5));
const OUT_NAME = argValue('out', 'preview.mp4');
const OUT_DIR = resolve(process.cwd(), 'submission');

// Runs in the page: renders the logged sound effects with the game's own SoundFX code.
async function renderAudio({ t0, duration }) {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const { sfxLog = [], sfxPrototype } = window.__capture;
  if (!sfxPrototype) sfxLog.length = 0; // no sound effects: a silent track still satisfies the spec
  const voice = Object.assign(Object.create(sfxPrototype ?? {}), { ctx, muted: false });
  const quantum = 128 / rate;

  const byTime = new Map();
  for (const e of sfxLog) {
    const t = Math.max(1, Math.round((e.t - t0) / quantum)) * quantum;
    if (t >= duration) continue;
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t).push(e);
  }
  for (const [t, names] of byTime) {
    ctx.suspend(t).then(() => {
      // Always resume, even if one effect throws: a stalled OfflineAudioContext never finishes rendering
      try {
        for (const { name, args } of names) voice[name]?.(...(args ?? []));
      } catch (e) {
        console.warn('sfx replay failed', e);
      } finally {
        ctx.resume();
      }
    });
  }

  const buffer = await ctx.startRendering();
  const frames = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + frames * 4));
  const str = (o, v) => [...v].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + frames * 4, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, frames * 4, true);
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 0x7fff, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(res.stderr);
    throw new Error(`${cmd} exited with ${res.status}`);
  }
  return res;
}

const work = mkdtempSync(join(tmpdir(), 'lens-preview-'));
const { page, close } = await openCapturePage({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  seed: SEED,
});

try {
  const config = await page.evaluate(() => window.__capture.config ?? {});
  const LEAD_SECONDS = config.leadSeconds ?? 0.5;
  const TOTAL_FRAMES = Math.ceil((LEAD_SECONDS + CLIP_SECONDS + 0.2) * FPS);
  const t0 = await page.evaluate(() => window.__capture.begin());

  console.log(`Recording ${TOTAL_FRAMES} frames (seed ${SEED})…`);
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    await page.evaluate((ms) => window.__advance(ms), 1000 / FPS);
    await page.screenshot({ path: join(work, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
  }

  const failures = await page.evaluate(() => window.__capture.failures?.() ?? []);
  const inClip = failures.filter(({ t }) => t - t0 >= LEAD_SECONDS && t - t0 <= LEAD_SECONDS + CLIP_SECONDS);
  if (inClip.length) {
    const list = inClip.map(({ t, reason }) => `${(t - t0 - LEAD_SECONDS).toFixed(2)}s: ${reason}`).join('; ');
    throw new Error(`Clip rejected (${list}). Try another seed: npm run record-preview -- --seed ${SEED + 1}`);
  }

  // Frame i shows the game at t0 + (i + 1) / FPS, so the audio starts one frame later than t0
  const wav = await page.evaluate(renderAudio, { t0: t0 + 1 / FPS, duration: TOTAL_FRAMES / FPS });
  writeFileSync(join(work, 'audio.wav'), Buffer.from(wav, 'base64'));

  mkdirSync(OUT_DIR, { recursive: true });
  const mp4 = join(OUT_DIR, OUT_NAME);
  run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', join(work, '%05d.jpg'),
    '-i', join(work, 'audio.wav'),
    '-ss', String(LEAD_SECONDS), '-t', String(CLIP_SECONDS),
    '-vf', 'scale=720:1280:flags=lanczos,format=yuv420p',
    '-r', String(FPS), '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
    mp4,
  ]);

  // Contact sheet (3 frames per second) for reviewing the clip at a glance, as the docs recommend
  const sheet = join(OUT_DIR, OUT_NAME.replace(/\.mp4$/, '') + '-contact-sheet.png');
  run(ffmpeg, [
    '-y', '-loglevel', 'error', '-i', mp4,
    '-vf', `fps=${(15 / CLIP_SECONDS).toFixed(4)},scale=216:-1,tile=5x3:padding=4:color=black`,
    '-frames:v', '1', sheet,
  ]);

  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', mp4], { encoding: 'utf8' }).stderr;
  console.log(probe.split('\n').filter((l) => /Duration|Stream/.test(l)).join('\n'));
  console.log(`\n✅ ${mp4}\n✅ ${sheet}`);
} finally {
  await close();
  rmSync(work, { recursive: true, force: true });
}
