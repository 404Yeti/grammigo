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
