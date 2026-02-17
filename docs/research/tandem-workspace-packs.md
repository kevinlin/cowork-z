# Research: Workspace Packs

**Date**: 2026-02-17
**Git Commit**: `a579798`
**Branch**: `main`
**Repository**: [tandem](https://github.com/frumu-ai/tandem)

## Research Question

How do workspace packs work end-to-end in the Tandem app — from content authoring and bundling, through the Rust backend, IPC layer, and React frontend, to the user's filesystem?

## Summary

Workspace packs are **guided, copyable workspace folders** that ship pre-loaded sample inputs, documentation, and prompts for specific real-world tasks (e.g. research synthesis, security playbook creation, legal research). The pack catalog is a **hardcoded `Vec<PackMeta>`** in Rust. At install time, Tauri's resource bundling system locates the pack template on disk and recursively copies it plus documentation files to a user-chosen directory. The installed folder is then registered as a Tandem project, and a draft chat message is injected to guide the user to `START_HERE.md`.

There are currently **9 packs** defined in the catalog, with **6 having on-disk content** in `workspace-packs/`. Three packs (`data-visualization-pack`, `finance-analysis-pack`, `bio-informatics-pack`) exist in the catalog but do not yet have content directories.

---

## Detailed Findings

### 1. Pack Content Authoring (`workspace-packs/`)

Pack content lives in the repository root under `workspace-packs/` with two parallel directory trees:

```
workspace-packs/
├── PACKS.md                          # Top-level documentation
├── notes.md                          # Supplementary notes
├── packs/
│   └── <pack-id>/                    # One directory per pack
│       ├── inputs/                   # Sample input files for the workflow
│       └── outputs/.gitkeep          # Empty directory for AI-generated output
└── pack-docs/
    └── <pack-id>/                    # Documentation for each pack
        ├── START_HERE.md             # Entry point — step-by-step guide
        ├── PACK_INFO.md              # Pack metadata and description
        ├── PROMPTS.md                # Suggested prompts to use with the AI
        └── EXPECTED_OUTPUTS.md       # What the user should expect
```

The six packs with on-disk content are:

| Pack ID | Input Files | Description |
|---------|------------|-------------|
| `micro-drama-script-studio-pack` | 7 (character sheets, locations, style guide, script format, 2 example episodes) | Short-form scriptwriting |
| `research-synthesis-pack` | 15 (12 papers, methodology, glossary, references, questions) | Multi-document research synthesis |
| `web-research-refresh-pack` | 3 (stale brief, support tickets, verification questions) | Fact verification and doc refresh |
| `security-playbook-pack` | 7 (company context, compliance, incident response, policies, team profile, threat landscape) | Security runbook creation |
| `legal-research-pack` | 4 (case notes, employment agreement, memo template, NDA template) | Contract and case note analysis |
| `web-starter-audit-pack` | 8 (full sample web project with HTML, CSS, JS, README) | Web project UX/a11y audit |

### 2. Resource Bundling (`tauri.conf.json`)

Pack content is bundled into the production app via Tauri's resource system. The configuration at [tauri.conf.json:48-54](src-tauri/tauri.conf.json#L48-L54) declares:

```json
"resources": [
  "resources/packs/**/*",
  "resources/pack-docs/**/*"
]
```

In development builds, the Rust code falls back to the repository's `workspace-packs/` directory via `CARGO_MANIFEST_DIR` (see pattern in step 3 below). This means the actual `workspace-packs/packs/` and `workspace-packs/pack-docs/` directories must be copied or symlinked into `src-tauri/resources/packs/` and `src-tauri/resources/pack-docs/` for production builds.

### 3. Rust Backend — Pack Module (`src-tauri/src/packs.rs`)

The entire pack system is implemented in a single Rust module: [packs.rs](src-tauri/src/packs.rs).

#### Data Structures (lines 6-19)

```rust
pub struct PackMeta {
    pub id: String,          // kebab-case, matches directory name
    pub title: String,       // Human-readable name
    pub description: String, // One-line summary
    pub complexity: String,  // e.g. "Beginner-Intermediate", "Advanced"
    pub time_estimate: String, // e.g. "15-20 min"
    pub tags: Vec<String>,   // e.g. ["research", "analysis", "python"]
}

pub struct PackInstallResult {
    pub installed_path: String, // Absolute path to installed directory
}
```

Both structs derive `Serialize` only (not `Deserialize`) — packs are read-only from the frontend's perspective.

#### Catalog (`list_packs()`, lines 21-111)

Returns a hardcoded `Vec<PackMeta>` with 9 entries. The `id` field serves as the lookup key and must match the directory name under `workspace-packs/packs/`.

#### Resource Resolution (`resolve_pack_sources()`, lines 144-215)

Searches for pack content in multiple candidate paths to support both production and development layouts:

1. `{resource_dir}/resources/packs` — production bundle
2. `{resource_dir}/packs`
3. `{resource_dir}/resources/workspace-packs/packs`
4. `{resource_dir}/workspace-packs/packs`
5. *(debug only)* `{CARGO_MANIFEST_DIR}/../workspace-packs/packs` — dev fallback

The same search is performed for `pack-docs/`. The function returns a `(packs_root, pack_docs_root)` tuple.

#### Name Collision Handling (`choose_destination_dir()`, lines 217-232)

If the target directory `{destination}/{pack-id}` already exists, appends `-2`, `-3`, etc. up to `-100`. Returns an error if all 100 candidates are taken.

#### Default Install Location (`default_pack_root()`, lines 234-244)

- Primary: `~/Tandem Packs`
- Fallback: `{app_data_dir}/packs`

#### Install Logic (`install_pack()`, lines 246-356)

The install flow:

1. **Validate** `pack_id` against the catalog (prevents path traversal)
2. **Ensure** destination directory exists (creates it if needed)
3. **Resolve** source paths via `resolve_pack_sources()`
4. **Copy** the pack template directory recursively via `copy_dir_recursive()`
5. **Copy documentation files** individually — each is optional and warns on failure:
   - `START_HERE.md`
   - `PACK_INFO.md`
   - `PROMPTS.md`
   - `CONTRIBUTING.md`
   - `EXPECTED_OUTPUTS.md`
6. **Return** `PackInstallResult { installed_path }` with the absolute path

`install_pack_default()` (lines 358-361) is a convenience wrapper that uses `default_pack_root()` as the destination.

### 4. IPC Command Layer (`src-tauri/src/commands.rs`)

Three Tauri commands are registered at [commands.rs:42-66](src-tauri/src/commands.rs#L42-L66):

| Command | Rust Function | Parameters | Returns |
|---------|--------------|------------|---------|
| `packs_list` | `packs_list()` | none | `Vec<PackMeta>` |
| `packs_install` | `packs_install()` | `app: AppHandle`, `pack_id: String`, `destination_dir: String` | `Result<PackInstallResult>` |
| `packs_install_default` | `packs_install_default()` | `app: AppHandle`, `pack_id: String` | `Result<PackInstallResult>` |

Errors from the pack module are mapped to `TandemError::InvalidConfig`. Commands are registered in the `tauri::generate_handler!` macro in [lib.rs:510-513](src-tauri/src/lib.rs#L510-L513).

### 5. TypeScript IPC Wrappers (`src/lib/tauri.ts`)

The frontend counterpart at [tauri.ts:1346-1376](src/lib/tauri.ts#L1346-L1376) mirrors the Rust types:

```typescript
export interface PackMeta {
  id: string;
  title: string;
  description: string;
  complexity: string;
  time_estimate: string;   // snake_case matches serde default
  tags: string[];
}

export interface PackInstallResult {
  installed_path: string;
}
```

Three async wrapper functions:
- `listPacks()` → invokes `packs_list`
- `installPack(packId, destinationDir)` → invokes `packs_install`
- `installPackDefault(packId)` → invokes `packs_install_default`

Tauri's `invoke()` automatically converts camelCase JS parameters (`packId`, `destinationDir`) to snake_case Rust parameters.

### 6. Frontend UI — PacksPanel (`src/components/packs/PacksPanel.tsx`)

The primary packs UI is a full-page panel component at [PacksPanel.tsx](src/components/packs/PacksPanel.tsx) (259 lines).

**Props:**
```typescript
interface PacksPanelProps {
  activeProjectPath?: string;
  onOpenInstalledPack?: (installedPath: string) => Promise<void> | void;
  onOpenSkills?: () => void;
}
```

**State:**
- `packs: PackMeta[]` — fetched on mount via `listPacks()`
- `loading: boolean` — loading spinner state
- `installingId: string | null` — tracks which pack is currently being installed
- `error: string | null` — error display
- `query: string` — search/filter input
- `showPackInfo: boolean` — toggles the explainer section
- `showPythonWizard: boolean` — toggles the Python venv setup wizard

**Key behaviors:**

1. **Catalog fetch** (lines 44-56): On mount, calls `listPacks()` via IPC and populates state.

2. **Search/filter** (lines 58-67): Client-side substring match across all `PackMeta` fields (title, description, complexity, time_estimate, tags).

3. **Install flow** (lines 69-90):
   - Opens a native OS folder picker via `@tauri-apps/plugin-dialog`'s `open({ directory: true })`
   - Calls `installPack(packId, destination)` via IPC
   - On success, calls `onOpenInstalledPack(result.installed_path)` to hand off to the app

4. **Pack cards** (lines 208-253): Rendered in a 2-column grid. Each card shows title, description, complexity pill, time estimate, up to 4 tag pills (with runtime-aware coloring for `python`/`node`/`bash`), and an Install button.

5. **Runtime note** (lines 155-190): A banner warning that some packs require external runtimes (Python, Node, Bash) with a button to open the Python venv setup wizard.

### 7. View Routing and Post-Install Flow (`src/App.tsx`)

**View type** at [App.tsx:67](src/App.tsx#L67):
```typescript
type View = "chat" | "extensions" | "settings" | "about" | "packs" | "onboarding" | "sidecar-setup";
```

**Navigation handler** at [App.tsx:794-796](src/App.tsx#L794-L796):
```typescript
const handleOpenPacks = () => {
  setView("packs");
};
```

**Post-install handler** at [App.tsx:798-804](src/App.tsx#L798-L804):
```typescript
const handleOpenInstalledPack = async (installedPath: string) => {
  setDraftMessage("Open `START_HERE.md` and follow it step-by-step.");
  setPostAddProjectView("chat");
  setSidebarTab("sessions");
  setSidebarOpen(true);
  await beginAddProject(installedPath);
};
```

This handler:
1. Sets a **draft chat message** that tells the AI to open `START_HERE.md`
2. Configures the post-add-project view to navigate to **chat**
3. Opens the **sidebar** with the sessions tab
4. Calls `beginAddProject(installedPath)` which checks git status and registers the folder as a project

The `beginAddProject` function at [App.tsx:658-700](src/App.tsx#L658-L700) checks whether the folder is a git repo (with a 2-second timeout to avoid macOS CLI tools prompt hangs), optionally prompts the user to initialize git for undo support, then calls `finalizeAddProject()` to register the workspace.

### 8. Entry Points — How Users Reach Packs

There are **four** navigation paths to the packs view:

| Entry Point | Location | Trigger |
|------------|----------|---------|
| **Sidebar icon rail** | [App.tsx:1071-1079](src/App.tsx#L1071-L1079) | Sparkles icon button in the left icon rail |
| **Session sidebar** | `SessionSidebar.tsx:384-392` | "Starter Packs" text button at bottom of sidebar |
| **Chat empty state** | [Chat.tsx:2798-2803](src/components/chat/Chat.tsx#L2798-L2803) | "Install starter packs" pinned action card |
| **Onboarding wizard** | [OnboardingWizard.tsx:134-155](src/components/onboarding/OnboardingWizard.tsx#L134-L155) | Step 3 "Run a starter pack" with Browse button |

### 9. Internationalization

Pack UI labels are translated via `react-i18next`:
- English: `"packs": "Packs"` ([en/common.json:50](src/i18n/locales/en/common.json#L50))
- Simplified Chinese: `"packs": "工作流包"` ([zh-CN/common.json:50](src/i18n/locales/zh-CN/common.json#L50))

---

## End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTHORING (repo)                                  │
│  workspace-packs/packs/<id>/inputs/    → sample input files                │
│  workspace-packs/pack-docs/<id>/       → START_HERE, PROMPTS, etc.         │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │ bundled via tauri.conf.json resources
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION APP                                      │
│  {resource_dir}/resources/packs/<id>/                                      │
│  {resource_dir}/resources/pack-docs/<id>/                                  │
│  (In dev: falls back to workspace-packs/ via CARGO_MANIFEST_DIR)           │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                  │
           ▼                 ▼                  ▼
┌──────────────────┐ ┌──────────────┐ ┌────────────────────┐
│   packs_list     │ │ packs_install│ │packs_install_default│
│  → Vec<PackMeta> │ │ → copy to    │ │→ copy to           │
│  (hardcoded)     │ │   user dir   │ │  ~/Tandem Packs    │
└────────┬─────────┘ └──────┬───────┘ └────────┬───────────┘
         │ IPC invoke()     │                   │
         ▼                  ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                                       │
│                                                                             │
│  listPacks()  ──────────►  PacksPanel renders grid of pack cards           │
│                                                                             │
│  installPack() ─────────►  OS folder picker → copy → returns installed_path│
│                                                                             │
│  onOpenInstalledPack() ──► beginAddProject(path)                           │
│                            setDraftMessage("Open START_HERE.md...")         │
│                            navigate to chat view                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Code References

| File | Lines | Description |
|------|-------|-------------|
| [src-tauri/src/packs.rs](src-tauri/src/packs.rs) | 1-361 | Entire pack module — types, catalog, install logic |
| [src-tauri/src/commands.rs](src-tauri/src/commands.rs) | 42-66 | Three IPC command handlers |
| [src-tauri/src/lib.rs](src-tauri/src/lib.rs) | 15, 510-513 | Module declaration and command registration |
| [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) | 48-54 | Resource bundling config |
| [src/lib/tauri.ts](src/lib/tauri.ts) | 1346-1376 | TypeScript types and IPC wrappers |
| [src/components/packs/PacksPanel.tsx](src/components/packs/PacksPanel.tsx) | 1-259 | Main packs UI component |
| [src/App.tsx](src/App.tsx) | 67, 658-700, 794-804 | View type, beginAddProject, pack handlers |
| [src/components/chat/Chat.tsx](src/components/chat/Chat.tsx) | 2798-2803 | Empty state "Install starter packs" action |
| [src/components/onboarding/OnboardingWizard.tsx](src/components/onboarding/OnboardingWizard.tsx) | 134-155 | Onboarding step 3 |
| [workspace-packs/](workspace-packs/) | — | All pack content and documentation |

## Architecture Notes

- **No database**: The pack catalog is hardcoded in Rust. There is no dynamic pack registry, no remote pack server, and no user-created packs mechanism.
- **One-way copy**: Installation is a one-time file copy. There is no update, sync, or version-tracking mechanism for installed packs.
- **Security**: `pack_id` is validated against the hardcoded catalog before any filesystem operation, preventing path traversal attacks.
- **Graceful degradation**: Documentation files are copied individually with `warn`-on-failure semantics — a missing doc file does not abort the install.
- **Dev/prod parity**: The `resolve_pack_sources()` function searches multiple candidate paths to support both the development tree and the production Tauri bundle.
- **Post-install integration**: After install, the pack folder becomes a regular Tandem project. The draft message `"Open START_HERE.md and follow it step-by-step."` seeds the first interaction with the AI agent.
