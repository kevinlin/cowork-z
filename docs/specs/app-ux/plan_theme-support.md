# Plan: Theme Support (Req 4.2)

## Context

Cowork-Z currently has a single light theme with a green primary color (`#213c20`). The app uses CSS custom properties in HSL format (defined in `src/styles/globals.css`) consumed by Tailwind via `hsl(var(--primary))` etc. All components use semantic Tailwind classes (`bg-primary`, `text-foreground`, `border-border`), making the app well-prepared for theming by simply swapping CSS variable values.

This plan adds 6 predefined themes (3 light, 3 dark) with the Zuhlke brand purple alongside the existing green, plus Nordic and Deep Space themes, runtime switching, SQLite persistence, and OS dark-mode detection on first launch.

## Themes

| Theme | ID | Primary Color | Dark? |
|-------|-----|---------------|-------|
| Classic Light | `classic-light` | Green `#213c20` | No |
| Classic Dark | `classic-dark` | Green `#4a8a47` (lighter for contrast) | Yes |
| Zuhlke Light | `zuhlke-light` | Purple `#985b9c` (from branding) | No |
| Zuhlke Dark | `zuhlke-dark` | Purple `#b87fbc` (lighter for contrast) | Yes |
| Nordic Light | `nordic-light` | Blue `#2563eb` (Fjord Blue, Scandinavian-inspired) | No |
| Deep Space | `deep-space` | Violet `#8b5cf6` (Nebula Violet, blue-shifted dark) | Yes |

No gradient colors on message bubbles. Message bubbles use solid `bg-primary` / `bg-card` as they do today.

## Implementation Steps

### Step 1: Theme definitions — NEW `src/lib/themes.ts`

Define `ThemeId` type, `ThemeDefinition` interface, `THEMES` array with all 6 themes, `getThemeById()` helper, and `applyTheme()` function.

- `applyTheme()` iterates `theme.variables` and calls `document.documentElement.style.setProperty('--' + key, value)` for each, then toggles `class="dark"` on `<html>` based on `theme.isDark`
- Each theme defines all 17 CSS variable values (background, foreground, card, primary, secondary, muted, accent, destructive, border, input, ring + their foreground variants)
- Dark themes invert neutrals: background becomes near-black, foreground near-white, etc.
- Zuhlke themes use `#985b9c` (HSL: `296 26% 48%`) as primary, derived from `docs/specs/Branding/extra.css`

### Step 2: Enable Tailwind dark mode — `tailwind.config.ts`

Add `darkMode: 'class'` to the config object. This activates existing `dark:` prefixes already present in shadcn/ui components (button, input, textarea, dropdown-menu) and some app components (FoldersPanel, ConversationListItem).

### Step 3: Database migration — `src-tauri/src/db/migrations.rs`

- Bump `CURRENT_VERSION` to `8`
- Add `migrate_v8()`: `ALTER TABLE app_settings ADD COLUMN theme_id TEXT`
- Add `if stored_version < 8 { migrate_v8(conn)?; }` to `run_migrations()`

### Step 4: Rust settings — `src-tauri/src/db/settings.rs`

- Add `theme_id: Option<String>` field to `AppSettings` struct
- Add `get_theme_id(conn) -> Option<String>` function
- Add `set_theme_id(conn, theme_id: Option<&str>) -> Result<(), String>` function
- Update `get_app_settings()` SELECT query to include `theme_id`

### Step 5: Tauri commands — `src-tauri/src/lib.rs`

- Add `get_theme` command: returns `Option<String>`
- Add `set_theme` command: accepts `theme_id: Option<String>`
- Register both in `invoke_handler`

### Step 6: Frontend API — `src/lib/tauri-api.ts` + `src/lib/tauri-api-interface.ts`

- `tauri-api.ts`: Add `getTheme()` and `setTheme(themeId)` functions, add to `getTauriApi()` return
- `tauri-api-interface.ts`: Add `getTheme(): Promise<string | null>` and `setTheme(themeId: string | null): Promise<void>` to `TauriAPI` interface

### Step 7: Theme hook — NEW `src/hooks/useTheme.ts`

- On mount: call `api.getTheme()` to load persisted theme ID
- If `null` (first launch): check `window.matchMedia('(prefers-color-scheme: dark)').matches` → default to `classic-dark` or `classic-light`
- Call `applyTheme()` with resolved theme
- Expose `{ themeId, switchTheme, themes, loaded }`
- `switchTheme(id)`: calls `applyTheme()` + `api.setTheme(id)`

### Step 8: Wire hook into app — `src/App.tsx`

- Call `useTheme()` at the top level
- Pass `themeId` and `switchTheme` to `SettingsDialog` as props

### Step 9: Theme picker UI — `src/components/layout/SettingsDialog.tsx`

Add a "Theme" section between Provider Grid and User Prompt sections (shown when a provider is selected). Contains a grid of clickable theme cards, each showing:
- Color swatch preview (background + primary color split, using inline `hsl()` from theme definition so each card always shows its own colors)
- Theme label
- Active indicator (primary ring/border)

Clicking a card calls `switchTheme(id)` — immediate visual update, no page reload needed.

### Step 10: Dark theme color-scheme — `src/styles/globals.css`

Add `:root.dark { color-scheme: dark; }` so native elements (scrollbars, form controls) respect dark mode.

### Step 11: Fix hardcoded colors for dark mode compatibility

Replace hardcoded color classes with semantic equivalents in these files:

| File | Change |
|------|--------|
| `src/components/layout/ConversationListItem.tsx` | `text-zinc-700` → `text-foreground`, `text-zinc-400` → `text-muted-foreground` |
| `src/components/sidebar/FoldersPanel.tsx` | `text-zinc-700` → `text-foreground`, `text-zinc-400`/`text-zinc-500` → `text-muted-foreground` |
| `src/components/settings/ProviderGrid.tsx` | `bg-[#edebe7]` → `bg-muted` |
| `src/components/settings/ProviderCard.tsx` | `bg-[#e9f7e7]` → `bg-primary/10`, `bg-[#f9f8f6]` → `bg-card`, `border-[#4a4330]` → `border-primary` |
| `src/components/settings/shared/ConnectionStatus.tsx` | `bg-[#4A7C59]` → `bg-primary` |
| `src/components/settings/shared/ConnectedControls.tsx` | `bg-[#e9f7e7]` → `bg-primary/10`, `text-[#244325]` → `text-primary`, `bg-[#f9f8f6]` → `bg-card`, hardcoded borders → `border-border` |
| `src/components/settings/providers/BedrockProviderForm.tsx` | `bg-[#4A7C59]` → `bg-primary` |
| `src/components/landing/TaskInputBar.tsx` | `placeholder:text-gray-400` → `placeholder:text-muted-foreground` |
| `src/pages/Execution.tsx` | Add `dark:` variants for operation badge colors (lines ~92-107). Debug panel zinc colors stay as-is (intentionally always dark). |

### Step 12: Update requirements doc — `docs/specs/cowork-z/requirements.md`

- Mark `#### 4.2 Theme Support` as `#### 4.2 Theme Support ✅`
- Add plan reference to Implementation Plans Index table
- Remove Theme Support line from "Outstanding Feature TODO" list

## Files Modified (summary)

| File | Action |
|------|--------|
| `src/lib/themes.ts` | **NEW** — Theme definitions + applyTheme |
| `src/hooks/useTheme.ts` | **NEW** — Theme initialization hook |
| `tailwind.config.ts` | Add `darkMode: 'class'` |
| `src/styles/globals.css` | Add `:root.dark { color-scheme: dark; }` |
| `src-tauri/src/db/migrations.rs` | Migration v8 (theme_id column) |
| `src-tauri/src/db/settings.rs` | get/set_theme_id + update AppSettings |
| `src-tauri/src/lib.rs` | get_theme / set_theme commands |
| `src/lib/tauri-api.ts` | getTheme / setTheme functions |
| `src/lib/tauri-api-interface.ts` | TauriAPI interface additions |
| `src/App.tsx` | Wire useTheme, pass to SettingsDialog |
| `src/components/layout/SettingsDialog.tsx` | Theme picker section |
| `src/components/layout/ConversationListItem.tsx` | Semantic color classes |
| `src/components/sidebar/FoldersPanel.tsx` | Semantic color classes |
| `src/components/settings/ProviderGrid.tsx` | Semantic color classes |
| `src/components/settings/ProviderCard.tsx` | Semantic color classes |
| `src/components/settings/shared/ConnectionStatus.tsx` | Semantic color classes |
| `src/components/settings/shared/ConnectedControls.tsx` | Semantic color classes |
| `src/components/settings/providers/BedrockProviderForm.tsx` | Semantic color classes |
| `src/components/landing/TaskInputBar.tsx` | Semantic color classes |
| `src/pages/Execution.tsx` | dark: variants for badges |
| `docs/specs/cowork-z/requirements.md` | Mark 4.2 complete |

## Verification

1. `cd src-tauri && cargo check` — Rust compiles with new migration + commands
2. `pnpm typecheck` — Frontend compiles with new theme types + API
3. `pnpm tauri dev` — Launch app, verify:
   - Default theme loads (Classic Light for light OS, Classic Dark for dark OS)
   - Settings dialog shows theme picker with 6 cards
   - Clicking each theme card immediately switches the entire app
   - Switching to dark themes: backgrounds go dark, text goes light, sidebar/message bubbles/panels all adapt
   - Switching back to light: everything reverts
   - Close and reopen app: persisted theme is restored
   - Message bubbles use solid colors (no gradients)
4. `pnpm test --run` — Existing tests pass
