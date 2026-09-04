<!--
  Specification convention reference used by the spec-lint skill.

  This file is the canonical naming + structure rule set. It lives in two places:

  1. .claude/skills/spec-lint/references/convention.md  — the version bundled with
     the skill. Updated when the skill itself is updated.
  2. <spec_root>/meta/convention.md                     — the local copy seeded by
     spec-lint into the project. This is the per-project source of truth; edit it
     to customize folder names, supported artifact types, allowed exceptions, etc.

  When spec-lint runs:
  - If <spec_root>/meta/convention.md is missing, the bundled version is copied in.
  - If both exist and differ, the local copy wins for linting decisions and a
    notice is added to the report so the human can choose to refresh.

  Edit the local copy freely. Do not edit this bundled copy from inside a project.
-->

# Specification File Structure and Naming Convention

Use this convention to keep spec-driven development artifacts predictable for humans, agents, scripts, and CI checks.

The convention defines **file structure, naming, and intent**. It does not prescribe the body content of each spec — feature templates, acceptance-criteria formats, and decision logs are deliberately out of scope.

The convention is informed by common patterns from Kiro, Superpowers, OpenSpec, GitHub spec-kit, BMad Method, and GSD-style workflows, adapted to this project.

---

## 1. Core Rules

1. All specification files live under a single `<spec_root>` directory. Most projects use `docs/specs/`; the spec-lint skill resolves the actual root automatically.
2. The root contains **project-level** specs (overall requirements, overall design, navigation index, and tooling artefacts).
3. Each module or feature has **one folder** under `<spec_root>`.
4. Module and feature folder names use **kebab-case**.
5. Module-level spec files follow the pattern `<artifact-type>_<topic>.md` where `<artifact-type>` ∈ {`requirements`, `design`, `plan`}.
6. Use exactly **one underscore** between the artifact type and the topic. Use **kebab-case** inside the topic.
7. Plan files should link back to the requirements (by ID or section) and design they implement.
8. Do not use generic or transient names (`notes.md`, `todo.md`, `draft.md`, `final.md`, `wip.md`, `temp.md`, `v2.md`).
9. Do not include dates in filenames except in `meta/` artefacts (e.g., dated lint reports).
10. Generated tooling artefacts (lint reports, indices, conventions copies) live under `<spec_root>/meta/`.

---

## 2. Artifact Types and Intent

| Artifact | Purpose | Where it lives |
|---|---|---|
| **`requirements.md`** (root) | Project-level acceptance criteria, numbered. The contract for what the product does. | `<spec_root>/requirements.md` |
| **`design.md`** (root) | Project-level architecture: tech stack, multi-process layout, cross-cutting decisions. | `<spec_root>/design.md` |
| **`index.md`** (root) | Navigation map of every design and plan grouped by module. The single jump-off point. | `<spec_root>/index.md` |
| **`requirements_<topic>.md`** | Module-internal full requirement spec used when the root requirement summary is too coarse. Should map each section back to root requirement IDs. | `<spec_root>/<module>/` |
| **`design_<topic>.md`** | Module-level architecture: components, data model, decisions, resolved issues. | `<spec_root>/<module>/` |
| **`plan_<topic>.md`** | Implementation plan for one module *or* one sub-feature within the module. Multiple plans per module are normal. | `<spec_root>/<module>/` |
| **Supporting files** (`*.json`, `*.yaml`, `*.png`) | API contracts, schemas, mock-ups referenced from a spec. Same folder as the spec that consumes them. | `<spec_root>/<module>/` |
| **`meta/`** | Generated tooling artefacts (lint reports, conventions copies, generated indices). Safe to delete and regenerate. | `<spec_root>/meta/` |

**Rules of thumb:**

- A module always has at least one of {`design_<topic>.md`, `plan_<topic>.md`}. Folders containing only a single `requirements_<topic>.md` are unusual and a sign the design has not been written yet.
- A module may have multiple `plan_<topic>.md` files (one per sub-feature) but typically has one `design_<topic>.md`.
- A module may omit `requirements_<topic>.md` entirely if the root `requirements.md` already covers it at sufficient granularity.

---

## 3. Naming Decision Table

| Need | Location | Filename | Example |
|---|---|---|---|
| Spec navigation index | `<spec_root>/` | `index.md` | `docs/specs/index.md` |
| Project requirements | `<spec_root>/` | `requirements.md` | `docs/specs/requirements.md` |
| Project design | `<spec_root>/` | `design.md` | `docs/specs/design.md` |
| Module requirements (full spec) | `<spec_root>/<module>/` | `requirements_<module>.md` | `workspace-as-folder/requirements_workspace-as-folder.md` |
| Module design | `<spec_root>/<module>/` | `design_<module>.md` | `app-ux/design_app-ux.md` |
| Module implementation plan | `<spec_root>/<module>/` | `plan_<module>.md` | `workspace-packs/plan_workspace-packs.md` |
| Sub-feature plan inside a module | `<spec_root>/<module>/` | `plan_<sub-feature>.md` | `app-ux/plan_keyboard-shortcuts.md` |
| API contract / schema | `<spec_root>/<module>/` | `<contract-name>.{json,yaml}` | `opencode-integration/opencode-api.json` |
| Generated lint report | `<spec_root>/meta/` | `lint-report-YYYY-MM-DD.md` | `meta/lint-report-2026-05-09.md` |
| Local convention reference | `<spec_root>/meta/` | `convention.md` | `meta/convention.md` |

---

## 4. Folder Naming Rules

Each module or feature lives in exactly one folder:

```text
<spec_root>/<module-or-feature>/
```

Allowed:

- Lowercase letters.
- Hyphens between words (`workspace-as-folder/`, `chat-ux/`).
- Stable product or architecture names (`opencode-integration/`, not `phase1/`).

Disallowed:

- Spaces, underscores, dots in folder names.
- camelCase or PascalCase (`WorkspaceAsFolder/`, `chatUx/`).
- Dates (`2026-05-feature/`) unless the folder genuinely is date-scoped.
- Trailing-version markers (`feature-v2/`, `feature-old/`). Iterate by editing the existing folder; preserve history through git.

---

## 5. File Naming Rules

The pattern is:

```text
<artifact-type>_<topic>.md
```

- `<artifact-type>` is exactly one of `requirements`, `design`, `plan`.
- `<topic>` describes the module, feature, change, or implementation slice.
- Use exactly one underscore as the type/topic separator.
- Use kebab-case inside the topic.

### Valid examples

```text
requirements_workspace-as-folder.md
design_workspace-as-folder.md
plan_workspace-as-folder.md
plan_keyboard-shortcuts.md
plan_dynamic-model-discovery-for-direct-api-providers.md
```

### Anti-patterns

| Anti-pattern | Example | Fix |
|---|---|---|
| Hyphen between type and topic | `plan-keyboard-shortcuts.md` | `plan_keyboard-shortcuts.md` |
| Underscore inside the topic | `plan_keyboard_shortcuts.md` | `plan_keyboard-shortcuts.md` |
| Multiple underscores as separator | `plan__keyboard-shortcuts.md` | `plan_keyboard-shortcuts.md` |
| Generic / transient name | `notes.md`, `todo.md`, `draft.md` | Rename to `<artifact>_<topic>.md` |
| Phase or version in filename | `plan_phase1.md`, `plan_v2.md` | Use a meaningful topic; preserve history via git |
| Bare `plan.md` in a module folder | `workspace-packs/plan.md` | `workspace-packs/plan_workspace-packs.md` |
| Typo in topic | `plan_todo-panel-in-sidebard.md` | `plan_todo-panel-in-sidebar.md` |
| Mixed casing | `plan_KeyboardShortcuts.md` | `plan_keyboard-shortcuts.md` |

Existing legacy files that already use underscores inside the topic may remain temporarily, but new files should use kebab-case topics. The lint surface flags them as `warn`, not `error`, so cleanup can be batched.

---

## 6. Example Tree

This tree covers project-level specs, module-level specs, sub-feature plans, generated metadata, supporting files, and modules at different levels of detail.

```text
docs/specs/
├── index.md                              # navigation map
├── requirements.md                       # project-level ACs
├── design.md                             # project-level architecture
├── meta/
│   ├── convention.md                     # local copy of this file
│   └── lint-report-2026-05-09.md         # generated by spec-lint
├── app-ux/                               # module with many sub-feature plans
│   ├── design_app-ux.md
│   ├── plan_about-panel.md
│   ├── plan_arena.md
│   ├── plan_keyboard-shortcuts.md
│   ├── plan_theme-support.md
│   └── plan_user-feedback.md
├── workspace-packs/                      # module with one design + one plan
│   ├── design_workspace-packs.md
│   └── plan_workspace-packs.md
├── workspace-as-folder/                  # module with module-internal requirements
│   ├── requirements_workspace-as-folder.md
│   ├── design_workspace-as-folder.md
│   └── plan_workspace-as-folder.md
└── opencode-integration/                 # module with a supporting API contract
    ├── design_opencode-integration.md
    ├── opencode-api.json
    └── plan_sidecar-opencode-rewrite.md
```

---

## 7. Customizing for a Project

The copy at `<spec_root>/meta/convention.md` is the **per-project source of truth**. Edit it freely:

- Add allowed artifact types (e.g., `runbook_<topic>.md`, `adr_<topic>.md`).
- Tighten or relax topic-naming rules.
- Restrict module folder names to a fixed list.
- Add project-specific anti-patterns observed during reviews.

When `spec-lint` runs and detects that the local copy differs from the bundled version, it surfaces an `info` finding so you can decide whether to refresh from the skill or keep your customizations.
