'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CornerDownLeft,
  Download,
  File,
  FileText,
  Play,
  Search,
  Square,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from '@/components/markdown/EnhancedLink';
import { MediaGallery } from '@/components/media/MediaGallery';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DragDropTextarea } from '@/components/ui/drag-drop-input';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { enrichContentWithLinks, extractMediaPaths } from '@/lib/content-enrichment';
import { extractUserFacingContent } from '@/lib/message-utils';
import { cn } from '@/lib/utils';
import type { PartialMessage, TaskMessage } from '@/shared';
import { hasAnyReadyProvider } from '@/shared';
import loadingSymbol from '/assets/loading-symbol.svg';
import SettingsDialog from '../components/layout/SettingsDialog';
import { StreamingText } from '../components/ui/streaming-text';
import { springs } from '../lib/animations';
import * as api from '../lib/tauri-api';
import { isWaitingForUser } from '../lib/waiting-detection';
import { useTaskStore } from '../stores/taskStore';

// Debug log entry type
interface DebugLogEntry {
  taskId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
}

// Spinning Openwork icon component
const SpinningIcon = ({ className }: { className?: string }) => (
  <img alt="" className={cn('animate-spin-ccw', className)} src={loadingSymbol} />
);

// Tool name to human-readable progress mapping
const TOOL_PROGRESS_MAP: Record<string, { label: string; icon: typeof FileText }> = {
  // Standard Claude Code tools
  Read: { label: 'Reading files', icon: FileText },
  Glob: { label: 'Finding files', icon: Search },
  Grep: { label: 'Searching code', icon: Search },
  Bash: { label: 'Running command', icon: Terminal },
  Write: { label: 'Writing file', icon: FileText },
  Edit: { label: 'Editing file', icon: FileText },
  Task: { label: 'Running agent', icon: Brain },
  WebFetch: { label: 'Fetching web page', icon: Search },
  WebSearch: { label: 'Searching web', icon: Search },
  // Dev Browser tools
  dev_browser_execute: { label: 'Executing browser action', icon: Terminal },
};

// Debounce utility
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
}

// Helper for file operation badge colors
function getOperationBadgeClasses(operation?: string): string {
  switch (operation) {
    case 'delete':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'overwrite':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'modify':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
    case 'create':
      return 'bg-green-500/10 text-green-600 dark:text-green-400';
    case 'rename':
    case 'move':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
  }
}

// Helper to check if this is a delete operation
function isDeleteOperation(request: { type: string; fileOperation?: string }): boolean {
  return request.type === 'file' && request.fileOperation === 'delete';
}

// Get file paths to display (handles both single and multiple)
function getDisplayFilePaths(request: { filePath?: string; filePaths?: string[] }): string[] {
  if (request.filePaths && request.filePaths.length > 0) {
    return request.filePaths;
  }
  if (request.filePath) {
    return [request.filePath];
  }
  return [];
}

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState('');
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);
  const [, setTaskRunCount] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<unknown>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [debugExported, setDebugExported] = useState(false);
  const debugPanelRef = useRef<HTMLDivElement>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customResponse, setCustomResponse] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [pendingFollowUp, setPendingFollowUp] = useState<string | null>(null);

  // Scroll behavior state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
    setPermissionRequest,
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

  // Debounced scroll function
  const scrollToBottom = useMemo(
    () =>
      debounce(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100),
    []
  );

  // Handle scroll events to track if user is at bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 150; // pixels from bottom to consider "at bottom" - larger value means button only appears after scrolling up more
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
    setIsAtBottom(atBottom);
  }, []);

  // Load debug mode setting on mount and subscribe to changes
  useEffect(() => {
    api.getDebugMode().then(setDebugModeEnabled).catch(console.error);

    // Subscribe to debug mode changes from settings
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
  }, []); // Empty deps - api is a stable module

  // Elapsed time timer for startup indicator
  useEffect(() => {
    // Only run timer when there's a startup stage for this task and no tool is active
    const isShowingStartupStage = startupStageTaskId === id && startupStage && !currentTool;

    if (!isShowingStartupStage) {
      setElapsedTime(0);
      return;
    }

    // Calculate initial elapsed time from startTime
    const calculateElapsed = () => Math.floor((Date.now() - startupStage.startTime) / 1000);
    setElapsedTime(calculateElapsed());

    // Update every second
    const interval = setInterval(() => {
      setElapsedTime(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [startupStageTaskId, startupStage, id, currentTool]);

  // Load task and subscribe to events
  useEffect(() => {
    if (id) {
      loadTaskById(id);
      // Clear debug logs when switching tasks
      setDebugLogs([]);
    }

    // Track unlisten functions
    const unlisteners: (() => void)[] = [];

    // Handle individual task updates
    api
      .onTaskUpdate((event) => {
        addTaskUpdate(event);
        // Track current tool from tool messages
        if (event.type === 'message' && event.message?.type === 'tool') {
          const toolName = event.message.toolName || event.message.content?.match(/Using tool: (\w+)/)?.[1];
          if (toolName) {
            setCurrentTool(toolName);
            setCurrentToolInput(event.message.toolInput);
          }
        }
        // Clear tool on completion
        if (event.type === 'complete' || event.type === 'error') {
          setCurrentTool(null);
          setCurrentToolInput(null);
        }
      })
      .then((unsub) => unlisteners.push(unsub));

    // Handle batched task updates (for performance)
    api
      .onTaskUpdateBatch((event) => {
        if (event.messages?.length) {
          addTaskUpdateBatch(event);
          // Track current tool from the last tool message
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
      .then((unsub) => unlisteners.push(unsub));

    api
      .onPermissionRequest((request) => {
        setPermissionRequest(request);
      })
      .then((unsub) => unlisteners.push(unsub));

    // Subscribe to task status changes (e.g., queued -> running)
    api
      .onTaskStatusChange((data) => {
        if (data.taskId === id) {
          updateTaskStatus(data.taskId, data.status);
        }
      })
      .then((unsub) => unlisteners.push(unsub));

    // Subscribe to debug logs
    // Sidecar logs may not always have a taskId, so accept all logs
    // (they are already scoped to the sidecar process for this app instance)
    api
      .onDebugLog((log) => {
        const entry = log as DebugLogEntry;
        setDebugLogs((prev) => [...prev, entry]);
      })
      .then((unsub) => unlisteners.push(unsub));

    return () => {
      unlisteners.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadTaskById, addTaskUpdate, addTaskUpdateBatch, updateTaskStatus, setPermissionRequest]); // api is a stable module

  // Fetch todos when session becomes available
  useEffect(() => {
    const sessionId = currentTask?.sessionId || currentTask?.result?.sessionId;
    if (id && sessionId) {
      api.getSessionTodos(id, sessionId).catch(console.error);
    }
  }, [id, currentTask?.sessionId, currentTask?.result?.sessionId]);

  // Increment counter when task starts/resumes
  useEffect(() => {
    if (currentTask?.status === 'running') {
      setTaskRunCount((c) => c + 1);
    }
  }, [currentTask?.status]);

  // Auto-scroll to bottom only if user is at bottom (debounced for performance)
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [currentTask?.messages?.length, partialMessages.size, scrollToBottom, isAtBottom]);

  // Combine completed messages with partial messages for rendering
  type RenderableMessage = TaskMessage | PartialMessage;
  const messagesToRender = useMemo((): RenderableMessage[] => {
    const completed = currentTask?.messages || [];
    const partials = Array.from(partialMessages.values());

    // Filter out completed messages that have a corresponding partial (avoid duplicates)
    const partialIds = new Set(partials.map((p) => p.id));
    const filteredCompleted = completed.filter((m) => !partialIds.has(m.id));

    // Combine and sort by timestamp
    const combined = [...filteredCompleted, ...partials];
    return combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [currentTask?.messages, partialMessages]);

  // Auto-scroll debug panel when new logs arrive
  useEffect(() => {
    if (debugPanelOpen && debugPanelRef.current) {
      debugPanelRef.current.scrollTop = debugPanelRef.current.scrollHeight;
    }
  }, [debugLogs.length, debugPanelOpen]);

  // Auto-focus follow-up input when task completes
  const isComplete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask?.status ?? '');
  const hasSession = currentTask?.sessionId || currentTask?.result?.sessionId;
  const canFollowUp = isComplete && (hasSession || currentTask?.status === 'interrupted');

  useEffect(() => {
    if (canFollowUp) {
      followUpInputRef.current?.focus();
    }
  }, [canFollowUp]);

  const handleFollowUp = async () => {
    if (!followUp.trim()) return;

    // Check if any provider is ready before sending (skip in E2E mode)
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        // Store the pending message and open settings dialog
        setPendingFollowUp(followUp);
        setShowSettingsDialog(true);
        return;
      }
    }

    await sendFollowUp(followUp);
    setFollowUp('');
  };

  // Chat-scoped keyboard shortcuts: Escape (cancel task), Cmd+Enter (send follow-up)
  // Use a ref so the effect doesn't need to re-subscribe when handleFollowUp changes.
  const handleFollowUpRef = useRef(handleFollowUp);
  handleFollowUpRef.current = handleFollowUp;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape — cancel running task (only when no permission dialog is showing)
      if (e.key === 'Escape' && isTaskRunning && !permissionRequest) {
        e.preventDefault();
        interruptTask();
        return;
      }

      // Cmd+Enter / Ctrl+Enter — send follow-up message
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canFollowUp) {
        e.preventDefault();
        handleFollowUpRef.current();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTaskRunning, interruptTask, canFollowUp, permissionRequest]);

  const handleSettingsDialogClose = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setPendingFollowUp(null);
    }
  };

  const handleApiKeySaved = async () => {
    // Provider is now ready - close dialog and send the pending message
    setShowSettingsDialog(false);
    if (pendingFollowUp) {
      await sendFollowUp(pendingFollowUp);
      setFollowUp('');
      setPendingFollowUp(null);
    }
  };

  const handleContinue = async () => {
    // Check if any provider is ready before sending (skip in E2E mode)
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        // Store the pending message and open settings dialog
        setPendingFollowUp('continue');
        setShowSettingsDialog(true);
        return;
      }
    }

    // Send a simple "continue" message to resume the task
    await sendFollowUp('continue');
  };

  const handleExportDebugLogs = useCallback(async () => {
    const text = debugLogs
      .map((log) => {
        const dataStr = log.data !== undefined ? ` ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}` : '';
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

  const handlePermissionResponse = async (allowed: boolean) => {
    if (!(permissionRequest && currentTask)) return;

    // For questions, handle custom text response
    const isQuestion = permissionRequest.type === 'question';
    const hasCustomText = isQuestion && showCustomInput && customResponse.trim();

    await respondToPermission({
      requestId: permissionRequest.id,
      taskId: permissionRequest.taskId,
      decision: allowed ? 'allow' : 'deny',
      selectedOptions: isQuestion ? (hasCustomText ? [] : selectedOptions) : undefined,
      customText: hasCustomText ? customResponse.trim() : undefined,
    });

    // Reset state for next question
    setSelectedOptions([]);
    setCustomResponse('');
    setShowCustomInput(false);

    // If denied on a question, also interrupt the task
    if (!allowed && isQuestion) {
      interruptTask();
    }
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

              {/* Inline waiting indicator */}
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

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Messages - normal state (running, completed, failed, etc.) */}
        {currentTask.status !== 'queued' && (
          <div
            className="flex-1 overflow-y-auto px-6 py-6"
            data-testid="messages-scroll-container"
            onScroll={handleScroll}
            ref={scrollContainerRef}
          >
            <div className="mx-auto max-w-4xl space-y-4">
              {messagesToRender
                .filter((m) => !(m.type === 'tool' && 'toolName' in m && (m as TaskMessage).toolName?.toLowerCase() === 'bash'))
                .map((message, index, filteredMessages) => {
                  const isLastMessage = index === filteredMessages.length - 1;
                  const isPartial = 'isStreaming' in message && message.isStreaming;
                  const isLastAssistantMessage = message.type === 'assistant' && isLastMessage;
                  // Find the last assistant message index for the continue button
                  let lastAssistantIndex = -1;
                  for (let i = filteredMessages.length - 1; i >= 0; i--) {
                    if (filteredMessages[i].type === 'assistant') {
                      lastAssistantIndex = i;
                      break;
                    }
                  }
                  const isLastAssistantForContinue = index === lastAssistantIndex;
                  // Get message content (handle both complete and partial messages)
                  const messageContent = isPartial ? (message as PartialMessage).textSoFar : (message as TaskMessage).content;
                  // Show continue button on last assistant message when:
                  // - Task was interrupted (user can always continue)
                  // - Task completed AND the message indicates agent is waiting for user action
                  const showContinue =
                    isLastAssistantForContinue &&
                    !!hasSession &&
                    !isPartial &&
                    (currentTask.status === 'interrupted' || (currentTask.status === 'completed' && isWaitingForUser(messageContent)));
                  // For partial messages, use real streaming mode (no animation)
                  // For complete messages during running, use animated streaming
                  const shouldStream = isLastAssistantMessage && isTaskRunning && !isPartial;
                  return (
                    <MessageBubble
                      continueLabel={currentTask.status === 'interrupted' ? 'Continue' : 'Done, Continue'}
                      isLastMessage={isLastMessage}
                      isLoading={isLoading}
                      isRealStreaming={isPartial}
                      isRunning={isTaskRunning}
                      key={message.id}
                      message={
                        isPartial
                          ? {
                              ...message,
                              content: messageContent,
                              type: 'assistant' as const,
                            }
                          : (message as TaskMessage)
                      }
                      onContinue={handleContinue}
                      shouldStream={shouldStream}
                      showContinueButton={showContinue}
                    />
                  );
                })}

              <AnimatePresence>
                {isTaskRunning && !permissionRequest && (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-1 py-2 text-muted-foreground"
                    data-testid="execution-thinking-indicator"
                    exit={{ opacity: 0, y: -8 }}
                    initial={{ opacity: 0, y: 8 }}
                    transition={springs.gentle}
                  >
                    <div className="flex items-center gap-2">
                      <SpinningIcon className="h-4 w-4" />
                      <span className="text-sm">
                        {currentTool
                          ? (currentToolInput as { description?: string })?.description ||
                            TOOL_PROGRESS_MAP[currentTool]?.label ||
                            currentTool
                          : startupStageTaskId === id && startupStage
                            ? startupStage.message
                            : 'Thinking...'}
                      </span>
                      {currentTool && !(currentToolInput as { description?: string })?.description && (
                        <span className="text-muted-foreground/60 text-xs">({currentTool})</span>
                      )}
                      {/* Elapsed time - only show during startup stages */}
                      {!currentTool && startupStageTaskId === id && startupStage && (
                        <span className="text-muted-foreground/60 text-xs">({elapsedTime}s)</span>
                      )}
                    </div>
                    {/* Cold start hint */}
                    {!currentTool && startupStageTaskId === id && startupStage?.isFirstTask && startupStage.stage === 'browser' && (
                      <span className="ml-6 text-muted-foreground/50 text-xs">First task takes a bit longer...</span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />

              {/* Sticky scroll-to-bottom button - stays at bottom of viewport when scrolled up */}
              <AnimatePresence>
                {!isAtBottom && (
                  <motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    className="pointer-events-none sticky bottom-4 flex justify-center"
                    exit={{ opacity: 0, scale: 0.8 }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    transition={springs.gentle}
                  >
                    <button
                      aria-label="Scroll to bottom"
                      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted shadow-md transition-colors hover:bg-muted/80"
                      data-testid="scroll-to-bottom-button"
                      onClick={scrollToBottom}
                    >
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Permission Request Modal */}
        <AnimatePresence>
          {permissionRequest && (
            <motion.div
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
              data-testid="execution-permission-modal"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
            >
              <motion.div
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={springs.bouncy}
              >
                <Card className="mx-4 w-full max-w-lg p-6">
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                        isDeleteOperation(permissionRequest)
                          ? 'bg-red-500/10'
                          : permissionRequest.type === 'file'
                            ? 'bg-amber-500/10'
                            : permissionRequest.type === 'question'
                              ? 'bg-primary/10'
                              : 'bg-warning/10'
                      )}
                    >
                      {isDeleteOperation(permissionRequest) ? (
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                      ) : permissionRequest.type === 'file' ? (
                        <File className="h-5 w-5 text-amber-600" />
                      ) : permissionRequest.type === 'question' ? (
                        <Brain className="h-5 w-5 text-primary" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-warning" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        className={cn(
                          'mb-2 font-semibold text-lg',
                          isDeleteOperation(permissionRequest) ? 'text-red-600' : 'text-foreground'
                        )}
                      >
                        {isDeleteOperation(permissionRequest)
                          ? 'File Deletion Warning'
                          : permissionRequest.type === 'file'
                            ? 'File Permission Required'
                            : permissionRequest.type === 'question'
                              ? permissionRequest.header || 'Question'
                              : 'Permission Required'}
                      </h3>

                      {/* File permission specific UI */}
                      {permissionRequest.type === 'file' && (
                        <>
                          {/* Delete operation warning banner */}
                          {isDeleteOperation(permissionRequest) && (
                            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                              <p className="text-red-600 text-sm">
                                {(() => {
                                  const paths = getDisplayFilePaths(permissionRequest);
                                  return paths.length > 1
                                    ? `${paths.length} files will be permanently deleted:`
                                    : 'This file will be permanently deleted:';
                                })()}
                              </p>
                            </div>
                          )}

                          {/* Non-delete operation badge */}
                          {!isDeleteOperation(permissionRequest) && (
                            <div className="mb-3">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded px-2 py-0.5 font-medium text-xs',
                                  getOperationBadgeClasses(permissionRequest.fileOperation)
                                )}
                              >
                                {permissionRequest.fileOperation?.toUpperCase()}
                              </span>
                            </div>
                          )}

                          {/* File path(s) display */}
                          <div
                            className={cn(
                              'mb-4 rounded-lg p-3',
                              isDeleteOperation(permissionRequest) ? 'border border-red-500/20 bg-red-500/5' : 'bg-muted'
                            )}
                          >
                            {(() => {
                              const paths = getDisplayFilePaths(permissionRequest);
                              if (paths.length > 1) {
                                return (
                                  <ul className="space-y-1">
                                    {paths.map((path, idx) => (
                                      <li
                                        className={cn(
                                          'break-all font-mono text-sm',
                                          isDeleteOperation(permissionRequest) ? 'text-red-600' : 'text-foreground'
                                        )}
                                        key={idx}
                                      >
                                        • {path}
                                      </li>
                                    ))}
                                  </ul>
                                );
                              }
                              return (
                                <p
                                  className={cn(
                                    'break-all font-mono text-sm',
                                    isDeleteOperation(permissionRequest) ? 'text-red-600' : 'text-foreground'
                                  )}
                                >
                                  {paths[0]}
                                </p>
                              );
                            })()}
                            {permissionRequest.targetPath && (
                              <p className="mt-1 font-mono text-muted-foreground text-sm">→ {permissionRequest.targetPath}</p>
                            )}
                          </div>

                          {/* Delete warning text */}
                          {isDeleteOperation(permissionRequest) && (
                            <p className="mb-4 text-red-600/80 text-sm">This action cannot be undone.</p>
                          )}

                          {permissionRequest.contentPreview && (
                            <details className="mb-4">
                              <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
                                Preview content
                              </summary>
                              <pre className="mt-2 max-h-32 overflow-x-auto overflow-y-auto rounded bg-muted p-2 text-xs">
                                {permissionRequest.contentPreview}
                              </pre>
                            </details>
                          )}
                        </>
                      )}

                      {/* Question type UI with options */}
                      {permissionRequest.type === 'question' && (
                        <>
                          <p className="mb-4 text-foreground text-sm">{permissionRequest.question}</p>

                          {/* Options list */}
                          {!showCustomInput && permissionRequest.options && permissionRequest.options.length > 0 && (
                            <div className="mb-4 space-y-2">
                              {permissionRequest.options.map((option, idx) => (
                                <button
                                  className={cn(
                                    'w-full rounded-lg border p-3 text-left transition-colors',
                                    selectedOptions.includes(option.label)
                                      ? 'border-primary bg-primary/10'
                                      : 'border-border hover:border-primary/50'
                                  )}
                                  key={idx}
                                  onClick={() => {
                                    // If "Other" is selected, show custom input
                                    if (option.label.toLowerCase() === 'other') {
                                      setShowCustomInput(true);
                                      setSelectedOptions([]);
                                      return;
                                    }
                                    if (permissionRequest.multiSelect) {
                                      setSelectedOptions((prev) =>
                                        prev.includes(option.label) ? prev.filter((o) => o !== option.label) : [...prev, option.label]
                                      );
                                    } else {
                                      setSelectedOptions([option.label]);
                                    }
                                  }}
                                >
                                  <div className="font-medium text-sm">{option.label}</div>
                                  {option.description && <div className="mt-1 text-muted-foreground text-xs">{option.description}</div>}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Custom text input */}
                          {showCustomInput && (
                            <div className="mb-4 space-y-2">
                              <Input
                                autoFocus
                                onChange={(e) => setCustomResponse(e.target.value)}
                                onKeyDown={(e) => {
                                  // Ignore Enter during IME composition (Chinese/Japanese input)
                                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                  if (e.key === 'Enter' && customResponse.trim()) {
                                    handlePermissionResponse(true);
                                  }
                                }}
                                placeholder="Type your response..."
                                value={customResponse}
                              />
                              <button
                                className="text-muted-foreground text-xs hover:text-foreground"
                                onClick={() => {
                                  setShowCustomInput(false);
                                  setCustomResponse('');
                                }}
                              >
                                ← Back to options
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* Standard tool UI (non-file, non-question) */}
                      {permissionRequest.type === 'tool' && (
                        <>
                          <p className="mb-4 text-muted-foreground text-sm">Allow {permissionRequest.toolName?.replace(/_/g, ' ')}?</p>

                          {/* Display requested paths from patterns */}
                          {permissionRequest.patterns && permissionRequest.patterns.length > 0 && (
                            <div className="mb-4 rounded-lg bg-muted p-3">
                              {permissionRequest.patterns.length === 1 ? (
                                <p className="break-all font-mono text-foreground text-sm">{permissionRequest.patterns[0]}</p>
                              ) : (
                                <ul className="space-y-1">
                                  {permissionRequest.patterns.map((pattern, idx) => (
                                    <li className="break-all font-mono text-foreground text-sm" key={idx}>
                                      {pattern}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {/* Tool input fallback when no patterns */}
                          {(!permissionRequest.patterns || permissionRequest.patterns.length === 0) && permissionRequest.toolName && (
                            <div className="mb-4 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                              <p className="mb-1 text-muted-foreground">Tool: {permissionRequest.toolName}</p>
                              <pre className="text-foreground">{JSON.stringify(permissionRequest.toolInput, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )}

                      <div className="flex gap-3">
                        <Button
                          className="flex-1"
                          data-testid="permission-deny-button"
                          onClick={() => handlePermissionResponse(false)}
                          variant="outline"
                        >
                          {permissionRequest.type === 'question' ? 'Cancel' : 'Deny'}
                        </Button>
                        <Button
                          className={cn('flex-1', isDeleteOperation(permissionRequest) && 'bg-red-600 text-white hover:bg-red-700')}
                          data-testid="permission-allow-button"
                          disabled={
                            permissionRequest.type === 'question' &&
                            !showCustomInput &&
                            permissionRequest.options &&
                            selectedOptions.length === 0
                          }
                          onClick={() => handlePermissionResponse(true)}
                        >
                          {isDeleteOperation(permissionRequest)
                            ? getDisplayFilePaths(permissionRequest).length > 1
                              ? 'Delete All'
                              : 'Delete'
                            : permissionRequest.type === 'question'
                              ? 'Submit'
                              : 'Allow'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Running state input with Stop button */}
        {isTaskRunning && !permissionRequest && (
          <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4">
            <div className="mx-auto flex max-w-4xl gap-3">
              <Input className="flex-1 opacity-50" disabled placeholder="Agent is working..." />
              <Button
                className="shrink-0 hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="execution-stop-button"
                onClick={interruptTask}
                size="icon"
                title="Stop agent (Ctrl+C)"
                variant="outline"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            </div>
          </div>
        )}

        {/* Follow-up input */}
        {canFollowUp && (
          <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4">
            <div className="mx-auto max-w-4xl">
              {/* Input field with Send button */}
              <div className="flex gap-3">
                <DragDropTextarea
                  className="flex-1"
                  data-testid="execution-follow-up-input"
                  disabled={isLoading}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onFilesDropped={(newValue, newCursorPosition) => {
                    setFollowUp(newValue);
                    // Restore cursor position after React renders the new value
                    setTimeout(() => {
                      if (followUpInputRef.current) {
                        followUpInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                        followUpInputRef.current.focus();
                      }
                    }, 0);
                  }}
                  onKeyDown={(e) => {
                    // Ignore Enter during IME composition (Chinese/Japanese input)
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleFollowUp();
                    }
                  }}
                  placeholder={
                    currentTask.status === 'interrupted'
                      ? hasSession
                        ? 'Give new instructions...'
                        : 'Send a new instruction to retry...'
                      : currentTask.status === 'completed'
                        ? 'Give new instructions...'
                        : 'Ask for something...'
                  }
                  ref={followUpInputRef}
                  rows={1}
                  value={followUp}
                />
                <Button disabled={!followUp.trim() || isLoading} onClick={handleFollowUp} variant="outline">
                  <CornerDownLeft className="mr-1.5 h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Completed/Failed state (no session to continue) */}
        {isComplete && !canFollowUp && (
          <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4 text-center">
            <p className="mb-3 text-muted-foreground text-sm">
              Task {currentTask.status === 'interrupted' ? 'stopped' : currentTask.status}
            </p>
            <Button onClick={() => navigate('/')}>Start New Task</Button>
          </div>
        )}

        {/* Debug Panel - Only visible when debug mode is enabled */}
        {debugModeEnabled && (
          <div className="flex-shrink-0 border-border border-t" data-testid="debug-panel">
            {/* Toggle header */}
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

            {/* Collapsible panel content */}
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

interface MessageBubbleProps {
  message: TaskMessage;
  shouldStream?: boolean;
  isLastMessage?: boolean;
  isRunning?: boolean;
  showContinueButton?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  isLoading?: boolean;
  /** If true, text is being streamed in real-time (no animation needed) */
  isRealStreaming?: boolean;
}

const COPIED_STATE_DURATION_MS = 1000;

// Memoized MessageBubble to prevent unnecessary re-renders and markdown re-parsing
const MessageBubble = memo(
  function MessageBubble({
    message,
    shouldStream = false,
    isLastMessage = false,
    isRunning = false,
    showContinueButton = false,
    continueLabel,
    onContinue,
    isLoading = false,
    isRealStreaming = false,
  }: MessageBubbleProps) {
    const [streamComplete, setStreamComplete] = useState(!shouldStream);
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isUser = message.type === 'user';
    const isTool = message.type === 'tool';
    const isSystem = message.type === 'system';
    const isAssistant = message.type === 'assistant';

    // Extract user-facing content for assistant messages (filters out Plan: sections)
    const displayContent = useMemo(() => {
      if (isAssistant) {
        return extractUserFacingContent(message.content);
      }
      return message.content;
    }, [isAssistant, message.content]);

    // Create custom markdown components with enhanced links
    const markdownComponents = useMemo(() => createMarkdownComponents(), []);

    // Enrich plain text URLs and file paths with markdown links
    const enrichedContent = useMemo(() => {
      return enrichContentWithLinks(displayContent);
    }, [displayContent]);

    // Extract media paths for thumbnail gallery
    const mediaPaths = useMemo(() => {
      return extractMediaPaths(displayContent);
    }, [displayContent]);

    // Get tool icon from mapping
    const toolName = message.toolName || message.content?.match(/Using tool: (\w+)/)?.[1];
    const ToolIcon = toolName && TOOL_PROGRESS_MAP[toolName]?.icon;

    // Mark stream as complete when shouldStream becomes false
    useEffect(() => {
      if (!shouldStream) {
        setStreamComplete(true);
      }
    }, [shouldStream]);

    useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(displayContent);
        setCopied(true);

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_STATE_DURATION_MS);
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
      }
    }, [displayContent]);

    const showCopyButton = !(isTool || (isAssistant && showContinueButton));

    const proseClasses = cn(
      'prose prose-sm max-w-none text-sm',
      'prose-headings:text-foreground',
      'prose-p:my-2 prose-p:text-foreground',
      'prose-strong:font-semibold prose-strong:text-foreground',
      'prose-em:text-foreground',
      'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:text-xs',
      'prose-pre:rounded-lg prose-pre:bg-muted prose-pre:p-3 prose-pre:text-foreground',
      'prose-ol:text-foreground prose-ul:text-foreground',
      'prose-li:my-1 prose-li:text-foreground',
      'prose-a:text-primary prose-a:underline',
      'prose-blockquote:border-border prose-blockquote:border-l-4 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground',
      'prose-hr:border-border',
      'prose-table:my-4 prose-table:w-full prose-table:border-collapse',
      'prose-thead:border-border prose-thead:border-b',
      'prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground',
      'prose-td:border-border prose-td:border-t prose-td:px-3 prose-td:py-2 prose-td:text-foreground',
      'prose-tr:border-border prose-tr:border-b',
      'break-words'
    );

    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={cn('group flex flex-col', isUser ? 'items-end' : 'items-start')}
        initial={{ opacity: 0, y: 8 }}
        transition={springs.gentle}
      >
        <div
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3 transition-all duration-150',
            isUser
              ? 'bg-primary text-primary-foreground'
              : isTool
                ? 'border border-border bg-muted'
                : isSystem
                  ? 'border border-border bg-muted/50'
                  : 'border border-border bg-card'
          )}
        >
          {/* Tool messages: show only label and loading animation */}
          {isTool ? (
            <>
              <div className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
                {ToolIcon ? <ToolIcon className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                <span>{TOOL_PROGRESS_MAP[toolName || '']?.label || toolName || 'Processing'}</span>
                {isLastMessage && isRunning && <SpinningIcon className="ml-1 h-3.5 w-3.5" />}
              </div>
            </>
          ) : (
            <>
              {isSystem && (
                <div className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
                  <Terminal className="h-3.5 w-3.5" />
                  System
                </div>
              )}
              {isUser ? (
                <p className={cn('whitespace-pre-wrap break-words text-sm', 'text-primary-foreground')}>{displayContent}</p>
              ) : isAssistant && isRealStreaming ? (
                // Real streaming mode - show text immediately with cursor
                <StreamingText isComplete={false} isRealStreaming={true} speed={120} text={enrichedContent}>
                  {(displayedText) => (
                    <div className={proseClasses}>
                      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                        {displayedText}
                      </ReactMarkdown>
                    </div>
                  )}
                </StreamingText>
              ) : isAssistant && shouldStream && !streamComplete ? (
                <StreamingText isComplete={streamComplete} onComplete={() => setStreamComplete(true)} speed={120} text={enrichedContent}>
                  {(streamedText) => (
                    <div className={proseClasses}>
                      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                        {streamedText}
                      </ReactMarkdown>
                    </div>
                  )}
                </StreamingText>
              ) : (
                <div className={proseClasses}>
                  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {enrichedContent}
                  </ReactMarkdown>
                </div>
              )}
              {/* Media thumbnail gallery */}
              {isAssistant && mediaPaths.length > 0 && <MediaGallery filePaths={mediaPaths} />}
              <p className={cn('mt-1.5 text-xs', isUser ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
              {/* Continue button inside assistant bubble */}
              {isAssistant && showContinueButton && onContinue && (
                <Button className="mt-3 gap-1.5" disabled={isLoading} onClick={onContinue} size="sm">
                  <Play className="h-3 w-3" />
                  {continueLabel || 'Continue'}
                </Button>
              )}
            </>
          )}
        </div>

        {showCopyButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={'Copy to clipboard'}
                className={cn(
                  'relative opacity-0 transition-all duration-200 group-hover:opacity-100',
                  'rounded p-1 hover:bg-accent',
                  'mt-1 shrink-0',
                  isAssistant ? 'self-start' : 'self-end',
                  !copied && 'text-muted-foreground hover:text-foreground',
                  copied && '!bg-green-500/10 !text-green-600 !hover:bg-green-500/20'
                )}
                data-testid="message-copy-button"
                onClick={handleCopy}
                size="icon-sm"
                variant="ghost"
              >
                <Check className={cn('absolute h-4 w-4', !copied && 'hidden')} />
                <Copy className={cn('absolute h-4 w-4', copied && 'hidden')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>Copy to clipboard</span>
            </TooltipContent>
          </Tooltip>
        )}
      </motion.div>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.shouldStream === next.shouldStream &&
    prev.isLastMessage === next.isLastMessage &&
    prev.isRunning === next.isRunning &&
    prev.showContinueButton === next.showContinueButton &&
    prev.isLoading === next.isLoading &&
    prev.isRealStreaming === next.isRealStreaming
);
