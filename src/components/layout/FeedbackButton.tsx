import { Bug, Lightbulb, MessageSquareHeart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { analytics } from '@/lib/analytics';
import { buildBugReportUrl, buildFeatureRequestUrl } from '@/lib/feedback';
import { openExternal } from '@/lib/tauri-api';

export default function FeedbackButton() {
  const handleReportBug = async () => {
    analytics.trackFeedbackBug();
    const url = await buildBugReportUrl();
    await openExternal(url);
  };

  const handleSuggestFeature = async () => {
    analytics.trackFeedbackFeature();
    const url = await buildFeatureRequestUrl();
    await openExternal(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="sidebar-feedback-button" size="icon" title="Feedback" variant="ghost">
          <MessageSquareHeart className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        <DropdownMenuItem onClick={handleReportBug}>
          <Bug className="mr-2 h-4 w-4" />
          Report Bug
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSuggestFeature}>
          <Lightbulb className="mr-2 h-4 w-4" />
          Suggest Feature
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
