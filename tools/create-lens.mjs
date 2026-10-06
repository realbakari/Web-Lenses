#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const lensName = process.argv[2];

if (!lensName) {
  console.log(`
Usage: npm run new-lens <lens-name>
Example: npm run new-lens cosmic-runner
`);
  process.exit(1);
}

const templateDir = resolve(process.cwd(), 'templates/starter-lens');
const targetDir = resolve(process.cwd(), 'lenses', lensName);

if (existsSync(targetDir)) {
  console.error(`❌ Error: Directory "lenses/${lensName}" already exists!`);
  process.exit(1);
}

console.log(`🚀 Creating new Web Lens in lenses/${lensName}...`);
cpSync(templateDir, targetDir, { recursive: true });

// Customize package.json in new lens
const pkgPath = join(targetDir, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = lensName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// Customize index.html title
const htmlPath = join(targetDir, 'index.html');
if (existsSync(htmlPath)) {
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace('<title>Web Lens</title>', `<title>${lensName}</title>`);
  html = html.replace('<span class="hud-title">Web Lens</span>', `<span class="hud-title">${lensName}</span>`);
  writeFileSync(htmlPath, html, 'utf8');
}

console.log(`
✨ Lens created successfully!
Next steps:
  1. cd lenses/${lensName}
  2. npm install
  3. npm run dev       # Start local preview
  4. npx playwright-core install chromium   # once per machine, for the recorders
  5. Edit src/capture.js so the preview shows your game's best moment
  6. npm run record-preview   # submission/preview.mp4 (720×1280, 5 s, 30 fps, H.264 + AAC)
  7. npm run render-icon      # submission/icon.png (512×512) + icon-check.png
  8. npm run pack             # submission/${lensName}-v<version>.zip
`);
