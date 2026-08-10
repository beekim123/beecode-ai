# CLI And Configuration Inventory

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This file contains 46 functional points across 15 source files.

## Contents

- [Configuration](#configuration)
- [Command framework](#command-framework)
- [Commands](#commands)

## Configuration

### `config/schema.ts`

- **CC-001** - Validate model provider, model name, base URL, and API key with defaults.
- **CC-002** - Validate plugin name, enabled state, and string configuration map.
- **CC-003** - Validate Feishu enablement, credentials, port, and nested channel defaults.
- **CC-004** - Validate sub-agent depth, concurrency ranges, and default timeout.
- **CC-005** - Validate security role label, audit logging, and Bash timestamp settings.
- **CC-006** - Validate memory data-directory settings.
- **CC-007** - Validate RAG enablement and document-directory settings.
- **CC-008** - Validate Cron enablement and data-directory settings.
- **CC-009** - Validate session identity.
- **CC-010** - Validate usage-tracking output path.
- **CC-011** - Compose every domain schema into a fully defaulted application configuration and infer its TypeScript type.

### `config/loader.ts`

- **CC-012** - Recursively substitute `${ENV_VAR}` references inside strings, arrays, and objects.
- **CC-013** - Warn and preserve the original placeholder when an environment variable is missing.
- **CC-014** - Fall back to fully parsed defaults when the configuration file does not exist.
- **CC-015** - Parse JSON with a clear fatal diagnostic for malformed files.
- **CC-016** - Apply Zod defaults and validation after environment substitution.
- **CC-017** - Print path-specific validation issues and exit on invalid configuration.

### `config/init.ts`

- **CC-018** - Run an interactive readline initialization wizard.
- **CC-019** - Confirm before overwriting an existing configuration file.
- **CC-020** - Offer Qwen model presets with a recommended default.
- **CC-021** - Accept a direct DashScope key or generate an environment placeholder.
- **CC-022** - Optionally collect Feishu credentials and enablement.
- **CC-023** - Collect the sub-agent concurrency limit with a default.
- **CC-024** - Generate a complete formatted configuration covering all runtime domains.
- **CC-025** - Write only directly entered secrets to `.env`, then close the wizard with startup guidance.

## Command Framework

### `commands/index.ts`

- **CC-026** - Define shared command context for messages, timestamps, tools, prompt builder, usage, sessions, model, continuation, and optional feature stores.
- **CC-027** - Model handlers as unhandled, synchronously handled, or asynchronously handled through a sentinel.
- **CC-028** - Dispatch handlers in registration order and stop at the first handled result.

## Commands

### `commands/agents.ts`

- **CC-029** - List every sub-agent run with status-specific detail and summarize active, completed, failed, depth, and concurrency state.

### `commands/channel.ts`

- **CC-030** - List registered channel names and descriptions with an explicit empty state.

### `commands/context.ts`

- **CC-031** - Build and render the current context snapshot from prompt, tools, memory, skills, and messages.
- **CC-032** - Render aggregate usage, cache, cost, and savings through `/usage`.

### `commands/debug.ts`

- **CC-033** - Inject timestamped synthetic long-conversation and large tool-result data for context testing.
- **CC-034** - Execute and report the three-layer context-defense transformation.
- **CC-035** - Display message, token, memory, and knowledge-base status.
- **CC-036** - Toggle mock prompt-cache behavior from the CLI.

### `commands/dream.ts`

- **CC-037** - Run a staged Agent-driven memory-maintenance workflow, persist its messages, and resume the interactive prompt asynchronously.

### `commands/memory.ts`

- **CC-038** - List memory metadata and perform CLI BM25 memory search.

### `commands/plugin.ts`

- **CC-039** - List loaded and available plugins, asynchronously load named plugins, and unload them with tool cleanup feedback.

### `commands/rag.ts`

- **CC-040** - Report knowledge-base size and sources and asynchronously invoke document ingestion from a path.

### `commands/security.ts`

- **CC-041** - Get or switch the active owner, collaborator, or guest role and report resulting tool count.
- **CC-042** - List registered pre-tool and post-tool hooks.

### `commands/skill.ts`

- **CC-043** - List available runtime skills with active state and usage hints.
- **CC-044** - Activate or deactivate a named skill without changing the on-disk catalog.
- **CC-045** - Treat `/<skill-name> [args]` as direct activation, inject skill content and user arguments, execute the Agent asynchronously, persist resulting messages, and resume input.

### `commands/cron.ts`

- **CC-046** - List scheduled job status, show recent execution logs, and provide usage guidance for unknown Cron subcommands.
