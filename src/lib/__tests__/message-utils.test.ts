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
});
