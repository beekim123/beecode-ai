# Tools And Security Inventory

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This file contains 101 functional points across 16 source files.

## Contents

- [`tools/registry.ts`](#toolsregistryts)
- [`tools/mcp-client.ts`](#toolsmcp-clientts)
- [`tools/tool-search.ts` and `tools/index.ts`](#toolstool-searchts-and-toolsindexts)
- [Built-in tools](#built-in-tools)
- [Feature tools](#feature-tools)
- [Security](#security)

## `tools/registry.ts`

- **TS-001** - Define a tool contract with JSON Schema parameters, execution, concurrency, read-only, result-size, profile, deferred-loading, and search metadata.
- **TS-002** - Register or replace multiple tools in a name-keyed registry.
- **TS-003** - Unregister a tool and remove its deferred-discovery state.
- **TS-004** - Connect to an MCP server and discover its tools.
- **TS-005** - Namespace MCP tools as `mcp__<server>__<tool>` and skip duplicate names.
- **TS-006** - Assign MCP tools safe/read-only, full-profile, deferred, search-hint, and result-limit defaults.
- **TS-007** - Route namespaced MCP execution back to the original server tool name.
- **TS-008** - Track MCP clients and close every client during shutdown.
- **TS-009** - Set and read the active tool profile.
- **TS-010** - Set and read the current authorization role.
- **TS-011** - Attach a pre/post execution Hook pipeline.
- **TS-012** - Mark individual deferred tools as discovered.
- **TS-013** - Retrieve one tool or all registered tools.
- **TS-014** - Filter active tools by profile membership.
- **TS-015** - Hide deferred tools until they are discovered.
- **TS-016** - Hide tools that the current role cannot use.
- **TS-017** - Render a compact prompt summary of still-hidden deferred tools and their search hints.
- **TS-018** - Discover a deferred tool by exact name rather than fuzzy matching.
- **TS-019** - Discover several exact tool names from a comma-separated query.
- **TS-020** - Mark successfully searched tools as active for later model calls.
- **TS-021** - Estimate active and deferred tool-schema token costs separately.
- **TS-022** - Let concurrency-safe tools share execution while no exclusive tool holds the lock.
- **TS-023** - Make exclusive tools wait for both the exclusive lock and all concurrent tools.
- **TS-024** - Wake queued executions when lock state changes.
- **TS-025** - Convert active tools into AI SDK format without lock, Bash, or Hook wrapping for isolated sub-agents.
- **TS-026** - Exclude selected tools, such as recursive spawning, from the unlocked format.
- **TS-027** - Convert raw JSON Schema objects through the AI SDK `jsonSchema` adapter.
- **TS-028** - Run Bash risk classification before hooks and execution.
- **TS-029** - Reject dangerous Bash commands and log moderate-risk commands.
- **TS-030** - Run pre-tool hooks and short-circuit blocked operations.
- **TS-031** - Replace tool input when a pre-hook returns a modified input.
- **TS-032** - Choose shared or exclusive execution from the tool's concurrency metadata.
- **TS-033** - Normalize non-string tool results to formatted JSON.
- **TS-034** - Apply per-tool or default result-length limits.
- **TS-035** - Run post-tool hooks and replace output when requested.
- **TS-036** - Release execution locks in `finally` even when a tool throws.
- **TS-037** - Truncate oversized text with a 60 percent head, 40 percent tail, and omitted-character count.

## `tools/mcp-client.ts`

- **TS-038** - Spawn a stdio MCP subprocess with merged process and server-specific environment variables.
- **TS-039** - Surface subprocess startup errors and drain server stderr.
- **TS-040** - Parse line-delimited JSON-RPC responses and correlate them to pending requests.
- **TS-041** - Reject pending requests when the MCP response contains a protocol error.
- **TS-042** - Perform the MCP `initialize` handshake with protocol and client metadata.
- **TS-043** - Send the `notifications/initialized` notification after negotiation.
- **TS-044** - Allocate monotonic request IDs and maintain resolve/reject callbacks per request.
- **TS-045** - Enforce a per-request timeout and remove timed-out requests from the pending map.
- **TS-046** - Request the MCP tool catalog through `tools/list`.
- **TS-047** - Invoke tools through `tools/call` with protocol-shaped arguments.
- **TS-048** - Flatten text content blocks into one response with an empty-result fallback.
- **TS-049** - Close readline and terminate the MCP child process.
- **TS-050** - Provide a deterministic mock MCP client with sample GitHub tools and responses.

## `tools/tool-search.ts` And `tools/index.ts`

- **TS-051** - Expose `tool_search` as a concurrency-safe, read-only tool with an exact-name query.
- **TS-052** - Return full name, description, and parameter schemas for newly discovered tools.
- **TS-053** - Aggregate and export the built-in tool set, selecting the web-search provider at startup.

## Built-In Tools

### `tools/file-tools.ts`

- **TS-054** - Resolve and read UTF-8 files with existence checks and registry-level output truncation.
- **TS-055** - Overwrite a resolved file path and report the number of characters written.
- **TS-056** - Perform exact string replacement only when the target exists exactly once.
- **TS-057** - Return specific edit errors for missing files, zero matches, and ambiguous multiple matches.
- **TS-058** - List directory entries with file/directory markers and tolerate per-entry stat failures.

### `tools/search-tools.ts`

- **TS-059** - Translate `*` and `**` glob patterns into recursive regular expressions.
- **TS-060** - Recursively glob while skipping `.git` and `node_modules`, cap results, and sort output.
- **TS-061** - Search a file or directory with a case-insensitive user-provided regular expression.
- **TS-062** - Skip common generated directories and binary extensions during grep.
- **TS-063** - Return grep results as relative path, line number, and line text, capped with a truncation marker.

### `tools/shell-tools.ts`

- **TS-064** - Probe whether synchronous shell execution is available before accepting Bash work.
- **TS-065** - Execute shell commands with a timeout, bounded buffer, and captured stdout/stderr.
- **TS-066** - Format successful no-output commands and failed exit results distinctly.

### `tools/utility-tools.ts`

- **TS-067** - Provide deterministic city-weather sample data as a safe read-only tool.
- **TS-068** - Evaluate calculator expressions and return a controlled error string on failure.

### `tools/web-search.ts`

- **TS-069** - Query Tavily with API-key validation, result limits, and an optional AI-generated answer.
- **TS-070** - Format Tavily titles, URLs, and content snippets for model consumption.
- **TS-071** - Query Serper with API-key validation and Google result limits.
- **TS-072** - Format Serper Knowledge Graph data and bounded organic results.
- **TS-073** - Select Tavily first, then Serper, from environment availability, with a missing-key Tavily fallback.
- **TS-074** - Fetch a URL with browser-like headers and a 15-second abort timeout.
- **TS-075** - Convert fetched HTML to Markdown and remove scripts, styles, navigation, headers, footers, and iframes.
- **TS-076** - Convert HTTP and network failures into tool-readable error text.

## Feature Tools

### `tools/memory-tools.ts`

- **TS-077** - Expose memory through one action-discriminated schema supporting save, list, search, read, delete, and lint.
- **TS-078** - Validate save inputs, default the description, and report the generated memory filename.
- **TS-079** - List typed memory metadata without loading full memory content.
- **TS-080** - Return the top five BM25 memory hits with scores and metadata.
- **TS-081** - Read and delete memory by filename with missing-file feedback.
- **TS-082** - Render lint issues with content previews and direct remediation guidance.

### `tools/rag-tools.ts`

- **TS-083** - Ingest a UTF-8 document through chunking, embedding, and batch vector-store insertion.
- **TS-084** - Report ingestion failures and resulting knowledge-base size.
- **TS-085** - Search the knowledge store with configurable top-K and an empty-store guard.
- **TS-086** - Format source, combined score, vector score, keyword score, and bounded chunk previews.

### `tools/cron-tools.ts`

- **TS-087** - Expose list, add, remove, run, enable, disable, and logs through one Cron management tool.
- **TS-088** - Infer interval, one-time, or Cron schedule type from the submitted expression.
- **TS-089** - Construct runtime-owned Agent-prompt jobs with required-field validation.
- **TS-090** - Format job state and latest-run metadata for list requests.
- **TS-091** - Route removal, immediate execution, enabling, and disabling to the Cron service.
- **TS-092** - Return the five most recent job logs with bounded output previews.

### `tools/spawn-tools.ts`

- **TS-093** - Accept either one child task or an array of independent tasks.
- **TS-094** - Dispatch arrays through parallel spawning and aggregate labeled Markdown results.
- **TS-095** - Dispatch a single task through `spawnAgent` and reject empty requests.

## Security

### `security/roles.ts`

- **TS-096** - Model owner, collaborator, and guest identities and role names.
- **TS-097** - Define unrestricted owner access, collaborator Bash denial, and a guest read-only allowlist.
- **TS-098** - Apply deny rules before wildcard or explicit allow rules and filter tool-name lists by role.

### `security/bash-classifier.ts`

- **TS-099** - Classify destructive, privileged, device-writing, remote-script, permission, and `eval` patterns as dangerous.
- **TS-100** - Classify deletion, movement, permission, process, push, reset, publish, and container-removal patterns as moderate, with dangerous rules taking precedence.

### `security/hooks.ts`

- **TS-101** - Register, list, and sequentially execute pre/post hooks with allow, block, and modify semantics; chain modified values and isolate hook failures without crashing tool execution.
