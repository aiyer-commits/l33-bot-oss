# AGENTS: OSS Setup + Deployment

This repository is the OSS variant.

Runtime scope:
- No auth.
- No payment/credits purchase flow.
- DB-backed problem catalog/progress.
- OpenAI-backed chat tutoring.

## One-pass setup (local)

1. Install deps:
```bash
npm install
```

2. Create env:
```bash
cp .env.example .env.local
```

3. Fill required keys in `.env.local`:
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `BASE_URL`
- `NEXT_PUBLIC_APP_URL`

4. Validate env:
```bash
npm run env:check
```

5. DB bootstrap:
```bash
npm run db:bootstrap
```

6. Start:
```bash
npm run dev
```

## Docker flow (optional)

```bash
cp .env.example .env.local
docker compose up --build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/l33 npm run db:bootstrap
```

## Validation before PR

```bash
npm run check
```

