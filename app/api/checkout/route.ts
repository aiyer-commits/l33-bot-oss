import { NextRequest, NextResponse } from 'next/server';
import { getOptionalUser } from '@/lib/auth';
import { ensureLearnerProfile } from '@/lib/db/repo';
import { getStripe } from '@/lib/stripe';

const CREDIT_PACK_DOLLARS = 40;

export async function POST(request: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user) {
      return NextResponse.json({ error: 'Login required for purchases' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const quantity = Math.max(1, Math.min(20, Number(body.quantity ?? 1)));

    const stripePrice = process.env.STRIPE_PRICE_ID_10 || process.env.STRIPE_PRICE_ID;
    if (!stripePrice) {
      return NextResponse.json({ error: 'Missing STRIPE_PRICE_ID_10/STRIPE_PRICE_ID' }, { status: 500 });
    }

    const learner = await ensureLearnerProfile({ userId: user.id, email: user.email ?? null });
    const stripe = getStripe();

    const baseUrl = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: stripePrice, quantity }],
      success_url: `${baseUrl}/?purchase=success`,
      cancel_url: `${baseUrl}/?purchase=cancel`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        userId: user.id,
        learnerId: learner.learner_id,
        creditDollars: (CREDIT_PACK_DOLLARS * quantity).toFixed(2),
        packageDollars: `${CREDIT_PACK_DOLLARS.toFixed(2)}`,
        quantity: String(quantity),
      },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('checkout error', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
