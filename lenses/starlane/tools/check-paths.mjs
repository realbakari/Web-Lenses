// tools/check-paths.mjs — Verifies that dist/ contains no absolute path references

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexHtmlPath = resolve(process.cwd(), 'dist/index.html');

if (!existsSync(indexHtmlPath)) {
  console.error('❌ dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

const content = readFileSync(indexHtmlPath, 'utf8');
const absoluteMatches = content.match(/(?:src|href)=["']\/(?!\/)[^"']*["']/g);

if (absoluteMatches && absoluteMatches.length > 0) {
  console.error('❌ Found absolute paths in dist/index.html:');
  for (const match of absoluteMatches) {
    console.error(`   - ${match}`);
  }
  console.error('\nSnapchat requires all paths to be relative (e.g. "./assets/..."). Ensure "base: \'./\'" is set in vite.config.js.');
  process.exit(1);
} else {
  console.log('✅ All script, stylesheet, and asset paths in dist/index.html are relative!');
}
