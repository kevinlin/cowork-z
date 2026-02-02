/**
 * Extracts user-facing content from OpenCode responses.
 *
 * OpenCode responses may include internal planning sections that should not
 * be shown to users. Handles two patterns:
 * 1. Plan/Execution format: extracts content after "Execution:"
 * 2. Bold Plan format: extracts content after numbered Steps section
 *
 * Also strips "Next steps:" section from the end if present.
 *
 * @param content - The full message content from OpenCode
 * @returns The user-facing portion of the content
 */
export function extractUserFacingContent(content: string): string {
  let result = content;

  // Pattern 1: Original Plan/Execution format
  const planPattern = /^Plan:\s*\n/i;
  const executionPattern = /\nExecution:\s*\n/i;

  if (planPattern.test(content) && executionPattern.test(content)) {
    const executionMatch = content.match(executionPattern);
    if (executionMatch && executionMatch.index !== undefined) {
      result = content.slice(executionMatch.index + executionMatch[0].length);
    }
  }
  // Pattern 2: Bold Plan format with Steps
  else {
    const boldPlanPattern = /^\*\*Plan:\*\*\s*\n/i;
    // Match the last numbered step with → verify: pattern
    const stepsEndPattern = /\d+\.\s+[^\n]+→[^\n]+verify:[^\n]*\n\n/gi;

    if (boldPlanPattern.test(content)) {
      // Find the last match of the steps pattern
      let lastMatch: RegExpExecArray | null = null;
      let match: RegExpExecArray | null;
      while ((match = stepsEndPattern.exec(content)) !== null) {
        lastMatch = match;
      }

      if (lastMatch) {
        result = content.slice(lastMatch.index + lastMatch[0].length);
      }
    }
  }

  // Strip "Next steps:" section from the end (case-insensitive)
  const nextStepsPattern = /\n\*\*[Nn]ext\s+[Ss]teps:\*\*[\s\S]*$/i;
  result = result.replace(nextStepsPattern, '');

  return result.trim();
}
