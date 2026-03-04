import { NextResponse } from 'next/server';
import type { ChatApiRequest, ChatApiResponse, ChatMessage } from '@/lib/types';
import {
  appendMessages,
  countMastered,
  ensureLearnerProfile,
  getCurriculumProgressSummary,
  getCurriculumProblemIds,
  getFirstProblemForCurriculum,
  getOrCreateSession,
  getProblemById,
  getProgressForProblem,
  getRecentMessages,
  listCurriculums,
  logUsage,
  setActiveCurriculum,
  setActiveProblem,
  upsertProblemProgress,
} from '@/lib/db/repo';
import { calculateResponseCostFemtodollars } from '@/lib/pricing';
import { assertProviderEnv, generateJson } from '@/lib/llm/provider';

type RoutingDecision = {
  activeProblemId: number;
  activeCurriculumKey: string;
  reason: string;
};

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

function formatRecentHistory(rows: Array<Record<string, unknown>>, limit = 10) {
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

function responseSchema() {
  return {
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
  };
}

function routingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['activeProblemId', 'activeCurriculumKey', 'reason'],
    properties: {
      activeProblemId: { type: 'integer', minimum: 1, maximum: 1000000 },
      activeCurriculumKey: { type: 'string' },
      reason: { type: 'string' },
    },
  };
}

function asChatMessage(role: 'assistant' | 'user', content: string, kind: 'text' | 'code'): ChatMessage {
  return { role, content, kind, createdAt: new Date().toISOString() };
}

export async function POST(request: Request) {
  try {
    assertProviderEnv();

    const body = (await request.json()) as ChatApiRequest;
    const message = (body.message ?? '').trim();
    const code = (body.code ?? '').trim();

    if (!message && !code) {
      return NextResponse.json({ error: 'Empty turn payload' }, { status: 400 });
    }

    const learner = await ensureLearnerProfile({
      userId: null,
      email: null,
      anonId: body.anonId ?? null,
    });
    const availableCurriculums = await listCurriculums(true);
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
    const outboundUserMessages: ChatMessage[] = [];
    if (message) outboundUserMessages.push(asChatMessage('user', message, 'text'));
    if (code) outboundUserMessages.push(asChatMessage('user', code, 'code'));
    await appendMessages(sessionId, outboundUserMessages);

    const historyRows = await getRecentMessages(sessionId, 24);
    const compactHistory = formatRecentHistory([...historyRows].reverse(), 12);
    const curriculumProgress = await getCurriculumProgressSummary(learner.learner_id, activeCurriculumKey);

    const routingPrompt = [
      `Current active curriculum: ${activeCurriculumKey}`,
      `Current active problem: ${currentActiveProblemId}`,
      `Available curriculums: ${availableCurriculums.map((c) => `${c.key} (${c.total_count})`).join(', ')}`,
      `Current curriculum progress: ${curriculumProgress.mastered}/${curriculumProgress.total} mastered. Next suggested id: ${curriculumProgress.nextProblemId ?? 'none'}`,
      `Latest user text: ${message || '(none)'}`,
      `Latest user code present: ${code.length > 0 ? 'yes' : 'no'}`,
      `Recent history:\n${compactHistory || '(none)'}`,
      'Only switch curriculum/problem when user intent clearly asks for it.',
      'If uncertain, keep current curriculum and problem.',
    ].join('\n');

    const routing = await generateJson<RoutingDecision>({
      system: [
        'You are the curriculum router.',
        'Choose the active curriculum key and active problem id.',
        'When no explicit switch intent is present, keep current selections.',
      ].join(' '),
      prompt: routingPrompt,
      schemaName: 'l33_routing_decision',
      schema: routingSchema(),
      maxOutputTokens: 250,
    });

    const requestedCurriculumKey =
      typeof routing.parsed.activeCurriculumKey === 'string' && allowedCurriculumKeys.has(routing.parsed.activeCurriculumKey)
        ? routing.parsed.activeCurriculumKey
        : activeCurriculumKey;
    if (requestedCurriculumKey !== activeCurriculumKey) {
      activeCurriculumKey = requestedCurriculumKey;
      await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
      activeCurriculumProblemIds = await getCurriculumProblemIds(activeCurriculumKey);
    }

    let activeProblemId = Number.isFinite(routing.parsed.activeProblemId) ? routing.parsed.activeProblemId : currentActiveProblemId;
    if (!activeCurriculumProblemIds.includes(activeProblemId)) {
      const suggested = await getCurriculumProgressSummary(learner.learner_id, activeCurriculumKey);
      activeProblemId = suggested.nextProblemId ?? (await getFirstProblemForCurriculum(activeCurriculumKey)) ?? currentActiveProblemId;
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
    const compactHistoryForCoach = formatRecentHistory(historyRows, 10);
    const problemStatement = plainStatement(activeProblem.statement ?? '');

    const coachPrompt = [
      'Learner mode: anonymous',
      `Problem #${activeProblem.id}: ${activeProblem.title}`,
      `Difficulty: ${activeProblem.difficulty}`,
      `Category: ${activeProblem.category}`,
      `Statement: ${problemStatement}`,
      `Semantic tags: ${(activeProblem.tags ?? []).join(', ')}`,
      `Curriculum: ${activeCurriculumKey}`,
      `Curriculum progress: ${curriculumProgress.mastered}/${curriculumProgress.total} mastered`,
      `Mastered count (all): ${mastered}`,
      `Allowed curriculums: ${Array.from(allowedCurriculumKeys).join(', ')}`,
      `Current progress: ${JSON.stringify(progress ?? {})}`,
      `Routing reason: ${routing.parsed.reason || 'No change'}`,
      `Recent chat history:\n${compactHistoryForCoach || '(none)'}`,
      `Latest user message: ${message || '(none)'}`,
      `Latest user code: ${code || '(none)'}`,
    ].join('\n\n');

    const coach = await generateJson<ChatApiResponse>({
      system: [
        'You are l33.bot interviewer-coach for coding interviews.',
        'Primary mode: strict interviewer.',
        'Do not reveal solution strategy unless user explicitly asks for help/hint/explanation.',
        'Ask concise probing questions, evaluate correctness and edge cases, and provide an actionable next step.',
      ].join(' '),
      prompt: coachPrompt,
      schemaName: 'l33_bot_response',
      schema: responseSchema(),
      maxOutputTokens: 700,
    });

    let moveToProblemId = Number.isFinite(coach.parsed.assessment.moveToProblemId) ? coach.parsed.assessment.moveToProblemId : activeProblemId;
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
      status: coach.parsed.assessment.markMastered ? 'mastered' : coach.parsed.assessment.status,
      confidence: coach.parsed.assessment.confidence,
      attemptsDelta: coach.parsed.assessment.attemptsDelta,
      summaryNote: coach.parsed.assessment.summaryNote,
      code,
      modelState: {
        nextStep: coach.parsed.assessment.nextStep,
        selectionReason: routing.parsed.reason,
        quickActions: coach.parsed.quickActions,
        provider: coach.provider,
      },
      markMastered: coach.parsed.assessment.markMastered,
    });

    const assistantMessage = asChatMessage(
      'assistant',
      `${coach.parsed.assistantMessage}\n\n${coach.parsed.assessment.summaryNote}\nNext: ${coach.parsed.assessment.nextStep}`.trim(),
      'text',
    );
    await appendMessages(sessionId, [assistantMessage]);

    let rawCost = BigInt(0);
    if (coach.provider === 'openai' && coach.model === 'gpt-4.1-mini') {
      rawCost = calculateResponseCostFemtodollars({
        model: 'gpt-4.1-mini',
        inputTokens: coach.usage.inputTokens + routing.usage.inputTokens,
        outputTokens: coach.usage.outputTokens + routing.usage.outputTokens,
        cachedTokens: coach.usage.cachedTokens + routing.usage.cachedTokens,
        reasoningTokens: coach.usage.reasoningTokens + routing.usage.reasoningTokens,
      });
    }

    await logUsage({
      learnerId: learner.learner_id,
      sessionId,
      model: `${coach.provider}:${coach.model}`,
      inputTokens: coach.usage.inputTokens + routing.usage.inputTokens,
      outputTokens: coach.usage.outputTokens + routing.usage.outputTokens,
      cachedTokens: coach.usage.cachedTokens + routing.usage.cachedTokens,
      reasoningTokens: coach.usage.reasoningTokens + routing.usage.reasoningTokens,
      costFemtodollars: rawCost,
      chargeFemtodollars: BigInt(0),
      openaiResponseId: coach.usage.providerRequestId,
    });

    const out: ChatApiResponse = {
      ...coach.parsed,
      sessionId,
      activeProblemId: moveToProblemId,
      activeCurriculumKey,
      usage: { chargedFemtodollars: '0', chargedDollars: 0 },
    };

    return NextResponse.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected chat failure';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

