// Publish a new version on GitHub Releases; installed apps pick it up at their next start.
// Usage: node scripts/release.mjs 0.2.0 "What changed"
// Needs: gh (logged in), the signing key in ~/.tauri/claude-3d-office.key (never committed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [version, notes = ''] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage : node scripts/release.mjs 0.2.0 "notes"');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const conf = path.join(root, 'src-tauri', 'tauri.conf.json');
const c = JSON.parse(fs.readFileSync(conf, 'utf8'));
const m = /github\.com\/([^/]+\/[^/]+)\/releases/.exec(c.plugins.updater.endpoints[0]);
if (!m || m[1] === 'OWNER/REPO') throw new Error('Renseigne le dépôt GitHub dans tauri.conf.json (plugins.updater.endpoints)');
const repo = m[1];

// Bump versions (app + Cargo + npm) so the updater sees something newer.
c.version = version;
fs.writeFileSync(conf, JSON.stringify(c, null, 2) + '\n');
for (const f of [path.join(root, 'src-tauri', 'Cargo.toml')]) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
const pkg = path.join(root, 'package.json');
fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, 'utf8')), version }, null, 2) + '\n');

const keyFile = path.join(os.homedir(), '.tauri', 'claude-3d-office.key');
const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyFile, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
  PATH: `${path.join(os.homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH}` };
execFileSync('npx', ['tauri', 'build'], { cwd: root, env, stdio: 'inherit', shell: true });

const dir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const setup = fs.readdirSync(dir).find((f) => f.endsWith(`${version}_x64-setup.exe`));
const sig = fs.readFileSync(path.join(dir, setup + '.sig'), 'utf8');
const assetName = setup.replace(/ /g, '.'); // GitHub replaces spaces in asset names with dots
const latest = {
  version, notes, pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: sig, url: `https://github.com/${repo}/releases/download/v${version}/${assetName}` } },
};
const latestFile = path.join(dir, 'latest.json');
fs.writeFileSync(latestFile, JSON.stringify(latest, null, 2));
execFileSync('gh', ['release', 'create', `v${version}`, '--repo', repo, '--title', `Claude 3D Office ${version}`, '--notes', notes || `Version ${version}`,
  `${path.join(dir, setup)}#${assetName}`, latestFile], { stdio: 'inherit' });
console.log(`Publié : https://github.com/${repo}/releases/tag/v${version}`);
