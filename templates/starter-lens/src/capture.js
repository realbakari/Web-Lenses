// Dev-only hooks for tools/record-preview.mjs and tools/render-icon.mjs. Loaded by main.js when
// the URL has ?capture; never included in production builds.
//
// Contract (window.__capture):
//   config        { leadSeconds, iconSettleFrames }
//   begin()       set up the moment the preview video should show, return performance.now()/1000.
//                 Show the most exciting moment, not a fresh game (publishing docs). Typical tools:
//                 pre-build game state, then install an autopilot that plays from the update loop.
//   failures()    optional: [{ t, reason }] for anything that must not appear in the clip (deaths…)
//   icon()        pose the 512 × 512 icon: hide the DOM, frame one clear subject, no text
//   sfxLog        optional: [{ name, args, t }] logged instead of playing sounds…
//   sfxPrototype  …and the class whose methods play them, re-run against an OfflineAudioContext.
//                 Sound methods must schedule from this.ctx.currentTime. Without these the video
//                 gets a silent audio track (AAC is still required by the spec).

export function install(api) {
  window.__capture = {
    config: { leadSeconds: 0.5, iconSettleFrames: 1 },

    begin() {
      api.tap(); // replace with your game's scenario
      return performance.now() / 1000;
    },

    icon() {
      for (const el of document.querySelectorAll('body > :not(canvas)')) el.style.display = 'none';
      api.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
      api.app.resizeCanvas();
    },
  };
}
