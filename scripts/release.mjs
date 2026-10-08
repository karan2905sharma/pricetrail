// Usage: npm run release -- 1.3.0
// Bumps the version in extension/manifest.json and package.json, commits and tags vX.Y.Z.
// Then `git push --follow-tags` starts the Release workflow (GitHub Release + Chrome Web Store).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').replace(/^v/, '');
const fail = (m) => { console.error(m); process.exit(1); };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

if (!/^\d+\.\d+\.\d+$/.test(next)) fail('Usage: npm run release -- <major.minor.patch>, e.g. 1.3.0');
const mPath = path.join(root, 'extension', 'manifest.json');
const pPath = path.join(root, 'package.json');
const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
const cur = manifest.version.split('.').map(Number);
const nxt = next.split('.').map(Number);
const newer = nxt[0] !== cur[0] ? nxt[0] > cur[0] : nxt[1] !== cur[1] ? nxt[1] > cur[1] : nxt[2] > cur[2];
if (!newer) fail(`${next} must be newer than the current version ${manifest.version}`);
if (git('status', '--porcelain')) fail('Commit or stash your changes first.');

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## v${next}`)) console.warn(`Note: CHANGELOG.md has no "## v${next}" section — the release will use auto-generated notes.`);

manifest.version = next;
fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + '\n');
const pkg = JSON.parse(fs.readFileSync(pPath, 'utf8'));
pkg.version = next;
fs.writeFileSync(pPath, JSON.stringify(pkg, null, 2) + '\n');

git('add', mPath, pPath);
git('commit', '-m', `Release v${next}`);
git('tag', '-a', `v${next}`, '-m', `PriceTrail v${next}`);
console.log(`Tagged v${next}. Publish it with:\n\n  git push --follow-tags\n`);
