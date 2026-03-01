# l33tsp33k

Mobile-first conversational LeetCode 75 practice app for Vercel, powered entirely by `gpt-4.1-mini`.

## What It Does

- Uses a local LeetCode 75 dataset in strict order (`1 -> 75`)
- Keeps a local learner profile in `localStorage` (no database)
- Tracks progress conversationally from model outputs (no manual checkboxes)
- Lets user practice via chat, pseudocode, and Python code
- Includes a simple Python editor with a mobile key toolbar

## Data Source

LeetCode 75 list and problem statement seeds are derived from:
- https://github.com/brprojects/Leetcode_75

Dataset file:
- `data/leetcode75.json`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add environment variables in `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key
```

3. Run development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Vercel Deploy

1. Import repo in Vercel.
2. Set `OPENAI_API_KEY` in Project Environment Variables.
3. Deploy.

## Key Files

- `app/page.tsx` - mobile UI, chat, editor, local profile state
- `app/api/chat/route.ts` - `gpt-4.1-mini` orchestration with structured output
- `data/leetcode75.json` - ordered LC75 curriculum data
- `lib/types.ts` - profile/message/api types
- `lib/leetcode75.ts` - data helpers + profile initializer

## Notes

- No remote persistence is used.
- Progress is tied to browser storage on the user device.
- Reset button clears local session/profile to restart from problem #1.
