import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
const mockBuildBugReportUrl = vi.fn();
const mockBuildFeatureRequestUrl = vi.fn();

vi.mock('@/lib/tauri-api', () => ({
  openExternal: (...args: unknown[]) => mockOpenExternal(...args),
}));

vi.mock('@/lib/feedback', () => ({
  buildBugReportUrl: (...args: unknown[]) => mockBuildBugReportUrl(...args),
  buildFeatureRequestUrl: (...args: unknown[]) => mockBuildFeatureRequestUrl(...args),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: {
    trackFeedbackBug: vi.fn(),
    trackFeedbackFeature: vi.fn(),
  },
}));

import FeedbackButton from './FeedbackButton';

describe('FeedbackButton', () => {
  it('renders with correct test ID', () => {
    render(<FeedbackButton />);
    expect(screen.getByTestId('sidebar-feedback-button')).toBeInTheDocument();
  });

  it('opens dropdown with both options on click', async () => {
    const user = userEvent.setup();
    render(<FeedbackButton />);

    await user.click(screen.getByTestId('sidebar-feedback-button'));

    expect(screen.getByText('Report Bug')).toBeInTheDocument();
    expect(screen.getByText('Suggest Feature')).toBeInTheDocument();
  });

  it('calls buildBugReportUrl and openExternal for Report Bug', async () => {
    const user = userEvent.setup();
    const bugUrl = 'https://github.com/kevinlin/cowork-z/issues/new?labels=bug&title=test';
    mockBuildBugReportUrl.mockResolvedValue(bugUrl);

    render(<FeedbackButton />);

    await user.click(screen.getByTestId('sidebar-feedback-button'));
    await user.click(screen.getByText('Report Bug'));

    await waitFor(() => {
      expect(mockBuildBugReportUrl).toHaveBeenCalled();
      expect(mockOpenExternal).toHaveBeenCalledWith(bugUrl);
    });
  });

  it('calls buildFeatureRequestUrl and openExternal for Suggest Feature', async () => {
    const user = userEvent.setup();
    const featureUrl = 'https://github.com/kevinlin/cowork-z/issues/new?labels=enhancement&title=test';
    mockBuildFeatureRequestUrl.mockResolvedValue(featureUrl);

    render(<FeedbackButton />);

    await user.click(screen.getByTestId('sidebar-feedback-button'));
    await user.click(screen.getByText('Suggest Feature'));

    await waitFor(() => {
      expect(mockBuildFeatureRequestUrl).toHaveBeenCalled();
      expect(mockOpenExternal).toHaveBeenCalledWith(featureUrl);
    });
  });
});
