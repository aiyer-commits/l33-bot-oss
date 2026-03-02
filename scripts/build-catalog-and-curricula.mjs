import { readFileSync, writeFileSync } from 'node:fs';

const lc150 = JSON.parse(readFileSync(new URL('../data/lc150.json', import.meta.url), 'utf8'));
const lc75 = JSON.parse(readFileSync(new URL('../data/leetcode75.json', import.meta.url), 'utf8'));

function slugFrom75(item) {
  const m = String(item.leetcodeUrl || '').match(/leetcode\.com\/problems\/([^/]+)/i);
  return m ? m[1].toLowerCase() : item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const bySlug = new Map();
for (const p of lc150) {
  bySlug.set(String(p.slug).toLowerCase(), { ...p });
}

let nextId = Math.max(...lc150.map((p) => Number(p.id) || 0)) + 1;
for (const p of lc75) {
  const slug = slugFrom75(p);
  if (bySlug.has(slug)) continue;
  bySlug.set(slug, {
    id: nextId++,
    title: p.title,
    difficulty: p.difficulty,
    category: p.category,
    source: p.leetcodeUrl || p.sourceRepo || null,
    slug,
    statement: p.statement,
    tags: [String(p.category || '').toLowerCase(), 'l75'].filter(Boolean),
    semanticKeywords: [String(p.category || '').toLowerCase(), String(p.difficulty || '').toLowerCase(), 'l75'].filter(Boolean),
    retrievalMeta: {
      topicPrimary: p.category,
      difficulty: p.difficulty,
      source: 'l75',
      leetcodeUrl: p.leetcodeUrl || null,
      sourceRepo: p.sourceRepo || null,
    },
    sourceRepo: p.sourceRepo,
    sourceFile: p.sourceFile,
  });
}

const catalog = Array.from(bySlug.values()).sort((a, b) => a.id - b.id);
const idBySlug = new Map(catalog.map((p) => [String(p.slug).toLowerCase(), p.id]));

const l150Ids = lc150.map((p) => p.id).filter((id) => Number.isFinite(id));
const l75Ids = lc75.map((p) => idBySlug.get(slugFrom75(p))).filter((id) => Number.isFinite(id));

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
  lall: { key: 'lall', name: 'lall', description: 'All available problems in the l33 catalog.', isPremium: true, problemIds: catalog.map((p) => p.id) },
};

if (curricula.l75.problemIds.length !== 75) {
  throw new Error(`Expected 75 exact l75 ids, got ${curricula.l75.problemIds.length}`);
}
if (curricula.l150.problemIds.length !== 150) {
  throw new Error(`Expected 150 exact l150 ids, got ${curricula.l150.problemIds.length}`);
}
if (curricula.l33.problemIds.length !== 33) {
  throw new Error(`Expected 33 ids for l33, got ${curricula.l33.problemIds.length}`);
}

writeFileSync(new URL('../data/catalog.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
writeFileSync(new URL('../data/curriculums.json', import.meta.url), `${JSON.stringify(curricula, null, 2)}\n`, 'utf8');

console.log(`catalog: ${catalog.length} problems`);
console.log(`l33: ${curricula.l33.problemIds.length}, l75: ${curricula.l75.problemIds.length}, l150: ${curricula.l150.problemIds.length}, lall: ${curricula.lall.problemIds.length}`);
