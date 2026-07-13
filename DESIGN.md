---
name: Cowork-Z
description: Local-first desktop workspace for autonomous AI agents
colors:
  deep-forest: "#213c20"
  sage-mist: "#d8dfd7"
  forest-ink: "#2b391e"
  canvas: "#f9f9f9"
  card-white: "#fcfcfc"
  ink: "#202020"
  graphite: "#646464"
  mist: "#efefef"
  hover-gray: "#e8e8e8"
  clay-line: "#eae2e1"
  input-gray: "#d8d8d8"
  saddle-ring: "#644a40"
  tomato-alert: "#e54d2e"
  amber-warning: "#ee7909"
  meadow-success: "#019e55"
typography:
  headline:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  card: "24px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.deep-forest}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#213c20e6"
  button-secondary:
    backgroundColor: "{colors.sage-mist}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "#00000000"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.hover-gray}"
  input:
    backgroundColor: "#00000000"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  badge:
    backgroundColor: "{colors.deep-forest}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "2px 8px"
  skill-pill:
    backgroundColor: "#213c201a"
    textColor: "{colors.deep-forest}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
---

# Design System: Cowork-Z

## 1. Overview

**Creative North Star: "The Helpful Colleague"**

Cowork-Z looks and behaves like a competent co-worker: warm, plain-spoken, and calm while agents do real work on real files. The system is a light, quiet workspace: soft neutral surfaces, one deep green voice for action, and a single friendly typeface doing every job. Nothing performs. Trust comes from legibility: permissions, tool calls, and agent progress are always visible in the same steady visual language.

The register is product. Familiarity is a feature; users should recognize every control from tools they already know (Notion's approachable surfaces, Claude Desktop's clean message stream). The system explicitly rejects the hacker terminal aesthetic, enterprise admin gray, SaaS marketing gloss, and toy-like AI novelty, the four failure modes named in PRODUCT.md.

Today the app ships light theme only. `darkMode: 'class'` is wired in Tailwind and components carry `dark:` classes, but no dark token values exist yet in `globals.css`. Until they do, treat dark mode as undefined territory: never improvise dark colors per-component.

**Key Characteristics:**
- Light, soft-neutral canvas with one committed green accent
- Single typeface (DM Sans) across all roles
- Crisp and quiet components: tidy 6px control radii, generous 24px card radii, 150ms transitions
- Whisper-level shadows; the focus ring is the loudest depth cue
- Every state visible: hover, focus, active, disabled, loading, error

## 2. Colors

A restrained palette: near-neutral grays warmed by clay-tinted borders, with Deep Forest as the single voice of action.

### Primary
- **Deep Forest** (#213c20): The only action color. Primary buttons, active selections, skill pills, and the active sidebar-resize handle. It signals "this is what you can do" and nothing else.

### Secondary
- **Sage Mist** (#d8dfd7): Soft green-gray fill for secondary buttons and gentle emphasis surfaces, always paired with **Forest Ink** (#2b391e) text.

### Neutral
- **Canvas** (#f9f9f9): The app background.
- **Card White** (#fcfcfc): Cards, popovers, panels; one step brighter than Canvas.
- **Ink** (#202020): Primary text.
- **Graphite** (#646464): Muted text, placeholders, descriptions. 5.7:1 on Canvas passes AA; do not lighten it.
- **Mist** (#efefef): Muted fills and subtle backgrounds.
- **Hover Gray** (#e8e8e8): Hover fills for ghost and outline controls.
- **Clay Line** (#eae2e1): Borders and dividers. Its warm undertone is where the brand's friendliness lives at the neutral layer.
- **Input Gray** (#d8d8d8): Input borders.
- **Saddle Ring** (#644a40): Focus rings only. Warm brown, distinct from both the green accent and the grays, so keyboard focus is unmistakable.

### Semantic
- **Tomato Alert** (#e54d2e): Destructive actions and errors, white text on solid fills.
- **Amber Warning** (#ee7909): Warnings.
- **Meadow Success** (#019e55): Success states.

### Named Rules
**The One Green Rule.** Deep Forest speaks only for action and selection. It never decorates: no green section headers, no green icons for flavor, no green backgrounds behind passive content. Rarity is what makes the primary button read instantly.

**The State-Only Semantics Rule.** Tomato, Amber, and Meadow appear exclusively when the interface reports a state. A screen with no errors, warnings, or successes shows none of them.

**The Legacy Blue Ban.** `accent.blue` (#3397FC) exists for backward compatibility only. Prohibited in new work.

## 3. Typography

**Body Font:** DM Sans (with ui-sans-serif, system-ui fallback), self-hosted at weights 300 / 400 / 500 / 700 / 900

**Character:** A low-contrast geometric sans with friendly, slightly rounded letterforms. It reads warm without trying, which lets the interface stay plain-spoken. One family carries headings, buttons, labels, body, and data.

### Hierarchy
- **Headline** (700, 1.25rem, 1.3): Page and panel headings.
- **Title** (600, 1rem, 1.2): Card titles and section leads, tight line-height.
- **Body** (400, 0.875rem, 1.5): Default UI text. Chat prose may run at 1rem; keep prose measure at 65–75ch.
- **Label** (500, 0.875rem, 1.4): Buttons, form labels, badges (badges drop to 0.75rem).

### Named Rules
**The One Family Rule.** DM Sans does every job. No display font, no second sans. Monospace appears only inside code blocks and file paths in agent output — never in UI chrome, labels, or navigation.

## 4. Elevation

Whisper shadows: the system is flat-leaning. Surfaces sit calm at rest, separated by borders (Clay Line) and one-step background shifts (Canvas → Card White) more than by shadow. Shadows exist at 10% black alpha with 1–3px blurs — just enough to lift cards and popovers off the page. The strongest depth signal in the whole system is the focus ring, and that is deliberate: keyboard position outranks decorative depth.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 3px 0 hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)`): Cards and panels at rest.
- **Hover lift** (`box-shadow: 0 1px 3px 0 hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)`): Interactive cards on hover.
- **Overlay** (`box-shadow: 0 1px 3px 0 hsl(0 0% 0% / 0.25)`): Dialogs and dropdowns; the ceiling.
- **Focus ring** (`0 0 0 3px hsl(20 25% 33% / 0.5)` via `ring-ring/50`): Saddle Ring at 50%, 3px. Non-negotiable on every interactive element.

### Named Rules
**The Whisper Rule.** If you notice the shadow, it is too dark. Depth beyond the overlay ceiling (25% alpha) is prohibited.

## 5. Components

Crisp and quiet: tidy radii, fast 150ms transitions, precision without coldness. Every interactive component ships with default, hover, focus, active, disabled, loading, and error states. No exceptions.

### Buttons
- **Shape:** Gently rounded corners (6px), 36px tall at default size (32px small, 40px large).
- **Primary:** Deep Forest fill, white text, medium weight 0.875rem label; hover dims to 90% opacity.
- **Secondary:** Sage Mist fill with Forest Ink text; hover dims to 80%.
- **Outline:** Canvas fill with a Clay Line border and a hairline shadow; hover fills Hover Gray.
- **Ghost:** Transparent; hover fills Hover Gray.
- **Destructive:** Tomato Alert fill, white text.
- **Hover / Focus:** All transitions ~150ms; focus shows the 3px Saddle Ring, always.
- **Disabled:** 50% opacity, pointer events off.

### Chips / Badges
- **Style:** 6px radius, 0.75rem medium text, 2px 8px padding. Default is Deep Forest fill with white text; secondary is Sage Mist; outline is borderless text with hover fill.

### Cards / Containers
- **Corner Style:** Generously rounded (24px) — the one soft gesture in an otherwise crisp system.
- **Background:** Card White on the Canvas background.
- **Shadow Strategy:** Resting card shadow; hover lift only when the card is clickable.
- **Border:** 1px Clay Line.
- **Internal Padding:** 24px, with 24px gaps between header, content, and footer.

### Inputs / Fields
- **Style:** Transparent background, 1px Input Gray border, 6px radius, 36px height, 12px horizontal padding.
- **Focus:** Border shifts to Saddle Ring plus the 3px ring at 50% — no glow, no color flood.
- **Error / Disabled:** Invalid inputs take a Tomato border with a 20%-alpha tomato ring; disabled drops to 50% opacity with a not-allowed cursor.
- **Placeholders:** Graphite, in DM Sans.

### Navigation
- **Sidebar:** A second neutral layer with a 4px drag handle for resizing; the handle's hover state is Clay Line and its active state is Deep Forest. Conversation items support inline rename.
- **Scrollbars:** Slim 6px, transparent track, Clay Line thumb.

### Skill Pill (signature)
The attach-a-skill chip: Deep Forest at 10% fill, 30% border, full-strength Deep Forest text, 6px radius. It is the one place the accent appears as a tint, and it marks agent capability — which is why it earns the green.

## 6. Do's and Don'ts

### Do:
- **Do** route every color through the CSS variables in `globals.css`; components reference tokens (`bg-primary`, `border-input`), never raw hex.
- **Do** give every interactive element the full state set: default, hover, focus-visible, active, disabled, loading, error.
- **Do** keep body and muted text at AA contrast: Ink or Graphite on Canvas, nothing lighter than Graphite (#646464).
- **Do** use skeletons for loading and empty states that teach the interface (`empty-state.tsx` exists — use it).
- **Do** respect `prefers-reduced-motion` with a crossfade or instant alternative for every animation.

### Don't:
- **Don't** ship the "hacker terminal aesthetic" — no dark-mode-only screens, no monospace UI chrome, no matrix green. PRODUCT.md names it first for a reason.
- **Don't** drift into "enterprise admin gray" — surfaces without the warm Clay Line borders and green accent become lifeless dashboard sprawl.
- **Don't** import "SaaS marketing gloss" into the app: no gradient heroes, no glassmorphism, no gradient text anywhere.
- **Don't** add "toy-like AI novelty": no sparkle emojis, mascots, or AI-magic theatrics around agent activity. Show the agent's hands instead.
- **Don't** use the legacy blue (#3397FC) or hardcoded hex in new components.
- **Don't** improvise dark-mode colors; dark tokens are undefined until they land in `globals.css` as a full set.
- **Don't** use colored side-stripe borders (`border-left` > 1px) on cards, list items, or alerts.
- **Don't** exceed the overlay shadow ceiling (25% alpha) or stack nested cards.
