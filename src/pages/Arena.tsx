import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArenaColumns } from '@/components/arena/ArenaColumns';
import { ArenaInputBar } from '@/components/arena/ArenaInputBar';
import { PermissionModal } from '@/components/chat/PermissionModal';
import * as api from '@/lib/tauri-api';
import { useArenaStore } from '@/stores/arenaStore';

export default function ArenaPage() {
  const { arenaId } = useParams<{ arenaId: string }>();
  const navigate = useNavigate();

  const {
    loadArena,
    reset,
    handleTaskUpdate,
    handleTaskUpdateBatch,
    handlePartialMessage,
    handlePartialMessageComplete,
    handleStatusChange,
    handlePermissionRequest,
    respondToPermission,
    permissionRequest,
    columns,
  } = useArenaStore();

  const isNewArena = arenaId === 'new';

  // Load existing arena on mount (unless "new")
  useEffect(() => {
    if (isNewArena) {
      reset();
    } else if (arenaId) {
      loadArena(arenaId).catch((err) => {
        console.error('Failed to load arena:', err);
        navigate('/');
      });
    }
  }, [arenaId, isNewArena, loadArena, reset, navigate]);

  // Subscribe to Tauri events and route to arena store handlers
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const track = (unsub: () => void) => {
      if (cancelled) {
        unsub();
      } else {
        unlisteners.push(unsub);
      }
    };

    // Task update (individual messages)
    api
      .onTaskUpdate((event) => {
        handleTaskUpdate(event);
      })
      .then(track);

    // Batch updates
    api
      .onTaskUpdateBatch((event) => {
        if (event.messages?.length) {
          handleTaskUpdateBatch(event.taskId, event.messages);
        }
      })
      .then(track);

    // Permission requests
    api
      .onPermissionRequest((request) => {
        handlePermissionRequest(request);
      })
      .then(track);

    // Status changes
    api
      .onTaskStatusChange((data) => {
        handleStatusChange(data.taskId, data.status);
      })
      .then(track);

    // Partial message streaming
    api
      .onTaskMessagePartial((event) => {
        handlePartialMessage(event);
      })
      .then(track);

    // Partial message completion
    api
      .onTaskMessageComplete((event) => {
        handlePartialMessageComplete(event);
      })
      .then(track);

    return () => {
      cancelled = true;
      for (const unsub of unlisteners) {
        unsub();
      }
    };
  }, [
    handleTaskUpdate,
    handleTaskUpdateBatch,
    handlePermissionRequest,
    handleStatusChange,
    handlePartialMessage,
    handlePartialMessageComplete,
  ]);

  const handlePermissionResponse = useCallback(
    async (allowed: boolean, selectedOptions?: string[], customText?: string) => {
      if (!permissionRequest) return;

      await respondToPermission({
        requestId: permissionRequest.id,
        taskId: permissionRequest.taskId,
        decision: allowed ? 'allow' : 'deny',
        selectedOptions: permissionRequest.type === 'question' ? selectedOptions : undefined,
        customText,
      });
    },
    [permissionRequest, respondToPermission]
  );

  // Check if any column has completed (allows follow-up)
  const isAllComplete = columns.every(
    (col) =>
      col.status === 'idle' ||
      col.status === 'completed' ||
      col.status === 'failed' ||
      col.status === 'cancelled' ||
      col.status === 'interrupted'
  );
  const hasStarted = columns.some((col) => col.taskId !== null);
  const canFollowUp = hasStarted && isAllComplete;

  return (
    <div className="flex h-full flex-col bg-background">
      <ArenaInputBar canFollowUp={canFollowUp} isNewArena={isNewArena} />
      <ArenaColumns />

      {/* Permission modal */}
      {permissionRequest && <PermissionModal onRespond={handlePermissionResponse} request={permissionRequest} />}
    </div>
  );
}
