/**
 * Shared taxonomy + Tailwind class map for skill categories.
 *
 * Single source of truth used by both the Home tab Skills Catalog
 * (`SkillsCatalog.tsx`) and the Skills Manager grid card (`SkillCard.tsx`).
 * Curated repo categories in `curatedSkillRepos.ts` must use one of these keys.
 */

export const CATEGORY_COLORS: Record<string, string> = {
  Marketing: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  Sales: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  Finance: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  Enterprise: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Legal: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  Product: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Support: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Data: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  Design: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  Document: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  Productivity: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  General: 'bg-muted text-muted-foreground',
};

/** Fallback Tailwind classes when a category is not in `CATEGORY_COLORS`. */
export const CATEGORY_COLOR_FALLBACK = 'bg-muted text-muted-foreground';

/** Look up the Tailwind class string for a category, with safe fallback. */
export function getCategoryColorClass(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLOR_FALLBACK;
}
