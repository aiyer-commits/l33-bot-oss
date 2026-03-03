# l33tsp33k OSS

Mobile-first coding interview practice bot using:
- Next.js
- PostgreSQL
- OpenAI API

This OSS variant has no auth and no payments.

## Quick Start

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:bootstrap
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `BASE_URL`
- `NEXT_PUBLIC_APP_URL`

## Scripts

- `npm run setup` - install + env validation + DB bootstrap
- `npm run db:migrate` - apply schema
- `npm run db:seed:catalog` - seed problems/curriculums
- `npm run db:bootstrap` - migrate + seed
- `npm run check` - lint + build + typecheck

## Docker (Optional)

```bash
docker compose up --build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/l33 npm run db:bootstrap
```

## Agent Runbook

See [AGENTS.md](./AGENTS.md) for deterministic agent-executable setup.

