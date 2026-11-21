/**
 * Stages the desktop app: bundles the server into one file and copies the web build,
 * migrations and Electron shell into build/app (what electron-builder packages).
 *   node scripts/stage-installer.mjs           release build (needs packaging/license-public-key.txt)
 *   node scripts/stage-installer.mjs --open    test build with no license check
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const open = process.argv.includes('--open');
const keyFile = 'packaging/license-public-key.txt';
if (!open && !existsSync(keyFile)) {
  console.error(
    `Missing ${keyFile}. Create your license key pair first (npm run license -- keygen vendor.pem)\n` +
      'and save the printed public key in that file. Use --open only for a test build.',
  );
  process.exit(1);
}
if (!existsSync('dist/index.html')) {
  console.error('Run "npm run build" first (web build missing).');
  process.exit(1);
}
const out = 'build/app';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/server`, { recursive: true });

await build({
  entryPoints: ['server/index.ts'],
  outfile: `${out}/server/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

cpSync('dist', `${out}/dist`, { recursive: true });
cpSync('database/migrations', `${out}/database/migrations`, { recursive: true });
cpSync('electron/main.cjs', `${out}/main.cjs`);
if (!open) cpSync(keyFile, `${out}/license-public-key.txt`);

const root = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: 'orqiva',
      productName: 'Orqiva',
      version: root.version,
      description: 'Orqiva ERP',
      author: 'Orqiva',
      main: 'main.cjs',
    },
    null,
    2,
  ),
);
console.log(`Staged ${open ? 'OPEN (test)' : 'licensed'} app in ${out}`);
