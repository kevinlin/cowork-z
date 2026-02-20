# View Skill Plan

## Context

The Skills Catalog (`SkillsCatalog.tsx`) shows bundled skill templates with install/re-install actions, but users have no way to preview what a skill contains before installing it. Adding a "View" button that opens the skill's `SKILL.md` in the existing `FilePreviewPanel` lets users read the full skill definition inline.

---

## Task 1: Add `skills_get_template_path` Rust command ✅

**Files:** Modify `src-tauri/src/commands/skills.rs`, `src-tauri/src/lib.rs`

Add a new Tauri command that resolves the absolute filesystem path to a skill template's `SKILL.md`.

```rust
#[tauri::command]
pub fn skills_get_template_path(app: AppHandle, skill_id: String) -> Result<String, String> {
    let templates_dir = resolve_templates_dir(&app)?;
    let skill_md = templates_dir.join(&skill_id).join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!("SKILL.md not found for '{}'", skill_id));
    }
    Ok(skill_md.to_string_lossy().to_string())
}
```

Register in `lib.rs` `invoke_handler`.

**Why a new command?** The frontend cannot know the Tauri resource directory path — it's resolved at runtime by `app.path().resource_dir()`. The backend must resolve and return the absolute path so `readFileContent` can load it.

---

## Task 2: Expose in frontend API bridge ✅

**Files:** Modify `src/lib/tauri-api.ts`, `src/lib/tauri-api-interface.ts`

Add `getSkillTemplatePath(skillId: string): Promise<string>` that invokes the new command.

```typescript
// tauri-api.ts
export async function getSkillTemplatePath(skillId: string): Promise<string> {
  return invoke<string>('skills_get_template_path', { skillId });
}
```

Add to the `TauriAPI` interface and its implementation.

---

## Task 3: Add "View" button to skill cards ✅

**Files:** Modify `src/components/landing/SkillsCatalog.tsx`

Add a "View" text link at the bottom of each skill card (next to the category badge). When clicked:

1. Call `api.getSkillTemplatePath(skillId)` to get the absolute path
2. Call `useFilePreviewStore.getState().openPreviewByPath(path)` to open the markdown in the preview panel

The `FilePreviewPanel` already handles `.md` files via `MarkdownPreview` — no changes needed there.

### Button placement

```
┌─────────────────────────────────┐
│ Skill Name            [Install] │
│ Description text...             │
│                                 │
│ [Category]              View    │
└─────────────────────────────────┘
```

The "View" link uses muted text styling with hover highlight, keeping the install button as the primary action.

---

## Verification

1. `cd src-tauri && cargo check` — Rust compiles
2. `pnpm typecheck` — TypeScript compiles
3. `pnpm tauri dev` — Click "View" on a skill card → `FilePreviewPanel` opens showing the skill's SKILL.md rendered as markdown
4. Verify the preview panel close/expand/dock controls work as expected
