import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/web/app.ts'],
  bundle: true,
  outfile: 'dist/app.js',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
await build({
  entryPoints: ['src/web/visual.ts'],
  bundle: true,
  outfile: 'dist/visual.js',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
copyFileSync('src/web/visual.html', 'dist/visual.html');
copyFileSync('src/web/visual.css', 'dist/visual.css');
copyFileSync('src/web/index.html', 'dist/index.html');
copyFileSync('src/web/app.css', 'dist/app.css');
console.log('Browser build complete');
