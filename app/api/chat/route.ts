import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import type { ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import type { ChatApiRequest, ChatApiResponse, ChatMessage } from '@/lib/types';
import { getOptionalUser } from '@/lib/auth';
import {
  appendMessages,
  countMastered,
  deductCredits,
  ensureLearnerProfile,
  getOrCreateSession,
  getProblemById,
  getProgressForProblem,
  getRecentMessages,
  listProblemsCompact,
  logUsage,
  searchProblems,
  setActiveProblem,
  upsertProblemProgress,
} from '@/lib/db/repo';
import { applyMargin, calculateResponseCostFemtodollars, femtodollarsToDollars } from '@/lib/pricing';

const MODEL = 'gpt-4.1-mini';

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function plainStatement(raw: string) {
  return decodeHtmlEntities(
    raw
      .replace(/\r/g, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/p\s*>/gi, '\n\n')
      .replace(/<\s*p[^>]*>/gi, '')
      .replace(/<\s*\/pre\s*>/gi, '\n\n')
      .replace(/<\s*pre[^>]*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<\s*\/li\s*>/gi, '\n')
      .replace(/<\s*\/?(ul|ol)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function parseJson<T>(value: string): T {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const payload = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(payload) as T;
}

function responseSchema() {
  return {
    type: 'json_schema' as const,
    name: 'l33_bot_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['assistantMessage', 'assessment', 'quickActions'],
      properties: {
        assistantMessage: { type: 'string' },
        assessment: {
          type: 'object',
          additionalProperties: false,
          required: [
            'status',
            'confidence',
            'attemptsDelta',
            'markMastered',
            'moveToProblemId',
            'summaryNote',
            'nextStep',
          ],
          properties: {
            status: { type: 'string', enum: ['learning', 'approaching', 'review', 'mastered'] },
            confidence: { type: 'integer', minimum: 0, maximum: 100 },
            attemptsDelta: { type: 'integer', minimum: 0, maximum: 2 },
            markMastered: { type: 'boolean' },
            moveToProblemId: { type: 'integer', minimum: 1, maximum: 150 },
            summaryNote: { type: 'string' },
            nextStep: { type: 'string' },
          },
        },
        quickActions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string' },
        },
      },
    },
  };
}

async function resolveSelectionWithFunctions(client: OpenAI, prompt: string, activeProblemId: number) {
  let response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You route learners to the right LeetCode problem. Use tools to search/select. If user does not request a switch, keep current problem. Return JSON {"activeProblemId": number, "reason": string}.',
          },
        ],
      },
      { role: 'user', content: [{ type: 'input_text', text: prompt }] },
    ],
    tools: [
      {
        type: 'function',
        name: 'search_problems',
        description: 'Search problems by semantic terms, category, and difficulty',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['query', 'difficulty', 'category', 'limit'],
          properties: {
            query: { type: ['string', 'null'] },
            difficulty: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            limit: { type: ['number', 'null'] },
          },
        },
      },
      {
        type: 'function',
        name: 'get_active_problem',
        description: 'Get current active problem id and basic metadata',
        strict: true,
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
      {
        type: 'function',
        name: 'list_catalog',
        description: 'List compact catalog to reason about order and titles',
        strict: true,
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
    ],
    tool_choice: 'auto',
    max_output_tokens: 400,
  });

  for (let i = 0; i < 6; i++) {
    const calls = (response.output ?? []).filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');
    if (!calls.length) break;

    const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];

    for (const call of calls) {
      const args = call.arguments ? JSON.parse(call.arguments) : {};

      if (call.name === 'search_problems') {
        const rows = await searchProblems({
          query: args.query,
          difficulty: args.difficulty,
          category: args.category,
          limit: args.limit,
        });
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(rows) });
      } else if (call.name === 'get_active_problem') {
        const row = await getProblemById(activeProblemId);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(row) });
      } else if (call.name === 'list_catalog') {
        const rows = await listProblemsCompact();
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(rows.slice(0, 150)) });
      } else {
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: 'unknown tool' }) });
      }
    }

    response = await client.responses.create({
      model: MODEL,
      previous_response_id: response.id,
      input: outputs,
      max_output_tokens: 400,
    });
  }

  const selected = parseJson<{ activeProblemId: number; reason: string }>(response.output_text || '{}');
  return {
    activeProblemId:
      Number.isFinite(selected.activeProblemId) && selected.activeProblemId >= 1 && selected.activeProblemId <= 150
        ? selected.activeProblemId
        : activeProblemId,
    reason: selected.reason || 'No change',
  };
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 500 });
  }

  const body = (await request.json()) as ChatApiRequest;
  const message = (body.message ?? '').trim();
  const code = (body.code ?? '').trim();

  if (!message && !code) {
    return NextResponse.json({ error: 'Empty turn payload' }, { status: 400 });
  }

  const user = await getOptionalUser();
  const learner = await ensureLearnerProfile({
    userId: user?.id ?? null,
    email: user?.email ?? null,
    anonId: body.anonId ?? null,
  });

  const sessionId = await getOrCreateSession(learner.learner_id, body.sessionId ?? null);

  const userMessages: ChatMessage[] = [];
  if (message) userMessages.push({ role: 'user', kind: 'text', content: message, createdAt: new Date().toISOString() });
  if (code) userMessages.push({ role: 'user', kind: 'code', content: code, createdAt: new Date().toISOString() });
  await appendMessages(sessionId, userMessages);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const selection = await resolveSelectionWithFunctions(
    client,
    `Current active problem: ${learner.active_problem_id}. Latest message: ${message}. Latest code present: ${code.length > 0}`,
    learner.active_problem_id,
  );

  if (selection.activeProblemId !== learner.active_problem_id) {
    await setActiveProblem(learner.learner_id, selection.activeProblemId);
  }

  const activeProblemId = selection.activeProblemId;
  const activeProblem = await getProblemById(activeProblemId);
  if (!activeProblem) {
    return NextResponse.json({ error: 'Active problem not found in DB' }, { status: 500 });
  }

  const progress = await getProgressForProblem(learner.learner_id, activeProblemId);
  const mastered = await countMastered(learner.learner_id);
  const historyRows = await getRecentMessages(sessionId, 16);
  const problemStatement = plainStatement(activeProblem.statement ?? '');

  const prompt = [
    `Learner mode: ${user ? 'logged_in' : 'anonymous_free'}`,
    `Problem #${activeProblem.id}: ${activeProblem.title}`,
    `Difficulty: ${activeProblem.difficulty}`,
    `Category: ${activeProblem.category}`,
    `Statement: ${problemStatement}`,
    `Semantic tags: ${(activeProblem.tags ?? []).join(', ')}`,
    `Test cases blob: ${activeProblem.test_cases_blob_url ?? 'none'}`,
    `Mastered count: ${mastered}/150`,
    `Current progress: ${JSON.stringify(progress ?? {})}`,
    `Selection reason: ${selection.reason}`,
    `Recent chat history: ${JSON.stringify(historyRows.reverse())}`,
    `Latest user message: ${message || '(none)'}`,
    `Latest user code: ${code || '(none)'}`,
    'Return strict JSON schema output.',
  ].join('\n\n');

  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You are l33.bot interviewer-coach for coding interviews. Default mode is strict interviewer: do NOT provide hints, solution ideas, or next steps unless the user explicitly asks for help/hint/explanation. In interviewer mode, ask concise probing questions, evaluate correctness/TLE/edge cases, and request clarifications/tests. If the user explicitly asks for help, switch to tutor mode and teach clearly; when giving guidance beyond realistic interview hints, state a short realism note such as \"Interview realism note: this is more guidance than a typical interviewer would provide.\" Keep responses concise and practical. If user asks for a specific topic/difficulty, moveToProblemId can jump to that semantic match.',
          },
        ],
      },
      { role: 'user', content: [{ type: 'input_text', text: prompt }] },
    ],
    text: { format: responseSchema() },
    max_output_tokens: 650,
  });

  const parsed = parseJson<ChatApiResponse>(response.output_text || '{}');
  const moveToProblemId = Math.max(1, Math.min(150, parsed.assessment.moveToProblemId || activeProblemId));

  if (moveToProblemId !== activeProblemId) {
    await setActiveProblem(learner.learner_id, moveToProblemId);
  }

  await upsertProblemProgress({
    learnerId: learner.learner_id,
    problemId: activeProblemId,
    status: parsed.assessment.markMastered ? 'mastered' : parsed.assessment.status,
    confidence: parsed.assessment.confidence,
    attemptsDelta: parsed.assessment.attemptsDelta,
    summaryNote: parsed.assessment.summaryNote,
    code,
    modelState: {
      nextStep: parsed.assessment.nextStep,
      selectionReason: selection.reason,
      quickActions: parsed.quickActions,
    },
    markMastered: parsed.assessment.markMastered,
  });

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    kind: 'text',
    content: `${parsed.assistantMessage}\n\n${parsed.assessment.summaryNote}\nNext: ${parsed.assessment.nextStep}`.trim(),
    createdAt: new Date().toISOString(),
  };
  await appendMessages(sessionId, [assistantMessage]);

  const usage = (response as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
  }).usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0;

  const rawCost = calculateResponseCostFemtodollars({
    model: 'gpt-4.1-mini',
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
  });
  const charge = applyMargin(rawCost);

  let remainingBalance: bigint | null = null;
  if (user) {
    const deduction = await deductCredits(learner.learner_id, charge, 'Chat tutoring message', {
      inputTokens,
      outputTokens,
      cachedTokens,
      reasoningTokens,
      model: MODEL,
    });

    if (!deduction.ok) {
      return NextResponse.json(
        {
          error: 'Insufficient credits. Purchase $10 pack to continue logged-in tutoring.',
          sessionId,
        },
        { status: 402 },
      );
    }
    remainingBalance = deduction.balance;
  }

  await logUsage({
    learnerId: learner.learner_id,
    sessionId,
    model: MODEL,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    costFemtodollars: rawCost,
    chargeFemtodollars: user ? charge : BigInt(0),
    openaiResponseId: response.id ?? null,
  });

  const out: ChatApiResponse = {
    ...parsed,
    sessionId,
    activeProblemId: moveToProblemId,
    usage: {
      chargedFemtodollars: (user ? charge : BigInt(0)).toString(),
      chargedDollars: femtodollarsToDollars(user ? charge : BigInt(0)),
      remainingBalanceFemtodollars: remainingBalance?.toString(),
      remainingBalanceDollars: remainingBalance != null ? femtodollarsToDollars(remainingBalance) : undefined,
    },
  };

  return NextResponse.json(out);
}
