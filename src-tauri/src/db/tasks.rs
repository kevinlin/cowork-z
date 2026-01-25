// src-tauri/src/db/tasks.rs
//! Task history repository

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const MAX_HISTORY_ITEMS: i32 = 100;

/// Stored task representation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTask {
    pub id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub status: String,
    pub messages: Vec<StoredTaskMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Stored task message representation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTaskMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<StoredAttachment>>,
}

/// Stored attachment representation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAttachment {
    #[serde(rename = "type")]
    pub att_type: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Input for saving a task
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: String,
    pub prompt: String,
    pub status: String,
    #[serde(default)]
    pub messages: Vec<TaskMessageInput>,
    pub session_id: Option<String>,
    pub summary: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// Input for task message
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMessageInput {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub timestamp: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub attachments: Option<Vec<AttachmentInput>>,
}

/// Input for attachment
#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentInput {
    #[serde(rename = "type")]
    pub att_type: String,
    pub data: String,
    pub label: Option<String>,
}

/// Get messages for a task
fn get_messages_for_task(conn: &Connection, task_id: &str) -> Vec<StoredTaskMessage> {
    let mut stmt = conn
        .prepare(
            "SELECT id, type, content, tool_name, tool_input, timestamp
             FROM task_messages
             WHERE task_id = ?1
             ORDER BY sort_order ASC",
        )
        .expect("Failed to prepare messages query");

    let message_iter = stmt
        .query_map([task_id], |row| {
            let id: String = row.get(0)?;
            let msg_type: String = row.get(1)?;
            let content: String = row.get(2)?;
            let tool_name: Option<String> = row.get(3)?;
            let tool_input_str: Option<String> = row.get(4)?;
            let timestamp: String = row.get(5)?;

            let tool_input = tool_input_str.and_then(|s| serde_json::from_str(&s).ok());

            Ok((id, msg_type, content, tool_name, tool_input, timestamp))
        })
        .expect("Failed to query messages");

    message_iter
        .filter_map(|r| r.ok())
        .map(|(id, msg_type, content, tool_name, tool_input, timestamp)| {
            // Get attachments for this message
            let attachments = get_attachments_for_message(conn, &id);

            StoredTaskMessage {
                id,
                msg_type,
                content,
                timestamp,
                tool_name,
                tool_input,
                attachments: if attachments.is_empty() {
                    None
                } else {
                    Some(attachments)
                },
            }
        })
        .collect()
}

/// Get attachments for a message
fn get_attachments_for_message(conn: &Connection, message_id: &str) -> Vec<StoredAttachment> {
    let mut stmt = conn
        .prepare("SELECT type, data, label FROM task_attachments WHERE message_id = ?1")
        .expect("Failed to prepare attachments query");

    let att_iter = stmt
        .query_map([message_id], |row| {
            Ok(StoredAttachment {
                att_type: row.get(0)?,
                data: row.get(1)?,
                label: row.get(2)?,
            })
        })
        .expect("Failed to query attachments");

    att_iter.filter_map(|r| r.ok()).collect()
}

/// Get all tasks (limited to MAX_HISTORY_ITEMS)
pub fn get_tasks(conn: &Connection) -> Vec<StoredTask> {
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt, summary, status, session_id, created_at, started_at, completed_at
             FROM tasks
             ORDER BY created_at DESC
             LIMIT ?1",
        )
        .expect("Failed to prepare tasks query");

    let task_iter = stmt
        .query_map([MAX_HISTORY_ITEMS], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .expect("Failed to query tasks");

    task_iter
        .filter_map(|r| r.ok())
        .map(
            |(id, prompt, summary, status, session_id, created_at, started_at, completed_at)| {
                let messages = get_messages_for_task(conn, &id);
                StoredTask {
                    id,
                    prompt,
                    summary,
                    status,
                    messages,
                    session_id,
                    created_at,
                    started_at,
                    completed_at,
                }
            },
        )
        .collect()
}

/// Get a single task by ID
pub fn get_task(conn: &Connection, task_id: &str) -> Option<StoredTask> {
    let result = conn.query_row(
        "SELECT id, prompt, summary, status, session_id, created_at, started_at, completed_at
         FROM tasks WHERE id = ?1",
        [task_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        },
    );

    match result {
        Ok((id, prompt, summary, status, session_id, created_at, started_at, completed_at)) => {
            let messages = get_messages_for_task(conn, &id);
            Some(StoredTask {
                id,
                prompt,
                summary,
                status,
                messages,
                session_id,
                created_at,
                started_at,
                completed_at,
            })
        }
        Err(_) => None,
    }
}

/// Save a task (upsert)
pub fn save_task(conn: &Connection, task: &TaskInput) -> Result<(), String> {
    // Use a transaction for atomicity
    conn.execute(
        "INSERT OR REPLACE INTO tasks
         (id, prompt, summary, status, session_id, created_at, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task.id,
            task.prompt,
            task.summary,
            task.status,
            task.session_id,
            task.created_at,
            task.started_at,
            task.completed_at,
        ],
    )
    .map_err(|e| format!("Failed to save task: {}", e))?;

    // Delete existing messages (cascade handles attachments)
    conn.execute("DELETE FROM task_messages WHERE task_id = ?1", [&task.id])
        .map_err(|e| format!("Failed to delete old messages: {}", e))?;

    // Insert messages
    for (sort_order, msg) in task.messages.iter().enumerate() {
        conn.execute(
            "INSERT INTO task_messages
             (id, task_id, type, content, tool_name, tool_input, timestamp, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                msg.id,
                task.id,
                msg.msg_type,
                msg.content,
                msg.tool_name,
                msg.tool_input.as_ref().map(|v| v.to_string()),
                msg.timestamp,
                sort_order as i32,
            ],
        )
        .map_err(|e| format!("Failed to insert message: {}", e))?;

        // Insert attachments
        if let Some(attachments) = &msg.attachments {
            for att in attachments {
                conn.execute(
                    "INSERT INTO task_attachments (message_id, type, data, label)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![msg.id, att.att_type, att.data, att.label],
                )
                .map_err(|e| format!("Failed to insert attachment: {}", e))?;
            }
        }
    }

    // Enforce max history limit
    conn.execute(
        "DELETE FROM tasks WHERE id NOT IN (
             SELECT id FROM tasks ORDER BY created_at DESC LIMIT ?1
         )",
        [MAX_HISTORY_ITEMS],
    )
    .map_err(|e| format!("Failed to enforce history limit: {}", e))?;

    Ok(())
}

/// Update task status
pub fn update_task_status(
    conn: &Connection,
    task_id: &str,
    status: &str,
    completed_at: Option<&str>,
) -> Result<(), String> {
    if let Some(completed) = completed_at {
        conn.execute(
            "UPDATE tasks SET status = ?1, completed_at = ?2 WHERE id = ?3",
            params![status, completed, task_id],
        )
        .map_err(|e| format!("Failed to update task status: {}", e))?;
    } else {
        conn.execute(
            "UPDATE tasks SET status = ?1 WHERE id = ?2",
            params![status, task_id],
        )
        .map_err(|e| format!("Failed to update task status: {}", e))?;
    }
    Ok(())
}

/// Add a message to a task
pub fn add_task_message(
    conn: &Connection,
    task_id: &str,
    message: &TaskMessageInput,
) -> Result<(), String> {
    // Get the next sort_order
    let max_order: Option<i32> = conn
        .query_row(
            "SELECT MAX(sort_order) FROM task_messages WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let sort_order = max_order.map(|m| m + 1).unwrap_or(0);

    conn.execute(
        "INSERT INTO task_messages
         (id, task_id, type, content, tool_name, tool_input, timestamp, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message.id,
            task_id,
            message.msg_type,
            message.content,
            message.tool_name,
            message.tool_input.as_ref().map(|v| v.to_string()),
            message.timestamp,
            sort_order,
        ],
    )
    .map_err(|e| format!("Failed to add message: {}", e))?;

    // Insert attachments
    if let Some(attachments) = &message.attachments {
        for att in attachments {
            conn.execute(
                "INSERT INTO task_attachments (message_id, type, data, label)
                 VALUES (?1, ?2, ?3, ?4)",
                params![message.id, att.att_type, att.data, att.label],
            )
            .map_err(|e| format!("Failed to insert attachment: {}", e))?;
        }
    }

    Ok(())
}

/// Update task session ID
pub fn update_task_session_id(
    conn: &Connection,
    task_id: &str,
    session_id: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET session_id = ?1 WHERE id = ?2",
        params![session_id, task_id],
    )
    .map_err(|e| format!("Failed to update session ID: {}", e))?;
    Ok(())
}

/// Update task summary
pub fn update_task_summary(conn: &Connection, task_id: &str, summary: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET summary = ?1 WHERE id = ?2",
        params![summary, task_id],
    )
    .map_err(|e| format!("Failed to update summary: {}", e))?;
    Ok(())
}

/// Delete a task
pub fn delete_task(conn: &Connection, task_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [task_id])
        .map_err(|e| format!("Failed to delete task: {}", e))?;
    Ok(())
}

/// Clear all task history
pub fn clear_history(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM tasks", [])
        .map_err(|e| format!("Failed to clear history: {}", e))?;
    Ok(())
}
