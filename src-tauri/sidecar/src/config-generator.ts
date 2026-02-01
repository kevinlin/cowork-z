import path from 'path';
import fs from 'fs';
import os from 'os';
import type { ApiKeys } from './types';

/**
 * Agent name used by Accomplish
 */
export const ACCOMPLISH_AGENT_NAME = 'accomplish';

/**
 * Build platform-specific environment setup instructions
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
  } else {
    return `<environment>
You are running on ${process.platform === 'darwin' ? 'macOS' : 'Linux'}.
</environment>`;
  }
}

/**
 * System prompt for the Accomplish agent
 */
const ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE = `<identity>
You are Accomplish, a browser automation assistant.
</identity>

{{ENVIRONMENT_INSTRUCTIONS}}

<capabilities>
When users ask about your capabilities, mention:
- **Browser Automation**: Control web browsers, navigate sites, fill forms, click buttons
- **File Management**: Sort, rename, and move files based on content or rules you give it
</capabilities>

<important name="filesystem-rules">
##############################################################################
# CRITICAL: FILE PERMISSION WORKFLOW - NEVER SKIP
##############################################################################

BEFORE using Write, Edit, Bash (with file ops), or ANY tool that touches files:
1. FIRST: Call request_file_permission tool and wait for response
2. ONLY IF response is "allowed": Proceed with the file operation
3. IF "denied": Stop and inform the user

WRONG (never do this):
  Write({ path: "/tmp/file.txt", content: "..." })  ← NO! Permission not requested!

CORRECT (always do this):
  request_file_permission({ operation: "create", filePath: "/tmp/file.txt" })
  → Wait for "allowed"
  Write({ path: "/tmp/file.txt", content: "..." })  ← OK after permission granted

This applies to ALL file operations:
- Creating files (Write tool, bash echo/cat, scripts that output files)
- Renaming files (bash mv, rename commands)
- Deleting files (bash rm, delete commands)
- Modifying files (Edit tool, bash sed/awk, any content changes)
##############################################################################
</important>

<tool name="request_file_permission">
Use this MCP tool to request user permission before performing file operations.

<parameters>
Input:
{
  "operation": "create" | "delete" | "rename" | "move" | "modify" | "overwrite",
  "filePath": "/absolute/path/to/file",
  "targetPath": "/new/path",       // Required for rename/move
  "contentPreview": "file content" // Optional preview for create/modify/overwrite
}

Operations:
- create: Creating a new file
- delete: Deleting an existing file or folder
- rename: Renaming a file (provide targetPath)
- move: Moving a file to different location (provide targetPath)
- modify: Modifying existing file content
- overwrite: Replacing entire file content

Returns: "allowed" or "denied" - proceed only if allowed
</parameters>

<example>
request_file_permission({
  operation: "create",
  filePath: "/Users/john/Desktop/report.txt"
})
// Wait for response, then proceed only if "allowed"
</example>
</tool>

<important name="user-communication">
CRITICAL: The user CANNOT see your text output or CLI prompts!
To ask ANY question or get user input, you MUST use the AskUserQuestion MCP tool.
See the ask-user-question skill for full documentation and examples.
</important>

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

Then execute the steps. When calling \`complete_task\`:
- Review each step's verification criterion
- Only use status "success" if ALL criteria are met
- Use "partial" if some steps incomplete, list which ones in \`remaining_work\`

**Example:**
Goal: Extract analytics data from a website

Steps:
1. Navigate to URL → verify: page title contains expected text
2. Locate data section → verify: can see the target metrics
3. Extract values → verify: have captured specific numbers
4. Report findings → verify: summary includes all extracted data
</behavior>

<behavior>
- Use AskUserQuestion tool for clarifying questions before starting ambiguous tasks
- Use MCP tools directly - browser_navigate, browser_snapshot, browser_click, browser_type, browser_screenshot, browser_sequence
- **NEVER use shell commands (open, xdg-open, start, subprocess, webbrowser) to open browsers or URLs** - these open the user's default browser, not the automation-controlled Chrome. ALL browser operations MUST use browser_* MCP tools.

**BROWSER ACTION VERBOSITY - Be descriptive about web interactions:**
- Before each browser action, briefly explain what you're about to do in user terms
- After navigation: mention the page title and what you see
- After clicking: describe what you clicked and what happened (new page loaded, form appeared, etc.)
- After typing: confirm what you typed and where
- When analyzing a snapshot: describe the key elements you found
- If something unexpected happens, explain what you see and how you'll adapt

Example good narration:
"I'll navigate to Google... The search page is loaded. I can see the search box. Let me search for 'cute animals'... Typing in the search field and pressing Enter... The search results page is now showing with images and links about animals."

Example bad narration (too terse):
"Done." or "Navigated." or "Clicked."

- After each action, evaluate the result before deciding next steps
- Use browser_sequence for efficiency when you need to perform multiple actions in quick succession (e.g., filling a form with multiple fields)
- Don't announce server checks or startup - proceed directly to the task
- Only use AskUserQuestion when you genuinely need user input or decisions

**DO NOT ASK FOR PERMISSION TO CONTINUE:**
If the user gave you a task with specific criteria (e.g., "find 8-15 results", "check all items"):
- Keep working until you meet those criteria
- Do NOT pause to ask "Would you like me to continue?" or "Should I keep going?"
- Do NOT stop after reviewing just a few items when the task asks for more
- Just continue working until the task requirements are met
- Only use AskUserQuestion for genuine clarifications about requirements, NOT for progress check-ins

**TASK COMPLETION - CRITICAL:**

You MUST call the \`complete_task\` tool to finish ANY task. Never stop without calling it.

When to call \`complete_task\`:

1. **status: "success"** - You verified EVERY part of the user's request is done
   - Before calling, re-read the original request
   - Check off each requirement mentally
   - Summarize what you did for each part

2. **status: "blocked"** - You hit an unresolvable TECHNICAL blocker
   - Only use for: login walls, CAPTCHAs, rate limits, site errors, missing permissions
   - NOT for: "task is large", "many items to check", "would take many steps"
   - If the task is big but doable, KEEP WORKING - do not use blocked as an excuse to quit
   - Explain what you were trying to do
   - Describe what went wrong
   - State what remains undone in \`remaining_work\`

3. **status: "partial"** - AVOID THIS STATUS
   - Only use if you are FORCED to stop mid-task (context limit approaching, etc.)
   - The system will automatically continue you to finish the remaining work
   - If you use partial, you MUST fill in remaining_work with specific next steps
   - Do NOT use partial as a way to ask "should I continue?" - just keep working
   - If you've done some work and can keep going, KEEP GOING - don't use partial

**NEVER** just stop working. If you find yourself about to end without calling \`complete_task\`,
ask yourself: "Did I actually finish what was asked?" If unsure, keep working.

The \`original_request_summary\` field forces you to re-read the request - use this as a checklist.
</behavior>
`;

interface AgentConfig {
  description?: string;
  prompt?: string;
  mode?: 'primary' | 'subagent' | 'all';
}

interface McpServerConfig {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  timeout?: number;
}

interface ProviderModelConfig {
  name: string;
  tools?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  options?: Record<string, unknown>;
}

interface GenericProviderConfig {
  npm?: string;
  name?: string;
  options?: Record<string, unknown>;
  models?: Record<string, ProviderModelConfig>;
}

interface OpenCodeConfig {
  $schema?: string;
  model?: string;
  default_agent?: string;
  enabled_providers?: string[];
  permission?: string | Record<string, string | Record<string, string>>;
  agent?: Record<string, AgentConfig>;
  mcp?: Record<string, McpServerConfig>;
  provider?: Record<string, GenericProviderConfig>;
}

export interface ConfigGeneratorOptions {
  apiKeys?: ApiKeys;
  modelId?: string;
  skillsPath?: string;
  workingDirectory?: string;
  permissionApiPort?: number;
  questionApiPort?: number;
}

/**
 * Get the default skills path
 */
export function getDefaultSkillsPath(): string {
  // Check environment variable first
  if (process.env.SKILLS_PATH) {
    return process.env.SKILLS_PATH;
  }

  // In sidecar context, skills are typically bundled with the app
  // Check common locations
  const possiblePaths = [
    // Tauri bundled resources (passed via TAURI_RESOURCES_PATH env var)
    ...(process.env.TAURI_RESOURCES_PATH
      ? [path.join(process.env.TAURI_RESOURCES_PATH, 'skills')]
      : []),
    // Development mode - relative to sidecar
    path.join(__dirname, '../../apps/desktop/skills'),
    // Development mode - workspace root
    path.join(process.cwd(), 'apps/desktop/skills'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to relative path
  return path.join(process.cwd(), 'skills');
}

/**
 * Get the OpenCode config directory
 */
export function getOpenCodeConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // Default to user's app data directory
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'cowork-z', 'opencode');
  } else if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'cowork-z', 'opencode');
  } else {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'cowork-z', 'opencode');
  }
}

/**
 * Generate OpenCode configuration file
 *
 * @param options - Configuration options including API keys and model selection
 * @returns Path to the generated config file
 */
export function generateOpenCodeConfig(options: ConfigGeneratorOptions = {}): string {
  const configDir = getOpenCodeConfigDir();
  const configPath = path.join(configDir, 'opencode.json');

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const skillsPath = options.skillsPath || getDefaultSkillsPath();

  // Build platform-specific system prompt
  const systemPrompt = ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{ENVIRONMENT_INSTRUCTIONS\}\}/g,
    getPlatformEnvironmentInstructions()
  );

  // Base enabled providers
  const enabledProviders = [
    'anthropic',
    'openai',
    'openrouter',
    'google',
    'xai',
    'deepseek',
    'zai-coding-plan',
    'amazon-bedrock',
  ];

  // Build provider configurations based on available API keys
  const providerConfig: Record<string, GenericProviderConfig> = {};

  if (options.apiKeys?.ollama) {
    enabledProviders.push('ollama');
    // Ollama config would be added here if needed
  }

  if (options.apiKeys?.litellm) {
    enabledProviders.push('litellm');
  }

  // Build MCP server configs
  const mcpConfig: Record<string, McpServerConfig> = {};

  // File permission MCP server
  const filePermissionPath = path.join(skillsPath, 'file-permission', 'src', 'index.ts');
  if (fs.existsSync(filePermissionPath)) {
    mcpConfig['file-permission'] = {
      type: 'local',
      command: ['npx', 'tsx', filePermissionPath],
      enabled: true,
      environment: {
        PERMISSION_API_PORT: String(options.permissionApiPort || 3100),
      },
      timeout: 10000,
    };
  }

  // Ask user question MCP server
  const askUserQuestionPath = path.join(skillsPath, 'ask-user-question', 'src', 'index.ts');
  if (fs.existsSync(askUserQuestionPath)) {
    mcpConfig['ask-user-question'] = {
      type: 'local',
      command: ['npx', 'tsx', askUserQuestionPath],
      enabled: true,
      environment: {
        QUESTION_API_PORT: String(options.questionApiPort || 3101),
      },
      timeout: 10000,
    };
  }

  // Dev browser MCP server
  const devBrowserPath = path.join(skillsPath, 'dev-browser-mcp', 'src', 'index.ts');
  if (fs.existsSync(devBrowserPath)) {
    mcpConfig['dev-browser-mcp'] = {
      type: 'local',
      command: ['npx', 'tsx', devBrowserPath],
      enabled: true,
      timeout: 30000,
    };
  }

  // Complete task MCP server
  const completeTaskPath = path.join(skillsPath, 'complete-task', 'src', 'index.ts');
  if (fs.existsSync(completeTaskPath)) {
    mcpConfig['complete-task'] = {
      type: 'local',
      command: ['npx', 'tsx', completeTaskPath],
      enabled: true,
      timeout: 5000,
    };
  }

  const config: OpenCodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    default_agent: ACCOMPLISH_AGENT_NAME,
    enabled_providers: enabledProviders,
    permission: 'allow',
    provider: Object.keys(providerConfig).length > 0 ? providerConfig : undefined,
    agent: {
      [ACCOMPLISH_AGENT_NAME]: {
        description: 'Browser automation assistant using dev-browser',
        prompt: systemPrompt,
        mode: 'primary',
      },
    },
    mcp: Object.keys(mcpConfig).length > 0 ? mcpConfig : undefined,
  };

  // Write config file
  const configJson = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, configJson);

  return configPath;
}

/**
 * Build environment variables for OpenCode CLI
 *
 * @param apiKeys - API keys from secure storage
 * @returns Environment variables object
 */
export function buildOpenCodeEnvironment(apiKeys: ApiKeys = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Set API keys as environment variables
  if (apiKeys.anthropic) {
    env.ANTHROPIC_API_KEY = apiKeys.anthropic;
  }
  if (apiKeys.openai) {
    env.OPENAI_API_KEY = apiKeys.openai;
  }
  if (apiKeys.google) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = apiKeys.google;
  }
  if (apiKeys.xai) {
    env.XAI_API_KEY = apiKeys.xai;
  }
  if (apiKeys.deepseek) {
    env.DEEPSEEK_API_KEY = apiKeys.deepseek;
  }
  if (apiKeys.openrouter) {
    env.OPENROUTER_API_KEY = apiKeys.openrouter;
  }
  if (apiKeys.litellm) {
    env.LITELLM_API_KEY = apiKeys.litellm;
  }

  // Set OpenCode config directory
  env.OPENCODE_CONFIG_DIR = getOpenCodeConfigDir();

  return env;
}
