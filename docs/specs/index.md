# Spec Documentation Index

Canonical index of design and implementation plans for Cowork-Z, organized by module. Use this file to navigate specs; use [`requirements.md`](requirements.md) to read the actual product requirements with acceptance criteria.

> **Conventions** — `requirements.md` (root, numbered ACs), `design_<topic>.md`, `plan_<topic>.md`, `requirements_<topic>.md` (module-internal full spec). One folder per module/feature, kebab-case. Lint reports and other tooling artefacts live under `meta/`.

---

## Design Specs

Technical design documents covering each module's architecture, decisions, and resolved issues.

| Module | Design Document | Coverage |
|--------|----------------|----------|
| **Overall Architecture** | [`design.md`](design.md) | Technology stack, multi-process overview, database schema, architectural decisions |
| **OpenCode Integration** | [`design_opencode-integration.md`](opencode-integration/design_opencode-integration.md) | IPC protocol, sidecar architecture, session management, security, provider support |
| **Chat Experience** | [`design_chat-ux.md`](chat-ux/design_chat-ux.md) | Message rendering, streaming, tool calls, dialogs, input handling, sidebar panels |
| **App Experience** | [`design_app-ux.md`](app-ux/design_app-ux.md) | Themes, keyboard shortcuts, settings, about panel, feedback, updates, CLI detection |
| **Workspace-as-Folder** | [`design_workspace-as-folder.md`](workspace-as-folder/design_workspace-as-folder.md) | Workspace lifecycle, file tree, permissions, file preview panel |
| **Workspace Packs** | [`design_workspace-packs.md`](workspace-packs/design_workspace-packs.md) | Starter pack catalog, installation, workspace creation |
| **Skills Management** | [`skills-management/design_skills-catalog.md`](skills-management/design_skills-catalog.md), [`design_skills-manager.md`](skills-management/design_skills-manager.md) | Curated skill repo catalog, Skills Manager (clone, sync, install) |
| **Windows Support** | [`windows-support/design_windows-support.md`](windows-support/design_windows-support.md) | Platform-specific runtime fixes, PATH resolution, build targets |
| **Automations** | [`automations/design_automations.md`](automations/design_automations.md) | Scheduled, recurring AI tasks; Rust scheduler + workspace-bound runs |

## Module-Internal Requirement Specs

Some modules carry a full feature-level requirement spec next to their design (used when the root `requirements.md` summary is too coarse).

| Module | Spec |
|--------|------|
| **Workspace-as-Folder** | [`workspace-as-folder/requirements_workspace-as-folder.md`](workspace-as-folder/requirements_workspace-as-folder.md) |

---

## Implementation Plans

### cowork-z — Platform & Security

| Plan | Location | Requirements |
|------|----------|--------------|
| Windows Support (Phase 1) | [`windows-support/plan_windows-support-phase1.md`](windows-support/plan_windows-support-phase1.md) | 5.1.1–5.1.3 |
| Fix Windows Server Timeout | [`windows-support/plan_fix-windows-server-timeout.md`](windows-support/plan_fix-windows-server-timeout.md) | 5.1.4 |

### opencode-integration — OpenCode Sidecar Integration

| Plan | Location | Requirements |
|------|----------|--------------|
| Sidecar OpenCode Rewrite | [`opencode-integration/plan_sidecar-opencode-rewrite.md`](opencode-integration/plan_sidecar-opencode-rewrite.md) | 1.2.1, 1.2.2 |
| Folder Permission Model | [`opencode-integration/plan_folder-permission-model.md`](opencode-integration/plan_folder-permission-model.md) | 1.3.1–1.3.4 |
| Convention-Based Workspace Permissions | [`opencode-integration/plan_convention-based-workspace-permission-model.md`](opencode-integration/plan_convention-based-workspace-permission-model.md) | 1.3.1–1.3.4 |
| User Prompt Customization | [`opencode-integration/plan_user-prompt-customization.md`](opencode-integration/plan_user-prompt-customization.md) | 2.1 |
| MCP Server Support | [`opencode-integration/plan_mcp-server-support.md`](opencode-integration/plan_mcp-server-support.md) | 2.3 |
| OpenCode Server API Skill | [`opencode-integration/plan_opencode-server-skill.md`](opencode-integration/plan_opencode-server-skill.md) | 2.4 |
| Server Isolation | [`opencode-integration/plan_server-isolation.md`](opencode-integration/plan_server-isolation.md) | 5.2.1 |
| OpenRouter Provider Support | [`opencode-integration/plan_openrouter-provider-support.md`](opencode-integration/plan_openrouter-provider-support.md) | 1.1.3 |
| GitHub Copilot Provider Support | [`opencode-integration/plan_github-copilot-provider-support.md`](opencode-integration/plan_github-copilot-provider-support.md) | 1.1.6 |

Resolved issues documented in [`design_opencode-integration.md`](opencode-integration/design_opencode-integration.md#resolved-issues): System Prompt Not Applied, Cross-Task Message Leakage (#22), Question Reply Format Mismatch, Multi-Select Question Dialog.

### chat-ux — Chat Experience

| Plan | Location | Requirements |
|------|----------|--------------|
| Chat UI Rewrite | [`chat-ux/plan_chat-ui-rewrite.md`](chat-ux/plan_chat-ui-rewrite.md) | 3.7 |
| Drag-and-Drop in Chat | [`chat-ux/plan_drag-and-drop-support.md`](chat-ux/plan_drag-and-drop-support.md) | 3.5 |
| Rich File & URL Display | [`chat-ux/plan_rich-file-url-display-in-chat.md`](chat-ux/plan_rich-file-url-display-in-chat.md) | 3.1, 3.2 |
| Slash Command Skill Invocation | [`chat-ux/plan_slash-command-skill-invocation.md`](chat-ux/plan_slash-command-skill-invocation.md) | 3.8 |
| Rename Conversation in Sidebar | [`chat-ux/plan_rename-conversation-in-sidebar.md`](chat-ux/plan_rename-conversation-in-sidebar.md) | 3.9 |
| Tool Call Card Redesign | [`chat-ux/plan_tool-call-card-redesign.md`](chat-ux/plan_tool-call-card-redesign.md) | 3.7.2 |
| Typed Sidecar Event Bridge | [`chat-ux/plan_typed-sidecar-event-bridge.md`](chat-ux/plan_typed-sidecar-event-bridge.md) | 9.4.3 |

Resolved issues documented in [`design_chat-ux.md`](chat-ux/design_chat-ux.md#resolved-issues): Stop Button, Long-Running Task False Failure, Streaming Partial Message Duplication, Intermediate Messages Not Persisted, Markdown Table Rendering, Startup Stage Indicator Never Displayed.

### app-ux — App Experience

| Plan | Location | Requirements |
|------|----------|--------------|
| Theme Support | [`app-ux/plan_theme-support.md`](app-ux/plan_theme-support.md) | 4.2 |
| Keyboard Shortcuts | [`app-ux/plan_keyboard-shortcuts.md`](app-ux/plan_keyboard-shortcuts.md) | 4.3.1, 4.3.2 |
| Keyboard Shortcuts Help Modal | [`app-ux/plan_keyboard-shortcuts.md`](app-ux/plan_keyboard-shortcuts.md) | 4.3.3 |
| About Panel | [`app-ux/plan_about-panel.md`](app-ux/plan_about-panel.md) | 4.4 |
| User Feedback | [`app-ux/plan_user-feedback.md`](app-ux/plan_user-feedback.md) | 4.5 |
| Todo Panel in Sidebar | [`app-ux/plan_todo-panel-in-sidebar.md`](app-ux/plan_todo-panel-in-sidebar.md) | 3.3 |
| Artefacts Panel | [`app-ux/plan_artefacts-panel.md`](app-ux/plan_artefacts-panel.md) | 3.4 |
| Dynamic Model Discovery | [`app-ux/plan_dynamic-model-discovery-for-direct-api-providers.md`](app-ux/plan_dynamic-model-discovery-for-direct-api-providers.md) | 1.1.4 |
| Missing OpenCode CLI Detection | [`app-ux/plan_missing-opencode-cli-detection.md`](app-ux/plan_missing-opencode-cli-detection.md) | 5.3.3 |
| Arena — Side-by-Side Agent Comparison | [`app-ux/plan_arena.md`](app-ux/plan_arena.md) | 4.6 |
| Enhance MCP Server Config UI | [`app-ux/plan_enhance-mcp-server-config-ui.md`](app-ux/plan_enhance-mcp-server-config-ui.md) | 2.3 |
| Design Overhaul — Homescreen | [`app-ux/plan_design-overhaul.md`](app-ux/plan_design-overhaul.md) | DESIGN.md / PRODUCT.md |

### workspace-as-folder — Workspace-per-Folder Model

| Plan | Location | Requirements |
|------|----------|--------------|
| Workspace as Folder (Phases 1 + 2) | [`workspace-as-folder/plan_workspace-as-folder.md`](workspace-as-folder/plan_workspace-as-folder.md) | 6.1–6.4 |

### workspace-packs — Workspace Starter Packs

| Plan | Location | Requirements |
|------|----------|--------------|
| Workspace Starter Packs | [`workspace-packs/plan_workspace-packs.md`](workspace-packs/plan_workspace-packs.md) | 7.1–7.3 |

### skills-management — Skills Management

| Plan | Location | Requirements |
|------|----------|--------------|
| Skills Catalog (curated repo browser) | [`skills-management/plan_skills-catalog-reimplement.md`](skills-management/plan_skills-catalog-reimplement.md) | 8.1–8.2 |
| Skills Manager | [`skills-management/plan_skills-manager.md`](skills-management/plan_skills-manager.md) | 8.3 |
| Skill Sync Script | [`skills-management/plan_skill-sync-script.md`](skills-management/plan_skill-sync-script.md) | 8.3 |
| View Skill | [`skills-management/plan_view-skill.md`](skills-management/plan_view-skill.md) | 8.3.6 |

### automations — Scheduled AI Tasks

| Plan | Location | Requirements |
|------|----------|--------------|
| Automations | [`automations/plan_automations.md`](automations/plan_automations.md) | 9.1–9.4 |

---

## Meta

- [`meta/`](meta/) — spec-tooling artefacts (lint reports, conventions notes). Generated by `spec-lint`; safe to delete and regenerate.
