# Context And Knowledge Inventory

Reference root: `/Users/key_/Desktop/CURRGO/github/AI_SuperAgent/src`

This file contains 102 functional points across 15 source files.

## Contents

- [Prompt assembly](#prompt-assembly)
- [Context compaction and defense](#context-compaction-and-defense)
- [Context and usage views](#context-and-usage-views)
- [Memory](#memory)
- [RAG](#rag)
- [Sessions and usage accounting](#sessions-and-usage-accounting)

## Prompt Assembly

### `context/prompt-builder.ts`

- **CK-001** - Define prompt context for active tools, deferred tools, and session state.
- **CK-002** - Register named prompt pipes fluently in a deterministic order.
- **CK-003** - Build the final prompt by skipping pipes that return `null` and separating included sections.
- **CK-004** - Debug each pipe as active or inactive with emitted character counts.
- **CK-005** - Provide reusable core Agent behavior rules.
- **CK-006** - Conditionally describe local and MCP tool availability when tools are active.
- **CK-007** - Conditionally instruct the model to use `tool_search` when deferred tools exist.
- **CK-008** - Conditionally inject current session identity and history count.

### `context/prompt-pipes.ts`

- **CK-009** - Adapt the memory store's prompt section into a prompt pipe.
- **CK-010** - Adapt vector-store size and sources into a conditional RAG prompt pipe.

## Context Compaction And Defense

### `context/compressor.ts`

- **CK-011** - Estimate tokens across string messages, text parts, and tool outputs.
- **CK-012** - Restrict micro-compaction to a known allowlist of reproducible filesystem and shell tools.
- **CK-013** - Preserve the three newest tool-result messages.
- **CK-014** - Replace older eligible tool outputs with a compact cleared marker.
- **CK-015** - Define a structured LLM summary contract for intent, completed work, findings, state, and exact details.
- **CK-016** - Skip model summarization below a token threshold or when too few messages exist.
- **CK-017** - Keep the six newest messages and align the compression boundary to a user message.
- **CK-018** - Convert mixed message content into role-labeled text for the summarizer.
- **CK-019** - Merge an earlier summary with newly compressible conversation history.
- **CK-020** - Reinsert the summary as a synthetic user message before retained recent messages.
- **CK-021** - Preserve the original messages and previous summary when summarization fails.

### `context/defense.ts`

- **CK-022** - Maintain an API-supplied precise token baseline plus rough token estimates for newly added text.
- **CK-023** - Report estimated token count, context percentage, and an action flag at 75 percent utilization.
- **CK-024** - Estimate mixed message content with a safety factor for Chinese text.
- **CK-025** - Truncate oversized individual tool outputs with a 60/40 head-tail split.
- **CK-026** - Calculate total message characters after per-result truncation.
- **CK-027** - Enforce a total context budget by compacting oldest tool results first.
- **CK-028** - Return separate counts for per-result truncation and total-budget compaction.
- **CK-029** - Track tool-result age through message-index timestamps.
- **CK-030** - Restrict TTL pruning to tool messages and preserve user/assistant history.
- **CK-031** - Preserve failed or denied tool outputs as useful error experience.
- **CK-032** - Hard-expire old tool output to a named placeholder after the hard TTL.
- **CK-033** - Soft-prune middle content while retaining head and tail after the soft TTL.
- **CK-034** - Combine truncation, TTL pruning, and final token estimation into one defense pass.
- **CK-035** - Return all defense metrics with the transformed messages.

Reference caveats for this block:

- `applyDefense` is demonstrated through `commands/debug.ts` but is not wired into the normal `agent/loop.ts` path.
- Total-budget compaction runs before TTL pruning and does not exempt failed outputs, so it can remove an error before CK-031 gets a chance to preserve it.
- CK-031 recognizes failures from output text with a limited regular expression; prefer structured failure metadata and use string classification only as a fallback when adapting this design.

## Context And Usage Views

### `context/view.ts`

- **CK-036** - Model context as named, colored token slices plus free and autocompact-buffer capacity.
- **CK-037** - Render a fixed 16-by-16 context matrix representing 256 capacity cells.
- **CK-038** - Convert token slices into stable cell allocations while keeping tiny nonempty slices visible.
- **CK-039** - Render free cells and reserved autocompact cells distinctly.
- **CK-040** - Render model identity, utilization, category percentages, free space, and buffer in a legend.
- **CK-041** - Compose matrix and legend side by side for terminal display.
- **CK-042** - Approximate token counts for system prompt, tools, memory, skills, and messages separately.
- **CK-043** - Account for text, tool-call input, and tool-result output when estimating message tokens.
- **CK-044** - Default the autocompact reserve to five percent of the model window.
- **CK-045** - Render usage totals across input, output, cache write, and cache read categories.
- **CK-046** - Render a cache-hit progress bar, total cost, no-cache baseline, and savings.

## Memory

### `memory/store.ts`

- **CK-047** - Model user, feedback, project, and reference memory with descriptions, file paths, and read/write timestamps.
- **CK-048** - Initialize `.memory` and create the Markdown index when absent.
- **CK-049** - Slugify multilingual memory names and prefix filenames with memory type.
- **CK-050** - Persist memory as Markdown with frontmatter metadata and content.
- **CK-051** - Upsert the corresponding link in the memory index.
- **CK-052** - Bound index size and evict the earliest indexed entry when full.
- **CK-053** - Enumerate memory Markdown files while excluding the index.
- **CK-054** - Parse frontmatter and ignore invalid or unsupported memory types.
- **CK-055** - Delegate memory search to BM25 with configurable top-K.
- **CK-056** - Bound index and memory-file prompt size with explicit truncation markers.
- **CK-057** - Update `lastReadAt` whenever a memory file is read.
- **CK-058** - Delete the memory file and remove its index entry together.
- **CK-059** - Run repository-aware memory linting.
- **CK-060** - Build a prompt section containing memory inventory, tool instructions, and memory-quality principles.

### `memory/search.ts`

- **CK-061** - Tokenize English and numeric runs while splitting Chinese into individual characters.
- **CK-062** - Weight memory name and description more heavily than body content.
- **CK-063** - Compute document frequency and inverse-document-frequency across memory entries.
- **CK-064** - Apply BM25 term-frequency saturation and document-length normalization.
- **CK-065** - Filter zero-score results, sort descending, and return top-K hits.

### `memory/validator.ts`

- **CK-066** - Extract unique source-like file paths from memory content.
- **CK-067** - Assign different freshness TTLs to user, feedback, project, and reference memory.
- **CK-068** - Flag referenced paths that no longer exist.
- **CK-069** - Flag memories whose last-read age exceeds the type-specific TTL.
- **CK-070** - Count and flag duplicate memory names across the store.
- **CK-071** - Return reports only for entries that contain actionable issues.

## RAG

### `rag/chunker.ts`

- **CK-072** - Accumulate paragraphs toward a target chunk size.
- **CK-073** - Flush accumulated text before an oversized paragraph.
- **CK-074** - Split oversized paragraphs at Chinese or English sentence boundaries.
- **CK-075** - Generate stable source/index chunk IDs and approximate token counts.

### `rag/embedder.ts`

- **CK-076** - Define a provider-neutral batch embedding function contract.
- **CK-077** - Generate deterministic normalized mock vectors for local development.
- **CK-078** - Call DashScope's OpenAI-compatible embedding endpoint at a fixed 128 dimensions.
- **CK-079** - Surface HTTP status and response body for embedding failures.
- **CK-080** - Cache embeddings by exact text while batching only cache misses and restoring original order.
- **CK-081** - Compute cosine similarity with zero-norm protection.

### `rag/store.ts`

- **CK-082** - Store chunks with embeddings and insertion timestamps in memory.
- **CK-083** - Upsert chunks by stable chunk ID.
- **CK-084** - Batch inserts through the same upsert contract.
- **CK-085** - Expose all chunks, size, clearing, and unique source listing.

### `rag/search.ts`

- **CK-086** - Oversample candidates to four times top-K for both vector and keyword paths.
- **CK-087** - Rank vector candidates by cosine similarity.
- **CK-088** - Tokenize and score keyword candidates with a BM25-like calculation.
- **CK-089** - Normalize vector scores with min-max and keyword scores with a sigmoid.
- **CK-090** - Merge candidates by ID with 70 percent vector and 30 percent keyword weights.
- **CK-091** - Sort combined candidates before diversity selection.
- **CK-092** - Apply MMR to balance retrieval score and cross-result diversity.
- **CK-093** - Estimate result redundancy with Jaccard similarity over token sets.

### `rag/sqlite-store.ts`

- **CK-094** - Load `sqlite-vec` and create canonical, vector, and FTS5 tables.
- **CK-095** - Replace a chunk consistently across all three tables through delete-then-insert writes.
- **CK-096** - Batch multi-table ingestion inside a SQLite transaction.
- **CK-097** - Execute vector search in SQLite and convert cosine distance to similarity.
- **CK-098** - Execute FTS5 BM25 keyword search and normalize rank direction.
- **CK-099** - Expose persistent store size, clearing, and unique sources.
- **CK-100** - Run SQLite-native dual-path hybrid search, weighted merge, and MMR selection.

## Sessions And Usage Accounting

### `session/store.ts`

- **CK-101** - Create per-session JSONL storage, append timestamped single or multiple messages, load while skipping malformed lines, and expose existence and message count.

### `usage/tracker.ts`

- **CK-102** - Maintain provider/model price tiers; normalize provider cache fields; compute per-step and aggregate cost, hit rate, no-cache baseline, savings, and recent records; optionally persist steps as JSONL with fallback pricing.
