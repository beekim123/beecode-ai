# CLI Agent Rules

This file adds CLI-specific rules to the repository root `AGENTS.md`. Do not duplicate or relax root rules here.

## Context

- Read `docs/development/phase-1-cli-development-design.md` for CLI architecture and behavior.
- Follow `docs/development/platform-development-guidelines.md` when a CLI change affects shared protocol, Backend, authentication, events, or another client.

## Boundaries

- The CLI owns terminal interaction and composition of its local Agent Runtime.
- Keep the Client SDK and Agent Protocol boundary intact even for in-process transport. The terminal layer must not call Agent Core directly.
- CLI data uses `surface = cli`; do not read or present Web, iOS, Android, or Desktop Sessions.
- Model access goes through the Beecode Backend. Do not add provider credentials to CLI configuration or environment documentation.
- Keep production source in `apps/cli/src/` and tests in `apps/cli/tests/`.

## Skill Routing

- Load `typescript-coding-standards` for TypeScript implementation or refactoring.
- Use `reference-ai-superagent` only for matching Agent/CLI architecture work and follow the root requirement to ask before inspecting the external reference implementation.
- Use `find-skills` when CLI-specific domain knowledge is missing; obtain approval before installation.

## Verification

Run commands from the repository root:

```bash
pnpm --filter @beecode/cli typecheck
pnpm --filter @beecode/cli test
```

Run `pnpm check` when shared packages or Backend behavior are affected. For a user-visible command flow, also run the narrowest relevant process E2E scenario from `apps/cli/tests/`.

## Prohibitions

- Do not collapse UI, transport, Runtime, tools, and persistence into the command entry point.
- Do not print access tokens, refresh tokens, provider details, or user secrets.
- Do not bypass protocol validation because the current transport is in-process.
- Do not add tests under `src/`.
