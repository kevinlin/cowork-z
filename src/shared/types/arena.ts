/**
 * Arena types — side-by-side agent comparison sessions
 */

import type { Task } from './task';

export interface ArenaModelConfig {
  /** Full model ID, e.g. "anthropic/claude-sonnet-4-5" */
  modelId: string;
  /** Display name, e.g. "Claude Sonnet 4.5" */
  displayName: string;
}

export interface ArenaConfig {
  prompt: string;
  models: ArenaModelConfig[];
}

export interface Arena {
  id: string;
  prompt: string;
  workspaceId?: string;
  createdAt: string;
  completedAt?: string;
  tasks: Task[];
}

/** Lightweight child task info for sidebar expandable display (no messages) */
export interface ArenaChildTask {
  id: string;
  status: string;
  modelId?: string;
  arenaSlot?: number;
  summary?: string;
}

/** Lightweight arena for sidebar listing */
export interface ArenaListItem {
  id: string;
  prompt: string;
  workspaceId?: string;
  createdAt: string;
  completedAt?: string;
  /** Derived from child tasks: running | starting | completed | failed | interrupted | pending */
  status: string;
  /** Model IDs of the 3 columns */
  modelIds: (string | null)[];
  /** Child tasks for expandable sidebar display */
  tasks: ArenaChildTask[];
}
