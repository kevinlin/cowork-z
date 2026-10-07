---
date: 2026-07-27T22:49:19+08:00
researcher: Kevin Lin
git_commit: db93d75bf634e3a855b29e00d8f5d677438cac1f
branch: main
repository: openworker
topic: "Right sidebar (RightRail) implementation and its collapse-on-user-action behavior"
tags: [research, codebase, gui, right-rail, sidebar, collapse, react]
status: complete
last_updated: 2026-07-27
last_updated_by: Kevin Lin
---

# Research: Right sidebar implementation and collapse behavior

**Date**: 2026-07-27T22:49:19+08:00
**Researcher**: Kevin Lin
**Git Commit**: `db93d75bf634e3a855b29e00d8f5d677438cac1f`
**Branch**: main
**Repository**: openworker (github.com/andrewyng/openworker)

## Research Question

How is the right side-bar implemented, and how does it collapse on user action?

## Summary

The right sidebar is `RightRail`, defined in [surfaces/gui/src/components/RightRail.tsx](../../surfaces/gui/src/components/RightRail.tsx) and rendered by [surfaces/gui/src/App.tsx](surfaces/gui/src/App.tsx). It is session-scoped and shows three stacked areas: Progress, Artifacts (Cowork only), and Access. Selecting an artifact swaps the whole rail into a wide file viewer.

There are **three independent collapse mechanisms** in play, and they do not share state:

1. **Rail-level show/hide** — a single boolean `railHidden` in `App.tsx`, flipped by a topbar button. Not persisted; resets to visible on every reload.
2. **Section-level accordions** — `RailSection` inside `RightRail.tsx` collapses Progress and Artifacts independently; `AccessSection` carries its own separate copy of that pattern.
3. **Artifact mode** — opening an artifact widens the rail from 332px to `min(62vw, 960px)` and pushes the chat column over.

A fourth, related behavior runs in the opposite direction: opening an artifact preview in the right rail auto-collapses the **left** nav, then restores it.

The rail is hidden by unmounting, not by CSS. When hidden, the component returns `null`; the layout reclaims the width because the `rail-open` class disappears from `.main`. No transitions are defined on any of the rail's width or margin rules, so the show/hide is instantaneous.

## Detailed findings

### Rail-level collapse: `railHidden`

State declaration — [App.tsx:224](surfaces/gui/src/App.tsx#L224):

```tsx
const [railHidden, setRailHidden] = useState(false);
```

Plain component state. Default `false`, meaning the rail starts visible.

**The toggle** lives in the session topbar's right-hand action cluster, [App.tsx:1392-1403](surfaces/gui/src/App.tsx#L1392-L1403), and renders only for non-chat personas:

```tsx
{agent !== "chat" && (
  <button
    className="topbar-icon-btn"
    onMouseDown={(e) => e.stopPropagation()}
    onClick={() => setRailHidden((h) => !h)}
    aria-label={railHidden ? "Show side panel" : "Hide side panel"}
    title={railHidden ? "Show side panel" : "Hide side panel"}
  >
    <Icon name="sidebarRight" size={16} />
  </button>
)}
```

The `onMouseDown` stop-propagation exists because the parent `.main-topbar-actions` has `onPointerDown={beginWindowDrag}` ([App.tsx:1378](surfaces/gui/src/App.tsx#L1378)) — the topbar doubles as the Tauri window drag region.

The icon `sidebarRight` is defined in [Icon.tsx:91-97](surfaces/gui/src/components/Icon.tsx#L91-L97). The left nav's button uses a separate `sidebar` glyph at [Icon.tsx:83-90](surfaces/gui/src/components/Icon.tsx#L83-L90).

**Every write to `railHidden`:**

| Site | Call | Trigger |
|---|---|---|
| [App.tsx:1397](surfaces/gui/src/App.tsx#L1397) | `setRailHidden((h) => !h)` | the topbar panel toggle |
| [App.tsx:1383](surfaces/gui/src/App.tsx#L1383) | `setRailHidden(false)` | the "Artifacts (N)" chip |
| [App.tsx:277](surfaces/gui/src/App.tsx#L277) | `setRailHidden(false)` | `openAccess()` deep link |
| [App.tsx:283](surfaces/gui/src/App.tsx#L283) | `setRailHidden(false)` | `ocw-open-artifact` window event |

There is no write that sets it to `true` other than the toggle itself.

**No persistence.** `railHidden` is never read from or written to `localStorage`, the settings API, or a Tauri store. It resets on reload.

**No keyboard shortcut.** The only `keydown` listener in `App.tsx` is [App.tsx:255-269](surfaces/gui/src/App.tsx#L255-L269), which handles ⌘/Ctrl+B (left nav) and ⌘/Ctrl+, (Settings). Neither touches `railHidden`.

### The escape hatches back to a hidden rail

Because hiding the rail can bury files the agent produced, two paths re-open it without the toggle.

**The Artifacts chip** — [App.tsx:1379-1390](surfaces/gui/src/App.tsx#L1379-L1390), rendered only when `agent === "cowork" && railHidden && artifactCount > 0`. It shows a file icon, the word "Artifacts", and a count badge; clicking sets `railHidden` false. `artifactCount` is its own state at [App.tsx:272](surfaces/gui/src/App.tsx#L272), commented as existing precisely so "produced files are never buried."

**Artifact chips in the transcript** — markdown links of the form `[Title](artifact:path)` dispatch the `ocw-open-artifact` window event. Two listeners react to it independently:

- [App.tsx:282-286](surfaces/gui/src/App.tsx#L282-L286) un-hides the rail.
- [RightRail.tsx:121-149](surfaces/gui/src/components/RightRail.tsx#L121-L149) resolves the path against the loaded artifact list and opens the viewer.

The `App.tsx` comment marks this as UX-016: "clicking an artifact chip in the transcript must land somewhere visible."

**`openAccess()`** — [App.tsx:276-279](surfaces/gui/src/App.tsx#L276-L279) un-hides the rail and bumps `accessKey`, which the rail forwards to `AccessSection` as `openKey` to expand that section and scroll it into view. Called from `SessionIntro` ([App.tsx:1444](surfaces/gui/src/App.tsx#L1444)) and from the onboarding "Start working" flow ([App.tsx:1244-1249](surfaces/gui/src/App.tsx#L1244-L1249), via `setTimeout(openAccess, 80)`).

### How hiding actually removes the rail

Three conditions gate the rail, and the same expression is written twice:

```tsx
surface === "session" && agent !== "chat" && !railHidden
```

- As the `rail-open` class on `.main` — [App.tsx:1316](surfaces/gui/src/App.tsx#L1316)
- As the `active` prop on `<RightRail>` — [App.tsx:1583](surfaces/gui/src/App.tsx#L1583)

`RightRail` short-circuits on that prop at [RightRail.tsx:151](surfaces/gui/src/components/RightRail.tsx#L151):

```tsx
if (!active) return null;
```

So the rail is **unmounted from the DOM**, not hidden with CSS. The React component instance survives (it stays in the JSX tree), so its internal state — section-open flags, loaded artifacts, selected artifact — persists across a hide/show cycle. Its data-loading effects also short-circuit on `active` ([RightRail.tsx:89-92](surfaces/gui/src/components/RightRail.tsx#L89-L92), [RightRail.tsx:121-149](surfaces/gui/src/components/RightRail.tsx#L121-L149)), so a hidden rail does no artifact fetching.

Two other conditions deactivate the rail without touching `railHidden`: navigating away from `surface === "session"` (to Scheduled, Integrations, Settings, Audit, Inbox, or Persona) and running the Chat persona, which never gets a rail at all.

### Layout and width reclamation

The rail is absolutely positioned inside `.main-workspace`, which is `position: relative` ([styles.css:264](surfaces/gui/src/styles.css#L264)). It therefore reserves no space of its own; siblings are offset manually.

```css
.right-rail {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 332px;
  overflow-y: auto;
  background: var(--glass-soft);
  border-left: 1px solid var(--line);
  padding: 18px 16px;
  backdrop-filter: blur(12px);
  z-index: 5;
}
```

[styles.css:524-536](surfaces/gui/src/styles.css#L524-L536). The offsets that make room for it hang off the `rail-open` class:

- `.main.rail-open .main-chat { margin-right: 332px; }` — [styles.css:266](surfaces/gui/src/styles.css#L266)
- `.main.rail-open .main-topbar { right: 332px; }` — [styles.css:219](surfaces/gui/src/styles.css#L219)

When `railHidden` flips, `rail-open` is dropped from `.main`, both offsets vanish, and the chat column reclaims the 332px in the same render that unmounts the rail.

**No transition is defined** on `.right-rail`'s width, on `.main-chat`'s `margin-right`, or on `.main-topbar`'s `right`. The change is instant. (The left nav, by contrast, does animate — see below.)

`.main-workspace` also picks up a `rail-hidden` class when hidden ([App.tsx:1406](surfaces/gui/src/App.tsx#L1406)), but no rule in `styles.css` or anywhere in `src/` matches `.rail-hidden`. As of this commit it is inert.

No `@media` rule references `.right-rail`, `rail-open`, or `rail-hidden`. The rail width is fixed regardless of viewport.

### Artifact mode: the third width state

Opening an artifact sets `selected` ([RightRail.tsx:84](surfaces/gui/src/components/RightRail.tsx#L84)), which appends a class to the same `<aside>` — [RightRail.tsx:154](surfaces/gui/src/components/RightRail.tsx#L154):

```tsx
<aside className={"right-rail" + (selected ? " artifact-mode" : "")}>
```

```css
.right-rail.artifact-mode {
  width: var(--artifact-rail-w);
  z-index: 8;
  padding: 0;
  background: var(--paper);
  backdrop-filter: none;
}
.main.rail-open:has(.right-rail.artifact-mode) .main-chat { margin-right: var(--artifact-rail-w); }
.main.rail-open:has(.right-rail.artifact-mode) .main-topbar { right: var(--artifact-rail-w); }
```

[styles.css:539-547](surfaces/gui/src/styles.css#L539-L547), with `--artifact-rail-w: min(62vw, 960px)` at [styles.css:51](surfaces/gui/src/styles.css#L51). The `:has()` selector is how the chat column learns the rail widened — the class lives on a descendant, so the parent selector is doing the work.

Exiting is the Back button at [RightRail.tsx:309-311](surfaces/gui/src/components/RightRail.tsx#L309-L311) (`aria-label="Back to artifacts"`, icon `arrowLeft`), which sets `selected` to `null`. A session change also clears it — [RightRail.tsx:96-99](surfaces/gui/src/components/RightRail.tsx#L96-L99), on the grounds that an open artifact belongs to the previous session's workspace.

### Section-level accordions inside the rail

Per-section collapse state — [RightRail.tsx:79-82](surfaces/gui/src/components/RightRail.tsx#L79-L82):

```tsx
const [open, setOpen] = useState<Record<Panel, boolean>>({ progress: true, artifacts: true });
```

Both default to expanded. `RailSection` ([RightRail.tsx:261-286](surfaces/gui/src/components/RightRail.tsx#L261-L286)) renders:

```tsx
<section className="rail-section">
  <div className="rail-section-head">
    <button className="rail-section-toggle" onClick={onToggle}>
      <Icon name={open ? "chevronDown" : "chevronRight"} size={14} className="rail-chev" />
      <span>{title}</span>
    </button>
    {action}
  </div>
  {open && <div className="rail-section-body">{children}</div>}
</section>
```

Details of this pattern:

- The whole header is the toggle — a `<button>` styled as text ([styles.css:552](surfaces/gui/src/styles.css#L552)), not just the chevron.
- The body is **conditionally mounted** (`{open && ...}`), not `display: none`. No transition; no animation rules on `.rail-section*` in `styles.css`.
- Chevron direction is the only visual state indicator. There is no `aria-expanded` or `aria-controls` anywhere in `RightRail.tsx` — the only `aria-*` attributes in the file are `aria-label` on the artifact viewer's icon buttons ([RightRail.tsx:309, 324, 334, 345, 353](surfaces/gui/src/components/RightRail.tsx#L309)).
- The Artifacts header's `action` slot holds two `rail-mini-btn` icon buttons (reveal folder, refresh) whose handlers call `e.stopPropagation()` so clicking them does not also collapse the section — [RightRail.tsx:174-187](surfaces/gui/src/components/RightRail.tsx#L174-L187).

`AccessSection` does **not** reuse `RailSection`. It reimplements the same markup inline at [AccessSection.tsx:227-240](surfaces/gui/src/components/AccessSection.tsx#L227-L240) with its own `open` state at [AccessSection.tsx:72](surfaces/gui/src/components/AccessSection.tsx#L72). `RightRail` mounts it with `key={sessionId}` ([RightRail.tsx:212-222](surfaces/gui/src/components/RightRail.tsx#L212-L222)) so all of that state resets when the conversation changes.

Which sections appear:

- **Progress** — always, when not in artifact mode ([RightRail.tsx:165-167](surfaces/gui/src/components/RightRail.tsx#L165-L167)).
- **Artifacts** — only when `showArtifacts`, which `App.tsx` passes as `agent === "cowork"` ([App.tsx:1590](surfaces/gui/src/App.tsx#L1590)). The flag also gates fetching ([RightRail.tsx:91](surfaces/gui/src/components/RightRail.tsx#L91)).
- **Access** — always, for every persona ([RightRail.tsx:212](surfaces/gui/src/components/RightRail.tsx#L212)).

### The reverse coupling: the rail collapses the left nav

`RightRail` reports preview open/close upward — [RightRail.tsx:108-110](surfaces/gui/src/components/RightRail.tsx#L108-L110):

```tsx
useEffect(() => { onPreviewChange?.(!!selected); }, [!!selected, onPreviewChange]);
```

`App.tsx` wires that to `onArtifactPreview` ([App.tsx:245-254](surfaces/gui/src/App.tsx#L245-L254)), which collapses the left nav while an artifact preview is open and restores the prior state on close:

```tsx
const onArtifactPreview = useCallback((open: boolean) => {
  if (open) {
    if (navBeforePreview.current === null) navBeforePreview.current = navCollapsed;
    setNavPeek(false);
    setNavCollapsed(true);
  } else if (navBeforePreview.current !== null) {
    setNavCollapsed(navBeforePreview.current);
    navBeforePreview.current = null;
  }
}, [navCollapsed]);
```

Two deliberate details, both called out in the surrounding comments:

- It calls `setNavCollapsed`, not `setNavCollapsedPersist` — the auto-collapse is transient and "never overwrites the pref."
- `toggleNav` clears `navBeforePreview.current` ([App.tsx:240](surfaces/gui/src/App.tsx#L240)), so a manual toggle during a preview takes control and the restore is skipped.

### Contrast: the left nav's collapse

Useful because the two sidebars solve the same problem differently.

| | Right rail (`railHidden`) | Left nav (`navCollapsed`) |
|---|---|---|
| State | [App.tsx:224](surfaces/gui/src/App.tsx#L224) | [App.tsx:227-229](surfaces/gui/src/App.tsx#L227-L229) |
| Persisted | no | yes — `localStorage`, key `coworker:nav-collapsed:v1` ([App.tsx:94](surfaces/gui/src/App.tsx#L94), written at [App.tsx:234-237](surfaces/gui/src/App.tsx#L234-L237)) |
| Keyboard | none | ⌘/Ctrl+B ([App.tsx:257-259](surfaces/gui/src/App.tsx#L257-L259)) |
| Hide technique | unmount (`return null`) | stays mounted, `transform: translateX(-100%)` |
| Animated | no | yes — `transition: transform 0.18s ease` ([styles.css:128](surfaces/gui/src/styles.css#L128)) |
| Layout | absolute + sibling margins | grid column collapses to `1fr` ([styles.css:119](surfaces/gui/src/styles.css#L119)) |
| Peek | none | hover a 14px left-edge zone → `.nav-peek` floats it back as an overlay ([styles.css:120-142](surfaces/gui/src/styles.css#L120-L142)) |
| Reveal affordance | topbar Artifacts chip (Cowork only) | fixed `.nav-reveal-btn` ([App.tsx:1221-1230](surfaces/gui/src/App.tsx#L1221-L1230)) |

The left nav's collapsed sidebar is taken out of flow deliberately — the comment at [styles.css:116-118](surfaces/gui/src/styles.css#L116-L118) notes a leading zero-width grid column would swallow the main content instead.

### Props the rail receives

Full list from [App.tsx:1582-1598](surfaces/gui/src/App.tsx#L1582-L1598), against the interface at [RightRail.tsx:39-60](surfaces/gui/src/components/RightRail.tsx#L39-L60):

| Prop | Value passed | Role |
|---|---|---|
| `active` | `surface === "session" && agent !== "chat" && !railHidden` | the mount gate |
| `sessionId` | `sessionId` | scopes API calls; `key` for `AccessSection` |
| `refreshKey` | `browserRefreshKey` | bump to re-fetch artifacts |
| `toolNames` | tool items from the transcript | "N tool calls so far" line |
| `todo` | `todo` | Progress list |
| `running` | `running` | Progress copy branch |
| `onPreviewChange` | `onArtifactPreview` | drives left-nav auto-collapse |
| `showArtifacts` | `agent === "cowork"` | gates the Artifacts section and its fetch |
| `personaId` / `projectScoped` / `workspace` / `branch` / `scratchPrimary` | session facts | forwarded to `AccessSection` |
| `openAccessKey` | `accessKey` | bump expands + scrolls Access into view |
| `onOpenIntegrations` | `() => setSurface("integrations")` | forwarded to `AccessSection` |

### Test coverage

No dedicated test exercises the rail's own show/hide. There is no `RightRail.test.tsx` and no e2e spec whose subject is the panel toggle.

Specs that touch the rail do so for its Access section — a different collapse:

- [surfaces/gui/e2e/access-section.spec.ts](surfaces/gui/e2e/access-section.spec.ts) — "no topbar opener; the Access header IS the ambient glance; expanding edits inline", plus source-add and per-session mute cases.
- [surfaces/gui/e2e/roots.spec.ts](surfaces/gui/e2e/roots.spec.ts) — the read-only/read-write folder gate, which the header comment notes "since §32 lives in the rail's Access section."
- [surfaces/gui/e2e/session-intro.spec.ts](surfaces/gui/e2e/session-intro.spec.ts) — gated rows "expand the rail's Access section".
- [surfaces/gui/e2e/cloud-status-pending.spec.ts](surfaces/gui/e2e/cloud-status-pending.spec.ts) — signing in from the rail's connect pane.
- [surfaces/gui/e2e/sources-channels.spec.ts](surfaces/gui/e2e/sources-channels.spec.ts) — opens the Access section as setup.

The **left** nav's collapse is directly tested — [surfaces/gui/e2e/nav-collapse.spec.ts](surfaces/gui/e2e/nav-collapse.spec.ts):

- "collapse hides the sidebar and reclaims the width; reveal button docks it back"
- "⌘B toggles the sidebar collapse"

[surfaces/gui/src/components/Sidebar.test.tsx](surfaces/gui/src/components/Sidebar.test.tsx) covers adjacent sidebar behavior (grouping, row menus, Slack group, new-session split button) but not the collapse toggle.

## Code references

- `surfaces/gui/src/App.tsx:224` — `railHidden` state declaration
- `surfaces/gui/src/App.tsx:245-254` — `onArtifactPreview`, left-nav auto-collapse with restore
- `surfaces/gui/src/App.tsx:255-269` — the only keydown listener (⌘B nav, ⌘, settings)
- `surfaces/gui/src/App.tsx:276-286` — `openAccess()` and the `ocw-open-artifact` un-hide listener
- `surfaces/gui/src/App.tsx:1316` — `rail-open` class on `.main`
- `surfaces/gui/src/App.tsx:1379-1390` — the "Artifacts (N)" re-open chip
- `surfaces/gui/src/App.tsx:1392-1403` — the panel toggle button
- `surfaces/gui/src/App.tsx:1406` — `rail-hidden` class (no matching CSS rule)
- `surfaces/gui/src/App.tsx:1582-1598` — `<RightRail>` render site and props
- `surfaces/gui/src/components/RightRail.tsx:39-60` — props interface
- `surfaces/gui/src/components/RightRail.tsx:79-82` — per-section `open` state
- `surfaces/gui/src/components/RightRail.tsx:96-110` — session-change reset and `onPreviewChange`
- `surfaces/gui/src/components/RightRail.tsx:121-149` — `OPEN_ARTIFACT_EVENT` listener and path matching
- `surfaces/gui/src/components/RightRail.tsx:151` — `if (!active) return null`
- `surfaces/gui/src/components/RightRail.tsx:154` — `<aside>` with conditional `artifact-mode`
- `surfaces/gui/src/components/RightRail.tsx:261-286` — `RailSection` accordion
- `surfaces/gui/src/components/AccessSection.tsx:72,227-240` — the section's own collapse state and markup
- `surfaces/gui/src/styles.css:51` — `--artifact-rail-w`
- `surfaces/gui/src/styles.css:113-172` — left-nav collapse block (transform, transition, peek zone)
- `surfaces/gui/src/styles.css:219,266` — `rail-open` sibling offsets
- `surfaces/gui/src/styles.css:524-555` — `.right-rail`, artifact mode, and rail section rules
- `surfaces/gui/src/components/Icon.tsx:83-97` — `sidebar` and `sidebarRight` glyphs

## Architecture notes

Patterns visible in this area of the codebase:

- **Plain CSS, not Tailwind, for app chrome.** Tailwind is a dependency, but `RightRail.tsx`, `App.tsx`'s layout shell, and `styles.css` use hand-written class names throughout.
- **Absolute overlay plus manual sibling offsets** is how the right rail participates in layout; the left nav instead uses a grid column. Both approaches coexist in `.app` / `.main`.
- **`:has()` for parent reaction** — the chat column responds to the rail's artifact mode through `.main.rail-open:has(.right-rail.artifact-mode)` rather than lifting that state into React.
- **Window CustomEvents as a cross-component channel** — `ocw-open-artifact` is dispatched by `Markdown.tsx` and consumed independently by `App.tsx` (un-hide) and `RightRail.tsx` (select), avoiding a prop chain through the transcript.
- **Conditional mount over CSS hiding** for the rail and its section bodies; the left nav is the exception, staying mounted so it can animate.
- **Transient vs. persisted UI state is distinguished explicitly** — `setNavCollapsed` vs. `setNavCollapsedPersist`, with a ref (`navBeforePreview`) holding the pre-auto-collapse value.
- **Section duplication** — `RailSection` in `RightRail.tsx` and the inline equivalent in `AccessSection.tsx` are separate implementations of the same header/chevron/body shape.

## Historical context

This repository has no `thoughts/` directory, and no markdown file documents the rail or its collapse behavior — `README.md`, `docs/`, and all other `*.md` files contain no matches for "rail" or "collapse". Before this document, the only prose about the feature was inline code comments.

Those comments reference a `§NN` section-numbering scheme (§22, §23, §31, §32, §34/UX-016) that no file in this repo defines. The same pattern appears in backend docstrings, which point at `platform/docs/*.md` files that are also absent — both look like residue from the pre-split aisuite repository. The §-numbers that touch the rail:

- **§22** — model/mode/persona chrome moved out of the topbar; the collapsed-sidebar cluster gained its own search.
- **§23** — the session-settings icon that preceded the current panel toggle.
- **§32** — Access moved into the rail, which is why the panel toggle now renders for every non-chat persona, not just Cowork.
- **§34 / UX-016** — transcript artifact chips must land somewhere visible, hence the un-hide listener.
- **#3** — the artifact-preview left-nav auto-collapse.

## Related research

None. This is the first document in `docs/research/`.

## Open questions

- The `rail-hidden` class on `.main-workspace` ([App.tsx:1406](surfaces/gui/src/App.tsx#L1406)) has no matching CSS rule at this commit. Whether it is a leftover or a hook intended for future styling is not determinable from the code.
- The `§NN` spec numbers referenced throughout are not resolvable within this repository.
