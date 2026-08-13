# Web Agent Rules

This file adds Web-specific rules to the repository root `AGENTS.md`. Do not duplicate or relax root rules here.

## Context

- Read `docs/development/phase-2-web-development-design.md` for Web architecture, interaction, authentication, and recovery behavior.
- Follow `docs/development/platform-development-guidelines.md` when a Web change affects shared protocol, Backend, authentication, events, or another client.

## Boundaries

- The Web app is a React 19 and Vite operational Agent workspace, not a marketing landing page.
- Access Backend behavior through `@beecode/client-sdk` and shared protocol types. Components must not construct private API contracts or assign authoritative Runtime terminal states.
- Web data uses `surface = web`; do not reuse CLI or mobile routes, credentials, or Sessions.
- Treat the Backend snapshot as authoritative. Merge SSE events by protocol sequence and recover from reconnects through a fresh snapshot.
- Keep production source in `apps/web/src/`, unit/integration tests in `apps/web/tests/`, and Playwright tests in `apps/web/tests/e2e/`.

## Skill Routing

- Load `typescript-coding-standards` for TypeScript or TSX implementation and refactoring.
- Also load `vercel-react-best-practices` for React components, state flow, rendering, data fetching, or performance work.
- Load `playwright-best-practices` for Playwright and browser E2E work.
- Load `web-design-guidelines` for UI or accessibility review, and `ux-audit` only for an interactive audit of a running app.
- Load `design-taste-frontend` only for presentation-oriented brand or landing surfaces, not routine workspace UI work.

## Verification

Run commands from the repository root:

```bash
pnpm --filter @beecode/web typecheck
pnpm --filter @beecode/web test
pnpm --filter @beecode/web build
```

Run `pnpm --filter @beecode/web test:e2e` for changed user workflows and `pnpm check` when shared packages or Backend behavior are affected.

## Prohibitions

- Do not store access tokens, refresh tokens, provider keys, or development secrets in browser storage or the bundle.
- Do not add Web-only copies of shared protocol DTOs when an exported shared type exists.
- Do not replace real loading, error, empty, cancellation, and reconnect behavior with static mock UI in a completed slice.
- Do not add tests under `src/`.
