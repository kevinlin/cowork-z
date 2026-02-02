import { describe, it, expect } from 'vitest';
import { extractUserFacingContent } from '../message-utils';

describe('extractUserFacingContent', () => {
  it('should extract content after Execution: when Plan/Execution pattern exists', () => {
    const input = `Plan:
Goal: Tell a family-friendly joke about a teenage girl.

Steps:
1. Create a short, wholesome, non-offensive joke → verify: suitable for all ages.
2. Deliver the joke to the user clearly → verify: user receives the joke text.

Execution:
Why did the teenage girl sit by the Wi-Fi router? Because she heard it was a great place to find a connection.

Would you like another joke?`;

    const expected = `Why did the teenage girl sit by the Wi-Fi router? Because she heard it was a great place to find a connection.

Would you like another joke?`;

    expect(extractUserFacingContent(input)).toBe(expected);
  });

  it('should return original content when no Plan pattern exists', () => {
    const input = 'Just a regular message without any special format.';
    expect(extractUserFacingContent(input)).toBe(input);
  });

  it('should return original content when Plan exists but no Execution', () => {
    const input = `Plan:
Goal: Do something.

Steps:
1. First step
2. Second step`;

    expect(extractUserFacingContent(input)).toBe(input);
  });

  it('should return original content when Execution exists but no Plan at start', () => {
    const input = `Some prefix text
Execution:
The actual content`;

    expect(extractUserFacingContent(input)).toBe(input);
  });

  it('should handle empty execution section', () => {
    const input = `Plan:
Goal: Test.

Execution:
`;
    expect(extractUserFacingContent(input)).toBe('');
  });

  it('should handle execution with only whitespace', () => {
    const input = `Plan:
Goal: Test.

Execution:

`;
    expect(extractUserFacingContent(input)).toBe('');
  });

  it('should be case-insensitive for Plan and Execution keywords', () => {
    const input = `plan:
Goal: Test.

execution:
The result here.`;

    expect(extractUserFacingContent(input)).toBe('The result here.');
  });

  it('should handle multiline execution content', () => {
    const input = `Plan:
Goal: Create a list.

Execution:
Line 1
Line 2
Line 3`;

    expect(extractUserFacingContent(input)).toBe(`Line 1
Line 2
Line 3`);
  });

  // === NEW TESTS FOR BOLD PLAN FORMAT ===

  it('should extract content after Steps in bold Plan format', () => {
    const input = `**Plan:**
Goal: List the available tools in markdown format.

Steps:
1. Identify the tools available in this session → verify: list includes each tool name shown in the tool registry.
2. Present them in markdown format → verify: output is a markdown list.

## Available tools

- \`functions.question\`
- \`functions.bash\`
- \`functions.read\``;

    const expected = `## Available tools

- \`functions.question\`
- \`functions.bash\`
- \`functions.read\``;

    expect(extractUserFacingContent(input)).toBe(expected);
  });

  it('should strip Next steps section from the end', () => {
    const input = `**Plan:**
Goal: Locate the PDF and summarize.

Steps:
1. Search Downloads → verify: file path found.
2. Read the PDF → verify: text extracted.
3. Summarize → verify: summary covers key points.

**Summary of the report**
- **Objective:** Evaluate the prototype.

**Next steps:** Discuss with stakeholders, redesign templates.`;

    const expected = `**Summary of the report**
- **Objective:** Evaluate the prototype.`;

    expect(extractUserFacingContent(input)).toBe(expected);
  });

  it('should handle bold Plan format with simple joke response', () => {
    const input = `**Plan:**
Goal: Tell a joke.

Steps:
1. Provide a short, friendly joke → verify: joke delivered clearly in one or two lines.

Why don't programmers like nature?
It has too many bugs.`;

    const expected = `Why don't programmers like nature?
It has too many bugs.`;

    expect(extractUserFacingContent(input)).toBe(expected);
  });

  it('should handle Next steps with multiline content', () => {
    const input = `**Plan:**
Goal: Test.

Steps:
1. Do something → verify: done.

The actual content here.

**Next steps:** First action, second action, run second testing round, pilot with high-quality entries.`;

    const expected = `The actual content here.`;

    expect(extractUserFacingContent(input)).toBe(expected);
  });

  it('should be case-insensitive for Next steps', () => {
    const input = `**Plan:**
Goal: Test.

Steps:
1. Do something → verify: done.

Result content.

**next steps:** Some actions.`;

    expect(extractUserFacingContent(input)).toBe('Result content.');
  });
});
