---
name: typescript-coding-standards
description: Apply framework-agnostic TypeScript coding standards for naming, comments and JSDoc, type design, functions, control flow, errors, asynchronous code, imports and exports, and maintainability. Use when creating, editing, refactoring, or reviewing .ts and .tsx files, or when the user asks for TypeScript code quality, readability, naming, comments, type safety, or clean-code guidance. Do not use for architecture, framework conventions, monorepo structure, or tooling configuration unless the user explicitly includes them.
---

# TypeScript Coding Standards

Apply these standards to TypeScript code without expanding the task into architecture or tooling work.

## Workflow

1. Inspect the nearest TypeScript configuration, formatter or linter configuration, and representative neighboring files.
2. Read [references/typescript-standards.md](references/typescript-standards.md) before writing or reviewing TypeScript.
3. Treat repository conventions as authoritative when they are deliberate and consistent. Use this skill to fill gaps and improve unsafe or unclear code.
4. Prioritize correctness, type safety, clear contracts, readability, and local consistency in that order.
5. Keep edits scoped. Do not rename, reformat, comment, or refactor unrelated code merely to satisfy a preference.
6. Run the repository's available formatter, linter, type checker, and focused tests after implementation.

## Application Rules

- Apply judgment instead of arbitrary limits on function or file length.
- Add comments only when they preserve reasoning, constraints, invariants, or non-obvious behavior.
- Do not require explicit annotations where inference is clear and the annotation adds no contract value.
- Do not introduce abstractions until they remove real complexity or duplication.
- During reviews, report actionable violations with file and line references; do not narrate compliant code.

## Scope Boundary

This skill does not prescribe package boundaries, framework APIs, UI conventions, build tools, test runners, deployment, or system architecture. Follow dedicated project guidance for those concerns.
