#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = process.argv[2] || '.env.local';
const envPath = resolve(process.cwd(), envFile);

const required = ['DATABASE_URL', 'BASE_URL', 'NEXT_PUBLIC_APP_URL'];

const optional = [
  'POSTGRES_URL',
  'BLOB_READ_WRITE_TOKEN',
  'DOOCS_REPO',
  'LLM_PROVIDER',
  'OPENAI_MODEL',
  'ANTHROPIC_MODEL',
  'GOOGLE_MODEL',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
];

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf8');
  const entries = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    entries[key] = value;
  }
  return entries;
}

const fileEnv = parseEnvFile(envPath);
const merged = { ...fileEnv, ...process.env };

const provider = String(merged.LLM_PROVIDER || 'openai').trim().toLowerCase();
if (provider === 'openai') required.push('OPENAI_API_KEY');
else if (provider === 'anthropic') required.push('ANTHROPIC_API_KEY');
else if (provider === 'google') required.push('GOOGLE_API_KEY');
else {
  console.error(`Unsupported LLM_PROVIDER: ${provider}`);
  process.exit(1);
}

const missing = required.filter((key) => !merged[key] || String(merged[key]).trim().length === 0);

if (missing.length > 0) {
  console.error(`Environment check failed for ${envFile}.`);
  console.error(`Missing required variables (${missing.length}):`);
  for (const key of missing) console.error(`- ${key}`);
  process.exit(1);
}

console.log(`Environment check passed for ${envFile}.`);
console.log(`Validated required vars: ${required.length}`);
console.log(`Optional vars recognized: ${optional.length}`);
