# Runtime And Agent Inventory

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This file contains 80 functional points across 6 source files.

## Contents

- [`index.ts`](#indexts)
- [`main.ts`](#maints)
- [`agent/loop.ts`](#agentloopts)
- [`agent/retry.ts`](#agentretryts)
- [`agent/loop-detection.ts`](#agentloop-detectionts)
- [`mock-model.ts`](#mock-modelts)

## `index.ts`

- **RT-001** - Read the CLI subcommand from `process.argv`.
- **RT-002** - Dynamically dispatch `init` to the configuration wizard and all other invocations to the Agent runtime.
- **RT-003** - Catch top-level async failures, print the error, and exit nonzero.

## `main.ts`

- **RT-004** - Load `.env` and parse typed application configuration during runtime bootstrap.
- **RT-005** - Construct an OpenAI-compatible chat model from configured base URL, key, and model name, with a mock-model fallback when the key is absent.
- **RT-006** - Initialize the tool registry with built-in tools and the deferred `tool_search` tool.
- **RT-007** - Initialize file-backed memory and expose it through an Agent tool.
- **RT-008** - Select real or mock embeddings, initialize the vector store, and expose RAG tools.
- **RT-009** - Connect an MCP client and register discovered tools under a server namespace.
- **RT-010** - Discover runtime skills and track the active-skill set separately from available skills.
- **RT-011** - Build the available-plugin catalog and load only plugins enabled by configuration.
- **RT-012** - Register configuration-driven pre-tool audit and post-Bash timestamp hooks.
- **RT-013** - Initialize Cron service state, expose Cron management as a tool, and attach the runtime executor.
- **RT-014** - Configure the sub-agent registry and expose a spawn context that shares model, tools, and system-prompt construction.
- **RT-015** - Compose the system prompt from core rules, tool guidance, deferred tools, memory, RAG, skills, and session pipes.
- **RT-016** - Create the channel gateway and conditionally register Feishu from configuration.
- **RT-017** - Compose all command-handler groups into one first-match dispatcher.
- **RT-018** - Build dynamic prompt context from active tool count, deferred-tool summary, and session metadata.
- **RT-019** - Order startup across MCP connection, plugin loading, channel startup, Cron loading, executor binding, and Cron scheduling.
- **RT-020** - Execute scheduled prompts in isolated message arrays and extract the last assistant text as the Cron result.
- **RT-021** - Route Cron notifications back to the interactive terminal.
- **RT-022** - Create the interactive readline loop and treat empty input or `exit` as shutdown.
- **RT-023** - Cleanly stop Cron and channels, unload plugins, and close readline during shutdown.
- **RT-024** - Distinguish synchronous commands, asynchronous commands, and normal Agent requests.
- **RT-025** - Timestamp and persist each user message before Agent execution.
- **RT-026** - Rebuild the system prompt for every turn, run the Agent, timestamp new messages, and append them to the session log.
- **RT-027** - Display an approximate context-token total after each normal turn.
- **RT-028** - Display startup state for role, active tools, sub-agent limits, and example commands.
- **RT-029** - Discover Markdown files under `docs/`, chunk and embed them, and automatically seed the knowledge store.
- **RT-030** - Re-enter the interactive prompt after commands and Agent turns through the shared `ask` continuation.

## `agent/loop.ts`

- **RT-031** - Reset loop-detection history at the beginning of each top-level Agent run.
- **RT-032** - Enforce a fixed maximum number of Agent steps.
- **RT-033** - Call `streamText` with the current system prompt, messages, and active tools.
- **RT-034** - Disable SDK-level retries so application retry policy owns retry behavior.
- **RT-035** - Enable provider-side parallel tool calls.
- **RT-036** - Stream text deltas to stdout while accumulating the full assistant text.
- **RT-037** - Track whether a step emitted any tool calls to decide whether another step is needed.
- **RT-038** - Log each tool call with its input and remember the latest call for result correlation.
- **RT-039** - Run loop detection before recording each new tool call.
- **RT-040** - Inject a user-role system reminder when loop detection emits a warning.
- **RT-041** - Stop the Agent when loop detection emits a critical result.
- **RT-042** - Log a bounded tool-result preview while retaining the full result in model messages.
- **RT-043** - Correlate tool results with the latest call and record result fingerprints for progress detection.
- **RT-044** - Retry retryable stream failures with application-controlled delays and clear partial per-attempt state.
- **RT-045** - Append the AI SDK response messages after a successful step.
- **RT-046** - Normalize provider usage and record per-step token and cost data.
- **RT-047** - Print cache-read or cache-write status only when caching activity occurred.
- **RT-048** - Accumulate input, output, cache-read, and cache-write tokens into one run budget.
- **RT-049** - Warn when the token budget passes 90 percent and stop after the full budget is exhausted.
- **RT-050** - Stop naturally when the model produces text without another tool call.
- **RT-051** - Report when execution stops because the maximum step count was reached.

## `agent/retry.ts`

- **RT-052** - Classify HTTP 429, 529, 408, and 5xx errors as retryable.
- **RT-053** - Classify other 4xx errors as non-retryable.
- **RT-054** - Recognize connection reset, broken pipe, timeout, fetch, network, and missing-output failures as retryable.
- **RT-055** - Calculate capped exponential backoff with a configurable base and maximum.
- **RT-056** - Apply plus-or-minus 25 percent random jitter and expose an async sleep primitive.

## `agent/loop-detection.ts`

- **RT-057** - Define structured call records and warning or critical detection results.
- **RT-058** - Produce deterministic object fingerprints by recursively sorting keys before serialization.
- **RT-059** - Hash tool name plus input and hash tool output separately with shortened SHA-256 fingerprints.
- **RT-060** - Retain a bounded sliding window of the 30 most recent calls.
- **RT-061** - Attach a result hash to the newest matching call that does not yet have a result.
- **RT-062** - Reset module-level detection history between top-level runs.
- **RT-063** - Count consecutive identical results for the same tool and arguments as a no-progress streak.
- **RT-064** - Detect alternating argument fingerprints as a ping-pong loop.
- **RT-065** - Trigger a global critical circuit breaker after a long no-progress streak.
- **RT-066** - Emit warning and critical levels for ping-pong repetition at separate thresholds.
- **RT-067** - Emit warning and critical levels for generic repeated calls with identical arguments.

## `mock-model.ts`

- **RT-068** - Enable or disable prompt-cache simulation and clear cached prefix state when disabled.
- **RT-069** - Fingerprint the system-prompt prefix and estimate tokens across text, tool calls, and tool results.
- **RT-070** - Simulate cache writes for new stable prefixes and cache reads for repeated prefixes above a minimum threshold.
- **RT-071** - Return AI SDK-compatible input, output, cached-input, and cache-creation usage fields.
- **RT-072** - Extract the latest user text and detect whether the current turn already contains tool results.
- **RT-073** - Aggregate recent tool-result content and detect whether `tool_search` was previously called.
- **RT-074** - Recognize a deterministic parallel-tool test and emit multiple independent calls.
- **RT-075** - Drive multi-step Dream, memory, RAG, plugin, deferred-MCP, filesystem, search, Bash, weather, and calculator demo intents.
- **RT-076** - Choose result-aware final text for memory, Dream, plugins, RAG, filesystem, weather, browser, and MCP outputs.
- **RT-077** - Simulate structured compaction output when invoked as the summarization model.
- **RT-078** - Simulate retry failures before succeeding, so retry policy can be exercised deterministically.
- **RT-079** - Implement non-streaming AI SDK generation for text, one or many tool calls, compaction, and retry scenarios.
- **RT-080** - Implement delayed AI SDK streaming for text deltas and complete tool-input/tool-call event sequences.
