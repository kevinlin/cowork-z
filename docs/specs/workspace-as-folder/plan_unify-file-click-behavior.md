# Plan: Unify File Click Behavior to In-App Preview

## Context

The updated requirements (3.1, 6.4.1) specify that all file clicks should open the in-app preview panel, not the OS file manager. Currently, file path links in chat messages and artefact clicks call `revealInFinder()` (opens Finder). Media thumbnails and file tree clicks already open the in-app preview. This plan aligns the implementation with the updated spec and adds an "Open Externally" button to the preview panel header.

## Changes

### 1. `src/components/markdown/EnhancedLink.tsx` — File clicks open preview

**Current (line 90):** `await api.revealInFinder(path)`
**New:** `useFilePreviewStore.getState().openPreviewByPath(path)`

- Add import: `import { useFilePreviewStore } from '@/stores/filePreviewStore'`
- Replace the `revealInFinder` call with `openPreviewByPath` inside `handleClick` (line 89-93)
- Uses `getState()` (not a hook) to avoid subscribing the `memo`'d component to store changes — idiomatic Zustand pattern for fire-and-forget actions
- URL click behavior (`api.openExternal`) unchanged
- `api` import stays (still used by `openExternal` and `getHomeDir`)
- Update JSDoc comment at top (line 6)

**ArtifactsPanel.tsx — no changes needed.** It renders `<EnhancedLink href={`file://${artifact.filePath}`}>` so it inherits the fix automatically.

### 2. `src/components/file-preview/FilePreviewPanel.tsx` — Add "Open Externally" button

Add a new icon-only button to the preview header, between the fullscreen toggle and "Add to Chat":

- Add `ExternalLink` to the lucide-react import (line 1-14)
- Add `handleOpenExternal` callback after `handleAddToChat` (after line 114):
  ```ts
  const handleOpenExternal = useCallback(async () => {
    try { await api.openFilePath(file.path); }
    catch (err) { console.error('[FilePreviewPanel] Failed to open externally:', err); }
  }, [file.path]);
  ```
- Insert button after line 188 (after fullscreen toggle, before Add to Chat):
  ```tsx
  <button
    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    onClick={handleOpenExternal}
    title="Open with default application"
    type="button"
  >
    <ExternalLink className="h-4 w-4" />
  </button>
  ```
- `api` already imported on line 18; `file.path` is always absolute

**Button order:** Fullscreen | Open Externally (new) | Add to Chat | Close

### 2a. `src/lib/tauri-api.ts` — Add `openFilePath` wrapper

**Why:** Tauri's `openUrl()` (used by `openExternal`) blocks `file://` URLs by default. The opener plugin provides a separate `openPath()` function specifically for opening local files with the OS default application.

- Add `openPath` to the import from `@tauri-apps/plugin-opener`
- Add `openFilePath` wrapper:
  ```ts
  export async function openFilePath(path: string): Promise<void> {
    await openPath(path);
  }
  ```
- Add `openFilePath` to the `getTauriApi()` return object

### 2b. `src-tauri/capabilities/default.json` — Grant `open_path` permission with scope

**Why:** The opener plugin's default permission denies `open_path`. Adding `opener:allow-open-path` enables the command, but it also requires an explicit path scope — without one, all calls are rejected at runtime with "Not allowed to open path".

- Add permission with wildcard scope:
  ```json
  {
    "identifier": "opener:allow-open-path",
    "allow": [{ "path": "**" }]
  }
  ```

### 3. `src/components/markdown/__tests__/EnhancedLink.test.tsx` — Update tests

- Add mock for the store:
  ```ts
  const mockOpenPreviewByPath = vi.fn();
  vi.mock('@/stores/filePreviewStore', () => ({
    useFilePreviewStore: { getState: () => ({ openPreviewByPath: mockOpenPreviewByPath }) },
  }));
  ```
- Add `beforeEach(() => { vi.clearAllMocks(); })` inside the `describe` block
- **Line 36-43:** Rename test to `'should open preview panel for file paths on click'`, assert `mockOpenPreviewByPath` called with path
- **Line 53:** Change `api.revealInFinder` assertion to `mockOpenPreviewByPath`

## Files touched

| File | Change |
|------|--------|
| `src/components/markdown/EnhancedLink.tsx` | Replace `revealInFinder` → `openPreviewByPath` |
| `src/components/file-preview/FilePreviewPanel.tsx` | Add "Open Externally" button using `api.openFilePath` |
| `src/lib/tauri-api.ts` | Add `openFilePath` wrapper around `openPath` from plugin-opener |
| `src-tauri/capabilities/default.json` | Add `opener:allow-open-path` with `"**"` scope |
| `src/components/markdown/__tests__/EnhancedLink.test.tsx` | Update test assertions |

## Verification

1. `pnpm typecheck` — no TS errors
2. `cd src-tauri && cargo check` — no Rust errors (capabilities change)
3. `pnpm test --run` — all tests pass (EnhancedLink, ArtifactsPanel, MediaGallery)
4. Manual with `pnpm tauri dev`:
   - Click file path in chat message → opens in-app preview
   - Click artefact in sidebar → opens in-app preview
   - Click URL in chat → still opens browser
   - Click "Open Externally" in preview header → opens file with OS default app
   - Fullscreen, Add to Chat, Close buttons still work
