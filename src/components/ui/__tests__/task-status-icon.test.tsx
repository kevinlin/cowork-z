import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskStatusIcon } from '../task-status-icon';

/** The completion pop wraps the check icon in a motion span; a static check has no wrapper. */
function hasPopWrapper(container: HTMLElement): boolean {
  return container.querySelector('span > svg') !== null;
}

describe('TaskStatusIcon', () => {
  it('renders a static check for a task that mounts already completed', () => {
    const { container } = render(<TaskStatusIcon status="completed" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(hasPopWrapper(container)).toBe(false);
  });

  it('pops the check when a running task completes on screen', () => {
    const { container, rerender } = render(<TaskStatusIcon status="running" />);
    rerender(<TaskStatusIcon status="completed" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(hasPopWrapper(container)).toBe(true);
  });

  it('does not pop when completion is not a live transition from running', () => {
    const { container, rerender } = render(<TaskStatusIcon status="queued" />);
    rerender(<TaskStatusIcon status="completed" />);
    expect(hasPopWrapper(container)).toBe(false);
  });

  it('renders nothing for an unknown status', () => {
    const { container } = render(<TaskStatusIcon status="mystery" />);
    expect(container).toBeEmptyDOMElement();
  });
});
