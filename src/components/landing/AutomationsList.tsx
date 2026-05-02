import { Plus, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Automation, CreateAutomationInput, UpdateAutomationInput } from '@/shared';
import { useAutomationStore } from '@/stores/automationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import AutomationCard from './AutomationCard';
import AutomationForm from './AutomationForm';

export default function AutomationsList() {
  const [showForm, setShowForm] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);

  const { automations, isLoading, nextRuns, loadAutomations, createAutomation, updateAutomation, deleteAutomation, toggleEnabled, runNow } =
    useAutomationStore();
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadAutomations(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, loadAutomations]);

  const handleSave = useCallback(
    async (input: CreateAutomationInput | UpdateAutomationInput) => {
      if ('id' in input) {
        await updateAutomation(input);
      } else {
        await createAutomation(input);
      }
      setShowForm(false);
      setEditingAutomation(null);
    },
    [createAutomation, updateAutomation]
  );

  const handleEdit = useCallback((automation: Automation) => {
    setEditingAutomation(automation);
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingAutomation(null);
  }, []);

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">Select a workspace to manage automations</div>
    );
  }

  if (showForm) {
    return <AutomationForm editing={editingAutomation} onCancel={handleCancel} onSave={handleSave} workspaceId={activeWorkspace.id} />;
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">
          {automations.length} automation{automations.length === 1 ? '' : 's'}
        </span>
        <button
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
          onClick={() => setShowForm(true)}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {automations.length === 0 && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Zap className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground text-sm">No automations yet</p>
            <p className="mt-1 text-muted-foreground text-xs">Create your first automation to run tasks on a schedule</p>
          </div>
          <button
            className="mt-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
            onClick={() => setShowForm(true)}
            type="button"
          >
            Create your first automation
          </button>
        </div>
      )}

      {automations.map((automation) => (
        <AutomationCard
          automation={automation}
          key={automation.id}
          nextRunAt={nextRuns[automation.id] ?? null}
          onDelete={deleteAutomation}
          onEdit={handleEdit}
          onRunNow={runNow}
          onToggleEnabled={toggleEnabled}
        />
      ))}
    </div>
  );
}
