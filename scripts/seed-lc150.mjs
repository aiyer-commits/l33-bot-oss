import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { put } from '@vercel/blob';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) throw new Error('DATABASE_URL missing');

const problems = JSON.parse(readFileSync(new URL('../data/lc150.json', import.meta.url), 'utf8'));

function makeTestCases(problem) {
  return {
    problemId: problem.id,
    title: problem.title,
    category: problem.category,
    generatedAt: new Date().toISOString(),
    testCases: [
      {
        name: 'baseline',
        type: 'functional',
        description: `Basic representative case for ${problem.title}.`,
      },
      {
        name: 'edge_min',
        type: 'edge',
        description: `Minimum-size input edge case for ${problem.title}.`,
      },
      {
        name: 'edge_extreme',
        type: 'edge',
        description: `Boundary/extreme values case for ${problem.title} (complexity + correctness).`,
      },
    ],
  };
}

function csvCell(value) {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'l33tsp33k-seed-'));
const csvPath = join(tmpRoot, 'lc150.csv');
const sqlPath = join(tmpRoot, 'seed.sql');

const lines = [
  [
    'id',
    'title',
    'slug',
    'difficulty',
    'category',
    'statement',
    'source',
    'tags_json',
    'semantic_keywords_json',
    'retrieval_meta_json',
    'test_cases_blob_url',
  ].join(','),
];

for (const p of problems) {
  let testCasesBlobUrl = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const obj = makeTestCases(p);
    const blob = await put(`test-cases/lc150/${String(p.id).padStart(3, '0')}-${p.slug}.json`, JSON.stringify(obj, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      allowOverwrite: true,
    });
    testCasesBlobUrl = blob.url;
  }

  lines.push(
    [
      csvCell(p.id),
      csvCell(p.title),
      csvCell(p.slug),
      csvCell(p.difficulty),
      csvCell(p.category),
      csvCell(p.statement),
      csvCell(p.source ?? ''),
      csvCell(JSON.stringify(p.tags ?? [])),
      csvCell(JSON.stringify(p.semanticKeywords ?? [])),
      csvCell(JSON.stringify(p.retrievalMeta ?? {})),
      csvCell(testCasesBlobUrl ?? ''),
    ].join(','),
  );
}

writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');

const copyPath = csvPath.replace(/'/g, "''");
const sql = [
  'BEGIN;',
  'CREATE TEMP TABLE tmp_lc150_import (',
  '  id INTEGER,',
  '  title TEXT,',
  '  slug TEXT,',
  '  difficulty TEXT,',
  '  category TEXT,',
  '  statement TEXT,',
  '  source TEXT,',
  '  tags_json JSONB,',
  '  semantic_keywords_json JSONB,',
  '  retrieval_meta_json JSONB,',
  '  test_cases_blob_url TEXT',
  ');',
  `\\copy tmp_lc150_import FROM '${copyPath}' WITH (FORMAT csv, HEADER true);`,
  'INSERT INTO problems (',
  '  id, title, slug, difficulty, category, statement, source, tags, semantic_keywords, retrieval_meta, test_cases_blob_url',
  ')',
  'SELECT',
  '  t.id,',
  '  t.title,',
  '  t.slug,',
  '  t.difficulty,',
  '  t.category,',
  '  t.statement,',
  "  NULLIF(t.source, ''),",
  "  COALESCE((SELECT array_agg(v) FROM jsonb_array_elements_text(t.tags_json) AS e(v)), '{}'::text[]),",
  "  COALESCE((SELECT array_agg(v) FROM jsonb_array_elements_text(t.semantic_keywords_json) AS e(v)), '{}'::text[]),",
  "  COALESCE(t.retrieval_meta_json, '{}'::jsonb),",
  "  NULLIF(t.test_cases_blob_url, '' )",
  'FROM tmp_lc150_import t',
  'ON CONFLICT (id) DO UPDATE SET',
  '  title = EXCLUDED.title,',
  '  slug = EXCLUDED.slug,',
  '  difficulty = EXCLUDED.difficulty,',
  '  category = EXCLUDED.category,',
  '  statement = EXCLUDED.statement,',
  '  source = EXCLUDED.source,',
  '  tags = EXCLUDED.tags,',
  '  semantic_keywords = EXCLUDED.semantic_keywords,',
  '  retrieval_meta = EXCLUDED.retrieval_meta,',
  '  test_cases_blob_url = COALESCE(EXCLUDED.test_cases_blob_url, problems.test_cases_blob_url);',
  'COMMIT;',
].join('\n');

writeFileSync(sqlPath, sql, 'utf8');

try {
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    stdio: 'inherit',
  });
  console.log(`Seeded ${problems.length} problems via psql`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
