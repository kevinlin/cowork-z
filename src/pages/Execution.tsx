'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatInput } from '@/components/chat/ChatInput';
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

// Debug log entry type
interface DebugLogEntry {
  taskId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
}

// Spinning icon component
const SpinningIcon = ({ className }: { className?: string }) => (
  <img alt="" className={cn('animate-spin-ccw', className)} src={loadingSymbol} />
);

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<unknown>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [debugExported, setDebugExported] = useState(false);
  const debugPanelRef = useRef<HTMLDivElement>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [pendingFollowUp, setPendingFollowUp] = useState<string | null>(null);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);

  // Scroll behavior state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledOnLoadRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Elapsed time for startup indicator
  const [elapsedTime, setElapsedTime] = useState(0);

  const {
    currentTask,
    loadTaskById,
    isLoading,
    error,
    addTaskUpdate,
    addTaskUpdateBatch,
    updateTaskStatus,
    enqueuePermissionRequest,
    permissionRequest,
    respondToPermission,
    sendFollowUp,
    interruptTask,
    startupStage,
    startupStageTaskId,
    partialMessages,
  } = useTaskStore();
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
      setDebugLogs([]);
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

    api
      .onTaskUpdate((event) => {
        addTaskUpdate(event);
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

    api
      .onDebugLog((log) => {
        const entry = log as DebugLogEntry;
        setDebugLogs((prev) => [...prev, entry]);
      })
      .then(track);

    return () => {
      cancelled = true;
      unlisteners.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadTaskById, addTaskUpdate, addTaskUpdateBatch, updateTaskStatus, enqueuePermissionRequest]);

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

  // Auto-scroll to bottom only if user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      const messagesEnd = document.querySelector('[data-testid="messages-scroll-container"] [data-messages-end]');
      messagesEnd?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentTask?.messages?.length, partialMessages.size, isAtBottom]);

  // Auto-scroll debug panel when new logs arrive
  useEffect(() => {
    if (debugPanelOpen && debugPanelRef.current) {
      debugPanelRef.current.scrollTop = debugPanelRef.current.scrollHeight;
    }
  }, [debugLogs.length, debugPanelOpen]);

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
    }
  };

  const handleExportDebugLogs = useCallback(async () => {
    const text = debugLogs
      .map((log) => {
        const dataStr = log.data === undefined ? '' : ` ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}`;
        return `${new Date(log.timestamp).toISOString()} [${log.type}] ${log.message}${dataStr}`;
      })
      .join('\n');

    const defaultFilename = `debug-logs-${id}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;

    try {
      const savedPath = await api.saveTextFile(text, {
        title: 'Export Debug Logs',
        defaultPath: defaultFilename,
        filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }],
      });
      if (savedPath) {
        setDebugExported(true);
        setTimeout(() => setDebugExported(false), 2000);
      }
    } catch (err) {
      console.error('Failed to export debug logs:', err);
    }
  }, [debugLogs, id]);

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
            partialMessages={partialMessages}
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

        {/* Debug Panel - Only visible when debug mode is enabled */}
        {debugModeEnabled && (
          <div className="flex-shrink-0 border-border border-t" data-testid="debug-panel">
            <button
              className="flex w-full items-center justify-between bg-zinc-900 px-6 py-2.5 transition-colors hover:bg-zinc-800"
              onClick={() => setDebugPanelOpen(!debugPanelOpen)}
            >
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Bug className="h-4 w-4" />
                <span className="font-medium">Debug Logs</span>
                {debugLogs.length > 0 && (
                  <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">{debugLogs.length}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {debugLogs.length > 0 && (
                  <>
                    <Button
                      className="h-6 px-2 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportDebugLogs();
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {debugExported ? <Check className="mr-1 h-3 w-3 text-green-400" /> : <Download className="mr-1 h-3 w-3" />}
                      {debugExported ? 'Exported' : 'Export'}
                    </Button>
                    <Button
                      className="h-6 px-2 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDebugLogs([]);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Clear
                    </Button>
                  </>
                )}
                {debugPanelOpen ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronUp className="h-4 w-4 text-zinc-500" />}
              </div>
            </button>

            <AnimatePresence>
              {debugPanelOpen && (
                <motion.div
                  animate={{ height: 200, opacity: 1 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="h-[200px] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs text-zinc-300" ref={debugPanelRef}>
                    {debugLogs.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-zinc-500">
                        No debug logs yet. Run a task to see logs.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {debugLogs.map((log, index) => (
                          <div className="flex gap-2" key={index}>
                            <span className="shrink-0 text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span
                              className={cn(
                                'shrink-0 rounded px-1',
                                log.type === 'error'
                                  ? 'bg-red-500/20 text-red-400'
                                  : log.type === 'warn'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : log.type === 'info'
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-zinc-700 text-zinc-400'
                              )}
                            >
                              [{log.type}]
                            </span>
                            <span className="break-all text-zinc-300">
                              {log.message}
                              {log.data !== undefined && (
                                <span className="ml-2 text-zinc-500">
                                  {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 0)}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}
