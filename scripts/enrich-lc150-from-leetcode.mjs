import { readFileSync, writeFileSync } from 'node:fs';

const INPUT = new URL('../data/lc150.json', import.meta.url);

const QUERY = `query questionData($titleSlug:String!){
  question(titleSlug:$titleSlug){
    questionId
    title
    titleSlug
    content
    difficulty
    topicTags{name slug}
  }
}`;

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html) {
  const withBlocks = html
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|pre)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`');
  const stripped = withBlocks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugFromSource(source) {
  if (!source || typeof source !== 'string') return null;
  const m = source.match(/leetcode\.com\/problems\/([^\/]+)/i);
  return m ? m[1] : null;
}

async function fetchQuestion(titleSlug) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
      referer: `https://leetcode.com/problems/${titleSlug}/`,
    },
    signal: controller.signal,
    body: JSON.stringify({ query: QUERY, variables: { titleSlug } }),
  });
  clearTimeout(timeout);

  const json = await response.json();
  return json?.data?.question ?? null;
}

const rows = JSON.parse(readFileSync(INPUT, 'utf8'));
let ok = 0;
let fail = 0;

for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  const slug = slugFromSource(row.source) ?? row.slug;
  if (!slug) {
    fail += 1;
    continue;
  }

  try {
    let q = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        q = await fetchQuestion(slug);
        if (q) break;
      } catch {
        if (attempt === 2) throw new Error('fetch failed');
      }
    }
    if (!q || !q.content) {
      fail += 1;
      continue;
    }

    const statement = htmlToText(q.content);
    const tagSlugs = Array.isArray(q.topicTags) ? q.topicTags.map((t) => t.slug).filter(Boolean) : [];
    const tagNames = Array.isArray(q.topicTags) ? q.topicTags.map((t) => t.name?.toLowerCase?.()).filter(Boolean) : [];

    row.slug = q.titleSlug || slug;
    row.title = q.title || row.title;
    row.difficulty = q.difficulty || row.difficulty;
    row.statement = statement;
    row.tags = Array.from(new Set([...(row.tags ?? []), ...tagSlugs]));
    row.semanticKeywords = Array.from(new Set([...(row.semanticKeywords ?? []), ...tagSlugs, ...tagNames]));

    if (row.retrievalMeta && typeof row.retrievalMeta === 'object') {
      row.retrievalMeta.leetcodeQuestionId = Number(q.questionId || 0) || undefined;
      row.retrievalMeta.leetcodeSlug = row.slug;
      row.retrievalMeta.leetcodeTags = tagSlugs;
    }

    ok += 1;
  } catch {
    fail += 1;
  }

  if ((i + 1) % 20 === 0) {
    console.log(`Processed ${i + 1}/${rows.length} (ok=${ok}, fail=${fail})`);
  }
}

writeFileSync(INPUT, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
console.log(`Done. Updated ${ok}, failed ${fail}`);
