import { NextResponse } from 'next/server';
import { getOptionalUser } from '@/lib/auth';
import { ensureLearnerProfile, getBalance, getCurriculumProgressSummary, hasPaidAccess, listCurriculums } from '@/lib/db/repo';
import { femtodollarsToDollars } from '@/lib/pricing';

export async function GET(request: Request) {
  const user = await getOptionalUser();
  const url = new URL(request.url);
  const anonId = url.searchParams.get('anonId') || undefined;

  const learner = await ensureLearnerProfile({
    userId: user?.id ?? null,
    anonId,
    email: user?.email ?? null,
  });

  const balance = user ? await getBalance(learner.learner_id) : BigInt(0);
  const paidAccess = user ? await hasPaidAccess(learner.learner_id) : false;
  const availableCurriculums = await listCurriculums(paidAccess);
  const activeCurriculumProgress = await getCurriculumProgressSummary(learner.learner_id, learner.active_curriculum_key);

  return NextResponse.json({
    user,
    learnerId: learner.learner_id,
    anonId: learner.anon_id,
    accessTier: paidAccess ? 'paid' : 'free',
    activeCurriculumKey: learner.active_curriculum_key,
    availableCurriculums,
    activeCurriculumProgress,
    activeProblemId: learner.active_problem_id,
    credits: {
      balanceFemtodollars: balance.toString(),
      balanceDollars: femtodollarsToDollars(balance),
    },
  });
}
