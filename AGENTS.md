# AGENTS.md

> **See [CLAUDE.md](./CLAUDE.md) for the canonical project reference** — 
> 1. Project Overview — intro + tech stack (merged, both are "what is this")
> 2. Development — commands, build/validation, testing, expected warnings (all "how to work on it")
> 3. Architecture — multi-process, IPC, sidecar, frontend structure, key source locations (all "how it's built")
> 4. Conventions & Patterns — settings UI, drag-and-drop, path aliases (all "patterns to follow")
> 5. Runtime Behavior — app startup, workspaces, skills manager, bundled resources (all "how it runs")
> 6. Reference — important notes, design docs (miscellaneous lookups)
> 7. Completion Checklist — stays last as the mandatory gate
>
> This file adds agent-specific guidance that supplements CLAUDE.md.

## Repository Structure

```
src/                          # React/TypeScript frontend
  components/
    layout/                   # App shell (Sidebar, SettingsDialog)
    ui/                       # Radix UI + shadcn/ui primitives
    sidebar/                  # Sidebar panels (FileTreePanel, TodoPanel, ArtifactsPanel, FolderPanel)
    file-preview/             # File preview panel (CodePreview, MarkdownPreview, MediaPreview, etc.)
    settings/                 # Provider configuration forms
    markdown/                 # Rich message rendering
    media/                    # Image/video thumbnails and modals
    landing/                  # Task input bar and drag-drop integration
    skills-manager/           # Skills Manager window UI (repo management, skill grid, file tree)
  pages/
    Home.tsx                  # Task launcher (route: /)
    Execution.tsx             # Active task chat (route: /task/:taskId)
  stores/
    taskStore.ts              # Zustand store — tasks, permissions, questions, UI state
    workspaceStore.ts         # Workspace list, active workspace, switchWorkspace()
    filePreviewStore.ts       # File preview panel state, openPreview(), fullscreen toggle
    skillsStore.ts            # Installed skills list for slash-command autocomplete
    skillsManagerStore.ts     # Skills Manager window state: repos, repo skills, target folder
  lib/
    tauri-api.ts              # Frontend API bridge (all invoke/listen calls)
    tauri-api-interface.ts    # TauriAPI interface abstraction
  shared/types/
    task.ts                   # Core task types (Task, TaskMessage, etc.)
    workspace.ts              # Workspace, DirectoryEntry types
  hooks/
    useFileTree.ts            # Lazy-loading file tree with search and filter predicates
    useKeyboardShortcuts.ts   # Cmd+, Cmd+N, Cmd+K, Cmd+Enter, Escape
    useTheme.ts               # Theme management (light/dark mode)
    useAppUpdate.ts           # Auto-update check on app launch
    useSkillAutocomplete.ts   # Slash-command skill autocomplete (activates on / prefix)

src-tauri/                    # Rust/Tauri backend
  src/
    lib.rs                    # App entry point, plugin/menu setup, command registration
    commands/                 # Tauri command handlers by domain
      tasks.rs, settings.rs, api_keys.rs, providers.rs,
      folder_permissions.rs, ollama.rs, bedrock.rs,
      azure_foundry.rs, litellm.rs, opencode_cli.rs,
      updates.rs, app_info.rs, logging.rs, files.rs,
      packs.rs, skills.rs, workspaces.rs, copilot.rs
    db/                       # SQLite persistence (dev: cowork-dev.db, release: cowork.db, WAL mode)
      tasks.rs, settings.rs, providers.rs,
      folder_permissions.rs, workspaces.rs, skill_repos.rs, migrations.rs
    sidecar.rs                # Sidecar process lifecycle and IPC
    types.rs                  # Shared Rust types (serializable structs)
    secure_storage.rs         # OS Keychain wrapper (keyring crate)
    fs_watcher.rs             # Filesystem watcher (300ms debounce), emits workspace:fs_changed
    git_ops.rs                # Git operations (shallow clone, pull) for skill repo sync
    skill_discovery.rs        # Skill discovery from cloned repos (SKILL.md scan, skills.json manifest)
    workspace_validator.rs    # Platform-aware workspace path validation
  Cargo.toml

src-tauri/sidecar-opencode/   # Node.js sidecar (separate pnpm workspace)
  src/
    types.ts                  # IPC protocol types (source of truth)
    opencode-client.ts        # REST client for OpenCode server
    event-stream.ts           # SSE client for OpenCode server
    session-manager.ts        # Session lifecycle

src-tauri/resources/           # Bundled into app binary
  skills/opencode-server-api/ # Deployed to ~/.config/opencode/skills/ on every launch
  skill-templates/            # Installable skill templates (Skills Catalog)
  packs/ + pack-docs/         # Workspace starter pack files and documentation

docs/specs/                   # Design documentation
  requirements.md              # Feature requirements
  design.md                    # Technical design
  windows-support/             # Windows platform support plans
  workspace-as-folder/        # Workspace feature design and plans
  skills-management/          # Skills Catalog and Skills Manager plans
```

## Code Style and Conventions

This project uses **Ultracite** (Biome engine) for formatting and linting. Run `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/` after every change.

### TypeScript

- Use `const` by default, `let` only when reassignment is needed, never `var`
- Arrow functions for callbacks and short functions
- `for...of` over `.forEach()` and indexed `for` loops
- Optional chaining (`?.`) and nullish coalescing (`??`) for safe property access
- Template literals over string concatenation
- Prefer `unknown` over `any`
- Always `await` promises in async functions
- Throw `Error` objects, not strings

### React

- Function components only (no class components)
- Hooks at the top level only, never conditionally
- Specify all hook dependency arrays correctly
- Use `key` prop with unique IDs (not array indices) in iterables
- Semantic HTML and ARIA attributes for accessibility
- React 19: use `ref` as a prop instead of `React.forwardRef`

### Sidecar Constraints

- Sidecar must use **CommonJS** (not ESM) — the `pkg` bundler fails with ESM
- Do not include `.js` extensions in TypeScript imports
- Binary is built with `@yao-pkg/pkg` targeting macOS ARM64

## Verification (MANDATORY before completing any task)

After TypeScript edits:
```bash
pnpm typecheck
```

After Rust edits:
```bash
cd src-tauri && cargo check
```

After any code change, run the formatter:
```bash
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
```

Do not report a task as complete until all applicable checks pass.

## Off-Limits

- Do not modify files in `src-tauri/binaries/` directly (these are built artifacts)
- Do not commit API keys, secrets, or `.env` files (keys are stored in OS Keychain)
- Do not use ESM syntax in sidecar code (`src-tauri/sidecar-opencode/`)
- Do not add `console.log`, `debugger`, or `alert` statements to production code
- Do not use dynamic code execution or raw HTML injection patterns
- Always sanitize and escape user-provided content before rendering
