/**
 * Extracts user-facing content from OpenCode responses.
 *
 * OpenCode responses may include internal planning sections that should not
 * be shown to users. This function extracts only the "Execution:" portion
 * when the response follows the Plan/Execution pattern.
 *
 * @param content - The full message content from OpenCode
 * @returns The user-facing portion of the content
 */
export function extractUserFacingContent(content: string): string {
  // Check if content follows the Plan/Execution pattern
  const planPattern = /^Plan:\s*\n/i;
  const executionPattern = /\nExecution:\s*\n/i;

  if (!planPattern.test(content) || !executionPattern.test(content)) {
    // Not a Plan/Execution response, return as-is
    return content;
  }

  // Extract content after "Execution:" marker
  const executionMatch = content.match(executionPattern);
  if (executionMatch && executionMatch.index !== undefined) {
    const afterExecution = content.slice(executionMatch.index + executionMatch[0].length);
    return afterExecution.trim();
  }

  return content;
}
