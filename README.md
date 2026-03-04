# l33tsp33k OSS

Open-source coding interview practice app with:
- Next.js frontend
- PostgreSQL-backed problem/catalog/progress data
- Pluggable LLM provider layer (`openai`, `anthropic`, `google`)

Production app: https://l33.bot

## OSS Scope

This OSS variant intentionally has:
- No auth
- No payments
- No Stripe/webhook flow

Users run it with DB + one LLM API key.

## Provider Support

Provider selection is controlled by `LLM_PROVIDER`:
- `openai` (default)
- `anthropic`
- `google`

Extensibility point:
- [lib/llm/provider.ts](/home/ai/Development/l33-bot-oss/lib/llm/provider.ts)

Add a new provider by implementing `generateJson` branch and env handling there.

## Quick Start (Local)

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:bootstrap
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

Always required:
- `DATABASE_URL`
- `BASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `LLM_PROVIDER`

Provider-specific required key:
- `OPENAI_API_KEY` when `LLM_PROVIDER=openai`
- `ANTHROPIC_API_KEY` when `LLM_PROVIDER=anthropic`
- `GOOGLE_API_KEY` when `LLM_PROVIDER=google`

See [.env.example](/home/ai/Development/l33-bot-oss/.env.example) for all variables.

## Database Setup

Create a PostgreSQL database, then run:

```bash
npm run db:migrate
npm run db:seed:catalog
```

or one-shot:

```bash
npm run db:bootstrap
```

## Scripts

- `npm run setup` - install + env validation + DB bootstrap
- `npm run env:check` - validate env for selected provider
- `npm run db:migrate` - apply schema
- `npm run db:seed:catalog` - seed catalog/curriculums
- `npm run db:bootstrap` - migrate + seed
- `npm run check` - lint + build + typecheck

## Docker (Optional)

```bash
cp .env.example .env.local
docker compose up --build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/l33 npm run db:bootstrap
```

## Deploying

### Vercel

1. Import repo into Vercel.
2. Set env vars from `.env.example` (at minimum required vars for your provider).
3. Deploy.

### Any Node Host

1. `npm install`
2. `npm run build`
3. Configure env vars
4. `npm run start`

## OSS Readiness Checklist

Before publishing:

```bash
npm run check
```

Ensure:
- no secrets committed
- `.env.example` is accurate
- migrations and seed scripts run from clean DB

## Agent Runbook

For deterministic agent-executable setup, see [AGENTS.md](/home/ai/Development/l33-bot-oss/AGENTS.md).

