import { writeFileSync } from 'node:fs';

const url = 'https://raw.githubusercontent.com/ChunhThanhDe/Leetcode-Top-Interview/main/README.md';
const text = await fetch(url).then((r) => r.text());

const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
const problems = [];
let category = 'General';
let match;

while ((match = rowRegex.exec(text)) !== null) {
  const row = match[1];
  const cat = row.match(/<strong>([^<]+)<\/strong>/);
  if (cat) {
    category = cat[1].trim();
    continue;
  }

  const tds = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  );
  if (tds.length < 3) continue;

  const id = Number(tds[0]);
  if (!Number.isFinite(id)) continue;

  const title = tds[1];
  const difficultyRaw = tds[2];
  if (!title || !/^(Easy|Medium|Hard)$/i.test(difficultyRaw)) continue;

  const hrefMatch = row.match(/<a href="([^"]+)"/);
  const difficulty = difficultyRaw[0].toUpperCase() + difficultyRaw.slice(1).toLowerCase();

  problems.push({
    id,
    title,
    difficulty,
    category,
    source: hrefMatch ? hrefMatch[1] : null,
  });
}

const dedup = [];
const seen = new Set();
for (const p of problems) {
  const key = `${p.id}:${p.title.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);
  dedup.push(p);
}

if (dedup.length < 150) throw new Error(`Parsed too few problems: ${dedup.length}`);

const patternsByCategory = {
  'Array / String': ['array', 'string', 'two-pointers', 'greedy'],
  'Two Pointers': ['two-pointers', 'in-place'],
  'Sliding Window': ['sliding-window', 'two-pointers'],
  Matrix: ['matrix', 'simulation'],
  Hashmap: ['hash-map', 'set'],
  Intervals: ['intervals', 'sorting', 'greedy'],
  Stack: ['stack', 'monotonic-stack'],
  'Linked List': ['linked-list', 'two-pointers'],
  'Binary Tree General': ['tree', 'dfs', 'bfs'],
  'Binary Tree BFS': ['tree', 'bfs', 'queue'],
  'Binary Search Tree': ['bst', 'tree', 'dfs'],
  'Graph General': ['graph', 'dfs', 'bfs'],
  'Graph BFS': ['graph', 'bfs', 'queue'],
  Trie: ['trie', 'prefix'],
  Backtracking: ['backtracking', 'recursion'],
  'Divide & Conquer': ['divide-and-conquer', 'recursion'],
  "Kadane's Algorithm": ['dp', 'kadane', 'array'],
  'Binary Search': ['binary-search', 'search-space'],
  Heap: ['heap', 'priority-queue'],
  'Bit Manipulation': ['bit-manipulation'],
  Math: ['math'],
  '1D DP': ['dp', 'dynamic-programming'],
  'Multidimensional DP': ['dp', 'dynamic-programming', '2d-dp'],
};

const out = dedup
  .sort((a, b) => a.id - b.id)
  .slice(0, 150)
  .map((p) => {
    const slug = p.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const baseTags = patternsByCategory[p.category] || ['algorithms', 'interview'];
    const semanticKeywords = Array.from(
      new Set([
        ...baseTags,
        ...p.title
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((x) => x.length > 2),
        p.difficulty.toLowerCase(),
        p.category.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      ]),
    );

    return {
      ...p,
      slug,
      statement: `Practice ${p.title} (${p.difficulty}) from Top Interview 150 in category ${p.category}.`,
      tags: baseTags,
      semanticKeywords,
      retrievalMeta: {
        topicPrimary: p.category,
        difficulty: p.difficulty,
        patterns: baseTags,
        keywords: semanticKeywords,
      },
    };
  });

writeFileSync(new URL('../data/lc150.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`Generated data/lc150.json with ${out.length} rows`);
