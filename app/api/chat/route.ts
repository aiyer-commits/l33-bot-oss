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
  getCurriculumProgressSummary,
  getCurriculumSequenceContext,
  getCurriculumProblemIds,
  getFirstProblemForCurriculum,
  getOrCreateSession,
  getProblemById,
  getProgressForProblem,
  getRecentMessages,
  hasPaidAccess,
  listCurriculums,
  logUsage,
  searchProblems,
  setActiveCurriculum,
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

function formatRecentHistory(
  rows: Array<Record<string, unknown>>,
  limit = 10,
) {
  return rows
    .slice(-limit)
    .map((r) => {
      const role = String(r.role ?? 'unknown');
      const kind = String(r.kind ?? 'text');
      const content = String(r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${role}/${kind}: ${content}`;
    })
    .join('\n');
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
            'moveToCurriculumKey',
            'summaryNote',
            'nextStep',
          ],
          properties: {
            status: { type: 'string', enum: ['learning', 'approaching', 'review', 'mastered'] },
            confidence: { type: 'integer', minimum: 0, maximum: 100 },
            attemptsDelta: { type: 'integer', minimum: 0, maximum: 2 },
            markMastered: { type: 'boolean' },
            moveToProblemId: { type: 'integer', minimum: 1, maximum: 1000000 },
            moveToCurriculumKey: { type: ['string', 'null'] },
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

async function resolveSelectionWithFunctions(
  client: OpenAI,
  prompt: string,
  context: {
    activeProblemId: number;
    activeCurriculumKey: string;
    allowedCurriculumKeys: string[];
    learnerId: string;
  },
) {
  let response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              [
                'You are the l33 curriculum router. Output only routing decisions.',
                'Goal: choose activeCurriculumKey and activeProblemId correctly.',
                'Always use tools before deciding.',
                'Decision policy:',
                '- If user asks next/new/another/different problem: move to a different problem in current/requested curriculum; call get_curriculum_sequence and prefer nextProblemId when no extra constraints are given.',
                '- If user asks to switch curriculum (l33/l75/l150/lall): switch to that curriculum, then choose a valid problem inside it (prefer curriculum nextProblemId or firstProblemId).',
                '- If user asks by topic/difficulty/pattern: call search_problems and select best fit in allowed curricula.',
                '- If no switching/selecting intent: keep current curriculum/problem.',
                '- Never output a problem outside chosen curriculum.',
                'Return strict JSON: {"activeProblemId": number, "activeCurriculumKey": string, "reason": string}.',
              ].join(' '),
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
          required: ['query', 'difficulty', 'category', 'limit', 'curriculumKey'],
          properties: {
            query: { type: ['string', 'null'] },
            difficulty: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            limit: { type: ['number', 'null'] },
            curriculumKey: { type: ['string', 'null'] },
          },
        },
      },
      {
        type: 'function',
        name: 'get_active_context',
        description: 'Get current active problem and curriculum context',
        strict: true,
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
      {
        type: 'function',
        name: 'get_curriculum_sequence',
        description: 'Get current index and neighboring problem IDs in curriculum order',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['curriculumKey', 'currentProblemId'],
          properties: {
            curriculumKey: { type: 'string' },
            currentProblemId: { type: 'number' },
          },
        },
      },
      {
        type: 'function',
        name: 'list_curriculums',
        description: 'List available curriculums and accessibility',
        strict: true,
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
      {
        type: 'function',
        name: 'get_curriculum_progress',
        description: 'Get mastered/total and next problem for a curriculum',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['curriculumKey'],
          properties: { curriculumKey: { type: 'string' } },
        },
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
          curriculumKey:
            typeof args.curriculumKey === 'string' && context.allowedCurriculumKeys.includes(args.curriculumKey)
              ? args.curriculumKey
              : context.activeCurriculumKey,
        });
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(rows) });
      } else if (call.name === 'get_active_context') {
        const row = await getProblemById(context.activeProblemId);
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({
            activeProblemId: context.activeProblemId,
            activeCurriculumKey: context.activeCurriculumKey,
            activeProblem: row,
            allowedCurriculumKeys: context.allowedCurriculumKeys,
          }),
        });
      } else if (call.name === 'list_curriculums') {
        const rows = await listCurriculums(true);
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(rows.filter((r) => context.allowedCurriculumKeys.includes(r.key))),
        });
      } else if (call.name === 'get_curriculum_sequence') {
        const curriculumKey =
          typeof args.curriculumKey === 'string' && context.allowedCurriculumKeys.includes(args.curriculumKey)
            ? args.curriculumKey
            : context.activeCurriculumKey;
        const currentProblemId =
          Number.isFinite(args.currentProblemId) && args.currentProblemId > 0 ? Number(args.currentProblemId) : context.activeProblemId;
        const sequence = await getCurriculumSequenceContext(curriculumKey, currentProblemId);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(sequence) });
      } else if (call.name === 'get_curriculum_progress') {
        const curriculumKey =
          typeof args.curriculumKey === 'string' && context.allowedCurriculumKeys.includes(args.curriculumKey)
            ? args.curriculumKey
            : context.activeCurriculumKey;
        const progress = await getCurriculumProgressSummary(context.learnerId, curriculumKey);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ curriculumKey, ...progress }) });
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

  const selected = parseJson<{ activeProblemId: number; activeCurriculumKey: string; reason: string }>(response.output_text || '{}');
  return {
    activeProblemId:
      Number.isFinite(selected.activeProblemId) && selected.activeProblemId >= 1
        ? selected.activeProblemId
        : context.activeProblemId,
    activeCurriculumKey:
      typeof selected.activeCurriculumKey === 'string' && context.allowedCurriculumKeys.includes(selected.activeCurriculumKey)
        ? selected.activeCurriculumKey
        : context.activeCurriculumKey,
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
  const paidAccess = user ? await hasPaidAccess(learner.learner_id) : false;
  const availableCurriculums = await listCurriculums(paidAccess);
  const allowedCurriculumKeys = new Set(availableCurriculums.map((c) => String(c.key)));

  let activeCurriculumKey = learner.active_curriculum_key;
  if (!allowedCurriculumKeys.has(activeCurriculumKey)) {
    activeCurriculumKey = 'l33';
    await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
  }

  let activeCurriculumProblemIds = await getCurriculumProblemIds(activeCurriculumKey);
  if (activeCurriculumProblemIds.length === 0) {
    return NextResponse.json({ error: `Curriculum ${activeCurriculumKey} has no mapped problems` }, { status: 500 });
  }

  let currentActiveProblemId = learner.active_problem_id;
  if (!activeCurriculumProblemIds.includes(currentActiveProblemId)) {
    currentActiveProblemId = activeCurriculumProblemIds[0];
    await setActiveProblem(learner.learner_id, currentActiveProblemId);
  }

  const sessionId = await getOrCreateSession(learner.learner_id, body.sessionId ?? null);

  const userMessages: ChatMessage[] = [];
  if (message) userMessages.push({ role: 'user', kind: 'text', content: message, createdAt: new Date().toISOString() });
  if (code) userMessages.push({ role: 'user', kind: 'code', content: code, createdAt: new Date().toISOString() });
  await appendMessages(sessionId, userMessages);
  const historyRows = await getRecentMessages(sessionId, 20);
  const compactHistory = formatRecentHistory([...historyRows].reverse(), 12);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const curriculumProgress = await getCurriculumProgressSummary(learner.learner_id, activeCurriculumKey);
  const selection = await resolveSelectionWithFunctions(
    client,
    [
      `Current active curriculum: ${activeCurriculumKey}`,
      `Current active problem: ${currentActiveProblemId}`,
      `Available curriculums: ${availableCurriculums.map((c) => `${c.key}${c.is_premium ? ' (paid)' : ' (free)'}`).join(', ')}`,
      `Current curriculum progress: ${curriculumProgress.mastered}/${curriculumProgress.total} mastered. Next suggested id: ${curriculumProgress.nextProblemId ?? 'none'}`,
      `Latest user text: ${message || '(none)'}`,
      `Latest user code present: ${code.length > 0 ? 'yes' : 'no'}`,
      `Recent history:\n${compactHistory || '(none)'}`,
      'Respect access gating: free users can only use free curriculums.',
    ].join('\n'),
    {
      activeProblemId: currentActiveProblemId,
      activeCurriculumKey,
      allowedCurriculumKeys: Array.from(allowedCurriculumKeys),
      learnerId: learner.learner_id,
    },
  );

  if (selection.activeCurriculumKey !== activeCurriculumKey) {
    activeCurriculumKey = selection.activeCurriculumKey;
    await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
    activeCurriculumProblemIds = await getCurriculumProblemIds(activeCurriculumKey);
  }

  let activeProblemId = selection.activeProblemId;
  if (!activeCurriculumProblemIds.includes(activeProblemId)) {
    activeProblemId = activeCurriculumProblemIds[0];
  }
  if (activeProblemId !== currentActiveProblemId) {
    await setActiveProblem(learner.learner_id, activeProblemId);
  }

  const activeProblem = await getProblemById(activeProblemId);
  if (!activeProblem) {
    return NextResponse.json({ error: 'Active problem not found in DB' }, { status: 500 });
  }

  const progress = await getProgressForProblem(learner.learner_id, activeProblemId);
  const mastered = await countMastered(learner.learner_id);
  const historyRowsForCoach = historyRows;
  const compactHistoryForCoach = formatRecentHistory(historyRowsForCoach, 10);
  const problemStatement = plainStatement(activeProblem.statement ?? '');

  const prompt = [
    `Learner mode: ${user ? 'logged_in' : 'anonymous_free'}`,
    `Problem #${activeProblem.id}: ${activeProblem.title}`,
    `Difficulty: ${activeProblem.difficulty}`,
    `Category: ${activeProblem.category}`,
    `Statement: ${problemStatement}`,
    `Semantic tags: ${(activeProblem.tags ?? []).join(', ')}`,
    `Test cases blob: ${activeProblem.test_cases_blob_url ?? 'none'}`,
    `Curriculum: ${activeCurriculumKey}`,
    `Curriculum progress: ${curriculumProgress.mastered}/${curriculumProgress.total} mastered`,
    `Mastered count (all): ${mastered}`,
    `Allowed curriculums: ${Array.from(allowedCurriculumKeys).join(', ')}`,
    `Current progress: ${JSON.stringify(progress ?? {})}`,
    `Selection reason: ${selection.reason}`,
    `Recent chat history:\n${compactHistoryForCoach || '(none)'}`,
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
              [
                'You are l33.bot interviewer-coach for coding interviews.',
                'Primary mode: strict interviewer. Do not reveal solution strategy/hints unless user explicitly asks for help/hint/explanation.',
                'In interviewer mode: ask concise probing questions, evaluate correctness/TLE/edge cases, and request concrete tests.',
                'If user explicitly asks for help: switch to tutor mode and teach clearly. If guidance exceeds normal interview realism, include a brief realism note.',
                'Honor curriculum intent (l33/l75/l150/lall). When changing curriculum set moveToCurriculumKey; set moveToProblemId to a valid id in that curriculum.',
                'Prefer concise responses and actionable next step.',
              ].join(' '),
          },
        ],
      },
      { role: 'user', content: [{ type: 'input_text', text: prompt }] },
    ],
    text: { format: responseSchema() },
    max_output_tokens: 650,
  });

  const parsed = parseJson<ChatApiResponse>(response.output_text || '{}');
  const requestedCurriculumKey =
    typeof parsed.assessment.moveToCurriculumKey === 'string' && allowedCurriculumKeys.has(parsed.assessment.moveToCurriculumKey)
      ? parsed.assessment.moveToCurriculumKey
      : activeCurriculumKey;

  if (requestedCurriculumKey !== activeCurriculumKey) {
    activeCurriculumKey = requestedCurriculumKey;
    await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
    activeCurriculumProblemIds = await getCurriculumProblemIds(activeCurriculumKey);
  }

  let moveToProblemId = Number.isFinite(parsed.assessment.moveToProblemId) ? parsed.assessment.moveToProblemId : activeProblemId;
  if (!activeCurriculumProblemIds.includes(moveToProblemId)) {
    const suggested = await getCurriculumProgressSummary(learner.learner_id, activeCurriculumKey);
    moveToProblemId = suggested.nextProblemId ?? (await getFirstProblemForCurriculum(activeCurriculumKey)) ?? activeProblemId;
  }

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
    activeCurriculumKey,
    usage: {
      chargedFemtodollars: (user ? charge : BigInt(0)).toString(),
      chargedDollars: femtodollarsToDollars(user ? charge : BigInt(0)),
      remainingBalanceFemtodollars: remainingBalance?.toString(),
      remainingBalanceDollars: remainingBalance != null ? femtodollarsToDollars(remainingBalance) : undefined,
    },
  };

  return NextResponse.json(out);
}
