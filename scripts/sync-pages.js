import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const builtIndex = new URL('../dist/index.html', import.meta.url);
const builtAssets = new URL('../dist/pages-assets/', import.meta.url);
const publishedAssets = new URL('../pages-assets/', import.meta.url);

if (!existsSync(builtIndex) || !existsSync(builtAssets)) {
  throw new Error('Run npm run build before updating GitHub Pages files.');
}

rmSync(publishedAssets, { recursive: true, force: true });
cpSync(builtAssets, publishedAssets, { recursive: true });

const licenses = new URL('licenses/', publishedAssets);
mkdirSync(licenses);
for (const packageName of ['three', '@fontsource/archivo-black', '@fontsource/dm-sans', '@fontsource/ibm-plex-mono']) {
  const filename = packageName.split('/').at(-1) + '.txt';
  copyFileSync(new URL(`../node_modules/${packageName}/LICENSE`, import.meta.url), new URL(filename, licenses));
}

copyFileSync(builtIndex, new URL('../index.html', import.meta.url));
writeFileSync(new URL('../.nojekyll', import.meta.url), '');
