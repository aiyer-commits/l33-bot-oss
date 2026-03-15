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

type ChatLogLevel = 'info' | 'error';

function logChatEvent(level: ChatLogLevel, event: string, fields: Record<string, unknown>) {
  const payload = JSON.stringify({
    scope: 'api.chat',
    event,
    ...fields,
  });
  if (level === 'error') {
    console.error(payload);
    return;
  }
  console.info(payload);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

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

function systemInstructionFor(coachingMode: 'interviewer' | 'tutor') {
  if (coachingMode === 'tutor') {
    return [
      'You are l33.bot in tutor mode for coding interviews.',
      'Teach directly and clearly.',
      'Answer the user\'s conceptual question plainly.',
      'State the key invariant or next step explicitly.',
      'Avoid repeating a previous probing question when the learner is still confused.',
      'The latest active problem in the prompt is authoritative for this conversation.',
      'Do not change problems or curriculums during standard chat. Keep moveToProblemId fixed to the current active problem and moveToCurriculumKey fixed to the current curriculum.',
      'Set composerSuggestion.mode to the best next UI input: chat for discussion, test cases, explanations, or edge cases; code for implementation edits; test for running custom input.',
      'Prefer concise responses and actionable next step.',
    ].join(' ');
  }

  return [
    'You are l33.bot in interviewer mode for coding interviews.',
    'Stay strict and realistic.',
    'Ask concise probing questions, evaluate correctness/TLE/edge cases, and request concrete tests.',
    'Do not reveal the solution or key invariant unless the user explicitly asks for help, a hint, or an explanation.',
    'If the user is confused, keep the response short and probe the missing concept.',
    'The latest active problem in the prompt is authoritative for this conversation.',
    'Do not change problems or curriculums during standard chat. Keep moveToProblemId fixed to the current active problem and moveToCurriculumKey fixed to the current curriculum.',
    'Set composerSuggestion.mode to the best next UI input: chat for discussion, test cases, explanations, or edge cases; code for implementation edits; test for running custom input.',
    'Prefer concise responses and actionable next step.',
  ].join(' ');
}

function responseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assistantMessage', 'composerSuggestion', 'assessment', 'quickActions'],
    properties: {
      assistantMessage: { type: 'string' },
      composerSuggestion: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'reason'],
        properties: {
          mode: { type: ['string', 'null'], enum: ['chat', 'code', 'test', null] },
          reason: { type: 'string' },
        },
      },
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
  const requestId = crypto.randomUUID();
  let sessionId: string | null = null;
  let learnerId: string | null = null;
  let activeCurriculumKey: string | null = null;
  let activeProblemId: number | null = null;

  try {
    assertProviderEnv();

    const body = (await request.json()) as ChatApiRequest;
    const message = (body.message ?? '').trim();
    const code = (body.code ?? '').trim();
    const languageState = body.languageState;
    const coachingMode = body.coachingMode === 'tutor' ? 'tutor' : 'interviewer';

    logChatEvent('info', 'turn_started', {
      requestId,
      hasMessage: Boolean(message),
      hasCode: Boolean(code),
      messageChars: message.length,
      codeChars: code.length,
      coachingMode,
      sessionId: body.sessionId ?? null,
      anonIdPresent: Boolean(body.anonId),
      language: languageState?.effective ?? null,
    });

    if (!message && !code) {
      logChatEvent('info', 'turn_rejected', {
        requestId,
        status: 400,
        reason: 'empty_turn_payload',
      });
      return NextResponse.json({ error: 'Empty turn payload' }, { status: 400 });
    }

    const learner = await ensureLearnerProfile({
      userId: null,
      email: null,
      anonId: body.anonId ?? null,
    });
    learnerId = learner.learner_id;
    const availableCurriculums = await listCurriculums(true);
    const allowedCurriculumKeys = new Set(availableCurriculums.map((c) => String(c.key)));

    activeCurriculumKey = learner.active_curriculum_key;
    if (!allowedCurriculumKeys.has(activeCurriculumKey)) {
      activeCurriculumKey = 'l33';
      await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
    }

    let activeCurriculumProblemIds = await getCurriculumProblemIds(activeCurriculumKey);
    if (activeCurriculumProblemIds.length === 0) {
      logChatEvent('error', 'turn_rejected', {
        requestId,
        learnerId,
        status: 500,
        reason: 'empty_curriculum_problem_set',
        activeCurriculumKey,
      });
      return NextResponse.json({ error: `Curriculum ${activeCurriculumKey} has no mapped problems` }, { status: 500 });
    }

    let currentActiveProblemId = learner.active_problem_id;
    if (!activeCurriculumProblemIds.includes(currentActiveProblemId)) {
      currentActiveProblemId = activeCurriculumProblemIds[0];
      await setActiveProblem(learner.learner_id, currentActiveProblemId);
    }

    sessionId = await getOrCreateSession(learner.learner_id, body.sessionId ?? null);
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
      `Language state: ${languageState ? JSON.stringify(languageState) : 'none'}`,
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
      if (activeCurriculumProblemIds.length === 0) {
        logChatEvent('error', 'turn_rejected', {
          requestId,
          learnerId,
          sessionId,
          status: 500,
          reason: 'requested_curriculum_problem_set_empty',
          activeCurriculumKey,
        });
        return NextResponse.json({ error: `Curriculum ${activeCurriculumKey} has no mapped problems` }, { status: 500 });
      }
    }

    activeProblemId = Number.isFinite(routing.parsed.activeProblemId) ? routing.parsed.activeProblemId : currentActiveProblemId;
    if (!activeCurriculumProblemIds.includes(activeProblemId)) {
      const suggested = await getCurriculumProgressSummary(learner.learner_id, activeCurriculumKey);
      activeProblemId = suggested.nextProblemId ?? (await getFirstProblemForCurriculum(activeCurriculumKey)) ?? currentActiveProblemId;
    }
    if (activeProblemId !== currentActiveProblemId) {
      await setActiveProblem(learner.learner_id, activeProblemId);
    }

    const activeProblem = await getProblemById(activeProblemId);
    if (!activeProblem) {
      logChatEvent('error', 'turn_rejected', {
        requestId,
        learnerId,
        sessionId,
        status: 500,
        reason: 'active_problem_not_found',
        activeProblemId,
        activeCurriculumKey,
      });
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
      `Coaching mode: ${coachingMode}`,
      `Routing reason: ${routing.parsed.reason || 'No change'}`,
      `Recent chat history:\n${compactHistoryForCoach || '(none)'}`,
      `Latest user message: ${message || '(none)'}`,
      `Latest user code: ${code || '(none)'}`,
      `Language state: ${languageState ? JSON.stringify(languageState) : 'none'}`,
    ].join('\n\n');

    const coach = await generateJson<ChatApiResponse>({
      system: systemInstructionFor(coachingMode),
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

    logChatEvent('info', 'turn_completed', {
      requestId,
      learnerId,
      sessionId,
      activeProblemId: moveToProblemId,
      activeCurriculumKey,
      coachingMode,
      language: languageState?.effective ?? null,
      inputTokens: coach.usage.inputTokens + routing.usage.inputTokens,
      outputTokens: coach.usage.outputTokens + routing.usage.outputTokens,
      cachedTokens: coach.usage.cachedTokens + routing.usage.cachedTokens,
      reasoningTokens: coach.usage.reasoningTokens + routing.usage.reasoningTokens,
      chargedFemtodollars: '0',
      confidence: coach.parsed.assessment.confidence,
      status: coach.parsed.assessment.status,
      markedMastered: coach.parsed.assessment.markMastered,
      providerRequestId: coach.usage.providerRequestId ?? null,
    });

    return NextResponse.json(out);
  } catch (error) {
    logChatEvent('error', 'turn_failed', {
      requestId,
      learnerId,
      sessionId,
      activeProblemId,
      activeCurriculumKey,
      error: errorMessage(error),
    });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
