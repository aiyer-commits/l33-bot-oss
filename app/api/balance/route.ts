import { NextResponse } from 'next/server';
import { getOptionalUser } from '@/lib/auth';
import { ensureLearnerProfile, getBalance } from '@/lib/db/repo';
import { femtodollarsToDollars } from '@/lib/pricing';

export async function GET() {
  const user = await getOptionalUser();
  if (!user) {
    return NextResponse.json({ balanceFemtodollars: '0', balanceDollars: 0, loggedIn: false });
  }

  const learner = await ensureLearnerProfile({ userId: user.id, email: user.email ?? null });
  const balance = await getBalance(learner.learner_id);

  return NextResponse.json({
    loggedIn: true,
    balanceFemtodollars: balance.toString(),
    balanceDollars: femtodollarsToDollars(balance),
  });
}
