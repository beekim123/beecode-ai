# Backend Agent Rules

This file adds Backend-specific rules to the repository root `AGENTS.md`. Do not duplicate or relax root rules here.

## Context

- Follow `docs/development/platform-development-guidelines.md` for cross-platform changes.
- Read the phase design for every surface affected by the task: Phase 1 for CLI, Phase 2 for Web, and Phase 3 for iOS.
- Treat changes to authentication, OpenAPI, events, persistence, Runtime behavior, or surface ownership as shared-contract work.

## Boundaries

- The Backend is a Node.js TypeScript application using Hono.
- Keep HTTP parsing, validation, authentication, and response mapping at the application edge. Put shared public types and schemas in `packages/protocol`.
- Enforce account ownership and surface from authenticated server context. Never accept a request body or query value as authority to switch surface.
- Provider credentials and provider-specific response handling stay in the Backend model gateway boundary.
- Reuse shared Agent Runtime behavior. Do not create surface-specific copies that differ only by route names or a surface string.
- Keep production source in `apps/backend/src/` and tests in `apps/backend/tests/`.

## Skill Routing

- Load `typescript-coding-standards` for TypeScript implementation or refactoring.
- Also load `hono` for routes, middleware, validation, streaming, error handling, or Hono tests.
- Use `reference-ai-superagent` only for matching Agent architecture work and follow the root requirement to ask before inspecting the external reference implementation.
- Use `find-skills` only when the index has no relevant domain skill; obtain approval before installation.

## Verification

Run commands from the repository root:

```bash
pnpm --filter @beecode/backend typecheck
pnpm --filter @beecode/backend test
```

Run `pnpm check` when shared packages or another application are affected. `test:smoke` is a provider integration check and is required only when the task changes real-provider behavior and the required credentials are available.

## Prohibitions

- Do not expose provider keys, raw provider errors, internal stack traces, refresh tokens, or development secrets through public responses or logs.
- Do not let mobile or Web clients execute Backend tools or assign authoritative Turn/ToolCall terminal states.
- Do not add tests under `src/`.
