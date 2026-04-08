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
export function buildSystemPrompt(serverPort: number, serverPassword: string, customPrompt?: string, workspaceDir?: string): string {
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

${
  workspaceDir
    ? `<workspace-conventions>
This workspace uses a convention-based folder structure:
- **\`input/\`** — Read-only reference materials. NEVER modify, delete, move, or overwrite any files in \`input/\`. This applies to ALL tools including bash. Read from \`input/\` and write results to \`output/\`.
- **\`output/\`** — Your working area. Create, edit, and organize outputs here.
</workspace-conventions>`
    : ''
}

<server-access>
The OpenCode server is running at http://localhost:${serverPort}
Authenticate with: -u opencode:${serverPassword}
Before calling any API endpoint, ALWAYS fetch the OpenAPI spec first: curl -s -u opencode:${serverPassword} http://localhost:${serverPort}/doc
Refer to the "opencode-server-api" skill for the full API reference.
To load it: curl -s -u opencode:${serverPassword} http://localhost:${serverPort}/skill
</server-access>

<tools>
You have access to these tools — use them proactively:

| Tool | When to use |
|------|-------------|
| \`todowrite\` | Create and manage task lists. Use this to break down every non-trivial task into steps BEFORE starting work. Update task status as you progress. |
| \`todoread\` | Read the current todo list. Check this frequently to stay on track and decide what to do next. |
| \`question\` | Ask the user a question with multiple-choice options or free-text input. Use this to clarify ambiguous requirements, confirm your approach, or let the user choose between alternatives. |
| \`webfetch\` | Fetch content from a URL and return it as markdown/text. Use this when you need to read documentation, API references, or any web content relevant to the task. |
| \`task\` | Launch a specialized sub-agent for complex or independent subtasks. Use this to parallelize work or delegate research-heavy steps without blocking your main workflow. |
</tools>

<behavior name="task-planning">
**TASK PLANNING - REQUIRED FOR EVERY TASK**

Before taking ANY action, you MUST:

1. **Clarify if needed** — If the task is ambiguous, has multiple valid approaches, or you are unsure about the user's expectations, use the \`question\` tool FIRST to ask the user before proceeding. Do not guess — ask.
2. **Create a todo list** — Use \`todowrite\` to break the task into numbered steps with clear completion criteria. This is your plan.
3. **Execute step by step** — Work through each todo item. Mark items complete as you finish them. Use \`todoread\` to check progress and decide what's next.

Example flow:
- User asks: "Organize my downloads folder"
- You use \`question\` to ask: "How would you like files organized?" with options like "By file type", "By date", "By project"
- You use \`todowrite\` to create the step-by-step plan
- You execute each step, updating the todo list as you go
</behavior>

<behavior>
- After each action, evaluate the result before deciding next steps
- Use \`todoread\` between steps to maintain awareness of overall progress
- Use \`question\` whenever you encounter a decision point where user preference matters — don't assume

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
      if (fp.source === 'workspace') {
        const wsPath = fp.path;
        const sep = process.platform === 'win32' ? '\\' : '/';
        const norm = wsPath.replace(/[/\\]+$/, '');
        const inputDir = norm + sep + 'input';
        const outputDir = norm + sep + 'output';

        externalDirRules[wsPath] = 'allow';
        readRules[wsPath] = 'allow';

        // "Last matching pattern wins" — general rules first, overrides last
        editRules[wsPath] = 'allow';
        editRules[inputDir] = 'deny';
        editRules[inputDir + sep + '*'] = 'deny';
        editRules[outputDir] = 'allow';
        editRules[outputDir + sep + '*'] = 'allow';
        continue;
      }

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

    // OpenRouter models are not in OpenCode's curated model database, so
    // automatic small-model resolution picks the wrong model (e.g. Claude
    // Haiku 4.5 via the built-in "opencode" provider).  Fix:
    //  1. Disable the "opencode" provider so it can't auto-load.
    //  2. Register gpt-5-nano under the openrouter provider config so
    //     OpenCode's getModel("openrouter", "openai/gpt-5-nano") succeeds.
    //  3. Set small_model explicitly.
    if (options.modelId.startsWith('github-copilot-enterprise/')) {
      config.enabled_providers = [...((config.enabled_providers as string[]) ?? []), 'github-copilot-enterprise'];
    } else if (options.modelId.startsWith('github-copilot/')) {
      config.enabled_providers = [...((config.enabled_providers as string[]) ?? []), 'github-copilot'];
    }

    if (options.modelId.startsWith('openrouter/')) {
      config.small_model = 'openrouter/openai/gpt-5-nano';
      config.disabled_providers = ['opencode'];
      config.provider = {
        ...((config.provider as Record<string, unknown>) ?? {}),
        openrouter: {
          models: {
            'openai/gpt-5-nano': {
              name: 'GPT-5 Nano',
              tool_call: true,
            },
          },
        },
      };
    }
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
