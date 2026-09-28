# Native PowerShell Terminal and Command Palette Design

**Date:** 2026-09-28

**Status:** Approved in chat; awaiting written-spec review

## Goal

Make the Electron build of Outlaw Code provide a real, persistent PowerShell terminal and add a searchable command palette plus a VS Code-style View menu. The browser build must remain usable without gaining access to the host computer.

## Scope

This milestone contains two connected deliverables:

1. A native Electron terminal backed by a persistent PowerShell pseudoterminal.
2. A typed application command surface used by `Ctrl+Shift+P`, the View menu, and workspace navigation actions.

Broader VS Code/Cursor parity is intentionally deferred. Extensions, debugging, multi-terminal tabs, task definitions, shell profiles, keybinding customization, and a full menu-bar rewrite are not part of this milestone.

## Current State and Root Cause

`src/components/TerminalPanel.tsx` currently displays a React command form and sends each completed line to `sandbox.commands.run`. The sandbox in `src/lib/sandbox.ts` is an in-memory compatibility stub that only recognizes a few fake commands. It does not launch a process, preserve a shell session, render terminal control sequences, or connect to the Electron main process.

The project already includes a `cmdk`-based command dialog primitive in `src/components/ui/command.tsx`, but it has no application command registry, no `Ctrl+Shift+P` binding, and no connection to the IDE views.

## User Experience

### Native terminal

In Electron, opening the Terminal bottom tab starts one persistent PowerShell session. Its initial working directory is the currently opened local workspace. If no local workspace is open, it starts in the user's home directory.

The terminal behaves like a normal terminal instead of a command form:

- PowerShell owns the prompt and command history.
- `cd` and environment-variable changes persist between commands.
- ANSI colors, cursor movement, and full-screen terminal output render correctly.
- Keyboard input is sent directly to PowerShell, including `Ctrl+C`.
- The pseudoterminal resizes when the bottom panel changes size.
- Closing or replacing the terminal disposes the native process.
- Closing the Electron window disposes all terminal processes owned by that window.
- PowerShell 7 (`pwsh.exe`) is preferred when available. Windows PowerShell is the fallback.

The terminal toolbar identifies the running shell and provides a restart action and a terminate action. A terminated terminal shows its exit state and can be restarted without restarting the app.

In a normal browser, the host terminal bridge is absent. The existing sandbox command interface remains available as a clearly labeled limited fallback so the web build does not gain host-machine access.

### Command palette and menus

`Ctrl+Shift+P` opens a centered searchable command palette. The first milestone includes these commands:

- `File: Open Folder...`
- `File: Open Project History...`
- `View: Explorer`
- `View: Search`
- `View: Source Control`
- `View: Terminal`
- `View: Output`
- `Preferences: AI Settings`

Selecting a command closes the palette and executes exactly the same action used by the corresponding menu item. The View menu is expanded to show `Command Palette...`, Explorer, Search, Source Control, Terminal, Output, Project History, and AI Settings with their shortcuts where applicable.

Workspace view commands open the required surface as well as select it. For example, `View: Search` opens the sidebar if it is collapsed, and `View: Terminal` opens the bottom panel and selects its Terminal tab.

## Architecture

### 1. Main-process terminal manager

A focused CommonJS module, `electron/terminal-manager.cjs`, owns native pseudoterminal sessions. It receives the `node-pty` dependency through a small factory boundary so session lifecycle and ownership can be tested without launching a real shell.

Each session records:

- A random session identifier
- The owning Electron `webContents.id`
- The underlying pseudoterminal process
- The displayed shell name
- The starting working directory

The manager exposes create, input, resize, dispose, and dispose-by-owner operations. Input and resize calls must match both a valid session identifier and the calling renderer's `webContents.id`; one renderer cannot control another window's terminal.

PowerShell discovery is performed in the main process. It searches for `pwsh.exe` on `PATH` and then falls back to the Windows PowerShell executable under `SystemRoot`. The shell is started with `-NoLogo`; user profiles remain enabled so the terminal behaves like the user's normal PowerShell environment.

### 2. Restricted IPC bridge

`electron/main.cjs` registers terminal IPC handlers after the main window is created. The renderer can request session creation, write raw input, resize, and dispose through the preload bridge. Main-process data and exit events are forwarded only to the owning renderer.

`electron/preload.cjs` exposes a narrow `window.outlawCode.terminal` API. It does not expose `ipcRenderer`, `child_process`, filesystem primitives, or arbitrary channel names. Existing `contextIsolation: true`, `nodeIntegration: false`, and sandbox settings remain unchanged.

The bridge contract is declared in `src/lib/fs/bridge.d.ts` and the existing `Window.outlawCode` augmentation so renderer code receives complete TypeScript checking.

### 3. Terminal renderer

The native renderer uses `@xterm/xterm` plus `@xterm/addon-fit`. `xterm.js` is the terminal emulator: it interprets the control sequences PowerShell writes and converts keyboard activity back into terminal input. `node-pty` is the pseudoterminal: it gives PowerShell a real console-compatible process instead of ordinary redirected pipes.

`TerminalPanel.tsx` chooses between:

- `NativeTerminal`, when the Electron terminal bridge exists.
- `SandboxTerminal`, for the browser compatibility path.

Keeping the two renderers separate prevents Electron lifecycle logic from becoming mixed with the old virtual sandbox behavior.

### 4. Typed command surface

`src/lib/app-commands.ts` is the single source of truth for command identifiers, titles, categories, and displayed shortcuts. It also provides a typed event helper for workspace-owned commands.

`src/components/CommandPalette.tsx` renders the existing `cmdk` dialog using that metadata. `App.tsx` owns palette visibility and handles application-level commands such as opening a folder, history, and settings. `EditorLayout.tsx` listens for workspace view commands and updates its existing sidebar and bottom-panel state.

The View menu and command palette call the same command executor. This avoids separate menu-only and palette-only behavior that can drift apart later.

## Dependencies and Packaging

The production dependencies are:

- `node-pty` for the Windows ConPTY-backed pseudoterminal.
- `@xterm/xterm` for terminal rendering and input.
- `@xterm/addon-fit` for fitting terminal rows and columns to the panel.

`node-pty` is a native Node module and must match Electron's ABI. Installation and packaging must therefore rebuild it for the repository's Electron version. The explicit electron-builder file list must include the runtime module, and the native `.node` binary must be unpacked from `app.asar`.

Verification must cover both `electron:dev` and `electron:build:dir`. A terminal that works only under Vite development is not considered complete.

## Error Handling

- If neither PowerShell executable can be found, the panel shows a clear launch error and a retry action.
- A failed native-module load is reported as a terminal startup error rather than crashing the application.
- Input, resize, and dispose requests for unknown or foreign sessions return a serialized error.
- Terminal exit is shown in the panel with its numeric exit code when available.
- Resize events are ignored until xterm has non-zero columns and rows.
- Reopening or restarting the terminal always disposes the previous session first.
- Browser mode never silently claims to be PowerShell; it remains labeled as a limited sandbox.

## Security Boundaries

A native terminal intentionally allows the signed-in desktop user to execute commands with that user's operating-system permissions. It is therefore available only through the Electron preload bridge, never through the browser build.

The implementation preserves these boundaries:

- No Node integration in the renderer.
- No generic IPC access in the preload.
- Terminal sessions are scoped to their owning renderer.
- Renderer-supplied executable paths are not accepted.
- Renderer-supplied starting directories are not accepted; the main process chooses the active workspace root or user home directory.
- All sessions are terminated on renderer destruction and application shutdown.

## Testing and Acceptance Criteria

### Automated verification

- Main-process unit tests use a fake pseudoterminal adapter to verify session creation, owner isolation, input, resize, disposal, exit cleanup, and owner cleanup.
- Existing Electron filesystem/Git tests continue to pass.
- TypeScript, ESLint, production Vite build, and diff checks pass.
- The unpacked Electron build contains the terminal manager and the packaged native `node-pty` binary.

### Manual Electron verification

1. Open a real local folder.
2. Open Terminal and confirm the prompt starts in that folder.
3. Run `$env:OUTLAW_TEST = 'works'`, then `Write-Output $env:OUTLAW_TEST`; the second command prints `works`.
4. Change directories and confirm the next prompt uses the new directory.
5. Run a colored PowerShell command and confirm ANSI colors render.
6. Start a long-running command, press `Ctrl+C`, and confirm it stops without killing the terminal.
7. Resize the bottom panel and confirm output reflows without overlapping.
8. Restart and terminate the terminal from its toolbar.
9. Press `Ctrl+Shift+P`, filter commands, and open Explorer, Search, Source Control, Terminal, Output, History, and Settings.
10. Build and launch the unpacked Electron application and repeat the environment persistence check.

### Browser regression verification

- The web build loads without trying to import or execute `node-pty` in the renderer bundle.
- The Terminal tab remains labeled as a limited sandbox.
- The command palette opens and browser-safe commands continue to work.
- `File: Open Folder...` is omitted or disabled when the local filesystem bridge is unavailable.

## Delivery Order

1. Implement and test the main-process terminal manager and restricted IPC bridge.
2. Add the xterm-based native renderer while preserving the browser fallback.
3. Verify development and packaged terminal behavior.
4. Add the typed command surface, command palette, and expanded View menu.
5. Run complete automated and manual regression checks.

This order keeps the user's top priority—the real PowerShell terminal—independently testable before adding the command palette.
