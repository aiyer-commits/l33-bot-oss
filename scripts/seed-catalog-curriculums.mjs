import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) throw new Error('DATABASE_URL missing');

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const curriculums = JSON.parse(readFileSync(new URL('../data/curriculums.json', import.meta.url), 'utf8'));

function csvCell(value) {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'l33-catalog-'));
const problemsCsvPath = join(tmpRoot, 'catalog.csv');
const curriculaCsvPath = join(tmpRoot, 'curricula.csv');
const curriculumProblemsCsvPath = join(tmpRoot, 'curriculum_problems.csv');
const sqlPath = join(tmpRoot, 'seed.sql');

const problemLines = [
  ['id', 'title', 'slug', 'difficulty', 'category', 'statement', 'source', 'tags_json', 'semantic_keywords_json', 'retrieval_meta_json'].join(','),
];

for (const p of catalog) {
  problemLines.push(
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
    ].join(','),
  );
}
writeFileSync(problemsCsvPath, `${problemLines.join('\n')}\n`, 'utf8');

const curriculumLines = [['key', 'name', 'description', 'is_premium', 'total_count'].join(',')];
for (const c of Object.values(curriculums)) {
  curriculumLines.push([csvCell(c.key), csvCell(c.name), csvCell(c.description), csvCell(c.isPremium), csvCell(c.problemIds.length)].join(','));
}
writeFileSync(curriculaCsvPath, `${curriculumLines.join('\n')}\n`, 'utf8');

const cpLines = [['curriculum_key', 'problem_id', 'position'].join(',')];
for (const c of Object.values(curriculums)) {
  c.problemIds.forEach((problemId, index) => {
    cpLines.push([csvCell(c.key), csvCell(problemId), csvCell(index + 1)].join(','));
  });
}
writeFileSync(curriculumProblemsCsvPath, `${cpLines.join('\n')}\n`, 'utf8');

const esc = (value) => value.replace(/'/g, "''");
const sql = [
  'BEGIN;',
  'CREATE TEMP TABLE tmp_catalog_import (id INTEGER, title TEXT, slug TEXT, difficulty TEXT, category TEXT, statement TEXT, source TEXT, tags_json JSONB, semantic_keywords_json JSONB, retrieval_meta_json JSONB);',
  `\\copy tmp_catalog_import FROM '${esc(problemsCsvPath)}' WITH (FORMAT csv, HEADER true);`,
  'INSERT INTO problems (id, title, slug, difficulty, category, statement, source, tags, semantic_keywords, retrieval_meta)',
  'SELECT',
  "  t.id, t.title, t.slug, t.difficulty, t.category, t.statement, NULLIF(t.source, ''),",
  "  COALESCE((SELECT array_agg(v) FROM jsonb_array_elements_text(t.tags_json) AS e(v)), '{}'::text[]),",
  "  COALESCE((SELECT array_agg(v) FROM jsonb_array_elements_text(t.semantic_keywords_json) AS e(v)), '{}'::text[]),",
  "  COALESCE(t.retrieval_meta_json, '{}'::jsonb)",
  'FROM tmp_catalog_import t',
  'ON CONFLICT (id) DO UPDATE SET',
  '  title = EXCLUDED.title,',
  '  slug = EXCLUDED.slug,',
  '  difficulty = EXCLUDED.difficulty,',
  '  category = EXCLUDED.category,',
  '  statement = EXCLUDED.statement,',
  '  source = EXCLUDED.source,',
  '  tags = EXCLUDED.tags,',
  '  semantic_keywords = EXCLUDED.semantic_keywords,',
  '  retrieval_meta = EXCLUDED.retrieval_meta;',
  '',
  'CREATE TEMP TABLE tmp_curricula_import (key TEXT, name TEXT, description TEXT, is_premium BOOLEAN, total_count INTEGER);',
  `\\copy tmp_curricula_import FROM '${esc(curriculaCsvPath)}' WITH (FORMAT csv, HEADER true);`,
  'INSERT INTO curriculums (key, name, description, is_premium, total_count)',
  'SELECT key, name, description, is_premium, total_count FROM tmp_curricula_import',
  'ON CONFLICT (key) DO UPDATE SET',
  '  name = EXCLUDED.name,',
  '  description = EXCLUDED.description,',
  '  is_premium = EXCLUDED.is_premium,',
  '  total_count = EXCLUDED.total_count;',
  '',
  'CREATE TEMP TABLE tmp_curriculum_problems_import (curriculum_key TEXT, problem_id INTEGER, position INTEGER);',
  `\\copy tmp_curriculum_problems_import FROM '${esc(curriculumProblemsCsvPath)}' WITH (FORMAT csv, HEADER true);`,
  'DELETE FROM curriculum_problems;',
  'INSERT INTO curriculum_problems (curriculum_key, problem_id, position)',
  'SELECT curriculum_key, problem_id, position',
  'FROM tmp_curriculum_problems_import',
  'ORDER BY curriculum_key, position;',
  '',
  "UPDATE learner_profiles lp",
  "SET active_curriculum_key = 'l33'",
  "WHERE NOT EXISTS (SELECT 1 FROM curriculums c WHERE c.key = lp.active_curriculum_key);",
  '',
  "UPDATE learner_profiles lp",
  'SET active_problem_id = cp.problem_id',
  'FROM curriculum_problems cp',
  'WHERE cp.curriculum_key = lp.active_curriculum_key',
  '  AND cp.position = 1',
  '  AND NOT EXISTS (',
  '    SELECT 1 FROM curriculum_problems cpx',
  '    WHERE cpx.curriculum_key = lp.active_curriculum_key',
  '      AND cpx.problem_id = lp.active_problem_id',
  '  );',
  'COMMIT;',
].join('\n');

writeFileSync(sqlPath, sql, 'utf8');

try {
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], { stdio: 'inherit' });
  console.log(`Seeded catalog (${catalog.length}) + curriculums (${Object.keys(curriculums).length})`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
