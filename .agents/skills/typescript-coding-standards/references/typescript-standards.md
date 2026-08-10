# TypeScript Coding Standards

These standards are framework-agnostic. Repository configuration and established local conventions take precedence when they are intentional and safe.

## Contents

1. Naming
2. Types and contracts
3. Functions and control flow
4. Comments and JSDoc
5. Errors
6. Asynchronous code
7. Imports, exports, and modules
8. Data and mutation
9. Boundary validation
10. Tests
11. Review checklist
12. Source adaptation

## 1. Naming

- Use names that reveal domain intent rather than implementation mechanics.
- Use `camelCase` for variables, functions, methods, and properties.
- Use `PascalCase` for classes, interfaces, type aliases, and components.
- Do not prefix interfaces with `I` or types with `T` unless the repository already requires it.
- Name functions with verbs that describe their effect or returned value: `loadSession`, `parseConfig`, or `isAuthorized`.
- Prefix booleans with words such as `is`, `has`, `can`, `should`, or `needs` when that makes the condition read naturally.
- Use plural names for collections and singular names for individual values.
- Include units in names when ambiguity is possible: `timeoutMs`, `sizeBytes`, or `retryCount`.
- Avoid unclear abbreviations. Keep established technical terms such as `id`, `url`, `api`, and `sdk` when they improve readability.
- Avoid vague names such as `data`, `info`, `item`, `handler`, or `manager` when a domain-specific name is available.
- Keep one concept under one name. Do not alternate between synonyms such as `load`, `fetch`, and `get` for the same operation.
- Use `UPPER_SNAKE_CASE` only for genuinely global or environment-style constants when that convention exists. Ordinary module constants may use `camelCase` or `PascalCase` according to their role.
- Follow the repository's existing file-naming convention. Do not rename files solely to impose a preference.

## 2. Types And Contracts

- Keep strict TypeScript checks enabled and fix the cause of type errors instead of suppressing them.
- Avoid `any`. Use `unknown` at untrusted boundaries, then validate or narrow it.
- Do not use type assertions to make an error disappear. Assert only when a runtime invariant is already established and TypeScript cannot express it.
- Prefer `@ts-expect-error` with a specific reason over `@ts-ignore` when an external typing defect makes suppression unavoidable.
- Avoid non-null assertions. When one is necessary, make the invariant obvious in code or explain why it is guaranteed.
- Model mutually exclusive states with discriminated unions instead of combinations of optional properties or boolean flags.
- Make illegal states difficult to represent. Distinguish identifiers or values when accidentally mixing them would be costly.
- Use `interface` for extendable object contracts and `type` for unions, mapped types, conditional types, and compositions when that distinction helps. Match local convention when either form is equivalent.
- Prefer literal unions or `as const` objects over enums unless runtime enum behavior is required or already established.
- Let TypeScript infer obvious local types. Add explicit types where they document a public contract, stabilize an API, or prevent widening.
- Give exported functions explicit return types when callers depend on a stable contract or inference would expose implementation details.
- Extract complex inline types when naming the concept improves comprehension or reuse. Co-locate one-off types when separation would make navigation worse.
- Use descriptive generic names such as `TResult` or `TContext` when a single-letter name would be ambiguous. Short names are acceptable in small, conventional scopes.
- Use `readonly` when immutability is part of the contract, not as decoration.
- Use `satisfies` when a value should be checked against a contract without losing its narrower inferred type.
- Use primitive types (`string`, `number`, `boolean`) rather than boxed types (`String`, `Number`, `Boolean`).
- Distinguish absent, optional, and nullable values deliberately. Do not mix `undefined` and `null` without a boundary rule.

## 3. Functions And Control Flow

- Give each function one coherent responsibility. Split it when separate decisions, side effects, or failure modes can be named independently.
- Do not enforce arbitrary line-count limits. Judge a function by cognitive load, cohesion, and testability.
- Prefer early returns and guard clauses when they reduce nesting.
- Avoid nested ternaries and dense expressions that require mental execution.
- Use an options object when several positional parameters are easy to confuse, especially multiple values of the same type.
- Avoid boolean parameters when named options or separate functions communicate behavior more clearly.
- Make side effects visible in names and placement. A function named `getConfig` should not silently persist state.
- Keep pure computation separate from I/O when doing so makes behavior easier to test and understand.
- Avoid hidden mutation of arguments. Return a new value or make mutation explicit in the contract.
- Use exhaustive checks for discriminated unions. Route impossible cases through a `never` assertion.
- Replace unexplained literals with named constants when the name preserves business meaning or units.
- Prefer straightforward loops over clever `reduce` expressions when the loop is easier to read.
- Add an abstraction only when it reduces meaningful duplication, hides complexity, or expresses a stable concept.

## 4. Comments And JSDoc

- Prefer self-explanatory names and structure over comments that translate code into prose.
- Explain why a decision exists, which invariant must hold, what trade-off was accepted, or which external constraint requires unusual code.
- Document security assumptions, concurrency behavior, compatibility workarounds, units, cancellation, and non-obvious side effects where relevant.
- Keep comments next to the code they constrain and update or remove them when behavior changes.
- Delete commented-out code. Version control already preserves history.
- Make TODOs actionable: state the missing behavior or constraint and link an issue when one exists.
- Use JSDoc for public or reusable APIs when callers need information that types alone do not convey.
- Document thrown errors, mutation, ownership, lifecycle, units, ordering, and side effects when they are part of the contract.
- Do not repeat parameter types or return types already expressed by TypeScript.
- Do not add comments to every function, property, branch, or closing brace.
- Keep suppression and workaround comments precise, including the condition under which they can be removed.

Bad:

```ts
// Increment retry count by one.
retryCount += 1;
```

Useful:

```ts
// Count the initial request as attempt one so persisted metrics match provider logs.
retryCount += 1;
```

## 5. Errors

- Treat caught values as `unknown` and narrow them safely.
- Do not swallow errors or replace them with success-like fallback values unless fallback is part of the contract.
- Use typed errors or discriminated result types for failures callers are expected to handle.
- Reserve thrown exceptions for exceptional failures or follow the repository's established error model consistently.
- Preserve the original error with `cause` when adding useful context.
- Write actionable error messages without secrets, credentials, tokens, or unnecessary personal data.
- Normalize third-party errors at module boundaries instead of leaking provider-specific shapes throughout the codebase.
- Keep logging and error propagation separate. Avoid logging the same failure at every layer.

```ts
try {
  return await loadConfig(path);
} catch (error: unknown) {
  throw new ConfigLoadError(`Unable to load config from ${path}`, { cause: error });
}
```

## 6. Asynchronous Code

- Await promises or explicitly mark intentional fire-and-forget work with `void` and local failure handling.
- Use `Promise.all` only for independent work. Keep operations sequential when order, rate limits, resource pressure, or transactional behavior requires it.
- Propagate `AbortSignal` through cancellable or long-running operations.
- Release resources in `finally` blocks or through scoped lifecycle helpers.
- Do not use an async Promise constructor callback such as `new Promise(async resolve => ...)`.
- Avoid unbounded concurrency. Use an explicit limit for large or user-controlled collections.
- Make timeout, retry, and idempotency behavior explicit at the boundary that owns it.
- Consider races whenever asynchronous work reads and writes shared state.
- Do not catch a rejected promise only to ignore it. Record, propagate, or deliberately classify the failure.

## 7. Imports, Exports, And Modules

- Use explicit imports so dependencies remain traceable.
- Use `import type` and `export type` for type-only dependencies where supported.
- Remove unused imports and avoid importing a broad namespace when only a few bindings are used.
- Prefer named exports for shared APIs when they improve refactoring and discovery; preserve an established default-export convention where appropriate.
- Keep each module's public surface intentional and small.
- Use barrel files only as deliberate public entry points. Do not create barrels that hide ownership, create cycles, or export internals accidentally.
- Avoid circular dependencies. Move shared contracts or invert a dependency instead of relying on initialization order.
- Avoid side-effect imports unless the side effect is the explicit purpose of the module.
- Follow the active module-resolution rules, including required file extensions. Do not introduce path aliases solely for aesthetics.

## 8. Data And Mutation

- Use `const` by default and `let` only when rebinding is required. Never use `var`.
- Choose mutation or copying deliberately. Local mutation can be clearer and cheaper; shared mutation requires an explicit ownership contract.
- Use `readonly` collections when consumers must not mutate them.
- Prefer `Map` or `Set` when key identity, membership, or iteration semantics are clearer than an object or array scan.
- Use `??` for missing values and `||` for boolean fallback semantics. Do not interchange them casually.
- Use optional chaining when absence is expected, but do not let it hide a required invariant.
- Avoid repeated parsing, cloning, or traversal in hot paths without evidence that the simpler code is insufficient.

## 9. Boundary Validation

- Treat network responses, environment variables, files, command-line input, persisted data, and tool output as untrusted.
- Validate untrusted values at the boundary before converting them to domain types.
- Do not cast parsed JSON directly to a trusted interface without validation.
- Normalize external representations once, then keep internal code strongly typed.
- Preserve enough context in validation errors to diagnose the source without exposing sensitive values.

## 10. Tests

- Apply the same naming, typing, and readability standards to test code.
- Name tests after observable behavior and conditions, not implementation details.
- Test public behavior and failure contracts. Avoid asserting private call sequences unless the sequence itself is the contract.
- Keep fixtures small and intentional. Use builders when repeated setup obscures the behavior under test.
- Avoid nondeterministic time, randomness, network access, and shared state unless explicitly controlled.
- Add regression coverage for fixed bugs when a stable test boundary exists.

## 11. Review Checklist

- Does every changed name communicate its domain role?
- Are comments limited to reasoning, constraints, or non-obvious contracts?
- Are public contracts typed without exposing unnecessary implementation detail?
- Has `any`, unsafe casting, or non-null assertion been avoided or justified?
- Can invalid states be represented more precisely?
- Are external values validated before use?
- Are failures propagated or handled deliberately?
- Are asynchronous operations awaited, bounded, cancellable, and cleaned up where needed?
- Is mutation visible and ownership clear?
- Are control flow and expressions readable without mental simulation?
- Is the module's public surface intentional?
- Are imports traceable and free of new cycles?
- Are changes focused rather than opportunistic rewrites?
- Do formatter, linter, type checker, and focused tests pass when available?

## 12. Source Adaptation

This guide adapts a narrow subset of the MIT-licensed [`antfu/skills`](https://github.com/antfu/skills/tree/main/skills/antfu) guidance: single-responsibility modules, extraction of genuinely complex types, explicit imports, explicit contracts where useful, and comments that explain why.

It deliberately excludes mandatory `types.ts` or `constants.ts` files, isomorphic-runtime defaults, fixed Vitest syntax, snapshots as a default, package-manager shortcuts, framework rules, monorepo rules, publishing conventions, and a prescribed ESLint distribution. Those choices are project or tooling concerns rather than universal TypeScript coding standards.
