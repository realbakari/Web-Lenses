// Shared by record-preview.mjs and render-icon.mjs: serves the lens with Vite in dev mode and opens
// it in headless Chromium with ?capture (loads src/capture.js) on a deterministic virtual clock.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';

// Runs in the page before any app code: deterministic Math.random, and a virtual clock that drives
// performance.now, requestAnimationFrame, setTimeout and CSS transitions from window.__advance(ms).
function installVirtualClock(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let now = 0;
  const epoch = Date.now();
  performance.now = () => now;
  Date.now = () => epoch + now;

  let nextId = 0;
  let rafQueue = [];
  let timers = [];
  window.requestAnimationFrame = (cb) => (rafQueue.push({ id: ++nextId, cb }), nextId);
  window.cancelAnimationFrame = (id) => (rafQueue = rafQueue.filter((r) => r.id !== id));
  window.setTimeout = (fn, ms = 0, ...rest) => {
    timers.push({ id: ++nextId, at: now + Math.max(0, ms), fn, rest });
    return nextId;
  };
  window.clearTimeout = (id) => (timers = timers.filter((t) => t.id !== id));

  const animationStart = new WeakMap();
  window.__advance = (ms) => {
    now += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > now) break;
      const t = timers.shift();
      if (typeof t.fn === 'function') t.fn(...t.rest);
    }
    const queue = rafQueue;
    rafQueue = [];
    for (const r of queue) r.cb(now);
    for (const a of document.getAnimations()) {
      if (!animationStart.has(a)) {
        animationStart.set(a, now);
        a.pause();
      }
      a.currentTime = now - animationStart.get(a);
    }
  };
}

export async function openCapturePage({ viewport, deviceScaleFactor, seed = 1 }) {
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist'] });
  } catch (err) {
    await server.close();
    throw new Error(`Couldn't start Chromium. Install it once with: npx playwright-core install chromium\n${err.message}`);
  }
  const close = async () => {
    await browser.close();
    await server.close();
  };

  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    page.on('pageerror', (err) => console.error('[page]', err.message));
    await page.addInitScript(installVirtualClock, seed);
    await page.goto(`${server.resolvedUrls.local[0]}?capture`, { waitUntil: 'load' });

    for (let i = 0; !(await page.evaluate(() => !!window.__capture)); i++) {
      if (i > 300) throw new Error('Capture hooks never loaded (is src/capture.js reachable?)');
      await page.evaluate(() => window.__advance(1000 / 30));
    }
    for (let i = 0; i < 10; i++) await page.evaluate(() => window.__advance(1000 / 30));
    return { page, close };
  } catch (err) {
    await close();
    throw err;
  }
}
