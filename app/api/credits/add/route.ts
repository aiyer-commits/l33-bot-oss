import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db/client';
import { addCredits, ensureLearnerProfile, getBalance } from '@/lib/db/repo';
import { dollarsToFemtodollars } from '@/lib/pricing';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const creditDollars = Number(body?.creditDollars);
    const description = typeof body?.description === 'string' ? body.description : 'Credit purchase';
    const stripeSessionId = typeof body?.stripeSessionId === 'string' ? body.stripeSessionId : undefined;

    if (!userId || !Number.isFinite(creditDollars) || creditDollars <= 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const learner = await ensureLearnerProfile({ userId });

    if (stripeSessionId) {
      const sql = getSql();
      const existing = await sql`
        SELECT 1
        FROM credit_transactions
        WHERE stripe_session_id = ${stripeSessionId}
        LIMIT 1
      `;

      if (existing.length > 0) {
        const currentBalance = await getBalance(learner.learner_id);
        return NextResponse.json({
          success: true,
          alreadyProcessed: true,
          newBalanceFemtodollars: currentBalance.toString(),
        });
      }
    }

    const credits = dollarsToFemtodollars(creditDollars);
    const newBalance = await addCredits(learner.learner_id, credits, 'purchase', description, stripeSessionId);

    return NextResponse.json({
      success: true,
      creditDollars: creditDollars.toFixed(2),
      newBalanceFemtodollars: newBalance.toString(),
    });
  } catch (error) {
    console.error('add credits error', error);
    return NextResponse.json({ error: 'Failed to add credits' }, { status: 500 });
  }
}
