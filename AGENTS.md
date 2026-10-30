<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Grammigo

Mobile-first, adaptive English grammar app. Tagline: "Your grammar amigo." Mascot: Migo.

- Figma (source of truth for design): https://www.figma.com/design/pVtMUvpw0f0UPE0Rhxpn9m
- Stack: Next.js App Router, TypeScript (strict), Tailwind, Lucide, Vitest + React Testing Library, Playwright.
- v0.1 must run with no Supabase project and no AI keys. Content is local; persistence is versioned, validated localStorage.
- Do not add FastAPI, agent frameworks, Redis, queues, or other services. Do not put an AI call in the lesson navigation path.
- Never claim tests pass unless they were run. Do not deploy to production without explicit approval.

## Linear project management

Linear is the source of truth for project work. Project: **Grammigo** (`P-FAI-4`, team Failed Training).

When starting a development task:
1. Search Linear for an existing issue that matches the task.
2. If an appropriate issue exists, use it rather than creating a duplicate.
3. If no issue exists and the work is substantial enough to track, create an issue in the appropriate Linear project.
4. Move the issue to In Progress when implementation begins.

During implementation:
- Keep the Linear issue aligned with material scope changes.
- Do not create issues for trivial fixes discovered while completing the current issue.
- Create a new issue for substantial newly discovered work that should be handled separately.
- Include the Linear issue identifier in the branch/commit/PR where practical.

When finishing:
1. Run the required tests and verification.
2. Do not mark the issue Done if verification fails.
3. Add a concise Linear comment summarizing:
   - what changed
   - important files/components changed
   - tests/verification performed
   - any remaining limitations or follow-up work
4. Mark the issue Done only after the implementation and verification are complete.

Never mark an issue Done merely because code was written.
