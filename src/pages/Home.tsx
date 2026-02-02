'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { hasAnyReadyProvider } from '@/shared';
// Import use case images for proper bundling in production
import calendarPrepNotesImg from '/assets/usecases/calendar-prep-notes.png';
import competitorPricingDeckImg from '/assets/usecases/competitor-pricing-deck.png';
import eventCalendarBuilderImg from '/assets/usecases/event-calendar-builder.png';
import inboxPromoCleanupImg from '/assets/usecases/inbox-promo-cleanup.png';
import jobApplicationAutomationImg from '/assets/usecases/job-application-automation.png';
import notionApiAuditImg from '/assets/usecases/notion-api-audit.png';
import prodBrokenLinksImg from '/assets/usecases/prod-broken-links.png';
import stagingVsProdVisualImg from '/assets/usecases/staging-vs-prod-visual.png';
import stockPortfolioAlertsImg from '/assets/usecases/stock-portfolio-alerts.png';
import TaskInputBar from '../components/landing/TaskInputBar';
import SettingsDialog from '../components/layout/SettingsDialog';
import { getAccomplish } from '../lib/accomplish';
import { springs, staggerContainer, staggerItem } from '../lib/animations';
import { useTaskStore } from '../stores/taskStore';

const USE_CASE_EXAMPLES = [
  {
    title: 'Calendar Prep Notes',
    description: "Review tomorrow's meetings and draft a prep notes doc.",
    prompt: "Check my Google Calendar for tomorrow's meetings and draft preparation notes in a new Google Doc.",
    image: calendarPrepNotesImg,
  },
  {
    title: 'Inbox Promo Cleanup',
    description: 'Clear promotional emails from the last 24 hours.',
    prompt: 'Go to my Gmail inbox and delete all promotional emails from the last 24 hours.',
    image: inboxPromoCleanupImg,
  },
  {
    title: 'Competitor Pricing Deck',
    description: 'Analyze competitor pricing and draft a slide with recommendations.',
    prompt:
      "Pull pricing and features from these 5 competitor sites [list URLs], save to a CSV, analyze our pricing gaps, and draft a recommendation slide in Google Slides for Monday's meeting.",
    image: competitorPricingDeckImg,
  },
  {
    title: 'Notion API Audit',
    description: 'Scan a Notion wiki for old API mentions with direct links.',
    prompt: 'Read through this Notion wiki at [URL] and find all mentions of the old API, listing them with page links.',
    image: notionApiAuditImg,
  },
  {
    title: 'Staging vs Prod Visual Check',
    description: 'Compare staging and production visuals with screenshots.',
    prompt: 'Compare my staging site at [URL] to production at [URL] and screenshot any visual differences.',
    image: stagingVsProdVisualImg,
  },
  {
    title: 'Production Broken Links',
    description: 'Check my website for broken links.',
    prompt: 'Open [URL], click through every link, and report any 404 errors.',
    image: prodBrokenLinksImg,
  },
  {
    title: 'Portfolio Monitoring',
    description: 'Watch stock prices, and alert on drops and spikes.',
    prompt: 'Monitor my stock portfolio on [broker site], alert on price drops and spikes.',
    image: stockPortfolioAlertsImg,
  },
  {
    title: 'Job Application Automation',
    description: 'Filter jobs and submit applications with saved profiles.',
    prompt: 'Find job listings from Indeed for [query], sort by salary, and apply to the top 5 using my profile.',
    image: jobApplicationAutomationImg,
  },
  {
    title: 'Event Calendar Builder',
    description: 'Select top events and add them to the calendar.',
    prompt: 'Scrape event listings from Eventbrite, filter by location, and add top 5 to my calendar.',
    image: eventCalendarBuilderImg,
  },
];

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [showExamples, setShowExamples] = useState(true);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const { startTask, isLoading, addTaskUpdate, setPermissionRequest } = useTaskStore();
  const navigate = useNavigate();
  const accomplish = getAccomplish();

  // Subscribe to task events
  useEffect(() => {
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });

    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, setPermissionRequest, accomplish]);

  const executeTask = useCallback(async () => {
    if (!prompt.trim() || isLoading) return;

    const taskId = `task_${Date.now()}`;
    const task = await startTask({ prompt: prompt.trim(), taskId });
    if (task) {
      navigate(`/execution/${task.id}`);
    }
  }, [prompt, isLoading, startTask, navigate]);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;

    // Check if any provider is ready before sending (skip in E2E mode)
    const isE2EMode = await accomplish.isE2EMode();
    if (!isE2EMode) {
      const settings = await accomplish.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setShowSettingsDialog(true);
        return;
      }
    }

    await executeTask();
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
  };

  const handleApiKeySaved = async () => {
    // API key was saved - close dialog and execute the task
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask();
    }
  };

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
  };

  return (
    <>
      <SettingsDialog onApiKeySaved={handleApiKeySaved} onOpenChange={handleSettingsDialogChange} open={showSettingsDialog} />
      <div className="flex h-full items-center justify-center overflow-y-auto bg-accent p-6">
        <div className="flex w-full max-w-2xl flex-col items-center gap-8">
          {/* Main Title */}
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="font-light text-4xl text-foreground tracking-tight"
            data-testid="home-title"
            initial={{ opacity: 0, y: -20 }}
            transition={springs.gentle}
          >
            What will you accomplish today?
          </motion.h1>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <Card className="flex max-h-[calc(100vh-3rem)] w-full flex-col gap-0 bg-card/95 py-0 shadow-xl backdrop-blur-md">
              <CardContent className="flex-shrink-0 p-6 pb-4">
                {/* Input Section */}
                <TaskInputBar
                  autoFocus={true}
                  isLoading={isLoading}
                  large={true}
                  onChange={setPrompt}
                  onSubmit={handleSubmit}
                  placeholder="Describe a task and let AI handle the rest"
                  value={prompt}
                />
              </CardContent>

              {/* Examples Toggle */}
              <div className="border-border border-t">
                <button
                  className="flex w-full items-center justify-between px-6 py-3 text-muted-foreground text-sm transition-colors duration-200 hover:bg-muted/50 hover:text-foreground"
                  onClick={() => setShowExamples(!showExamples)}
                >
                  <span>Example prompts</span>
                  <motion.div animate={{ rotate: showExamples ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="h-4 w-4" />
                  </motion.div>
                </button>

                <AnimatePresence>
                  {showExamples && (
                    <motion.div
                      animate={{ height: 'auto', opacity: 1 }}
                      className="overflow-hidden"
                      exit={{ height: 0, opacity: 0 }}
                      initial={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div
                        className="max-h-[360px] overflow-y-auto px-6 pt-1 pb-4"
                        style={{
                          background: 'linear-gradient(to bottom, hsl(var(--muted)) 0%, hsl(var(--background)) 100%)',
                          backgroundAttachment: 'fixed',
                        }}
                      >
                        <motion.div animate="animate" className="grid grid-cols-3 gap-3" initial="initial" variants={staggerContainer}>
                          {USE_CASE_EXAMPLES.map((example, index) => (
                            <motion.button
                              className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 hover:border-ring hover:bg-muted/50"
                              data-testid={`home-example-${index}`}
                              key={index}
                              onClick={() => handleExampleClick(example.prompt)}
                              transition={springs.gentle}
                              variants={staggerItem}
                              whileHover={{
                                scale: 1.03,
                                transition: { duration: 0.15 },
                              }}
                              whileTap={{ scale: 0.97 }}
                            >
                              <img alt={example.title} className="h-12 w-12 rounded object-cover" src={example.image} />
                              <div className="flex w-full flex-col items-center gap-1">
                                <div className="text-center font-medium text-foreground text-xs">{example.title}</div>
                                <div className="line-clamp-2 text-center text-muted-foreground text-xs">{example.description}</div>
                              </div>
                            </motion.button>
                          ))}
                        </motion.div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
