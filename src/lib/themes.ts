/**
 * Theme definitions for Cowork-Z
 *
 * 4 predefined themes: 2 green (classic), 2 purple (Zühlke).
 * Each theme defines all CSS custom-property values consumed by
 * Tailwind via hsl(var(--property)).
 */

export type ThemeId = 'classic-light' | 'classic-dark' | 'zuhlke-light' | 'zuhlke-dark';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  isDark: boolean;
  /** CSS variable values in HSL (without hsl() wrapper), keyed by variable name without leading '--' */
  variables: Record<string, string>;
}

/**
 * Classic Light — existing green theme (current defaults from globals.css)
 * Primary: #213c20 → HSL 123 30% 20%
 */
const classicLight: ThemeDefinition = {
  id: 'classic-light',
  label: 'Classic Light',
  isDark: false,
  variables: {
    background: '0 0% 97.6%', // #f9f9f9
    foreground: '0 0% 12.5%', // #202020
    card: '0 0% 98.8%', // #fcfcfc
    'card-foreground': '0 0% 12.5%',
    popover: '0 0% 98.8%',
    'popover-foreground': '0 0% 12.5%',
    primary: '123 30% 20%', // #213c20
    'primary-foreground': '0 0% 100%',
    secondary: '120 14% 85%', // #d8dfd7
    'secondary-foreground': '100 20% 18%',
    muted: '0 0% 93.7%', // #efefef
    'muted-foreground': '0 0% 39.2%',
    accent: '0 0% 91%', // #e8e8e8
    'accent-foreground': '0 0% 12.5%',
    destructive: '8 78% 54%', // #e54d2e
    'destructive-foreground': '0 0% 100%',
    border: '12 8% 90%', // #eae2e1
    input: '0 0% 84.7%', // #d8d8d8
    ring: '20 25% 33%', // #644a40
  },
};

/**
 * Classic Dark — green primary lightened for contrast on dark backgrounds
 * Primary: #4a8a47 → HSL 118 31% 41%
 */
const classicDark: ThemeDefinition = {
  id: 'classic-dark',
  label: 'Classic Dark',
  isDark: true,
  variables: {
    background: '0 0% 7%', // ~#121212
    foreground: '0 0% 93%', // ~#ededed
    card: '0 0% 10%', // ~#1a1a1a
    'card-foreground': '0 0% 93%',
    popover: '0 0% 10%',
    'popover-foreground': '0 0% 93%',
    primary: '118 31% 41%', // #4a8a47
    'primary-foreground': '0 0% 100%',
    secondary: '120 8% 22%', // dark muted green
    'secondary-foreground': '120 14% 80%',
    muted: '0 0% 15%', // ~#262626
    'muted-foreground': '0 0% 60%', // ~#999
    accent: '0 0% 18%', // ~#2e2e2e
    'accent-foreground': '0 0% 93%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '0 0% 20%', // ~#333
    input: '0 0% 25%', // ~#404040
    ring: '118 20% 40%', // muted green ring
  },
};

/**
 * Zühlke Light — purple from branding extra.css
 * Primary: #985b9c → HSL 296 26% 48%
 */
const zuhlkeLight: ThemeDefinition = {
  id: 'zuhlke-light',
  label: 'Zühlke Light',
  isDark: false,
  variables: {
    background: '0 0% 97.6%',
    foreground: '0 0% 12.5%',
    card: '0 0% 98.8%',
    'card-foreground': '0 0% 12.5%',
    popover: '0 0% 98.8%',
    'popover-foreground': '0 0% 12.5%',
    primary: '296 26% 48%', // #985b9c
    'primary-foreground': '0 0% 100%',
    secondary: '296 14% 88%', // light purple tint
    'secondary-foreground': '296 20% 25%',
    muted: '0 0% 93.7%',
    'muted-foreground': '0 0% 39.2%',
    accent: '0 0% 91%',
    'accent-foreground': '0 0% 12.5%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '296 6% 90%', // very light purple-gray
    input: '0 0% 84.7%',
    ring: '296 26% 40%', // darker purple ring
  },
};

/**
 * Zühlke Dark — purple lightened for contrast on dark backgrounds
 * Primary: #b87fbc → HSL 296 30% 62%
 */
const zuhlkeDark: ThemeDefinition = {
  id: 'zuhlke-dark',
  label: 'Zühlke Dark',
  isDark: true,
  variables: {
    background: '0 0% 7%',
    foreground: '0 0% 93%',
    card: '0 0% 10%',
    'card-foreground': '0 0% 93%',
    popover: '0 0% 10%',
    'popover-foreground': '0 0% 93%',
    primary: '296 30% 62%', // #b87fbc
    'primary-foreground': '0 0% 100%',
    secondary: '296 10% 22%',
    'secondary-foreground': '296 14% 80%',
    muted: '0 0% 15%',
    'muted-foreground': '0 0% 60%',
    accent: '0 0% 18%',
    'accent-foreground': '0 0% 93%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '0 0% 20%',
    input: '0 0% 25%',
    ring: '296 25% 50%',
  },
};

/** All available themes */
export const THEMES: ThemeDefinition[] = [classicLight, classicDark, zuhlkeLight, zuhlkeDark];

/** Look up a theme by its ID. Returns Classic Light as fallback. */
export function getThemeById(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? classicLight;
}

/**
 * Apply a theme to the document by setting CSS custom properties
 * and toggling the dark class on <html>.
 */
export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;

  // Set all CSS custom properties
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }

  // Toggle dark class for Tailwind dark: variants
  if (theme.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
