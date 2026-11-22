/**
 * Stages the desktop app: bundles the server into one file and copies the web build,
 * migrations and Electron shell into build/app (what electron-builder packages).
 *   node scripts/stage-installer.mjs           release build (needs packaging/license-public-key.txt)
 *   node scripts/stage-installer.mjs --open    test build with no license check
 */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';

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

// Release: the vendor public key is compiled into the bundle (no loose key file to delete).
const releaseKey = open ? undefined : readFileSync(keyFile, 'utf8').trim();
if (!open && !releaseKey) {
  console.error(`${keyFile} is empty.`);
  process.exit(1);
}
const serverFile = `${out}/server/server.mjs`;
await build({
  entryPoints: ['server/index.ts'],
  outfile: serverFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  define: open ? {} : { __ORQIVA_RELEASE_KEY__: JSON.stringify(releaseKey) },
  logLevel: 'warning',
});

// Release builds are also obfuscated (light settings: they must stay fast and not break the server).
const obfuscate = (code) =>
  JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayWrappersCount: 1,
    renameGlobals: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    sourceType: 'module',
  }).getObfuscatedCode();
if (!open) writeFileSync(serverFile, obfuscate(readFileSync(serverFile, 'utf8')));
const serverHash = createHash('sha256').update(readFileSync(serverFile)).digest('hex');

cpSync('dist', `${out}/dist`, { recursive: true });
cpSync('database/migrations', `${out}/database/migrations`, { recursive: true });
// The shell pins the exact server bundle it was built with and refuses to start a modified one.
let shell = readFileSync('electron/main.cjs', 'utf8').replace(
  '__ORQIVA_SERVER_SHA256__',
  open ? '' : serverHash,
);
shell = shell.replace('__ORQIVA_RELEASE__', open ? 'false' : 'true');
if (!open) {
  const o = JavaScriptObfuscator.obfuscate(shell, {
    compact: true,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    renameGlobals: false,
    sourceType: 'script',
  });
  shell = o.getObfuscatedCode();
}
writeFileSync(`${out}/main.cjs`, shell);

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
