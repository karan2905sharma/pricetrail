// Builds the release zips into dist/:
//   pricetrail-vX.Y.Z.zip            – for GitHub Releases ("Load unpacked"); keeps the manifest key so the
//                                      extension ID (and your saved price history) stays the same across updates
//   pricetrail-vX.Y.Z-webstore.zip   – for the Chrome Web Store, which doesn't accept a "key" in the manifest
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const v = manifest.version;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function zipDir(dir, out) {
  const zip = new AdmZip();
  zip.addLocalFolder(dir, '', (name) => !/(^|\/)\.DS_Store$/.test(name));
  zip.writeZip(out);
  return out;
}

const github = zipDir(src, path.join(dist, `pricetrail-v${v}.zip`));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pricetrail-webstore-'));
fs.cpSync(src, tmp, { recursive: true });
const m2 = { ...manifest };
delete m2.key;
fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(m2, null, 2) + '\n');
const store = zipDir(tmp, path.join(dist, `pricetrail-v${v}-webstore.zip`));
fs.rmSync(tmp, { recursive: true, force: true });

for (const f of [github, store]) console.log(`${path.relative(root, f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
