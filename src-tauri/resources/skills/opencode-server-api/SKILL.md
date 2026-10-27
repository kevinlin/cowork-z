---
name: opencode-server-api
description: Read-only queries against your own OpenCode 2.x server API (server info, sessions, message history, pending permissions and questions, MCP status, skills, agents). Use when you need to inspect your own state, or when the user asks about your session, tools, MCP servers or skills.
---

# OpenCode Server API

This skill lets you inspect the OpenCode server you run on — server info, sessions, message history (including your todo lists), pending permission and question requests, MCP status, skills and agents. It is **read-only**: use `GET` requests only.

## Authentication

The server port is in your system prompt, inside the `<server-access>` block. The basic-auth password is already in your shell environment as `OPENCODE_SERVER_PASSWORD`; your shell expands it locally. Every request needs HTTP basic auth:

```bash
curl -s -u "opencode:$OPENCODE_SERVER_PASSWORD" http://localhost:$PORT/<endpoint>
```

Replace `$PORT` with the port from your system prompt. Use `$OPENCODE_SERVER_PASSWORD` exactly as written (PowerShell: `$env:OPENCODE_SERVER_PASSWORD`).

**NEVER print, echo, log, or write the password's value anywhere — not to the chat, not to files, not to command output. Only reference it as a shell variable inside commands.**

## IMPORTANT: Fetch the API Spec First

**Before calling ANY endpoint, fetch the live OpenAPI spec.** It is the source of truth for routes, parameters and response shapes, and it may be newer than this skill.

```bash
curl -s -u "opencode:$OPENCODE_SERVER_PASSWORD" http://localhost:$PORT/openapi.json
```

Do not guess from the examples below; verify against the spec first.

## Conventions

- All API routes live under `/api/`. Answers are wrapped: `{"data": ...}`, plus `"location"` on location-scoped routes.
- **Location-scoped routes** (`/api/mcp`, `/api/skill`, `/api/agent`) take the workspace folder as a `location[directory]` query parameter. The brackets break plain curl URLs, so pass it with `-G --data-urlencode`:

```bash
curl -s -G -u "opencode:$OPENCODE_SERVER_PASSWORD" \
  --data-urlencode "location[directory]=<workspace path>" \
  http://localhost:$PORT/api/mcp
```

The workspace path is given in your system prompt (`<workspace-conventions>`). Session routes need no location.

## Endpoints (all `GET`)

| Route | Returns |
|---|---|
| `/api/info` | Server `version`, `pid`, `urls`. Use it as the health check. |
| `/api/session` | `{data: [session]}` — your sessions. Optional `directory`, `limit`, `search`. |
| `/api/session/{id}` | `{data: session}` — `id`, `model`, `outcome`, `time`, `location`, `permissions`. |
| `/api/session/{id}/message` | `{data: [message], cursor}` — history. Pass `order=desc` for newest first, `order=asc` for oldest first. |
| `/api/session/{id}/permission` | `{data: [request]}` — permission requests waiting for an answer. |
| `/api/session/{id}/form` | `{data: [form]}` — questions waiting for an answer. |
| `/api/mcp` | `{data: [{name, status: {status, error?}}]}` — MCP servers. |
| `/api/skill` | `{data: [{id, name, path, content}]}` — available skills. |
| `/api/agent` | `{data: [agent]}` — available agents and their models. |

Find your own session in `/api/session` (filter with `directory=<workspace path>`).

### `/api/session/{id}/message`

Messages have a `type` (`user`, `assistant`, `idle`, …). An `assistant` message has a `content` array of `text`, `reasoning` and `tool` items. A tool item is `{type: "tool", name, state: {status, input, content}}`.

**Your todo list** is the `input.todos` of your newest `todowrite` call: read the history newest first (`order=desc`), find the first `tool` item named `todowrite` and take `state.input.todos` (`[{content, status}]`, status `pending`, `in_progress` or `completed`). There is no todo route.

```bash
curl -s -u "opencode:$OPENCODE_SERVER_PASSWORD" "http://localhost:$PORT/api/session/ses_abc123/message?order=desc"
```

### `/api/mcp`

`status.status` is one of `connected`, `pending` (still connecting), `disabled`, `failed` or `needs_auth`; `error` is set on the last two. The list also includes servers from the user's global OpenCode config.

### `/api/session/{id}/permission` and `/form`

Pending permission request: `{id, action, resources, metadata, message?}`. Pending form: `{id, title, fields: [{key, type, options?}]}`. Both are empty when nothing is waiting.

## Out of scope

Do not call routes that change state (creating or deleting sessions, prompting, interrupting, answering permissions or forms, editing config or MCP servers). The user decides those in the app. Do not call any route that handles credentials or provider sign-in either; they are not part of this skill. Do not call `/api/config`: it returns the user's raw config files, which can hold API keys.

## Usage Guidance

- **Check health** (`/api/info`) before other calls when the server seems unresponsive.
- **Review your own work** (`/api/session/{id}/message`) to see what you have said and done.
- **Check todos** by reading your newest `todowrite` call from the message history.
- **List skills** (`/api/skill`) when asked about your capabilities.
- **Check MCP status** (`/api/mcp`) when asked about connected tools or servers.
- **List agents** (`/api/agent`) to understand your current setup.
