'use client';

import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput } from '@/components/chat/ChatInput';
import { DebugLogPanel } from '@/components/chat/DebugLogPanel';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageList } from '@/components/chat/MessageList';
import { PermissionModal } from '@/components/chat/PermissionModal';
import { QuestionDialog } from '@/components/chat/QuestionDialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { QuestionRequest } from '@/shared';
import { hasAnyReadyProvider } from '@/shared';
import loadingSymbol from '/assets/loading-symbol.svg';
import SettingsDialog from '../components/layout/SettingsDialog';
import { springs } from '../lib/animations';
import * as api from '../lib/tauri-api';
import { useTaskStore } from '../stores/taskStore';

// Spinning icon component
const SpinningIcon = ({ className }: { className?: string }) => (
  <img alt="" className={cn('animate-spin-ccw', className)} src={loadingSymbol} />
);

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<unknown>(null);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [pendingFollowUp, setPendingFollowUp] = useState<string | null>(null);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);

  // Scroll behavior state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledOnLoadRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Elapsed time for startup indicator
  const [elapsedTime, setElapsedTime] = useState(0);

  // Granular subscription (2026-06-12 review #12): deliberately excludes
  // partialMessages — that Map is replaced on every streaming delta and is
  // consumed by MessageList directly, so the page shell (header, input,
  // modals) doesn't re-render at streaming frequency.
  const {
    currentTask,
    loadTaskById,
    isLoading,
    error,
    addTaskUpdateBatch,
    updateTaskStatus,
    enqueuePermissionRequest,
    permissionRequest,
    respondToPermission,
    sendFollowUp,
    interruptTask,
    startupStage,
    startupStageTaskId,
  } = useTaskStore(
    useShallow((state) => ({
      currentTask: state.currentTask,
      loadTaskById: state.loadTaskById,
      isLoading: state.isLoading,
      error: state.error,
      addTaskUpdateBatch: state.addTaskUpdateBatch,
      updateTaskStatus: state.updateTaskStatus,
      enqueuePermissionRequest: state.enqueuePermissionRequest,
      permissionRequest: state.permissionRequest,
      respondToPermission: state.respondToPermission,
      sendFollowUp: state.sendFollowUp,
      interruptTask: state.interruptTask,
      startupStage: state.startupStage,
      startupStageTaskId: state.startupStageTaskId,
    }))
  );
  const taskStatus = currentTask?.status as string | undefined;
  const isTaskRunning = taskStatus === 'running' || taskStatus === 'starting';

  // Handle scroll events to track if user is at bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 150;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
    setIsAtBottom(atBottom);
  }, []);

  // Re-enable autoscroll and snap to bottom immediately (e.g. after sending a follow-up)
  const scrollToBottomNow = useCallback(() => {
    setIsAtBottom(true);
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, []);

  // Load debug mode setting on mount and subscribe to changes
  useEffect(() => {
    api.getDebugMode().then(setDebugModeEnabled).catch(console.error);

    let unsubscribeDebugMode: (() => void) | undefined;
    api
      .onDebugModeChange(({ enabled }) => {
        setDebugModeEnabled(enabled);
      })
      .then((unsub) => {
        unsubscribeDebugMode = unsub;
      });

    return () => {
      unsubscribeDebugMode?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed time timer for startup indicator
  useEffect(() => {
    const isShowingStartupStage = startupStageTaskId === id && startupStage && !currentTool;

    if (!isShowingStartupStage) {
      setElapsedTime(0);
      return;
    }

    const calculateElapsed = () => Math.floor((Date.now() - startupStage.startTime) / 1000);
    setElapsedTime(calculateElapsed());

    const interval = setInterval(() => {
      setElapsedTime(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [startupStageTaskId, startupStage, id, currentTool]);

  // Load task and subscribe to events
  useEffect(() => {
    if (id) {
      hasScrolledOnLoadRef.current = null;
      loadTaskById(id);
    }

    // Use a cancelled flag to handle the race between cleanup and async
    // listener registration. When React Strict Mode double-mounts, cleanup
    // runs synchronously before the async .then() resolves, leaving dangling
    // listeners. With this flag, stale listeners are immediately unsubscribed
    // when their promise resolves after cleanup has already run.
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const track = (unsub: () => void) => {
      if (cancelled) {
        unsub();
      } else {
        unlisteners.push(unsub);
      }
    };

    // Tool-activity tracking only. Store updates and persistence are handled
    // by the single global onTaskUpdate subscription in taskStore — calling
    // addTaskUpdate here would double-process complete/error events
    // (technical review #20).
    api
      .onTaskUpdate((event) => {
        if (event.type === 'message' && event.message?.type === 'tool') {
          const toolName = event.message.toolName || event.message.content?.match(/Using tool: (\w+)/)?.[1];
          if (toolName) {
            setCurrentTool(toolName);
            setCurrentToolInput(event.message.toolInput);
          }
        }
        if (event.type === 'complete' || event.type === 'error') {
          setCurrentTool(null);
          setCurrentToolInput(null);
        }
      })
      .then(track);

    api
      .onTaskUpdateBatch((event) => {
        if (event.messages?.length) {
          addTaskUpdateBatch(event);
          const lastToolMsg = [...event.messages].reverse().find((m) => m.type === 'tool');
          if (lastToolMsg) {
            const toolName = lastToolMsg.toolName || lastToolMsg.content?.match(/Using tool: (\w+)/)?.[1];
            if (toolName) {
              setCurrentTool(toolName);
              setCurrentToolInput(lastToolMsg.toolInput);
            }
          }
        }
      })
      .then(track);

    api
      .onPermissionRequest((request) => {
        enqueuePermissionRequest(request);
      })
      .then(track);

    // Subscribe to question requests
    api
      .onQuestionRequest((request) => {
        setQuestionRequest(request);
      })
      .then(track);

    api
      .onTaskStatusChange((data) => {
        if (data.taskId === id) {
          updateTaskStatus(data.taskId, data.status);
        }
      })
      .then(track);

    return () => {
      cancelled = true;
      unlisteners.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadTaskById, addTaskUpdateBatch, updateTaskStatus, enqueuePermissionRequest]);

  // On session resume/load, jump to the latest conversation once.
  useEffect(() => {
    if (!currentTask || currentTask.messages.length === 0) return;
    if (hasScrolledOnLoadRef.current === currentTask.id) return;

    hasScrolledOnLoadRef.current = currentTask.id;
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
      setIsAtBottom(true);
    });
  }, [currentTask]);

  // Fetch todos when session becomes available
  useEffect(() => {
    const sessionId = currentTask?.sessionId || currentTask?.result?.sessionId;
    if (id && sessionId) {
      api.getSessionTodos(id, sessionId).catch(console.error);
    }
  }, [id, currentTask?.sessionId, currentTask?.result?.sessionId]);

  // Auto-scroll during streaming lives in MessageList, which owns the
  // partialMessages subscription (2026-06-12 review #12).

  // Computed state
  const isComplete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask?.status ?? '');
  const hasSession = !!(currentTask?.sessionId || currentTask?.result?.sessionId);
  const canFollowUp = isComplete && (hasSession || currentTask?.status === 'interrupted');

  // Auto-focus follow-up input when task completes
  useEffect(() => {
    if (canFollowUp) {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="execution-follow-up-input"]');
      input?.focus();
    }
  }, [canFollowUp]);

  const handleFollowUp = async (message: string) => {
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setPendingFollowUp(message);
        setShowSettingsDialog(true);
        return;
      }
    }
    await sendFollowUp(message);
    scrollToBottomNow();
  };

  const handleContinue = async () => {
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setPendingFollowUp('continue');
        setShowSettingsDialog(true);
        return;
      }
    }
    await sendFollowUp('continue');
    scrollToBottomNow();
  };

  // Chat-scoped keyboard shortcuts
  const handleFollowUpRef = useRef(handleFollowUp);
  handleFollowUpRef.current = handleFollowUp;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTaskRunning && !permissionRequest && !questionRequest) {
        e.preventDefault();
        interruptTask();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTaskRunning, interruptTask, permissionRequest, questionRequest]);

  const handleSettingsDialogClose = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setPendingFollowUp(null);
    }
  };

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (pendingFollowUp) {
      await sendFollowUp(pendingFollowUp);
      setPendingFollowUp(null);
      scrollToBottomNow();
    }
  };

  const handlePermissionResponse = async (allowed: boolean, selectedOptions?: string[], customText?: string) => {
    if (!(permissionRequest && currentTask)) return;

    const isQuestion = permissionRequest.type === 'question';

    await respondToPermission({
      requestId: permissionRequest.id,
      taskId: permissionRequest.taskId,
      decision: allowed ? 'allow' : 'deny',
      selectedOptions: isQuestion ? selectedOptions : undefined,
      customText,
    });

    if (!allowed && isQuestion) {
      interruptTask();
    }
  };

  const handleQuestionSubmit = async (answers: Array<{ labels: string[]; customText?: string }>) => {
    if (!(questionRequest && currentTask)) return;
    await api.replyToQuestion(questionRequest.taskId, questionRequest.requestId, answers);
    setQuestionRequest(null);
  };

  const handleQuestionCancel = async () => {
    setQuestionRequest(null);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md p-6 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <p className="mb-4 text-destructive">{error}</p>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </Card>
      </div>
    );
  }

  if (!currentTask) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinningIcon className="h-8 w-8" />
      </div>
    );
  }

  const getStatusBadge = () => {
    switch (currentTask.status) {
      case 'queued':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600 text-xs">
            <Clock className="h-3 w-3" />
            Queued
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-xs">
            <span className="animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-primary via-primary/50 to-primary bg-clip-text text-transparent">
              Running
            </span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 font-medium text-green-600 text-xs">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 font-medium text-destructive text-xs">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground text-xs">
            <XCircle className="h-3 w-3" />
            Cancelled
          </span>
        );
      case 'interrupted':
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600 text-xs">
            <Square className="h-3 w-3" />
            Stopped
          </span>
        );
      default:
        return (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground text-xs">
            {currentTask.status}
          </span>
        );
    }
  };

  const sessionId = currentTask.sessionId || currentTask.result?.sessionId;

  return (
    <>
      {/* Settings Dialog - shown when no provider is ready */}
      <SettingsDialog onApiKeySaved={handleApiKeySaved} onOpenChange={handleSettingsDialogClose} open={showSettingsDialog} />

      <div className="relative flex h-full flex-col bg-background">
        {/* Task header */}
        <div className="flex-shrink-0 border-border border-b bg-card/50 px-6 py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Button className="no-drag shrink-0" onClick={() => navigate('/')} size="icon" variant="ghost">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <h1 className="min-w-0 truncate font-medium text-base text-foreground">{currentTask.prompt}</h1>
                <span data-testid="execution-status-badge">{getStatusBadge()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Queued state - full page (new task, no messages yet) */}
        {currentTask.status === 'queued' && currentTask.messages.length === 0 && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-1 flex-col items-center justify-center gap-6 px-6"
            initial={{ opacity: 0, y: 8 }}
            transition={springs.gentle}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <div className="max-w-md text-center">
              <h2 className="mb-2 font-semibold text-foreground text-xl">Waiting for another task</h2>
              <p className="text-muted-foreground">Your task is queued and will start automatically when the current task completes.</p>
            </div>
          </motion.div>
        )}

        {/* Queued state - inline (follow-up, has previous messages) */}
        {currentTask.status === 'queued' && currentTask.messages.length > 0 && (
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-4xl space-y-4">
              {currentTask.messages
                .filter((m) => !(m.type === 'tool' && m.toolName?.toLowerCase() === 'bash'))
                .map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}

              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-4 py-8"
                initial={{ opacity: 0, y: 8 }}
                transition={springs.gentle}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
                  <Clock className="h-6 w-6 text-amber-600" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground text-sm">Waiting for another task</p>
                  <p className="mt-1 text-muted-foreground text-xs">Your follow-up will continue automatically</p>
                </div>
              </motion.div>
            </div>
          </div>
        )}

        {/* Messages - normal state (running, completed, failed, etc.) */}
        {currentTask.status !== 'queued' && (
          <MessageList
            currentTool={currentTool}
            currentToolInput={currentToolInput}
            elapsedTime={elapsedTime}
            hasPermissionRequest={!!permissionRequest}
            isAtBottom={isAtBottom}
            isLoading={isLoading}
            isTaskRunning={isTaskRunning}
            messages={currentTask.messages}
            onContinue={handleContinue}
            onScroll={handleScroll}
            scrollContainerRef={scrollContainerRef}
            sessionId={sessionId}
            startupStage={startupStage}
            startupStageTaskId={startupStageTaskId}
            taskId={id}
            taskStatus={taskStatus}
          />
        )}

        {/* Permission Request Modal */}
        {permissionRequest && <PermissionModal onRespond={handlePermissionResponse} request={permissionRequest} />}

        {/* Question Request Dialog */}
        {questionRequest && <QuestionDialog onCancel={handleQuestionCancel} onSubmit={handleQuestionSubmit} request={questionRequest} />}

        {/* Chat Input (running state, follow-up, or completed) */}
        <ChatInput
          canFollowUp={canFollowUp}
          hasPermissionRequest={!!permissionRequest}
          hasSession={hasSession}
          isComplete={isComplete}
          isLoading={isLoading}
          isRunning={isTaskRunning}
          onSend={handleFollowUp}
          onStop={interruptTask}
          taskStatus={taskStatus}
        />

        {/* Debug Panel - Only mounted (and subscribed to sidecar logs) when debug mode is enabled */}
        {debugModeEnabled && <DebugLogPanel taskId={id} />}
      </div>
    </>
  );
}
