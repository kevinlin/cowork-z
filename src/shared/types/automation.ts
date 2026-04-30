export interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  taskId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  hasFindings: boolean;
  isRead: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateAutomationInput {
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
}

export interface UpdateAutomationInput {
  id: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
}
