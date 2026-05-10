# 🔌 ProofHub MCP Server

[![npm version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/MustafaPatharia/proofhub-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Protocol-purple.svg)](https://modelcontextprotocol.io)

A **Model Context Protocol (MCP)** server that bridges ProofHub's project management capabilities with AI assistants like Claude, GitHub Copilot, and Cursor. Paste a ProofHub task URL in your AI chat, and the agent automatically fetches task details, comments, and bug tracker links to help you complete development tasks faster.

## 🎯 What This Solves

As a developer working with ProofHub for task management, you normally have to:
1. Open ProofHub in a browser
2. Navigate to the task
3. Read the description and all comments
4. Copy relevant bug tracker links (Jira, Linear, GitHub Issues, etc.)
5. Context-switch back to your code editor

**With this MCP server**, simply paste the ProofHub URL into your AI assistant, and it automatically:
- ✅ Fetches the complete task description
- ✅ Retrieves all comments and history
- ✅ Extracts bug tracker links from anywhere in the task
- ✅ Provides structured context for the AI to help you code

## 🚀 Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configuration

Create a `.env` file (use `.env.example` as template):

```env
PROOFHUB_API_KEY=your_api_key_here
PROOFHUB_API_BASE=https://company.proofhub.com/api/v3
```

> **Getting your API key:** Log in to ProofHub → Account Settings → Apps & Integrations → API → Generate new API key

### 3. Connect to Your AI Assistant

#### 🤖 Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proofhub": {
      "command": "node",
      "args": ["/absolute/path/to/proofhub-mcp/index.js"],
      "env": {
        "PROOFHUB_API_KEY": "your_key_here"
      }
    }
  }
}
```

**Config location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

#### 💻 VS Code Copilot

Add to `.vscode/mcp.json` in your workspace or user settings:

```json
{
  "servers": {
    "proofhub": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/proofhub-mcp/index.js"],
      "env": {
        "PROOFHUB_API_KEY": "your_key_here"
      }
    }
  }
}
```

## 📋 Available Tools

| Tool | Description | Use Case |
|------|-------------|----------|
| **`proofhub_parse_url`** | Extracts project/list/task IDs from a ProofHub URL | Parse URL before calling other tools |
| **`proofhub_get_task`** | Fetches complete task details (title, description, stage, custom fields, assignees) | Get full task context |
| **`proofhub_get_comments`** | Retrieves all task comments with timestamps | Review team discussions |
| **`proofhub_get_task_with_bug_links`** | **⭐ One-shot**: Fetches task + comments + auto-extracts bug tracker URLs | **Most useful** - get everything in one call |
| **`proofhub_create_comment`** | Posts a new comment on a task | Update task from your AI chat |
| **`proofhub_get_task_history`** | Fetches activity/stage change history | Track task evolution |

## 💡 Usage Examples

### Example 1: Fetch Task Context

Simply paste a ProofHub URL in your AI chat:

```
Get context for this task:
https://kpi.proofhub.com/bappswift/#app/todos/project-7189443252/list-270280503800/task-514774338823
```

The AI will call `proofhub_get_task_with_bug_links` and return:
- Task title and description
- All comments (cleaned from HTML)
- List of bug tracker links found
- Stage, assignees, and custom fields

### Example 2: Development Workflow

```
I need to work on this ProofHub task:
https://kpi.proofhub.com/.../task-514774338823

Fetch the task, find any Jira links, and help me understand what needs to be built.
```

The AI will:
1. Fetch the complete task context
2. Extract Jira/GitHub/Linear links
3. Use your bug tracker MCP to fetch issue details
4. Provide a comprehensive development plan

### Example 3: Update Task

```
Add a comment to task 514774338823 in project 7189443252, list 270280503800:
"Completed the API endpoint implementation. Ready for review."
```

## ⚡ Features

- **🔒 Secure**: API key stored in environment variables, never in code
- **⏱️ Rate Limit Handling**: Automatically respects ProofHub's 25 req/10s limit with retry logic
- **🧹 HTML Cleanup**: Strips HTML tags from descriptions/comments for clean AI consumption
- **🔗 Smart Link Extraction**: Regex patterns detect bug tracker URLs across all text fields
- **🎯 One-Shot Tool**: `get_task_with_bug_links` fetches everything in a single call
- **🛡️ Error Handling**: Graceful error messages with API status codes


## 🤝 Contributing
Contributions welcome! Fork the repo, make your changes, and submit a pull request.

## References

- [ProofHub API v3](https://github.com/ProofHub/api_v3)
