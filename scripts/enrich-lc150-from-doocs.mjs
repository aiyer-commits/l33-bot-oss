import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.env.DOOCS_REPO;
if (!repoRoot) throw new Error('DOOCS_REPO is required');

const inputPath = new URL('../data/lc150.json', import.meta.url);
const rows = JSON.parse(readFileSync(inputPath, 'utf8'));

const readmes = execSync(`find ${repoRoot}/solution -type f -name README_EN.md`, { encoding: 'utf8' })
  .split('\n')
  .map((x) => x.trim())
  .filter(Boolean);

const byId = new Map();
const bySlug = new Map();
for (const file of readmes) {
  const problemDir = basename(dirname(file));
  const m = problemDir.match(/^(\d+)\./);
  if (!m) continue;
  const id = Number(m[1]);
  if (!Number.isFinite(id)) continue;
  if (!byId.has(id)) byId.set(id, file);

  try {
    const head = readFileSync(file, 'utf8').slice(0, 1200);
    const slugMatch = head.match(/leetcode\.com\/problems\/([^)\s\/]+)/i);
    if (slugMatch && !bySlug.has(slugMatch[1])) {
      bySlug.set(slugMatch[1], file);
    }
  } catch {
    // ignore
  }
}

function extractDescription(md) {
  const normalized = md.replace(/\r/g, '');
  const markerMatch = normalized.match(/<!--\s*description:start\s*-->([\s\S]*?)<!--\s*description:end\s*-->/i);
  const sectionMatch = normalized.match(/^##\s+Description\s*\n([\s\S]*?)(\n##\s+|$)/m);
  const block = markerMatch ? markerMatch[1] : sectionMatch ? sectionMatch[1] : normalized;

  return block
    .replace(/\n<details>[\s\S]*?<\/details>\n?/g, '\n')
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugFromSource(source) {
  if (!source || typeof source !== 'string') return null;
  const m = source.match(/leetcode\.com\/problems\/([^\/\s]+)/i);
  return m ? m[1] : null;
}

let ok = 0;
let fail = 0;

for (const row of rows) {
  const slug = slugFromSource(row.source) ?? row.slug;
  const file = (slug ? bySlug.get(slug) : undefined) ?? byId.get(row.id);
  if (!file) {
    fail += 1;
    continue;
  }

  const md = readFileSync(file, 'utf8');
  const statement = extractDescription(md);
  if (!statement || statement.length < 80) {
    fail += 1;
    continue;
  }

  row.statement = statement;
  row.sourceRepo = 'https://github.com/doocs/leetcode';
  row.sourceFile = file.replace(`${repoRoot}/`, '');
  ok += 1;
}

writeFileSync(inputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
console.log(`Updated ${ok}, missing ${fail}`);
