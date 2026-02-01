import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Task } from '@/shared';
import ConversationListItem from './ConversationListItem';

const deleteTask = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (state: { deleteTask: typeof deleteTask }) => unknown) =>
    selector({ deleteTask }),
}));

describe('ConversationListItem', () => {
  it('confirms deletion before removing a task', async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: 'task_test_1',
      prompt: 'Test task',
      status: 'completed',
      messages: [],
      createdAt: new Date().toISOString(),
    };

    render(
      <MemoryRouter>
        <ConversationListItem task={task} />
      </MemoryRouter>
    );

    await user.click(screen.getByLabelText('Delete task'));

    expect(screen.getByText('Delete task')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith(task.id);
    });
  });
});
