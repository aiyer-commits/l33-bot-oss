import { NextResponse } from 'next/server';
import {
  ensureLearnerProfile,
  getCurriculumProblemIds,
  getCurriculumProblems,
  listCurriculums,
  setActiveCurriculum,
  setActiveProblem,
} from '@/lib/db/repo';

function normalizeCurriculumKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const anonId = url.searchParams.get('anonId') || undefined;
  const requestedCurriculumKey = normalizeCurriculumKey(url.searchParams.get('curriculumKey'));

  const learner = await ensureLearnerProfile({
    userId: null,
    email: null,
    anonId,
  });

  const curriculums = await listCurriculums(true);
  const availableKeys = new Set(curriculums.map((c) => String(c.key)));

  let activeCurriculumKey = learner.active_curriculum_key;
  if (!availableKeys.has(activeCurriculumKey)) {
    activeCurriculumKey = String(curriculums[0]?.key ?? 'l33');
    await setActiveCurriculum(learner.learner_id, activeCurriculumKey);
  }

  const selectedCurriculumKey = requestedCurriculumKey || activeCurriculumKey;
  const selectedExists = availableKeys.has(selectedCurriculumKey);
  const effectiveSelectedKey = selectedExists ? selectedCurriculumKey : activeCurriculumKey;
  const problems = await getCurriculumProblems(effectiveSelectedKey);

  return NextResponse.json({
    activeCurriculumKey,
    activeProblemId: learner.active_problem_id,
    selectedCurriculumKey: effectiveSelectedKey,
    curriculums,
    problems,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    anonId?: string;
    curriculumKey?: string;
    problemId?: number;
  };

  const learner = await ensureLearnerProfile({
    userId: null,
    email: null,
    anonId: body.anonId ?? null,
  });

  const curriculumKey = normalizeCurriculumKey(body.curriculumKey);
  if (!curriculumKey) {
    return NextResponse.json({ error: 'curriculumKey is required' }, { status: 400 });
  }

  const curriculums = await listCurriculums(true);
  const availableKeys = new Set(curriculums.map((c) => String(c.key)));
  if (!availableKeys.has(curriculumKey)) {
    return NextResponse.json({ error: 'Unknown curriculum' }, { status: 404 });
  }

  const ids = await getCurriculumProblemIds(curriculumKey);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Curriculum has no problems' }, { status: 500 });
  }

  const requestedProblemId = Number.isFinite(body.problemId) ? Number(body.problemId) : null;
  const problemId = requestedProblemId != null && ids.includes(requestedProblemId) ? requestedProblemId : ids[0];

  await setActiveCurriculum(learner.learner_id, curriculumKey);
  await setActiveProblem(learner.learner_id, problemId);

  return NextResponse.json({
    ok: true,
    activeCurriculumKey: curriculumKey,
    activeProblemId: problemId,
  });
}

