---
name: reference-ai-superagent
description: Map CLI and agent-system design tasks to the complete feature inventory of the optional TypeScript implementation at /Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src. Use when designing or implementing agent loops, tool infrastructure, context management, multi-agent execution, memory, RAG, sessions, skills, plugins, channels, scheduling, security, configuration, or usage tracking, so Codex can ask whether to consult the exact matching reference files and then adapt approved patterns to the current repository.
---

# Reference AI SuperAgent

Use the external project only as an optional design reference. Preserve the current repository's contracts, conventions, dependencies, and product requirements.

## Workflow

1. Read [references/design-map.md](references/design-map.md) and identify only the design domains relevant to the task.
2. If the user has not already approved this reference for the current task, name the relevant area and ask one concise question before opening files under the reference root.
3. If the user declines, do not inspect the reference implementation. Continue using the current repository as the authority.
4. If the user approves, load only the matching detailed inventory below, verify that the reference root exists, then open only the mapped files and any imports needed to understand their behavior.
5. Compare the reference with the current repository before editing: contracts, lifecycle, state ownership, failure handling, concurrency, persistence, security boundaries, and tests.
6. Adopt ideas selectively. Do not create cross-repository imports, assume dependency compatibility, or copy code without reconciling types, licenses, runtime assumptions, and local behavior.
7. Validate the resulting implementation in the current repository.
8. In the final handoff, list the reference files consulted and summarize what was adopted, changed, or deliberately not used.

## Detailed Inventories

- Runtime startup, model simulation, Agent Loop, retry, and loop detection: [references/runtime-agent.md](references/runtime-agent.md)
- Tool registry, MCP, built-in and feature tools, permissions, Bash risk, and hooks: [references/tools-security.md](references/tools-security.md)
- Prompt/context, compaction, memory, RAG, sessions, and usage accounting: [references/context-knowledge.md](references/context-knowledge.md)
- Multi-agent, channels, plugins, runtime skills, and Cron services: [references/extensions-operations.md](references/extensions-operations.md)
- Configuration and every CLI command surface: [references/cli-configuration.md](references/cli-configuration.md)

The inventories contain 421 functional design points and cover all 67 TypeScript files under the reference root. Do not load all five files unless the task genuinely spans every domain.

## Reference Boundary

- Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`
- Use paths in the design map relative to that root.
- If the root is unavailable or has moved, report that once and proceed without it unless the user supplies a new path.
- Do not modify the reference project unless the user explicitly asks for changes there.

## Confirmation Example

Use a task-specific question, for example:

> This task touches tool registration and deferred discovery. Should I reference the corresponding AI_SuperAgent implementation before I design it here?

Do not ask a generic question when the relevant design area can be named. Do not repeat the question after approval or refusal within the same task.
