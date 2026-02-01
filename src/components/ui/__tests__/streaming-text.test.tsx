import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { StreamingText } from '../streaming-text';

describe('StreamingText - Real Streaming Mode', () => {
  it('should show text immediately when isRealStreaming=true', () => {
    const text = 'Hello world';

    const { container } = render(
      <StreamingText text={text} isRealStreaming={true}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    // Verify full text shown immediately (no animation delay)
    const content = container.querySelector('[data-testid="content"]');
    expect(content?.textContent).toBe('Hello world');
  });

  it('should show blinking cursor when isRealStreaming=true and incomplete', () => {
    const { container } = render(
      <StreamingText text="Hello" isRealStreaming={true} isComplete={false}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify cursor element exists (has animate-pulse class)
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeTruthy();
  });

  it('should hide cursor when isRealStreaming=true and complete', () => {
    const { container } = render(
      <StreamingText text="Hello" isRealStreaming={true} isComplete={true}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify no cursor element
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeFalsy();
  });

  it('should animate text when isRealStreaming=false (existing behavior)', async () => {
    const text = 'Hello';

    const { container } = render(
      <StreamingText text={text} isRealStreaming={false} speed={1000}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    const content = container.querySelector('[data-testid="content"]');
    
    // Initially shows empty or partial text
    const initialText = content?.textContent || '';
    expect(initialText.length).toBeLessThanOrEqual(text.length);

    // Wait for animation to complete
    await waitFor(
      () => {
        expect(content?.textContent).toBe('Hello');
      },
      { timeout: 2000 }
    );
  });

  it('should update displayed text when text prop changes (real streaming)', () => {
    const { container, rerender } = render(
      <StreamingText text="Hello" isRealStreaming={true}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    const content = container.querySelector('[data-testid="content"]');
    expect(content?.textContent).toBe('Hello');

    // Update text prop
    rerender(
      <StreamingText text="Hello world" isRealStreaming={true}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    // Verify updated text shown immediately
    expect(content?.textContent).toBe('Hello world');
  });

  it('should call onComplete when animation finishes (non-real streaming)', async () => {
    const onComplete = vi.fn();
    const text = 'Hi';

    render(
      <StreamingText text={text} isRealStreaming={false} speed={1000} onComplete={onComplete}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Wait for animation to complete
    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it('should show full text immediately when isComplete=true', () => {
    const text = 'Complete message';

    const { container } = render(
      <StreamingText text={text} isComplete={true} isRealStreaming={false}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    const content = container.querySelector('[data-testid="content"]');
    expect(content?.textContent).toBe('Complete message');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <StreamingText text="Test" isRealStreaming={true} className="custom-class">
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    const wrapper = container.querySelector('.custom-class');
    expect(wrapper).toBeTruthy();
  });

  it('should handle empty text', () => {
    const { container } = render(
      <StreamingText text="" isRealStreaming={true}>
        {(displayedText) => <div data-testid="content">{displayedText}</div>}
      </StreamingText>
    );

    const content = container.querySelector('[data-testid="content"]');
    expect(content?.textContent).toBe('');
  });

  it('should show cursor for real streaming even with empty text', () => {
    const { container } = render(
      <StreamingText text="" isRealStreaming={true} isComplete={false}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeTruthy();
  });
});
