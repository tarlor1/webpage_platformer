import { context, build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const entryPoints = ['src/content.ts', 'src/popup.ts', 'src/background.ts'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await Promise.all(['manifest.json', 'popup.html'].map(file => copyFile(file, `dist/${file}`)));
const options = {
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info'
};
if (watch) {
  const builder = await context(options);
  await builder.watch();
  console.log('Watching TypeScript. Restart watch after changing manifest or popup HTML.');
} else {
  await build(options);
}
