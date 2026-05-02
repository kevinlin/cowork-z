import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProviderSettings } from '@/components/settings/hooks/useProviderSettings';
import { ProviderGrid } from '@/components/settings/ProviderGrid';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import { buildCron, buildDisplay, detectFrequencyFromCron, formatHour24ToDisplay, WEEKDAY_OPTIONS } from '@/lib/cron-utils';
import { validateCron } from '@/lib/tauri-api';
import type { Automation, ConnectedProvider, CreateAutomationInput, ProviderId, UpdateAutomationInput } from '@/shared';
import { getActiveProvider, isProviderReady } from '@/shared';

const SCHEDULE_FREQUENCIES = ['Hourly', 'Daily', 'Weekdays', 'Weekly', 'Custom'] as const;

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(formatHour24ToDisplay(h, m));
  }
}

interface AutomationFormProps {
  workspaceId: string;
  editing?: Automation | null;
  onSave: (input: CreateAutomationInput | UpdateAutomationInput) => void;
  onCancel: () => void;
}

export default function AutomationForm({ workspaceId, editing, onSave, onCancel }: AutomationFormProps) {
  const editingSchedule = useMemo(() => (editing ? detectFrequencyFromCron(editing.scheduleCron) : null), [editing]);

  const [name, setName] = useState(editing?.name ?? '');
  const [prompt, setPrompt] = useState(editing?.prompt ?? '');
  const [selectedFrequency, setSelectedFrequency] = useState<string>(editingSchedule?.frequency ?? 'Daily');
  const [selectedWeekday, setSelectedWeekday] = useState(editingSchedule?.weekday ?? '1');
  const [selectedTime, setSelectedTime] = useState(editingSchedule?.time ?? '09:00 AM');
  const [customCron, setCustomCron] = useState(editingSchedule?.frequency === 'Custom' ? (editing?.scheduleCron ?? '') : '');
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timeListRef = useRef<HTMLDivElement>(null);
  const [providerId, setProviderId] = useState(editing?.providerId ?? '');
  const [modelId, setModelId] = useState(editing?.modelId ?? '');
  const [modelDisplayName, setModelDisplayName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cronError, setCronError] = useState('');
  const cronValidationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    settings,
    loading: settingsLoading,
    refetch,
    setActiveProvider,
    connectProvider,
    disconnectProvider,
    updateModel,
  } = useProviderSettings();

  // Default to global configured model when creating a new automation
  useEffect(() => {
    if (settingsLoading || !settings) return;

    if (editing) {
      // Resolve display name from editing values
      const provider = settings.connectedProviders[editing.providerId as ProviderId];
      if (provider) {
        const model = provider.availableModels?.find(
          (m) => m.id === editing.modelId || `${editing.providerId}/${m.id}` === editing.modelId
        );
        setModelDisplayName(model?.name ?? editing.modelId.split('/').pop() ?? editing.modelId);
      } else {
        setModelDisplayName(editing.modelId.split('/').pop() ?? editing.modelId);
      }
    } else if (!(providerId || modelId)) {
      const activeProvider = getActiveProvider(settings);
      if (activeProvider && settings.activeProviderId && activeProvider.selectedModelId) {
        const pid = settings.activeProviderId;
        const mid = activeProvider.selectedModelId;
        setProviderId(pid);
        setModelId(mid);
        const model = activeProvider.availableModels?.find((m) => m.id === mid || `${pid}/${m.id}` === mid);
        setModelDisplayName(model?.name ?? mid.split('/').pop() ?? mid);
      }
    }
  }, [settings, settingsLoading, editing, providerId, modelId]);

  const handleTimeChange = (time: string) => {
    setSelectedTime(time);
    setTimePickerOpen(false);
  };

  useEffect(() => {
    if (timePickerOpen && timeListRef.current) {
      const activeEl = timeListRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center' });
      }
    }
  }, [timePickerOpen]);

  const computedCron = selectedFrequency === 'Custom' ? customCron : buildCron(selectedFrequency, selectedTime, selectedWeekday);
  const computedDisplay = selectedFrequency === 'Custom' ? customCron : buildDisplay(selectedFrequency, selectedTime, selectedWeekday);

  useEffect(() => {
    if (!computedCron.trim()) {
      setCronError('');
      return;
    }
    if (cronValidationTimer.current) clearTimeout(cronValidationTimer.current);
    cronValidationTimer.current = setTimeout(
      () => {
        validateCron(computedCron)
          .then(() => setCronError(''))
          .catch((err: unknown) => {
            setCronError(typeof err === 'string' ? err : ((err as Error)?.message ?? 'Invalid cron expression'));
          });
      },
      selectedFrequency === 'Custom' ? 400 : 0
    );
    return () => {
      if (cronValidationTimer.current) clearTimeout(cronValidationTimer.current);
    };
  }, [computedCron, selectedFrequency]);

  const handleSubmit = () => {
    if (!(name.trim() && prompt.trim() && providerId && modelId) || cronError) return;

    const scheduleCron = computedCron;
    const scheduleDisplay = computedDisplay;

    if (editing) {
      onSave({
        id: editing.id,
        name: name.trim(),
        prompt: prompt.trim(),
        scheduleCron,
        scheduleDisplay,
        providerId,
        modelId,
        enabled: editing.enabled,
      } satisfies UpdateAutomationInput);
    } else {
      onSave({
        workspaceId,
        name: name.trim(),
        prompt: prompt.trim(),
        scheduleCron,
        scheduleDisplay,
        providerId,
        modelId,
      } satisfies CreateAutomationInput);
    }
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      <h3 className="font-semibold text-lg">{editing ? 'Edit Automation' : 'New Automation'}</h3>

      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="automation-name">
          Name
        </label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          id="automation-name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Daily code review"
          value={name}
        />
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="automation-prompt">
          Prompt
        </label>
        <textarea
          className="min-h-[80px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          id="automation-prompt"
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Review recent commits for bugs. /code-review"
          value={prompt}
        />
      </div>

      <div className="space-y-2">
        <label className="font-medium text-sm">Schedule</label>

        {selectedFrequency === 'Custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <Select onValueChange={setSelectedFrequency} value={selectedFrequency}>
              <SelectTrigger>
                <SelectValue placeholder="Frequency" />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_FREQUENCIES.map((freq) => (
                  <SelectItem key={freq} value={freq}>
                    {freq}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              className="h-9 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="*/5 * * * *"
              value={customCron}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className={`grid gap-2 ${selectedFrequency === 'Weekly' ? 'grid-cols-3' : selectedFrequency === 'Hourly' ? 'grid-cols-1' : 'grid-cols-2'}`}
            >
              <Select onValueChange={setSelectedFrequency} value={selectedFrequency}>
                <SelectTrigger>
                  <SelectValue placeholder="Frequency" />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {freq}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedFrequency === 'Weekly' && (
                <Select onValueChange={setSelectedWeekday} value={selectedWeekday}>
                  <SelectTrigger>
                    <SelectValue placeholder="Day" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_OPTIONS.map((day) => (
                      <SelectItem key={day.value} value={day.value}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedFrequency !== 'Hourly' && (
                <div className="relative">
                  <button
                    className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    onClick={() => setTimePickerOpen(!timePickerOpen)}
                    type="button"
                  >
                    <span>{selectedTime}</span>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {timePickerOpen && (
                    <div
                      className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
                      ref={timeListRef}
                    >
                      {TIME_OPTIONS.map((time) => (
                        <button
                          className={`w-full rounded-sm px-3 py-1.5 text-left text-sm transition-colors ${
                            time === selectedTime ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                          data-active={time === selectedTime}
                          key={time}
                          onClick={() => handleTimeChange(time)}
                          type="button"
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {computedCron && (
          <div className={`rounded-md px-3 py-1.5 ${cronError ? 'bg-destructive/10' : 'bg-muted/50'}`}>
            <span className={`font-mono text-xs ${cronError ? 'text-destructive' : 'text-muted-foreground'}`}>{computedCron}</span>
          </div>
        )}
        {cronError && <p className="text-destructive text-xs">{cronError}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-sm">Model</label>
        <button
          className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-ring"
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          <span className={modelDisplayName ? 'text-foreground' : 'text-muted-foreground'}>{modelDisplayName || 'Select model...'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <AutomationModelPickerDialog
        onModelSelected={(selectedModelId, displayName) => {
          const parts = selectedModelId.split('/');
          setProviderId(parts[0] ?? '');
          setModelId(selectedModelId);
          setModelDisplayName(displayName);
        }}
        onOpenChange={setPickerOpen}
        open={pickerOpen}
        providerSettings={{ settings, settingsLoading, refetch, setActiveProvider, connectProvider, disconnectProvider, updateModel }}
      />

      <div className="flex justify-end gap-2 pt-2">
        <button
          className="rounded-md border border-border px-4 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={!(name.trim() && prompt.trim() && modelId && computedCron.trim()) || !!cronError}
          onClick={handleSubmit}
          type="button"
        >
          {editing ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
}

interface AutomationModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSelected: (modelId: string, displayName: string) => void;
  providerSettings: {
    settings: ReturnType<typeof useProviderSettings>['settings'];
    settingsLoading: boolean;
    refetch: () => Promise<void>;
    setActiveProvider: (providerId: ProviderId | null) => Promise<void>;
    connectProvider: (providerId: ProviderId, provider: ConnectedProvider) => Promise<void>;
    disconnectProvider: (providerId: ProviderId) => Promise<void>;
    updateModel: (providerId: ProviderId, modelId: string | null) => Promise<void>;
  };
}

function AutomationModelPickerDialog({ open, onOpenChange, onModelSelected, providerSettings }: AutomationModelPickerDialogProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [gridExpanded, setGridExpanded] = useState(false);
  const [showModelError, setShowModelError] = useState(false);

  const { settings, settingsLoading, refetch, setActiveProvider, connectProvider, disconnectProvider, updateModel } = providerSettings;

  useEffect(() => {
    if (open) {
      refetch();
      setSelectedProvider(null);
      setGridExpanded(false);
      setShowModelError(false);
    }
  }, [open, refetch]);

  const handleSelectProvider = useCallback(
    async (providerId: ProviderId) => {
      setSelectedProvider(providerId);
      setShowModelError(false);
      const provider = settings?.connectedProviders?.[providerId];
      if (provider && isProviderReady(provider)) {
        await setActiveProvider(providerId);
      }
    },
    [settings?.connectedProviders, setActiveProvider]
  );

  const handleConnect = useCallback(
    async (provider: ConnectedProvider) => {
      await connectProvider(provider.providerId, provider);
      if (isProviderReady(provider)) {
        await setActiveProvider(provider.providerId);
      }
    },
    [connectProvider, setActiveProvider]
  );

  const handleDisconnect = useCallback(async () => {
    if (!selectedProvider) return;
    await disconnectProvider(selectedProvider);
    setSelectedProvider(null);
  }, [selectedProvider, disconnectProvider]);

  const handleModelChange = useCallback(
    async (newModelId: string) => {
      if (!selectedProvider) return;
      await updateModel(selectedProvider, newModelId);
      setShowModelError(false);
    },
    [selectedProvider, updateModel]
  );

  const handleDone = useCallback(() => {
    if (!(selectedProvider && settings)) {
      setShowModelError(true);
      return;
    }

    const provider = settings.connectedProviders[selectedProvider];
    if (!provider?.selectedModelId) {
      setShowModelError(true);
      return;
    }

    const mid = provider.selectedModelId;
    const displayName =
      provider.availableModels?.find((m) => m.id === mid || `${selectedProvider}/${m.id}` === mid)?.name ?? mid.split('/').pop() ?? mid;

    const fullModelId = mid.includes('/') ? mid : `${selectedProvider}/${mid}`;
    onModelSelected(fullModelId, displayName);
    onOpenChange(false);
  }, [selectedProvider, settings, onModelSelected, onOpenChange]);

  if (settingsLoading || !settings) {
    return (
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Select Model</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Select Model</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 px-6 pb-6">
          <section>
            <ProviderGrid
              expanded={gridExpanded}
              onSelectProvider={handleSelectProvider}
              onToggleExpanded={() => setGridExpanded(!gridExpanded)}
              selectedProvider={selectedProvider}
              settings={settings}
            />
          </section>

          <AnimatePresence>
            {selectedProvider && (
              <motion.section
                animate="animate"
                exit="exit"
                initial="initial"
                transition={settingsTransitions.enter}
                variants={settingsVariants.slideDown}
              >
                <ProviderSettingsPanel
                  connectedProvider={settings?.connectedProviders?.[selectedProvider]}
                  key={selectedProvider}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  onModelChange={handleModelChange}
                  providerId={selectedProvider}
                  showModelError={showModelError}
                />
              </motion.section>
            )}
          </AnimatePresence>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!selectedProvider} onClick={handleDone}>
              Select Model
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
