import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { neon } from '@neondatabase/serverless';

const repoRoot = process.env.DOOCS_REPO;
if (!repoRoot) throw new Error('DOOCS_REPO is required and must point to a local clone of github.com/doocs/leetcode');
const solutionRoot = join(repoRoot, 'solution');
if (!existsSync(solutionRoot)) throw new Error(`DOOCS_REPO does not contain a solution/ directory: ${solutionRoot}`);

const lc150 = JSON.parse(readFileSync(new URL('../data/lc150.json', import.meta.url), 'utf8'));
const lc75 = JSON.parse(readFileSync(new URL('../data/leetcode75.json', import.meta.url), 'utf8'));
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && ent.name === 'README_EN.md') out.push(full);
  }
  return out;
}

function parseFrontMatter(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return {};
  const block = fm[1];
  const out = {};
  const diff = block.match(/^difficulty:\s*(.+)$/m);
  if (diff) out.difficulty = diff[1].trim();
  const tagsBlock = block.match(/^tags:\n([\s\S]*?)(?:\n\w|$)/m);
  if (tagsBlock) {
    out.tags = Array.from(tagsBlock[1].matchAll(/^\s*-\s+(.+)$/gm)).map((m) => m[1].trim());
  } else {
    out.tags = [];
  }
  return out;
}

function parseProblem(md, path) {
  const dirName = basename(join(path, '..'));
  const idMatch = dirName.match(/^(\d+)\./);
  if (!idMatch) return null;
  const id = Number(idMatch[1]);
  if (!Number.isFinite(id) || id <= 0) return null;

  const heading = md.match(/^#\s*\[(\d+)\.\s*(.+?)\]\((https:\/\/leetcode\.com\/problems\/([^\/\)]+)\/?[^\)]*)\)/m);
  if (!heading) return null;

  const title = heading[2].trim();
  const source = heading[3].trim();
  const slug = heading[4].trim().toLowerCase();

  const fm = parseFrontMatter(md);
  const difficulty = (fm.difficulty || 'Medium').replace(/\s+/g, ' ').trim();
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  const descMatch = md.match(/<!--\s*description:start\s*-->([\s\S]*?)<!--\s*description:end\s*-->/i);
  const statement = descMatch ? descMatch[1].trim() : '';
  if (!statement) return null;

  const category = tags[0] || 'General';

  return {
    id,
    title,
    difficulty,
    category,
    source,
    slug,
    statement,
    tags: tags.map((t) => t.toLowerCase()),
    semanticKeywords: [category, difficulty, ...tags].filter(Boolean).map((x) => String(x).toLowerCase()),
    retrievalMeta: {
      topicPrimary: category,
      difficulty,
      tags,
      source: 'doocs',
      sourceRepo: 'https://github.com/doocs/leetcode',
      sourceFile: path.replace(repoRoot + '/', ''),
      leetcodeUrl: source,
    },
    sourceRepo: 'https://github.com/doocs/leetcode',
    sourceFile: path.replace(repoRoot + '/', ''),
  };
}

function slugFrom75(item) {
  const m = String(item.leetcodeUrl || '').match(/leetcode\.com\/problems\/([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

const paths = walk(solutionRoot);
const parsed = [];
const seen = new Set();
for (const p of paths) {
  const md = readFileSync(p, 'utf8');
  const row = parseProblem(md, p);
  if (!row) continue;
  if (seen.has(row.id)) continue;
  seen.add(row.id);
  parsed.push(row);
}
parsed.sort((a, b) => a.id - b.id);

const existingSlugToId = new Map();
const usedIds = new Set();
if (dbUrl) {
  const sql = neon(dbUrl);
  const rows = await sql`SELECT id, slug FROM problems`;
  for (const row of rows) {
    const id = Number(row.id);
    const slug = String(row.slug || '').toLowerCase();
    if (!Number.isFinite(id) || !slug) continue;
    existingSlugToId.set(slug, id);
    usedIds.add(id);
  }
}

let maxId = usedIds.size > 0 ? Math.max(...usedIds) : (parsed.length > 0 ? parsed[parsed.length - 1].id : 0);
for (const row of parsed) {
  const existingId = existingSlugToId.get(row.slug);
  if (existingId) {
    row.id = existingId;
    continue;
  }
  if (usedIds.has(row.id)) {
    maxId += 1;
    row.id = maxId;
  }
  usedIds.add(row.id);
}

const idBySlug = new Map(parsed.map((p) => [p.slug, p.id]));

function ensureProblemForSlug(slug, fallback) {
  const key = String(slug || '').toLowerCase();
  if (!key) return null;
  const existing = idBySlug.get(key) ?? existingSlugToId.get(key);
  if (existing) return existing;
  maxId += 1;
  const row = {
    id: maxId,
    title: fallback.title || key,
    difficulty: fallback.difficulty || 'Medium',
    category: fallback.category || 'General',
    source: fallback.source || `https://leetcode.com/problems/${key}/`,
    slug: key,
    statement: fallback.statement || '',
    tags: Array.isArray(fallback.tags) ? fallback.tags : [],
    semanticKeywords: Array.isArray(fallback.semanticKeywords) ? fallback.semanticKeywords : [fallback.category || 'general'],
    retrievalMeta: {
      topicPrimary: fallback.category || 'General',
      difficulty: fallback.difficulty || 'Medium',
      source: fallback.sourceType || 'fallback',
      leetcodeUrl: fallback.source || `https://leetcode.com/problems/${key}/`,
      sourceRepo: fallback.sourceRepo || null,
      sourceFile: fallback.sourceFile || null,
    },
    sourceRepo: fallback.sourceRepo || null,
    sourceFile: fallback.sourceFile || null,
  };
  parsed.push(row);
  idBySlug.set(key, row.id);
  return row.id;
}

const l150Ids = lc150
  .map((p) =>
    ensureProblemForSlug(String(p.slug || '').toLowerCase(), {
      title: p.title,
      difficulty: p.difficulty,
      category: p.category,
      statement: p.statement,
      source: p.source || (p.slug ? `https://leetcode.com/problems/${p.slug}/` : null),
      tags: p.tags || [],
      semanticKeywords: p.semanticKeywords || [],
      sourceType: 'lc150-fallback',
      sourceRepo: p.sourceRepo || null,
      sourceFile: p.sourceFile || null,
    }),
  )
  .filter((id) => Number.isFinite(id));
const l75Ids = lc75
  .map((p) =>
    ensureProblemForSlug(slugFrom75(p), {
      title: p.title,
      difficulty: p.difficulty,
      category: p.category,
      statement: p.statement,
      source: p.leetcodeUrl || null,
      tags: [String(p.category || '').toLowerCase(), 'l75'],
      semanticKeywords: [String(p.category || '').toLowerCase(), String(p.difficulty || '').toLowerCase(), 'l75'],
      sourceType: 'lc75-fallback',
      sourceRepo: p.sourceRepo || null,
      sourceFile: p.sourceFile || null,
    }),
  )
  .filter((id) => Number.isFinite(id));

const l33SeedSlugs = [
  'merge-strings-alternately','greatest-common-divisor-of-strings','kids-with-the-greatest-number-of-candies','can-place-flowers','reverse-vowels-of-a-string',
  'two-sum-ii-input-array-is-sorted','container-with-most-water','move-zeroes','is-subsequence','string-compression',
  'maximum-average-subarray-i','max-consecutive-ones-iii','find-pivot-index','find-the-highest-altitude','find-the-difference-of-two-arrays',
  'determine-if-two-strings-are-close','unique-number-of-occurrences','equal-row-and-column-pairs','removing-stars-from-a-string','asteroid-collision',
  'decode-string','reverse-linked-list','maximum-depth-of-binary-tree','leaf-similar-trees','count-good-nodes-in-binary-tree',
  'number-of-provinces','rotting-oranges','find-peak-element','search-in-a-binary-search-tree','combination-sum-iii',
  'n-th-tribonacci-number','house-robber','longest-common-subsequence'
];
const l33Ids = l33SeedSlugs.map((slug) => idBySlug.get(slug)).filter((id) => Number.isFinite(id));

const curricula = {
  l33: { key: 'l33', name: 'l33', description: 'Free curated 33-problem interview starter path.', isPremium: false, problemIds: l33Ids },
  l75: { key: 'l75', name: 'l75', description: 'Core 75-problem interview curriculum.', isPremium: true, problemIds: l75Ids },
  l150: { key: 'l150', name: 'l150', description: 'Expanded 150-problem interview curriculum.', isPremium: true, problemIds: l150Ids },
  lall: { key: 'lall', name: 'lall', description: 'All available problems in the l33 catalog.', isPremium: true, problemIds: parsed.map((p) => p.id) },
};

const uniq = (arr) => Array.from(new Set(arr));
curricula.l33.problemIds = uniq(curricula.l33.problemIds);
curricula.l75.problemIds = uniq(curricula.l75.problemIds);
curricula.l150.problemIds = uniq(curricula.l150.problemIds);
parsed.sort((a, b) => a.id - b.id);

if (curricula.l33.problemIds.length !== 33) throw new Error(`Expected 33 ids for l33, got ${curricula.l33.problemIds.length}`);
if (curricula.l75.problemIds.length !== 75) throw new Error(`Expected 75 exact l75 ids, got ${curricula.l75.problemIds.length}`);
if (curricula.l150.problemIds.length !== 150) throw new Error(`Expected 150 exact l150 ids, got ${curricula.l150.problemIds.length}`);

writeFileSync(new URL('../data/catalog.json', import.meta.url), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
writeFileSync(new URL('../data/curriculums.json', import.meta.url), `${JSON.stringify(curricula, null, 2)}\n`, 'utf8');

console.log(`catalog: ${parsed.length} problems`);
console.log(`l33: ${curricula.l33.problemIds.length}, l75: ${curricula.l75.problemIds.length}, l150: ${curricula.l150.problemIds.length}, lall: ${curricula.lall.problemIds.length}`);
