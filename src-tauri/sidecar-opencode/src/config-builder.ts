import type { AgentConfig, Config, FolderPermission, PermissionAction, PermissionConfig } from './types';

/**
 * Platform-specific environment instructions for the agent
 */
function getPlatformEnvironmentInstructions(): string {
  if (process.platform === 'win32') {
    return `<environment>
**You are running on Windows.** Use Windows-compatible commands:
- Use PowerShell syntax, not bash/Unix syntax
- Use \`$env:TEMP\` for temp directory (not /tmp)
- Use semicolon (;) for PATH separator (not colon)
- Use \`$env:VAR\` for environment variables (not $VAR)
</environment>`;
  }
  return `<environment>
You are running on ${process.platform === 'darwin' ? 'macOS' : 'Linux'}.
</environment>`;
}

/**
 * System prompt for the Accomplish agent
 */
const ACCOMPLISH_SYSTEM_PROMPT = `<identity>
You are Cowork-Z, a general-purpose desktop agent that helps users complete tasks on their computer.
</identity>

${getPlatformEnvironmentInstructions()}

<capabilities>
When users ask about your capabilities, mention:
- **System & Workflow Automation**: Perform multi-step tasks reliably with verification after each step.
- **File & Project Organization**: Create, edit, move, and organize files and folders as needed for the task.
</capabilities>

<behavior name="task-planning">
**TASK PLANNING - REQUIRED FOR EVERY TASK**

Before taking ANY action, you MUST first output a plan:

1. **State the goal** - What the user wants accomplished
2. **List steps with verification** - Numbered steps, each with a completion criterion

Format:
**Plan:**
Goal: [what user asked for]

Steps:
1. [Action] → verify: [how to confirm it's done]
2. [Action] → verify: [how to confirm it's done]
...

Then execute the steps.
</behavior>

<behavior>
- Use AskUserQuestion tool for clarifying questions before starting ambiguous tasks
- After each action, evaluate the result before deciding next steps

**DO NOT ASK FOR PERMISSION TO CONTINUE:**
If the user gave you a task with specific criteria:
- Keep working until you meet those criteria
- Do NOT pause to ask "Would you like me to continue?"
- Just continue working until the task requirements are met
</behavior>
`;

export interface ConfigBuilderOptions {
  modelId?: string;
  folderPermissions?: FolderPermission[];
  enabledProviders?: string[];
}

export function buildSessionConfig(options: ConfigBuilderOptions = {}): Partial<Config> {
  // Build permission config with deny-by-default for external directories
  const permissionConfig: PermissionConfig = {
    doom_loop: 'deny' as PermissionAction,
  };

  if (options.folderPermissions && options.folderPermissions.length > 0) {
    const externalDirRules: Record<string, PermissionAction> = {};
    const editRules: Record<string, PermissionAction> = {};
    const readRules: Record<string, PermissionAction> = {};

    for (const fp of options.folderPermissions) {
      // Allow external directory access for all permitted folders
      externalDirRules[fp.path] = 'allow';
      // Always allow read access for permitted folders
      readRules[fp.path] = 'allow';

      if (fp.accessLevel === 'read-write') {
        // For read-write folders: ask before any edit/delete operation
        editRules[fp.path] = 'ask';
      } else {
        // For read-only folders: deny all edits
        editRules[fp.path] = 'deny';
      }
    }

    permissionConfig.external_directory = externalDirRules;
    permissionConfig.read = readRules;
    permissionConfig.edit = editRules;
  }

  // Build agent config
  const agentConfig: Record<string, AgentConfig> = {
    accomplish: {
      description: 'General-purpose desktop automation assistant',
      prompt: ACCOMPLISH_SYSTEM_PROMPT,
      mode: 'primary',
    },
  };

  const config: Partial<Config> = {
    default_agent: 'accomplish',
    permission: permissionConfig,
    agent: agentConfig,
  };

  // Set model if provided
  if (options.modelId) {
    config.model = options.modelId;
  }

  // Set enabled providers
  if (options.enabledProviders) {
    config.enabled_providers = options.enabledProviders;
  }

  return config;
}
