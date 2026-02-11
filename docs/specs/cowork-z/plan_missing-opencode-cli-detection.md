# Plan: Missing OpenCode CLI Detection (Req 5.3.3)

## Context

Section 5 of `requirements.md` contains 3 subsections. Two features are fully implemented (5.2.1 Server Isolation, 5.2.3 Credential Security, 5.3 Error Handling) and one sub-feature is done (5.1.4 PATH Resolution). The remaining unimplemented features are:

| Req | Feature | Status |
|-----|---------|--------|
| 5.1.1–5.1.3 | Cross-Platform Support | Partially done — CI/sidecar has bugs |
| 5.2.2 | Database Encryption | Not started |
| 5.3.3 | Missing OpenCode CLI Detection | Backend exists, no frontend UI |

---

## Feature B: Missing OpenCode CLI Detection (Req 5.3.3)

The backend `check_claude_cli` command and frontend `checkClaudeCli()` API already exist but are **never called**. This feature wires them up with a user-facing dialog and pre-task validation.

### B1. Add CLI status state to taskStore ✅

**File:** `src/stores/taskStore.ts`

Add to `TaskState` interface (after line 76, near `showAbout`):
```typescript
// OpenCode CLI status
showCliMissing: boolean;
setShowCliMissing: (show: boolean) => void;
```

Add to store implementation:
```typescript
showCliMissing: false,
setShowCliMissing: (show) => set({ showCliMissing: show }),
```

### B2. Add pre-flight CLI check in `startTask` ✅

**File:** `src/stores/taskStore.ts` — `startTask` method (line 412)

Insert CLI check before `api.startTask(config)`:
```typescript
startTask: async (config: TaskConfig) => {
  set({ isLoading: true, error: null });
  try {
    // Pre-flight: verify OpenCode CLI is available
    const cliStatus = await api.checkClaudeCli();
    if (!cliStatus.installed) {
      set({ showCliMissing: true, isLoading: false });
      return null;
    }

    // ... existing startTask logic unchanged
```

Also add the same check in `sendFollowUp` before the `startTask` call at line 496.

### B3. Create OpenCodeCliMissingDialog component ✅

**New file:** `src/components/layout/OpenCodeCliMissingDialog.tsx`

A simple dialog (follows `AboutDialog.tsx` pattern) with:
- Title: "OpenCode CLI Not Found"
- Description explaining the CLI is required
- Installation command in a code block: `npm install -g opencode-ai`
- Link to docs
- Close button

Uses existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` from `@/components/ui/dialog` and `Button` from `@/components/ui/button`.

### B4. Wire dialog into App.tsx ✅

**File:** `src/App.tsx`

Import and render alongside existing dialogs (after line 166):
```tsx
import OpenCodeCliMissingDialog from './components/layout/OpenCodeCliMissingDialog';

// In render, after AboutDialog:
const { showCliMissing, setShowCliMissing } = useTaskStore();
// ...
<OpenCodeCliMissingDialog open={showCliMissing} onOpenChange={setShowCliMissing} />
```

### Verification
- `pnpm typecheck` — frontend compiles
- Manual test: rename/remove `opencode` binary, try to start a task, verify dialog appears
- Manual test: with `opencode` installed, verify tasks start normally (no regression)

---

## Post-Implementation

- Mark 5.3.3 with checkmark in `requirements.md`
- Update Outstanding Feature TODO checklist
- Add plan reference to Implementation Plans Index table
- Add entry to `UPDATE_LOG.md`
