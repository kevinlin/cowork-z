/**
 * Theme definitions for Cowork-Z
 *
 * 12 predefined themes: Sage Garden + Evergreen Dark (green), Zühlke Light/Dark (purple),
 * Nordic Light, Deep Space, Amber Glow, Ocean Depths, Rose Quartz, Midnight Ember,
 * Sandstone, Slate Noir.
 * Each theme defines all CSS custom-property values consumed by
 * Tailwind via hsl(var(--property)).
 */

export type ThemeId =
  | 'classic-light'
  | 'classic-dark'
  | 'zuhlke-light'
  | 'zuhlke-dark'
  | 'nordic-light'
  | 'deep-space'
  | 'amber-glow'
  | 'ocean-depths'
  | 'rose-quartz'
  | 'midnight-ember'
  | 'sage-garden'
  | 'slate-noir';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  isDark: boolean;
  /** CSS variable values in HSL (without hsl() wrapper), keyed by variable name without leading '--' */
  variables: Record<string, string>;
}

/**
 * Sage Garden — muted sage green on natural off-white (default light theme)
 * Primary: #478a6b → HSL 150 32% 41%
 */
const classicLight: ThemeDefinition = {
  id: 'classic-light',
  label: 'Sage Garden',
  isDark: false,
  variables: {
    background: '80 15% 97%',
    foreground: '150 15% 15%',
    card: '80 12% 98.5%',
    'card-foreground': '150 15% 15%',
    popover: '80 12% 98.5%',
    'popover-foreground': '150 15% 15%',
    primary: '150 32% 41%',
    'primary-foreground': '0 0% 100%',
    secondary: '150 18% 88%',
    'secondary-foreground': '150 25% 22%',
    muted: '150 10% 94%',
    'muted-foreground': '150 8% 42%',
    accent: '150 12% 91%',
    'accent-foreground': '150 15% 15%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '150 10% 88%',
    input: '150 8% 83%',
    ring: '150 28% 35%',
  },
};

/**
 * Evergreen Dark — green primary lightened for contrast on dark backgrounds
 * Primary: #4a8a47 → HSL 118 31% 41%
 */
const classicDark: ThemeDefinition = {
  id: 'classic-dark',
  label: 'Evergreen Dark',
  isDark: true,
  variables: {
    background: '0 0% 7%',
    foreground: '0 0% 93%',
    card: '0 0% 10%',
    'card-foreground': '0 0% 93%',
    popover: '0 0% 10%',
    'popover-foreground': '0 0% 93%',
    primary: '118 31% 41%',
    'primary-foreground': '0 0% 100%',
    secondary: '120 12% 22%',
    'secondary-foreground': '120 14% 80%',
    muted: '120 4% 15%',
    'muted-foreground': '0 0% 60%',
    accent: '120 4% 18%',
    'accent-foreground': '0 0% 93%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '120 4% 20%',
    input: '120 4% 25%',
    ring: '118 20% 40%',
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
    primary: '296 26% 48%',
    'primary-foreground': '0 0% 100%',
    secondary: '296 14% 88%',
    'secondary-foreground': '296 20% 25%',
    muted: '296 4% 94%',
    'muted-foreground': '0 0% 39.2%',
    accent: '296 6% 91%',
    'accent-foreground': '0 0% 12.5%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '296 6% 90%',
    input: '296 4% 85%',
    ring: '296 26% 40%',
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
    primary: '296 30% 62%',
    'primary-foreground': '0 0% 100%',
    secondary: '296 10% 22%',
    'secondary-foreground': '296 14% 80%',
    muted: '296 3% 15%',
    'muted-foreground': '0 0% 60%',
    accent: '296 3% 18%',
    'accent-foreground': '0 0% 93%',
    destructive: '8 78% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '296 4% 20%',
    input: '296 4% 25%',
    ring: '296 25% 50%',
  },
};

/**
 * Nordic Light — clean Scandinavian-inspired light theme
 * Primary: #2563eb (Fjord Blue) → HSL 217 84% 53%
 */
const nordicLight: ThemeDefinition = {
  id: 'nordic-light',
  label: 'Nordic Light',
  isDark: false,
  variables: {
    background: '213 33% 99%',
    foreground: '215 28% 17%',
    card: '210 40% 98%',
    'card-foreground': '215 28% 17%',
    popover: '210 40% 98%',
    'popover-foreground': '215 28% 17%',
    primary: '217 84% 53%',
    'primary-foreground': '0 0% 100%',
    secondary: '214 32% 91%',
    'secondary-foreground': '217 50% 30%',
    muted: '210 20% 95%',
    'muted-foreground': '215 14% 46%',
    accent: '214 25% 93%',
    'accent-foreground': '215 28% 17%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '214 20% 90%',
    input: '214 20% 85%',
    ring: '217 84% 53%',
  },
};

/**
 * Deep Space — dark theme with blue undertones
 * Primary: #8b5cf6 (Nebula Violet) → HSL 258 80% 66%
 */
const deepSpace: ThemeDefinition = {
  id: 'deep-space',
  label: 'Deep Space',
  isDark: true,
  variables: {
    background: '240 29% 8%',
    foreground: '215 28% 90%',
    card: '240 20% 11%',
    'card-foreground': '215 28% 90%',
    popover: '240 20% 11%',
    'popover-foreground': '215 28% 90%',
    primary: '258 80% 66%',
    'primary-foreground': '0 0% 100%',
    secondary: '258 20% 20%',
    'secondary-foreground': '258 40% 80%',
    muted: '240 15% 14%',
    'muted-foreground': '215 16% 50%',
    accent: '240 15% 17%',
    'accent-foreground': '215 28% 90%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '240 12% 19%',
    input: '240 12% 24%',
    ring: '258 70% 58%',
  },
};

/**
 * Amber Glow — warm amber/golden primary on cream background
 * Primary: #d98a0b → HSL 38 90% 45%
 */
const amberGlow: ThemeDefinition = {
  id: 'amber-glow',
  label: 'Amber Glow',
  isDark: false,
  variables: {
    background: '40 33% 98%',
    foreground: '30 20% 15%',
    card: '40 25% 99%',
    'card-foreground': '30 20% 15%',
    popover: '40 25% 99%',
    'popover-foreground': '30 20% 15%',
    primary: '38 90% 45%',
    'primary-foreground': '0 0% 100%',
    secondary: '35 30% 90%',
    'secondary-foreground': '30 35% 22%',
    muted: '38 15% 94%',
    'muted-foreground': '30 10% 42%',
    accent: '38 20% 91%',
    'accent-foreground': '30 20% 15%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '35 15% 88%',
    input: '35 12% 83%',
    ring: '38 70% 40%',
  },
};

/**
 * Ocean Depths — deep navy background with teal accents
 * Primary: #2db3b3 → HSL 180 60% 44%
 */
const oceanDepths: ThemeDefinition = {
  id: 'ocean-depths',
  label: 'Ocean Depths',
  isDark: true,
  variables: {
    background: '210 40% 8%',
    foreground: '180 15% 90%',
    card: '210 32% 11%',
    'card-foreground': '180 15% 90%',
    popover: '210 32% 11%',
    'popover-foreground': '180 15% 90%',
    primary: '180 60% 44%',
    'primary-foreground': '0 0% 100%',
    secondary: '180 15% 18%',
    'secondary-foreground': '180 30% 75%',
    muted: '210 20% 12%',
    'muted-foreground': '180 10% 50%',
    accent: '210 18% 16%',
    'accent-foreground': '180 15% 90%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '210 15% 18%',
    input: '210 15% 22%',
    ring: '180 50% 38%',
  },
};

/**
 * Rose Quartz — soft dusty rose primary on warm blush white
 * Primary: #c75b7a → HSL 345 48% 57%
 */
const roseQuartz: ThemeDefinition = {
  id: 'rose-quartz',
  label: 'Rose Quartz',
  isDark: false,
  variables: {
    background: '340 20% 98%',
    foreground: '340 15% 15%',
    card: '340 15% 99%',
    'card-foreground': '340 15% 15%',
    popover: '340 15% 99%',
    'popover-foreground': '340 15% 15%',
    primary: '345 48% 57%',
    'primary-foreground': '0 0% 100%',
    secondary: '340 25% 90%',
    'secondary-foreground': '340 30% 25%',
    muted: '340 12% 94%',
    'muted-foreground': '340 8% 42%',
    accent: '340 15% 91%',
    'accent-foreground': '340 15% 15%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '340 12% 88%',
    input: '340 10% 83%',
    ring: '345 40% 48%',
  },
};

/**
 * Midnight Ember — dark charcoal with warm orange-red accent
 * Primary: #e06030 → HSL 15 74% 53%
 */
const midnightEmber: ThemeDefinition = {
  id: 'midnight-ember',
  label: 'Midnight Ember',
  isDark: true,
  variables: {
    background: '15 8% 8%',
    foreground: '15 10% 90%',
    card: '15 6% 11%',
    'card-foreground': '15 10% 90%',
    popover: '15 6% 11%',
    'popover-foreground': '15 10% 90%',
    primary: '15 74% 53%',
    'primary-foreground': '0 0% 100%',
    secondary: '15 15% 18%',
    'secondary-foreground': '15 30% 75%',
    muted: '15 6% 13%',
    'muted-foreground': '15 8% 50%',
    accent: '15 8% 17%',
    'accent-foreground': '15 10% 90%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '15 6% 19%',
    input: '15 6% 24%',
    ring: '15 60% 45%',
  },
};

/**
 * Sandstone — warm earthy neutral with sandy brown primary
 * Primary: #9a7b5b → HSL 28 26% 48%
 */
const sageGarden: ThemeDefinition = {
  id: 'sage-garden',
  label: 'Sandstone',
  isDark: false,
  variables: {
    background: '30 18% 97%',
    foreground: '25 15% 15%',
    card: '30 15% 98.5%',
    'card-foreground': '25 15% 15%',
    popover: '30 15% 98.5%',
    'popover-foreground': '25 15% 15%',
    primary: '28 26% 48%',
    'primary-foreground': '0 0% 100%',
    secondary: '28 16% 89%',
    'secondary-foreground': '25 22% 22%',
    muted: '28 10% 94%',
    'muted-foreground': '25 8% 42%',
    accent: '28 12% 91%',
    'accent-foreground': '25 15% 15%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '28 10% 87%',
    input: '28 8% 82%',
    ring: '28 22% 40%',
  },
};

/**
 * Slate Noir — cool neutral dark theme with slate-blue primary
 * Primary: #6b89ad → HSL 215 25% 55%
 */
const slateNoir: ThemeDefinition = {
  id: 'slate-noir',
  label: 'Slate Noir',
  isDark: true,
  variables: {
    background: '215 15% 9%',
    foreground: '215 10% 90%',
    card: '215 12% 12%',
    'card-foreground': '215 10% 90%',
    popover: '215 12% 12%',
    'popover-foreground': '215 10% 90%',
    primary: '215 25% 55%',
    'primary-foreground': '0 0% 100%',
    secondary: '215 10% 18%',
    'secondary-foreground': '215 15% 75%',
    muted: '215 8% 14%',
    'muted-foreground': '215 8% 50%',
    accent: '215 8% 17%',
    'accent-foreground': '215 10% 90%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    border: '215 8% 19%',
    input: '215 8% 24%',
    ring: '215 22% 48%',
  },
};

/** All available themes */
export const THEMES: ThemeDefinition[] = [
  classicLight,
  classicDark,
  zuhlkeLight,
  zuhlkeDark,
  nordicLight,
  deepSpace,
  amberGlow,
  oceanDepths,
  roseQuartz,
  midnightEmber,
  sageGarden,
  slateNoir,
];

/** Look up a theme by its ID. Returns Sage Garden as fallback. */
export function getThemeById(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? classicLight;
}

/**
 * Apply a theme to the document by setting CSS custom properties
 * and toggling the dark class on <html>.
 */
export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }

  if (theme.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
