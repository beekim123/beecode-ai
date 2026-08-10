# Extensions And Operations Inventory

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This file contains 92 functional points across 15 source files.

## Contents

- [Multi-agent](#multi-agent)
- [Channels](#channels)
- [Plugins](#plugins)
- [Runtime skills](#runtime-skills)
- [Scheduled work](#scheduled-work)

## Multi-Agent

### `agents/types.ts`

- **EO-001** - Define maximum spawn depth, maximum concurrency, and default timeout configuration.
- **EO-002** - Provide conservative default limits for depth, concurrency, and timeout.
- **EO-003** - Model spawn requests with task text, optional tool selection, and optional timeout.
- **EO-004** - Model run state with lifecycle status, depth, timestamps, result, and error.

### `agents/registry.ts`

- **EO-005** - Merge caller-supplied partial configuration over sub-agent defaults.
- **EO-006** - Generate readable run IDs from a counter and timestamp suffix.
- **EO-007** - Reject spawning at or above the configured nesting depth.
- **EO-008** - Reject spawning when active runs reach the concurrency limit.
- **EO-009** - Register new run records in a name-keyed map.
- **EO-010** - Transition runs to completed with result and finish time.
- **EO-011** - Transition runs to error with diagnostic text and finish time.
- **EO-012** - Retrieve one run, active runs, all runs, or effective configuration.

### `agents/spawn.ts`

- **EO-013** - Define spawn context containing the shared model, tool registry, run registry, prompt builder, and current depth.
- **EO-014** - Gate every spawn through depth and active-concurrency checks.
- **EO-015** - Register a running child record before model execution.
- **EO-016** - Assign stable colorized terminal tags to parallel children.
- **EO-017** - Create an isolated message history beginning with only the child task.
- **EO-018** - Extend the parent system prompt with concise child-agent and parallel-tool guidance.
- **EO-019** - Exclude `spawn_agent` to prevent recursive self-spawning.
- **EO-020** - Use the unlocked tool format so a parent-held spawn call does not deadlock child tools.
- **EO-021** - Enforce child timeout through `AbortController`.
- **EO-022** - Run a bounded child tool loop with parallel tool calls enabled.
- **EO-023** - Force the final child step to produce a text summary without tools.
- **EO-024** - Log child step progress and compact previews of tool arguments.
- **EO-025** - Append child response messages and stop when no tool call remains.
- **EO-026** - Extract the final assistant result from string or text-part content.
- **EO-027** - Mark registry state completed, error, or timeout and return structured failure text.
- **EO-028** - Return the newest partial assistant text when timeout occurs after useful work.
- **EO-029** - Compute available parallel capacity from configured maximum minus active children.
- **EO-030** - Execute accepted child tasks concurrently with `Promise.all`.
- **EO-031** - Reject excess tasks explicitly while retaining their position in the aggregate result.

## Channels

### `channels/types.ts`

- **EO-032** - Define transport-neutral incoming messages with channel, sender, text, and raw payload.
- **EO-033** - Define outgoing messages with channel, recipient, and text.
- **EO-034** - Define channel lifecycle, send, and optional inbound-handler contracts.

### `channels/gateway.ts`

- **EO-035** - Register channels by name and bind their inbound callback to the gateway.
- **EO-036** - Start every channel while isolating and logging per-channel startup failures.
- **EO-037** - Stop all registered channels during shutdown.
- **EO-038** - Maintain independent in-memory conversations by channel name and sender ID.
- **EO-039** - Adapt inbound channel text into a user model message.
- **EO-040** - Build the current system prompt and run the shared Agent Loop for a channel message.
- **EO-041** - Extract reply text from string or structured assistant content.
- **EO-042** - Adapt and send the reply through the originating channel.
- **EO-043** - List channel names and descriptions for CLI status.

### `channels/feishu.ts`

- **EO-044** - Implement the generic channel contract for Feishu.
- **EO-045** - Always start a local dashboard, even when Feishu credentials are absent.
- **EO-046** - Degrade to dashboard-only testing when App ID or secret is missing.
- **EO-047** - Lazily import the Feishu SDK only when a real connection is configured.
- **EO-048** - Create an authenticated Feishu API client and long-connection event dispatcher.
- **EO-049** - Accept only text message events and parse their JSON content.
- **EO-050** - Remove Bot mention tokens before dispatching user text.
- **EO-051** - Map Feishu chat and sender identifiers into the generic incoming-message shape.
- **EO-052** - Establish a WebSocket long connection without an external webhook tunnel.
- **EO-053** - Send replies to Feishu chats through the message API.
- **EO-054** - Log send failures and skip real sends in dashboard-only mode.
- **EO-055** - Close the dashboard HTTP server during channel shutdown.
- **EO-056** - Expose a simulated Feishu webhook for local end-to-end channel testing.
- **EO-057** - Serve a status dashboard with connection state and a test-message form.
- **EO-058** - Expose a health-check endpoint for the dashboard server.

## Plugins

### `plugins/types.ts`

- **EO-059** - Define open-ended plugin configuration values.
- **EO-060** - Define plugin APIs for tool/channel registration, resolved config access, and scoped logging.
- **EO-061** - Define plugin metadata plus activation and optional destruction lifecycle.

### `plugins/manager.ts`

- **EO-062** - Reject duplicate plugin loads.
- **EO-063** - Merge plugin defaults and runtime overrides, resolving whole-value `${ENV_VAR}` references.
- **EO-064** - Prefix contributed tool names and descriptions with the plugin identity.
- **EO-065** - Register contributed tools and track their names for later cleanup.
- **EO-066** - Provide plugin-scoped config and logging APIs during activation.
- **EO-067** - Surface activation errors without recording a half-loaded plugin.
- **EO-068** - Invoke optional destruction while isolating destruction failures.
- **EO-069** - Unregister every contributed tool when unloading a plugin.
- **EO-070** - Unload all plugins during application shutdown.
- **EO-071** - Retrieve one loaded plugin or list metadata and contributed tools.

### `plugins/supabase-plugin.ts`

- **EO-072** - Declare Supabase URL/key configuration with environment placeholders and mock fallback.
- **EO-073** - Contribute a read-only `list_tables` tool.
- **EO-074** - Contribute a read-only query tool with select, equality filter, and limit inputs.
- **EO-075** - Return deterministic mock datasets and basic in-memory filtering when no service URL exists.
- **EO-076** - Contribute an exclusive insert tool with mock inserted IDs.
- **EO-077** - Log activation details and release plugin resources on destruction.

### `plugins/telegram-plugin.ts`

- **EO-078** - Provide a Telegram plugin definition and placeholder activation seam for future channel registration.

## Runtime Skills

### `skills/loader.ts`

- **EO-079** - Model runtime skill name, description, content, and source directory.
- **EO-080** - Scan `.skills/<name>/SKILL.md` directories and rebuild the in-memory catalog on load.
- **EO-081** - Skip non-directories, missing skill files, and invalid parsed entries.
- **EO-082** - Parse simple frontmatter descriptions with quote removal and use raw content when frontmatter is absent.
- **EO-083** - Retrieve all skills or one skill by directory name.
- **EO-084** - Inject full content for active skills into the system prompt.
- **EO-085** - Advertise inactive skills by slash name and description without injecting their full content.

## Scheduled Work

### `cron/type.ts`

- **EO-086** - Model Cron, fixed-interval, and one-time schedules; Agent or handler payloads; run logs; and mutable job state.

### `cron/parser.ts`

- **EO-087** - Parse `every` expressions with seconds, minutes, or hours; parse ISO timestamps as one-time work; otherwise construct a Cron instance and compute the next delay.

### `cron/store.ts`

- **EO-088** - Initialize `.cron`, persist jobs as JSON, append run logs as JSONL, tolerate malformed or missing storage, filter logs by job, and return a bounded recent tail.

### `cron/service.ts`

- **EO-089** - Load enabled persisted jobs, start scheduling idempotently, and stop all active timers.
- **EO-090** - Add, remove, enable, disable, list, and immediately run jobs while persisting lifecycle changes.
- **EO-091** - Schedule interval, one-time, and Cron work; prevent overlapping execution; reschedule recurring jobs; and remove completed one-time jobs.
- **EO-092** - Execute Agent or handler payloads, reset or count failures, auto-disable repeatedly failing jobs, truncate and persist logs, notify results, and preserve config-owned jobs while saving runtime-owned jobs.
