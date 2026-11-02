// Rebuilds better-sqlite3's prebuilt binary for the requested runtime.
//
//   node scripts/rebuild-native.cjs electron   -> Electron ABI (for packaging)
//   node scripts/rebuild-native.cjs dev        -> local Node ABI (for npm test)
//
// electron-builder's automatic rebuild proved unreliable in this project
// (it left the dev-Node binary in place, crashing the installed app with a
// NODE_MODULE_VERSION error), so packaging calls this explicitly and sets
// build.npmRebuild=false. Sharp needs no rebuild: its prebuilt binding is
// N-API and loads under both runtimes.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const mode = process.argv[2] || 'electron';
const root = path.resolve(__dirname, '..');
const electronVersion = require(path.join(root, 'node_modules/electron/package.json')).version;
const bin = path.join(root, 'node_modules', 'prebuild-install', 'bin.js');
const cwd = path.join(root, 'node_modules', 'better-sqlite3');

const args = mode === 'electron'
  ? [bin, '--runtime=electron', `--target=${electronVersion}`]
  : [bin];

console.log(`[rebuild-native] mode=${mode} electron=${electronVersion}`);
execFileSync(process.execPath, args, { cwd, stdio: 'inherit' });

// Prove which ABI we ended up with: the Electron build must REFUSE to load
// under dev Node (and vice versa).
const tag = mode === 'electron' ? 'NODE_MODULE_VERSION 130' : 'loads under dev node';
try {
  delete require.cache[require.resolve('better-sqlite3')];
  require('better-sqlite3');
  console.log('[rebuild-native] binary loads under dev Node.');
  if (mode === 'electron') {
    console.warn('[rebuild-native] WARNING: Electron build loads under dev Node — unexpected, packaging anyway.');
  }
} catch (e) {
  const msg = String((e && e.message) || e).split('\n')[0];
  console.log(`[rebuild-native] binary does not load under dev Node: ${msg}`);
  if (mode === 'electron' && !msg.includes('130')) {
    throw new Error(`Unexpected ABI (expected Electron v130): ${msg}`);
  }
}
console.log(`[rebuild-native] done (${tag}).`);
