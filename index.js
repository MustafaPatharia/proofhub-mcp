#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

const API_BASE = process.env.PROOFHUB_API_BASE || 'https://kpi.proofhub.com/api/v3';
const API_KEY = process.env.PROOFHUB_API_KEY;

if (!API_KEY) {
  console.error('ERROR: PROOFHUB_API_KEY is not set in environment variables.');
  process.exit(1);
}

// ─── HTTP client ────────────────────────────────────────────────────────────
const http = axios.create({
  baseURL: API_BASE,
  headers: {
    'X-API-KEY': API_KEY,
    'User-Agent': 'ProofHub-MCP-Server (mcp@infithra.dev)',
    'Content-Type': 'application/json',
  },
});

// Respect ProofHub rate-limit: 25 req / 10 s
async function apiGet(url) {
  try {
    const res = await http.get(url);
    return res.data;
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = parseInt(err.response.headers['retry-after'] || '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return apiGet(url);
    }
    throw new Error(`ProofHub API error ${err.response?.status}: ${JSON.stringify(err.response?.data) || err.message}`);
  }
}

async function apiPost(url, body) {
  try {
    const res = await http.post(url, body);
    return res.data;
  } catch (err) {
    throw new Error(`ProofHub API error ${err.response?.status}: ${JSON.stringify(err.response?.data) || err.message}`);
  }
}

// ─── URL parser ─────────────────────────────────────────────────────────────
// Handles:  https://kpi.proofhub.com/bappswift/#app/todos/project-7189443252/list-270280503800/task-514774338823
function parseProofHubUrl(url) {
  const projectMatch = url.match(/project-(\d+)/);
  const listMatch    = url.match(/list-(\d+)/);
  const taskMatch    = url.match(/task-(\d+)/);
  return {
    projectId: projectMatch?.[1] || null,
    listId:    listMatch?.[1]    || null,
    taskId:    taskMatch?.[1]    || null,
  };
}

// ─── Bug-tracker link extractor ──────────────────────────────────────────────
// Looks for URLs in description + comments that look like issue-tracker links.
// Extend the regex / hosts list as needed.
const BUG_TRACKER_PATTERNS = [
  /https?:\/\/[^\s"<>]*\.atlassian\.net\/browse\/[^\s"<>]+/gi,   // Jira
  /https?:\/\/[^\s"<>]*\.linear\.app\/[^\s"<>]+/gi,              // Linear
  /https?:\/\/[^\s"<>]*github\.com\/[^\s"<>]+\/issues\/\d+/gi,   // GitHub Issues
  /https?:\/\/[^\s"<>]*gitlab\.com\/[^\s"<>]+\/-\/issues\/\d+/gi,// GitLab Issues
  /https?:\/\/[^\s"<>]*youtrack\.[^\s"<>]+\/issue\/[^\s"<>]+/gi, // YouTrack
  /https?:\/\/[^\s"<>]*bugzilla\.[^\s"<>]+\/show_bug[^\s"<>]+/gi,// Bugzilla
  /https?:\/\/[^\s"<>]*clickup\.com\/t\/[^\s"<>]+/gi,            // ClickUp
  /https?:\/\/[^\s"<>]*app\.asana\.com\/[^\s"<>]+/gi,            // Asana
];

function extractBugLinks(text) {
  if (!text) return [];
  const links = new Set();
  for (const pattern of BUG_TRACKER_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const m of matches) links.add(m[0]);
  }
  return [...links];
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── MCP Server ─────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'proofhub-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'proofhub_parse_url',
      description:
        'Parse a ProofHub task URL and return the project ID, list ID, and task ID embedded in it. ' +
        'Use this as the first step before calling other ProofHub tools.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full ProofHub task URL, e.g. https://kpi.proofhub.com/bappswift/#app/todos/project-7189443252/list-270280503800/task-514774338823' },
        },
        required: ['url'],
      },
    },
    {
      name: 'proofhub_get_task',
      description: 'Fetch full task details (title, description, stage, custom fields, assignees) from ProofHub.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          list_id:    { type: 'string' },
          task_id:    { type: 'string' },
        },
        required: ['project_id', 'list_id', 'task_id'],
      },
    },
    {
      name: 'proofhub_get_comments',
      description: 'Fetch all comments on a ProofHub task, including their full text.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          list_id:    { type: 'string' },
          task_id:    { type: 'string' },
        },
        required: ['project_id', 'list_id', 'task_id'],
      },
    },
    {
      name: 'proofhub_get_task_with_bug_links',
      description:
        'One-shot tool: given a ProofHub task URL (or IDs), fetches the task description AND all comments, ' +
        'then extracts any bug-tracker links (Jira, Linear, GitHub Issues, GitLab, YouTrack, ClickUp, Asana, etc.) ' +
        'found in any of those texts. Returns the task data plus a deduplicated list of bug links.',
      inputSchema: {
        type: 'object',
        properties: {
          url:        { type: 'string', description: 'Full ProofHub task URL (preferred). If supplied, project_id/list_id/task_id are ignored.' },
          project_id: { type: 'string' },
          list_id:    { type: 'string' },
          task_id:    { type: 'string' },
        },
      },
    },
    {
      name: 'proofhub_create_comment',
      description: 'Post a new comment on a ProofHub task.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id:  { type: 'string' },
          list_id:     { type: 'string' },
          task_id:     { type: 'string' },
          description: { type: 'string', description: 'Comment text (plain text or HTML).' },
        },
        required: ['project_id', 'list_id', 'task_id', 'description'],
      },
    },
    {
      name: 'proofhub_get_task_history',
      description: 'Fetch the activity history of a ProofHub task (stage changes, edits, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          list_id:    { type: 'string' },
          task_id:    { type: 'string' },
        },
        required: ['project_id', 'list_id', 'task_id'],
      },
    },
  ],
}));

// ── Tool handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── proofhub_parse_url ───────────────────────────────────────────────
    if (name === 'proofhub_parse_url') {
      const ids = parseProofHubUrl(args.url);
      if (!ids.taskId) throw new Error('Could not find a task ID in the URL.');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(ids, null, 2),
        }],
      };
    }

    // ── proofhub_get_task ────────────────────────────────────────────────
    if (name === 'proofhub_get_task') {
      const { project_id, list_id, task_id } = args;
      const task = await apiGet(`/projects/${project_id}/todolists/${list_id}/tasks/${task_id}`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(task, null, 2),
        }],
      };
    }

    // ── proofhub_get_comments ────────────────────────────────────────────
    if (name === 'proofhub_get_comments') {
      const { project_id, list_id, task_id } = args;
      const comments = await apiGet(`/projects/${project_id}/todolists/${list_id}/tasks/${task_id}/comments`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(comments, null, 2),
        }],
      };
    }

    // ── proofhub_get_task_with_bug_links ─────────────────────────────────
    if (name === 'proofhub_get_task_with_bug_links') {
      let { url, project_id, list_id, task_id } = args;

      // Resolve IDs from URL if provided
      if (url) {
        const ids = parseProofHubUrl(url);
        project_id = ids.projectId;
        list_id    = ids.listId;
        task_id    = ids.taskId;
      }

      if (!project_id || !list_id || !task_id) {
        throw new Error('Could not determine project_id, list_id, or task_id. Provide a full ProofHub URL or all three IDs.');
      }

      // Parallel fetch task + comments
      const [task, comments] = await Promise.all([
        apiGet(`/projects/${project_id}/todolists/${list_id}/tasks/${task_id}`),
        apiGet(`/projects/${project_id}/todolists/${list_id}/tasks/${task_id}/comments`),
      ]);

      // Collect all text blobs to search for bug links
      const allText = [
        task.description || '',
        ...(Array.isArray(comments) ? comments.map(c => c.description || '') : []),
      ].join('\n');

      const bugLinks = extractBugLinks(allText);

      // Build clean summary
      const result = {
        task: {
          id:          task.id,
          title:       task.title,
          description: stripHtml(task.description),
          stage:       task.stage?.name,
          list:        task.list?.name,
          project:     task.project?.name,
          updated_at:  task.updated_at,
          custom_fields: task.custom_fields,
        },
        comments: Array.isArray(comments)
          ? comments.map(c => ({
              id:          c.id,
              description: stripHtml(c.description),
              created_at:  c.created_at,
            }))
          : [],
        bug_links_found: bugLinks,
        bug_links_count: bugLinks.length,
        note: bugLinks.length > 0
          ? `Found ${bugLinks.length} bug-tracker link(s). You can use your bug-tracker MCP tools with these URLs.`
          : 'No bug-tracker links detected in task description or comments.',
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }

    // ── proofhub_create_comment ──────────────────────────────────────────
    if (name === 'proofhub_create_comment') {
      const { project_id, list_id, task_id, description } = args;
      const comment = await apiPost(
        `/projects/${project_id}/todolists/${list_id}/tasks/${task_id}/comments`,
        { description }
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(comment, null, 2),
        }],
      };
    }

    // ── proofhub_get_task_history ────────────────────────────────────────
    if (name === 'proofhub_get_task_history') {
      const { project_id, list_id, task_id } = args;
      const history = await apiGet(`/projects/${project_id}/todolists/${list_id}/tasks/${task_id}/history`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(history, null, 2),
        }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ProofHub MCP server running on stdio');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
