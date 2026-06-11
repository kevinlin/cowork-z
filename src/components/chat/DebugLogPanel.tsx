/**
 * DebugLogPanel — collapsible sidecar debug-log panel for the Execution page.
 *
 * Isolated into its own component so that:
 * - the `sidecar:log` listener is registered only while debug mode is enabled
 *   (the parent mounts this component conditionally),
 * - log events re-render only this panel, not the whole Execution page,
 * - retained logs are capped to the most recent MAX_DEBUG_LOGS entries.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Check, ChevronDown, ChevronUp, Download, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/tauri-api';
import { cn } from '@/lib/utils';

interface DebugLogEntry {
  taskId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
}

interface KeyedDebugLogEntry extends DebugLogEntry {
  uid: number;
}

/** Maximum number of retained log entries (oldest are dropped). */
const MAX_DEBUG_LOGS = 500;

let debugLogUid = 0;

interface DebugLogPanelProps {
  taskId: string | undefined;
}

export function DebugLogPanel({ taskId }: DebugLogPanelProps) {
  const [debugLogs, setDebugLogs] = useState<KeyedDebugLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugExported, setDebugExported] = useState(false);
  const debugPanelRef = useRef<HTMLDivElement>(null);

  // Reset logs when switching tasks, then subscribe to sidecar logs.
  useEffect(() => {
    setDebugLogs([]);

    // Cancelled flag handles the race between cleanup and async listener
    // registration (React Strict Mode double-mount).
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    api
      .onDebugLog((log) => {
        const entry = log as DebugLogEntry;
        debugLogUid += 1;
        const keyed: KeyedDebugLogEntry = { ...entry, uid: debugLogUid };
        setDebugLogs((prev) => {
          const next = [...prev, keyed];
          return next.length > MAX_DEBUG_LOGS ? next.slice(next.length - MAX_DEBUG_LOGS) : next;
        });
      })
      .then((unsub) => {
        if (cancelled) {
          unsub();
        } else {
          unlisten = unsub;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [taskId]);

  // Auto-scroll the panel when new logs arrive
  useEffect(() => {
    if (debugPanelOpen && debugPanelRef.current) {
      debugPanelRef.current.scrollTop = debugPanelRef.current.scrollHeight;
    }
  }, [debugLogs.length, debugPanelOpen]);

  const handleExportDebugLogs = useCallback(async () => {
    const text = debugLogs
      .map((log) => {
        const dataStr = log.data === undefined ? '' : ` ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}`;
        return `${new Date(log.timestamp).toISOString()} [${log.type}] ${log.message}${dataStr}`;
      })
      .join('\n');

    const defaultFilename = `debug-logs-${taskId}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;

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
  }, [debugLogs, taskId]);

  return (
    <div className="flex-shrink-0 border-border border-t" data-testid="debug-panel">
      <button
        className="flex w-full items-center justify-between bg-zinc-900 px-6 py-2.5 transition-colors hover:bg-zinc-800"
        onClick={() => setDebugPanelOpen(!debugPanelOpen)}
      >
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Bug className="h-4 w-4" />
          <span className="font-medium">Debug Logs</span>
          {debugLogs.length > 0 && <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">{debugLogs.length}</span>}
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
                <div className="flex h-full items-center justify-center text-zinc-500">No debug logs yet. Run a task to see logs.</div>
              ) : (
                <div className="space-y-1">
                  {debugLogs.map((log) => (
                    <div className="flex gap-2" key={log.uid}>
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
  );
}
