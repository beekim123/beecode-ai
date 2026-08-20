# Desktop Agent Rules

This file adds Desktop-specific rules to the repository root `AGENTS.md`. Do not duplicate or relax root rules here.

## Context

- Read `docs/development/phase-4-desktop-development-design.md` before Desktop architecture or implementation work.
- Follow `docs/development/platform-development-guidelines.md` when Desktop work affects shared protocol, OpenAPI, Backend, authentication, events, persistence, Runtime behavior, or another client.
- The first calculator vertical slice has passed. Slice 4 may add Workspace and allowlisted local tools while preserving the established Main/Preload/Renderer/Runtime boundaries; Shell, Git, Approval, tray, and updates require their own scoped slice.

## Boundaries

- Build the app with Electron Forge, Vite, React, and TypeScript. Keep Electron Main, Preload, Renderer, and the Node Runtime Sidecar as explicit process boundaries.
- Main owns the single-instance lock, windows, OAuth deep links, encrypted credentials, Runtime supervision, and operating-system integration. It does not run the Agent Loop or tools.
- Preload exposes a narrow, typed, validated API through `contextBridge`. It must not expose `ipcRenderer`, arbitrary channels, Node globals, or raw operating-system access.
- Renderer loads only packaged local content and owns UI projection. It must run with `nodeIntegration: false`, `contextIsolation: true`, and sandboxing enabled; it cannot read tokens or call Backend, model, filesystem, Shell, Git, or Electron APIs directly.
- Runtime Sidecar is the local execution authority. Launch it with `utilityProcess`, communicate through a transferred `MessagePort`, and keep its lifecycle independent from any one window.
- Preserve `AgentProtocolService` semantics across Desktop IPC. Parse every command, response, event, and handshake at the receiving process boundary with shared schemas.
- Desktop Backend data uses `surface = desktop` and OAuth client `beecode-desktop`. The server, not a request body, fixes account ownership and surface.
- Put production code under `apps/desktop/src/main/`, `apps/desktop/src/preload/`, `apps/desktop/src/renderer/`, and `apps/desktop/src/runtime/`. Put all tests under `apps/desktop/tests/`, split into `unit/`, `integration/`, and `e2e/` when those layers are introduced.

## Skill Routing

- Load `typescript-coding-standards` for TypeScript or TSX implementation and refactoring.
- Also load `vercel-react-best-practices` for Renderer components, state flow, rendering, data fetching, or performance work.
- Load `playwright-best-practices` for Electron Playwright E2E work.
- Load `web-design-guidelines` for Renderer UI or accessibility review, and `ux-audit` only for an interactive audit of a running app.
- Use `reference-ai-superagent` only for matching Runtime, session, tool, or Agent architecture work and follow the root requirement to ask before inspecting the external reference implementation.

## Verification

Run commands from the repository root after the Desktop package introduces the corresponding scripts:

```bash
pnpm --filter @beecode/desktop typecheck
pnpm --filter @beecode/desktop test
pnpm --filter @beecode/desktop build
pnpm --filter @beecode/desktop test:e2e
pnpm --filter @beecode/desktop make
```

- Run unit and integration tests for Main/Preload/Renderer/Runtime changes.
- Run Electron E2E for changed user workflows and Runtime lifecycle behavior.
- Run packaged-app smoke tests on each affected target OS/architecture for packaging, deep-link, signing, safe-storage, or update changes.
- Run `pnpm check` when shared packages, Backend behavior, OpenAPI, OAuth, or another application are affected.

## Prohibitions

- Do not enable Renderer Node integration, disable context isolation or sandboxing, load remote application content, or grant remote content access to the Preload API.
- Do not expose raw `ipcRenderer`, `MessagePort`, arbitrary IPC channel names, filesystem paths, Shell strings, environment variables, or unrestricted system dialogs to Renderer.
- Do not pass access tokens in command-line arguments, environment variables, URLs, Renderer state, logs, crash metadata, or Session snapshots. Keep refresh tokens in Main and use `safeStorage` for persistence.
- Do not expose a loopback HTTP server for the first Sidecar transport or allow Sidecar messages from any process other than the current Main process.
- Do not let Main or Renderer invent Turn, ToolCall, usage, or synchronization terminal states; those remain authoritative in Runtime and Backend.
- Do not couple Sidecar lifetime to a BrowserWindow, silently continue after an incompatible handshake, or report a crashed Runtime Turn as completed.
- Do not add Shell, Git, Approval, tray, or auto-update production behavior without the corresponding scoped slice and tests.
- Do not add tests under `src/`.
