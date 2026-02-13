# OpenCode Server API

This skill gives you access to the OpenCode server REST API for self-introspection — checking your own health, session state, message history, todos, configuration, skills, MCP status, and performing lightweight config updates.

## Authentication

The server credentials are provided in your system prompt inside the `<server-access>` block. All requests require HTTP basic auth:

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/<endpoint>
```

Replace `$PORT` and `$PASSWORD` with the values from your system prompt.

---

## Endpoints

### GET /global/health

Check server health and get the OpenCode version.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/global/health
```

**Response:**
```json
{ "healthy": true, "version": "1.1.48" }
```

---

### GET /config

Read the current server configuration (model, agents, permissions, MCP servers, etc.).

**Query parameters:**
- `directory` (optional) — project directory to scope the config

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/config
```

**Response:** Full config object including `model`, `default_agent`, `enabled_providers`, `permission`, `agent`, `mcp`, etc.

---

### PATCH /config

Update configuration at runtime (e.g., switch model, update permissions, modify MCP servers).

**Query parameters:**
- `directory` (optional) — project directory to scope the config

**Body:** Partial config object — only include fields you want to change.

```bash
curl -s -u opencode:$PASSWORD -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514"}' \
  http://localhost:$PORT/config
```

**Response:** Updated full config object.

**Note:** PATCH /config may cause the server to dispose and recreate its instance. This is normal and the server will recover automatically.

---

### GET /session

List all sessions.

**Query parameters:**
- `directory` (optional) — filter by project directory
- `roots` (optional) — if `true`, only return root sessions
- `limit` (optional) — max number of sessions to return

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/session
```

**Response:**
```json
[
  {
    "id": "ses_abc123",
    "slug": "my-session",
    "projectID": "proj_1",
    "directory": "/path/to/project",
    "title": "Session title",
    "version": "1",
    "time": { "created": 1700000000, "updated": 1700000100 }
  }
]
```

---

### GET /session/{id}

Get details of a specific session.

**Query parameters:**
- `directory` (optional) — project directory

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/session/ses_abc123
```

**Response:** Single session object (same shape as list items above).

---

### GET /session/{id}/message

Read back message history for a session.

**Query parameters:**
- `directory` (optional) — project directory
- `limit` (optional) — max number of messages to return

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/session/ses_abc123/message
```

**Response:**
```json
[
  {
    "info": { "id": "msg_1", "role": "assistant", "sessionID": "ses_abc123" },
    "parts": [{ "type": "text", "text": "Here is my response..." }]
  }
]
```

---

### GET /session/{id}/todo

Get todo items for a session.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/session/ses_abc123/todo
```

**Response:**
```json
[
  { "id": "todo_1", "content": "Implement feature X", "status": "in_progress", "priority": "high" },
  { "id": "todo_2", "content": "Write tests", "status": "pending", "priority": "medium" }
]
```

Todo statuses: `pending`, `in_progress`, `completed`, `cancelled`
Todo priorities: `high`, `medium`, `low`

---

### GET /skill

List available skills.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/skill
```

**Response:** Array of skill objects, each with `name`, `description`, `location`, and `content` fields.

---

### GET /mcp

Check MCP server connection status.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/mcp
```

**Response:** Map of MCP server names to their connection status:
```json
{ "my-mcp-server": { "status": "connected" } }
```

---

### GET /permission

List pending permission requests.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/permission
```

**Response:**
```json
[
  {
    "id": "per_abc",
    "sessionID": "ses_abc123",
    "permission": "bash",
    "patterns": ["ls -la"],
    "metadata": { "command": "ls -la" },
    "always": []
  }
]
```

---

### GET /question

List pending question requests.

```bash
curl -s -u opencode:$PASSWORD http://localhost:$PORT/question
```

**Response:**
```json
[
  {
    "id": "que_abc",
    "sessionID": "ses_abc123",
    "questions": [
      { "question": "Which option?", "options": [{ "label": "A" }, { "label": "B" }] }
    ]
  }
]
```

---

## Usage Guidance

- **Check health** (`GET /global/health`) to verify the server is responsive before making other calls.
- **Inspect your own session** (`GET /session/{id}`, `GET /session/{id}/message`) to review what you've said and done so far.
- **Check todos** (`GET /session/{id}/todo`) to see your current task progress.
- **List skills** (`GET /skill`) when the user asks about your capabilities or available skills.
- **Check MCP status** (`GET /mcp`) when the user asks about connected tools or MCP servers.
- **Switch model** (`PATCH /config` with `{"model": "..."}`) if the user asks you to change the AI model.
- **Read config** (`GET /config`) to understand your current setup (active model, permissions, agents).
