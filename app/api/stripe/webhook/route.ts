import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { addCredits, ensureLearnerProfile } from '@/lib/db/repo';
import { dollarsToFemtodollars } from '@/lib/pricing';

export async function POST(request: Request) {
  const stripe = getStripe();
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing webhook signature config' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('stripe webhook signature failure', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const learnerId = session.metadata?.learnerId;
    const quantity = Number(session.metadata?.quantity ?? '1');

    if (userId && learnerId && session.id) {
      const learner = await ensureLearnerProfile({ userId });
      const credits = dollarsToFemtodollars(10 * Math.max(1, quantity));
      await addCredits(learner.learner_id, credits, 'purchase', '$10 credit pack purchase', session.id);
    }
  }

  return NextResponse.json({ received: true });
}
