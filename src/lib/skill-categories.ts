/**
 * Shared taxonomy + Tailwind class map for skill categories.
 *
 * Single source of truth used by both the Home tab Skills Catalog
 * (`SkillsCatalog.tsx`) and the Skills Manager grid card (`SkillCard.tsx`).
 * Curated repo categories in `curatedSkillRepos.ts` must use one of these keys.
 */

export type SkillCategory =
  | 'Marketing'
  | 'Sales'
  | 'Finance'
  | 'Enterprise'
  | 'Legal'
  | 'Product'
  | 'Support'
  | 'Data'
  | 'Design'
  | 'Development'
  | 'Document'
  | 'Productivity'
  | 'General';

export const CATEGORY_COLORS: Record<SkillCategory, string> = {
  Marketing: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  Sales: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  Finance: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  Enterprise: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Legal: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  Product: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Support: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Data: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  Design: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  Development: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Document: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  Productivity: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  General: 'bg-muted text-muted-foreground',
};

/** Fallback Tailwind classes when a category is not in `CATEGORY_COLORS`. */
export const CATEGORY_COLOR_FALLBACK = 'bg-muted text-muted-foreground';

/** Look up the Tailwind class string for a category, with safe fallback. */
export function getCategoryColorClass(category: string): string {
  return CATEGORY_COLORS[category as SkillCategory] ?? CATEGORY_COLOR_FALLBACK;
}

type DerivableCategory = Exclude<SkillCategory, 'General'>;

// Order matters: first match wins, so list more specific keys before generic
// ones (e.g. "Document" before "Productivity" so "report" maps to Document).
// Tokens padded with spaces (' pm ', ' ads', ' ui ') match whole-word against
// the space-wrapped haystack in deriveCategoryFromName.
const CATEGORY_KEYWORDS: Record<DerivableCategory, readonly string[]> = {
  Data: ['csv', 'etl', 'analytics', 'data', 'database', 'dataset', 'query', 'spreadsheet', 'sql'],
  Design: [' ui ', ' ux ', 'design', 'experience', 'figma', 'mockup', 'visual', 'wireframe'],
  Development: [
    ' adr ',
    ' branch ',
    ' commit ',
    ' git ',
    ' merge ',
    ' pr ',
    ' review ',
    ' tdd ',
    ' test ',
    'bug fix',
    'bugfix',
    'changelog',
    'code',
    'coding',
    'compile',
    'debug',
    'implement',
    'lint',
    'pull request',
    'refactor',
    'spec',
    'spec-driven',
    'testing',
  ],
  Document: ['document', 'docx', 'excel', 'pdf', 'powerpoint', 'pptx', 'report', 'slide', 'transcript', 'word doc', 'xlsx'],
  Enterprise: ['enterprise', 'governance', 'rbac', 'scim', 'sso'],
  Finance: ['accounting', 'audit', 'budget', 'dcf', 'finance', 'financial', 'forecast', 'general ledger', ' gl ', 'invoice', 'p&l', 'tax'],
  Legal: ['agreement', 'compliance', 'contract', 'gdpr', 'legal', 'license', 'nda', 'privacy', 'terms of', 'tos'],
  Marketing: [' ad ', 'ads', 'brand', 'campaign', 'content writ', 'copywrit', 'growth', 'marketing', 'newsletter', 'seo', 'social'],
  Product: ['feature spec', 'gap', 'jtbd', 'persona', ' pm ', 'prd', 'product manage', 'roadmap', 'user story'],
  Productivity: ['agenda', 'calendar', 'focus', 'meeting', 'note', 'planning', 'productivity', 'task', 'todo', 'workflow'],
  Sales: ['crm', 'deal', 'lead gen', 'outbound', 'pipeline', 'prospect', 'quota', 'sales'],
  Support: [' cs ', 'customer service', 'helpdesk', 'support', 'ticket'],
};

const CATEGORY_KEYWORD_ENTRIES = Object.entries(CATEGORY_KEYWORDS) as [DerivableCategory, readonly string[]][];

export function deriveCategoryFromName(name: string | null | undefined): SkillCategory | null {
  if (!name) {
    return null;
  }
  const haystack = ` ${name.toLowerCase()} `;
  for (const [category, keywords] of CATEGORY_KEYWORD_ENTRIES) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      return category;
    }
  }
  return null;
}

/**
 * Resolve the effective category for a skill following the documented
 * precedence used in the Skills Manager:
 *   1. Keyword match against the skill name (closed taxonomy)
 *   2. The first category assigned to the source repo (skill pack)
 *   3. The supplied `fallback` (typically the backend-derived category)
 *   4. `'General'` as the absolute default
 */
export function deriveSkillCategory(
  skillName: string | null | undefined,
  repoCategories: readonly string[] = [],
  fallback?: string | null
): string {
  const fromName = deriveCategoryFromName(skillName);
  if (fromName) {
    return fromName;
  }
  if (repoCategories.length > 0 && repoCategories[0]) {
    return repoCategories[0];
  }
  if (fallback && fallback.trim().length > 0) {
    return fallback;
  }
  return 'General';
}
