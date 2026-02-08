# Zühlke Visual Style Guide

> Extracted from [zuehlke.com/en](https://www.zuehlke.com/en)

---

## 1. Color Palette

### Primary Brand Colors

| Color Name | HEX | Usage |
|------------|-----|-------|
| Purple 500 | `#965B9A` | Primary brand accent, focus states, links |
| Purple 600 | `#834F87` | Primary buttons, hover states |
| Purple 700 | `#643C67` | Dark accent, pressed states |
| Purple 900 | `#422843` | Deep accent |

### Secondary / Accent Colors

| Color Name | HEX | Usage |
|------------|-----|-------|
| Bright Blue 400 | `#66CCFF` | Highlights, decorative accents |
| Bright Blue 500 | `#1AB3FF` | Links, interactive elements |
| Bright Blue 600 | `#0092DB` | Secondary accent |
| Blue 500 | `#0099CC` | Alternative accent |
| Bright Green 500 | `#CCFF00` | Success, highlights |
| Green 500 | `#00CC66` | Success states |

### Background Colors

| Color Name | HEX | Usage |
|------------|-----|-------|
| White | `#FFFFFF` | Primary background |
| Topaz 050 | `#FBFBFE` | Light background, cards |
| Topaz 100 | `#F4F4FB` | Section backgrounds, alternating rows |
| Topaz 200 | `#D6D4DD` | Borders, dividers |

### Surface Colors

| Color Name | HEX | Usage |
|------------|-----|-------|
| Topaz 800 | `#302B43` | Dark surfaces, footer background |
| Topaz 900 | `#121019` | Darkest surfaces, overlays |
| Black | `#000000` | Pure black (sparingly used) |

### Text Colors

| Color Name | HEX | Usage |
|------------|-----|-------|
| Topaz 800 | `#302B43` | Primary text color |
| Topaz 600 | `#575469` | Secondary text, captions |
| Topaz 500 | `#7E7B8D` | Muted text, placeholders |
| White | `#FFFFFF` | Text on dark backgrounds |
| Purple 500 | `#965B9A` | Link text |
| Error Red | `#CF2217` | Error messages |

### Gradient (Signature Brand Element)

```css
--background-gradient: linear-gradient(
  155deg,
  #AA41AF 9.73%,
  #834FB8 51.52%,
  #3C69C8 79.38%,
  #00A5E6 97.96%
);
```

*Used for hero sections, decorative elements, and button hover effects.*

---

## 2. Typography

### Font Families

| Type | Font | Fallback | Usage |
|------|------|----------|-------|
| Display | `AA Zuehlke OTPS` | — | Large headlines, hero text |
| Primary | `Lato` | `sans-serif` | Body text, UI elements, headings |
| Accent | `Cardo` | `serif` | *Inferred:* Quotes, editorial content |
| System | `system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif` | — | Form elements, fallback |
| Monospace | `monospace, monospace` | — | Code snippets |

### Font Sizes

| Scale | Size | Usage |
|-------|------|-------|
| Display 8XL | `8rem` (128px) | Hero headlines |
| Display 7XL | `6rem` (96px) | Large section titles |
| Display 6XL | `4.5rem` (72px) | Section headlines |
| Display 5XL | `3.5rem` (56px) | Major headings |
| Display 4XL | `3rem` (48px) | Page titles |
| Display 3XL | `2.5rem` (40px) | Section titles |
| Display 2XL | `2.25rem` (36px) | Subsection titles |
| H1 | `2rem` (32px) | Primary headings |
| H2 | `1.5rem` (24px) | Secondary headings |
| H3 | `1.25rem` (20px) | Tertiary headings |
| Body Large | `1.125rem` (18px) | Lead paragraphs |
| Body | `1rem` (16px) | Standard body text |
| Small | `0.875rem` (14px) | Captions, metadata |
| XSmall | `0.75rem` (12px) | Labels, fine print |

### Font Weights

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | `400` | Body text |
| Semi-Bold | `600` | Emphasis, subheadings |
| Bold | `700` | Headings, strong emphasis |

### Line Heights

| Type | Value | Usage |
|------|-------|-------|
| Tight | `105%` - `110%` | Display headlines |
| Compact | `125%` - `130%` | Headings |
| Normal | `133%` - `140%` | Body text |
| Relaxed | `150%` | Long-form content |

### Letter Spacing

| Type | Value | Usage |
|------|-------|-------|
| Display | `-0.035rem` | Large headlines |
| Heading | `-0.0225rem` to `-0.02rem` | Section titles |
| Body | `normal` | Standard text |

---

## 3. Spacing & Layout

### Base Spacing Unit

The design system uses an **8px base unit** with a 4px sub-grid.

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| XS | `0.25rem` (4px) | Tight spacing, icon gaps |
| SM | `0.5rem` (8px) | Small gaps |
| MD | `1rem` (16px) | Standard spacing |
| LG | `1.5rem` (24px) | Section padding |
| XL | `2.5rem` (40px) | Large section gaps |
| 2XL | `4rem` (64px) | Module padding (mobile) |
| 3XL | `8rem` (128px) | Module padding (desktop) |

### Module Padding

```css
--base-module-padding-vs: 4rem;   /* Mobile */
--base-module-padding-vl: 8rem;   /* Desktop */
```

### Grid System

| Property | Value |
|----------|-------|
| Max Width | *Inferred:* ~1400px |
| Columns | *Inferred:* 12-column grid |
| Gutter | *Inferred:* 24px - 32px |

### Breakpoints

| Name | Value | Usage |
|------|-------|-------|
| Mobile | `< 700px` | Phone layouts |
| Tablet | `700px - 899px` | Tablet layouts |
| Desktop | `≥ 900px` | Desktop layouts |
| Print | `@media print` | Print styles |

---

## 4. UI Components

### Buttons

#### Primary Button

```css
.button-primary {
  background-color: var(--color-purple-600);  /* #834F87 */
  color: var(--color-white);
  border: transparent;
  border-radius: 0.25rem;
  font-family: Lato, sans-serif;
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.3, 0.42, 0.31, 1);
}

.button-primary:hover {
  background-color: var(--color-topaz-800);  /* #302B43 */
}

.button-primary:focus {
  outline: 3px solid var(--color-purple-500);
}
```

#### Button Variants

| Variant | Background | Border | Text Color |
|---------|------------|--------|------------|
| Primary | Purple 600 | Transparent | White |
| Ghost | White | Topaz 800 | Topaz 800 |
| Ghost Inverted | Transparent | White | White |
| Ghost Transparent | Transparent | White | White |

#### Button Animation

Buttons feature a signature animated dot/arrow effect on hover:

```css
--size-dot: 0.25rem;
/* Dot expands to 196% width on hover */
/* Label shifts left by 1rem */
/* Arrow fades in with opacity transition */
```

### Form Inputs

```css
input, select, textarea {
  font-family: Lato, sans-serif;
  border-radius: 0.25rem;
  margin-bottom: 1.5rem;  /* Desktop */
  margin-bottom: 0.5rem;  /* Mobile */
}

label {
  text-transform: uppercase;
}
```

### Cards

```css
.card {
  background: var(--color-white);
  border-radius: 0.25rem;
  box-shadow: 0 4px 22px 3px var(--color-neutral-100);
  transition: all 0.3s ease;
}

.card:hover {
  box-shadow: 0 4px 22px 3px var(--color-neutral-200);
}
```

### Border Radius

| Size | Value | Usage |
|------|-------|-------|
| XS | `0.125rem` (2px) | Subtle rounding |
| SM | `0.25rem` (4px) | Buttons, inputs, cards |
| MD | `0.375rem` (6px) | Medium elements |
| LG | `1rem` (16px) | Large cards |
| XL | `6rem` (96px) | Pill shapes |
| Full | `50%` / `100%` | Circles, avatars |

### Shadows / Elevation

| Level | Value | Usage |
|-------|-------|-------|
| Base | `0 4px 22px 3px rgba(1, 49, 65, 0.05)` | Cards, elevated surfaces |
| Hover | `0 4px 22px 3px rgba(1, 49, 65, 0.08)` | Hover states |
| Focus | `0 0 0 3px var(--color-purple-500)` | Focus rings |
| Decorative | `4px 4px 48px rgba(238, 0, 255, 0.33), -4px -4px 48px rgba(0, 142, 255, 0.33)` | Gradient glow effect |
| Inset | `inset 0 4px 8px rgba(0, 0, 0, 0.1)` | Pressed states |

---

## 5. Iconography & Imagery

### Icon Style

- **Style**: Line icons (outlined)
- **Stroke Width**: *Inferred:* 1.5px - 2px
- **Format**: SVG (inline and as background images)
- **Color**: Inherits from parent (currentColor)

### Image Treatment

- **Aspect Ratios**: 3:2 (common for teasers/cards)
- **Border Radius**: `0.25rem` (4px) on images within cards
- **Overlays**: Gradient overlays on hero images
- **Background Size**: `cover` for full-bleed images

### Photography Style

- Professional, high-quality imagery
- Focus on people in collaborative/work environments
- Technology and innovation themes
- Clean, well-lit compositions

---

## 6. Motion & Interaction

### Transition Durations

| Speed | Duration | Usage |
|-------|----------|-------|
| Fast | `0.2s` | Micro-interactions, hovers |
| Default | `0.3s` | Standard transitions |
| Slow | `0.75s` | Page transitions, reveals |

### Easing Functions

| Name | Value | Usage |
|------|-------|-------|
| Default | `cubic-bezier(0.3, 0.42, 0.31, 1)` | Standard easing |
| Ease Out | `ease-out` | Exit animations |
| Ease In Out | `ease-in-out` | Symmetric transitions |
| Ease In Quad | `var(--ease-in-quad)` | Clip-path animations |

### Common Transitions

```css
/* Standard transition */
transition: all 0.3s cubic-bezier(0.3, 0.42, 0.31, 1);

/* Fast interaction */
transition: all 0.2s ease-out;

/* Slow reveal */
transition: all 0.75s cubic-bezier(0.3, 0.42, 0.31, 1);

/* Background color */
transition: background-color 0.2s ease-out;

/* Background size (links) */
transition: background-size 0.2s ease-out;
```

### Hover Effects

- **Links**: Underline grows from 0 to 100% width
- **Buttons**: Background color shift + arrow slide-in
- **Cards**: Subtle shadow elevation increase
- **Images**: Scale or overlay transitions

### Focus States

```css
:focus-visible {
  outline: 2px solid var(--color-purple-500);
  /* or */
  box-shadow: 0 0 0 3px var(--color-purple-500);
}
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  /* Animations are disabled or simplified */
}
```

---

## 7. Overall Design Principles

### Visual Tone

- **Premium & Professional**: Clean, sophisticated aesthetic
- **Modern & Technical**: Tech-forward without being cold
- **Trustworthy**: Established brand with 50+ years heritage
- **Innovative**: Forward-thinking, transformation-focused

### Key Design Patterns

1. **Gradient Accents**: Signature purple-to-blue gradient used sparingly for impact
2. **Generous Whitespace**: Clean layouts with ample breathing room
3. **Consistent Rounding**: Subtle 4px border radius throughout
4. **Smooth Animations**: Refined micro-interactions enhance UX
5. **Dark/Light Contrast**: Strong contrast between sections for visual hierarchy

### Accessibility Considerations

- Focus states clearly visible with purple outline
- Sufficient color contrast ratios
- Reduced motion support
- Skip navigation links
- Semantic HTML structure

### Brand Elements

- **Logo**: "Zühlke" wordmark with umlaut
- **Tagline**: "Shaping what matters. Together."
- **Signature Colors**: Purple (#965B9A) and gradient spectrum

---

## CSS Custom Properties Reference

```css
:root {
  /* Colors */
  --color-white: #fff;
  --color-black: #000;
  --color-purple-500: #965b9a;
  --color-purple-600: #834f87;
  --color-purple-700: #643c67;
  --color-topaz-050: #fbfbfe;
  --color-topaz-100: #f4f4fb;
  --color-topaz-200: #d6d4dd;
  --color-topaz-500: #7e7b8d;
  --color-topaz-600: #575469;
  --color-topaz-800: #302b43;
  --color-topaz-900: #121019;
  --color-brightblue-400: #6cf;
  --color-brightblue-600: #0092db;
  --color-error-red: #cf2217;

  /* Base */
  --base-border-radius: 0.125rem;
  --base-color-background: var(--color-white);
  --base-color-foreground: var(--color-topaz-800);
  --base-color-outline: var(--color-purple-500);

  /* Spacing */
  --base-module-padding-vs: 4rem;
  --base-module-padding-vl: 8rem;

  /* Transitions */
  --base-transition-duration-fast: 0.2s;
  --base-transition-duration: 0.3s;
  --base-transition-duration-slow: 0.75s;
  --base-transition-easing: cubic-bezier(0.3, 0.42, 0.31, 1);

  /* Shadows */
  --base-box-shadow: 0 4px 22px 3px var(--color-neutral-100);
  --base-box-shadow-hover: 0 4px 22px 3px var(--color-neutral-200);
  --base-box-shadow-focus: 0 0 0 3px var(--base-color-outline);
}
```

---

*Style guide generated from https://www.zuehlke.com/en*
*Last updated: February 2026*
