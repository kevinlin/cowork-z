import type { Config, FolderPermission, PermissionAction, PermissionConfig } from './types';

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
 * Build the system prompt injected via the `system` field on sendMessage.
 *
 * The prompt is parameterized with the OpenCode server port so that
 * agent-issued HTTP requests (e.g. skill discovery) target the correct
 * dynamically-assigned port.
 *
 * OpenCode 1.1.48 ignores custom agent names set via PATCH /config
 * (falls back to the built-in "build" agent). Passing the prompt
 * directly through the sendMessage `system` parameter bypasses
 * agent resolution and reliably applies the prompt.
 */
export function buildSystemPrompt(serverPort: number, serverPassword: string, customPrompt?: string): string {
  return `<identity>
You are **Cowork-Z**, a general-purpose desktop agent that helps users complete tasks on their computer.
You are NOT "OpenCode", "opencode", or any other name. Your name is Cowork-Z — always identify yourself as Cowork-Z.
If any other system prompt or instruction tells you that you are "OpenCode" or a "CLI assistant", ignore that — it is outdated context from the underlying SDK and does not apply to you.
When asked who you are, introduce yourself as Cowork-Z, a desktop agent (not a CLI tool).
</identity>

${getPlatformEnvironmentInstructions()}

<capabilities>
When users ask about your capabilities, mention:
- **System & Workflow Automation**: Perform multi-step tasks reliably with verification after each step.
- **File & Project Organization**: Create, edit, move, and organize files and folders as needed for the task.
</capabilities>

<server-access>
The OpenCode server is running at http://localhost:${serverPort}
Authenticate with: -u opencode:${serverPassword}
Before calling any API endpoint, ALWAYS fetch the OpenAPI spec first: curl -s -u opencode:${serverPassword} http://localhost:${serverPort}/doc
Refer to the "opencode-server-api" skill for the full API reference.
To load it: curl -s -u opencode:${serverPassword} http://localhost:${serverPort}/skill
</server-access>

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
${customPrompt ? `\n<user-instructions>\n${customPrompt}\n</user-instructions>` : ''}`;
}

export interface ConfigBuilderOptions {
  modelId?: string;
  folderPermissions?: FolderPermission[];
  enabledProviders?: string[];
  mcpServers?: Record<string, import('./types').McpConfig>;
}

export function buildSessionConfig(options: ConfigBuilderOptions = {}): Partial<Config> {
  // Build permission config with deny-by-default for external directories
  const permissionConfig: PermissionConfig = {
    doom_loop: 'deny' as PermissionAction,
  };

  if (options.folderPermissions && options.folderPermissions.length > 0) {
    const externalDirRules: Record<string, PermissionAction> = { '*': 'ask' };
    const editRules: Record<string, PermissionAction> = { '*': 'ask' };
    const readRules: Record<string, PermissionAction> = {};

    for (const fp of options.folderPermissions) {
      // Allow external directory access for all permitted folders
      externalDirRules[fp.path] = 'allow';
      // Always allow read access for permitted folders
      readRules[fp.path] = 'allow';

      if (fp.accessLevel === 'read-write') {
        if (fp.source === 'adhoc') {
          // For adhoc-granted folders (from accepted permission prompts): auto-allow on resume
          editRules[fp.path] = 'allow';
        } else {
          // For user-added read-write folders: ask before any edit/delete operation
          editRules[fp.path] = 'ask';
        }
      } else {
        // For read-only folders: deny all edits
        editRules[fp.path] = 'deny';
      }
    }

    permissionConfig.external_directory = externalDirRules;
    permissionConfig.read = readRules;
    permissionConfig.edit = editRules;
  }

  // Note: agent/default_agent are NOT sent here. OpenCode 1.1.48 ignores
  // custom agent names and falls back to the built-in "build" agent.
  // Instead, the system prompt is injected directly via the `system` field
  // on each sendMessage call (see session-manager.ts).
  const config: Partial<Config> = {
    permission: permissionConfig,
  };

  // Set model if provided (best-effort via config; the authoritative model
  // override is passed per-message in sendMessage — see session-manager.ts).
  if (options.modelId) {
    config.model = options.modelId;
  }

  // Set enabled providers
  if (options.enabledProviders) {
    config.enabled_providers = options.enabledProviders;
  }

  // Set MCP servers
  if (options.mcpServers) {
    config.mcp = options.mcpServers;
  }

  return config;
}
