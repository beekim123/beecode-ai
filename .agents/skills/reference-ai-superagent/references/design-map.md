# AI SuperAgent Design Map

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This inventory covers all 67 TypeScript source files through 421 functional design points. Select one or more domains here, then load the corresponding detailed inventory directly from `SKILL.md`.

| Domain | Points | Files | Primary scope |
| --- | ---: | ---: | --- |
| Runtime and Agent | 80 | 6 | CLI startup, runtime composition, model selection and simulation, Agent Loop, retry, and loop detection. |
| Tools and Security | 101 | 16 | Tool contracts and execution, MCP, deferred discovery, concrete tools, permissions, Bash risk, and hooks. |
| Context and Knowledge | 102 | 15 | Prompt assembly, context defense and visualization, memory, RAG, session persistence, and usage accounting. |
| Extensions and Operations | 92 | 15 | Multi-agent, channels, plugins, runtime skills, and scheduled work. |
| CLI and Configuration | 46 | 15 | Zod configuration, environment loading, initialization wizard, command dispatch, and all commands. |
| **Total** | **421** | **67** | Complete `src/**/*.ts` coverage. |

## Route By Task

| Task signal | Detailed inventory | Typical entry files |
| --- | --- | --- |
| startup, lifecycle, model, loop, retry, stuck calls, mock model | `runtime-agent.md` | `index.ts`, `main.ts`, `agent/`, `mock-model.ts` |
| tool, MCP, schema, concurrency, permissions, hook, shell, web | `tools-security.md` | `tools/`, `security/` |
| prompt, token, compaction, memory, retrieval, session, cost | `context-knowledge.md` | `context/`, `memory/`, `rag/`, `session/`, `usage/` |
| sub-agent, channel, Feishu, plugin, skill loader, cron scheduler | `extensions-operations.md` | `agents/`, `channels/`, `plugins/`, `skills/`, `cron/` |
| config, init wizard, slash command, debug command | `cli-configuration.md` | `config/`, `commands/` |

## Cross-Cutting Reading Order

1. Start from the exact functional point in the selected detailed inventory.
2. Read its named implementation file and local types.
3. Read a tool or command adapter only when the feature is exposed to the model or CLI.
4. Read `config/schema.ts` only when behavior is configurable.
5. Read `main.ts` last when composition or lifecycle wiring matters.

Common flows:

- Agent request: `main.ts` -> `context/prompt-builder.ts` -> `agent/loop.ts` -> `tools/registry.ts`.
- Multi-agent call: `tools/spawn-tools.ts` -> `agents/spawn.ts` -> `agents/registry.ts` -> `agent/loop.ts`.
- Memory context: `memory/store.ts` -> `context/prompt-pipes.ts` -> `context/prompt-builder.ts`.
- RAG query: `tools/rag-tools.ts` -> `rag/embedder.ts` -> `rag/search.ts` or `rag/sqlite-store.ts`.
- Tool safety: `tools/registry.ts` -> `security/roles.ts` -> `security/bash-classifier.ts` -> `security/hooks.ts`.
- Scheduled Agent: `cron/service.ts` -> executor in `main.ts` -> `agent/loop.ts` -> run log in `cron/store.ts`.
- Channel message: `channels/feishu.ts` -> `channels/gateway.ts` -> `agent/loop.ts` -> channel send.

## Comparison Checklist

- Verify TypeScript, runtime, model SDK, persistence, and tool-schema compatibility.
- Treat global mutable state, hard-coded thresholds, mock branches, and local filesystem assumptions as reference choices, not requirements.
- Verify cancellation, timeouts, idempotency, concurrent state, cleanup, security, and error propagation against the current task.
- Prefer current-repository contracts and tests when they differ from the reference.
- Do not copy known inconsistencies or incomplete placeholders without correcting them for the current architecture.
