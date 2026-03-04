# AGENTS: OSS Setup, Provider Wiring, and Public Publish

This is the OSS branch/fork.

## Runtime Contract

- No auth routes
- No payments/webhooks
- DB-backed catalog/progress
- LLM provider selected by `LLM_PROVIDER`

Providers:
- `openai`
- `anthropic`
- `google`

Primary extension file:
- [lib/llm/provider.ts](/home/ai/Development/l33-bot-oss/lib/llm/provider.ts)

## Deterministic Setup

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:bootstrap
npm run dev
```

## Provider Validation Matrix

Run these checks before merge:

1. OpenAI
```bash
LLM_PROVIDER=openai npm run env:check
```

2. Anthropic
```bash
LLM_PROVIDER=anthropic npm run env:check
```

3. Google
```bash
LLM_PROVIDER=google npm run env:check
```

## Quality Gate

```bash
npm run check
```

## Public Repo Publish via `gh`

From repo root:

1. Ensure auth:
```bash
gh auth status
```

2. Create public repo and push:
```bash
gh repo create l33-bot-oss --public --source=. --remote=origin --push
```

If `origin` already exists and points elsewhere:
```bash
git remote remove origin
gh repo create l33-bot-oss --public --source=. --remote=origin --push
```

## Marketing Link

Keep production link in docs:
- https://l33.bot

