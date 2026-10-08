// Prints the CHANGELOG.md section for a version (used for GitHub release notes).
import fs from 'node:fs';
const v = (process.argv[2] || '').replace(/^v/, '');
const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const m = text.match(new RegExp(`^## v${v.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## v|$(?![\\s\\S]))`, 'm'));
if (m) process.stdout.write(m[1].trim() + '\n');
