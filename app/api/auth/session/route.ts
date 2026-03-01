import { NextResponse } from 'next/server';
import { getOptionalUser } from '@/lib/auth';
import { ensureLearnerProfile, getBalance } from '@/lib/db/repo';
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

  return NextResponse.json({
    user,
    learnerId: learner.learner_id,
    anonId: learner.anon_id,
    activeProblemId: learner.active_problem_id,
    credits: {
      balanceFemtodollars: balance.toString(),
      balanceDollars: femtodollarsToDollars(balance),
    },
  });
}
