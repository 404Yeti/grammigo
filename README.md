# Grammigo

Your grammar amigo. Mobile-first English grammar practice, with Migo as your guide.

v0.1 is a complete, playable lesson: **Present Perfect vs. Past Simple** (8 exercises). It needs no Supabase project, no AI keys and no backend. Content is local; progress is saved in the browser (`localStorage`, key `grammigo:v1`).

## Run

```bash
npm install
npm run dev          # http://localhost:3000
```

## Test

```bash
npm test             # Vitest: unit + component tests
npm run e2e          # builds, then Playwright (mobile + desktop)
npm run e2e:only     # Playwright against an existing build
npm run typecheck && npm run lint
```

## Structure

- `src/data` lesson content and grammar skills (no UI)
- `src/features/practice` grading, session state machine, summary, review, screens
- `src/features/mastery` evidence + deterministic next-step recommendation
- `src/lib/storage` versioned, validated localStorage store
- `src/components` ui, layout, mascot, lesson, exercises, feedback, progress
- `e2e` Playwright journeys

Attempt classifications (from the Figma notes): `correct_first_try`, `correct_after_hint`, `correct_after_retry`, `incorrect`.

## v0.2: adaptive onboarding, CEFR curriculum, optional AI

- New learners meet Migo, say (or type) what is hard, take a short adaptive check, see a provisional profile, and start a recommended lesson. Nobody picks a CEFR level.
- Curriculum: `src/curriculum` (zod-validated; 13 curated A1–B2 lessons; C1/C2 supported by the schema, none authored).
- Deterministic engines: `src/features/diagnostic` (quiz selection), `src/features/learning` (mastery, profile, recommendations).
- Progress is stored in `localStorage` (`grammigo:v2`); v0.1 data (`grammigo:v1`) is migrated and left untouched as a backup.

### Optional OpenAI features (off by default)

Goal interpretation, voice transcription and writing feedback run **server-side only**. Without AI, typing + offline keyword matching + "saved for review" keep everything working.

1. Copy `.env.example` to `.env.local` (gitignored) and set `OPENAI_API_KEY` and `AI_FEATURES_ENABLED=true`.
2. On Vercel, add the same variables in Project → Settings → Environment Variables (mark the key Sensitive). Never use a `NEXT_PUBLIC_` prefix.
3. Before enabling in **production**, configure `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (durable rate limiting + daily budget). Without them the endpoints refuse to run in production.

Test commands: `npm test`, `npm run e2e`, `npm run typecheck`, `npm run lint`.
