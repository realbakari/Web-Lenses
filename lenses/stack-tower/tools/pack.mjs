// tools/pack.mjs — Packages dist/ into <lens-name>.zip adhering to Snapchat requirements:
// 1. index.html sits at the root of the zip archive.
// 2. Paths strictly use forward slashes (/).
// 3. Verifies zip size <= 8 MB and index.html <= 1 MB.

import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import archiver from 'archiver';

const distDir = resolve(process.cwd(), 'dist');
const indexHtmlPath = resolve(distDir, 'index.html');
const pkgPath = resolve(process.cwd(), 'package.json');

if (!existsSync(indexHtmlPath)) {
  console.error('❌ Error: dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

// Check index.html size limit (1 MB)
const indexHtmlStats = statSync(indexHtmlPath);
const indexHtmlSizeMb = indexHtmlStats.size / (1024 * 1024);
if (indexHtmlSizeMb > 1.0) {
  console.error(`❌ Error: index.html is ${(indexHtmlSizeMb).toFixed(2)} MB, exceeding Snapchat's 1 MB limit!`);
  process.exit(1);
}

// Check relative paths in index.html
const indexHtmlContent = readFileSync(indexHtmlPath, 'utf8');
const absoluteMatches = indexHtmlContent.match(/(?:src|href)=["']\/(?!\/)[^"']*["']/g);
if (absoluteMatches && absoluteMatches.length > 0) {
  console.error('❌ Error: Found absolute paths in dist/index.html:', absoluteMatches);
  console.error('All paths in a Web Lens must be relative (e.g. starting with "./"). Check vite.config.js base: "./"');
  process.exit(1);
}

// Derive zip name from package.json or folder name
let zipName = 'web-lens.zip';
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  // Versioned per the publishing docs, so you always know which upload is live
  if (pkg.name) {
    zipName = pkg.version ? `${pkg.name}-v${pkg.version}.zip` : `${pkg.name}.zip`;
  }
} catch {
  zipName = `${basename(process.cwd())}.zip`;
}

// Lands next to the icon and preview video, so all three uploads are in one folder
mkdirSync(resolve(process.cwd(), 'submission'), { recursive: true });
const outputPath = resolve(process.cwd(), 'submission', zipName);
const output = createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 }, // Maximum compression
});

output.on('close', () => {
  const zipSizeMb = archive.pointer() / (1024 * 1024);
  console.log(`\n📦 Successfully created ${zipName}`);
  console.log(`   Total Size: ${(archive.pointer() / 1024).toFixed(1)} KB (${zipSizeMb.toFixed(2)} MB)`);
  console.log(`   Entry Point: index.html at zip root`);

  if (zipSizeMb > 8.0) {
    console.error(`❌ WARNING: Zip file exceeds Snapchat 8 MB limit (${zipSizeMb.toFixed(2)} MB)!`);
    process.exit(1);
  } else {
    console.log(`✅ Passed all Snapchat package checks! Ready to upload to My Lenses.\n`);
  }
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn(err);
  } else {
    throw err;
  }
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Directory content directly at root (false means don't include "dist" parent folder)
archive.directory(distDir, false);

await archive.finalize();
