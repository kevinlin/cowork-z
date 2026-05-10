import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionRequest } from '@/shared';
import { QuestionDialog } from '../QuestionDialog';

const buildRequest = (overrides: Partial<QuestionRequest['questions'][number]> = {}): QuestionRequest => ({
  taskId: 'task_test',
  requestId: 'que_test',
  sessionId: 'ses_test',
  questions: [
    {
      question: 'Pick a colour',
      header: 'Colour',
      options: [{ label: 'Red' }, { label: 'Blue' }],
      ...overrides,
    },
  ],
});

describe('QuestionDialog — always-on Others fallback', () => {
  it('renders a synthetic Others option when none of the agent options is an Other variant', () => {
    render(<QuestionDialog onCancel={vi.fn()} onSubmit={vi.fn()} request={buildRequest()} />);

    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.getByText('Others')).toBeInTheDocument();
    expect(screen.getByText('Type your own response')).toBeInTheDocument();
  });

  it('does not duplicate when the agent already provides an Other option (case-insensitive)', () => {
    const request = buildRequest({
      options: [{ label: 'Red' }, { label: 'OTHER' }],
    });

    render(<QuestionDialog onCancel={vi.fn()} onSubmit={vi.fn()} request={request} />);

    expect(screen.getAllByText(/^OTHER$/i)).toHaveLength(1);
    expect(screen.queryByText('Others')).not.toBeInTheDocument();
  });

  it('single-select: clicking Others swaps to the free-text input and submits as customText only', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<QuestionDialog onCancel={vi.fn()} onSubmit={onSubmit} request={buildRequest()} />);

    await user.click(screen.getByRole('button', { name: /Others/ }));

    const input = screen.getByPlaceholderText('Type your response...');
    await user.type(input, 'lime green');

    await user.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onSubmit).toHaveBeenCalledWith([{ labels: [], customText: 'lime green' }]);
  });

  it('multi-select: Others coexists with checkbox selections and forwards customText alongside labels', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    const request = buildRequest({ multiSelect: true });

    render(<QuestionDialog onCancel={vi.fn()} onSubmit={onSubmit} request={request} />);

    await user.click(screen.getByRole('button', { name: /Red/ }));
    await user.click(screen.getByRole('button', { name: /Others/ }));

    const input = screen.getByPlaceholderText('Type your response...');
    await user.type(input, 'magenta');

    await user.click(screen.getByRole('button', { name: /Submit/ }));

    expect(onSubmit).toHaveBeenCalledWith([{ labels: ['Red'], customText: 'magenta' }]);
  });

  it('multi-select: Others alone with empty input keeps Submit disabled', async () => {
    const user = userEvent.setup();
    const request = buildRequest({ multiSelect: true });

    render(<QuestionDialog onCancel={vi.fn()} onSubmit={vi.fn()} request={request} />);

    await user.click(screen.getByRole('button', { name: /Others/ }));

    const submit = screen.getByRole('button', { name: /Submit/ });
    expect(submit).toBeDisabled();
  });

  it('falls through to the free-text-only path when the agent provides no options', () => {
    const request: QuestionRequest = {
      taskId: 'task_test',
      requestId: 'que_test',
      sessionId: 'ses_test',
      questions: [{ question: 'Anything to add?' }],
    };

    render(<QuestionDialog onCancel={vi.fn()} onSubmit={vi.fn()} request={request} />);

    expect(screen.queryByText('Others')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type your response...')).toBeInTheDocument();
  });
});
