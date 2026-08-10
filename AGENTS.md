# Beecode Agent Rules

## Rule Entry Points

`AGENTS.md` is the canonical project rule file for Codex. `CLAUDE.md` is the Claude Code entry point and must remain a symbolic link to this file so both agents follow the same rules.

## Skills

Project skills live in `.agents/skills/`. Use progressive loading so task-specific instructions do not consume context unnecessarily.

1. At the start of a task, read only `.agents/skills/INDEX.md` to identify possible matches.
2. Read a skill's `SKILL.md` only when the user explicitly invokes it, unless its frontmatter permits model invocation and the task clearly matches its description.
3. After loading a skill, read only the references, templates, or scripts that it directly requires for the current task.
4. Do not bulk-read skill directories or preload unrelated skills.
5. When adding or removing a skill, update `.agents/skills/INDEX.md` in the same change.
6. New skills must support both primary coding agents: add the canonical skill under `.agents/skills/<skill-name>/` for Codex and create `.claude/skills/<skill-name>` as a symbolic link to it for Claude Code. When removing a skill, remove both agent entries. Keep one canonical copy; do not duplicate skill content.
7. When a task requires domain knowledge that no installed skill covers, search [skills.sh](https://www.skills.sh/) for relevant skills. Present the best match, its source, and why it applies, then ask the user for approval before installing anything.

## Product Documentation

When the user explicitly asks for product requirements, a feature specification, or a PRD synthesized from an already-discussed request, load `.agents/skills/to-spec/SKILL.md`.

## Testing Layout

- Test files must live in a dedicated test directory, never alongside production files in `src/`.
- Use `<workspace>/tests/` as the default location, mirroring the production source tree when that improves discoverability. For example, test `src/provider/openai.ts` in `tests/provider/openai.test.ts`.
- Do not add `*.test.*` or `*.spec.*` files under `src/`. Keep test-only fixtures, helpers, and setup code under the same `tests/` directory unless they are a reusable testing package.
- When introducing a separate test directory, ensure the test and type-check commands include it without compiling test files into production output.

## AI SuperAgent Reference

`/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src` is an optional TypeScript reference implementation for CLI agent architecture, including agent loops, tools, context management, multi-agent execution, memory, RAG, sessions, plugins, channels, scheduling, security, and usage tracking.

When an implementation or design task overlaps one of these areas:

1. Use `.agents/skills/reference-ai-superagent/SKILL.md` to identify the relevant reference modules.
2. Before opening implementation files under the reference project or adopting its patterns, tell the user which design area is relevant and ask whether to reference its approach for the current task.
3. Do not ask again when the user already requested that reference for the current task. If the user declines, continue from this repository's requirements and conventions without inspecting the reference implementation.
4. Treat the project as a design reference, not a dependency or source of truth. Adapt approved ideas to this repository; do not add cross-repository imports, copy code mechanically, or override local architecture and requirements.
5. In the final handoff, briefly identify the reference files consulted and which patterns were adopted or rejected.
