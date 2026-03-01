import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '@/lib/types';
import { getSql } from '@/lib/db/client';
import { INITIAL_FREE_CREDITS } from '@/lib/pricing';

export type LearnerKey = {
  userId?: string | null;
  anonId?: string | null;
  email?: string | null;
};

export type LearnerProfileRow = {
  learner_id: string;
  user_id: string | null;
  anon_id: string | null;
  email: string | null;
  active_problem_id: number;
};

export async function ensureLearnerProfile(key: LearnerKey): Promise<LearnerProfileRow> {
  const sql = getSql();

  if (!key.userId && !key.anonId) {
    throw new Error('Either userId or anonId is required');
  }

  const existing = (key.userId
    ? await sql`SELECT learner_id, user_id, anon_id, email, active_problem_id FROM learner_profiles WHERE user_id = ${key.userId} LIMIT 1`
    : await sql`SELECT learner_id, user_id, anon_id, email, active_problem_id FROM learner_profiles WHERE anon_id = ${key.anonId ?? ''} LIMIT 1`) as LearnerProfileRow[];

  if (existing.length > 0) return existing[0];

  const learnerId = randomUUID();
  const anonId = key.userId ? null : key.anonId ?? randomUUID();

  const inserted = (await sql`
    INSERT INTO learner_profiles (learner_id, user_id, anon_id, email, active_problem_id)
    VALUES (${learnerId}, ${key.userId ?? null}, ${anonId}, ${key.email ?? null}, 1)
    RETURNING learner_id, user_id, anon_id, email, active_problem_id
  `) as LearnerProfileRow[];

  await sql`
    INSERT INTO problem_progress (learner_id, problem_id, status, confidence, attempts)
    SELECT ${learnerId}, p.id, 'unseen', 0, 0
    FROM problems p
    ON CONFLICT (learner_id, problem_id) DO NOTHING
  `;

  await sql`
    INSERT INTO credit_balances (learner_id, balance_femtodollars)
    VALUES (${learnerId}, ${INITIAL_FREE_CREDITS.toString()})
    ON CONFLICT (learner_id) DO NOTHING
  `;

  return inserted[0];
}

export async function getProblemById(problemId: number) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, title, slug, difficulty, category, statement, tags, semantic_keywords, retrieval_meta, test_cases_blob_url
    FROM problems
    WHERE id = ${problemId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listProblemsCompact() {
  const sql = getSql();
  return sql`
    SELECT id, title, difficulty, category
    FROM problems
    ORDER BY id ASC
  `;
}

export async function searchProblems(params: { query?: string; difficulty?: string; category?: string; limit?: number }) {
  const sql = getSql();
  const limit = Math.min(20, Math.max(1, params.limit ?? 8));
  const q = `%${(params.query ?? '').toLowerCase()}%`;
  const d = (params.difficulty ?? '').toLowerCase();
  const c = (params.category ?? '').toLowerCase();

  return sql`
    SELECT id, title, difficulty, category, tags
    FROM problems
    WHERE
      (${q} = '%%' OR lower(title) LIKE ${q} OR lower(category) LIKE ${q} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) LIKE ${q}))
      AND (${d} = '' OR lower(difficulty) = ${d})
      AND (${c} = '' OR lower(category) LIKE ${`%${c}%`})
    ORDER BY id ASC
    LIMIT ${limit}
  `;
}

export async function setActiveProblem(learnerId: string, problemId: number) {
  const sql = getSql();
  await sql`UPDATE learner_profiles SET active_problem_id = ${problemId} WHERE learner_id = ${learnerId}`;
}

export async function getProgressForProblem(learnerId: string, problemId: number) {
  const sql = getSql();
  const rows = await sql`
    SELECT learner_id, problem_id, status, confidence, attempts, last_assessment, last_code, model_state, mastered_at, last_practiced_at
    FROM problem_progress
    WHERE learner_id = ${learnerId} AND problem_id = ${problemId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function upsertProblemProgress(params: {
  learnerId: string;
  problemId: number;
  status: string;
  confidence: number;
  attemptsDelta: number;
  summaryNote: string;
  code: string;
  modelState: Record<string, unknown>;
  markMastered: boolean;
}) {
  const sql = getSql();
  await sql`
    INSERT INTO problem_progress (
      learner_id, problem_id, status, confidence, attempts, last_assessment, last_code, model_state, last_practiced_at, mastered_at
    )
    VALUES (
      ${params.learnerId},
      ${params.problemId},
      ${params.status},
      ${Math.max(0, Math.min(100, Math.round(params.confidence)))},
      ${Math.max(0, params.attemptsDelta)},
      ${params.summaryNote},
      ${params.code.slice(0, 2400)},
      ${JSON.stringify(params.modelState)},
      NOW(),
      ${params.markMastered ? new Date().toISOString() : null}
    )
    ON CONFLICT (learner_id, problem_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      confidence = EXCLUDED.confidence,
      attempts = problem_progress.attempts + EXCLUDED.attempts,
      last_assessment = EXCLUDED.last_assessment,
      last_code = EXCLUDED.last_code,
      model_state = EXCLUDED.model_state,
      last_practiced_at = NOW(),
      mastered_at = CASE WHEN ${params.markMastered} THEN NOW() ELSE problem_progress.mastered_at END
  `;
}

export async function countMastered(learnerId: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT COUNT(*)::int AS mastered
    FROM problem_progress
    WHERE learner_id = ${learnerId} AND status = 'mastered'
  `) as { mastered: number }[];
  return rows[0]?.mastered ?? 0;
}

export async function getOrCreateSession(learnerId: string, requestedSessionId?: string | null) {
  const sql = getSql();
  if (requestedSessionId) {
    const existing = (await sql`SELECT id FROM chat_sessions WHERE id = ${requestedSessionId} AND learner_id = ${learnerId} LIMIT 1`) as {
      id: string;
    }[];
    if (existing.length > 0) return existing[0].id;
  }

  const id = randomUUID();
  await sql`INSERT INTO chat_sessions (id, learner_id) VALUES (${id}, ${learnerId})`;
  return id;
}

export async function appendMessages(sessionId: string, messages: ChatMessage[]) {
  const sql = getSql();
  for (const msg of messages) {
    await sql`
      INSERT INTO chat_messages (session_id, role, kind, content)
      VALUES (${sessionId}, ${msg.role}, ${msg.kind}, ${msg.content})
    `;
  }
  await sql`UPDATE chat_sessions SET updated_at = NOW() WHERE id = ${sessionId}`;
}

export async function getRecentMessages(sessionId: string, limit = 20) {
  const sql = getSql();
  return sql`
    SELECT role, kind, content, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY id DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `;
}

export async function getBalance(learnerId: string): Promise<bigint> {
  const sql = getSql();
  const rows = (await sql`
    SELECT balance_femtodollars::text
    FROM credit_balances
    WHERE learner_id = ${learnerId}
    LIMIT 1
  `) as { balance_femtodollars: string }[];

  if (!rows[0]) return BigInt(0);
  return BigInt(rows[0].balance_femtodollars);
}

export async function addCredits(learnerId: string, amount: bigint, type: string, description: string, stripeSessionId?: string) {
  const sql = getSql();
  const before = await getBalance(learnerId);
  const after = before + amount;
  await sql`UPDATE credit_balances SET balance_femtodollars = ${after.toString()} WHERE learner_id = ${learnerId}`;
  await sql`
    INSERT INTO credit_transactions (learner_id, amount_femtodollars, type, description, balance_after, stripe_session_id)
    VALUES (${learnerId}, ${amount.toString()}, ${type}, ${description}, ${after.toString()}, ${stripeSessionId ?? null})
    ON CONFLICT (stripe_session_id) DO NOTHING
  `;
  return after;
}

export async function deductCredits(learnerId: string, amount: bigint, description: string, metadata: Record<string, unknown> = {}) {
  const sql = getSql();
  const before = await getBalance(learnerId);
  if (before < amount) {
    return { ok: false, balance: before };
  }

  const after = before - amount;
  await sql`UPDATE credit_balances SET balance_femtodollars = ${after.toString()} WHERE learner_id = ${learnerId}`;
  await sql`
    INSERT INTO credit_transactions (learner_id, amount_femtodollars, type, description, balance_after, metadata)
    VALUES (${learnerId}, ${(-amount).toString()}, 'usage', ${description}, ${after.toString()}, ${JSON.stringify(metadata)})
  `;

  return { ok: true, balance: after };
}

export async function logUsage(params: {
  learnerId: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costFemtodollars: bigint;
  chargeFemtodollars: bigint;
  openaiResponseId?: string | null;
}) {
  const sql = getSql();
  await sql`
    INSERT INTO usage_logs (
      learner_id, session_id, model,
      input_tokens, output_tokens, cached_tokens, reasoning_tokens,
      cost_femtodollars, charge_femtodollars, openai_response_id
    ) VALUES (
      ${params.learnerId}, ${params.sessionId}, ${params.model},
      ${params.inputTokens}, ${params.outputTokens}, ${params.cachedTokens}, ${params.reasoningTokens},
      ${params.costFemtodollars.toString()}, ${params.chargeFemtodollars.toString()}, ${params.openaiResponseId ?? null}
    )
  `;
}
